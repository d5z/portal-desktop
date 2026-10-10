import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { c as archive } from 'tar';
import { PluginsModel } from '../desktop/renderer/plugins/model';
import { PluginRegistry, readPlugin } from '../desktop/main/plugins/registry';
import { groveEntryKind, parsePluginManifest, pluginReleaseUrl } from '../desktop/shared/plugins';
import { unpackKit, KitInstaller } from '../desktop/main/kits/install';
import type { Settings } from '../desktop/shared/types';

const manifest = { schemaVersion: 1, apiVersion: 1, id: 'example.board', name: 'Example', version: '1.0.0', description: 'A board', author: 'Author', entry: 'index.html', capabilities: ['storage'], contributes: { views: [{ id: 'board', title: 'Board' }] } };
const temporary: string[] = [];
afterEach(async () => { for (const folder of temporary.splice(0)) await rm(folder, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'plugins-test-')); temporary.push(root);
  const source = path.join(root, 'source'); await mkdir(source);
  await writeFile(path.join(source, 'desktop.plugin.json'), JSON.stringify(manifest));
  await writeFile(path.join(source, 'index.html'), '<h1>Board</h1><script>window.loaded=true;</script>');
  const registry = new PluginRegistry(path.join(root, 'registry'));
  return { root, source, registry, bundle: await readPlugin(source) };
}
describe('desktop plugin contract', () => {
  it('defaults sidebar shortcuts to hidden and persists opt-in without disabling the plugin or closing sessions', async () => {
    const { registry, source, root } = await fixture();
    await writeFile(path.join(source, 'desktop.plugin.json'), JSON.stringify({ ...manifest, capabilities: ['storage', 'ui'], contributes: {
      ...manifest.contributes, slots: [
        { id: 'current', title: 'Current', view: 'board', location: 'right-sidebar' },
        { id: 'other', title: 'Other', view: 'board', location: 'right-sidebar' },
      ],
    } }));
    const bundle = await readPlugin(source);
    await registry.install(bundle, { kind: 'local' });
    const model = new PluginsModel(undefined, () => {});
    model.library = await registry.list();
    expect(model.slots('right-sidebar')).toEqual([]);
    const session = await registry.open(manifest.id, 'board', undefined, 'current');
    await registry.call(session.token, 'storage.patch', { kept: true });
    await registry.setSidebarSlotVisible(manifest.id, 'current', true);
    await registry.setSidebarSlotVisible(manifest.id, 'other', true);
    await registry.setSidebarSlotVisible(manifest.id, 'other', false);
    const reloaded = new PluginRegistry(path.join(root, 'registry'));
    model.library = await reloaded.list();
    expect(model.slots('right-sidebar').map(s => s.slot.id)).toEqual(['current']);
    expect(model.library.plugins[0]).toMatchObject({ enabled: true, sha256: bundle.sha256 });
    await registry.setSidebarSlotVisible(manifest.id, 'current', false);
    model.library = await reloaded.list();
    expect(model.slots('right-sidebar')).toEqual([]);
    expect(await registry.call(session.token, 'storage.load')).toEqual({ kept: true });
    await expect(registry.setSidebarSlotVisible(manifest.id, 'missing', true)).rejects.toThrow();
    await expect(registry.setSidebarSlotVisible(manifest.id, 'current', 'true' as any)).rejects.toThrow();
  });
  it('persists per-view placement without changing plugin content or permissions', async () => {
    const { registry, bundle, root } = await fixture(); await registry.install(bundle, { kind: 'local' });
    await registry.setPlacement(manifest.id, 'board', 'navigation');
    const reloaded = new PluginRegistry(path.join(root, 'registry'));
    expect((await reloaded.list()).plugins[0]).toMatchObject({ placements: { board: 'navigation' }, sha256: bundle.sha256, enabled: true });
    await reloaded.setPlacement(manifest.id, 'board', 'window');
    const session = await reloaded.open(manifest.id, 'board');
    await reloaded.call(session.token, 'storage.patch', { kept: true });
    await expect(reloaded.setPlacement(manifest.id, 'missing', 'navigation')).rejects.toThrow();
    await expect(reloaded.setPlacement(manifest.id, 'board', 'invalid' as any)).rejects.toThrow();
    expect((await reloaded.list()).plugins[0].placements).toEqual({ board: 'window' });
    expect(await reloaded.call(session.token, 'storage.load')).toEqual({ kept: true });
  });
  it('keeps independent plugin sessions alive and atomically merges different view storage keys', async () => {
    const { registry, bundle } = await fixture(); await registry.install(bundle, { kind: 'local' });
    const first = await registry.open(manifest.id, 'board'), second = await registry.open(manifest.id, 'board');
    await Promise.all([registry.call(first.token, 'storage.patch', { board: 'latest' }), registry.call(second.token, 'storage.patch', { settings: 'latest' })]);
    expect(await registry.call(first.token, 'storage.load')).toEqual({ board: 'latest', settings: 'latest' });
    await registry.close(first.token);
    expect(await registry.call(second.token, 'storage.load')).toEqual({ board: 'latest', settings: 'latest' });
    await expect(registry.call(second.token, 'storage.patch', [])).rejects.toThrow('对象');
    await registry.setEnabled(manifest.id, false);
    await expect(registry.call(second.token, 'storage.load')).rejects.toThrow();
  });
  it('recognizes native plugins and legacy tagged Apps without reclassifying Kits', () => {
    expect(groveEntryKind({ kind: 'app', tags: ['plugin'] })).toBe('plugin');
    expect(groveEntryKind({ kind: 'app', tags: [{ name: 'Plugin' }] })).toBe('plugin');
    expect(groveEntryKind({ kind: 'kit', tags: ['plugin'] })).toBe('kit');
    expect(groveEntryKind({ kind: 'plugin' })).toBe('plugin');
    expect(groveEntryKind({ kind: 'plugin', tags: [] })).toBe('plugin');
    expect(groveEntryKind({ kind: 'app' })).toBe('app');
    expect(groveEntryKind({})).toBe('kit');
    expect(pluginReleaseUrl({ repo_url: 'https://github.com/owner/repo', release_tag: 'v1.0.0' })).toBe('https://github.com/owner/repo/releases/download/v1.0.0/desktop-plugin.tar.gz');
    expect(pluginReleaseUrl({ repo_url: 'https://github.com.evil.test/owner/repo', release_tag: 'v1' })).toBeUndefined();
    expect(pluginReleaseUrl({ repo_url: 'https://github.com/owner/repo', release_tag: '../main' })).toBeUndefined();
  });
  it.each([
    { id: '../outside' }, { id: 'con' }, { id: 'nul.data' }, { entry: '../index.html' },
    { apiVersion: 2 }, { capabilities: ['exec'] }, { capabilities: ['storage', 'storage'] },
    { contributes: { views: [{ id: 'board', title: 'A' }, { id: 'board', title: 'B' }] } },
  ])('rejects incompatible or unsafe manifests: %j', patch => {
    expect(() => parsePluginManifest({ ...manifest, ...patch })).toThrow();
  });
  it('installs copied content, persists independent storage, and revokes sessions on disable', async () => {
    const { root, source, registry, bundle } = await fixture();
    await registry.install(bundle, { kind: 'local' });
    await writeFile(path.join(source, 'index.html'), '<p>changed source</p>');
    const session = await registry.open(manifest.id, 'board');
    const document = registry.document(new URL(session.url));
    expect(document.headers.get('Content-Security-Policy')).toContain('sandbox allow-scripts');
    expect(document.headers.get('Content-Security-Policy')).toContain("connect-src 'none'");
    expect(await document.text()).toContain('<h1>Board</h1>');
    await registry.call(session.token, 'storage.save', { nodes: ['task-1'] });
    expect(await registry.call(session.token, 'storage.load')).toEqual({ nodes: ['task-1'] });
    await registry.setEnabled(manifest.id, false);
    expect(registry.document(new URL(session.url)).status).toBe(404);
    await expect(registry.call(session.token, 'storage.load')).rejects.toThrow('关闭');
    await expect(registry.open(manifest.id, 'board')).rejects.toThrow('未启用');
    const restarted = new PluginRegistry(path.join(root, 'registry'));
    expect((await restarted.list()).plugins[0].enabled).toBe(false);
    await restarted.setEnabled(manifest.id, true);
    const again = await restarted.open(manifest.id, 'board');
    expect(await restarted.call(again.token, 'storage.load')).toEqual({ nodes: ['task-1'] });
    await restarted.remove(manifest.id);
    expect((await restarted.list()).plugins).toHaveLength(0);
    await restarted.install(bundle, { kind: 'local' });
    expect(await restarted.call((await restarted.open(manifest.id, 'board')).token, 'storage.load')).toEqual({ nodes: ['task-1'] });
  });
  it('checks capability, quota, duplicate identity and unexpected operations', async () => {
    const { registry, bundle } = await fixture();
    await registry.install(bundle, { kind: 'local' });
    await expect(registry.install(bundle, { kind: 'grove', id: 'remote' })).rejects.toThrow('已安装');
    const session = await registry.open(manifest.id, 'board');
    await expect(registry.call(session.token, 'exec', 'anything')).rejects.toThrow();
    await expect(registry.call(session.token, 'storage.save', 'x'.repeat(1024 * 1024))).rejects.toThrow('1 MB');
    await expect(registry.open(manifest.id, 'missing')).rejects.toThrow();
    await registry.close(session.token);
    await expect(registry.call(session.token, 'storage.load')).rejects.toThrow();
  });
  it('does not let queued saves or sessions leak across plugins', async () => {
    const { registry, bundle, source } = await fixture();
    await registry.install(bundle, { kind: 'local' });
    await writeFile(path.join(source, 'desktop.plugin.json'), JSON.stringify({ ...manifest, id: 'example.second', capabilities: [] }));
    await registry.install(await readPlugin(source), { kind: 'local' });
    const first = await registry.open(manifest.id, 'board'), second = await registry.open('example.second', 'board');
    await expect(registry.call(second.token, 'storage.load')).rejects.toThrow('未获准');
    const save = registry.call(first.token, 'storage.save', { savedBeforeClosing: true });
    const close = registry.close(first.token); await save; await close;
    const reopened = await registry.open(manifest.id, 'board');
    expect(await registry.call(reopened.token, 'storage.load')).toEqual({ savedBeforeClosing: true });
  });
  it('isolates corrupt packages instead of breaking the entire library', async () => {
    const { registry, bundle, root } = await fixture();
    await registry.install(bundle, { kind: 'local' });
    const file = path.join(root, 'registry/packages/example.board.json');
    const value = JSON.parse(await readFile(file, 'utf8')); value.html += 'tampered';
    await writeFile(file, JSON.stringify(value));
    const library = await registry.list();
    expect(library.plugins).toHaveLength(0); expect(library.problems).toHaveLength(1);
    await expect(registry.open(manifest.id, 'board')).rejects.toThrow('校验失败');
  });
  it('extracts plugin archives without a Portal manifest', async () => {
    const { root, source } = await fixture();
    const file = path.join(root, 'plugin.tar.gz');
    await archive({ gzip: true, cwd: source, file }, ['desktop.plugin.json', 'index.html']);
    const unpacked = await unpackKit(await readFile(file), path.join(root, 'unpacked'), 'desktop.plugin.json');
    expect((await readPlugin(unpacked)).manifest.id).toBe(manifest.id);
  });
  it('rejects native Plugin installation through the Kit installer before downloading', async () => {
    const { root } = await fixture(); let calls = 0;
    const installer = new KitInstaller(root, async () => { calls++; return Response.json({ name: 'plugin', kind: 'plugin', tags: [] }); });
    await expect(installer.prepare('plugin', { workspace: root, kitsEnabled: true } as Settings)).rejects.toThrow('Plugin');
    expect(calls).toBe(1);
  });
});
