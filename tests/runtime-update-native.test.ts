import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, copyFile, chmod, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { ExternalPortalObserver } from '../desktop/main/portal/external';
import { BackgroundPortal, command, windowsModulePath } from '../desktop/main/portal/background';
import { RuntimeUpdater, digest, restoreRuntimeMode, type RuntimeBundle } from '../desktop/main/updates/runtime';
import { parseConnection } from '../desktop/main/chat/connection';
import type { Settings } from '../desktop/shared/types';
import { PortalSupervisor } from '../desktop/main/portal/supervisor';
import { PortalTakeover } from '../desktop/main/portal/takeover';

it.skipIf(process.env.PORTAL_DESKTOP_NATIVE_UPGRADE_TESTS !== '1' || process.platform !== 'darwin')('returns an upgraded saved service to foreground mode without leaving login startup enabled', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'portal-foreground-upgrade-'));
  const directory = path.join(root, 'profile');
  const background = new BackgroundPortal(directory), portal = new PortalSupervisor(directory);
  const binary = path.resolve('resources/heart-portal');
  const settings: Settings = { endpoint: '', being: '', hasToken: true, portalName: 'foreground-upgrade', portalBinary: binary,
    workspace: root, autoStart: false, backgroundEnabled: false, allowExec: false, kitsEnabled: false };
  const connection = parseConnection(`http://127.0.0.1:1/${path.basename(root)}/?token=foreground-upgrade-fixture`);
  const version = /\b(\d+\.\d+\.\d+)\b/.exec(await command(binary, ['--version']))![1];
  const bundle: RuntimeBundle = { schema: 1, id: 'e'.repeat(64), clientVersion: '0.1.4', portalVersion: version,
    sha256: digest(await readFile(binary)), platform: process.platform, arch: process.arch };
  try {
    // A disabled registration can remain after the user switches to foreground.
    await background.enable({ ...settings, backgroundEnabled: true }, connection);
    await background.disable();
    expect((await new RuntimeUpdater(directory, background).sync(binary, bundle, settings, connection)).phase).toBe('updated');
    const probePid = background.state.pid!;
    const service = background.installedService!;
    const next = { ...settings, portalBinary: path.join(service.root, 'heart-portal'), portalConfigPath: service.configPath };
    await restoreRuntimeMode(background, next, async () => { await portal.start(next, connection); await portal.waitReady(); }, true);
    expect(await background.refresh()).toMatchObject({ enabled: false, running: false });
    expect(() => process.kill(probePid, 0)).toThrow();
    const pid = portal.state.pid!;
    expect(pid).toBeGreaterThan(0);
    expect(pid).not.toBe(probePid);
    await portal.stop();
    expect(() => process.kill(pid, 0)).toThrow();
    await restoreRuntimeMode(background, next, () => portal.start(next, connection), false);
    expect(portal.managing).toBe(false);
    expect(await background.refresh()).toMatchObject({ enabled: false, running: false });
  } finally {
    await portal.stop(); await background.disable();
    if (background.installedService) await rm(background.installedService.file, { force: true });
    await rm(root, { recursive: true, force: true });
  }
}, 45_000);

it.skipIf(process.env.PORTAL_DESKTOP_NATIVE_UPGRADE_TESTS !== '1' || !['darwin', 'win32'].includes(process.platform))('runs the bundled engine in the foreground without relocating or starting a second supervisor', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'town-foreground-'));
  const portal = new PortalSupervisor(root);
  const binary = path.resolve('resources', process.platform === 'win32' ? 'heart-portal.exe' : 'heart-portal');
  const settings: Settings = { endpoint: '', being: '', hasToken: true, portalName: 'foreground-fixture', portalBinary: binary, workspace: root, autoStart: false, allowExec: false, kitsEnabled: false };
  try {
    for (const args of [['upgrade'], ['upgrade', '--file', path.join(root, 'absent')], ['upgrade', '--target', root]]) {
      const child = spawn(binary, ['--config', path.join(root, 'fixture.toml'), ...args], {
        env: { ...process.env, HEART_PORTAL_CLIENT_MANAGED: '1', HEART_PORTAL_SUPERVISED: '1' }, stdio: ['ignore', 'ignore', 'pipe'],
      });
      let error = ''; child.stderr.on('data', data => { error += data.toString(); });
      const code = await new Promise<number | null>((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
      expect(code).not.toBe(0);
      expect(error).toContain('managed by Town-Client');
    }
    await portal.start(settings, parseConnection(`http://127.0.0.1:1/${path.basename(root)}/?token=fixture`));
    const pid = portal.state.pid;
    const deadline = Date.now() + 15_000;
    while (portal.state.phase === 'starting' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 250));
    expect(portal.state.phase).toBe('reconnecting');
    expect(portal.state.pid).toBe(pid);
    const ready = JSON.parse(await readFile(path.join(root, '.portal-ready.json'), 'utf8'));
    expect(ready.pid).toBe(pid);
    await portal.stop();
    expect(() => process.kill(pid!, 0)).toThrow();
  } finally { await portal.stop(); await rm(root, { recursive: true, force: true }); }
}, 30_000);

