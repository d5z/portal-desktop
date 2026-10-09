import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { capabilityFor, createPluginServices, type PluginCallContext, type PluginServices } from '../desktop/main/plugins/services';
import { PluginRegistry, readPlugin } from '../desktop/main/plugins/registry';
import { parsePluginManifest, type PluginCapability } from '../desktop/shared/plugins';
import { PluginsModel } from '../desktop/renderer/plugins/model';
import { TownClient } from '../desktop/shared/town-client';
import { PluginWorkspace } from '../desktop/main/plugins/workspace';
import type { PluginHostContext } from '../desktop/shared/plugins';

const manifest = parsePluginManifest({ schemaVersion: 1, apiVersion: 1, minSdkVersion: '1.1.0', id: 'example.sdk', name: 'SDK fixture', version: '1.1.0', author: 'Test', description: 'SDK test', entry: 'index.html', capabilities: ['storage', 'town.public.read', 'being.chat'], contributes: { views: [{ id: 'board', title: 'Board' }], commands: [{ id: 'open', title: 'Open', view: 'board' }], settingsView: 'board' } });
const roots: string[] = [];
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const being = { connected: true, name: 'Test Being', sceneId: 'scene-a', sceneLabel: 'A' };
const context = (): PluginCallContext => ({ manifest, signal: new AbortController().signal, emit: vi.fn(), check: vi.fn() });
function fixture(handle = vi.fn(async (_request: Request) => Response.json({})), confirmChat = vi.fn(async () => true)) {
  const town = vi.fn(async () => ({ ok: true as const, data: { seeds: [] }, fetchedAt: '' }));
  return { handle, confirmChat, town, services: createPluginServices({ contextKey: () => 'a', being: () => being, endpoint: () => 'http://localhost:9999', town, proxy: { handle }, confirmChat }) };
}
async function registry(services: PluginServices, capabilities: PluginCapability[] = manifest.capabilities) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sdk-test-')); roots.push(root);
  const source = path.join(root, 'source'); await mkdir(source);
  await writeFile(path.join(source, 'desktop.plugin.json'), JSON.stringify({ ...manifest, capabilities }));
  await writeFile(path.join(source, 'index.html'), '<h1>SDK</h1>');
  const events: unknown[] = [];
  const host = new PluginRegistry(path.join(root, 'registry'), services, event => events.push(event));
  await host.install(await readPlugin(source), { kind: 'local' });
  const session = await host.open(manifest.id, 'board');
  return { host, session, events };
}
function sse(text: string) { return new Response(text, { headers: { 'content-type': 'text/event-stream' } }); }
const delta = 'event: content_block_delta\ndata: {"delta":{"text":"建议"}}\n\n';
const stop = 'event: message_stop\ndata: {}\n\n';

