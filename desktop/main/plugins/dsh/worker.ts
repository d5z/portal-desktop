import { Loader, Group, interpolate, type EntryOptions } from '@deepseek-ai/cordis-plugin-loader';
import { installLocalServices } from './local-services';
import { compileIndexInjections } from './injections';
/** Minimal Town-owned DSH host: Cordis kernel + routes. No Harness app or agents. */
import { Context, type Fiber } from '@deepseek-ai/cordis';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { readDshPackage, resolvePackageEntry, resolvePackageRoot } from './package';
import type { DshPluginState, DshClientModule } from '../../../shared/dsh-plugins';

type Route = { kind: 'exact' | 'prefix'; path: string; handler(req: IncomingMessage, res: ServerResponse): unknown };
const token = process.env.TOWN_DSH_TOKEN!;
let ready = false;
const publishRoutes = () => { if (ready) process.send?.({ type: 'routes', routes: routes.map(({kind, path}) => ({kind, path})) }); };
const routes: Route[] = [], taps: ((html: string) => string)[] = [];
const clients: DshClientModule[] = [], plugins: DshPluginState['plugins'] = [];
const ctx = new Context();
const hostFibers: Fiber[] = [];
const matches = (r: Route, pathname: string) => r.kind === 'exact' ? pathname === r.path : pathname === r.path || pathname.startsWith(r.path + '/');
ctx.provide('webServer', {
  register(route: Route) {
    if (!['exact', 'prefix'].includes(route.kind) || !route.path.startsWith('/') || route.path === '/' || route.path.startsWith('/@town-dsh/') || typeof route.handler !== 'function') throw new Error('无效或保留的插件路由。');
    if (routes.some(r => r.path === route.path && r.kind === route.kind)) throw new Error(`路由冲突：${route.path}`);
    routes.push(route); publishRoutes(); return () => { const i = routes.indexOf(route); if (i >= 0) routes.splice(i, 1); publishRoutes(); };
  },
  tapIndex(tap: (html: string) => string) { taps.push(tap); return () => { const i = taps.indexOf(tap); if (i >= 0) taps.splice(i, 1); }; },
});
ctx.provide('connection', {
  requestRejection: (req: IncomingMessage) => req.headers['x-town-plugin-token'] === token ? undefined : 403,
  fetch: { register(def: any) {
    const route: Route = { kind: 'exact', path: def.path, async handler(req, res) {
      if (def.methods && !def.methods.includes(req.method)) { res.writeHead(405).end(); return; }
      const controller = new AbortController(); res.on('close', () => controller.abort());
      const request = new Request('http://localhost' + req.url, { method: req.method, headers: Object.fromEntries(Object.entries(req.headers).filter((entry): entry is [string, string] => typeof entry[1] === 'string')), signal: controller.signal, ...(!['GET', 'HEAD'].includes(req.method!) ? { body: Readable.toWeb(req) as ReadableStream, duplex: 'half' } : {}) });
      const response = await def.fetch(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) await pipeline(Readable.fromWeb(response.body as any), res); else res.end();
    } };
    if (routes.some(r => r.kind === route.kind && r.path === route.path)) throw new Error(`路由冲突：${route.path}`);
    routes.push(route); publishRoutes(); return () => { const i = routes.indexOf(route); if (i >= 0) routes.splice(i, 1); publishRoutes(); };
  } },
});
let localServices: Awaited<ReturnType<typeof installLocalServices>>;
const server = createServer(async (req, res) => {
  if (req.headers['x-town-plugin-token'] !== token) { res.writeHead(403).end(); return; }
  try {
    const pathname = new URL(req.url!, 'http://localhost').pathname;
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
async function boot(entries: { root: string; plugin: DshPluginState['plugins'][number]; config?: Record<string, unknown> }[]) {
  localServices = await installLocalServices(ctx);
  const loader = new Loader(ctx);
  loader.builtins.group = Group;
  const loaded: { record: DshPluginState['plugins'][number]; pkg: Awaited<ReturnType<typeof readDshPackage>>; root: string; ids: string[]; candidates: Awaited<ReturnType<typeof readDshPackage>>[] }[] = [];
  const treeRows: EntryOptions[] = [];
  const bases = new Map<string, unknown>();
  const namespaces = new Set<string>();
  for (const entry of entries) {
    const record = { ...entry.plugin, config: entry.config }; plugins.push(record);
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
  for (const { record, ids, candidates } of loaded) {
    try {
      for (const id of ids) {
        const entry = loader.store[id];
        if (!entry || entry.disabled || entry.options.group) continue;
        const fiber = entry.fiber;
        if (!fiber || fiber.state !== 2) throw new Error(`配置行 ${id} 启动失败；缺少宿主服务：${fiber ? Object.keys(fiber.inject).filter(key => !fiber.ctx.get(key)).join('、') : '模块无法加载（见 host.log）'}`);
        hostFibers.push(fiber);
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
  const injections: DshPluginState['injections'] = [];
  await (ctx as any).parallel('webserver/index-inject', injections);
  const compiled = compileIndexInjections(injections, taps, inlineScripts);
  const state: DshPluginState = { plugins, clients, injections: compiled, routes: routes.map(({ kind, path }) => ({ kind, path })) };
  server.listen(0, '127.0.0.1', () => { ready = true; process.send?.({ type: 'ready', port: (server.address() as any).port, state }); });
}
process.once('message', (message: any) => { void boot(message.entries).catch(error => { process.send?.({ type: 'error', error: String(error) }); process.exitCode = 1; }); });
let stopping = false;
async function shutdown() {
  if (stopping) return; stopping = true;
  server.close();
  try { await Promise.allSettled(hostFibers.map(fiber => fiber.dispose())); } finally { process.exit(0); }
}
process.on('SIGTERM', () => { void shutdown(); });
process.on('disconnect', () => { void shutdown(); });
