import { app, dialog, protocol } from 'electron';
import os from 'node:os';
import path from 'node:path';
import { createDesktopApplication } from './app/bootstrap';
import { clientUserData } from './app/profile';
import { windowsAppId } from './app/windows-identity';
import { handleInstallerEvent, installerEvent, installerTarget } from './updates/installer-events';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;
declare const PORTAL_DESKTOP_DEV_ASSETS: string | null;
declare const PORTAL_DESKTOP_UPDATE_REPOSITORY: string;
declare const PORTAL_DESKTOP_BUILD: string;
const startedAt = new Date().toISOString();
const CLIENT_NAME = 'Portal Desktop';
const CLIENT_ID = 'portal-desktop';

protocol.registerSchemesAsPrivileged([{ scheme: 'beings', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
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

const desktop = createDesktopApplication({
  userData, clientName: CLIENT_NAME, startedAt,
  shellURL: () => new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL || 'beings://desktop/').href,
  get assets() { return PORTAL_DESKTOP_DEV_ASSETS ?? path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`); },
  get development() { return Boolean(MAIN_WINDOW_VITE_DEV_SERVER_URL); },
  get build() { return PORTAL_DESKTOP_BUILD; },
  get updateRepository() { return PORTAL_DESKTOP_UPDATE_REPOSITORY; },
});
const { errorLog } = desktop;
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
else desktop.start();
