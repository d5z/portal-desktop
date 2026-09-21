import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PortalSupervisor, portalConfig } from '../desktop/main/portal/supervisor';
import { parseConnection } from '../desktop/main/chat/connection';
import type { Settings } from '../desktop/shared/types';

const settings: Settings = { endpoint: '', being: '', hasToken: true, workspace: os.tmpdir(), portalBinary: process.execPath, portalName: 'test-portal', autoStart: false, allowExec: false, kitsEnabled: false };
const connection = parseConnection('https://example.org/alice/?token=private-token');
const directories: string[] = [];
afterEach(async () => { vi.useRealTimers(); for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'beings-portal-')); directories.push(dir);
  const children: any[] = [];
  const spawn = vi.fn(() => {
    const child = Object.assign(new EventEmitter(), { pid: 12345, exitCode: null, signalCode: null, stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    child.kill.mockImplementation(() => { queueMicrotask(() => child.emit('exit', 0)); return true; });
    children.push(child); return child;
  });
  const portal = new PortalSupervisor(dir, spawn as any);
  return { dir, portal, spawn, children };
}
describe('Portal supervision', () => {
  it('reuses an existing config without overwriting tools or environment', async () => {
    const f = await fixture();
    const config = path.join(f.dir, 'existing.toml');
    const source = 'workspace = "/existing"\n[tools]\nscreenshot = true\n[security]\nexec_allowlist = ["git"]\n';
    await writeFile(config, source);
    await f.portal.start({ ...settings, portalConfigPath: config, portalEnvironmentPath: '/custom/bin:/usr/bin' }, connection,
      { TOOL_FIXTURE_SETTING: 'preserved', HEART_PORTAL_SUPERVISED: '0' });
    const call = f.spawn.mock.calls[0] as unknown as [string, string[], any];
    expect(call[1]).toContain(config);
    expect(call[1]).toEqual(['--config', expect.any(String), '--name', settings.portalName,
      '--exec-enabled', 'false', '--kits-enabled', 'false']);
    if (process.platform === 'win32') expect(call[2].env.PATH.split(';')[0]).toBe('/custom/bin:/usr/bin');
    else expect(call[2].env.PATH).toBe('/custom/bin:/usr/bin');
    expect(call[2].env.TOOL_FIXTURE_SETTING).toBe('preserved');
    expect(call[2].env.HEART_PORTAL_SUPERVISED).toBe('1');
    expect(call[2].env.HEART_PORTAL_CLIENT_FILE).toBe(path.join(f.dir, '.portal-client.json'));
    expect(await readFile(config, 'utf8')).toBe(source);
    await expect(readFile(path.join(f.dir, 'desktop-portal.toml'))).rejects.toThrow();
    f.children[0].emit('exit', 0); await f.portal.stop();
  });
  it.skipIf(process.platform === 'win32')('writes scoped config, keeps secrets off argv, ignores log spoofing, reads structured status and stops only its child', async () => {
    const f = await fixture();
    await f.portal.start(settings, connection); await f.portal.start(settings, connection);
    expect(f.spawn).toHaveBeenCalledTimes(1);
    const call = f.spawn.mock.calls[0] as unknown as [string, string[], any];
    expect(call[1].join(' ')).not.toContain(connection.token);
    expect(call[2].env.PORTAL_CONNECT_LINK).toBe(connection.link);
    expect(call[2].env.HEART_PORTAL_SUPERVISED).toBe('1');
    expect(call[2].shell).toBe(false);
    const toml = await readFile(path.join(f.dir, 'desktop-portal.toml'), 'utf8');
    expect(toml).toContain('exec = false'); expect(toml).not.toContain(connection.token);
    const child = f.children[0];
    child.stdout.write('Portal relay hand'); expect(f.portal.state.phase).toBe('starting');
    child.stdout.write('shake OK — starting MCP server\n'); expect(f.portal.state.phase).toBe('starting');
    const status = { schema: 1, pid: child.pid, nonce: call[2].env.HEART_PORTAL_STATUS_NONCE, boot_id: 'test-boot', sequence: 1, state: 'connected', updated_at_ms: Date.now() };
    await writeFile(call[2].env.HEART_PORTAL_STATUS_FILE, JSON.stringify(status));
    await vi.waitFor(() => expect(f.portal.state.phase).toBe('connected'), { timeout: 2500 });
    expect(f.portal.state).toMatchObject({ pid: child.pid, managed: true, runtimePath: f.dir, conflict: false });
    child.stdout.write('private-'); child.stdout.write('token\n');
    expect(f.portal.state.logs.join('\n')).not.toContain('private-token');
    child.stdout.write('relay session error after 20s: retry in 2s\n'); expect(f.portal.state.phase).toBe('connected');
    await writeFile(call[2].env.HEART_PORTAL_STATUS_FILE, JSON.stringify({ ...status, sequence: 2, state: 'retrying' }));
    await vi.waitFor(() => expect(f.portal.state.phase).toBe('reconnecting'), { timeout: 2500 });
    await f.portal.stop(); expect(f.portal.state.phase).toBe('stopped');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
  it('restarts after controlled exits without waiting for inherited pipes and cancels pending restarts on stop', async () => {
    const f = await fixture(); await f.portal.start(settings, connection); vi.useFakeTimers();
    f.children[0].emit('exit', 0);
    expect(f.portal.state.phase).toBe('reconnecting');
    expect(f.children[0].stdout.destroyed).toBe(true);
    await vi.advanceTimersByTimeAsync(5000); expect(f.spawn).toHaveBeenCalledTimes(2);
    f.children[1].emit('exit', 0); await f.portal.stop();
    await vi.advanceTimersByTimeAsync(10000); expect(f.spawn).toHaveBeenCalledTimes(2);
  });
  it('fails an upgrade startup check after the first exit and cancels its pending restart', async () => {
    const f = await fixture(); await f.portal.start(settings, connection);
    f.children[0].emit('exit', 1);
    await expect(f.portal.waitReady()).rejects.toThrow('启动检查期间退出');
    expect(f.portal.managing).toBe(false);
    expect(f.portal.state.phase).toBe('stopped');
    expect(f.spawn).toHaveBeenCalledTimes(1);
  });
  it.each([1, 73])('does not retry an instance conflict returned with exit code %s', async code => {
    const f = await fixture(); await f.portal.start(settings, connection); vi.useFakeTimers();
    f.children[0].stderr.write('another Portal instance is already running for this relay/Being\n');
    f.children[0].emit('exit', code);
    expect(f.portal.state.phase).toBe('external');
    await vi.advanceTimersByTimeAsync(60000); expect(f.spawn).toHaveBeenCalledTimes(1);
    expect(f.children[0].kill).not.toHaveBeenCalled();
  });
  it('caps rapid crash recovery and log memory', async () => {
    const f = await fixture(); await f.portal.start(settings, connection); vi.useFakeTimers();
    f.children[0].stdout.write(Array.from({ length: 400 }, (_, i) => `line ${i}\n`).join(''));
    expect(f.portal.state.logs).toHaveLength(300);
    for (let i = 0; i < 6; i++) { f.children[i].emit('exit', 1); await vi.advanceTimersByTimeAsync(5000); }
    expect(f.portal.state.phase).toBe('error'); expect(f.spawn).toHaveBeenCalledTimes(6);
  });
  it.skipIf(process.platform === 'win32')('reports an unconfirmed stop instead of hanging or claiming success', async () => {
    const f = await fixture();
    await f.portal.start(settings, connection);
    f.children[0].kill.mockImplementation(() => false);
    vi.useFakeTimers();
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    try {
      const result = expect(f.portal.stop()).rejects.toThrow('not confirmed');
      await vi.advanceTimersByTimeAsync(18_000);
      await result;
      expect(f.portal.state.phase).toBe('error');
    } finally { kill.mockRestore(); f.children[0].emit('exit', 0); }
  });
  it('escapes Windows workspace paths for TOML', () => {
    expect(portalConfig({ ...settings, workspace: 'C:\\Users\\me\\中文 "space"' })).toContain('workspace = "C:\\\\Users\\\\me\\\\中文 \\"space\\""');
  });
});
