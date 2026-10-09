import { BrowserWindow, ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { clientWindowOptions } from '../app/window';
import type { PluginRegistry } from './registry';
import type { PluginEvent, PluginHostRequest, PluginWindowInfo } from '../../shared/plugins';

type Entry = { window: BrowserWindow; info: PluginWindowInfo; url: string; tokens: Set<string> };

/** Only this dedicated host may use its own plugin sessions; normal client IPC stays main-window-only. */
export class PluginWindows {
  private entries = new Map<number, Entry>();
  private pending = new Map<string, { owner: number; finish: (value?: unknown, error?: string) => void }>();
  private opening: Promise<unknown> = Promise.resolve();
  constructor(private registry: PluginRegistry, private shellURL: () => string, private main: () => BrowserWindow | null,
    private theme: () => 'light' | 'dark') {
    ipcMain.handle('beings:plugin-window', async (event, operation: string, ...args: any[]) => {
      const entry = this.entries.get(event.sender.id);
      if (!entry || event.senderFrame !== entry.window.webContents.mainFrame || event.senderFrame.url !== entry.url) throw new Error('Untrusted plugin window');
      if (operation === 'info') return { ...entry.info, theme: this.theme() };
      if (operation === 'open') {
        const session = await this.registry.open(entry.info.id, entry.info.view, entry.info.command);
        if (!this.entries.has(event.sender.id)) { await this.registry.close(session.token); throw new Error('窗口已关闭。'); }
        entry.tokens.add(session.token); return session;
      }
      if (operation === 'call' || operation === 'close') {
        const [token, method, value] = args;
        if (!entry.tokens.has(token)) throw new Error('插件会话不属于此窗口。');
        if (operation === 'close') { entry.tokens.delete(token); return this.registry.close(token); }
        return this.registry.call(token, method, value);
      }
      if (operation === 'action') {
        const [action, value] = args;
        if (!['compose', 'ui', 'commands', 'dock'].includes(action)) throw new Error('未知的插件窗口操作。');
        const result = await this.request(entry, action, action === 'dock' ? { id: entry.info.id, view: entry.info.view } : value);
        if (action === 'dock' && !entry.window.isDestroyed()) entry.window.close();
        return result;
      }
      throw new Error('未知的插件窗口操作。');
    });
  }
  open(id: string, view: string, command?: string) {
    const result = this.opening.then(() => this.create(id, view, command));
    this.opening = result.catch(() => {}); return result;
  }
  private async create(id: string, view: string, command?: string) {
    // Registry validates enabled state, view and command before creating any native window.
    const validation = await this.registry.open(id, view, command); await this.registry.close(validation.token);
    const plugin = (await this.registry.list()).plugins.find(p => p.manifest.id === id)!;
    const existing = [...this.entries.values()].find(e => e.info.id === id && e.info.view === view);
    if (existing) {
      if (command) { existing.info.command = command; await existing.window.webContents.reload(); }
      existing.window.show(); existing.window.focus(); return;
    }
    if (this.entries.size >= 8) throw new Error('最多同时打开 8 个插件窗口。');
    const url = new URL(this.shellURL()); url.searchParams.set('plugin-window', randomUUID());
    const options = clientWindowOptions();
    const window = new BrowserWindow({ ...options, show: false, title: `${plugin.manifest.name} · Portal Desktop`,
      webPreferences: { ...options.webPreferences, additionalArguments: ['--beings-plugin-window'] } });
    window.setMenuBarVisibility(false);
    const entry: Entry = { window, url: url.href, tokens: new Set(), info: { id, view, command,
      title: `${plugin.manifest.name} · ${plugin.manifest.contributes.views.find(v => v.id === view)!.title}`, theme: this.theme(), platform: process.platform } };
    const owner = window.webContents.id;
    this.entries.set(owner, entry);
    const clear = () => { for (const token of entry.tokens) void this.registry.close(token); entry.tokens.clear(); };
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('will-frame-navigate', event => {
      const token = /^beings:\/\/plugins\/([a-f0-9-]{36})\.html$/.exec(event.url)?.[1];
      if (event.isMainFrame || !token || !entry.tokens.has(token)) event.preventDefault();
    });
    window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) clear(); });
    window.webContents.on('render-process-gone', clear);
    window.on('closed', () => {
      clear(); this.entries.delete(owner);
      for (const pending of this.pending.values()) if (pending.owner === owner) pending.finish(undefined, '插件窗口已关闭。');
    });
    try { await window.loadURL(entry.url); window.show(); }
    catch (error) { window.destroy(); throw error; }
  }
  private request(entry: Entry, action: PluginHostRequest['action'], value?: unknown) {
    const main = this.main();
    if (!main || main.isDestroyed()) throw new Error('主窗口不可用。');
    return new Promise<unknown>((resolve, reject) => {
      const requestId = randomUUID();
      const finish = (result?: unknown, error?: string) => { clearTimeout(timer); this.pending.delete(requestId); error ? reject(new Error(error)) : resolve(result); };
      const timer = setTimeout(() => finish(undefined, '主窗口未响应，请重试。'), 5000);
      this.pending.set(requestId, { owner: entry.window.webContents.id, finish });
      if (action !== 'compose' && !(action === 'ui' && (value as any)?.method === 'ui.notice')) { main.show(); main.focus(); }
      main.webContents.send('beings:plugin-host-request', { requestId, action, value });
    });
  }
  reply(id: string, value?: unknown, error?: string) { this.pending.get(id)?.finish(value, error); }
  emit(event: PluginEvent) { for (const e of this.entries.values()) if (e.tokens.has(event.token)) e.window.webContents.send('beings:plugin-event', event); }
  updateTheme(theme: 'light' | 'dark') {
    for (const e of this.entries.values()) { e.window.webContents.send('beings:plugin-window-theme', theme); e.window.setBackgroundColor(theme === 'dark' ? '#212121' : '#ffffff'); }
  }
  close(id?: string) { for (const e of [...this.entries.values()]) if (!id || e.info.id === id) e.window.destroy(); }
}