describe('Grove SDK capabilities and lifecycle', () => {
  it('classifies public/private reads and rejects arbitrary operations', () => {
    for (const kind of ['seeds', 'home', 'grove', 'contacts']) expect(capabilityFor('town.query', { kind })).toBe('town.public.read');
    for (const kind of ['inbox', 'bonfire', 'scrolls', 'my-scrolls']) expect(capabilityFor('town.query', { kind })).toBe('town.private.read');
    expect(() => capabilityFor('town.query', { kind: 'seed', id: '../token' })).toThrow();
    expect(() => capabilityFor('exec')).toThrow();
  });
  it('does not authenticate public Town requests, authenticates private requests only inside the client', async () => {
    const fetcher = vi.fn(async () => Response.json({ seeds: [] }));
    const client = new TownClient(() => 'private-token', fetcher, 'https://example.test', () => 'test-being');
    await client.query({ kind: 'seeds' }); await client.query({ kind: 'inbox' });
    const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
    expect(new Headers(calls[0][1].headers).get('authorization')).toBeNull();
    expect(new Headers(calls[1][1].headers).get('authorization')).toContain('private-token');
  });
  it('rejects undeclared reads and writes before calling services', async () => {
    const { services, town, handle } = fixture(); const { host, session } = await registry(services, ['town.public.read']);
    await expect(host.call(session.token, 'town.query', { kind: 'seeds' })).resolves.toMatchObject({ ok: true });
    await expect(host.call(session.token, 'town.query', { kind: 'inbox' })).rejects.toThrow('未获准');
    await expect(host.call(session.token, 'being.chat', 'message')).rejects.toThrow('未获准');
    expect(town).toHaveBeenCalledTimes(1); expect(handle).not.toHaveBeenCalled();
  });
  it('validates SDK compatibility and declared command/settings targets', async () => {
    expect(() => parsePluginManifest({ ...manifest, minSdkVersion: '2.0.0' })).toThrow();
    expect(() => parsePluginManifest({ ...manifest, contributes: { ...manifest.contributes, settingsView: 'absent' } })).toThrow();
    expect(() => parsePluginManifest({ ...manifest, contributes: { ...manifest.contributes, commands: [{ id: 'bad', title: 'Bad', view: 'absent' }] } })).toThrow();
    const { host } = await registry(fixture().services);
    await expect(host.open(manifest.id, 'board', 'unknown')).rejects.toThrow();
    const opened = await host.open(manifest.id, 'board', 'open');
    expect(await host.document(new URL(opened.url)).text()).toContain('data-command="open"');
  });
  it.each(['close', 'disable', 'identity'])('drops pending results after %s without locking the registry', async action => {
    let key = 'a', finish!: (result: unknown) => void;
    const started = deferred<void>();
    const service: PluginServices = { contextKey: () => key, call: async (_method, _value, ctx) => { started.resolve(); return new Promise(resolve => { finish = resolve; }); } };
    const { host, session } = await registry(service);
    const pending = host.call(session.token, 'town.query', { kind: 'seeds' });
    const rejected = expect(pending).rejects.toThrow(/关闭|切换/);
    await started.promise;
    if (action === 'close') await host.close(session.token);
    if (action === 'disable') await host.setEnabled(manifest.id, false);
    if (action === 'identity') key = 'b';
    finish({ secret: 'old-identity' }); await rejected;
  });
  it('aborts running requests and revokes events when a session closes', async () => {
    const started = deferred<PluginCallContext>();
    const { host, session, events } = await registry({ contextKey: () => 'a', call: async (_m, _v, ctx) => { started.resolve(ctx); return new Promise((_resolve, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('aborted')))); } });
    const pending = host.call(session.token, 'being.chat', 'hello'); const rejected = expect(pending).rejects.toThrow('aborted');
    const ctx = await started.promise; ctx.emit('first'); await host.close(session.token); await rejected;
    expect(ctx.signal.aborted).toBe(true); expect(() => ctx.emit('late')).toThrow(); expect(events).toHaveLength(1);
  });
});
describe('Being and UI SDK', () => {
  it('returns only current-scene text history without private tool metadata', async () => {
    const { services, handle } = fixture(vi.fn(async () => Response.json({ messages: [
      { scene_id: 'scene-b', role: 'user', content: 'another scene' },
      { scene_id: 'scene-a', role: 'system', content: 'hidden' },
      { scene_id: 'scene-a', role: 'being', content: 'answer', secret: 'hidden', at: 'now' },
      { role: 'user', content: 'legacy unscoped' },
    ] })));
    expect(await services.call('being.history', { limit: 10 }, context())).toEqual({ sceneId: 'scene-a', messages: [{ role: 'being', content: 'answer', at: 'now' }] });
    expect(handle.mock.calls[0][0].headers.get('X-Portal-Scene-Id')).toBe('scene-a');
  });
  it('never sends when native confirmation is cancelled', async () => {
    const { services, handle } = fixture(undefined, vi.fn(async () => false));
    await expect(services.call('being.chat', 'hello', context())).rejects.toThrow('取消'); expect(handle).not.toHaveBeenCalled();
  });
  it('rechecks identity after native confirmation', async () => {
    const ctx = context(); const { services, handle } = fixture(undefined, vi.fn(async () => { ctx.check = () => { throw new Error('changed'); }; return true; }));
    await expect(services.call('being.chat', 'hello', ctx)).rejects.toThrow('changed'); expect(handle).not.toHaveBeenCalled();
  });
  it('forwards safe text deltas and waits for stream completion', async () => {
    const bytes = new TextEncoder().encode(delta + 'event: tool_result\ndata: {"secret":"never"}\n\n' + stop);
    const ctx = context(); const { services, handle } = fixture(vi.fn(async () => new Response(new ReadableStream({ start(controller) {
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close();
    } }), { headers: { 'content-type': 'text/event-stream' } })));
    expect(await services.call('being.chat', 'hello', ctx)).toEqual({ status: 'completed', sceneId: 'scene-a', text: '建议' });
    expect(ctx.emit).toHaveBeenCalledExactlyOnceWith('建议');
    expect(await handle.mock.calls[0][0].json()).toEqual({ message: 'hello' });
  });
  it('reports accepted queues separately from finished replies', async () => {
    const { services } = fixture(vi.fn(async () => new Response(null, { status: 202 })));
    expect(await services.call('being.chat', 'hello', context())).toMatchObject({ status: 'accepted', text: '' });
  });
  it.each([delta, 'event: error\ndata: {}\n\n'])('rejects incomplete/error streams without automatic retries', async stream => {
    const { services, handle } = fixture(vi.fn(async () => sse(stream)));
    await expect(services.call('being.chat', 'hello', context())).rejects.toThrow(); expect(handle).toHaveBeenCalledTimes(1);
  });
  it('rejects a second chat while the first awaits confirmation', async () => {
    const confirmation = deferred<boolean>();
    const { services } = fixture(undefined, vi.fn(() => confirmation.promise));
    const pending = services.call('being.chat', 'first', context()); const rejected = expect(pending).rejects.toThrow('取消');
    await expect(services.call('being.chat', 'second', context())).rejects.toThrow('已有');
    confirmation.resolve(false); await rejected;
  });
  it('restricts navigation and validates text', async () => {
    const { services } = fixture();
    await expect(services.call('ui.navigate', { view: 'settings' }, context())).rejects.toThrow();
    await expect(services.call('ui.navigate', { view: 'seeds', id: '../secret' }, context())).rejects.toThrow();
    await expect(services.call('being.compose', 'x'.repeat(16001), context())).rejects.toThrow();
    expect(await services.call('ui.navigate', { view: 'seeds', id: 'seed-1' }, context())).toEqual({ view: 'seeds', id: 'seed-1' });
  });
  it('composes through a scene-bound acknowledged draft and never submits a message', async () => {
    let current = 'scene-a'; const post = vi.fn();
    const model = new PluginsModel(undefined, vi.fn(), { post, notice: vi.fn(), scene: () => current, ready: () => true });
    const pending = model.compose({ text: 'draft', sceneId: 'scene-a' }); const message = post.mock.calls[0][0];
    expect(message).toMatchObject({ type: 'beings:scene-draft', text: 'draft', sceneId: 'scene-a' });
    model.receiveDraft({ type: 'beings:scene-draft-result', id: message.id, ok: false }); expect(await pending).toEqual({ inserted: false });
    current = 'scene-b'; await expect(model.compose({ text: 'draft', sceneId: 'scene-a' })).rejects.toThrow('切换');
  });
});

