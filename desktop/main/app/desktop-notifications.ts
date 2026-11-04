import { app, nativeImage, Notification, shell, type BrowserWindow } from 'electron';
import type { NotificationTarget } from '../../shared/types';
import { TownLive } from '../town/live';
import { brandingPath, notificationIcon } from './branding';
import { ClientErrorLog } from './error-log';
import type { RegisterHandler } from './ipc';
import type { Exclusive } from './mutations';
import { DesktopNotifications } from './notifications';
import { SettingsStore } from './settings';
import { systemUsesDarkColors, watchSystemTheme } from './system-theme';
import { updateNotificationShortcutIcon } from './windows-identity';
export async function createDesktopNotifications(options: {
  directory: string; store: SettingsStore; errorLog: ClientErrorLog; development: boolean;
  window(): BrowserWindow | null; isQuitting(): boolean; showWindow(): void; townGeneration(): number;
}) {
  const { directory, store, errorLog, window: getWindow, isQuitting, showWindow } = options;
  let pendingNotification: { target: NotificationTarget; generation: number } | undefined;
  let notificationDark = await systemUsesDarkColors();
  const updateNotificationIcon = () => {
    if (process.platform !== 'win32' || !app.isPackaged) return;
    try {
      updateNotificationShortcutIcon(app.getPath('appData'), process.execPath,
        brandingPath(notificationDark ? 'logo-white.ico' : 'logo-black.ico'), shell);
    }
    catch (error) { errorLog.report('notification-icon', error); }
  };
  updateNotificationIcon();
  const stopNotificationTheme = watchSystemTheme(dark => { notificationDark = dark; updateNotificationIcon(); });
  app.once('will-quit', stopNotificationTheme);
  const notifications = new DesktopNotifications(directory, {
    supported: () => Notification.isSupported(),
    focused: () => { const window = getWindow(); return isQuitting() || Boolean(window && !window.isDestroyed() && window.isVisible() && window.isFocused()); },
    create: content => {
      const notification = new Notification({ ...content, icon: nativeImage.createFromPath(notificationIcon(notificationDark)) });
      // Electron may create its notification shortcut lazily in the constructor.
      updateNotificationIcon();
      return notification;
    },
    open: target => {
      if (isQuitting()) return;
      pendingNotification = { target, generation: options.townGeneration() };
      showWindow();
      getWindow()?.webContents.send('beings:notification-open');
    },
  });
  await notifications.load();
  const reset = (state: TownLive['state']) => {
    notifications.reset(state.generation);
    if (state.phase === 'auth-error' || state.phase === 'unpaired') { notifications.clear(); pendingNotification = undefined; }
  };
  const registerIpc = (handle: RegisterHandler, exclusive: Exclusive) => {
    handle('beings:notifications', (patch?: unknown) => exclusive(async () => {
      const state = patch === undefined ? notifications.state : await notifications.save(patch);
      if (pendingNotification && (!state.preferences.enabled || !state.preferences[pendingNotification.target.channel])) pendingNotification = undefined;
      return state;
    }));
    if (!app.isPackaged && options.development)
      handle('beings:notification-test', () => notifications.test());
    handle('beings:scene-notification', (endpoint: unknown, activity: unknown) => {
      if (typeof endpoint !== 'string' || endpoint !== store.connection?.endpoint || !activity || typeof activity !== 'object' || Array.isArray(activity)) return;
      const entries = Object.entries(activity);
      const allowed = new Set(['queued', 'thinking', 'replying', 'working', 'waiting', 'reconnecting', 'timeout', 'done', 'error', 'stopped']);
      if (entries.length > 500 || !entries.every(([id, status]) => id.length > 0 && id.length <= 256 && typeof status === 'string' && allowed.has(status))) return;
      notifications.receiveSceneActivity(endpoint, activity as Record<string, import('../../shared/types').ChatSceneActivity>);
    });
    handle('beings:notification-target', () => {
      const pending = pendingNotification;
      pendingNotification = undefined;
      if (pending?.target.channel === 'scenes' && pending.target.endpoint !== store.connection?.endpoint) return null;
      return pending?.generation === options.townGeneration() ? pending.target : null;
    });
  };
  return { service: notifications, reset, registerIpc };
}
