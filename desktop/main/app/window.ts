import { app, BrowserWindow, nativeTheme, type BrowserWindowConstructorOptions } from 'electron';
import path from 'node:path';
import { ClientBrowser } from '../browser/browser';

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
  const window = new BrowserWindow(clientWindowOptions());
  if (process.platform === 'win32') {
    window.setMenuBarVisibility(false);
    // ICON_SMALL stays black; taskbar-icons updates ICON_BIG independently.
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
    const pluginDocument = !event.isMainFrame && parsed.protocol === 'beings:' && parsed.hostname === 'plugins' && /^\/[a-f0-9-]{36}\.html$/.test(parsed.pathname);
    if (pluginDocument) return;
    // Plugin documents cannot navigate to host pages, external sites or custom protocols.
    if (event.frame?.url.startsWith('beings://plugins/')) { event.preventDefault(); return; }
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

/** Shared native caption, icon and platform styling for client-owned windows. */
export function clientWindowOptions(): BrowserWindowConstructorOptions {
  const windowIcon = () => path.join(
    app.isPackaged ? process.resourcesPath : app.getAppPath(),
    app.isPackaged ? 'branding' : 'resources/branding',
    process.platform === 'win32'
      ? 'logo.png'
      : process.platform === 'darwin' ? 'app-mac.png' : 'app.png',
  );
  return {
    width: 1280, height: 860, minWidth: 920, minHeight: 640, title: CLIENT_NAME,
    icon: windowIcon(),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#212121' : '#ffffff',
    ...(process.platform === 'win32' ? { backgroundMaterial: 'none' as const } : {}),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: process.platform === 'win32',
    trafficLightPosition: { x: 18, y: 20 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), sandbox: true, contextIsolation: true,
      nodeIntegration: false, nodeIntegrationInSubFrames: false, webSecurity: true,
    },
  };
}
