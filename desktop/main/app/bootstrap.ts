import { app, dialog, net, protocol, shell } from 'electron';
import path from 'node:path';
import type { PluginEventTopic } from '../../../plugins/sdk';
import { createDesktopChat } from '../chat/desktop';
import { createDesktopCommands } from '../chat/desktop-commands';
import { AttachmentDownloads } from '../chat/downloads';
import { registerChatIpc } from '../chat/ipc';
import { ChatProxy } from '../chat/proxy';
import { createDesktopHome } from '../home/desktop';
import { HomeService } from '../home/service';
import { downloadFetch } from '../kits/download-fetch';
import { KitInstaller } from '../kits/install';
import { registerKitsIpc } from '../kits/ipc';
import { createDesktopPlugins } from '../plugins/desktop';
import { registerDshIpc } from '../plugins/dsh/ipc';
import { DshPluginManager } from '../plugins/dsh/manager';
import { resolvePluginModel } from '../plugins/dsh/being-model';
import { BackgroundPortal } from '../portal/background';
import { createPortalController } from '../portal/controller';
import { registerPortalIpc } from '../portal/ipc';
import { PortalSupervisor } from '../portal/supervisor';
import { TOWN_ORIGIN, TownClient, TownCredentials, type TownRequestEvent } from '../town/client';
import { registerTownIpc } from '../town/ipc';
import { TownLive } from '../town/live';
import { registerDesktopUpdates } from '../updates/desktop';
import { loadAppearance } from './appearance';
import { loadDesktopConfiguration } from './configuration';
import { createDesktopNotifications } from './desktop-notifications';
import { registerDiagnosticsIpc, startResourceMonitor } from './diagnostics';
import { ClientErrorLog } from './error-log';
import { createTrustedHandler } from './ipc';
import { DesktopLifecycle } from './lifecycle';
import { LocalFilePreviews } from './local-file-preview';
import { MutationQueue } from './mutations';
import { DesktopNotifications } from './notifications';
import { configureLocalSession, registerLocalProtocol } from './protocol';
import { SettingsStore } from './settings';
import { registerShellIpc } from './shell-ipc';
import { installWindowsTaskbarIcons } from './taskbar-icons';
import { bundledNpmCLI, nativeResource } from './resources';
import { createApplicationTray, installApplicationMenu } from './tray';
import { repairDevelopmentShortcut } from './windows-identity';

export interface DesktopOptions {
  userData: string; assets: string; shellURL(): string; development: boolean;
  clientName: string; build: string; updateRepository: string; startedAt: string;
}

