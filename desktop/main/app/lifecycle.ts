import { homeFileReference } from '../../shared/being-files';
import { app, BrowserWindow, dialog, type Tray } from 'electron';
import type { ClientBrowser } from '../browser/browser';
import { installerTarget } from '../updates/installer-events';
import type { ClientErrorLog } from './error-log';
import type { Exclusive } from './mutations';
import { createMainWindow } from './window';
import { windowPresentation } from './window-presentation';

interface LifecycleOptions {
  clientName: string;
  shellURL(): string;
  errorLog: ClientErrorLog;
  exclusive: Exclusive;
  canCleanup(): boolean;
  cleanup(): Promise<void>;
  finishServices(): void;
  resumeAfterFailedShutdown(): Promise<void>;
  cancelPairing(): void;
  closePluginSessions(): void;
  recoverPlugins(): Promise<unknown> | undefined;
  matchesPlugin(pathname: string): boolean;
}

/** Owns native window visibility, single-instance requests and process shutdown. */
export class DesktopLifecycle {
  window: BrowserWindow | null = null;
  browser: ClientBrowser | undefined;
  tray: Tray | undefined;
  quitting = false;
  error = '';
  private windowReady = false;
  private quitCleanupDone = false;
  private sessionEnding = false;
  private prepareInstallerShutdown: ((target: string) => void) | undefined;
  private pendingInstallerTarget: string | undefined;

  constructor(private options: LifecycleOptions) { }

  start(ready: () => Promise<void>) {
    app.on('browser-window-created', (_event, window) => { windowPresentation(window); });
    app.on('second-instance', (_event, argv) => {
      const args = argv ?? [];
      const target = installerTarget(args);
      if (target) {
        if (this.prepareInstallerShutdown) this.prepareInstallerShutdown(target);
        else this.pendingInstallerTarget = target;
        return;
      }
      if (args.includes('--quit-for-update')) { app.quit(); return; }
      this.showWindow();
    });
    app.whenReady().then(ready).catch(async error => {
      dialog.showErrorBox(`${this.options.clientName} 启动失败`, this.options.errorLog.report('client-startup', error, '客户端启动失败，请查看日志后重试。'));
      await this.options.errorLog.flush(); app.quit();
    });
    app.on('activate', this.showWindow);
    app.on('window-all-closed', () => { /* Explicit quit owns process cleanup. */ });
    app.on('before-quit', event => {
      if (this.quitCleanupDone || this.sessionEnding || !this.options.canCleanup()) return;
      event.preventDefault();
      if (this.quitting) return;
      this.quitting = true;
      this.options.cancelPairing();
      this.error = '';
      void this.options.exclusive(this.options.cleanup).then(this.finishQuit).catch(async error => {
        const detail = this.options.errorLog.report('client-quit', error);
        this.quitting = false;
        await this.options.resumeAfterFailedShutdown();
        this.error = '退出未完成，当前客户端保持打开。请处理错误后重试。';
        this.showWindow();
        if (this.window && !this.window.isDestroyed()) void dialog.showMessageBox(this.window, { type: 'error', title: '退出未完成', message: this.error, detail, buttons: ['知道了'] }).catch(() => { });
      });
    });
  }

  setInstallerShutdown(shutdown: (target: string) => Promise<void>) {
    this.prepareInstallerShutdown = target => {
      void this.options.exclusive(async () => {
        if (this.quitting) return;
        await shutdown(target);
      }).catch(error => {
        if (this.window && !this.window.isDestroyed()) void dialog.showMessageBox(this.window, {
          type: 'error', title: '无法开始安装', message: this.options.errorLog.report('installer-start', error, '安装准备失败，请查看日志后重试。'),
          detail: '旧客户端和 Portal 保持运行。请处理后重新启动安装包。', buttons: ['知道了'],
        });
      });
    };
    if (this.pendingInstallerTarget) {
      const target = this.pendingInstallerTarget;
      this.pendingInstallerTarget = undefined;
      this.prepareInstallerShutdown(target);
    }
  }

  readonly finishQuit = () => {
    this.options.finishServices();
    // Installer shutdown reaches here without the normal before-quit handler.
    this.quitting = true;
    this.options.cancelPairing();
    this.quitCleanupDone = true;
    this.tray?.destroy();
    app.quit();
  };

  async prepareWindowsForQuit() {
    const results = await Promise.allSettled(BrowserWindow.getAllWindows().map(window => windowPresentation(window).prepareForQuit()));
    const failed = results.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  }

  restoreWindowsAfterFailedQuit() {
    for (const window of BrowserWindow.getAllWindows()) windowPresentation(window).cancelQuit();
  }

  openWhenReady() {
    this.windowReady = true;
    this.createWindow();
  }

  readonly showWindow = () => {
    // Second launches must not load the shell before protocols and IPC exist.
    if (this.quitting || !this.windowReady) return;
    if (!this.window) { this.createWindow(); return; }
    windowPresentation(this.window).show();
  };

  private createWindow() {
    if (!this.windowReady || this.quitting || (this.window && !this.window.isDestroyed())) return;
    const { shellURL, errorLog, closePluginSessions } = this.options;
    const created = createMainWindow({
      shellURL,
      recoverPlugins: () => { void this.options.recoverPlugins()?.then(() => this.window?.webContents.reload()); },
      pluginRoute: url => {
        const own = new URL(shellURL());
        // URL.origin is "null" for custom schemes; compare scheme/host explicitly.
        const sameOrigin = url.protocol === own.protocol && url.host === own.host;
        return (sameOrigin || (url.protocol === 'beings:' && url.host === 'desktop')) && this.options.matchesPlugin(url.pathname);
      },
      isQuitting: () => this.quitting,
      isSessionEnding: () => this.sessionEnding,
      markSessionEnding: () => { this.sessionEnding = true; },
      openExternal: url => {
        try {
          if (homeFileReference(url)) return;
          const parsed = new URL(url);
          if (['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password) this.browser?.open(url);
        } catch { /* Unsupported links stay inside the sandbox. */ }
      },
      onBrowser: value => { this.browser = value; },
      onClosed: value => { if (this.window === value) this.window = null; },
      onHideError: error => {
        const message = errorLog.report('window-hide', error);
        if (this.window && !this.window.isDestroyed()) void dialog.showMessageBox(this.window, {
          type: 'error', title: '窗口未关闭', message, buttons: ['知道了'],
        });
      },
    });
    const window = this.window = created.window;
    this.browser = created.browser;
    errorLog.info('client-window', '主窗口已创建');
    window.webContents.on('console-message', (_event, level, message) => errorLog.info(`renderer-${level}`, message));
    window.webContents.on('did-start-navigation', (_event, _url, inPlace, isMainFrame) => { if (isMainFrame && !inPlace) closePluginSessions(); });
    window.webContents.on('render-process-gone', (_event, details) => {
      errorLog.report('renderer-gone', JSON.stringify(details)); closePluginSessions();
    });
    window.on('unresponsive', () => errorLog.report('window-unresponsive', '主窗口无响应'));
    window.on('responsive', () => errorLog.info('window-responsive', '主窗口已恢复响应'));
    window.webContents.on('destroyed', closePluginSessions);
  }
}
