import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { OrphanPortalRecovery } from '../desktop/main/portal/orphan';
import { parseConnection } from '../desktop/main/chat/connection';
import { command } from '../desktop/main/portal/background';
import macLaunch from '../desktop/main/portal/mac-launch.py?raw';
import { PortalSupervisor } from '../desktop/main/portal/supervisor';

const connection = parseConnection('http://127.0.0.1:1/orphan-fixture/?token=local-test');
const roots: string[] = [];
const parents: ChildProcess[] = [];
const children: number[] = [];
afterEach(async () => {
  for (const parent of parents.splice(0)) if (parent.exitCode === null && parent.signalCode === null) parent.kill('SIGKILL');
  for (const pid of children.splice(0)) { try { process.kill(pid, 'SIGKILL'); } catch { /* Already recovered. */ } }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it('does not inspect native processes on unsupported platforms', async () => {
  const run = vi.fn();
  expect(await new OrphanPortalRecovery('/profile', run, 'linux').conflicts(connection)).toEqual([]);
  expect(run).not.toHaveBeenCalled();
});

it.skipIf(process.platform !== 'darwin')('recovers a real detached child after its owner crashes, with profile, Being and process identity checks', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'portal-orphan-'))); roots.push(root);
  const binary = path.resolve('resources/heart-portal');
  const config = path.join(root, 'portal.toml');
  await writeFile(config, `name = "orphan-fixture"\nworkspace = ${JSON.stringify(root)}\nkits_enabled = false\n[tools]\nexec = false\n`);
  const env = { ...process.env, HEART_PORTAL_CLIENT_MANAGED: '1', HEART_PORTAL_SUPERVISED: '1',
    HEART_PORTAL_CLIENT_FILE: path.join(root, '.portal-client.json'),
    HEART_PORTAL_STATUS_FILE: path.join(root, '.portal-connection-status.json'),
    HEART_PORTAL_STATUS_NONCE: 'native-orphan-test', PORTAL_CONNECT_LINK: connection.link };
  // A real parent is killed abruptly, matching Electron crashing without its
  // before-quit hook. The child is intentionally detached, as in production.
  const parent = spawn(process.execPath, ['-e', `
    const { spawn } = require('node:child_process');
    const child = spawn(process.argv[1], ['--config', process.argv[2]], { detached: true, stdio: 'ignore' });
    console.log(child.pid);
    setInterval(() => {}, 1000);
  `, binary, config], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  parents.push(parent);
  const [output] = await once(parent.stdout!, 'data');
  const pid = Number(String(output).trim()); children.push(pid);
  expect(pid).toBeGreaterThan(1);
  const recovery = new OrphanPortalRecovery(root);
  expect(await recovery.conflicts(connection)).toEqual([]); // Its owner is still alive.
  const exited = once(parent, 'exit'); parent.kill('SIGKILL'); await exited;
  const inspected = JSON.parse(await command('/usr/bin/python3', ['-c', macLaunch, String(pid), binary, root, 'inspect']));
  expect(inspected.environment.PORTAL_CONNECT_LINK).toBe(connection.link);
  expect(inspected.proof).toMatch(/^[a-f0-9]{64}$/);
  const listed = await command('/bin/ps', ['-axo', 'pid=,uid=,comm=']);
  expect(listed.split('\n').find(line => Number(line.trim().split(/\s+/)[0]) === pid)).toContain(binary);
  let targets = await recovery.conflicts(connection);
  await vi.waitFor(async () => { targets = await recovery.conflicts(connection); expect(targets).toHaveLength(1); });
  expect(targets[0]).toMatchObject({ pid, root, orphan: { binary } });
  expect(await new OrphanPortalRecovery(path.join(root, 'other-profile')).conflicts(connection)).toEqual([]);
  expect(await recovery.conflicts(parseConnection('http://127.0.0.1:1/another/?token=local-test'))).toEqual([]);
  // A rotated token for the same Being is still eligible for recovery.
  expect(await recovery.conflicts(parseConnection('http://127.0.0.1:1/orphan-fixture/?token=rotated'))).toHaveLength(1);
  await expect(recovery.stop({ ...targets[0], orphan: { ...targets[0].orphan!, proof: '0'.repeat(64) } })).rejects.toThrow('identity changed');
  expect(() => process.kill(pid, 0)).not.toThrow();
  await recovery.stop(targets[0]);
  children.splice(children.indexOf(pid), 1);
  expect(await recovery.conflicts(connection)).toEqual([]);
  expect(() => process.kill(pid, 0)).toThrow();
  const replacement = new PortalSupervisor(root);
  try {
    await replacement.start({ endpoint: '', being: '', hasToken: true, portalName: 'recovered', portalBinary: binary,
      workspace: root, autoStart: false, allowExec: false, kitsEnabled: false }, connection);
    await replacement.waitReady();
    expect(replacement.state).toMatchObject({ managed: true, portalName: 'recovered', conflict: false });
    expect(replacement.state.pid).not.toBe(pid);
  } finally { await replacement.stop(); }
}, 25_000);

it.skipIf(process.platform !== 'darwin')('forces a verified orphan to exit when it ignores graceful termination', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'portal-stuck-orphan-'))); roots.push(root);
  const binary = await realpath(process.execPath);
  const parent = spawn(process.execPath, ['-e', `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)"],
      { detached: true, stdio: ['ignore','pipe','ignore'] });
    child.stdout.once('data',()=>console.log(child.pid));
    setInterval(()=>{},1000);
  `], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
    HEART_PORTAL_CLIENT_MANAGED: '1', HEART_PORTAL_SUPERVISED: '1', HEART_PORTAL_STATUS_NONCE: 'stuck-orphan-test',
    HEART_PORTAL_CLIENT_FILE: path.join(root, '.portal-client.json'),
    HEART_PORTAL_STATUS_FILE: path.join(root, '.portal-connection-status.json'), PORTAL_CONNECT_LINK: connection.link } });
  parents.push(parent);
  const [output] = await once(parent.stdout!, 'data');
  const pid = Number(String(output).trim()); children.push(pid);
  const exited = once(parent, 'exit'); parent.kill('SIGKILL'); await exited;
  const inspected = JSON.parse(await command('/usr/bin/python3', ['-c', macLaunch, String(pid), binary, root, 'inspect']));
  const target = { id: inspected.proof, root, label: 'fixture', pid, orphan: { binary, proof: inspected.proof } };
  await new OrphanPortalRecovery(root).stop(target);
  expect(() => process.kill(pid, 0)).toThrow();
  children.splice(children.indexOf(pid), 1);
}, 25_000);
