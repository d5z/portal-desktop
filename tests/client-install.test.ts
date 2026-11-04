import { it, expect, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ClientInstall } from '../desktop/main/updates/client-install';
import { BackgroundPortal, type Service } from '../desktop/main/portal/background';
import { parseConnection } from '../desktop/main/chat/connection';
import { assetName, checksumFor, macInstallerScript, windowsInstallerScript } from '../desktop/main/updates/manual-installer';
import { PortalTakeover } from '../desktop/main/portal/takeover';
import { portalIdentity } from '../desktop/main/portal/external';

it.each([true, false])('can install again behind a persisted subagent failure, preserving enabled=%s', async enabled => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'town-install-pending-'));
  const service: Service = { label: 'test', root: path.join(directory, 'engine'), file: '', existing: false };
  let running = enabled;
  const connection = parseConnection('https://example.org/test/?token=fixture');
  const background = { label: service.label, installedService: service, refresh: async () => ({ enabled: running }),
    unload: vi.fn(async () => { running = false; }), load: vi.fn(async () => { running = true; }) } as unknown as BackgroundPortal;
  try {
    const install = new ClientInstall(directory, background);
    await install.prepare('0.1.10', '0.1.11', connection, true);
    const takeover = new PortalTakeover(directory, { discover: async () => [], stop: async () => {}, preflight: async () => {} });
    const hold = JSON.stringify({ schema: 1, identity: portalIdentity(connection), phase: 'blocked', replacing: false,
      message: 'subagent 安装或配置失败。请检查 npm、网络和模型配置；可取消勾选后先连接 Being。' });
    await writeFile(takeover.file, hold);
    const start = vi.fn();
    expect(await takeover.run(connection, 'automatic', start)).toBe(false);
    const quit = vi.fn();
    await new ClientInstall(directory, background).shutdown('0.1.11', '0.1.12', connection, false, {
      cleanup: async () => {}, handoff: async () => {
        expect(await install.read()).toMatchObject({ from: '0.1.11', target: '0.1.12', foreground: true, services: [{ service, enabled }] });
        expect(running).toBe(false);
      }, quit, startForeground: start,
    });
    expect(quit).toHaveBeenCalledOnce();
    expect(start).not.toHaveBeenCalled();
    expect(await readFile(takeover.file, 'utf8')).toBe(hold);
    // Cancellation after replacement must restore the original preference,
    // not the disabled state observed between two install attempts.
    await install.resume((await install.read())!, start);
    expect(running).toBe(enabled);
    expect(start).toHaveBeenCalledOnce();
    expect(await install.read()).toBeNull();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('retains a stopped foreground engine in the recovery record if a retry cannot unload', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'town-install-unload-'));
  const service: Service = { label: 'test', root: directory, file: '', existing: false };
  const unload = vi.fn(async () => {});
  const background = { label: service.label, installedService: service, refresh: async () => ({ enabled: false }), unload } as unknown as BackgroundPortal;
  try {
    const install = new ClientInstall(directory, background);
    await install.prepare('1.0.0', '2.0.0', null, true);
    unload.mockRejectedValueOnce(new Error('busy'));
    const steps = { cleanup: vi.fn(), quit: vi.fn(), startForeground: vi.fn() };
    await expect(install.shutdown('2.0.0', '3.0.0', null, false, steps)).rejects.toThrow('busy');
    expect(steps.cleanup).not.toHaveBeenCalled();
    const pending = await install.read();
    expect(pending?.foreground).toBe(true);
    await install.resume(pending!, steps.startForeground);
    expect(steps.startForeground).toHaveBeenCalledOnce();
    expect(await install.read()).toBeNull();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('retries after rollback itself failed and keeps the committed runtime registration', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'town-install-retry-'));
  const old: Service = { label: 'test', root: path.join(directory, 'old'), file: '', existing: false };
  const current = { ...old, root: path.join(directory, 'current') };
  const background = { label: 'test', installedService: old, refresh: async () => ({ enabled: true }),
    unload: vi.fn(async () => {}), load: vi.fn(async () => { throw new Error('registration busy'); }) } as unknown as BackgroundPortal;
  const steps = { cleanup: async () => {}, handoff: async () => { throw new Error('worker failed'); }, quit: vi.fn(), startForeground: vi.fn() };
  try {
    const install = new ClientInstall(directory, background);
    await expect(install.shutdown('0.1.10', '0.1.11', null, false, steps)).rejects.toThrow('registration busy');
    expect(await install.read()).not.toBeNull();
    Object.assign(background, { installedService: current });
    const load = vi.mocked(background.load).mockResolvedValue();
    await expect(install.shutdown('0.1.11', '0.1.12', null, false, steps)).rejects.toThrow('worker failed');
    expect(load).toHaveBeenLastCalledWith(current);
    expect(steps.quit).not.toHaveBeenCalled();
    expect(await install.read()).toBeNull();
    await install.shutdown('0.1.11', '0.1.12', null, false, { ...steps, handoff: async () => {} });
    expect(steps.quit).toHaveBeenCalledOnce();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('retains an invalid install record and does not stop services or hand off', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'town-install-invalid-'));
  const background = { label: 'test', unload: vi.fn() } as unknown as BackgroundPortal;
  const steps = { cleanup: vi.fn(), handoff: vi.fn(), quit: vi.fn(), startForeground: vi.fn() };
  try {
    const raw = '{"schema":9}';
    await writeFile(path.join(directory, 'client-install.json'), raw);
    await expect(new ClientInstall(directory, background).shutdown('0.1.11', '0.1.12', null, false, steps)).rejects.toThrow('恢复记录无效');
    expect(background.unload).not.toHaveBeenCalled();
    expect(steps.handoff).not.toHaveBeenCalled();
    expect(await readFile(path.join(directory, 'client-install.json'), 'utf8')).toBe(raw);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('journals client launch records and never resumes independent runtimes from older install records', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'town-install-'));
  const service: Service = { label: 'test', root: path.join(directory, 'engine'), file: '', existing: false };
  const external: Service = { ...service, root: path.join(directory, 'external'), kind: 'portable', existing: true, configPath: path.join(directory, 'original.toml') };
  const stopped: string[] = [], restored: string[] = [];
  const background = { label: 'test', installedService: service, refresh: async () => ({ enabled: true }),
    unload: async (s: Service) => {
      const intent = JSON.parse(await readFile(path.join(directory, 'client-install.json'), 'utf8'));
      expect(intent.services).toHaveLength(1); stopped.push(s.root);
    }, load: async (s: Service) => { restored.push(s.root); } } as unknown as BackgroundPortal;
  try {
    const installer = new ClientInstall(directory, background);
    const intent = await installer.prepare('0.1.3', '0.1.4', parseConnection('https://example.org/test/?token=fixture'), false);
    expect(stopped).toEqual([service.root]);
    intent.services.push({ service: external, enabled: true });
    await writeFile(path.join(directory, 'client-install.json'), JSON.stringify(intent));
    expect((await new ClientInstall(directory, background).read())?.services).toHaveLength(2);
    await installer.resume(intent);
    expect(restored).toEqual(stopped); expect(await installer.read()).toBeNull();
    vi.spyOn(background, 'unload').mockRejectedValue(new Error('still running'));
    await expect(installer.prepare('0.1.3', '0.1.4', null, false)).rejects.toThrow('still running');
    expect(await installer.read()).toBeNull();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('selects only supported assets, requires one digest and generates wait/replace/relaunch handoffs', () => {
  expect(assetName('0.1.4', 'win32', 'x64')).toBe('portal-desktop-0.1.4-windows-x64-Setup.exe');
  expect(assetName('0.1.4', 'darwin', 'arm64')).toBe('portal-desktop-0.1.4-macos-arm64.zip');
  expect(assetName('0.1.4', 'darwin', 'x64')).toBe('portal-desktop-0.1.4-macos-x64.zip');
  expect(() => assetName('../bad', 'darwin', 'arm64')).toThrow();
  expect(() => assetName('0.1.4', 'darwin', 'ia32')).toThrow();
  expect(() => assetName('0.1.4', 'win32', 'arm64')).toThrow();
  const row = 'a'.repeat(64) + '  fixture.zip';
  expect(checksumFor(row, 'fixture.zip')).toBe('a'.repeat(64));
  expect(() => checksumFor(row + '\n' + row, 'fixture.zip')).toThrow();
  expect(() => checksumFor(row, 'other.zip')).toThrow();
  const mac = macInstallerScript(123, "/Applications/A 'B.app", '/tmp/new.app', '/tmp/old.app');
  expect(mac.indexOf('kill -0')).toBeLessThan(mac.indexOf('/bin/mv'));
  expect(mac).toContain("A '\\''B.app");
  expect(mac).toContain('/usr/bin/open -n');
  const windows = windowsInstallerScript(123, 'C:\\Setup.exe', 'C:\\old.exe');
  expect(windows.indexOf('Wait-Process')).toBeLessThan(windows.indexOf('Start-Process'));
  expect(windows).toContain("$_.ExecutablePath -eq $oldExecutable");
  expect(windows).toContain('Stop-Process -Id $_.ProcessId -Force');
  expect(windows).toContain('InstallLocation');
  expect(windows).toContain('Start-Process -FilePath $installed');
  expect(windows).not.toContain('Update.exe');
  expect(windows).not.toContain('--silent');
  expect(windows).toContain('-WindowStyle Normal -PassThru');
});

it.each(['cleanup', 'handoff'])('restores the service and foreground state when %s fails before quitting', async failure => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'town-install-shutdown-'));
  const service: Service = { label: 'test', root: path.join(directory, 'engine'), file: '', existing: false };
  let enabled = true;
  const background = { label: 'test', installedService: service, refresh: async () => ({ enabled }),
    unload: async () => { enabled = false; }, load: async () => { enabled = true; } } as unknown as BackgroundPortal;
  const cleanup = vi.fn(async () => { expect(enabled).toBe(false); if (failure === 'cleanup') throw new Error('locked staging directory'); });
  const handoff = vi.fn(async () => { throw new Error('worker exited'); });
  const quit = vi.fn(), startForeground = vi.fn(async () => {});
  try {
    const install = new ClientInstall(directory, background);
    await expect(install.shutdown('0.1.8', '0.1.9', null, true, { cleanup, handoff, quit, startForeground })).rejects.toThrow();
    expect(enabled).toBe(true);
    expect(startForeground).toHaveBeenCalledTimes(1);
    expect(quit).not.toHaveBeenCalled();
    expect(handoff).toHaveBeenCalledTimes(failure === 'cleanup' ? 0 : 1);
    expect(await install.read()).toBeNull();
    // A failed attempt must not leave the next install permanently blocked.
    await install.shutdown('0.1.8', '0.1.9', null, false, { cleanup: async () => {}, handoff: async () => {}, quit, startForeground });
    expect(quit).toHaveBeenCalledTimes(1);
    expect(await install.read()).not.toBeNull();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
