import { app, BrowserWindow, nativeTheme } from 'electron';
import os from 'node:os';
import path from 'node:path';
import { ClientBrowser } from '../browser/browser';
import { refreshSystemTheme } from './system-theme';

const CLIENT_NAME = 'Portal Desktop';

export interface MainWindowOptions {
  shellURL: () => string;
  isQuitting: () => boolean;
  isSessionEnding: () => boolean;
  markSessionEnding: () => void;
  openExternal: (url: string) => void;
  onBrowser: (browser: ClientBrowser) => void;
  onClosed: (window: BrowserWindow) => void;
}

export function createMainWindow(options: MainWindowOptions) {
  const acrylic = process.platform === 'win32' && Number(os.release().split('.')[2]) >= 22621;
  const windowIcon = () => path.join(
    app.isPackaged ? process.resourcesPath : app.getAppPath(),
    app.isPackaged ? 'branding' : 'resources/branding',
    process.platform === 'win32'
      ? 'logo.png'
      : process.platform === 'darwin' ? 'app-mac.png' : 'app.png',
  );
  const window = new BrowserWindow({
    width: 1280, height: 860, minWidth: 920, minHeight: 640, title: CLIENT_NAME,
    icon: windowIcon(),
    backgroundColor: acrylic ? '#00000000' : nativeTheme.shouldUseDarkColors ? '#212121' : '#ffffff',
    ...(acrylic ? { backgroundMaterial: 'acrylic' as const } : {}),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: process.platform === 'win32',
    trafficLightPosition: { x: 18, y: 20 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), sandbox: true, contextIsolation: true,
      nodeIntegration: false, nodeIntegrationInSubFrames: false, webSecurity: true,
    },
  });
  if (process.platform === 'win32') {
    window.setMenuBarVisibility(false);
    // Keep the native caption icon black. The installed shell shortcut and tray
    // select their own icon from the taskbar theme.
    window.hookWindowMessage(0x001a, refreshSystemTheme);
  }
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.key !== 'F12' || input.isAutoRepeat) return;
    event.preventDefault();
    if (window.webContents.isDevToolsOpened()) window.webContents.closeDevTools();
    else window.webContents.openDevTools({ mode: 'detach' });
  });
  window.webContents.setWindowOpenHandler(({ url }) => { options.openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-frame-navigate', event => {
    const url = event.url;
    const parsed = new URL(url);
    const chatDocument = parsed.protocol === 'beings:' && parsed.hostname === 'chat' && parsed.pathname === '/';
    if (!chatDocument && url !== options.shellURL()) { event.preventDefault(); options.openExternal(url); }
  });

  const browser = new ClientBrowser(window, state => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('beings:browser-state', state);
  });
  options.onBrowser(browser);
  window.on('close', event => {
    if (options.isQuitting() || options.isSessionEnding()) return;
    event.preventDefault();
    window.hide();
  });
  // Let Windows logoff/shutdown close the app rather than hide the window.
  window.on('query-session-end', options.markSessionEnding);
  window.on('closed', () => options.onClosed(window));
  void window.loadURL(options.shellURL());
  return { window, browser };
}
