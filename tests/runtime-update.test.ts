import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BackgroundPortal, type Command } from '../desktop/main/portal/background';
import { RuntimeUpdater, digest, restoreRuntimeMode, type RuntimeBundle } from '../desktop/main/updates/runtime';
import { parseConnection } from '../desktop/main/chat/connection';
import type { Settings } from '../desktop/shared/types';
import { portalConfig } from '../desktop/main/portal/supervisor';
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture(platform: 'darwin' | 'win32' = 'darwin') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'town-upgrade-')); dirs.push(root);
  const profile = path.join(root, 'profile');
  const calls: string[] = []; let loaded = false, disabled = false;
  const run: Command = async (_file, args) => {
    const script = platform === 'win32' ? Buffer.from(args.at(-1)!, 'base64').toString('utf16le') : args.join(' ');
    calls.push(script);
    if (platform === 'win32') {
      if (script.includes('[Console]::In.ReadToEnd()')) return 'preserved-dpapi';
      if (script.includes('Disable-ScheduledTask')) { disabled = true; loaded = false; }
      if (script.includes('Enable-ScheduledTask')) { disabled = false; loaded = true; }
      if (script.includes('ConvertTo-Json')) return JSON.stringify({ enabled: !disabled, running: loaded, pid: loaded ? 1234 : undefined });
    } else {
      if (args[0] === 'print-disabled') return disabled ? `"${background.label}" => disabled` : '';
      if (args[0] === 'print') { if (!loaded) throw new Error('not loaded'); return 'state = running\npid = 1234'; }
      if (args[0] === 'disable') disabled = true;
      if (args[0] === 'enable') disabled = false;
      if (args[0] === 'bootstrap') loaded = true;
      if (args[0] === 'bootout') loaded = false;
    }
    return '';
  };
  const settings: Settings = { endpoint: '', being: '', hasToken: true, portalName: 'test', portalBinary: process.execPath, workspace: root, autoStart: false, backgroundEnabled: true, allowExec: false, kitsEnabled: false };
  const connection = parseConnection('https://example.org/test/?token=fixture-secret');
  const background = new BackgroundPortal(profile, run, platform, root);
  await background.enable(settings, connection);
  const previous = { ...background.installedService! };
  // Commands are mocked; do not deep-compare the host's 100 MB Node executable.
  await writeFile(path.join(previous.root, platform === 'win32' ? 'heart-portal.exe' : 'heart-portal'), 'old executable');
  const original = 'name = "test"\nworkspace = "unchanged"\n# custom tools and settings must survive\n';
  await writeFile(previous.configPath!, original);
  const binary = path.join(root, 'new-engine'); await writeFile(binary, 'new executable');
  const bundle: RuntimeBundle = { schema: 1, id: 'a'.repeat(64), clientVersion: '0.1.1', portalVersion: '0.8.1', sha256: digest(await readFile(binary)), platform, arch: process.arch };
  const updater = (ready: (service: any) => Promise<void> = async () => {}) => new RuntimeUpdater(profile, background, platform, ready);
  calls.length = 0;
  return { root, profile, background, previous, original, settings, connection, binary, bundle, calls, updater };
}
for (const platform of ['darwin', 'win32'] as const) {
  it(`repairs a missing ${platform} engine even when its recorded bundle is current`, async () => {
    const f = await fixture(platform);
    await f.background.setService({ ...f.previous, bundleId: f.bundle.id });
    const name = platform === 'win32' ? 'heart-portal.exe' : 'heart-portal';
    await rm(path.join(f.previous.root, name));
    expect((await f.updater().sync(f.binary, f.bundle, f.settings, f.connection)).phase).toBe('updated');
    expect(await readFile(path.join(f.background.installedService!.root, name), 'utf8')).toBe('new executable');
    expect(await readFile(f.background.installedService!.configPath!, 'utf8')).toBe(f.original);
  });

  it(`preserves customized legacy ${platform} configs without ownership metadata`, async () => {
    const f = await fixture(platform);
    const old = { ...f.previous };
    delete old.generatedConfig;
    await f.background.setService(old);
    await f.updater().sync(f.binary, f.bundle, { ...f.settings, portalConfigPath: old.configPath }, f.connection);
    expect(f.background.installedService!.configPath).toBe(old.configPath);
    expect(f.background.installedService!.generatedConfig).toBe(false);
    expect(await readFile(old.configPath!, 'utf8')).toBe(f.original);
  });

  it.each(['missing', 'invalid'])(`rejects a %s ${platform} config before stopping the existing service`, async kind => {
    const f = await fixture(platform);
    if (kind === 'missing') await rm(f.previous.configPath!);
    else await writeFile(f.previous.configPath!, 'workspace = [');
    await expect(f.updater().sync(f.binary, f.bundle, f.settings, f.connection)).rejects.toThrow();
    expect(f.calls).toEqual([]);
    expect(f.background.installedService).toEqual(f.previous);
    expect(f.background.state.running).toBe(true);
    await expect(readFile(path.join(f.profile, 'runtime-update.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it(`replaces a legacy service with the current client config when ownership metadata is missing (${platform})`, async () => {
    const f = await fixture(platform);
    const legacy = portalConfig(f.settings).replace('screenshot = true', 'screenshot = false');
    await writeFile(f.previous.configPath!, legacy);
    // This is the shape written by pre-generatedConfig clients.
    const old = { ...f.previous };
    delete old.generatedConfig;
    await f.background.setService(old);
    await f.updater().sync(f.binary, f.bundle, { ...f.settings, portalConfigPath: old.configPath }, f.connection);
    const service = f.background.installedService!;
    expect(service.generatedConfig).toBe(true);
    expect(await readFile(service.configPath!, 'utf8')).toContain('screenshot = true');
  });

  it(`refreshes untouched ${platform} client defaults during upgrade while preserving the previous file`, async () => {
    const f = await fixture(platform);
    const legacy = portalConfig(f.settings).replace('screenshot = true', 'screenshot = false');
    await writeFile(f.previous.configPath!, legacy);
    await f.updater().sync(f.binary, f.bundle, f.settings, f.connection);
    const service = f.background.installedService!;
    expect(service.generatedConfig).toBe(true);
    expect(service.configPath).toBe(path.join(service.root, 'portal.toml'));
    expect(await readFile(service.configPath!, 'utf8')).toContain('screenshot = true');
    expect(await readFile(f.previous.configPath!, 'utf8')).toBe(legacy);
  });
  it(`keeps an explicitly imported ${platform} screenshot opt-out intact during upgrade`, async () => {
    const f = await fixture(platform);
    const legacy = portalConfig(f.settings).replace('screenshot = true', 'screenshot = false');
    await writeFile(f.previous.configPath!, legacy);
    // An imported config is not client-generated metadata.
    await f.background.setService({ ...f.background.installedService!, generatedConfig: false });
    await f.updater().sync(f.binary, f.bundle, { ...f.settings, portalConfigPath: f.previous.configPath }, f.connection);
    expect(f.background.installedService!.generatedConfig).toBe(false);
    expect(await readFile(f.background.installedService!.configPath!, 'utf8')).toBe(legacy);
  });
  it(`updates the ${platform} engine and supervisor together, preserving exact config and credentials`, async () => {
    const f = await fixture(platform); let checked = false;
    const result = await f.updater(async service => {
      checked = true;
      expect(await readFile(path.join(service.root, platform === 'darwin' ? 'heart-portal' : 'heart-portal.exe'), 'utf8')).toBe('new executable');
      expect(await readFile(service.configPath, 'utf8')).toBe(f.original);
    }).sync(f.binary, f.bundle, f.settings, f.connection);
    expect(checked).toBe(true); expect(result.phase).toBe('updated');
    expect(f.background.installedService!.root).not.toBe(f.previous.root);
    expect(await readFile(f.previous.configPath!, 'utf8')).toBe(f.original);
    const credential = platform === 'darwin' ? 'connection.url' : 'connection.dpapi';
    expect(await readFile(path.join(f.background.installedService!.root, credential))).toEqual(await readFile(path.join(f.previous.root, credential)));
    expect(f.calls.findIndex(s => s.includes(platform === 'darwin' ? 'bootout' : 'Disable-ScheduledTask'))).toBeLessThan(f.calls.findIndex(s => s.includes(platform === 'darwin' ? 'bootstrap' : 'Register-ScheduledTask')));
    f.calls.length = 0;
    expect((await f.updater().sync(f.binary, f.bundle, f.settings, f.connection)).phase).toBe('current');
    expect(f.calls).toEqual([]);
  });
  it(`rolls back ${platform} registration, running state and source on startup failure`, async () => {
    const f = await fixture(platform);
    await expect(f.updater(async () => { throw new Error('bad engine'); }).sync(f.binary, f.bundle, f.settings, f.connection)).rejects.toThrow('已恢复旧服务');
    expect(f.background.installedService).toEqual(f.previous);
    expect(f.background.state.running).toBe(true);
    expect(await readFile(f.previous.configPath!, 'utf8')).toBe(f.original);
    await expect(readFile(path.join(f.profile, 'runtime-update.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it(`automatically starts a disabled ${platform} service after a client upgrade`, async () => {
    const f = await fixture(platform); await f.background.disable(); f.calls.length = 0;
    await f.updater().sync(f.binary, f.bundle, f.settings, f.connection);
    expect(f.background.state.enabled).toBe(true); expect(f.background.state.running).toBe(true);
    expect(f.calls.some(s => s.includes(platform === 'darwin' ? 'bootstrap' : 'Enable-ScheduledTask'))).toBe(true);
  });
  it(`keeps ${platform} login startup disabled for a foreground-only client after upgrading a saved service`, async () => {
    const f = await fixture(platform);
    const settings = { ...f.settings, backgroundEnabled: false, autoStart: false };
    await f.background.disable();
    await f.updater().sync(f.binary, f.bundle, settings, f.connection);
    const start = vi.fn(async () => {
      expect(f.background.state.enabled).toBe(false);
      expect(f.background.state.running).toBe(false);
    });
    await restoreRuntimeMode(f.background, settings, start, true);
    expect(start).toHaveBeenCalledTimes(1);
    // A later ordinary launch must respect the user's disabled startup option.
    await restoreRuntimeMode(f.background, settings, start, false);
    expect(start).toHaveBeenCalledTimes(1);
  });
  it(`retries an enabled but exited ${platform} service on ordinary client startup without enabling a stopped service`, async () => {
    const f = await fixture(platform);
    const load = vi.spyOn(f.background, 'load').mockResolvedValue(undefined);
    const foreground = vi.fn();
    f.background.state = { ...f.background.state, enabled: true, running: false };
    await restoreRuntimeMode(f.background, f.settings, foreground, false);
    expect(load).toHaveBeenCalledWith(f.background.installedService);
    load.mockClear();
    f.background.state = { ...f.background.state, enabled: true, running: true };
    await restoreRuntimeMode(f.background, f.settings, foreground, false);
    f.background.state = { ...f.background.state, enabled: false, running: false };
    await restoreRuntimeMode(f.background, f.settings, foreground, false);
    expect(load).not.toHaveBeenCalled();
    expect(foreground).not.toHaveBeenCalled();
  });
}
it('activates the exact bundled engine once even when the old service used a different binary, and rejects corrupt packages', async () => {
  const f = await fixture();
  const current = await readFile(f.binary);
  expect((await f.updater().sync(f.binary, f.bundle, f.settings, f.connection)).phase).toBe('updated');
  expect(await readFile(path.join(f.background.installedService!.root, 'heart-portal'))).toEqual(current);
  expect(f.background.installedService!.bundleId).toBe(f.bundle.id);
  f.calls.length = 0;
  expect((await f.updater().sync(f.binary, f.bundle, f.settings, f.connection)).phase).toBe('current');
  expect(f.calls).toEqual([]);
  await writeFile(f.binary, 'corrupted');
  await expect(f.updater().sync(f.binary, f.bundle, f.settings, f.connection)).rejects.toThrow('校验失败');
  expect(f.calls).toEqual([]);
});
it('recovers an interrupted runtime switch before retrying any upgrade', async () => {
  const f = await fixture();
  const candidate = { ...f.previous, root: path.join(f.background.runtimeDirectory, 'interrupted') };
  await mkdir(candidate.root, { recursive: true });
  await writeFile(path.join(f.profile, 'runtime-update.json'), JSON.stringify({ schema: 1, previous: f.previous, candidate, enabled: true, previousPlist: await readFile(f.previous.file, 'utf8') }));
  await f.background.unload(f.previous);
  await f.background.installRegistration(candidate);
  await f.background.setService(candidate);
  expect(await f.updater().recover()).toBe(true);
  expect(f.background.installedService).toEqual(f.previous); expect(f.background.state.running).toBe(true);
  expect(await f.updater().recover()).toBe(false);
});

it('does not adopt or upgrade an independent runtime recorded by an older client', async () => {
  const f = await fixture();
  const legacy = { ...f.previous, existing: true, kind: 'portable' as const, binary: '/missing/old-portal' };
  vi.spyOn(f.background, 'refresh').mockResolvedValue(f.background.state);
  await f.background.setService(legacy);
  f.calls.length = 0;
  expect((await f.updater().sync(f.binary, f.bundle, f.settings, f.connection)).phase).toBe('skipped');
  expect(f.calls).toEqual([]);
  expect(await readFile(f.previous.configPath!, 'utf8')).toBe(f.original);
});

it('does not resurrect independent runtimes from an old interrupted migration journal', async () => {
  const f = await fixture();
  const previous = { ...f.previous, existing: true, kind: 'portable' as const, binary: '/missing/old-portal' };
  const candidate = { ...f.previous, root: path.join(f.background.runtimeDirectory, 'interrupted') };
  await mkdir(candidate.root, { recursive: true });
  await writeFile(path.join(f.profile, 'runtime-update.json'), JSON.stringify({ schema: 1, previous, candidate, enabled: true, external: [previous] }));
  const load = vi.spyOn(f.background, 'load');
  expect(await f.updater().recover()).toBe(true);
  expect(load).not.toHaveBeenCalled();
  expect(f.background.installedService).toBeNull();
  expect(await readFile(f.previous.configPath!, 'utf8')).toBe(f.original);
});
