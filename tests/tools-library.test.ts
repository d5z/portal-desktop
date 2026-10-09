import { afterEach, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { LocalApps } from '../desktop/main/app/local-apps';
import { toolEntries } from '../desktop/renderer/town/components/tools-library';
import type { InstalledPlugin } from '../desktop/shared/plugins';
import type { LocalKit } from '../desktop/shared/types';
const temporary: string[] = [];
afterEach(async () => { for (const folder of temporary.splice(0)) await rm(folder, { recursive: true, force: true }); });
it('merges local and remote entries by type while retaining sideloaded plugins and kits', () => {
  const plugin = { manifest: { id: 'example.plugin', name: 'Board', description: '' }, enabled: true, source: { kind: 'grove', id: 'board' } } as InstalledPlugin;
  const kit = { name: 'local-tool', description: '' } as LocalKit;
  const entries = toolEntries([{ id: 'board', name: 'Board', kind: 'app', tags: ['plugin'] }, { id: 'ordinary', name: 'Board', kind: 'app' }], [kit], [plugin], []);
  expect(entries).toHaveLength(3);
  expect(entries.filter(entry => entry.local).map(entry => entry.kind)).toEqual(['plugin', 'kit']);
  expect(entries.find(entry => entry.plugin)?.remote?.id).toBe('board');
});
it('only confirms local Apps when their chosen program still exists; unlink preserves the program', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-app-test-')); temporary.push(root);
  const program = path.join(root, 'program.exe'); await writeFile(program, 'fixture');
  const registry = new LocalApps(path.join(root, 'associations.json'));
  await registry.associate({ id: 'app-1', name: 'Local App' }, program);
  expect((await registry.list())[0].exists).toBe(true);
  await registry.remove('app-1'); expect(await readFile(program, 'utf8')).toBe('fixture');
  await registry.associate({ id: 'app-1', name: 'Local App' }, program); await rm(program);
  const apps = await registry.list(); expect(apps[0].exists).toBe(false);
  expect(toolEntries([], [], [], apps).filter(entry => entry.local)).toHaveLength(0);
});
