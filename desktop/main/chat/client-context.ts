import { BrowserWindow } from 'electron';
import type { ClientCommandRequest } from './client-server';

export class ClientContextReader {
  private window?: BrowserWindow;
  private ready?: Promise<void>;

  constructor(private shellURL = 'beings://desktop/') {}

  async execute(request: ClientCommandRequest): Promise<string> {
    if (!this.window || this.window.isDestroyed()) {
      const window = new BrowserWindow({ show: false, webPreferences: {
        sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
        backgroundThrottling: false,
      } });
      this.window = window;
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', event => event.preventDefault());
      // IndexedDB is keyed by both frame origin and top-level site. Match the
      // actual shell (including the Vite origin in development), not chat alone.
      this.ready = window.loadURL(new URL('client-context-host.html', this.shellURL).href).catch(error => {
        window.destroy();
        throw error;
      });
    }
    const window = this.window;
    await this.ready;
    const frame = window.webContents.mainFrame.frames.find(frame => frame.url === 'beings://chat/client-context.html');
    if (!frame) throw new Error('Client history frame unavailable');
    const result = await frame.executeJavaScript(`window.clientCommand(${[
      request.endpoint, request.verb, request.args, request.sceneId, request.scenes,
    ].map(value => JSON.stringify(value ?? null)).join(',')})`);
    if (typeof result !== 'string') throw new Error('Invalid client history response');
    return result;
  }

  close() { this.window?.destroy(); this.window = undefined; this.ready = undefined; }
}