/** Composition root: constructs features and supplies their cross-feature callbacks. */
export function createDesktopApplication(options: DesktopOptions) {
  const { userData, shellURL } = options;
  let closePluginSessions = () => { };
  let home: HomeService | undefined;
  let portal: PortalSupervisor;
  let proxy: ChatProxy;
  let store: SettingsStore;
  let background: BackgroundPortal;
  let kitInstaller: KitInstaller;
  let townLive: TownLive;
  let notifications: DesktopNotifications;
  let dshPlugins: DshPluginManager | undefined;
  let cancelTownPairing: (() => void) | undefined;
  let updatePoll: ReturnType<typeof setInterval> | undefined;
  let stopBackgroundPoll = () => { };
  let stopResourceMonitor = () => { };
  const errorLog = new ClientErrorLog(userData, () => [store?.connection?.token || '', store?.connection?.relaySecret || '']);
  const mutations = new MutationQueue();
  const exclusive = mutations.run;
  const cleanupForQuit = async () => {
    await lifecycle.prepareWindowsForQuit();
    await dshPlugins?.shutdown();
    await kitInstaller?.dispose();
    await portal.stop();
    lifecycle.browser?.close();
    home?.dispose();
    await errorLog.flush();
  };
  const resumeAfterFailedShutdown = async () => {
    lifecycle.restoreWindowsAfterFailedQuit();
    try { await dshPlugins?.resumeAfterFailedShutdown(); }
    catch (error) { errorLog.report('plugins-resume-after-shutdown', error); }
  };
  const lifecycle = new DesktopLifecycle({
    clientName: options.clientName, shellURL, errorLog, exclusive,
    canCleanup: () => Boolean(portal), cleanup: cleanupForQuit, resumeAfterFailedShutdown,
    cancelPairing: () => cancelTownPairing?.(), closePluginSessions: () => closePluginSessions(),
    recoverPlugins: () => dshPlugins?.disableAll(), matchesPlugin: pathname => Boolean(dshPlugins?.matches(pathname)),
    finishServices: () => {
      stopBackgroundPoll(); clearInterval(updatePoll); stopResourceMonitor();
      townLive?.dispose(); notifications?.clear(); proxy.abortAll();
    },
  });
  const { showWindow, finishQuit } = lifecycle;

  async function ready() {
    stopResourceMonitor = startResourceMonitor(errorLog);
    if (process.platform === 'win32') {
      try { repairDevelopmentShortcut(app.getPath('appData'), shell); }
      catch (error) { errorLog.report('notification-identity', error); }
    }
    const appearance = await loadAppearance(app.getPath('userData'), () => lifecycle.window);
    installWindowsTaskbarIcons(error => { errorLog.report('taskbar-icon', error); });
    const configuration = await loadDesktopConfiguration(errorLog);
    const { directory, binary, secretStorage, reusePreviousConfig } = configuration;
    let { startupNotice } = configuration;
    store = configuration.store;
    const townCredentials = new TownCredentials(directory, secretStorage);
    let townWarning: string | undefined;
    try { await townCredentials.load(); } catch (error) { townWarning = errorLog.report('town-credentials', error, 'Town 凭据读取失败，请重新连接。'); }
    const desktopNotifications = await createDesktopNotifications({
      directory, store, errorLog,
      development: Boolean(options.development), window: () => lifecycle.window, isQuitting: () => lifecycle.quitting,
      showWindow, townGeneration: () => townLive.state.generation
    });
    notifications = desktopNotifications.service;
    const reportTownRequest = (event: TownRequestEvent) => {
      errorLog.info('town-request', JSON.stringify(event));
      if (event.failure) errorLog.report('town-request', JSON.stringify(event));
    };
    let publishPluginEvent: (topic: PluginEventTopic) => void = () => { };
    let pluginTownGeneration = 0;
    townLive = new TownLive(() => townCredentials.token, () => townCredentials.beingId, state => {
      if (state.generation !== pluginTownGeneration) {
        pluginTownGeneration = state.generation;
        closePluginSessions();
      }
      publishPluginEvent('town.changed');
      desktopNotifications.reset(state);
      if (lifecycle.window && !lifecycle.window.webContents.isDestroyed()) lifecycle.window.webContents.send('beings:town-live', state);
    }, net.fetch.bind(net) as typeof fetch, TOWN_ORIGIN, () => townCredentials.display, target => notifications.receive(target), reportTownRequest);
    const town = new TownClient(() => townCredentials.token, net.fetch.bind(net) as typeof fetch, TOWN_ORIGIN, () => townLive.state.beingId || '', reportTownRequest);
    townLive.restart();
    kitInstaller = new KitInstaller(downloadFetch);
    portal = new PortalSupervisor(directory);
    portal.on('log', line => errorLog.info('portal-output', line));
    background = new BackgroundPortal(directory);
    try { await background.discover(store.settings, store.connection); }
    catch (error) {
      startupNotice = errorLog.report('background-discovery', error, '后台 Portal 状态读取失败，请稍后重试。');
      portal.state = { phase: 'error', message: startupNotice, logs: [] };
    }
    if (!background.state.supported) store.settings.backgroundEnabled = false;
    const chat = await createDesktopChat({ directory, store, portal, background, errorLog });
    proxy = chat.proxy;
    const chatSessions = chat.sessions;
    const assets = options.assets;
    const desktopPlugins = createDesktopPlugins({
      directory, store, proxy, town, townLive, shellURL,
      window: () => lifecycle.window, appearance: () => appearance.current, currentScene: chat.currentScene,
      tasks: () => chatIpc.taskSnapshot()
    });
    const plugins = desktopPlugins.registry;
    closePluginSessions = desktopPlugins.close;
    publishPluginEvent = desktopPlugins.publish;
    const attachmentDownloads = new AttachmentDownloads(directory, async current => {
      const result = await dialog.showOpenDialog(lifecycle.window!, { title: '下载设置 · 选择保存位置', message: '所有附件将保存到此位置。可在客户端设置 → 通用 → 下载中更改。', defaultPath: current || app.getPath('downloads'), properties: ['openDirectory', 'createDirectory'] });
      return result.canceled ? undefined : result.filePaths[0];
    }, file => shell.openPath(file), file => shell.showItemInFolder(file));
    const localFiles = new LocalFilePreviews(() => store.settings.workspace);
    dshPlugins = new DshPluginManager(path.join(directory, 'third-party-plugins'), path.join(assets, 'dsh-plugin-host.cjs'), bundledNpmCLI(), new URL(shellURL()).origin, nativeResource('node-bin'));
    dshPlugins.openClient = showWindow;
    dshPlugins.resolveModel = () => resolvePluginModel(directory, store.settings, !!store.connection, request => proxy.handle(request));
    dshPlugins.onModelNotice = message => lifecycle.window?.webContents.send('beings:dsh-model-notice', message);
    // Plugin host startup must not delay the native window or Town's own IPC.
    // Its state endpoint waits for initialization, and mutations share its queue.
    void dshPlugins.initialize();
    if (options.development) {
      // Keep plugin URLs same-origin in development, just as in the packaged app.
      // A redirect to beings: breaks fetch/CSS and iframe-relative resources.
      protocol.handle(new URL(shellURL()).protocol.slice(0, -1), request => {
        const url = new URL(request.url);
        if (url.origin === new URL(shellURL()).origin && dshPlugins?.matches(url.pathname)) return dshPlugins.resource(request);
        return net.fetch(request, { bypassCustomProtocolHandlers: true });
      });
    }
    registerLocalProtocol(assets, proxy, plugins, attachmentDownloads, localFiles, dshPlugins);
    configureLocalSession(shellURL, () => notifications.state.supported && notifications.state.preferences.enabled);
    const commands = await createDesktopCommands({ directory, store, plugins, chatSessions, errorLog, shellURL, window: () => lifecycle.window });
    const { approvalDialogs } = commands;
    startupNotice = commands.startupNotice || startupNotice;
    const portalController = await createPortalController({
      directory, binary, store, portal, background,
      errorLog, mutations, proxy, startupNotice, window: () => lifecycle.window, isQuitting: () => lifecycle.quitting,
      reusePreviousConfig, connectionChanged: () => home?.contextChanged(),
      cleanup: cleanupForQuit, quit: finishQuit, resumeAfterFailedShutdown
    });
    lifecycle.setInstallerShutdown(portalController.shutdown);
    const handle = createTrustedHandler({
      window: () => lifecycle.window, shellURL, isQuitting: () => lifecycle.quitting,
      recoveryBlocked: () => portalController.recoveryBlocked, errorLog
    });
    home = await createDesktopHome({ directory, assets, secretStorage, store, window: () => lifecycle.window, handle });
    registerShellIpc({
      handle, exclusive, directory, store, localFiles, attachmentDownloads, approvalDialogs,
      window: () => lifecycle.window, browser: () => lifecycle.browser
    });
    desktopNotifications.registerIpc(handle, exclusive);
    registerDiagnosticsIpc({
      handle, directory, store, portal, background, townLive, townCredentials,
      secretStorage, errorLog, startedAt: options.startedAt, get build() { return options.build; }, clientName: options.clientName,
      window: () => lifecycle.window, lifecycleError: () => lifecycle.error,
      upgrade: portalController.diagnostics,
    });
    const updates = registerDesktopUpdates({
      handle, exclusive, directory, repository: options.updateRepository,
      errorLog, window: () => lifecycle.window, isQuitting: () => lifecycle.quitting, shutdown: portalController.shutdown
    });

    const snapshot = chat.registerSessions(handle, exclusive, () => portalController.notice, () => closePluginSessions());
    registerPortalIpc({
      handle, exclusive, controller: portalController, snapshot,
      beforeSave: () => { cancelTownPairing?.(); approvalDialogs.cancel(); },
      afterSave: async () => {
        closePluginSessions(); proxy.abortAll();
        await dshPlugins?.whenReady();
        await dshPlugins?.refreshModelCompatibility();
      }
    });
    appearance.registerIpc(handle, exclusive, theme => desktopPlugins.windows.updateTheme(theme));
    cancelTownPairing = registerTownIpc({
      handle, exclusive, town, townLive, townCredentials, store, secretStorage,
      fetcher: net.fetch.bind(net) as typeof fetch,
      getWarning: () => townWarning,
      clearWarning: () => { townWarning = undefined; },
      open: url => lifecycle.browser?.open(url),
    });
    registerKitsIpc({ handle, exclusive, window: () => lifecycle.window, store, kitInstaller });
    desktopPlugins.registerIpc(handle, exclusive);
    registerDshIpc(handle, dshPlugins!, () => lifecycle.window);
    const chatIpc = registerChatIpc({
      handle, directory, store, portal, proxy, chatSessions,
      window: () => lifecycle.window, publishPluginEvent: topic => publishPluginEvent(topic)
    });
    installApplicationMenu(showWindow, () => {
      showWindow();
      void updates.check();
    });
    lifecycle.tray = createApplicationTray(showWindow);
    lifecycle.openWhenReady();
    await exclusive(() => portalController.restoreStartup());
    stopBackgroundPoll = portalController.startPolling();
    if (app.isPackaged && !process.env.PORTAL_DESKTOP_USER_DATA) {
      void updates.check();
      updatePoll = setInterval(() => { void updates.check(); }, 6 * 60 * 60 * 1000);
      updatePoll.unref();
    }

  }
  return { errorLog, start: () => lifecycle.start(ready) };
}
