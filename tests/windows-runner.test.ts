import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { command, windowsPowerShellScript, windowsRunner } from '../desktop/main/portal/background';
import type { Settings } from '../desktop/shared/types';

const roots: string[] = [];
const ps = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const powershell = (script: string) => command('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
  Buffer.from(windowsPowerShellScript(script), 'utf16le').toString('base64')]);
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(workspace?: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), "portal-runner 中文 ' ")); roots.push(root);
  const settings: Settings = { endpoint: '', being: '', hasToken: true, portalName: 'runner-fixture',
    portalBinary: path.join(root, 'heart-portal.exe'), workspace: workspace || root,
    autoStart: false, backgroundEnabled: true, allowExec: false, kitsEnabled: false };
  const script = path.join(root, 'run.ps1');
  await writeFile(script, '\ufeff' + windowsRunner(root, path.join(root, 'portal.toml'), settings));
  const run = () => command('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script]);
  const credential = async () => {
    const encrypted = await powershell("'http://127.0.0.1:1/fixture/?token=runner-fixture-secret' | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString");
    await writeFile(path.join(root, 'connection.dpapi'), encrypted.trim());
  };
  return { root, settings, run, credential };
}

it.skipIf(process.platform !== 'win32')('records credential and working-directory errors before the engine can start', async () => {
  const f = await fixture(path.join(os.tmpdir(), 'missing-portal-workspace-' + crypto.randomUUID()));
  await expect(f.run()).rejects.toThrow();
  expect(await readFile(path.join(f.root, 'supervisor.err.log'), 'utf8')).toContain('supervisor-fatal stage=decrypt-credential');
  await f.credential();
  await expect(f.run()).rejects.toThrow();
  const errors = await readFile(path.join(f.root, 'supervisor.err.log'), 'utf8');
  expect(errors).toContain('stage=decrypt-credential');
  expect(errors).toContain('stage=working-directory');
  expect(errors).not.toContain('runner-fixture-secret');
}, 70_000);

it.skipIf(process.platform !== 'win32')('retains exit codes and prior stderr, stops on conflict, and bounds rapid crash retries', async () => {
  const f = await fixture(); await f.credential();
  await powershell(`Add-Type -OutputAssembly ${ps(f.settings.portalBinary)} -OutputType ConsoleApplication -TypeDefinition @'
using System;
using System.IO;
public class Fixture {
  public static int Main(string[] args) {
    string mode = File.ReadAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "mode")).Trim();
    Console.Error.WriteLine("engine-fixture " + mode);
    return mode == "conflict" ? 73 : 17;
  }
}
'@`);
  await writeFile(path.join(f.root, 'mode'), 'conflict');
  await writeFile(path.join(f.root, 'portal.err.log'), 'older-crash-evidence');
  await f.run();
  expect(await readFile(path.join(f.root, '.portal-start-failure'), 'utf8')).toBe('conflict');
  expect(await readFile(path.join(f.root, 'portal.err.log.previous'), 'utf8')).toBe('older-crash-evidence');
  expect(await readFile(path.join(f.root, 'supervisor.log'), 'utf8')).toMatch(/engine-exit pid=\d+ code=73 runtime_ms=\d+/);
  // A paused invocation must not launch another engine or overwrite its output.
  await f.run();
  expect((await readFile(path.join(f.root, 'supervisor.log'), 'utf8')).match(/engine-start/g)).toHaveLength(1);
  await rm(path.join(f.root, '.portal-start-failure'));
  await writeFile(path.join(f.root, 'mode'), 'crash');
  await f.run();
  expect(await readFile(path.join(f.root, '.portal-start-failure'), 'utf8')).toBe('crash-limit');
  const events = await readFile(path.join(f.root, 'supervisor.log'), 'utf8');
  expect(events.match(/code=17 /g)).toHaveLength(6);
  expect(events).toContain('recovery-stopped reason=crash-limit attempts=6');
  expect(events).toContain('code=73');
}, 70_000);
