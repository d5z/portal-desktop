import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PluginRegistry, readPlugin } from '../desktop/main/plugins/registry';
import { parsePluginManifest } from '../desktop/shared/plugins';
import type { PluginEvent } from '../desktop/shared/plugins';
import type { PluginAgentSnapshot } from '../plugins/sdk';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const contract = { description: 'A generic reading list', instructions: 'Help manage books when asked. Never change unrelated work.', fields: { title: { type: 'string', title: 'Title', maxLength: 160 }, status: { type: 'string', title: 'State', enum: ['new', 'read'] } }, required: ['title', 'status'] };
const manifest = { schemaVersion: 1, apiVersion: 1, minSdkVersion: '1.4.0', id: 'example.reading', name: 'Reading', version: '1.0.0', author: 'Test', description: 'Generic extension', entry: 'index.html', capabilities: ['agent.read', 'agent.write'], contributes: { views: [{ id: 'main', title: 'Reading' }], agent: contract } };
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'plugin-agent-')); roots.push(root);
  const source = path.join(root, 'source'); await mkdir(source);
  await writeFile(path.join(source, 'desktop.plugin.json'), JSON.stringify(manifest)); await writeFile(path.join(source, 'index.html'), '<h1>Reading</h1>');
  let endpoint = 'https://fixture.test/a';
  const events: PluginEvent[] = [];
  const registry = new PluginRegistry(path.join(root, 'registry'), { contextKey: () => endpoint, endpoint: () => endpoint, call: async () => ({ sceneId: 'scene-a' }) }, e => events.push(e));
  await registry.install(await readPlugin(source), { kind: 'local' });
  const session = await registry.open(manifest.id, 'main');
  const command = (data: unknown) => registry.agentCommand(endpoint, JSON.stringify({ plugin: manifest.id, ...data as object }), 'scene-b').then(JSON.parse);
  const snapshot = () => registry.call(session.token, 'agent.snapshot') as Promise<PluginAgentSnapshot>;
  return { root, source, registry, session, command, snapshot, events, switchBeing: () => { endpoint = 'https://fixture.test/b'; } };
}
describe('generic plugin agent SDK', () => {
  it('declares typed plugin behavior, without accepting executable or arbitrary schema extensions', () => {
    expect(parsePluginManifest(manifest).contributes.agent).toEqual(contract);
    for (const agent of [{ ...contract, fields: { ...contract.fields, constructor: { type: 'string', title: 'bad' } } }, { ...contract, fields: { x: { type: 'object', title: 'bad' } } }, { ...contract, script: 'exec' }]) {
      expect(() => parsePluginManifest({ ...manifest, contributes: { ...manifest.contributes, agent } })).toThrow();
    }
    expect(() => parsePluginManifest({ ...manifest, minSdkVersion: '1.3.0' })).toThrow();
  });
  it('round trips Being commands and UI writes through shared data and publishes scoped invalidations', async () => {
    const f = await fixture();
    await f.registry.call(f.session.token, 'events.subscribe', { id: 1, topic: 'agent.changed' });
    const created = await f.command({ op: 'create', requestId: 'create-1', data: { title: 'Read a book', status: 'new' } });
    const state = await f.snapshot(); expect(state.records[0].id).toBe(created.record.id); expect(state.events[0]).toMatchObject({ actor: 'being', sceneId: 'scene-b' });
    await f.registry.call(f.session.token, 'agent.mutate', { op: 'update', requestId: 'ui-1', id: created.record.id, expectedRevision: 1, patch: { status: 'read' }, note: 'Finished reading' });
    const read = await f.command({ op: 'get', id: created.record.id });
    expect(read.record.data.status).toBe('read'); expect(read.events.at(-1).actor).toBe('user'); expect(f.events).toHaveLength(2);
    await f.registry.close(f.session.token);
    await f.command({ op: 'update', requestId: 'closed-ui', id: created.record.id, expectedRevision: 2, patch: { title: 'Updated while UI closed' }, note: 'User asked' });
    const second = await f.registry.open(manifest.id, 'main');
    expect((await f.registry.call(second.token, 'agent.snapshot') as PluginAgentSnapshot).records[0].data.title).toContain('UI closed');
  });
  it('deduplicates identical retries and rejects conflicting updates without losing data', async () => {
    const f = await fixture(), request = { op: 'create', requestId: 'repeat', data: { title: 'One', status: 'new' } };
    const [a, b] = await Promise.all([f.command(request), f.command(request)]);
    expect(a.record.id).toBe(b.record.id); expect(b.replayed).toBe(true); expect((await f.snapshot()).records).toHaveLength(1);
    expect((await f.command({ data: { status: 'new', title: 'One' }, requestId: 'repeat', op: 'create' })).replayed).toBe(true);
    await expect(f.command({ ...request, data: { title: 'Two', status: 'new' } })).rejects.toThrow('requestId');
    const updates = await Promise.allSettled(['a', 'b'].map(requestId => f.command({ op: 'update', requestId, id: a.record.id, expectedRevision: 1, patch: { title: requestId }, note: 'Edit' })));
    expect(updates.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await f.snapshot()).records[0].revision).toBe(2);
  });
  it('checks data types, fields and limits in both directions', async () => {
    const f = await fixture();
    for (const data of [{ title: 'bad', status: 'other' }, { title: 'bad', status: 'new', exec: 'rm' }, { status: 'new' }, { title: 'x'.repeat(161), status: 'new' }]) {
      await expect(f.command({ op: 'create', requestId: 'invalid', data })).rejects.toThrow();
      await expect(f.registry.call(f.session.token, 'agent.mutate', { op: 'create', requestId: 'invalid', data })).rejects.toThrow();
    }
    expect((await f.snapshot()).records).toEqual([]);
  });
  it('isolates plugin and Being data and invalidates old sessions after identity change', async () => {
    const f = await fixture();
    await f.command({ op: 'create', requestId: 'a', data: { title: 'Private A', status: 'new' } });
    await writeFile(path.join(f.source, 'desktop.plugin.json'), JSON.stringify({ ...manifest, id: 'example.other' }));
    await f.registry.install(await readPlugin(f.source), { kind: 'local' });
    const other = await f.registry.open('example.other', 'main');
    await f.registry.call(other.token, 'events.subscribe', { id: 2, topic: 'agent.changed' });
    expect((await f.registry.call(other.token, 'agent.snapshot') as PluginAgentSnapshot).records).toEqual([]);
    await f.command({ op: 'create', requestId: 'b', data: { title: 'Second A', status: 'new' } });
    expect(f.events).toEqual([]);
    f.switchBeing();
    await expect(f.snapshot()).rejects.toThrow('切换');
    expect((await f.command({ op: 'list' })).records).toEqual([]);
    await expect(f.registry.agentCommand('https://fixture.test/a', '', 'scene-a')).rejects.toThrow('切换');
  });
  it('revokes Being access on disable/remove while retaining durable data for reinstall', async () => {
    const f = await fixture();
    await f.command({ op: 'create', requestId: 'keep', data: { title: 'Durable', status: 'new' } });
    await f.registry.setEnabled(manifest.id, false);
    await expect(f.command({ op: 'list' })).rejects.toThrow('未启用');
    await f.registry.setEnabled(manifest.id, true);
    await f.registry.remove(manifest.id);
    await expect(f.command({ op: 'list' })).rejects.toThrow();
    await f.registry.install(await readPlugin(f.source), { kind: 'local' });
    expect((await f.command({ op: 'list' })).records[0].data.title).toBe('Durable');
    const restarted = new PluginRegistry(path.join(f.root, 'registry'), { contextKey: () => 'a', endpoint: () => 'https://fixture.test/a', call: async () => ({}) });
    expect(JSON.parse(await restarted.agentCommand('https://fixture.test/a', JSON.stringify({ plugin: manifest.id, op: 'list' }))).records[0].data.title).toBe('Durable');
  });
  it('supports discovery, versioned preferences and a read-only contract', async () => {
    const f = await fixture();
    const list = JSON.parse(await f.registry.agentCommand('https://fixture.test/a', ''));
    expect(list.plugins[0].id).toBe(manifest.id);
    expect((await f.command({ op: 'describe' })).contract).toEqual(contract);
    await f.command({ op: 'configure', requestId: 'prefs', expectedRevision: 0, preferences: { guidance: 'One book at a time' }, note: 'User preference' });
    expect((await f.snapshot()).preferences.guidance).toBe('One book at a time');
    await expect(f.command({ op: 'configure', requestId: 'stale', expectedRevision: 0, preferences: { guidance: 'Overwritten' }, note: 'stale' })).rejects.toThrow('已更新');
    await f.registry.remove(manifest.id);
    await writeFile(path.join(f.source, 'desktop.plugin.json'), JSON.stringify({ ...manifest, capabilities: ['agent.read'] }));
    await f.registry.install(await readPlugin(f.source), { kind: 'local' });
    expect((await f.command({ op: 'list' })).preferences.guidance).toContain('One book');
    await expect(f.command({ op: 'create', requestId: 'denied', data: { title: 'Denied', status: 'new' } })).rejects.toThrow('权限');
  });
});
