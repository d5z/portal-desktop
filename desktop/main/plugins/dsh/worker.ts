import { Loader, Group, interpolate, type EntryOptions } from '@deepseek-ai/cordis-plugin-loader';
import { installLocalServices } from './local-services';
import { compileIndexInjections, type IndexInjection } from './injections';
/** Minimal Town-owned DSH host: Cordis kernel + routes. No Harness app or agents. */
import { Context, Service, type Fiber } from '@deepseek-ai/cordis';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { readDshPackage, resolvePackageEntry, resolvePackageRoot } from './package';
import type { DshPluginState, DshClientModule, DshModelCompatibility } from '../../../shared/dsh-plugins';
import { DEFAULT_DSH_SERVICE_CONFIG, type DshServiceConfig } from '../../../shared/dsh-plugins';
import { installModelServices } from './model-services';

type Route = { kind: 'exact' | 'prefix'; path: string; handler(req: IncomingMessage, res: ServerResponse): unknown };
const token = process.env.TOWN_DSH_TOKEN!;
let ready = false;
const publishRoutes = () => { if (ready) process.send?.({ type: 'routes', routes: routes.map(({kind, path}) => ({kind, path})) }); };
const routes: Route[] = [], taps: { fiber: Fiber; transform: (html: string) => string }[] = [];
const clients: DshClientModule[] = [], plugins: DshPluginState['plugins'] = [];
const ctx = new Context();
let modelCompatibility: DshModelCompatibility | undefined;
const modelServices = { ...DEFAULT_DSH_SERVICE_CONFIG };
process.on('message', (message: any) => { if (message.type === 'model-compatibility') { modelCompatibility = message.value; Object.assign(modelServices, message.services); } });
const hostFibers: Fiber[] = [];
const matches = (r: Route, pathname: string) => r.kind === 'exact' ? pathname === r.path : pathname === r.path || pathname.startsWith(r.path + '/');
ctx.provide('webServer', {
  ctx, [Service.tracker]: { property: 'ctx' },
  get host() { return '127.0.0.1'; },
  get protocol() { return 'http:'; },
  get port() { const address = server.address(); return address && typeof address !== 'string' ? address.port : 0; },
  getOrigin() { if (!this.port) throw new Error('webServer 尚未开始监听'); return `http://127.0.0.1:${this.port}`; },
  register(route: Route) {
    if (!['exact', 'prefix'].includes(route.kind) || !route.path.startsWith('/') || route.path === '/' || route.path.startsWith('/@town-dsh/') || typeof route.handler !== 'function') throw new Error('无效或保留的插件路由。');
    if (routes.some(r => r.path === route.path && r.kind === route.kind)) throw new Error(`路由冲突：${route.path}`);
    routes.push(route); publishRoutes(); return this.ctx.effect(() => () => { const i = routes.indexOf(route); if (i >= 0) routes.splice(i, 1); publishRoutes(); });
  },
  tapIndex(transform: (html: string) => string) { const tap = { fiber: this.ctx.fiber, transform }; taps.push(tap); return this.ctx.effect(() => () => { const i = taps.indexOf(tap); if (i >= 0) taps.splice(i, 1); }); },
});
ctx.provide('connection', {
  ctx, [Service.tracker]: { property: 'ctx' },
  requestRejection,
  authenticatedUrl(baseUrl: string) {
    const url = new URL(baseUrl);
    if (url.origin !== (ctx.get('webServer') as any).getOrigin()) throw new Error('认证链接必须指向当前插件宿主');
    url.searchParams.set('token', token); return url.href;
  },
  get fetch() { const owner = this.ctx; return { register(def: any) {
    const route: Route = { kind: 'exact', path: def.path, async handler(req, res) {
      if (def.methods && !def.methods.includes(req.method)) { res.writeHead(405).end(); return; }
      const controller = new AbortController(); res.on('close', () => controller.abort());
      const request = new Request('http://localhost' + req.url, { method: req.method, headers: Object.fromEntries(Object.entries(req.headers).filter((entry): entry is [string, string] => typeof entry[1] === 'string')), signal: controller.signal, ...(!['GET', 'HEAD'].includes(req.method!) ? { body: Readable.toWeb(req) as ReadableStream, duplex: 'half' } : {}) });
      const response = await def.fetch(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) await pipeline(Readable.fromWeb(response.body as any), res); else res.end();
    } };
    if (routes.some(r => r.kind === route.kind && r.path === route.path)) throw new Error(`路由冲突：${route.path}`);
    routes.push(route); publishRoutes(); return owner.effect(() => () => { const i = routes.indexOf(route); if (i >= 0) routes.splice(i, 1); publishRoutes(); });
  } }; },
});
/** Match the listener before accepting credentials; browser launch tokens only enter at root. */
function requestRejection(req: Pick<IncomingMessage, 'url' | 'headers'>) {
  const origin = (ctx.get('webServer') as any).getOrigin();
  if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) return 403;
  if (req.headers['x-town-plugin-token'] === token || req.headers.authorization === `Bearer ${token}`) return undefined;
  if (req.headers.cookie?.split(';').some(part => part.trim() === `town_dsh=${token}`)) return undefined;
  const url = new URL(req.url || '/', origin);
  return url.pathname === '/' && url.searchParams.get('token') === token ? undefined : 401;
}
let localServices: Awaited<ReturnType<typeof installLocalServices>>;
const server = createServer(async (req, res) => {
  const rejection = requestRejection(req);
  if (rejection) { res.writeHead(rejection).end(); return; }
  try {
    const url = new URL(req.url!, 'http://localhost'), pathname = url.pathname;
    if (pathname === '/' && url.searchParams.get('token') === token) {
      res.writeHead(303, { 'set-cookie': `town_dsh=${token}; HttpOnly; SameSite=Strict; Path=/`, location: './', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }).end(); return;
    }
    if (pathname === '/') {
      process.send?.({ type: 'open-client' });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'" });
      res.end('<!doctype html><html lang="zh"><meta charset="utf-8"><title>Town</title><p>已打开 Town 客户端，可关闭此页面。</p></html>'); return;
    }
    if (await localServices.handle(req, res, pathname)) return;
    if (inlineScripts.has(pathname)) { res.setHeader('content-type', 'text/javascript'); res.end(inlineScripts.get(pathname)); return; }
    if (pathname.startsWith('/@town-dsh/client/')) {
      const client = clients.find(c => c.url === pathname);
      if (client) { res.setHeader('content-type', 'text/javascript'); res.end(await readFile(clientFiles.get(client.id)!)); return; }
    }
    const route = routes.find(r => r.kind === 'exact' && matches(r, pathname))
      ?? routes.filter(r => r.kind === 'prefix' && matches(r, pathname)).sort((a, b) => b.path.length - a.path.length)[0];
    if (!route) { res.writeHead(404).end(); return; }
    await route.handler(req, res);
  } catch (error) {
    if (res.destroyed) return;
    if (res.headersSent) { res.destroy(); return; }
    res.writeHead(500).end(String(error));
  }
});
const clientFiles = new Map<string, string>();
const inlineScripts = new Map<string, string>();
async function boot(entries: { root: string; plugin: DshPluginState['plugins'][number]; config?: Record<string, unknown> }[], services: DshServiceConfig) {
  localServices = await installLocalServices(ctx);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const loader = new Loader(ctx);
  loader.builtins.group = Group;
  const loaded: { record: DshPluginState['plugins'][number] & { limitations: string[] }; pkg: Awaited<ReturnType<typeof readDshPackage>>; root: string; ids: string[]; candidates: Awaited<ReturnType<typeof readDshPackage>>[] }[] = [];
  const treeRows: EntryOptions[] = [];
  const bases = new Map<string, unknown>();
  const namespaces = new Set<string>();
  for (const entry of entries) {
    const record = { ...entry.plugin, config: entry.config, limitations: [] as string[] }; plugins.push(record);
    if (!record.enabled) continue;
    const ids: string[] = [];
    try {
      const pkg = await readDshPackage(entry.root), candidates = pkg.rows.length ? [] : [pkg];
      const prepare = async (rows: EntryOptions[], parentActive = true): Promise<EntryOptions[]> => {
        const result: EntryOptions[] = [];
        for (const row of rows) {
          if (namespaces.has(row.id)) throw new Error(`重复的 Loader 行 ID：${row.id}`);
          namespaces.add(row.id); ids.push(row.id);
          // Keep disabled configuration rows, but do not resolve their optional
          // packages (including descendants of disabled groups).
          if (!parentActive || interpolate(ctx, row.disabled)) { result.push({ ...row, disabled: true }); continue; }
          if (row.group) { result.push({ ...row, name: 'cordis:group', config: await prepare(row.config, parentActive && !interpolate(ctx, row.disabled)) }); continue; }
          const base = pkg.data.dsh.bundle ? { ...row.config, ...(entry.config?.[row.id] as object ?? {}) } : entry.config ?? row.config ?? {};
          bases.set(row.id, base);
          const file = await resolvePackageEntry(entry.root, row.name);
          result.push({ ...row, name: pathToFileURL(file).href, config: localServices.config(row.id, base) });
          if (parentActive && !interpolate(ctx, row.disabled)) candidates.push(row.name === pkg.data.name ? pkg : await readDshPackage(await resolvePackageRoot(entry.root, row.name), false));
        }
        return result;
      };
      treeRows.push(...await prepare(pkg.rows));
      loaded.push({ record, pkg, root: entry.root, ids, candidates });
    } catch (error) { for (const id of ids) { namespaces.delete(id); bases.delete(id); } record.status = 'blocked'; record.error = String(error); }
  }
  await loader.root.update(treeRows);
  await loader.await();
  // Installed providers take priority over Town's host-selected model services.
  const fallbackServices = await installModelServices(ctx, services, process.env.DSH_HOME!, () => modelCompatibility);
  await loader.await();
  const owners = new Map<Fiber, string>();
  for (const { record, ids, candidates } of loaded) {
    try {
      for (const id of ids) {
        const entry = loader.store[id];
        if (!entry || entry.disabled || entry.options.group) continue;
        const fiber = entry.fiber;
        if (!fiber || fiber.state !== 2) {
          const missing = fiber?.state === 0 ? Object.keys(fiber.inject).filter(key => !fiber.ctx.get(key)) : [];
          if (missing.length) {
            record.missingServices = missing;
            throw new Error(`配置行 ${id} 缺少宿主服务：${missing.join('、')}`);
          }
          throw new Error(`配置行 ${id} 未能启动，详见 host.log。`);
        }
        hostFibers.push(fiber); owners.set(fiber, record.id);
        record.limitations.push(...Object.keys(fiber.inject).flatMap(service => {
          if (!fallbackServices.has(service)) return [];
          if (['llm', 'agentDefaultModel', 'credentials'].includes(service)) return [modelCompatibility?.message || '模型服务由宿主提供。'];
          if (service === 'speechToText') return ['语音识别需要宿主提供转写能力；当前 Being 接口尚未适配。'];
          return [];
        }));
        record.limitations = [...new Set(record.limitations)];
        localServices.register(id, fiber, fiber.runtime?.Config, interpolate(entry.ctx, bases.get(id)), record.id);
      }
      for (const candidate of candidates) {
        if (!candidate.client || clientFiles.has(candidate.data.name)) continue;
        clientFiles.set(candidate.data.name, candidate.client);
        clients.push({ id: candidate.data.name, owner: record.id, url: '/@town-dsh/client/' + encodeURIComponent(candidate.data.name), inject: candidate.data.dsh.client.inject || [], immediately: !!candidate.data.dsh.client.immediately });
      }
      record.status = 'active'; delete record.error;
    } catch (error) {
      for (const id of ids.reverse()) await loader.store[id]?.fiber?.dispose();
      record.status = 'blocked'; record.error = String(error);
    }
  }
  const injections: IndexInjection[] = [];
  const ownerOf = (fiber: Fiber) => {
    while (fiber.runtime && !owners.has(fiber)) fiber = fiber.parent.fiber;
    return owners.get(fiber);
  };
  // Listeners share a live array and may append after an await. Tag each write
  // at its source without serializing callbacks or mutating plugin-owned rows.
  const hooks = ctx.events._hooks['webserver/index-inject'] || [];
  await Promise.all(hooks.map(({ ctx: subscriber, callback }) => {
    const owner = ownerOf(subscriber.fiber);
    return callback(new Proxy(injections, {
      set(rows, key, value) { return Reflect.set(rows, key, key === 'length' ? value : { ...value, owner }); },
    }));
  }));
  const compiled = compileIndexInjections(injections, taps.map(({ fiber, transform }) => ({ owner: ownerOf(fiber), transform })), inlineScripts);
  const state: DshPluginState = { plugins, clients, injections: compiled, routes: routes.map(({ kind, path }) => ({ kind, path })) };
  ready = true; process.send?.({ type: 'ready', port: (server.address() as any).port, state });
}
process.once('message', (message: any) => { modelCompatibility = message.modelCompatibility; Object.assign(modelServices, message.services); void boot(message.entries, modelServices).catch(error => { process.send?.({ type: 'error', error: String(error) }); process.exitCode = 1; }); });
let stopping = false;
async function shutdown() {
  if (stopping) return; stopping = true;
  server.close();
  try { await Promise.allSettled(hostFibers.map(fiber => fiber.dispose())); } finally { process.exit(0); }
}
process.on('SIGTERM', () => { void shutdown(); });
process.on('message', (message: { type?: string }) => { if (message.type === 'shutdown') void shutdown(); });
process.on('disconnect', () => { void shutdown(); });
