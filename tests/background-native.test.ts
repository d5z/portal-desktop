import { expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BackgroundPortal, command, windowsModulePath, windowsPowerShellScript } from '../desktop/main/portal/background';
import { parseConnection } from '../desktop/main/chat/connection';

it.skipIf(process.platform !== 'win32')('opens a saved Windows runtime even when its scheduled task no longer exists', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'portal-missing-task-'));
  let phase = 'discover';
  const commands: { phase: string; milliseconds: number; error?: string }[] = [];
  const background = new BackgroundPortal(root, async (file, args, input) => {
    const started = Date.now(), operation = phase;
    console.info(`[missing-task] ${operation}: starting ${path.basename(file)}`);
    let failure: string | undefined;
    try { return await command(file, args, input); }
    catch (error) { failure = String(error); throw error; }
    finally {
      const entry = { phase: operation, milliseconds: Date.now() - started, error: failure };
      commands.push(entry);
      console.info('[missing-task]', JSON.stringify(entry));
    }
  });
  const service = { label: background.label, root: path.join(root, 'runtime'), file: '', existing: false };
  const metadata = JSON.stringify(service);
  await writeFile(path.join(root, 'portal-service.json'), metadata);
  try {
    await expect(background.discover({ endpoint: '', being: '', hasToken: false, portalName: 'fixture', portalBinary: process.execPath,
      workspace: root, autoStart: false, backgroundEnabled: false, allowExec: false, kitsEnabled: false }, null))
      .resolves.toMatchObject({ installed: true, enabled: false, running: false });
    expect(background.installedService).toEqual(service);
    expect(await readFile(path.join(root, 'portal-service.json'), 'utf8')).toBe(metadata);
    phase = 'disable and refresh';
    await expect(background.disable()).resolves.toMatchObject({ enabled: false, running: false });
  } catch (error) {
    await mkdir('test-results', { recursive: true });
    await writeFile('test-results/background-native-failure.json', JSON.stringify({ phase, commands, state: background.state, error: String(error) }, null, 2));
    throw error;
  } finally { await rm(root, { recursive: true, force: true }); }
// Discover, unload and refresh each have a 30s production command deadline.
// Let those deadlines report the failing operation before Vitest interrupts.
}, 100_000);

it.skipIf(process.platform !== 'win32')('keeps scheduler permission failures visible as readable UTF-8 instead of CLIXML', async () => {
  const script = windowsPowerShellScript("function Get-ScheduledTask { throw '计划任务访问被拒绝 fixture' }; Find-PortalTask 'fixture'");
  const failure = await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')])
    .then(() => { throw new Error('Expected scheduler failure'); }, error => error as Error);
  expect(failure.message).toContain('计划任务访问被拒绝 fixture');
  expect(failure.message).not.toContain('CLIXML');
}, 35_000);

it.skipIf(process.env.PORTAL_DESKTOP_NATIVE_UPGRADE_TESTS !== '1' || process.platform !== 'win32')('protects credentials and registers an interactive Windows task', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'town-windows-registration-'));
  const background = new BackgroundPortal(path.join(root, 'profile'));
  try {
    await background.enable({ endpoint: '', being: '', hasToken: true, portalName: 'fixture', portalBinary: path.resolve('resources/heart-portal.exe'),
      workspace: root, autoStart: false, backgroundEnabled: true, allowExec: false, kitsEnabled: false },
    parseConnection('http://127.0.0.1:1/fixture/?token=registration-fixture'));
    expect(background.state.installed).toBe(true);
    expect(background.state.enabled).toBe(true);
    const encrypted = await readFile(path.join(background.installedService!.root, 'connection.dpapi'), 'utf8');
    expect(encrypted).not.toContain('registration-fixture');
    expect(encrypted.length).toBeGreaterThan(40);
    const saved = background.installedService!;
    // Preserve the current process while updating a prior PowerShell action.
    const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
    const ps = (script: string) => command('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(windowsPowerShellScript(script), 'utf16le').toString('base64')]);
    await ps(`$a=New-ScheduledTaskAction -Execute (Join-Path $PSHOME 'powershell.exe') -Argument ${quote('-NoProfile -WindowStyle Hidden -File "' + path.join(saved.root, 'run.ps1') + '"')}; Set-ScheduledTask -TaskName '${background.label}' -Action $a | Out-Null`);
    await background.load(saved);
    expect((await ps(`(Get-ScheduledTask -TaskName '${background.label}').Actions[0].Execute`)).trim()).toBe(path.join(saved.root, 'portal-background-v1.exe'));
    await background.disable();
    const unregister = windowsPowerShellScript(`Unregister-ScheduledTask -TaskName '${background.label}' -Confirm:$false`);
    await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(unregister, 'utf16le').toString('base64')]);
    await expect(background.refresh()).resolves.toMatchObject({ enabled: false, running: false });
    // Reopening and explicitly starting must repair only the missing task,
    // preserving the runtime, configuration and DPAPI credential bytes.
    const reopened = new BackgroundPortal(path.join(root, 'profile'));
    await reopened.discover({ endpoint: '', being: '', hasToken: true, portalName: 'fixture', portalBinary: path.resolve('resources/heart-portal.exe'),
      workspace: root, autoStart: false, backgroundEnabled: true, allowExec: false, kitsEnabled: false }, null);
    await reopened.load(saved);
    expect((await reopened.refresh()).enabled).toBe(true);
    expect(reopened.installedService).toEqual(saved);
    expect(await readFile(path.join(saved.root, 'connection.dpapi'), 'utf8')).toBe(encrypted);
  } catch (error) {
    console.error('Native Windows/macOS operation failed:', error);
    throw error;
  } finally {
    await background.disable();
    const script = windowsModulePath + `$task=Get-ScheduledTask | Where-Object TaskName -eq '${background.label}'; if ($task) { $task | Unregister-ScheduledTask -Confirm:$false -ErrorAction Stop }; exit 0`;
    await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
    await rm(root, { recursive: true, force: true });
  }
}, 70_000);

