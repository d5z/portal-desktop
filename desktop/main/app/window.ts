import { BrowserWindow, nativeTheme, type BrowserWindowConstructorOptions } from 'electron';
import path from 'node:path';
import { systemIcon } from './branding';
import { windowPresentation } from './window-presentation';
import { ClientBrowser } from '../browser/browser';

const CLIENT_NAME = 'Portal Desktop';

export interface MainWindowOptions {
  shellURL: () => string;
  recoverPlugins?: () => void;
  pluginRoute?: (url: URL) => boolean;
  isQuitting: () => boolean;
  isSessionEnding: () => boolean;
  markSessionEnding: () => void;
  openExternal: (url: string) => void;
  onBrowser: (browser: ClientBrowser) => void;
  onClosed: (window: BrowserWindow) => void;
  onHideError: (error: unknown) => void;
}

export function createMainWindow(options: MainWindowOptions) {
  const window = new BrowserWindow(clientWindowOptions());
  const presentation = windowPresentation(window);
  if (process.platform === 'win32') {
    window.setMenuBarVisibility(false);
    // ICON_SMALL stays black; taskbar-icons updates ICON_BIG independently.
  }
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.control || input.meta) && input.alt && input.shift && input.key.toLowerCase() === 'p') { event.preventDefault(); options.recoverPlugins?.(); return; }
    if (input.type !== 'keyDown' || input.key !== 'F12' || input.isAutoRepeat) return;
    event.preventDefault();
    if (window.webContents.isDevToolsOpened()) window.webContents.closeDevTools();
    else window.webContents.openDevTools({ mode: 'detach' });
  });
  window.webContents.setWindowOpenHandler(({ url }) => { options.openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', event => {
    // Renderer-initiated reload is needed to discard third-party global state.
    // Only the exact bundled shell may replace the main document.
    if (event.url !== options.shellURL()) event.preventDefault();
  });
  window.webContents.on('will-frame-navigate', event => {
    const url = event.url;
    const parsed = new URL(url);
    // Open web destinations without replacing the preview or exposing host pages.
    if (event.frame?.url.startsWith('beings://preview/')) {
      event.preventDefault();
      if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) options.openExternal(url);
      return;
    }
    if (!event.isMainFrame && event.frame?.parent?.url === options.shellURL() && options.pluginRoute?.(parsed)) return;
    const localPreview = !event.isMainFrame && parsed.protocol === 'beings:' && parsed.hostname === 'preview'
      && event.frame?.parent?.url === options.shellURL();
    if (localPreview) return;
    const pluginDocument = !event.isMainFrame && parsed.protocol === 'beings:' && parsed.hostname === 'plugins' && /^\/[a-f0-9-]{36}\.html$/.test(parsed.pathname);
    if (pluginDocument) return;
    // Plugin documents cannot navigate to host pages, external sites or custom protocols.
    if (event.frame?.url.startsWith('beings://plugins/')) { event.preventDefault(); return; }
    // Only a chat document may embed the isolated Intelligent UI runtime.
    // The runtime is an ordinary navigation, so CSP permission alone is insufficient.
    const parentURL = event.frame?.parent?.url;
    // DSH notification clicks focus this host instead of launching another app.
    if (url === 'dsh://open' && parentURL === options.shellURL()) { event.preventDefault(); presentation.show(); return; }
    const chatParent = parentURL ? new URL(parentURL) : undefined;
    const runtimeDocument = !event.isMainFrame && parsed.protocol === 'beings:' && parsed.hostname === 'chat'
      && parsed.pathname === '/iui-runtime.html' && !parsed.search && !parsed.hash
      && chatParent?.protocol === 'beings:' && chatParent.hostname === 'chat'
      && ['/', '/loom.html'].includes(chatParent.pathname);
    if (runtimeDocument) return;
    // Only the shell may embed the bundled, sandboxed slide renderer.
    const previewURL = new URL('pptx-preview.html', options.shellURL()).href;
    if (!event.isMainFrame && parentURL === options.shellURL() && url === previewURL) return;
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
    void presentation.hide().catch(error => { presentation.show(); options.onHideError(error); });
  });
  // Let Windows logoff/shutdown close the app rather than hide the window.
  window.on('query-session-end', options.markSessionEnding);
  window.on('closed', () => options.onClosed(window));
  void window.loadURL(options.shellURL());
  return { window, browser };
}

/** Shared native caption, icon and platform styling for client-owned windows. */
export function clientWindowOptions(): BrowserWindowConstructorOptions {
  return {
    width: 1280, height: 860, minWidth: 920, minHeight: 640, title: CLIENT_NAME,
    icon: systemIcon(false),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#212121' : '#ffffff',
    ...(process.platform === 'win32' ? { backgroundMaterial: 'none' as const } : {}),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: process.platform === 'win32',
    trafficLightPosition: { x: 8, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), sandbox: true, contextIsolation: true,
      nodeIntegration: false, nodeIntegrationInSubFrames: false, webSecurity: true,
    },
  };
}
