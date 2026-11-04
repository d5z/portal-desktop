import { fork, execFile } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, mkdtemp } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import type { DshPlugin, DshPluginState, DshActivationFailure } from '../../../shared/dsh-plugins';
import { publicErrorMessage } from '../../../shared/errors';
import { packageName, readDshPackage } from './package';
import { externalizePluginScripts } from './html';
const execute = promisify(execFile);
type Entry = { root: string; plugin: DshPlugin; config?: Record<string, unknown> };
const empty = (): DshPluginState => ({ plugins: [], clients: [], injections: [], routes: [] });

/** Durable installation records and a disposable, independent plugin host process. */
export class DshPluginManager {
  private entries: Entry[] = [];
  private child?: ChildProcess;
  private port = 0;
  private token = '';
  private documentScripts = new Map<string, string>();
  private snapshot = empty();
  private pending: Promise<unknown> = Promise.resolve();
  private initializing?: Promise<void>;
  private closing = false;
  constructor(readonly home: string, readonly worker: string, readonly npmCLI: string, readonly shellOrigin: string) {}
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation); this.pending = result.catch(() => {}); return result;
  }
  initialize() {
    return this.initializing ??= this.serial(() => this.load()).catch(error => { this.snapshot.error = String(error); });
  }
  whenReady() { return this.initializing ?? Promise.resolve(); }
  private async load() {
    await mkdir(this.home, { recursive: true, mode: 0o700 });
    try {
      this.entries = JSON.parse(await readFile(path.join(this.home, 'plugins.json'), 'utf8'));
      if (!Array.isArray(this.entries)) throw new Error('第三方插件安装记录损坏。');
      for (const entry of this.entries) {
        packageName(entry.plugin?.id);
        if (!path.resolve(entry.root).startsWith(path.resolve(this.home, 'packages') + path.sep)) throw new Error('第三方插件路径无效。');
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { this.entries = []; this.snapshot.error = String(error); return; } }
    await this.restart();
  }
  state() { return this.snapshot; }
  private async save() {
    const file = path.join(this.home, 'plugins.json');
    await writeFile(file + '.tmp', JSON.stringify(this.entries, null, 2), { mode: 0o600 });
    await rename(file + '.tmp', file);
  }
  async prepare(source: string) {
    if (typeof source !== 'string' || !source.trim() || source.length > 4096 || source.startsWith('-') || /[\r\n\0]/.test(source)) throw new Error('请输入 npm 包名、Git URL、本地目录或压缩包路径。');
    const packages = path.join(this.home, 'packages'); await mkdir(packages, { recursive: true });
    const stage = await mkdtemp(path.join(packages, 'package-'));
    try {
      await writeFile(path.join(stage, 'package.json'), JSON.stringify({ name: 'town-third-party-install', private: true, dependencies: { '@deepseek-ai/cordis': '4.0.5', '@deepseek-ai/dsh-typert-protocol': '0.2.1-rc.5', '@deepseek-ai/dsh-settings': '0.2.1-rc.5' } }));
      await execute(process.execPath, [this.npmCLI, 'install', '--prefix', stage, '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund', '--install-links', '--save-exact', '--', source], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', npm_config_update_notifier: 'false' }, timeout: 180000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
      });
      const manifest = JSON.parse(await readFile(path.join(stage, 'package.json'), 'utf8'));
      const names = Object.keys(manifest.dependencies || {}).filter(name => !['@deepseek-ai/cordis', '@deepseek-ai/dsh-typert-protocol', '@deepseek-ai/dsh-settings'].includes(name));
      if (names.length !== 1) throw new Error('一次只能安装一个 DSH 插件包。');
      packageName(names[0]);
      const root = path.join(stage, 'node_modules', names[0]);
      const pkg = await readDshPackage(root, true, true);
      const plugin: DshPlugin = { id: pkg.data.name, version: pkg.data.version, description: String(pkg.data.description || ''), source,
        enabled: true, installedAt: new Date().toISOString(), status: 'disabled' };
      return { entry: { root, plugin } as Entry, build: async () => {
        await execute(process.execPath, [this.npmCLI, 'rebuild', '--prefix', stage, '--foreground-scripts'], {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', npm_config_update_notifier: 'false' }, timeout: 180000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
        });
        await readDshPackage(root);
      }, discard: () => rm(stage, { recursive: true, force: true }) };
    } catch (error) { await rm(stage, { recursive: true, force: true }); throw error; }
  }
  install(entry: Entry) { return this.serial(async () => {
    if (this.snapshot.error) throw new Error(this.snapshot.error);
    const previous = this.entries.find(p => p.plugin.id === entry.plugin.id);
    const oldEntries = this.entries;
    const configFile = path.join(this.home, 'config', encodeURIComponent(entry.plugin.id) + '.json');
    entry.config = previous?.config ?? await readFile(configFile, 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
    this.entries = [...this.entries.filter(p => p.plugin.id !== entry.plugin.id), entry];
    try {
      await this.restart();
      const activated = this.snapshot.plugins.find(p => p.id === entry.plugin.id);
      if (previous && activated?.status !== 'active') {
        const reason = activated?.missingServices?.length
          ? `新版与当前 Town 不适配，缺少服务：${activated.missingServices.join('、')}。`
          : publicErrorMessage(activated?.error ?? '新版未能启动。', '新版未能启动，请查看插件宿主日志。');
        throw new Error(`${entry.plugin.id} 更新失败，已恢复旧版。${reason}`);
      }
      if (activated?.status !== 'active') {
        this.markFailed(entry, activated);
        await this.restart();
      }
      await this.save();
      return entry.plugin.enabled;
    } catch (error) { this.entries = oldEntries; await this.save(); await this.restart(); throw error; }
  }); }
  private markFailed(entry: Entry, result?: DshPlugin, error?: string) {
    entry.plugin = { ...entry.plugin, enabled: false, status: 'disabled', missingServices: result?.missingServices,
      error: (error || result?.error || '插件未能启动。').slice(0, 4096) };
  }
  // Only apply a renderer verdict to the package revision that was actually tested.
  reportFailures(failures: DshActivationFailure[]) { return this.serial(async () => {
    if (!Array.isArray(failures)) throw new Error('无效的插件启动结果。');
    let changed = false;
    for (const {id, installedAt, error} of failures) {
      const entry = this.entries.find(e => e.plugin.id === id && e.plugin.installedAt === installedAt);
      if (!entry?.plugin.enabled || typeof error !== 'string') continue;
      const plugin = this.snapshot.plugins.find(p => p.id === id);
      if (plugin?.status === 'error') continue; // The shared worker exited before the renderer reported back.
      this.markFailed(entry, plugin, error);
      changed = true;
    }
    if (changed) { await this.save(); await this.restart(); }
  }); }
  enable(id: string, enabled: boolean) { return this.serial(async () => {
    if (typeof enabled !== 'boolean') throw new Error('无效的启停状态。');
    const entry = this.entry(id);
    entry.plugin = { ...entry.plugin, enabled, status: 'disabled', error: undefined, missingServices: undefined };
    await this.restart();
    const result = this.snapshot.plugins.find(p => p.id === id);
    if (enabled && result?.status !== 'active') {
      this.markFailed(entry, result);
      await this.save(); await this.restart();
      throw new Error(`${id} 启用失败，插件已停用。`);
    }
    await this.save();
  }); }
  disableAll() { return this.serial(async () => { for (const entry of this.entries) entry.plugin.enabled = false; await this.save(); await this.restart(); }); }
  configure(id: string, config: Record<string, unknown>) { return this.serial(async () => {
    if (!config || Array.isArray(config) || typeof config !== 'object' || JSON.stringify(config).length > 65536) throw new Error('插件配置必须为 64 KB 以内的 JSON 对象。');
    this.entry(id).config = config;
    await mkdir(path.join(this.home, 'config'), {recursive:true});
    const file = path.join(this.home, 'config', encodeURIComponent(id) + '.json');
    await writeFile(file + '.tmp', JSON.stringify(config), {mode:0o600}); await rename(file + '.tmp', file);
    await this.save(); await this.restart();
  }); }
  remove(id: string) { return this.serial(async () => {
    this.entry(id); this.entries = this.entries.filter(entry => entry.plugin.id !== id);
    await this.save(); await this.restart();
    // Keep immutable package copies and DSH_HOME data for recovery; no user data deletion.
  }); }
  private entry(id: string) { packageName(id); const entry = this.entries.find(p => p.plugin.id === id); if (!entry) throw new Error('第三方插件不存在。'); return entry; }
  matches(pathname: string) { return pathname.startsWith('/@town-dsh/') || this.snapshot.routes.some(r => r.kind === 'exact' ? pathname === r.path : pathname === r.path || pathname.startsWith(r.path + '/')); }
  async resource(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (!this.port || !this.matches(url.pathname)) return new Response('Plugin host unavailable', { status: 503 });
    const origin = request.headers.get('origin');
    if (origin && origin !== this.shellOrigin && origin !== 'beings://desktop') return new Response('Forbidden origin', { status: 403 });
    if (request.method === 'GET' && this.documentScripts.has(url.pathname)) return new Response(this.documentScripts.get(url.pathname), {headers:{'content-type':'text/javascript','cache-control':'no-store'}});
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': this.shellOrigin, 'access-control-allow-methods': 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS', 'access-control-allow-headers': 'content-type' } });
    const headers = new Headers(request.headers); headers.set('x-town-plugin-token', this.token); headers.delete('host'); headers.delete('origin');
    const controller = new AbortController();
    const cancel = () => controller.abort(request.signal.reason);
    request.signal.addEventListener('abort', cancel, { once: true });
    if (request.signal.aborted) cancel();
    const timer = setTimeout(() => controller.abort(new Error('插件响应超时')), 30000);
    let response: Response;
    try { response = await fetch(`http://127.0.0.1:${this.port}${url.pathname}${url.search}`, {
      method: request.method, headers, redirect: 'manual', signal: controller.signal,
      ...(!['GET', 'HEAD'].includes(request.method) ? { body: await request.arrayBuffer() } : {}),
    });
    } catch (error) { request.signal.removeEventListener('abort', cancel); throw error; } finally { clearTimeout(timer); }
    const outgoing = new Headers(response.headers);
    // Node fetch decodes compressed bodies but retains their wire headers.
    // Electron must receive headers describing the decoded resource.
    if (response.body && outgoing.has('content-encoding')) {
      outgoing.delete('content-encoding'); outgoing.delete('content-length');
    }
    outgoing.set('access-control-allow-origin', this.shellOrigin); outgoing.set('cache-control', 'no-store');
    if (response.ok && request.method === 'GET' && outgoing.get('content-type')?.includes('text/html')) {
      outgoing.delete('content-length'); outgoing.delete('content-encoding');
      try { return new Response(externalizePluginScripts(await response.text(), this.documentScripts, request.url), {status:response.status,headers:outgoing}); } finally { request.signal.removeEventListener('abort', cancel); }
    }
    if (!response.body) { request.signal.removeEventListener('abort', cancel); return new Response(null, { status: response.status, headers: outgoing }); }
    const reader = response.body.getReader();
    const cleanup = () => request.signal.removeEventListener('abort', cancel);
    const body = new ReadableStream({
      async pull(stream) { try { const next = await reader.read(); if (next.done) { cleanup(); stream.close(); } else stream.enqueue(next.value); } catch (error) { cleanup(); stream.error(error); } },
      async cancel(reason) { cleanup(); controller.abort(reason); await reader.cancel(reason).catch(() => {}); },
    });
    return new Response(body, { status: response.status, headers: outgoing });
  }
  private async restart() {
    this.documentScripts.clear();
    await this.stop();
    if (this.closing) return;
    this.snapshot = { ...empty(), plugins: this.entries.map(e => ({ ...e.plugin, config: e.config, status: 'disabled', error: e.plugin.enabled ? undefined : e.plugin.error })) };
    this.token = randomUUID();
    const child = fork(this.worker, [], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: path.join(this.home, 'data'), TOWN_DSH_TOKEN: this.token, TOWN_DSH_DOCUMENT_URL: this.shellOrigin === 'null' ? 'beings://desktop/' : this.shellOrigin + '/' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], execArgv: [] });
    this.child = child;
    const logFile = path.join(this.home, 'host.log');
    for (const stream of [child.stdout, child.stderr]) stream?.on('data', chunk => { void import('node:fs/promises').then(async ({ appendFile, stat, truncate }) => { if ((await stat(logFile).catch(() => ({ size: 0 }))).size > 2 * 1024 * 1024) await truncate(logFile); await appendFile(logFile, chunk, { mode: 0o600 }); }).catch(() => {}); });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('第三方插件启动超时。')), 30000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', () => {
          clearTimeout(timer); this.port = 0;
          this.snapshot = { ...empty(), plugins: this.snapshot.plugins };
          for (const plugin of this.snapshot.plugins) if (plugin.enabled) { plugin.status = 'error'; plugin.error = '插件宿主已退出，请停用问题插件后重新启用。'; }
          reject(new Error('插件宿主在启动期间退出。'));
        });
        child.on('message', (message: any) => {
          if (message.type === 'routes') this.snapshot.routes = message.routes;
          if (message.type === 'ready') { clearTimeout(timer); this.port = message.port; this.snapshot = message.state; resolve(); }
          if (message.type === 'error') { clearTimeout(timer); reject(new Error(message.error)); }
        });
        child.send({ entries: this.entries });
      });
    } catch (error) {
      await this.stop();
      for (const plugin of this.snapshot.plugins) if (plugin.enabled) { plugin.status = 'error'; plugin.error = String(error); }
    }
  }
  async shutdown() { this.closing = true; await this.stop(); }
  resumeAfterFailedShutdown() {
    return this.serial(async () => {
      if (!this.closing) return;
      this.closing = false;
      await this.restart();
    });
  }
  async stop() {
    const child = this.child; this.child = undefined; this.port = 0;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 1500);
      child.once('exit', () => { clearTimeout(timer); resolve(); }); child.kill('SIGTERM');
    });
  }
}