describe('SDK 1.2 workspace, contributions, events and tasks', () => {
  const publicManifest = { ...manifest, capabilities: ['workspace.read', 'town.public.read'] as PluginCapability[] };
  const input: PluginHostContext = { endpoint: 'test', sceneId: 'a', townGeneration: 1, context: { revision: 1, view: 'seeds', title: '种子花园', status: 'ready', resource: { kind: 'seeds', id: 'seed-1', title: '种子', excerpt: '摘要', private: false } } };
  it('projects authorized resource fields and drops stale identity observations', () => {
    let key = 'a'; const changed = vi.fn();
    const workspace = new PluginWorkspace(() => ({ key, endpoint: 'test', sceneId: 'a', townGeneration: 1 }), changed);
    workspace.update(input); workspace.update(input);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(workspace.read(publicManifest).resource?.excerpt).toBe('摘要');
    expect(workspace.read({ ...manifest, capabilities: ['workspace.read'] }).resource).toBeUndefined();
    expect(() => workspace.update({ ...input, endpoint: 'wrong' })).toThrow('身份');
    expect(() => workspace.update({ ...input, townGeneration: 2 })).toThrow('身份');
    key = 'b'; expect(workspace.read(publicManifest).resource).toBeUndefined();
  });
  it('does not trust public flags on private routes or reveal private titles', () => {
    const workspace = new PluginWorkspace(() => ({ key: 'a', endpoint: 'test', sceneId: 'a', townGeneration: 1 }), vi.fn());
    workspace.update({ ...input, context: { ...input.context, view: 'mail', title: '私人主题', resource: { ...input.context.resource!, kind: 'mail', private: false } } });
    expect(workspace.read(publicManifest)).toMatchObject({ title: 'Town 私有页面' });
    expect(workspace.read(publicManifest).resource).toBeUndefined();
    expect(workspace.read({ ...manifest, capabilities: ['workspace.read', 'town.private.read'] }).resource?.private).toBe(true);
    expect(() => workspace.update({ ...input, context: { ...input.context, resource: { ...input.context.resource!, excerpt: 'x'.repeat(2201) } } })).toThrow();
  });
  it('validates slot targets, resource filters, quotas and UI capabilities', () => {
    const slot = { id: 'side', title: 'Sidebar', view: 'board', location: 'right-sidebar' };
    const valid = { ...manifest, minSdkVersion: '1.2.0', capabilities: ['ui'], contributes: { ...manifest.contributes, slots: [slot] } };
    expect(parsePluginManifest(valid).contributes.slots).toHaveLength(1);
    for (const patch of [{ view: 'missing' }, { location: 'arbitrary-dom' }, { resourceKinds: ['files'] }])
      expect(() => parsePluginManifest({ ...valid, contributes: { ...valid.contributes, slots: [{ ...slot, ...patch }] } })).toThrow();
    expect(() => parsePluginManifest({ ...valid, capabilities: [] })).toThrow();
    expect(() => parsePluginManifest({ ...valid, contributes: { ...valid.contributes, slots: [slot, slot] } })).toThrow();
  });
  it('filters resource menus and removes slots when a plugin is disabled', () => {
    const model = new PluginsModel(undefined, vi.fn());
    model.library.plugins = [{ manifest: { ...publicManifest, contributes: { ...manifest.contributes, slots: [{ id: 'act', title: 'Act', view: 'board', location: 'resource-actions', resourceKinds: ['seeds', 'mail'] }] } }, enabled: true, source: { kind: 'local' }, sha256: '', installedAt: '' }];
    model.context = input.context; expect(model.slots('resource-actions')).toHaveLength(1);
    model.context = { ...input.context, resource: { ...input.context.resource!, kind: 'mail', private: true } }; expect(model.slots('resource-actions')).toHaveLength(0);
    model.context = input.context; model.library.plugins[0].enabled = false; expect(model.slots('resource-actions')).toHaveLength(0);
  });
  it('requires per-topic capabilities and emits only scoped invalidation envelopes', async () => {
    const { host, session, events } = await registry(fixture().services, ['workspace.read']);
    await expect(host.call(session.token, 'events.subscribe', { id: 1, topic: 'tasks.changed' })).rejects.toThrow('未获准');
    await expect(host.call(session.token, 'events.subscribe', { id: 1, topic: 'town.changed' })).rejects.toThrow('未获准');
    await expect(host.call(session.token, 'events.subscribe', { id: 1, topic: 'anything' })).rejects.toThrow('未开放');
    await host.call(session.token, 'events.subscribe', { id: 1, topic: 'workspace.changed' });
    host.publish('workspace.changed'); host.publish('tasks.changed');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ token: session.token, type: 'subscription', data: { id: 1, event: { topic: 'workspace.changed', revision: 1 } } });
    expect(Object.keys((events[0] as any).data.event).sort()).toEqual(['at', 'revision', 'topic']);
    await host.call(session.token, 'events.unsubscribe', { id: 1, topic: 'workspace.changed' });
    host.publish('workspace.changed'); expect(events).toHaveLength(1);
    await host.call(session.token, 'events.subscribe', { id: 2, topic: 'workspace.changed' });
    await host.setEnabled(manifest.id, false); host.publish('workspace.changed'); expect(events).toHaveLength(1);
  });
  it('limits subscriptions and revokes them on connection changes', async () => {
    let key = 'a'; const { host, session, events } = await registry({ ...fixture().services, contextKey: () => key }, ['workspace.read']);
    for (let id = 1; id <= 32; id++) await host.call(session.token, 'events.subscribe', { id, topic: 'workspace.changed' });
    await expect(host.call(session.token, 'events.subscribe', { id: 33, topic: 'workspace.changed' })).rejects.toThrow('32');
    key = 'b'; host.publish('workspace.changed'); expect(events).toHaveLength(0);
    await expect(host.call(session.token, 'workspace.context')).rejects.toThrow('关闭');
  });
  it('returns only task metadata for the current scene and rejects a mismatched Being snapshot', async () => {
    let endpoint = 'test';
    const tasks = vi.fn(async () => ({ endpoint, tasks: [
      { id: 't1', sceneId: 'scene-a', status: 'running' as const, createdAt: 12, error: 'secret', prompt: 'private' },
      { id: 't2', sceneId: 'scene-b', status: 'done' as const, createdAt: 12 },
    ], subagentReady: true }));
    const services = createPluginServices({ contextKey: () => 'a', being: () => being, endpoint: () => 'test', town: fixture().town, proxy: { handle: vi.fn() }, confirmChat: vi.fn(), tasks });
    const result: any = await services.call('being.tasks.list', undefined, context());
    expect(result).toMatchObject({ sceneId: 'scene-a', ready: true, tasks: [{ id: 't1', status: 'running', createdAt: 12 }] });
    expect(result.tasks).toHaveLength(1); expect(Object.keys(result.tasks[0]).sort()).toEqual(['createdAt', 'id', 'status']);
    expect(result.scopeId).toMatch(/^[a-f0-9]{64}$/);
    endpoint = 'other'; await expect(services.call('being.tasks.list', undefined, context())).rejects.toThrow('切换');
    const { host, session } = await registry(services, ['being.read']);
    await expect(host.call(session.token, 'being.tasks.list')).rejects.toThrow('未获准');
  });
});
