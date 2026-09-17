import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BackgroundPortal, launchAgent, unixRunner, windowsRunner, type Command } from '../desktop/main/portal/background';
import { parseConnection } from '../desktop/main/chat/connection';
import type { Settings } from '../desktop/shared/types';
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'beings-background-')); dirs.push(root);
  const settings: Settings = { endpoint: '', being: '', hasToken: true, portalName: 'test', portalBinary: process.execPath, workspace: root, autoStart: false, backgroundEnabled: true, allowExec: false, kitsEnabled: false };
  const connection = parseConnection('https://example.org/test/?token=secret-credential');
  let loaded = false, disabled = false, fail = false, running = true;
  const calls: string[][] = [];
  const run: Command = async (_file, args) => {
    calls.push(args);
    if (args[0] === 'print-disabled') return disabled ? `"${service.label}" => disabled` : '';
    if (args[0] === 'print') { if (!loaded) throw new Error('not loaded'); return running ? 'state = running\npid = 12345' : 'state = not running\nlast exit code = 0'; }
    if (args[0] === 'bootstrap') { if (fail) { fail = false; throw new Error('bootstrap failed'); } loaded = true; }
    if (args[0] === 'bootout') loaded = false;
    if (args[0] === 'disable') disabled = true;
    if (args[0] === 'enable') disabled = false;
    if (args[0] === 'kickstart') running = true;
    return '';
  };
  const service = new BackgroundPortal(path.join(root, 'profile'), run, 'darwin', root);
  return { root, settings, connection, service, run, calls, fail: () => { fail = true; }, exited: () => { running = false; } };
}
it.skipIf(process.platform === 'win32')('installs an independent runtime with restricted credentials, preserves it across client instances, and disables login recovery explicitly', async () => {
  const f = await fixture();
  await f.service.enable(f.settings, f.connection);
  expect(f.service.state).toMatchObject({ installed: true, enabled: true, running: true });
  const metadata = JSON.parse(await readFile(path.join(f.root, 'profile/portal-service.json'), 'utf8'));
  expect(await readFile(path.join(metadata.root, 'connection.url'), 'utf8')).toBe(f.connection.link);
  expect((await stat(path.join(metadata.root, 'connection.url'))).mode & 0o777).toBe(0o600);
  expect(await readFile(metadata.file, 'utf8')).not.toContain(f.connection.token);
  expect(await readFile(path.join(metadata.root, 'run.sh'), 'utf8')).not.toContain(f.connection.token);
  expect(JSON.stringify(f.calls)).not.toContain(f.connection.token);
  const reopened = new BackgroundPortal(path.join(f.root, 'profile'), f.run, 'darwin', f.root);
  await reopened.discover(f.settings, f.connection); await reopened.enable(f.settings, f.connection);
  expect(f.calls.filter(args => args[0] === 'bootstrap')).toHaveLength(1);
  await reopened.disable(); expect(reopened.state).toMatchObject({ enabled: false, running: false });
  await reopened.enable(f.settings, f.connection); expect(reopened.state.running).toBe(true);
});
it.skipIf(process.platform === 'win32')('restores the previous service and configuration when an update cannot start', async () => {
  const f = await fixture(); await f.service.enable(f.settings, f.connection);
  const manifest = path.join(f.root, 'profile/portal-service.json');
  const before = await readFile(manifest, 'utf8'); const metadata = JSON.parse(before);
  const plist = await readFile(metadata.file, 'utf8');
  f.fail();
  await expect(f.service.enable({ ...f.settings, portalName: 'changed' }, f.connection)).rejects.toThrow('bootstrap failed');
  expect(await readFile(manifest, 'utf8')).toBe(before);
  expect(await readFile(metadata.file, 'utf8')).toBe(plist);
  expect(f.service.state).toMatchObject({ enabled: true, running: true });
  expect((await stat(path.join(metadata.root, 'heart-portal'))).isFile()).toBe(true);
});
it.skipIf(process.platform === 'win32')('renders connection progress without exposing credentials and does not claim a stopped process is connected', async () => {
  const f = await fixture(); await f.service.enable(f.settings, f.connection);
  const metadata = JSON.parse(await readFile(path.join(f.root, 'profile/portal-service.json'), 'utf8'));
  await writeFile(path.join(metadata.root, 'portal.log'), 'Portal relay handshake OK\nsecret-credential\n');
  expect((await f.service.portalState()).phase).toBe('starting');
  await writeFile(path.join(metadata.root, '.portal-status-nonce'), 'test-nonce');
  const sample = { schema: 1, pid: 12345, nonce: 'test-nonce', boot_id: 'test-boot', sequence: 1, state: 'connected', updated_at_ms: Date.now() };
  await writeFile(path.join(metadata.root, '.portal-connection-status.json'), JSON.stringify(sample));
  expect((await f.service.portalState()).phase).toBe('connected');
  expect((await f.service.portalState()).logs.join('\n')).not.toContain(f.connection.token);
  await writeFile(path.join(metadata.root, 'portal.log'), 'Portal relay handshake OK\nrelay session ended\n');
  expect((await f.service.portalState()).phase).toBe('connected');
  await writeFile(path.join(metadata.root, '.portal-connection-status.json'), JSON.stringify({ ...sample, updated_at_ms: Date.now() - 180000 }));
  expect((await f.service.portalState()).phase).not.toBe('connected');
  await f.service.disable(); expect((await f.service.portalState()).phase).toBe('stopped');
});
it.skipIf(process.platform === 'win32')('does not adopt an existing service even when its configuration matches', async () => {
  const f = await fixture(); const runtime = path.join(f.root, 'runtime'); await mkdir(runtime);
  const agents = path.join(f.root, 'Library/LaunchAgents'); await mkdir(agents, { recursive: true });
  const label = 'town.beings.heart-portal.123abc'; const file = path.join(agents, label + '.plist');
  await writeFile(file, 'original-plist'); await writeFile(path.join(runtime, '.portal-connection.url'), f.connection.link);
  const settings = { ...f.settings, portalConfigPath: path.join(runtime, 'portal.toml') };
  const calls: string[][] = [];
  const run: Command = async (bin, args) => {
    calls.push(args);
    if (bin.endsWith('plutil')) return JSON.stringify({ Label: label, WorkingDirectory: runtime, KeepAlive: true, RunAtLoad: true, ProgramArguments: ['/bin/sh', path.join(runtime, 'scripts/portal-launchagent.sh')] });
    return args[0] === 'print' ? 'state = running\npid = 123' : '';
  };
  const service = new BackgroundPortal(path.join(f.root, 'profile'), run, 'darwin', f.root);
  await service.discover(settings, f.connection);
  expect(service.installedService).toBeNull();
  expect(service.state).toMatchObject({ existing: false, running: false });
  expect(calls.some(args => ['bootstrap', 'bootout'].includes(args[0]))).toBe(false);
  expect(await readFile(file, 'utf8')).toBe('original-plist');
  expect(calls).toEqual([]);
});
it('quotes filesystem paths and keeps launch registrations and wrappers free of credentials', async () => {
  const f = await fixture(); const weird = `/tmp/中文 a'b $HOME & <x>`;
  expect(launchAgent('safe-label', weird)).toContain('&amp; &lt;x&gt;');
  const script = unixRunner(weird, weird, { ...f.settings, workspace: weird });
  expect(script).toContain("a'\\''b $HOME"); expect(script).toContain('exec ');
  const win = windowsRunner('C:\\a b', 'C:\\a b\\portal.toml', f.settings);
  expect(win).toContain('ConvertTo-SecureString'); expect(win).toContain('CreateNoWindow = $true');
  expect(win).toContain('Start-Sleep -Seconds 5'); expect(win).not.toContain(f.connection.token);
});
it('ignores an old adoption record without running its binary or losing its configuration reference', async () => {
  const f = await fixture();
  const profile = path.join(f.root, 'profile'); await mkdir(profile);
  const record = JSON.stringify({ label: 'old-portal', root: '/old/runtime', file: '', existing: true,
    kind: 'portable', binary: '/removed/heart-portal', configPath: '/old/config.toml' });
  await writeFile(path.join(profile, 'portal-service.json'), record);
  await f.service.discover(f.settings, f.connection);
  expect(f.service.installedService).toBeNull();
  expect(f.calls).toEqual([]);
  expect(await readFile(path.join(profile, 'portal-service.json'), 'utf8')).toBe(record);
  await expect(f.service.load(JSON.parse(record))).rejects.toThrow('仅支持启动客户端 Portal');
  expect(f.calls).toEqual([]);
});
it('registers Windows login supervision with DPAPI stdin and disables the task and its owned child on stop', async () => {
  const f = await fixture(); const scripts: string[] = []; const inputs: (string | undefined)[] = [];
  let enabled = true, running = true;
  const run: Command = async (_bin, args, input) => {
    const script = Buffer.from(args.at(-1)!, 'base64').toString('utf16le'); scripts.push(script); inputs.push(input);
    if (script.includes('[Console]::In.ReadToEnd()')) return 'encrypted-dpapi-value';
    if (script.includes('Disable-ScheduledTask')) { enabled = false; running = false; }
    if (script.includes('Enable-ScheduledTask')) { enabled = true; running = true; }
    if (script.includes('ConvertTo-Json')) return JSON.stringify({ enabled, running });
    return '';
  };
  const service = new BackgroundPortal(path.join(f.root, 'windows-profile'), run, 'win32', f.root);
  await service.enable(f.settings, f.connection);
  expect(service.state).toMatchObject({ enabled: true, running: true });
  expect(inputs.filter(Boolean)).toEqual([f.connection.link]);
  expect(scripts.join('\n')).not.toContain(f.connection.token);
  expect(scripts.join('\n')).toContain('-AtLogOn');
  expect(scripts.join('\n')).toContain("Join-Path $PSHOME 'powershell.exe'");
  expect(scripts.join('\n')).toContain('New-ScheduledTaskAction -Execute $powershell');
  expect(scripts.join('\n')).toContain('-RestartCount 5');
  const metadata = JSON.parse(await readFile(path.join(f.root, 'windows-profile/portal-service.json'), 'utf8'));
  expect(await readFile(path.join(metadata.root, 'connection.dpapi'), 'utf8')).toBe('encrypted-dpapi-value');
  await service.disable(); expect(service.state.enabled).toBe(false);
  expect(scripts.at(-2)).toContain('ExecutablePath -eq');
});

