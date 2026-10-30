import { LocalFilePreviews } from './app/local-file-preview';
import { withScenePortal } from './chat/scene-portal';
import {AttachmentDownloads} from './chat/downloads';
import { subagentReady } from './portal/subagent-ready';
import { SceneTaskObserver } from './portal/subagent-tasks';
import { setupSubagent, validateSubagentSetup, readSubagentConfig, setSubagentEnabled } from './portal/subagent-setup';
import { ClientCommandServer } from './chat/client-server';
import { ToolApproval } from './chat/tool-approval';
import { ApprovalDialogs } from './chat/approval-dialogs';
import { permissionMode } from '../shared/security';
import { ClientContextReader } from './chat/client-context';
import { app, clipboard, dialog, ipcMain, net, nativeImage, nativeTheme, Notification, protocol, safeStorage, shell, type BrowserWindow, type Tray } from 'electron';
import { DesktopNotifications } from './app/notifications';
import { repairDevelopmentShortcut, updateNotificationShortcutIcon, windowsAppId } from './app/windows-identity';
import { brandingPath, notificationIcon } from './app/branding';
import { installWindowsTaskbarIcons } from './app/taskbar-icons';
import { systemUsesDarkColors, watchSystemTheme } from './app/system-theme';
import { clientStartup } from './app/startup';
import { clientUserData } from './app/profile';
import type { ClientBrowser } from './browser/browser';
import { createMainWindow } from './app/window';
import { LocalApps } from './app/local-apps';
import { editChat } from './app/context-menu';
import { configureLocalSession, registerLocalProtocol } from './app/protocol';
import { createApplicationTray, installApplicationMenu } from './app/tray';
import path from 'node:path';
import os from 'node:os';
import { access, mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { SettingsStore } from './app/settings';
import { ClientErrorLog } from './app/error-log';
import { BackgroundPoll } from './app/background-poll';
import { createLogArchive } from './app/log-archive';
import { portalLogText } from './portal/diagnostics';
import { PortalSupervisor } from './portal/supervisor';
import { ExternalPortalObserver } from './portal/external';
import { OrphanPortalRecovery } from './portal/orphan';
import { PortalTakeover } from './portal/takeover';
import { WindowsForcePortal } from './portal/windows-force';
import { RuntimeUpdater, RuntimeRollbackError, loadRuntimeBundle, restoreRuntimeMode, type RuntimeUpdateResult } from './updates/runtime';
import { UpdateChecker } from './updates/checker';
import { ClientInstall } from './updates/client-install';
import { stageInstaller } from './updates/manual-installer';
import { installerEvent, installerTarget, handleInstallerEvent } from './updates/installer-events';
import { BackgroundPortal } from './portal/background';
import { KitInstaller } from './kits/install';
import { ChatProxy } from './chat/proxy';
import { RecentChatHistory } from './chat/recent-history';
import { ModelProfileStore, applyRememberedModelConfig, listModelProfiles, sanitizeModelConfigResult } from './chat/model-profiles';
import { loadDesktopScene, ChatSessions } from './chat/scene';
import { verifyBeingConnection } from './chat/ready';
import { redact } from './chat/connection';
import type { ChatScene, NotificationTarget, SaveSettings } from '../shared/types';
import { TownLive } from './town/live';
import { TownClient, TownCredentials, TOWN_ORIGIN, type TownRequestEvent } from './town/client';
import { registerTownIpc } from './town/ipc';
import { registerKitsIpc } from './kits/ipc';
import { downloadFetch } from './kits/download-fetch';
import { PluginWindows } from './plugins/windows';
import { PluginRegistry } from './plugins/registry';
import { registerPluginsIpc } from './plugins/ipc';
import { createPluginServices } from './plugins/services';
import { PluginWorkspace } from './plugins/workspace';
import type { PluginEventTopic } from '../../plugins/sdk';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;
declare const PORTAL_DESKTOP_UPDATE_REPOSITORY: string;
declare const PORTAL_DESKTOP_BUILD: string;
const startedAt = new Date().toISOString();
const CLIENT_NAME = 'Portal Desktop';
const CLIENT_ID = 'portal-desktop';

protocol.registerSchemesAsPrivileged([{ scheme: 'beings', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
// Electron uses its internal name for encrypted storage. Keep that identity
// stable while the bundle, windows, menus and dialogs use the display name.
let profileError: unknown;
let userData: string;
try {
  app.setName(CLIENT_ID);
  if (process.platform === 'win32') app.setAppUserModelId(windowsAppId(app.isPackaged));
  app.setAboutPanelOptions({ applicationName: CLIENT_NAME });
  userData = clientUserData(() => app.getPath('appData'), process.env.PORTAL_DESKTOP_USER_DATA);
  app.setPath('userData', userData);
  app.setPath('sessionData', userData);
} catch (error) {
  profileError = error;
  // This directory only receives startup diagnostics; never start a fresh
  // client profile when the real profile cannot be resolved.
  userData = path.join(os.tmpdir(), 'portal-desktop-startup');
}
let window: BrowserWindow | null = null;
let closePluginSessions = () => {};
let windowReady = false;
let browser: ClientBrowser | undefined;
let portal: PortalSupervisor;
let proxy: ChatProxy;
let store: SettingsStore;
let background: BackgroundPortal;
let kitInstaller: KitInstaller;
let townLive: TownLive;
let notifications: DesktopNotifications;
let cancelTownPairing: (() => void) | undefined;
let updatePoll: ReturnType<typeof setInterval> | undefined;
let backgroundPoll: ReturnType<typeof setInterval> | undefined;
let resourcePoll: ReturnType<typeof setInterval> | undefined;
let quitting = false;
let quitCleanupDone = false;
let sessionEnding = false;
let tray: Tray | undefined;
let lifecycleError = '';
const errorLog = new ClientErrorLog(userData, () => [store?.connection?.token || '', store?.connection?.relaySecret || '']);
let mutation = Promise.resolve();
let pendingMutations = 0;
let prepareInstallerShutdown: ((target: string) => void) | undefined;
let pendingInstallerTarget: string | undefined;
const exclusive = <T>(operation: () => Promise<T>): Promise<T> => {
  pendingMutations++;
  const next = mutation.then(operation).finally(() => { pendingMutations--; });
  mutation = next.then(() => {}, () => {});
  return next;
};
async function cleanupForQuit() {
  await kitInstaller?.dispose();
  await portal.stop();
  browser?.close();
  await errorLog.flush();
}
function finishQuit() {
  clearInterval(backgroundPoll); clearInterval(updatePoll);
  clearInterval(resourcePoll);
  townLive?.dispose(); notifications?.clear(); proxy.abortAll();
  // Installer shutdown reaches here directly, without the normal before-quit
  // handler. Let the window close instead of cancelling quit and hiding it.
  quitting = true;
  cancelTownPairing?.();
  quitCleanupDone = true; tray?.destroy(); app.quit();
}
const shellURL = () => new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL || 'beings://desktop/').href;

async function openExternal(url: string) {
  try {
    const parsed = new URL(url);
    if (['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password) browser?.open(url);
  } catch { /* Unsupported links stay inside the sandbox. */ }
}
function showWindow() {
  // A second launch can arrive while credentials/background discovery await IO.
  // Do not load beings:// before the protocol and trusted IPC are registered.
  if (quitting || !windowReady) return;
  if (!window) { createWindow(); return; }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
function createWindow() {
  if (!windowReady || quitting || (window && !window.isDestroyed())) return;
  const created = createMainWindow({
    shellURL,
    isQuitting: () => quitting,
    isSessionEnding: () => sessionEnding,
    markSessionEnding: () => { sessionEnding = true; },
    openExternal: url => { void openExternal(url); },
    onBrowser: value => { browser = value; },
    onClosed: value => { if (window === value) window = null; },
  });
  window = created.window;
  browser = created.browser;
  errorLog.info('client-window', '主窗口已创建');
  window.webContents.on('console-message', (_event, level, message) => {
    errorLog.info(`renderer-${level}`, message);
  });
  window.webContents.on('did-start-navigation', (_event, _url, inPlace, isMainFrame) => { if (isMainFrame && !inPlace) closePluginSessions(); });
  window.webContents.on('render-process-gone', (_event, details) => {
    errorLog.report('renderer-gone', JSON.stringify(details));
    closePluginSessions();
  });
  window.on('unresponsive', () => errorLog.report('window-unresponsive', '主窗口无响应'));
  window.on('responsive', () => errorLog.info('window-responsive', '主窗口已恢复响应'));
  window.webContents.on('destroyed', () => closePluginSessions());
}

async function ready() {
  errorLog.info('client-start', `version=${app.getVersion()} platform=${process.platform}/${process.arch} pid=${process.pid}`);
  app.on('child-process-gone', (_event, details) => errorLog.report('child-process-gone', JSON.stringify(details)));
  const sampleResources = () => {
    try {
      errorLog.info('client-resources', JSON.stringify({
        system: { totalBytes: os.totalmem(), freeBytes: os.freemem() },
        main: process.memoryUsage(),
        processes: app.getAppMetrics().map(({ pid, type, cpu, memory }) => ({ pid, type, cpu, memory })),
      }));
    } catch (error) { errorLog.report('resource-sample', error); }
  };
  sampleResources();
  resourcePoll = setInterval(sampleResources, 60_000);
  resourcePoll.unref();
  if (process.platform === 'win32') {
    try { repairDevelopmentShortcut(app.getPath('appData'), shell); }
    catch (error) { errorLog.report('notification-identity', error); }
  }
  let appearance: 'light' | 'dark' = 'light';
  try { const saved = JSON.parse(await readFile(path.join(app.getPath('userData'), 'appearance.json'), 'utf8')); if (saved.theme === 'dark') appearance = 'dark'; } catch { /* First launch uses the light workspace. */ }
  nativeTheme.themeSource = appearance;
  installWindowsTaskbarIcons(error => { errorLog.report('taskbar-icon', error); });
  const directory = app.getPath('userData');
  const binary = app.isPackaged
    ? path.join(process.resourcesPath, process.platform === 'win32' ? 'heart-portal.exe' : 'heart-portal')
    : path.resolve('resources', process.platform === 'win32' ? 'heart-portal.exe' : 'heart-portal');
  const secretStorage = {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
    encryptString: (value: string) => safeStorage.encryptString(value), decryptString: (value: Buffer) => safeStorage.decryptString(value),
  };
  store = new SettingsStore(directory, secretStorage, binary);
  let startupNotice: string | undefined;
  try { await store.load(); }
  catch (error) { startupNotice = errorLog.report('settings-load', error, '连接配置读取失败，请检查密钥库或连接设置。'); }
  const modelProfiles = new ModelProfileStore(directory, secretStorage);
  try { await modelProfiles.load(); }
  catch (error) {
    errorLog.report('model-profiles-load', error, '模型档案读取失败，请检查本地档案文件。');
  }
  let configCandidates: string[] = [];
  const reusePreviousConfig = async () => {
    await store.reusePortalConfig(configCandidates);
    if (store.connection && store.settings.portalConfigPath) await store.save(store.settings);
  };
  try {
    const savedService = JSON.parse(await readFile(path.join(directory, 'portal-service.json'), 'utf8').catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'null';
      throw error;
    }));
    if (savedService && (savedService.existing || savedService.kind || savedService.label !== new BackgroundPortal(directory).label)) {
      configCandidates.push(savedService.configPath || path.join(savedService.root, 'portal.toml'));
    }
    // An explicitly selected profile is independent (including test profiles).
    // Its own saved service can still migrate, but it must not import the user's
    // global Being connection or workspace just because it is initially empty.
    if (!store.connection && !process.env.PORTAL_DESKTOP_USER_DATA) configCandidates.push(path.join(os.homedir(), '.heart-portal/portal.toml'), path.join(os.homedir(), '.heart-portal/runtime/portal.toml'));
    await reusePreviousConfig();
  } catch (error) { startupNotice = errorLog.report('portal-config-import', error, '已有 Portal 配置读取失败，请检查后重试。'); }
  const townCredentials = new TownCredentials(directory, secretStorage);
  let townWarning: string | undefined;
  try { await townCredentials.load(); } catch (error) { townWarning = errorLog.report('town-credentials', error, 'Town 凭据读取失败，请重新连接。'); }
  let pendingNotification: { target: NotificationTarget; generation: number } | undefined;
  let notificationDark = await systemUsesDarkColors();
  const updateNotificationIcon = () => {
    if (process.platform !== 'win32' || !app.isPackaged) return;
    try { updateNotificationShortcutIcon(app.getPath('appData'), process.execPath,
      brandingPath(notificationDark ? 'logo-white.ico' : 'logo-black.ico'), shell); }
    catch (error) { errorLog.report('notification-icon', error); }
  };
  updateNotificationIcon();
  const stopNotificationTheme = watchSystemTheme(dark => { notificationDark = dark; updateNotificationIcon(); });
  app.once('will-quit', stopNotificationTheme);
  notifications = new DesktopNotifications(directory, {
    supported: () => Notification.isSupported(),
    focused: () => quitting || Boolean(window && !window.isDestroyed() && window.isVisible() && window.isFocused()),
    create: content => {
      const notification = new Notification({ ...content, icon: nativeImage.createFromPath(notificationIcon(notificationDark)) });
      // Electron may create its notification shortcut lazily in the constructor.
      updateNotificationIcon();
      return notification;
    },
    open: target => {
      if (quitting) return;
      pendingNotification = { target, generation: townLive.state.generation };
      showWindow();
      window?.webContents.send('beings:notification-open');
    },
  });
  await notifications.load();
  const reportTownRequest = (event: TownRequestEvent) => {
    errorLog.info('town-request', JSON.stringify(event));
    if (event.failure) errorLog.report('town-request', JSON.stringify(event));
  };
  let publishPluginEvent: (topic: PluginEventTopic) => void = () => {};
  let pluginTownGeneration = 0;
  townLive = new TownLive(() => townCredentials.token, () => townCredentials.beingId, state => {
    if (state.generation !== pluginTownGeneration) {
      pluginTownGeneration = state.generation;
      closePluginSessions();
    }
    publishPluginEvent('town.changed');
    notifications.reset(state.generation);
    if (state.phase === 'auth-error' || state.phase === 'unpaired') { notifications.clear(); pendingNotification = undefined; }
    if (window && !window.webContents.isDestroyed()) window.webContents.send('beings:town-live', state);
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
  let chatScene: ChatScene | undefined;
  let chatSceneNotice: string | undefined;
  let chatSessions: ChatSessions | undefined;
  try {
    chatScene = await loadDesktopScene(directory, app.getVersion(), os.hostname());
    const sessions = new ChatSessions(directory, chatScene);
    await sessions.load();
    chatSessions = sessions;
  }
  catch { chatSceneNotice = '桌面场景标识未能读取或保存，暂时无法发送消息。请检查客户端配置目录后重启。'; }
  const sceneWithPortal = (scene: ChatScene | undefined) => withScenePortal(scene, portal.state, store.connection?.endpoint);
  proxy = new ChatProxy(() => store.connection, (url, init) => init?.body instanceof ReadableStream ? fetch(url, init) : net.fetch(url as string, init), () => sceneWithPortal(chatSessions?.current(store.connection?.endpoint) || chatScene), id => sceneWithPortal(chatSessions?.list(store.connection?.endpoint).find(scene => scene.scene_id === id)), true);
  const assets = app.isPackaged ? path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`) : path.resolve('desktop/generated');
  const currentPluginScene = () => chatSessions?.current(store.connection?.endpoint) || chatScene;
  const pluginContextKey = () => JSON.stringify([store.connection?.endpoint, store.connection?.token, townLive.state.generation, currentPluginScene()]);
  const pluginWorkspace = new PluginWorkspace(() => ({ key: pluginContextKey(), endpoint: store.connection?.endpoint || '', sceneId: currentPluginScene()?.scene_id || '', townGeneration: townLive.state.generation }), () => publishPluginEvent('workspace.changed'));
  let pluginWindows: PluginWindows | undefined;
  const plugins = new PluginRegistry(path.join(directory, 'plugins'), createPluginServices({
    contextKey: pluginContextKey,
    openExternal: url => shell.openExternal(url, { activate: true }),
    fetcher: globalThis.fetch,
    workspace: manifest => pluginWorkspace.read(manifest),
    tasks: () => taskSnapshotFromObserver(),
    being: () => ({ connected: Boolean(store.connection), name: store.settings.being, sceneId: currentPluginScene()?.scene_id || '', sceneLabel: currentPluginScene()?.scene_meta.scene_label || '' }),
    endpoint: () => store.connection?.endpoint || '',
    town: (query, signal) => town.query(query, undefined, signal), proxy,
    confirmChat: async (name, being, message) => {
      if (!window) return false;
      return (await dialog.showMessageBox(window, { type: 'question', title: '插件发起 Being 对话',
        message: `${name} 请求向 ${being.name} 发送消息`, detail: `场景：${being.sceneLabel}\n\n${message}`,
        buttons: ['取消', '发送'], defaultId: 0, cancelId: 0 })).response === 1;
    },
  }), event => { pluginWindows?.emit(event); if (window && !window.webContents.isDestroyed()) window.webContents.send('beings:plugin-event', event); });
  pluginWindows = new PluginWindows(plugins, shellURL, () => window, () => appearance);
  closePluginSessions = () => { pluginWindows?.close(); plugins.invalidate(); };
  app.once('before-quit', () => pluginWindows?.close());
  publishPluginEvent = topic => plugins.publish(topic);
  const attachmentDownloads=new AttachmentDownloads(directory,async current => {
    const result=await dialog.showOpenDialog(window!,{title:'下载设置 · 选择保存位置',message:'所有附件将保存到此位置。可在客户端设置 → 通用 → 下载中更改。',defaultPath:current || app.getPath('downloads'),properties:['openDirectory','createDirectory']});
    return result.canceled ? undefined : result.filePaths[0];
  },file=>shell.openPath(file),file=>shell.showItemInFolder(file));
  const localFiles = new LocalFilePreviews(() => store.settings.workspace);
  registerLocalProtocol(assets, proxy, plugins, attachmentDownloads, localFiles);
  configureLocalSession();
  const clientContext = new ClientContextReader(shellURL());
  const approvalDialogs = new ApprovalDialogs(request => {
    if (window && !window.isDestroyed()) window.webContents.send('beings:tool-approval', request);
  });
  app.once('before-quit', () => approvalDialogs.cancel());
  const toolApproval = new ToolApproval(() => permissionMode(store.settings.permissionMode), async input => {
    if (!window || window.isDestroyed()) return false;
    window.show();
    return approvalDialogs.request(input);
  });
  const clientCommands = new ClientCommandServer(path.join(directory, '.portal-client.json'),
    () => store.connection?.endpoint, (request, signal) => request.verb === 'security-approve'
      ? toolApproval.request(request, signal)
      : request.verb === 'plugins'
      ? plugins.agentCommand(request.endpoint, request.args, request.sceneId)
      : clientContext.execute({ ...request, scenes: chatSessions?.list(request.endpoint) }));
  try { await clientCommands.start(); }
  catch (error) { startupNotice = errorLog.report('client-commands', error, '场景历史服务启动失败。'); }
  app.once('will-quit', () => { clientContext.close(); void clientCommands.close().catch(error => errorLog.report('client-commands-close', error)); });
  let recoveryBlocked = false;
  const clientInstall = new ClientInstall(directory, background);
  let installIntent = await clientInstall.read();
  const finishClientInstall = async () => { await clientInstall.finish(); installIntent = null; };
  prepareInstallerShutdown = target => {
    void exclusive(async () => {
      if (quitting) return;
      try {
        recoveryBlocked = true;
        await clientInstall.shutdown(app.getVersion(), target, store.connection, portal.managing, {
          cleanup: cleanupForQuit, quit: finishQuit,
          startForeground: async () => { if (store.connection) await portal.start(store.settings, store.connection); },
        });
      } catch (error) {
        recoveryBlocked = Boolean(await clientInstall.read());
        throw error;
      }
    }).catch(error => {
      if (window && !window.isDestroyed()) void dialog.showMessageBox(window, {
        type: 'error', title: '无法开始安装', message: errorLog.report('installer-start', error, '安装准备失败，请查看日志后重试。'),
        detail: '旧客户端和 Portal 保持运行。请处理后重新启动安装包。', buttons: ['知道了'],
      });
    });
  };
  if (pendingInstallerTarget) {
    const target = pendingInstallerTarget;
    pendingInstallerTarget = undefined;
    prepareInstallerShutdown(target);
  }
  let startupDeferred = false;
  // Only the trusted top-level local shell can control local capabilities.
  const handle = (channel: string, callback: (...args: any[]) => unknown) => {
    ipcMain.handle(channel, async (event, ...args) => {
      const frame = event.senderFrame;
      if (!window || event.sender !== window.webContents || frame !== window.webContents.mainFrame || frame.url !== shellURL()) throw new Error('Untrusted IPC sender');
      if (quitting && !['beings:browser-bounds', 'beings:diagnostics'].includes(channel)) throw new Error('客户端正在退出，请稍候。');
      if (recoveryBlocked && ['beings:save', 'beings:portal-start', 'beings:portal-stop', 'beings:portal-restart', 'beings:portal-force-start'].includes(channel)) throw new Error('Portal 升级恢复尚未完成，请重新启动客户端完成恢复。');
      try { return await callback(...args); }
      catch (error) { throw new Error(errorLog.report(channel, error)); }
    });
  };
  handle('beings:local-file-preview', (reference: unknown) => localFiles.preview(reference));
  handle('beings:tool-approval-pending', () => approvalDialogs.current());
  handle('beings:tool-approval-answer', (id: unknown, allowed: unknown) => approvalDialogs.answer(id, allowed));
  handle('beings:local-files-check', (references: unknown) => localFiles.available(references));
  handle('beings:local-file-reveal', (reference: unknown) => localFiles.reveal(reference, file => shell.showItemInFolder(file)));
  handle('beings:local-file-release', (id: unknown) => localFiles.release(id));
  handle('beings:download-directory', (change: boolean) => attachmentDownloads.downloadDirectory(change === true));
  handle('beings:attachment-source', (filename: string) => attachmentDownloads.registerSource(filename));
  handle('beings:plugins-window-open', (id, view, command) => pluginWindows!.open(id, view, command));
  handle('beings:plugins-host-reply', (id, value, error) => pluginWindows!.reply(id, value, error));
  handle('beings:client-startup', (enabled?: boolean) => clientStartup(app, process.platform, process.execPath, enabled));
  const localApps = new LocalApps(path.join(directory, 'local-apps.json'));
  handle('beings:local-apps', () => localApps.list());
  handle('beings:associate-app', (entry: unknown) => exclusive(async () => {
    const selection = await dialog.showOpenDialog(window!, { title: '关联已安装的 App', properties: ['openFile'],
      ...(process.platform === 'win32' ? { filters: [{ name: '应用程序', extensions: ['exe'] }] } : {}) });
    if (selection.canceled || !selection.filePaths[0]) return false;
    await localApps.associate(entry, selection.filePaths[0]); return true;
  }));
  handle('beings:unlink-app', (id: string) => exclusive(() => localApps.remove(id)));
  handle('beings:notifications', (patch?: unknown) => exclusive(async () => {
    const state = patch === undefined ? notifications.state : await notifications.save(patch);
    if (pendingNotification && (!state.preferences.enabled || !state.preferences[pendingNotification.target.channel])) pendingNotification = undefined;
    return state;
  }));
  if (!app.isPackaged && MAIN_WINDOW_VITE_DEV_SERVER_URL)
    handle('beings:notification-test', () => notifications.test());
  handle('beings:scene-notification', (endpoint: unknown, activity: unknown) => {
    if (typeof endpoint !== 'string' || endpoint !== store.connection?.endpoint || !activity || typeof activity !== 'object' || Array.isArray(activity)) return;
    const entries = Object.entries(activity);
    const allowed = new Set(['queued','thinking','replying','working','waiting','reconnecting','timeout','done','error','stopped']);
    if (entries.length > 500 || !entries.every(([id,status]) => id.length > 0 && id.length <= 256 && typeof status === 'string' && allowed.has(status))) return;
    notifications.receiveSceneActivity(endpoint, activity as Record<string, import('../shared/types').ChatSceneActivity>);
  });
  handle('beings:notification-target', () => {
    const pending = pendingNotification;
    pendingNotification = undefined;
    if (pending?.target.channel === 'scenes' && pending.target.endpoint !== store.connection?.endpoint) return null;
    return pending?.generation === townLive.state.generation ? pending.target : null;
  });
  handle('beings:quit', () => { setImmediate(() => app.quit()); });
  handle('beings:browser-state', () => browser?.state);
  handle('beings:browser-open', (url?: string) => browser?.open(url));
  handle('beings:chat-edit', (command: import('../shared/types').ChatEditCommand) => editChat(window, command));
  handle('beings:selection-edit', (command: import('../shared/types').ChatEditCommand) => editChat(window, command, 'shell'));
  handle('beings:clipboard-copy', (text: string) => {
    if (typeof text !== 'string' || text.length > 200000) throw new Error('复制内容过长。');
    clipboard.writeText(text);
  });
  handle('beings:browser-action', (action: import('../shared/types').BrowserAction) => browser?.action(action));
  handle('beings:browser-bounds', (bounds: import('../shared/types').BrowserBounds) => browser?.setBounds(bounds));
  const diagnose = async (): Promise<import('../shared/types').DiagnosticReport> => {
    const connection = store.connection;
    const checks: import('../shared/types').DiagnosticReport['checks'] = [];
    checks.push({ name: '客户端', status: 'ok', detail: `主进程 ${process.pid} · 关闭窗口保留运行，退出客户端结束进程` });
    if (lifecycleError) checks.push({ name: '上次退出', status: 'error', detail: lifecycleError });
    checks.push({ name: '凭据保护', status: secretStorage.isEncryptionAvailable() ? 'ok' : 'error', detail: secretStorage.isEncryptionAvailable() ? '系统密钥库可用' : '系统密钥库不可用' });
    try { await access(store.settings.workspace); checks.push({ name: '工作目录', status: 'ok', detail: '目录可访问' }); }
    catch { checks.push({ name: '工作目录', status: 'warning', detail: '目录尚未创建或不可访问' }); }
    try { await verifyBeingConnection(connection, net.fetch.bind(net) as typeof fetch); checks.push({ name: 'Being', status: 'ok', detail: '现有状态接口可访问；未发送消息或调用工具' }); }
    catch (error) { checks.push({ name: 'Being', status: 'warning', detail: errorLog.report('being-diagnostics', error, 'Being 连接检查失败，请稍后重试。') }); }
    if (connection !== store.connection) throw new Error('连接已切换，请重新检查。');
    checks.push({ name: 'Portal', status: portal.state.phase === 'connected' ? 'ok' : portal.state.phase === 'error' ? 'error' : 'warning', detail: portal.state.message });
    checks.push({ name: 'Town', status: townLive.state.phase === 'connected' ? 'ok' : 'warning', detail: townLive.state.message });
    return { version: app.getVersion(), build: PORTAL_DESKTOP_BUILD, platform: `${process.platform}/${process.arch}`, pid: process.pid, startedAt, checkedAt: new Date().toISOString(), checks,
      logs: portal.state.logs.slice(-60).map(line => redact(line, [connection?.token || '', connection?.relaySecret || '']).replaceAll(os.homedir(), '~')) };
  };
  handle('beings:diagnostics', diagnose);
  const capturePortalLogs = async () => {
    const state = { ...portal.state, logs: [...portal.state.logs] };
    await errorLog.exportSnapshot(state.logs, { version: app.getVersion(), platform: `${process.platform}/${process.arch}`,
      capturedAt: new Date().toISOString(), workspace: store.settings.workspace,
      portal: { ...state, logs: undefined }, background: background.state,
      runtimeDirectory: background.installedService?.root || directory });
    return { state, errors: await errorLog.recentText() };
  };
  handle('beings:portal-log-reference', async () => {
    const connection = store.connection;
    if (!connection) throw new Error('请先连接 Being。');
    const { state, errors } = await capturePortalLogs();
    if (connection !== store.connection) throw new Error('连接已切换，请重新选择 Portal 日志。');
    return { endpoint: connection.endpoint, text: portalLogText({ version: app.getVersion(),
      platform: `${process.platform}/${process.arch}`, portal: state, errors, home: os.homedir(),
      secrets: [connection.token, connection.relaySecret] }) };
  });
  handle('beings:logs', async () => {
    await capturePortalLogs();
    const error = await shell.openPath(errorLog.directory);
    if (error) throw new Error(error);
  });
  let collectingLogs: Promise<string> | undefined;
  handle('beings:collect-logs', () => {
    if (!collectingLogs) collectingLogs = (async () => {
      const secrets = [store.connection?.token || '', store.connection?.relaySecret || '', townCredentials.token];
      const runtimeDirectories = [background.installedService?.root || '', portal.state.runtimePath || '', directory];
      await capturePortalLogs();
      const file = await createLogArchive({ logsDirectory: errorLog.directory, runtimeDirectories,
        destination: app.getPath('downloads'), secrets });
      shell.showItemInFolder(file);
      return file;
    })().finally(() => { collectingLogs = undefined; });
    return collectingLogs;
  });
  handle('beings:diagnostics-export', async () => {
    const report = await diagnose();
    const result = await dialog.showSaveDialog(window!, { title: '导出诊断', defaultPath: `${CLIENT_NAME}-diagnostics-${new Date().toISOString().slice(0,10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return false;
    // Export status only: engine output can contain user task data even when credentials are redacted.
    await writeFile(result.filePath, JSON.stringify({ ...report, logs: undefined }, null, 2), { mode: 0o600 });
    return true;
  });
  let runtimeUpdate: RuntimeUpdateResult = { phase: 'current', message: 'Portal 升级状态将在启动检查后显示。' };
  const updates = new UpdateChecker(app.getVersion(), PORTAL_DESKTOP_UPDATE_REPOSITORY, net.fetch.bind(net) as typeof fetch,
    state => { if (window && !window.isDestroyed()) window.webContents.send('beings:update-state', state); },
    process.platform, process.arch, error => { errorLog.report('update-check', error); });
  let updateDownload: AbortController | undefined;
  let updateHandoff: Awaited<ReturnType<typeof stageInstaller>> | undefined;
  const downloadUpdate = async () => {
    if (updateDownload || updateHandoff || updates.state.activity) return;
    if (!app.isPackaged) throw new Error('开发版本不能下载安装更新。');
    const state = updates.state.phase === 'available' ? updates.state : await updates.check();
    if (state.phase !== 'available' || !state.latestVersion) throw new Error('当前没有可下载的客户端更新。');
    const controller = new AbortController();
    updateDownload = controller;
    updates.setActivity({ phase: 'metadata', version: state.latestVersion });
    window?.setProgressBar(2);
    let lastProgress = 0;
    try {
      updateHandoff = await stageInstaller(directory, state.latestVersion, PORTAL_DESKTOP_UPDATE_REPOSITORY, process.execPath, net.fetch.bind(net) as typeof fetch, {
        signal: controller.signal,
        onProgress: progress => {
          const now = Date.now();
          if (progress.phase === 'downloading' && progress.received && progress.received !== progress.total && now - lastProgress < 200) return;
          lastProgress = now;
          updates.setActivity({ ...progress, version: state.latestVersion! });
          window?.setProgressBar(progress.phase === 'downloading' && progress.total ? Math.min(1, (progress.received || 0) / progress.total) : 2);
        },
      });
      if (!window || quitting) {
        await updateHandoff.discard();
        updateHandoff = undefined;
        updates.setActivity();
        return;
      }
      updates.setActivity({ phase: 'ready', version: state.latestVersion });
    } catch (error) {
      if (controller.signal.aborted) {
        updates.setActivity();
        return;
      }
      updates.setActivity();
      throw error;
    } finally {
      updateDownload = undefined;
      window?.setProgressBar(-1);
    }
  };
  const installUpdate = async () => {
    const handoff = updateHandoff;
    const activity = updates.state.activity;
    if (!handoff || activity?.phase !== 'ready') throw new Error('安装包尚未准备完成。');
    if (recoveryBlocked) throw new Error('请先完成上次升级恢复。');
    updates.setActivity({ phase: 'installing', version: activity.version });
    try {
      await exclusive(async () => {
        try {
          recoveryBlocked = true;
          await clientInstall.shutdown(app.getVersion(), activity.version, store.connection, portal.managing, {
            cleanup: cleanupForQuit, handoff, quit: finishQuit,
            startForeground: async () => { if (store.connection) await portal.start(store.settings, store.connection); },
          });
          updateHandoff = undefined;
        } catch (error) {
          recoveryBlocked = Boolean(await clientInstall.read());
          throw error;
        }
      });
    } catch (error) {
      updates.setActivity({ phase: 'ready', version: activity.version });
      throw error;
    }
  };
  handle('beings:check-updates', () => updates.check());
  handle('beings:download-update', downloadUpdate);
  handle('beings:install-update', installUpdate);
  handle('beings:cancel-update', () => { updateDownload?.abort(); });
  handle('beings:update-state', () => updates.state);
  const snapshot = () => ({ settings: store.settings, portal: portal.state, background: background.state, chatScene: sceneWithPortal(chatSessions?.current(store.connection?.endpoint) || chatScene), chatSessions: chatSessions?.list(store.connection?.endpoint).map(scene => sceneWithPortal(scene)!), notice: [startupNotice && errorLog.report('startup-notice', startupNotice), chatSceneNotice].filter(Boolean).join('\n') || undefined });
  handle('beings:chat-session', (operation: string, value: string, endpoint: string, sceneId?: string) => exclusive(async () => {
    if (!chatSessions || !store.connection) throw new Error('请先连接 Being，或检查场景目录。');
    if (endpoint !== store.connection.endpoint) throw new Error('Being 连接已切换，请重试。');
    if (!['create', 'bind', 'select', 'rename', 'delete'].includes(operation)) throw new Error('无效的场景操作。');
    const previousPluginScene = JSON.stringify(currentPluginScene());
    await chatSessions.change(endpoint, operation as 'create' | 'bind' | 'select' | 'rename' | 'delete', value, sceneId);
    if (JSON.stringify(currentPluginScene()) !== previousPluginScene) closePluginSessions();
    return snapshot();
  }));
  const verifyConnection = async () => {
    await reusePreviousConfig();
    await verifyBeingConnection(store.connection, net.fetch.bind(net) as typeof fetch);
    startupNotice = undefined;
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
  handle('beings:connection-defaults', async (input: Pick<SaveSettings, 'connectionLink'>) => {
    const connection = store.resolveConnection(input);
    if (connection.endpoint === store.connection?.endpoint && background.installedService) {
      return { portalName: store.settings.portalName, source: '当前本机配置' };
    }
    const targets = await externalPortal.conflicts(connection, ownedRoot());
    const previous = targets.find(item => item.service?.name);
    return { portalName: previous?.service?.name || store.settings.portalName, source: previous?.root };
  });
  // Initial reads wait for configuration validation and upgrade recovery.
  handle('beings:snapshot', () => exclusive(async () => snapshot()));
  handle('beings:appearance', (theme?: 'light' | 'dark') => exclusive(async () => {
    if (theme === undefined) return appearance;
    if (theme !== 'light' && theme !== 'dark') throw new Error('无效的配色。');
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, 'appearance.json');
    await writeFile(file + '.tmp', JSON.stringify({ theme })); await rename(file + '.tmp', file);
    nativeTheme.themeSource = theme; appearance = theme; pluginWindows?.updateTheme(theme);
    if (!(process.platform === 'win32' && Number(os.release().split('.')[2]) >= 22621)) window?.setBackgroundColor(theme === 'dark' ? '#212121' : '#ffffff');
    return appearance;
  }));
  cancelTownPairing = registerTownIpc({
    handle, exclusive, town, townLive, townCredentials, store, secretStorage,
    fetcher: net.fetch.bind(net) as typeof fetch,
    getWarning: () => townWarning,
    clearWarning: () => { townWarning = undefined; },
    open: url => browser?.open(url),
  });
  registerKitsIpc({ handle, exclusive, window: () => window, store, kitInstaller });
  registerPluginsIpc({ handle, exclusive, window: () => window, registry: plugins, closeWindows: id => pluginWindows?.close(id), fetcher: downloadFetch });
  handle('beings:plugins-context', context => pluginWorkspace.update(context));
  handle('beings:model-catalog', async (input: { kind: string; route?: string; api_key?: string }) => {
    if (!input || !['routes', 'models', 'keys'].includes(input.kind) ||
      (input.kind !== 'routes' && (typeof input.route !== 'string' || !input.route || input.route.length > 256)) ||
      (input.kind === 'keys' && (typeof input.api_key !== 'string' || !input.api_key.trim() || input.api_key.length > 16384)))
      throw new Error('无效的模型目录请求。');
    const path = '/api/llm/' + input.kind + (input.kind === 'models' ? '?route=' + encodeURIComponent(input.route!) : '');
    const response = await proxy.handle(new Request('beings://chat' + path, {
      method: input.kind === 'keys' ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      ...(input.kind === 'keys' ? { body: JSON.stringify({ route: input.route, api_key: input.api_key }) } : {}),
    }));
    return { status: response.status, data: await response.json().catch(() => ({ error: '无法读取模型目录。' })) };
  });
  const beingModelConfig = async (patch?: Record<string, unknown>) => {
    if (patch !== undefined && (!patch || Array.isArray(patch) || typeof patch !== 'object' ||
      Object.entries(patch).some(([key, value]) => !['model', 'provider', 'base_url', 'api', 'api_key', 'thinking', 'temperature', 'rollback'].includes(key) || !['string', 'number', 'boolean'].includes(typeof value)) || JSON.stringify(patch).length > 16384))
      throw new Error('无效的模型配置。');
    const request = async (next?: Record<string, string | number | boolean>) => {
      const response = await proxy.handle(new Request('beings://chat/api/llm/config', {
        method: next === undefined ? 'GET' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        ...(next === undefined ? {} : { body: JSON.stringify(next) }),
      }));
      const data = await response.json();
      if (!response.ok && next === undefined) throw new Error(data.error || '无法读取或保存 Being 模型配置。');
      const safe = next === undefined ? sanitizeModelConfigResult(data) : data;
      return { ...safe, ...(!response.ok ? { ok: false, http_status: data.http_status || response.status } : {}) };
    };
    if (patch === undefined) return request();
    return applyRememberedModelConfig(
      patch as Record<string, string | number | boolean>,
      modelProfiles,
      request,
      error => errorLog.report('model-profile-save', error, '模型配置已提交，但本机未能记住这条线路。'),
    );
  };
  handle('beings:model-config', beingModelConfig);
  handle('beings:model-profiles', async (input: unknown) => {
    return listModelProfiles(input, modelProfiles);
  });
  const taskSnapshot = async (tasks: import('../shared/types').SceneTask[]) => {
    const endpoint = store.connection?.endpoint || '';
    const settings = store.settings, phase = portal.state.phase, pid = portal.state.pid;
    const [ready, subagent] = await Promise.all([
      subagentReady(directory, settings, portal.state, tasks),
      readSubagentConfig(directory, settings).catch(() => undefined),
    ]);
    const current = endpoint === store.connection?.endpoint && settings.portalConfigPath === store.settings.portalConfigPath &&
      phase === portal.state.phase && pid === portal.state.pid;
    return { endpoint, tasks, subagentReady: ready && current,
      ...(subagent && current ? {
        subagentConfigured: Boolean(subagent.provider.trim() && subagent.model.trim()),
        subagentEnabled: subagent.enabled !== false,
      } : {}),
    };
  };
  const sceneTasks = new SceneTaskObserver(tasks => {
    publishPluginEvent('tasks.changed');
    void taskSnapshot(tasks).then(snapshot => {
      if (snapshot.endpoint === store.connection?.endpoint && window && !window.isDestroyed()) window.webContents.send('beings:scene-tasks', snapshot);
    });
  }, () => new Set((chatSessions?.list(store.connection?.endpoint) || []).map(scene => scene.scene_id)));
  app.once('will-quit', () => sceneTasks.close());
  const taskSnapshotFromObserver = async () => taskSnapshot(await sceneTasks.configure(store.settings.portalConfigPath));
  handle('beings:scene-tasks', async () => taskSnapshot(await sceneTasks.configure(store.settings.portalConfigPath)));
  const recentHistory = new RecentChatHistory(proxy, () => store.connection);
  handle('beings:recent-chat-history', (endpoint: string) => recentHistory.read(endpoint));
  handle('beings:subagent-config', () => readSubagentConfig(directory, store.settings));
  handle('beings:save', (input: SaveSettings) => exclusive(async () => {
    if (input.subagentEnabled !== undefined && typeof input.subagentEnabled !== 'boolean') throw new Error('无效的 subagent 开关状态');
    if (input.subagentSetup) validateSubagentSetup(input.subagentSetup);
    cancelTownPairing?.();
    const previous = { ...store.settings }; const previousConnection = store.connection;
    // A pending grant belongs to the old workspace/connection as well as its mode.
    approvalDialogs.cancel();
    await store.save(input);
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
    closePluginSessions(); proxy.abortAll(); return snapshot();
  }));
  handle('beings:choose', async (kind: string) => {
    if (kind !== 'workspace') throw new Error('Invalid dialog');
    const result = await dialog.showOpenDialog(window!, { title: '选择 Being 工作目录', properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  const requestPortalStart = (restart = false) => exclusive(async () => {
    if (restart && portal.state.managed === false) throw new Error('当前 Portal 由外部管理，请使用原管理方式重启。');
    if (startupDeferred) {
      await restoreStartup('manual');
      if (startupDeferred) throw new Error(startupNotice);
      return portal.state;
    }
    if (!store.connection) throw new Error('请先连接 Being。');
    await verifyConnection();
    await takeover.run(store.connection, 'manual', replacing => startClientPortal(replacing, restart));
    await publishCurrentPortal(); return portal.state;
  });
  handle('beings:portal-start', () => requestPortalStart());
  handle('beings:portal-restart', () => requestPortalStart(true));
  handle('beings:portal-force-start', () => exclusive(async () => {
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
  }));
  handle('beings:portal-stop', () => exclusive(async () => {
    if (portal.state.managed === false) throw new Error('当前 Portal 由外部管理，请使用原管理方式停止。');
    if (background.state.enabled) {
      await background.disable();
      await store.save({ ...store.settings, backgroundEnabled: false });
      await publishBackground(); return portal.state;
    }
    return portal.stop();
  }));
  handle('beings:workspace', async () => {
    if (!store.connection) throw new Error('请先保存工作目录。');
    const error = await shell.openPath(store.settings.workspace); if (error) throw new Error(error);
  });
  handle('beings:open-loom', () => exclusive(async () => {
    if (!store.connection) throw new Error('请先配置 Being 链接，再打开原版 Loom。');
    browser?.open(store.connection.link);
  }));
  let handlingConflict = false;
  let portalNoticeIdentity = '';
  portal.on('state', state => {
    const identity = JSON.stringify([state.portalName, state.beingEndpoint, state.phase, state.pid]);
    if (identity !== portalNoticeIdentity) { portalNoticeIdentity = identity; proxy.portalStateChanged(); }
    if (state.phase === 'error' || state.phase === 'external') {
      if (state.logs.length) errorLog.report('portal-runtime', state.logs.slice(-60).join('\n'));
      state = { ...state, message: errorLog.report('portal-state', state.message, 'Portal 启动未完成，请查看日志后重试。') };
      portal.state = state;
    }
    if (window && !window.isDestroyed()) window.webContents.send('beings:portal-state', state);
    // A competing service can start between discovery and launch. Resolve that
    // race once through the same stop/start path, never from a retry timer.
    if (state.conflict && !handlingConflict && !takeover.holdMessage && !quitting) {
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
  installApplicationMenu(showWindow, () => {
    showWindow();
    void updates.check();
  });
  tray = createApplicationTray(showWindow, app.isPackaged);
  async function restoreStartup(intent: 'manual' | 'automatic' = 'automatic') {
    if (!store.connection) {
      if (installIntent) {
        await finishClientInstall();
        runtimeUpdate = { phase: 'current', message: '客户端已安装；连接配置完成后使用客户端 Portal。' };
      }
      return;
    }
    try { await verifyConnection(); startupDeferred = false; }
    catch (error) {
      startupDeferred = true;
      startupNotice = errorLog.report('startup-connection', error, '连接检查失败，请检查设置后重试。');
      runtimeUpdate = { phase: 'skipped', message: startupNotice };
      portal.state = { phase: 'stopped', message: startupNotice, logs: [] };
      // Keep pending upgrade records: reconnect/restart can finish safely.
      return;
    }
    try {
      const connection = store.connection;
      const updater = new RuntimeUpdater(directory, background);
      const resumeInstalledRuntime = async () => {
        if (!installIntent) return;
        await clientInstall.resume(installIntent, async () => {
          const service = background.installedService;
          // The newly installed bundle may be the one that failed. Resume the
          // preserved engine, not that bundle, for a foreground-only client.
          const settings = service ? { ...store.settings,
            portalBinary: path.join(service.root, process.platform === 'win32' ? 'heart-portal.exe' : 'heart-portal'),
            portalConfigPath: service.configPath } : store.settings;
          await portal.start(settings, connection);
          await portal.waitReady();
        });
        installIntent = null;
      };
      // Recovery must run even when the previous attempt left takeover paused.
      const recovered = await updater.recover(installIntent);
      if (recovered && background.installedService) {
        await resumeInstalledRuntime();
        await takeover.clearRuntimeFailure(connection);
        recoveryBlocked = false;
        runtimeUpdate = { phase: 'error', message: '已恢复上次未完成升级前的 Portal；本次启动不再自动重试升级。' };
        await publishCurrentPortal();
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
      if (!quitting && window) void dialog.showMessageBox(window, { type: 'warning', title: 'Portal 更新未完成', message: runtimeUpdate.message, buttons: ['知道了'] });
    }
  }
  windowReady = true;
  createWindow();
  await exclusive(() => restoreStartup());
  if (app.isPackaged && !process.env.PORTAL_DESKTOP_USER_DATA) {
    void updates.check();
    updatePoll = setInterval(() => { void updates.check(); }, 6 * 60 * 60 * 1000);
    updatePoll.unref();
  }
  const observer = new BackgroundPoll({
    revision: () => mutation,
    allowed: () => !quitting && !pendingMutations && !portal.managing && Boolean(store.connection),
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
  backgroundPoll = setInterval(() => { void observer.tick(); }, 1000);
  backgroundPoll.unref();
}
const squirrelEvent = process.platform === 'win32' ? installerEvent(process.argv) : undefined;
if (profileError) {
  const message = errorLog.report('profile-initialization', profileError, '客户端配置目录不可用，请检查系统用户目录后重试。');
  void app.whenReady().then(async () => {
    dialog.showErrorBox(`${CLIENT_NAME} 启动失败`, message);
    await errorLog.flush(); app.quit();
  });
} else if (squirrelEvent) { void handleInstallerEvent(squirrelEvent, process.execPath).catch(error => { errorLog.report('installer-event', error); process.exitCode = 1; }).finally(() => app.quit()); }
else if (!app.requestSingleInstanceLock()) app.quit();
// The target can exit between the installer's process scan and its control launch.
// A first-instance control request must never start a new client or Portal.
else if (installerTarget(process.argv) || process.argv.includes('--quit-for-update')) app.quit();
else {
  app.on('second-instance', (_event, argv) => {
    const args = argv ?? [];
    const target = installerTarget(args);
    if (target) {
      if (prepareInstallerShutdown) prepareInstallerShutdown(target);
      else pendingInstallerTarget = target;
      return;
    }
    if (args.includes('--quit-for-update')) { app.quit(); return; }
    showWindow();
  });
  app.whenReady().then(ready).catch(async error => {
    dialog.showErrorBox(`${CLIENT_NAME} 启动失败`, errorLog.report('client-startup', error, '客户端启动失败，请查看日志后重试。'));
    await errorLog.flush(); app.quit();
  });
  app.on('activate', showWindow);
  app.on('window-all-closed', () => { /* Explicit quit owns process cleanup. */ });
  app.on('before-quit', event => {
    if (quitCleanupDone || sessionEnding || !portal) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    cancelTownPairing?.();
    lifecycleError = '';
    void exclusive(cleanupForQuit).then(finishQuit).catch(error => {
      errorLog.report('client-quit', error);
      quitting = false;
      lifecycleError = '退出未完成，当前客户端保持打开。请在 Portal 设置中检查运行状态，停止后再退出。';
      showWindow();
      if (window && !window.isDestroyed()) void dialog.showMessageBox(window, { type: 'error', title: '退出未完成', message: lifecycleError, buttons: ['知道了'] }).catch(() => {});
    });
  });
}
