import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { deleteLocalKit, importLocalKit, kitLocation, localKits, readKit } from '../desktop/main/kits/catalog';
import type { Settings } from '../desktop/shared/types';
let dir: string;
const fixture = { name: 'example', version: '1.0.0', command: ['node', '{{KIT_DIR}}/server.mjs'], tools: [{ name: 'say_hello', description: 'Greeting', params: { type: 'object' } }] };
const settings = (workspace: string): Settings => ({ workspace, kitsEnabled: true, endpoint: '', being: '', hasToken: false, portalName: 'test', portalBinary: '/binary', autoStart: false, allowExec: false });
beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), 'kits-test-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });
async function source() { const src = path.join(dir, 'source'); await mkdir(src); await writeFile(path.join(src, 'manifest.json'), JSON.stringify(fixture)); await writeFile(path.join(src, 'server.mjs'), 'throw new Error("Import must never execute this script");'); return src; }

describe('Portal Kit integration', () => {
  it.each(['win32', 'windows', 'WIN32'])('accepts the Windows platform alias %s used by Grove kits', async platform => {
    const src = await source();
    await writeFile(path.join(src, 'manifest.json'), JSON.stringify({ ...fixture, platform: [platform] }));
    expect((await readKit(src, 'win32')).compatible).toBe(true);
    expect((await readKit(src, 'darwin')).compatible).toBe(false);
  });
  it('uses the client switch while retaining the imported kits directory', async () => {
    const config = path.join(dir, 'portal.toml'); await writeFile(config, 'kits_dir = "~/my-kits"\nkits_enabled = false\n');
    const result = await kitLocation({ ...settings(dir), portalConfigPath: config }, dir);
    expect(result).toMatchObject({ directory: path.join(dir, 'my-kits'), enabled: true });
    expect(await kitLocation({ ...settings(dir), portalConfigPath: config, kitsEnabled: false }, dir)).toMatchObject({ enabled: false });
    expect((await localKits(settings(dir), dir)).kits).toEqual([]);
  });
  it('imports files without executing them, resolves portable command and refuses overwrites', async () => {
    const src = await source(), destination = path.join(dir, 'kits');
    const kit = await importLocalKit(src, destination);
    expect(kit.tools[0].name).toBe('say_hello');
    const command = (await readKit(kit.directory)).command;
    expect(command[0]).toBe('node'); expect(path.normalize(command[1])).toBe(path.join(kit.directory, 'server.mjs'));
    expect(await readFile(path.join(kit.directory, 'server.mjs'), 'utf8')).toContain('must never execute');
    await expect(importLocalKit(src, destination)).rejects.toThrow('同名');
    expect((await readKit(src)).command[1]).toContain('{{KIT_DIR}}');
  });
  it('rejects path traversal names, unsupported platforms, symlinks and unresolved placeholders', async () => {
    const src = await source(), manifest = path.join(src, 'manifest.json');
    await writeFile(manifest, JSON.stringify({ ...fixture, name: '../escape' })); await expect(readKit(src)).rejects.toThrow('名称');
    await writeFile(manifest, JSON.stringify({ ...fixture, platform: ['unsupported'] })); await expect(importLocalKit(src, path.join(dir, 'kits'))).rejects.toThrow('不支持');
    await writeFile(manifest, JSON.stringify({ ...fixture, command: ['{{KIT_HOME}}/run'] })); await expect(importLocalKit(src, path.join(dir, 'kits'))).rejects.toThrow('占位符');
    const outside = path.join(dir, 'outside'); await mkdir(outside);
    await writeFile(manifest, JSON.stringify(fixture)); await symlink(outside, path.join(src, 'link'), process.platform === 'win32' ? 'junction' : 'dir'); await expect(importLocalKit(src, path.join(dir, 'kits'))).rejects.toThrow('链接');
  });
  it('imports a selected directory alias without modifying the source', async () => {
    const src = await source(), alias = path.join(dir, 'alias'); await symlink(src, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const kit = await importLocalKit(alias, path.join(dir, 'kits'));
    expect((await readKit(kit.directory)).command[1]).not.toContain('{{KIT_DIR}}');
    expect((await readKit(src)).command[1]).toContain('{{KIT_DIR}}');
  });
  it('reports malformed installed kits without hiding healthy neighbors', async () => {
    const src = await source(); await importLocalKit(src, path.join(dir, '.heart-portal/kits'));
    const broken = path.join(dir, '.heart-portal/kits/broken'); await mkdir(broken); await writeFile(path.join(broken, 'manifest.json'), '{');
    const library = await localKits(settings(dir), dir); expect(library.kits).toHaveLength(2); expect(library.kits.find(k => k.name === 'broken')?.problem).toContain('无法加载'); expect(library.kits.find(k => k.name === 'example')?.tools).toHaveLength(1);
  });
  it('deletes a valid Kit directory, including a broken manifest directory', async () => {
    const destination = path.join(dir, '.heart-portal', 'kits');
    const broken = path.join(destination, 'jira');
    await mkdir(broken, { recursive: true });
    await deleteLocalKit(settings(dir), 'jira', dir);
    await expect(readFile(path.join(broken, 'manifest.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(broken)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(deleteLocalKit(settings(dir), '../outside')).rejects.toThrow('无效');
  });
});
