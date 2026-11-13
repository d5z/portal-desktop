import { app, dialog, net, type BrowserWindow } from 'electron';
import { access } from 'node:fs/promises';
import path from 'node:path';
import type { SaveSettings } from '../../shared/types';
import { BackgroundPoll } from '../app/background-poll';
import { ClientErrorLog } from '../app/error-log';
import type { MutationQueue } from '../app/mutations';
import { SettingsStore } from '../app/settings';
import { ChatProxy } from '../chat/proxy';
import { verifyBeingConnection } from '../chat/ready';
import { ClientInstall } from '../updates/client-install';
import { loadRuntimeBundle, restoreRuntimeMode, RuntimeRollbackError, RuntimeUpdater, type RuntimeUpdateResult } from '../updates/runtime';
import { BackgroundPortal } from './background';
import { ExternalPortalObserver } from './external';
import { OrphanPortalRecovery } from './orphan';
import { setSubagentEnabled, setupSubagent } from './subagent-setup';
import { PortalSupervisor } from './supervisor';
import { PortalTakeover } from './takeover';
import { WindowsForcePortal } from './windows-force';
/** Owns Portal startup, takeover, recovery and install shutdown as one state machine. */
export async function createPortalController(options: {
  directory: string; binary: string; store: SettingsStore; portal: PortalSupervisor; background: BackgroundPortal;
  errorLog: ClientErrorLog; mutations: MutationQueue; proxy: ChatProxy; startupNotice?: string;
  window(): BrowserWindow | null; isQuitting(): boolean;
  reusePreviousConfig(): Promise<void>; connectionChanged(): void;
  cleanup(): Promise<void>; quit(): void; resumeAfterFailedShutdown(): Promise<void>;
}) {
  const { directory, binary, store, portal, background, errorLog, proxy, window: getWindow,
    isQuitting, reusePreviousConfig } = options;
  const exclusive = options.mutations.run;
  let recoveryBlocked = false;
  const clientInstall = new ClientInstall(directory, background);
  let installIntent = await clientInstall.read();
  const finishClientInstall = async () => { await clientInstall.finish(); installIntent = null; };
  // Only a failed runtime rollback blocks mutations. A pending client install
  // can be superseded safely even when Portal startup or Being is unavailable.
  const recoverRuntime = async () => {
    installIntent = await clientInstall.read();
    try {
      const recovered = await new RuntimeUpdater(directory, background).recover(installIntent);
      recoveryBlocked = false;
      return recovered;
    } catch (error) {
      recoveryBlocked = true;
      throw error;
    }
  };
  let startupDeferred = false;
  let startupNotice = options.startupNotice;
  let startupConnectionNotice: { endpoint: string; message: string } | undefined;
  let runtimeUpdate: RuntimeUpdateResult = { phase: 'current', message: 'Portal 升级状态将在启动检查后显示。' };
  const verifyConnection = async () => {
    await reusePreviousConfig();
    await verifyBeingConnection(store.connection, net.fetch.bind(net) as typeof fetch);
    startupNotice = undefined;
    startupConnectionNotice = undefined;
  };
  const externalPortal = new ExternalPortalObserver();
  const orphanPortal = new OrphanPortalRecovery(directory);
  const forcePortal = new WindowsForcePortal();
  const ownedRoot = () => background.installedService?.label === background.label && !background.installedService.existing ? background.installedService.root : undefined;
  const publishBackground = async () => {
    const state = await background.portalState();
    if (takeover.holdMessage) {
      startupNotice = errorLog.report('portal-takeover', takeover.holdMessage, 'Portal 切换未完成，请检查日志后重试。');
      portal.state = { ...state, phase: 'error', managed: false, message: startupNotice };
      portal.emit('state', portal.state); return;
    }
    portal.state = state;
    portal.emit('state', portal.state);
  };
  const takeover = new PortalTakeover(directory, {
    discover: async (connection, force) => force ? forcePortal.conflicts(connection) : [
      ...await externalPortal.conflicts(connection, ownedRoot()), ...await orphanPortal.conflicts(connection),
    ],
    preflight: async (targets, force) => {
      await verifyConnection();
      // Our foreground engine already uses this profile's saved settings.
      // Import only external configs, not an older generated foreground TOML.
      if (!force) await store.reusePortalConfig(targets.filter(item => !item.orphan).map(item => item.service?.configPath || path.join(item.root, 'portal.toml')));
      await store.save(store.settings);
      if (app.isPackaged) await loadRuntimeBundle(process.resourcesPath);
      else await access(binary);
    },
    stop: async (target, force) => {
      if (force) {
        const details = await forcePortal.stop(target);
        errorLog.report('portal-force-stop', `runtime=${target.root}\n${details}`);
      } else if (target.orphan) await orphanPortal.stop(target);
      else await background.unload(target.service!);
    },
  });
  const startClientPortal = async (replacing = false, restart = false) => {
    if (!store.connection) throw new Error('请先连接 Being。');
    if (restart) {
      await portal.stop();
      if (background.state.enabled) await background.disable();
    }
    if (app.isPackaged) await loadRuntimeBundle(process.resourcesPath);
    if (replacing) await portal.stop();
    await store.save(store.settings);
    if (store.settings.backgroundEnabled) {
      await portal.stop();
      try {
        await background.enable(store.settings, store.connection);
        await new RuntimeUpdater(directory, background).waitReady(background.installedService!);
      } catch (error) {
        // A failed readiness check must not leave a retrying guardian behind.
        await background.disable();
        throw error;
      }
      await publishBackground();
    } else {
      if (background.state.enabled) await background.disable();
      await portal.start(store.settings, store.connection);
      await portal.waitReady();
    }
  };
  const publishCurrentPortal = async () => { if (takeover.holdMessage || !portal.managing) await publishBackground(); };
  const connectionDefaults = async (input: Pick<SaveSettings, 'connectionLink'>) => {
    const connection = store.resolveConnection(input);
    if (connection.endpoint === store.connection?.endpoint && background.installedService) {
      return { portalName: store.settings.portalName, source: '当前本机配置' };
    }
    const targets = await externalPortal.conflicts(connection, ownedRoot());
    const previous = targets.find(item => item.service?.name);
    return { portalName: previous?.service?.name || store.settings.portalName, source: previous?.root };
  };
  const save = async (input: SaveSettings) => {
    const previous = { ...store.settings }; const previousConnection = store.connection;
    await store.save(input);
    options.connectionChanged();
    try {
      await verifyConnection();
      await takeover.run(store.connection!, 'manual', async replacing => {
        // Discovery may import an old configuration during takeover. The switches
        // explicitly saved in this operation must take precedence over that file.
        store.settings = { ...store.settings, allowExec: input.allowExec, kitsEnabled: input.kitsEnabled };
        if (input.subagentSetup) {
          await portal.stop();
          if (background.state.enabled) await background.disable();
          const configPath = await setupSubagent(directory, store.settings, input.subagentSetup);
          await store.save({ ...store.settings, portalConfigPath: configPath });
        }
        if (input.subagentEnabled !== undefined) {
          await portal.stop();
          if (background.state.enabled) await background.disable();
          const configPath = await setSubagentEnabled(directory, store.settings, input.subagentEnabled);
          await store.save({ ...store.settings, portalConfigPath: configPath });
        }
        await startClientPortal(replacing, true);
      });
      await publishCurrentPortal();
    } catch (error) {
      if (previousConnection) await store.save({ ...previous, connectionLink: previousConnection.link + '&relay_secret=' + encodeURIComponent(previousConnection.relaySecret) });
      throw error;
    }
  };
  const requestPortalStart = async (restart = false) => {
    if (startupDeferred || recoveryBlocked || installIntent) {
      await restoreStartup('manual');
      if (startupDeferred || recoveryBlocked) throw new Error(startupConnectionNotice?.message || startupNotice || runtimeUpdate?.message);
      return portal.state;
    }
    if (restart && portal.state.managed === false) throw new Error('当前 Portal 由外部管理，请使用原管理方式重启。');
    if (!store.connection) throw new Error('请先连接 Being。');
    await verifyConnection();
    await takeover.run(store.connection, 'manual', replacing => startClientPortal(replacing, restart));
    await publishCurrentPortal(); return portal.state;
  };
  const forceStart = async () => {
    if (process.platform !== 'win32') throw new Error('强制接管目前仅支持 Windows。');
    if (!store.connection) throw new Error('请先连接 Being。');
    await verifyConnection();
    if (app.isPackaged) await loadRuntimeBundle(process.resourcesPath);
    else await access(binary);
    await takeover.run(store.connection, 'manual', async () => {
      // Force recovery always selects the bundled engine, preserves user settings,
      // and waits for local readiness before reporting a successful replacement.
      await portal.stop();
      if (background.installedService) {
        await background.disable();
        // Do not reuse a stale binary just because its settings fingerprint matches.
        await background.forget();
      }
      await store.save({ ...store.settings, portalBinary: binary });
      await startClientPortal(true);
      startupDeferred = false;
      if (installIntent) await finishClientInstall();
    }, false, true);
    await publishCurrentPortal(); return portal.state;
  };
  const stop = async () => {
    if (portal.state.managed === false) throw new Error('当前 Portal 由外部管理，请使用原管理方式停止。');
    if (background.state.enabled) {
      await background.disable();
      await store.save({ ...store.settings, backgroundEnabled: false });
      await publishBackground(); return portal.state;
    }
    return portal.stop();
  };
  let handlingConflict = false;
  let portalNoticeIdentity = '';
  portal.on('state', state => {
    // A background Portal can reconnect after the one-off startup check failed.
    // Retire that check's notice before notifying the renderer to refresh its snapshot.
    if (startupConnectionNotice && state.phase === 'connected' &&
        state.beingEndpoint === startupConnectionNotice.endpoint && state.beingEndpoint === store.connection?.endpoint) {
      startupConnectionNotice = undefined;
    }
    const identity = JSON.stringify([state.portalName, state.beingEndpoint, state.phase, state.pid]);
    if (identity !== portalNoticeIdentity) { portalNoticeIdentity = identity; proxy.portalStateChanged(); }
    if (state.phase === 'error' || state.phase === 'external') {
      if (state.logs.length) errorLog.report('portal-runtime', state.logs.slice(-60).join('\n'));
      state = { ...state, message: errorLog.report('portal-state', state.message, 'Portal 启动未完成，请查看日志后重试。') };
      portal.state = state;
    }
    const window = getWindow();
    if (window && !window.isDestroyed()) window.webContents.send('beings:portal-state', state);
    // A competing service can start between discovery and launch. Resolve that
    // race once through the same stop/start path, never from a retry timer.
    if (state.conflict && !handlingConflict && !takeover.holdMessage && !isQuitting()) {
      handlingConflict = true;
      void exclusive(async () => {
        if (background.state.enabled && !background.state.running) await background.disable();
        if (store.connection) await takeover.run(store.connection, 'automatic', startClientPortal, true);
        await publishBackground();
      }).catch(error => {
        portal.state = { phase: 'error', managed: false, message: errorLog.report('portal-conflict', error, 'Portal 切换未完成，请检查日志后重试。'), logs: [] };
        portal.emit('state', portal.state);
      }).finally(() => { handlingConflict = false; });
    }
  });
  async function restoreStartup(intent: 'manual' | 'automatic' = 'automatic') {
    try {
      // Local rollback must not depend on network availability or takeover holds.
      const recovered = await recoverRuntime();
      if (!store.connection) {
        if (installIntent) {
          await finishClientInstall();
          runtimeUpdate = { phase: 'current', message: '客户端已安装；连接配置完成后使用客户端 Portal。' };
        }
        return;
      }
      const connection = store.connection;
      const updater = new RuntimeUpdater(directory, background);
      const resumeInstalledRuntime = async () => {
        if (!installIntent) return;
        await clientInstall.resume(installIntent, async () => {
          const service = background.installedService;
          // The newly installed bundle may be the one that failed. Resume the
          // preserved engine, not that bundle, for a foreground-only client.
          const settings = service ? {
            ...store.settings,
            portalBinary: path.join(service.root, process.platform === 'win32' ? 'heart-portal.exe' : 'heart-portal'),
            portalConfigPath: service.configPath
          } : store.settings;
          await portal.start(settings, connection);
          await portal.waitReady();
        });
        installIntent = null;
      };
      if (recovered && background.installedService) {
        await resumeInstalledRuntime();
        await takeover.clearRuntimeFailure(connection);
        recoveryBlocked = false;
        startupDeferred = false;
        runtimeUpdate = { phase: 'error', message: '已恢复上次未完成升级前的 Portal；本次启动不再自动重试升级。' };
        await publishCurrentPortal();
        return;
      }
      try { await verifyConnection(); startupDeferred = false; }
      catch (error) {
        startupDeferred = true;
        const message = errorLog.report('startup-connection', error, '连接检查失败，请检查设置后重试。');
        startupConnectionNotice = { endpoint: connection.endpoint, message };
        runtimeUpdate = { phase: 'skipped', message };
        portal.state = { phase: 'stopped', message, logs: [] };
        // Retain the install intent; it can be resumed or superseded offline.
        return;
      }
      await takeover.run(connection, intent, async replacing => {
        if (replacing) { await startClientPortal(true); if (installIntent) await finishClientInstall(); return; }
        if (app.isPackaged) {
          const { bundle, binary: bundledBinary } = await loadRuntimeBundle(process.resourcesPath);
          try { runtimeUpdate = await updater.sync(bundledBinary, bundle, store.settings, connection, installIntent); }
          catch (error) {
            if (error instanceof RuntimeRollbackError) await resumeInstalledRuntime();
            throw error;
          }
          if (runtimeUpdate.phase !== 'skipped') {
            if (runtimeUpdate.phase === 'current' || runtimeUpdate.phase === 'updated') {
              const service = background.installedService!;
              await store.save({ ...store.settings, portalConfigPath: service.generatedConfig ? undefined : service.configPath, workspace: service.cwd || store.settings.workspace });
              await restoreRuntimeMode(background, store.settings, async () => {
                await portal.start(store.settings, connection);
                await portal.waitReady();
              },
                true);
              if (store.settings.backgroundEnabled) await updater.waitReady(background.installedService!);
              if (installIntent) await finishClientInstall();
            }
            await publishCurrentPortal();
            // The replacement follows the existing background/foreground preference.
            return;
          }
          await store.save({ ...store.settings, portalBinary: bundledBinary });
          runtimeUpdate = { phase: 'current', message: '已选择随客户端附带的 Portal，下次启动按原配置运行。', portalVersion: bundle.portalVersion };
        }
        // Opening the client starts its Portal. Login startup and keeping it
        // alive after the client exits are separate preferences.
        await startClientPortal(false);
        if (installIntent) await finishClientInstall();
      });
      await publishCurrentPortal();
    } catch (error) {
      recoveryBlocked = await access(path.join(directory, 'runtime-update.json')).then(() => true, () => false);
      const message = errorLog.report('portal-startup', error, 'Portal 启动未完成，请查看日志后重试。');
      runtimeUpdate = { phase: 'error', message };
      portal.state = { phase: 'error', message, logs: [] };
      portal.emit('state', portal.state);
      const window = getWindow();
      if (!isQuitting() && window) void dialog.showMessageBox(window, { type: 'warning', title: 'Portal 更新未完成', message: runtimeUpdate.message, buttons: ['知道了'] });
    }
  }
  const shutdown = async (target: string, handoff?: () => Promise<void>) => {
    try {
      await recoverRuntime();
      await clientInstall.shutdown(app.getVersion(), target, store.connection, portal.managing, {
        cleanup: options.cleanup, handoff, quit: options.quit,
        startForeground: async () => { if (store.connection) await portal.start(store.settings, store.connection); },
      });
    } catch (error) {
      await options.resumeAfterFailedShutdown();
      installIntent = await clientInstall.read();
      throw error;
    }
  };
  const startPolling = () => {
    const observer = new BackgroundPoll({
      revision: () => options.mutations.revision,
      allowed: () => !isQuitting() && !options.mutations.pending && !portal.managing && Boolean(store.connection),
      read: () => background.observe(),
      publish: value => {
        background.acceptObservation(value);
        // Preserve takeover diagnostics until the user resolves the conflict.
        if (takeover.holdMessage) return;
        portal.state = value.portal;
        portal.emit('state', value.portal);
      },
      error: error => {
        errorLog.report('background-poll', error);
        portal.state = { phase: 'error', message: '后台状态查询失败，将降低频率重试；可在本机设置中检查服务。', logs: [] };
        portal.emit('state', portal.state);
      },
    });
    const backgroundPoll = setInterval(() => { void observer.tick(); }, 1000);
    backgroundPoll.unref();
    return () => clearInterval(backgroundPoll);
  };
  return {
    save, connectionDefaults, start: requestPortalStart, forceStart, stop, restoreStartup, shutdown, startPolling,
    get notice() { return [startupNotice, startupConnectionNotice?.message].filter(Boolean).join('\n') || undefined; },
    get recoveryBlocked() { return recoveryBlocked; },
    diagnostics: () => ({
      recoveryBlocked, runtime: runtimeUpdate, takeover: takeover.holdMessage,
      install: installIntent && {
        from: installIntent.from, target: installIntent.target, foreground: installIntent.foreground,
        services: installIntent.services.map(({ service, enabled }) => ({ root: service.root, label: service.label, enabled }))
      }
    }),
  };
}
export type PortalController = Awaited<ReturnType<typeof createPortalController>>;
