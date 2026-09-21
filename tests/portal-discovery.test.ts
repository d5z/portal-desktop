import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ExternalPortalObserver } from '../desktop/main/portal/external';
import { parseConnection } from '../desktop/main/chat/connection';
import type { Command } from '../desktop/main/portal/background';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
it.skipIf(process.platform !== 'darwin')('finds old client guardians even between restarts, retains their name, and excludes disabled/unrelated/current services', async () => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'portal-discovery-'))); roots.push(home);
  const agents = path.join(home, 'Library/LaunchAgents'); await mkdir(agents, { recursive: true });
  const disabled: string[] = [];
  async function add(suffix: string, being = 'fixture') {
    const root = path.join(home, suffix); await mkdir(root);
    const label = `town.beings.desktop.portal.${suffix}`;
    await writeFile(path.join(root, 'connection.url'), `https://example.org/${being}/?token=old-token`);
    await writeFile(path.join(root, 'run.sh'), "exec heart-portal --name 'old-laptop'\n");
    const file = path.join(agents, label + '.plist');
    await writeFile(file, JSON.stringify({ Label: label, ProgramArguments: ['/bin/sh', path.join(root, 'run.sh')] }));
    return { root, label, file };
  }
  const old = await add('aa'), own = await add('bb'), other = await add('cc', 'another');
  const stopped = await add('dd'); disabled.push(stopped.label);
  const run: Command = async (file, args) => {
    if (file.endsWith('plutil')) return readFile(args.at(-1)!, 'utf8');
    if (file === '/bin/ps') return '';
    if (args[0] === 'print-disabled') return disabled.map(label => `"${label}" => true`).join('\n');
    if (args[0] === 'print') throw new Error('not loaded');
    throw new Error('unexpected command');
  };
  const observer = new ExternalPortalObserver(run, 'darwin', home);
  const connection = parseConnection('https://example.org/fixture/?token=rotated-token');
  const found = await observer.conflicts(connection, own.root);
  expect(found).toHaveLength(1);
  expect(found[0]).toMatchObject({ root: old.root, label: old.label, service: { name: 'old-laptop' } });
  expect(JSON.stringify(found)).not.toContain('old-token');
  await writeFile(old.file, (await readFile(old.file, 'utf8')) + '\n');
  expect((await observer.conflicts(connection, own.root))[0].id).not.toBe(found[0].id);
  expect(other.root).not.toBe(found[0].root);
});

it.each(['powershell.exe', 'portal-background-v1.exe'])('identifies owned Windows desktop tasks launched by %s', async launcherName => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'portal-win-discovery-'))); roots.push(home);
  const root = path.join(home, 'old'); await mkdir(root);
  await writeFile(path.join(root, 'run.ps1'), 'fixture');
  await writeFile(path.join(root, 'portal.toml'), 'name = "windows-laptop"');
  const binary = path.join(root, 'heart-portal.exe');
  await writeFile(binary, 'legacy engine without a status subcommand');
  await writeFile(path.join(root, '.portal-launch.json'), JSON.stringify({ arguments: [], working_directory: root,
    environment: { PORTAL_CONNECT_LINK: 'https://example.org/fixture/?token=previous-token' } }));
  const scripts: string[] = [];
  const run: Command = async (_file, args) => {
    const script = Buffer.from(args.at(-1)!, 'base64').toString('utf16le'); scripts.push(script);
    if (script.includes('@(Get-ScheduledTask)')) return JSON.stringify([{ label: 'town.beings.desktop.portal.aa', execute: launcherName === 'powershell.exe' ? launcherName : path.join(root, launcherName), arguments: `-NoProfile -File "${root}/run.ps1"` }]);
    if (script.includes('ConvertTo-SecureString')) return 'https://example.org/fixture/?token=previous-token';
    if (script.includes('GetOwnerSid')) return JSON.stringify([{ pid: 1234, binary }]);
    throw new Error('Config file not found: status');
  };
  const observer = new ExternalPortalObserver(run, 'win32', home);
  const connection = parseConnection('https://example.org/fixture/?token=current-token');
  expect(await observer.conflicts(connection)).toMatchObject([{ root, service: { label: 'town.beings.desktop.portal.aa', existing: false, name: 'windows-laptop' } }]);
  expect(await observer.conflicts(connection, root)).toEqual([]);
  expect(scripts[0]).toContain('SecurityIdentifier');
  expect(scripts[0]).toContain("$_.TaskPath -eq '\\'");
  expect(scripts.join('\n')).not.toContain('previous-token');
  expect(scripts.some(script => script.includes(`& '${binary}'`))).toBe(false);
  await expect(observer.forUpgrade(connection, 'fixture', undefined, 0, true)).rejects.toThrow('不支持状态命令');
});
