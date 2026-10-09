import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parsePluginManifest, pluginId, type InstalledPlugin, type PluginLibrary, type PluginPlacement } from '../../shared/plugins';
import { PLUGIN_SDK } from '../../shared/plugin-sdk';
import { capabilityFor, eventCapability, type PluginServices } from './services';
import type { PluginEvent } from '../../shared/plugins';
import type { PluginEventTopic } from '../../../plugins/sdk';

const MAX_HTML = 8 * 1024 * 1024;
const MAX_DATA = 1024 * 1024;
export const PLUGIN_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts";
interface Package extends InstalledPlugin { html: string }
interface Session { id: string; view: string; command?: string; slot?: string; html: string; calls: number; since: number; key: string; controller: AbortController; subscriptions: Map<number, PluginEventTopic> }
async function boundedRead(file: string, limit: number) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw new Error('插件文件超出大小限制或不是普通文件。');
  const text = await readFile(file, 'utf8');
  if (Buffer.byteLength(text) > limit) throw new Error('插件文件超出大小限制。');
  return text;
}
export async function readPlugin(directory: string): Promise<Pick<Package, 'manifest' | 'html' | 'sha256'>> {
  const manifest = parsePluginManifest(JSON.parse((await boundedRead(path.join(directory, 'desktop.plugin.json'), 65536)).replace(/^\uFEFF/, '')));
  const html = await boundedRead(path.join(directory, manifest.entry), MAX_HTML);
  if (!html.trim()) throw new Error('插件页面为空。');
  return { manifest, html, sha256: createHash('sha256').update(JSON.stringify(manifest)).update(html).digest('hex') };
}
export class PluginRegistry {
  private sessions = new Map<string, Session>();
  private queue: Promise<unknown> = Promise.resolve();
  private eventRevision = 0;
  constructor(private root: string, private services?: PluginServices, private emit?: (event: PluginEvent) => void) {}
  private file(area: 'packages' | 'data', id: string) { pluginId(id); return path.join(this.root, area, `${id}.json`); }
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn); this.queue = result.catch(() => {}); return result;
  }
  private async atomic(file: string, value: unknown) {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); await rename(temporary, file); }
    finally { await rm(temporary, { force: true }); }
  }
  private async package(id: string): Promise<Package> {
    const value = JSON.parse(await boundedRead(this.file('packages', id), MAX_HTML * 6 + 65536));
    value.manifest = parsePluginManifest(value.manifest);
    if (value.manifest.id !== id || typeof value.html !== 'string' || Buffer.byteLength(value.html) > MAX_HTML || typeof value.enabled !== 'boolean' || !['local', 'grove'].includes(value.source?.kind)) throw new Error('插件安装记录已损坏。');
    const hash = createHash('sha256').update(JSON.stringify(value.manifest)).update(value.html).digest('hex');
    if (hash !== value.sha256) throw new Error('插件内容校验失败，请重新安装。');
    return value;
  }
  async list(): Promise<PluginLibrary> {
    const result: PluginLibrary = { plugins: [], problems: [] };
    const entries = await readdir(path.join(this.root, 'packages')).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
    for (const name of entries.filter(n => n.endsWith('.json')).sort()) {
      try { const { html: _, ...plugin } = await this.package(name.slice(0, -5)); result.plugins.push(plugin); }
      catch { result.problems.push(`${name}：安装记录无法读取，请移除此记录后重新导入。`); }
    }
    return result;
  }
  install(bundle: Awaited<ReturnType<typeof readPlugin>>, source: InstalledPlugin['source']) {
    return this.serialize(async () => {
      const file = this.file('packages', bundle.manifest.id);
      const present = await lstat(file).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return false; throw error; });
      if (present) throw new Error('同 ID 插件已安装。请先卸载；插件数据会保留。');
      await this.atomic(file, { ...bundle, source, enabled: true, installedAt: new Date().toISOString() });
    });
  }
  setEnabled(id: string, enabled: boolean) {
    return this.serialize(async () => {
      if (typeof enabled !== 'boolean') throw new Error('无效的插件状态。');
      const value = await this.package(id);
      await this.atomic(this.file('packages', id), { ...value, enabled });
      this.revoke(id);
    });
  }
  setPlacement(id: string, view: string, placement: PluginPlacement) {
    return this.serialize(async () => {
      const value = await this.package(id);
      if (!value.manifest.contributes.views.some(v => v.id === view) || !['page', 'navigation', 'window'].includes(placement)) throw new Error('无效的插件显示位置。');
      await this.atomic(this.file('packages', id), { ...value, placements: { ...value.placements, [view]: placement } });
    });
  }
  remove(id: string) {
    return this.serialize(async () => { this.revoke(id); await rm(this.file('packages', id), { force: true }); });
  }
  private drop(token: string) { this.sessions.get(token)?.controller.abort(); this.sessions.delete(token); }
  invalidate() { for (const token of this.sessions.keys()) this.drop(token); }
  private revoke(id: string) { for (const [token, session] of this.sessions) if (session.id === id) this.drop(token); }
  close(token: string) { return this.serialize(async () => { this.drop(token); }); }
  open(id: string, view: string, command?: string, slot?: string) {
    return this.serialize(async () => {
      const value = await this.package(id);
      if (!value.enabled || !value.manifest.contributes.views.some(v => v.id === view)) throw new Error('插件未启用或页面不存在。');
      if (command !== undefined && !value.manifest.contributes.commands?.some(c => c.id === command && c.view === view)) throw new Error('插件命令不存在。');
      if (slot !== undefined && !value.manifest.contributes.slots?.some(c => c.id === slot && c.view === view)) throw new Error('插件插槽不存在。');
      if (this.sessions.size >= 16) throw new Error('打开的插件页面过多。');
      const token = randomUUID();
      this.sessions.set(token, { id, view, command, slot, html: value.html, calls: 0, since: Date.now(), key: this.services?.contextKey() || '', controller: new AbortController(), subscriptions: new Map() });
      return { token, url: `beings://plugins/${token}.html` };
    });
  }
  document(url: URL): Response {
    const token = /^\/([a-f0-9-]{36})\.html$/.exec(url.pathname)?.[1];
    const session = token && this.sessions.get(token);
    if (!session || url.search || url.hash) return new Response('Plugin session closed', { status: 404 });
    const bootstrap = `<script data-channel="${token}" data-view="${session.view}" data-command="${session.command || ''}" data-slot="${session.slot || ''}">${PLUGIN_SDK}</script>`;
    return new Response(`<!doctype html>${bootstrap}${session.html.replace(/<!doctype[^>]*>/i, '')}`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': PLUGIN_CSP } });
  }
  /** Notifications carry no private content. Subscriptions were capability-checked at registration. */
  publish(topic: PluginEventTopic) {
    eventCapability(topic);
    const revision = ++this.eventRevision, at = new Date().toISOString();
    for (const [token, session] of this.sessions) {
      if (session.key !== (this.services?.contextKey() || '')) { this.drop(token); continue; }
      for (const [id, subscribed] of session.subscriptions) if (subscribed === topic)
        this.emit?.({ token, type: 'subscription', data: { id, event: { topic, revision, at } } });
    }
  }
  async call(token: string, method: string, value?: unknown): Promise<unknown> {
    const authorized = await this.serialize(async () => {
      const session = this.sessions.get(token);
      if (!session) throw new Error('插件会话已关闭。');
      if (Date.now() - session.since > 10000) { session.since = Date.now(); session.calls = 0; }
      if (++session.calls > 120) throw new Error('插件请求过于频繁。');
      const plugin = await this.package(session.id);
      if (!plugin.enabled || !plugin.manifest.capabilities.includes(capabilityFor(method, value))) throw new Error('插件未获准使用此能力，请检查安装时声明的权限。');
      if (session.key !== (this.services?.contextKey() || '')) { this.drop(token); throw new Error('Being、Town 或对话场景已切换，请重新打开插件。'); }
      if (method === 'events.subscribe' || method === 'events.unsubscribe') {
        const data = value as { id: number; topic: PluginEventTopic };
        if (!Number.isSafeInteger(data.id) || data.id < 1) throw new Error('无效的订阅 ID。');
        if (method === 'events.unsubscribe') { if (session.subscriptions.get(data.id) === data.topic) session.subscriptions.delete(data.id); }
        else {
          if (session.subscriptions.has(data.id) || session.subscriptions.size >= 32) throw new Error('重复订阅或订阅数量超过 32。');
          session.subscriptions.set(data.id, data.topic);
        }
        return { stored: null };
      }
      if (method.startsWith('storage.')) {
        const file = this.file('data', session.id);
        if (method === 'storage.load') {
          try { return { stored: JSON.parse(await boundedRead(file, MAX_DATA)) as unknown }; }
          catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { stored: null }; throw error; }
        }
        if (method === 'storage.patch') {
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('增量数据必须是 JSON 对象。');
          let current: unknown = {};
          try { current = JSON.parse(await boundedRead(file, MAX_DATA)); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
          if (current !== null && (typeof current !== 'object' || Array.isArray(current))) throw new Error('已有插件数据不是对象，无法增量保存。');
          // Own-key spread preserves JSON keys without invoking prototype setters.
          value = { ...(current as Record<string, unknown> || {}), ...value };
        }
        const json = JSON.stringify(value);
        if (json === undefined || Buffer.byteLength(json) > MAX_DATA) throw new Error('插件数据必须是 JSON，且不超过 1 MB。');
        await this.atomic(file, JSON.parse(json));
        return { stored: null };
      }
      return { session, plugin };
    });
    if ('stored' in authorized) return authorized.stored;
    const { session, plugin } = authorized;
    const check = () => {
      if (this.sessions.get(token) !== session || session.controller.signal.aborted) throw new Error('插件会话已关闭。');
      if (session.key !== (this.services?.contextKey() || '')) { this.drop(token); throw new Error('Being、Town 或对话场景已切换，请重新打开插件。'); }
    };
    check();
    if (!this.services) throw new Error('此客户端没有提供插件服务。');
    const result = await this.services.call(method, value, { manifest: plugin.manifest, signal: session.controller.signal, check,
      emit: text => { check(); this.emit?.({ token, type: 'being.delta', data: { text } }); } });
    check();
    return result;
  }
}