it.skipIf(process.env.PORTAL_DESKTOP_NATIVE_UPGRADE_TESTS !== '1' || process.platform !== 'darwin')('stops a real launchd conflict retry and restarts the same registered job after correction', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'portal-native-recovery-'));
  const background = new BackgroundPortal(path.join(root, 'profile'));
  const binary = path.join(root, 'fixture-engine');
  const settings = { endpoint: '', being: '', hasToken: true, portalName: 'recovery-fixture', portalBinary: binary,
    workspace: root, autoStart: false, backgroundEnabled: true, allowExec: false, kitsEnabled: false };
  const connection = parseConnection('http://127.0.0.1:1/fixture/?token=recovery-fixture');
  await writeFile(binary, '#!/bin/sh\nprintf x >> attempts\nprintf "another Portal instance is already running for this relay/Being\\n" >&2\nexit 1\n', { mode: 0o700 });
  try {
    await background.enable(settings, connection);
    const service = background.installedService!;
    await vi.waitFor(async () => expect(await readFile(path.join(service.root, '.portal-start-failure'), 'utf8')).toBe('conflict'), { timeout: 12_000, interval: 250 });
    await vi.waitFor(async () => expect(await background.portalState()).toMatchObject({ phase: 'error' }), { timeout: 4000, interval: 250 });
    const status = () => command('/bin/launchctl', ['print', `gui/${process.getuid!()}/${background.label}`]);
    expect(await status()).toContain('last exit code = 0');
    // PathState may dispatch one final guard invocation when the marker is
    // created. It must never relaunch the engine or keep dispatching afterward.
    await new Promise(resolve => setTimeout(resolve, 5500));
    const stopped = await status();
    await new Promise(resolve => setTimeout(resolve, 5500));
    expect((await status()).match(/\bruns = (\d+)/)?.[1]).toBe(stopped.match(/\bruns = (\d+)/)?.[1]);
    expect(await readFile(path.join(root, 'attempts'), 'utf8')).toBe('x');
    // The native portal_restart tool exits successfully. Recovery must still
    // run after exit 0; SuccessfulExit=false alone would break that contract.
    await writeFile(path.join(service.root, 'heart-portal'), '#!/bin/sh\nprintf x >> restarts\nif [ "$(wc -c < restarts | tr -d " ")" = "1" ]; then exit 0; fi\nexec /bin/sleep 60\n', { mode: 0o700 });
    await background.enable(settings, connection);
    await vi.waitFor(async () => expect(await readFile(path.join(root, 'restarts'), 'utf8')).toBe('xx'), { timeout: 10_000, interval: 250 });
    await vi.waitFor(async () => expect((await background.refresh()).running).toBe(true), { timeout: 6000, interval: 250 });
    expect(background.installedService!.root).toBe(service.root);
    expect((await background.portalState()).phase).toBe('starting');
    await expect(readFile(path.join(service.root, '.portal-start-failure'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await background.disable();
    if (background.installedService) await rm(background.installedService.file, { force: true });
    await rm(root, { recursive: true, force: true });
  }
}, 45_000);