it.skipIf(process.env.PORTAL_DESKTOP_NATIVE_UPGRADE_TESTS !== '1' || !['darwin', 'win32'].includes(process.platform))('replaces the real OS supervisor offline, then restores the prior runtime after a bad candidate', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'town-native-upgrade-'));
  const directory = path.join(root, 'profile');
  const background = new BackgroundPortal(directory);
  // Allocate a local closed port: readiness must not require the remote relay.
  const socket = createServer();
  await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  const binary = path.resolve('resources', process.platform === 'win32' ? 'heart-portal.exe' : 'heart-portal');
  const version = /\b(\d+\.\d+\.\d+)\b/.exec(await command(binary, ['--version']))![1];
  const settings: Settings = { endpoint: '', being: '', hasToken: true, portalName: 'upgrade-fixture', portalBinary: binary, workspace: root, autoStart: false, backgroundEnabled: true, allowExec: false, kitsEnabled: false };
  const connection = parseConnection(`http://127.0.0.1:${port}/fixture/?token=upgrade-fixture`);
  const bundle: RuntimeBundle = { schema: 1, id: 'b'.repeat(64), clientVersion: '0.1.1', portalVersion: version, sha256: digest(await readFile(binary)), platform: process.platform, arch: process.arch };
  try {
    await background.enable(settings, connection);
    const old = { ...background.installedService! };
    const started = Date.now() + 10_000;
    while (!(await background.refresh()).running && Date.now() < started) await new Promise(resolve => setTimeout(resolve, 200));
    const oldPid = background.state.pid;
    expect(oldPid).toBeGreaterThan(0);
    // Simulate a crash between process start and PID-file persistence. Stop
    // must still find the engine belonging to this exact installation.
    if (process.platform === 'win32') await rm(path.join(old.root, 'pid'), { force: true });
    const config = await readFile(old.configPath!, 'utf8') + '\n# retained custom configuration\n';
    await writeFile(old.configPath!, config);
    const updater = new RuntimeUpdater(directory, background);
    expect((await updater.sync(binary, bundle, settings, connection)).phase).toBe('updated');
    const good = { ...background.installedService! };
    expect(good.root).not.toBe(old.root);
    expect(background.state.running).toBe(true);
    expect(() => process.kill(oldPid!, 0)).toThrow();
    expect(await readFile(good.configPath!, 'utf8')).toBe(config);
    expect((await background.portalState()).phase).not.toBe('connected');
    // Same platform executable that exits without starting Portal.
    const bad = path.join(root, process.platform === 'win32' ? 'bad.exe' : 'bad');
    if (process.platform === 'win32') await copyFile(path.join(process.env.SystemRoot!, 'System32/where.exe'), bad);
    else { await writeFile(bad, '#!/bin/sh\nexit 1\n'); await chmod(bad, 0o700); }
    const badBundle = { ...bundle, id: 'c'.repeat(64), sha256: digest(await readFile(bad)) };
    await expect(updater.sync(bad, badBundle, settings, connection)).rejects.toThrow('已恢复旧服务');
    expect(background.installedService).toEqual(good);
    const deadline = Date.now() + 8000;
    while (!(await background.refresh()).running && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 200));
    expect(background.state.running).toBe(true);
    expect(await readFile(good.configPath!, 'utf8')).toBe(config);
  } catch (error) {
    console.error('Native Windows/macOS operation failed:', error);
    throw error;
  } finally {
    await background.disable();
    if (process.platform === 'darwin' && background.installedService?.file) await rm(background.installedService.file, { force: true });
    if (process.platform === 'win32') {
      const script = windowsModulePath + `$task=Get-ScheduledTask | Where-Object TaskName -eq '${background.label}'; if ($task) { $task | Unregister-ScheduledTask -Confirm:$false -ErrorAction Stop }; exit 0`;
      await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
    }
    await rm(path.dirname(background.runtimeDirectory), { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
// Includes a deliberate 25 s startup failure plus real OS stop/start commands.
}, 120_000);

it.skipIf(process.env.PORTAL_DESKTOP_NATIVE_UPGRADE_TESTS !== '1' || !['darwin', 'win32'].includes(process.platform))('takes over an independent Portal and supervisor after a manual client upgrade', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'town-manual-upgrade-'));
  const directory = path.join(root, 'profile');
  const background = new BackgroundPortal(directory);
  const binary = path.resolve('resources', process.platform === 'win32' ? 'heart-portal.exe' : 'heart-portal');
  const oldRoot = path.join(os.homedir(), '.heart-portal', 'clients', path.basename(root), 'old runtime with spaces');
  const { mkdir } = await import('node:fs/promises'); await mkdir(oldRoot, { recursive: true, mode: 0o700 });
  const oldBinary = path.join(oldRoot, path.basename(binary)); await copyFile(process.env.PORTAL_DESKTOP_TEST_EXTERNAL_PORTAL || binary, oldBinary); await chmod(oldBinary, 0o700);
  const configPath = path.join(oldRoot, 'custom config.toml');
  const settings: Settings = { endpoint: '', being: '', hasToken: true, portalName: 'manual-upgrade', portalBinary: binary, workspace: oldRoot, autoStart: true, backgroundEnabled: true, allowExec: false, kitsEnabled: false };
  const { portalConfig } = await import('../desktop/main/portal/supervisor');
  const original = portalConfig(settings) + '\n# exact original configuration\n'; await writeFile(configPath, original);
  const connection = parseConnection(`http://127.0.0.1:1/test-${path.basename(root)}/?token=manual-upgrade-fixture`);
  const observer = new ExternalPortalObserver();
  let child: ReturnType<typeof spawn> | undefined;
  try {
    child = spawn(oldBinary, ['--config', configPath, '--name', settings.portalName], { cwd: oldRoot, stdio: 'ignore',
      env: { ...process.env, PORTAL_CONNECT_LINK: connection.link, HEART_PORTAL_SUPERVISED: undefined,
        ...(process.platform === 'win32' ? { PSModulePath: path.join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/Modules') } : {}) } });
    const deadline = Date.now() + 60_000;
    let external = [] as Awaited<ReturnType<typeof observer.forUpgrade>>;
    while (!external.length && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 500));
      external = await observer.forUpgrade(connection, background.label);
    }
    expect(external).toHaveLength(1);
    expect(external[0]).toMatchObject({ name: settings.portalName });
    expect(await realpath(external[0].configPath!)).toBe(await realpath(configPath));
    expect(await realpath(external[0].cwd!)).toBe(await realpath(oldRoot));
    const manager = new PortalTakeover(directory, { discover: () => observer.conflicts(connection, background.installedService?.root), preflight: async () => {}, stop: target => background.unload(target.service!) });
    const updater = new RuntimeUpdater(directory, background);
    await manager.run(connection, 'automatic', async () => {
      await background.enable({ ...settings, portalConfigPath: configPath }, connection);
      await updater.waitReady(background.installedService!);
    });
    expect(background.state.running).toBe(true);
    expect(await readFile(background.installedService!.configPath!, 'utf8')).toBe(original);
    expect(await observer.forUpgrade(connection, background.label, background.installedService!.root)).toEqual([]);
  } catch (error) {
    console.error('Independent runtime takeover failed:', error);
    throw error;
  } finally {
    await background.disable();
    const { portableCommand } = await import('../desktop/main/portal/background');
    await portableCommand(oldBinary, 'stop').catch(() => {});
    child?.kill();
    await rm(path.dirname(oldRoot), { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    if (process.platform === 'darwin' && background.installedService?.file) await rm(background.installedService.file, { force: true });
    if (process.platform === 'win32') {
      const script = windowsModulePath + `$task=Get-ScheduledTask | Where-Object TaskName -eq '${background.label}'; if ($task) { $task | Unregister-ScheduledTask -Confirm:$false -ErrorAction Stop }; exit 0`;
      await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
    }
    await rm(path.dirname(background.runtimeDirectory), { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
}, 180_000);