it('resets a stopped Windows failure marker on explicit load and exports supervisor evidence from its saved runtime', async () => {
  const f = await fixture(); let running = false;
  const run: Command = async (_bin, args) => {
    const script = Buffer.from(args.at(-1)!, 'base64').toString('utf16le');
    if (script.includes('[Console]::In.ReadToEnd()')) return 'dpapi-fixture';
    if (script.includes('Enable-ScheduledTask')) running = true;
    if (script.includes('ConvertTo-Json')) return JSON.stringify({ enabled: true, running, pid: running ? 12345 : undefined });
    return running ? 'Running' : 'Ready';
  };
  const background = new BackgroundPortal(path.join(f.root, 'windows-profile'), run, 'win32');
  await background.enable(f.settings, f.connection);
  const service = background.installedService!;
  running = false;
  await writeFile(path.join(service.root, '.portal-start-failure'), 'crash-limit');
  await writeFile(path.join(service.root, '.portal-start-attempt'), '1 6');
  await writeFile(path.join(service.root, 'portal.err.log.previous'), 'prior engine crash');
  await writeFile(path.join(service.root, 'supervisor.log'), 'engine-exit pid=12345 code=17');
  await writeFile(path.join(service.root, 'supervisor.err.log'), 'decrypt failed ' + f.connection.token);
  const state = await background.portalState();
  expect(state).toMatchObject({ phase: 'error', managed: true, runtimePath: service.root });
  expect(state.logs.join('\n')).toContain('prior engine crash');
  expect(state.logs.join('\n')).toContain('code=17');
  expect(state.logs.join('\n')).toContain('decrypt failed');
  expect(state.logs.join('\n')).not.toContain(f.connection.token);
  await background.load(service);
  expect((await background.refresh()).running).toBe(true);
  expect(background.installedService!.root).toBe(service.root);
  await expect(readFile(path.join(service.root, '.portal-start-failure'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readFile(path.join(service.root, '.portal-start-attempt'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it.skipIf(process.platform === 'win32')('shows terminal startup failure and explicitly restarts a loaded but exited service', async () => {
  const f = await fixture(); await f.service.enable(f.settings, f.connection);
  const root = f.service.installedService!.root;
  f.exited();
  await writeFile(path.join(root, '.portal-start-failure'), 'conflict');
  await writeFile(path.join(root, '.portal-start-attempt'), `${Math.floor(Date.now() / 1000)} 6`);
  expect(await f.service.portalState()).toMatchObject({ phase: 'error', message: expect.stringContaining('同一个 Being') });
  await writeFile(path.join(root, '.portal-start-failure'), 'crash-limit');
  expect(await f.service.portalState()).toMatchObject({ phase: 'error', message: expect.stringContaining('已停止自动重试') });
  await f.service.enable(f.settings, f.connection);
  expect(f.calls.filter(args => args[0] === 'kickstart')).toHaveLength(1);
  expect(f.service.state.running).toBe(true);
  await expect(readFile(path.join(root, '.portal-start-failure'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readFile(path.join(root, '.portal-start-attempt'))).rejects.toMatchObject({ code: 'ENOENT' });
});
