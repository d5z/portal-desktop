import { BaseWindow, WebContentsView, session, ipcMain, type BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { HomeBounds, HomeState } from '../../shared/home';
import { HOME_ORIGIN, viewerNavigation } from './protocol';
import { HomeTransport, ViewerExpired } from './transport';
/** One local canvas + isolated desktop-cookie session, retained across layout changes. */
export class HomeViewer {
  private view?: WebContentsView;
  private transport?: HomeTransport;
  private owner?: BrowserWindow;
  private previewWindow?: BaseWindow;
  private attachedTo?: BaseWindow;
  private bounds?: HomeBounds;
  private current = 0;
  private removeIpc?: () => void;
  constructor(private window: () => BrowserWindow | null, private publish: (phase: HomeState['viewer']) => void,
    private assets: string) {}
  open(url: string, computerId: string) {
    this.close();
    const owner = this.window();
    if (!owner || owner.isDestroyed()) throw new Error('请先打开客户端窗口。');
    if (!viewerNavigation(url, computerId)) throw new Error('无效的云电脑地址。');
    const generation = ++this.current;
    const jar = session.fromPartition(`home-viewer-${randomUUID()}`, { cache: false });
    const localURL = pathToFileURL(path.join(this.assets, 'home-viewer.html')).href;
    const assets = new Set(['home-viewer.html', 'home-viewer.js', 'home-viewer.css'].map(file => pathToFileURL(path.join(this.assets, file)).href));
    jar.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    jar.setPermissionCheckHandler(() => false);
    jar.on('will-download', event => event.preventDefault());
    jar.webRequest.onBeforeRequest((details, callback) => {
      const target = new URL(details.url);
      const allowed = assets.has(details.url) || target.protocol === 'blob:' || details.url === url ||
        (target.origin === HOME_ORIGIN && target.pathname.startsWith(`/desktop/${computerId}/browser/`) && !target.search && !target.hash);
      callback({ cancel: !allowed });
    });
    const view = new WebContentsView({ webPreferences: { session: jar, sandbox: true, contextIsolation: true,
      nodeIntegration: false, backgroundThrottling: false, webSecurity: true, webviewTag: false, navigateOnDragDrop: false,
      preload: path.join(this.assets, 'home-viewer-preload.cjs') } });
    this.view = view; this.owner = owner;
    this.previewWindow = new BaseWindow({ show: false, width: 1200, height: 800, focusable: false, skipTaskbar: true });
    this.previewWindow.contentView.addChildView(view); this.attachedTo = this.previewWindow;
    view.setBounds({ x: 0, y: 0, width: 1200, height: 800 });
    const current = () => this.current === generation && !view.webContents.isDestroyed();
    const fail = (phase: 'error' | 'expired') => { if (current()) { this.close(); this.publish(phase); } };
    const transport = new HomeTransport(jar, computerId, event => { if (current()) view.webContents.send('home-viewer:event', event); }, () => fail('expired'));
    this.transport = transport;
    jar.cookies.on('changed', (_event, cookie, cause, removed) => {
      if (removed && !['overwrite', 'expired-overwrite'].includes(cause) && cookie.name === 'bh_desktop') fail('expired');
    });
    const trusted = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => current() && event.sender === view.webContents &&
      event.senderFrame === view.webContents.mainFrame && event.senderFrame?.url === localURL;
    ipcMain.handle('home-viewer:request', async (event, operation, value) => {
      if (!trusted(event)) throw new Error('Untrusted viewer');
      try {
        switch (operation) {
          case 'ready': this.presentation(); return;
          case 'painted': this.publish('page'); return;
          case 'failed': fail('error'); return;
          case 'expand': if (this.bounds?.visible && this.bounds.presentation === 'preview') owner.webContents.send('beings:home-expand'); return;
          case 'state': return await transport.read();
          case 'control': return await transport.control(value);
          case 'input': return await transport.input(value);
          case 'frame': return await transport.frame();
          case 'connect': return await transport.connect();
          case 'disconnect': transport.disconnect(); return;
          default: throw new Error('不支持的画面操作。');
        }
      } catch (error) {
        if (error instanceof ViewerExpired) fail('expired');
        // Never forward network errors: they may include the single-use ticket or headers.
        throw new Error(error instanceof ViewerExpired ? '查看会话已过期，请重新打开。' : '连接或控制操作未完成，请确认画面后重试。');
      }
    });
    const send = (event: Electron.IpcMainEvent, id: number, data: unknown) => { if (trusted(event)) transport.send(id, data); };
    const ack = (event: Electron.IpcMainEvent, id: number, sequence: number) => { if (trusted(event)) transport.ack(id, sequence); };
    ipcMain.on('home-viewer:send', send); ipcMain.on('home-viewer:ack', ack);
    this.removeIpc = () => { ipcMain.removeHandler('home-viewer:request'); ipcMain.removeListener('home-viewer:send', send); ipcMain.removeListener('home-viewer:ack', ack); };
    // Let remote shortcuts reach the local keyboard bridge rather than the app menu.
    // Paste keeps its native menu action so only explicitly pasted text is forwarded.
    view.webContents.on('before-input-event', (_event, input) => {
      const shortcut = input.control || input.meta;
      view.webContents.setIgnoreMenuShortcuts(shortcut && input.key.toLowerCase() !== 'v');
    });
    view.webContents.on('will-navigate', event => event.preventDefault());
    view.webContents.on('will-redirect', event => event.preventDefault());
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    view.webContents.on('will-attach-webview', event => event.preventDefault());
    view.webContents.on('did-fail-load', (_event, code, _description, _url, main) => { if (main && code !== -3) fail('error'); });
    view.webContents.on('render-process-gone', () => fail('error'));
    const close = () => { if (current()) this.close(); };
    owner.once('closed', close); owner.webContents.once('did-start-loading', close);
    const visibility = () => { if (current()) this.presentation(); };
    owner.on('minimize', visibility); owner.on('restore', visibility);
    owner.on('hide', visibility); owner.on('show', visibility);
    view.webContents.once('destroyed', () => {
      owner.removeListener('closed', close); owner.webContents.removeListener('did-start-loading', close);
      owner.removeListener('minimize', visibility); owner.removeListener('restore', visibility);
      owner.removeListener('hide', visibility); owner.removeListener('show', visibility);
    });
    this.publish('loading'); this.layout();
    void transport.exchange(url).then(async () => { if (current()) await view.webContents.loadURL(localURL); }).catch(() => fail('error'));
  }
  async preview(): Promise<string | null> {
    const view = this.view, generation = this.current;
    if (!view || view.webContents.isDestroyed()) return null;
    try {
      const image = await view.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
      if (this.current !== generation || image.isEmpty()) return null;
      return image.resize({ width: 960 }).toDataURL();
    } catch { return null; }
  }
  setBounds(bounds: HomeBounds) {
    if (!bounds || typeof bounds.visible !== 'boolean' || !['x', 'y', 'width', 'height'].every(key =>
      typeof bounds[key as keyof HomeBounds] === 'number' && Number.isFinite(bounds[key as keyof HomeBounds]))) throw new Error('无效的云电脑布局。');
    if (bounds.presentation !== undefined && !['preview', 'browser'].includes(bounds.presentation)) throw new Error('无效的云电脑显示方式。');
    this.bounds = bounds; this.layout();
  }
  private presentation() {
    const b = this.bounds;
    const visible = !!b?.visible && !!this.owner?.isVisible() && !this.owner?.isMinimized();
    this.transport?.setActive(visible && b?.presentation === 'browser');
    if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.send('home-viewer:event', {
      type: 'presentation', preview: b?.presentation !== 'browser', visible, dark: b?.dark === true,
    });
  }
  private layout() {
    if (!this.view || !this.owner || this.owner.isDestroyed()) return;
    const b = this.bounds;
    const target = b?.visible ? this.owner : this.previewWindow;
    if (!target || target.isDestroyed()) return;
    if (this.attachedTo !== target) {
      this.attachedTo?.contentView.removeChildView(this.view);
      target.contentView.addChildView(this.view); this.attachedTo = target;
    }
    this.presentation();
    if (!b?.visible) return;
    const [width, height] = this.owner.getContentSize(), zoom = this.owner.webContents.getZoomFactor();
    const x = Math.max(0, Math.min(width, Math.round(b.x * zoom))), y = Math.max(0, Math.min(height, Math.round(b.y * zoom)));
    const w = Math.max(0, Math.min(width - x, Math.round(b.width * zoom))), h = Math.max(0, Math.min(height - y, Math.round(b.height * zoom)));
    this.view.setBounds({ x, y, width: w, height: h }); this.view.setVisible(w > 0 && h > 0);
    if (this.view.webContents.getZoomFactor() !== zoom) this.view.webContents.setZoomFactor(zoom);
  }
  close() {
    this.current++; this.removeIpc?.(); this.removeIpc = undefined;
    const released = this.transport?.close(); this.transport = undefined;
    const view = this.view, host = this.attachedTo, previewWindow = this.previewWindow;
    this.view = undefined; this.owner = undefined; this.attachedTo = undefined; this.previewWindow = undefined;
    if (view) {
      if (host && !host.isDestroyed()) host.contentView.removeChildView(view);
      if (!view.webContents.isDestroyed()) {
        const jar = view.webContents.session;
        view.webContents.close({ waitForBeforeUnload: false });
        void Promise.resolve(released).finally(async () => {
          await jar.clearStorageData().catch(() => {}); await jar.closeAllConnections().catch(() => {});
        });
      }
    }
    if (previewWindow && !previewWindow.isDestroyed()) previewWindow.destroy();
    this.publish('closed');
  }
}
