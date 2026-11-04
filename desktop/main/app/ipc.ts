import { ipcMain, type BrowserWindow } from 'electron';
import { ClientErrorLog } from './error-log';

export type RegisterHandler = (channel: string, callback: (...args: any[]) => unknown) => void;

/** All desktop capability handlers pass through this top-level shell trust boundary. */
export function createTrustedHandler(options: {
  window(): BrowserWindow | null;
  shellURL(): string;
  isQuitting(): boolean;
  recoveryBlocked(): boolean;
  errorLog: ClientErrorLog;
}): RegisterHandler {
  return (channel, callback) => {
    ipcMain.handle(channel, async (event, ...args) => {
      const window = options.window();
      const frame = event.senderFrame;
      if (!window || event.sender !== window.webContents || frame !== window.webContents.mainFrame || frame.url !== options.shellURL()) throw new Error('Untrusted IPC sender');
      if (options.isQuitting() && !['beings:browser-bounds', 'beings:diagnostics'].includes(channel)) throw new Error('客户端正在退出，请稍候。');
      if (options.recoveryBlocked() && ['beings:save', 'beings:portal-stop', 'beings:portal-force-start'].includes(channel)) throw new Error('Portal 升级恢复尚未完成，请点击启动 Portal 重试恢复。');
      try { return await callback(...args); }
      catch (error) { throw new Error(options.errorLog.report(channel, error)); }
    });
  };
}
