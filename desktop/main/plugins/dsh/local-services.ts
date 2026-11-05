import { Context, Service, resolveConfig, type Fiber } from '@deepseek-ai/cordis';
import TimerService from '@deepseek-ai/cordis-plugin-timer';
import { isVolatile } from '@deepseek-ai/cosmokit';
import { redactSecrets } from '@deepseek-ai/dsh-settings';
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { LocalCommands } from './commands';
import { CHAT_SCENE_ACTIVITY_LABELS, type ChatSceneActivity } from '../../../shared/types';

type Row = { owner: string; fiber: Fiber; schema: any; base: any; revision: number; autoGenerate: boolean };
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const object = (value: any) => value && typeof value === 'object' && !Array.isArray(value);
function merge(base: any, user: any): any {
  if (user === undefined) return base;
  if (!object(base) || !object(user)) return user;
  return Object.fromEntries([...new Set([...Object.keys(base), ...Object.keys(user)])].filter(key => !forbidden.has(key)).map(key => [key, merge(base[key], Object.hasOwn(user, key) ? user[key] : undefined)]));
}
export async function installLocalServices(ctx: Context) {
  new TimerService(ctx);
  const commands = new LocalCommands(ctx);
  let activity: Record<string, ChatSceneActivity> = {}, activitySeq = 0;
  ctx.provide('townActivity', { getSnapshot: () => ({ ...activity }) });
  const file = path.join(process.env.DSH_HOME!, 'config-forms.json');
  await mkdir(path.dirname(file), { recursive: true });
  const persisted: Record<string, { value: any; revision: number }> = await readFile(file, 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return {}; throw error; });
  const rows = new Map<string, Row>();
  const presentationByFiber = new WeakMap<Fiber, boolean>();
  let pending: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => { const result = pending.then(fn); pending = result.catch(() => {}); return result; };
  const redact = (schema: any, input: any): any => {
    if (isVolatile(input)) return redact(schema, input.get());
    if (schema?.meta?.role === 'secret') return undefined;
    if (!input || typeof input !== 'object') return input;
    if (Array.isArray(input)) return input.map(value => redact(schema?.inner, value));
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) { const redacted = redact(schema?.dict?.[key], value); if (redacted !== undefined) result[key] = redacted; }
    return result;
  };
  const plainSchema = (schema: any): any => {
    const data = schema?.toJSON?.() ?? { type: 'object', dict: {} };
    const walk = (node: any) => { if (!node || typeof node !== 'object') return; if (node.meta) { delete node.meta.volatile; if (node.meta.role === 'secret') delete node.meta.default; } Object.values(node).forEach(walk); };
    walk(data); return data;
  };
  const view = (ns: string, row: Row) => {
    const safe = (value: any) => row.schema ? redactSecrets(row.schema, redact(undefined, value)) : { value: redact(undefined, value), secrets: [] };
    const effective = safe(row.fiber.config);
    return { ns, owner: row.owner, autoGenerate: row.autoGenerate, schema: plainSchema(row.schema), value: effective.value, base: safe(row.base).value, user: safe(persisted[ns]?.value).value, revision: row.revision, applies: 'live', secrets: effective.secrets };
  };
  const mutate = (ns: string, ops: any[], expected?: number) => serial(async () => {
    const row = rows.get(ns); if (!row) throw new Error(`未知配置命名空间：${ns}`);
    if (expected !== undefined && expected !== row.revision) throw new Error('SETTINGS_CONFLICT');
    if (!Array.isArray(ops) || ops.length > 1000) throw new Error('无效配置操作');
    let user = structuredClone(persisted[ns]?.value ?? {});
    for (const op of ops) {
      if (!['set', 'unset'].includes(op.op) || !Array.isArray(op.path) || op.path.some((key: unknown) => typeof key !== 'string' || forbidden.has(key))) throw new Error('无效配置路径');
      if (!op.path.length) { if (op.op === 'set' && (!op.value || typeof op.value !== 'object' || Array.isArray(op.value))) throw new Error('配置根必须为对象'); user = op.op === 'set' ? op.value : {}; continue; }
      let target = user;
      for (const key of op.path.slice(0, -1)) { if (!target[key] || typeof target[key] !== 'object') target[key] = {}; target = target[key]; }
      const key = op.path.at(-1);
      if (op.op === 'set') target[key] = op.value; else if (Array.isArray(target) && /^(0|[1-9][0-9]*)$/.test(key)) target.splice(Number(key), 1); else delete target[key];
    }
    const config = merge(row.base, user);
    resolveConfig(row.fiber.runtime!, config);
    const previous = persisted[ns]; persisted[ns] = { value: user, revision: row.revision + 1 };
    try { await writeFile(file + '.tmp', JSON.stringify(persisted), { mode: 0o600 }); await rename(file + '.tmp', file); }
    catch (error) { if (previous) persisted[ns] = previous; else delete persisted[ns]; throw error; }
    row.revision++; row.fiber.update(config); await row.fiber.await();
    (ctx as any).emit('settings/document-updated', ns, row.revision);
    return view(ns, row);
  });
  class Settings extends Service {
    constructor() { super(ctx, 'settings'); }
    get writable() { return true; }
    get documentPath() { return file; }
    async prepareDocument() { return file; }
    describe() { return [...rows].map(([ns, row]) => view(ns, row)); }
    configure(presentation: { auto?: boolean }, owner = this.ctx.fiber) { const row = [...rows.values()].find(r => r.fiber === owner); if (!row) { presentationByFiber.set(owner, presentation.auto ?? true); return () => { presentationByFiber.delete(owner); }; } const previous = row.autoGenerate; row.autoGenerate = presentation.auto ?? true; return () => { row.autoGenerate = previous; }; }
    update(ns: string, patch: object, expected?: number) { return mutate(ns, Object.entries(patch).map(([key, value]) => ({ op: 'set', path: [key], value })), expected); }
    replace(ns: string, value: object, expected?: number) { return mutate(ns, [{ op: 'set', path: [], value }], expected); }
    mutate = mutate;
  }
  const settings = new Settings();
  async function handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
    if (pathname === '/@town-dsh/events') {
      const event = new URL(req.url!, 'http://localhost').searchParams.get('event');
      if (!event || event.length > 200) { res.writeHead(400).end(); return true; }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' }); res.write(': ready\n\n');
      const off = (ctx as any).on(event, (...args: unknown[]) => res.write(`data: ${JSON.stringify(args)}\n\n`));
      const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 15000);
      res.on('close', () => { clearInterval(heartbeat); off(); }); return true;
    }
    if (pathname !== '/@town-dsh/rpc') return false;
    res.setHeader('content-type', 'application/json');
    if (req.method !== 'POST') { res.writeHead(405).end(); return true; }
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > 1024 * 1024) throw new Error('RPC 请求过大');
        chunks.push(bytes);
      }
      // Decode once: an HTTP chunk may end in the middle of a UTF-8 character.
      const { service: key, method, args = [] } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (typeof key !== 'string' || typeof method !== 'string' || forbidden.has(key) || forbidden.has(method) || !Array.isArray(args)) throw new Error('无效 RPC 请求');
      let value: unknown;
      if (key === 'settings' && method === 'describe') value = { writable: true, hasDocument: true, namespaces: settings.describe() };
      else if (key === 'commands' && method === 'list') value = commands.list();
      else if (key === 'commands' && method === 'execute') value = await commands.execute(args[0], args[1], args[2]);
      else if (key === 'townActivity' && method === 'update') {
        const next = args[0];
        if (!object(next) || Object.keys(next).length > 500 || Object.entries(next).some(([id, status]) => !id || id.length > 256 || typeof status !== 'string' || !Object.hasOwn(CHAT_SCENE_ACTIVITY_LABELS, status))) throw new Error('无效 Town 场景状态');
        for (const [id, status] of Object.entries(next)) {
          if (!activity[id] || activity[id] === status) continue;
          const kind = status === 'done' ? 'completed' : status === 'error' || status === 'timeout' ? 'error' : undefined;
          if (kind) (ctx as any).emit('session/event', { header: { id, origin: 'town' } }, { type: 'turn/end', seq: ++activitySeq, data: { reason: { kind } } });
        }
        activity = next; (ctx as any).emit('town/activity', { ...activity }); value = true;
      }
      else if (key === 'settings' && method === 'mutate') value = await mutate(args[0], args[1], args[2]);
      else {
        const service: any = ctx.get(key);
        const marker = service && remoteMethods(service).find(m => (m.exportName ?? m.method) === method);
        if (!marker || marker.invocation.kind !== 'direct') throw new Error(`未提供本地 Remote 方法：${key}.${method}`);
        value = await service[marker.method](...args);
        if (marker.mode === 'stream') {
          res.setHeader('content-type', 'application/x-ndjson');
          const iterator = (value as AsyncIterable<unknown>)[Symbol.asyncIterator]();
          res.on('close', () => { void iterator.return?.(); });
          for (;;) { const item = await iterator.next(); if (item.done || res.destroyed) break; res.write(JSON.stringify({ ok: true, value: item.value }) + '\n'); }
          res.end(); return true;
        }
      }
      res.end(JSON.stringify({ ok: true, value }));
    } catch (error) { res.end(JSON.stringify({ ok: false, error: { code: 'TOWN_PLUGIN_RPC', message: String(error) } })); }
    return true;
  }
  return {
    handle,
    config: (ns: string, base: any) => merge(base, persisted[ns]?.value),
    register(ns: string, fiber: Fiber, schema: any, base: any, owner: string) { if (rows.has(ns)) throw new Error(`配置命名空间冲突：${ns}`); rows.set(ns, { owner, fiber, schema, base, revision: persisted[ns]?.revision ?? 0, autoGenerate: presentationByFiber.get(fiber) ?? true }); },
  };
}
