import { expect, it, vi } from 'vitest';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { command, windowsPowerShellScript, type Command } from '../desktop/main/portal/background';
import { WindowsForcePortal } from '../desktop/main/portal/windows-force';
import { parseConnection } from '../desktop/main/chat/connection';

const ps = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const powershell = (source: string) => command('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
  Buffer.from(windowsPowerShellScript(source), 'utf16le').toString('base64')]);
const cleanup = async (root: string) => {
  const relative = path.relative(os.tmpdir(), path.resolve(root));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid fixture cleanup path');
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
};

it('matches Being identity across token rotation and ignores unrelated or unprovable roots without running old executables', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'portal-force-discovery-'));
  try {
    const connection = parseConnection('https://example.org/fixture/?token=new');
    const paths = ['old', 'other', 'missing'].map(name => path.join(root, name));
    for (const directory of paths) await mkdir(directory);
    await writeFile(path.join(paths[0], '.portal-connection.url'), 'https://example.org/fixture/?token=old');
    await writeFile(path.join(paths[1], '.portal-connection.url'), 'https://example.org/other/?token=old');
    const run: Command = vi.fn(async (file, args) => {
      expect(file).toBe('powershell.exe');
      expect(Buffer.from(args.at(-1)!, 'base64').toString('utf16le')).toContain("$operation='inventory'");
      return JSON.stringify(paths.map(root => ({ root })));
    });
    const found = await new WindowsForcePortal(run).conflicts(connection);
    expect(found).toHaveLength(1);
    expect(found[0].root).toBe(paths[0]);
  } finally { await cleanup(root); }
});

it.skipIf(process.platform !== 'win32')('force stops a respawning legacy Windows guardian and engine while leaving another Being alive', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "portal-force 中文 ' "));
  const children: ChildProcess[] = [];
  const pids: number[] = [];
  try {
    const roots = [path.join(root, 'old'), path.join(root, 'other')];
    for (const directory of roots) await mkdir(path.join(directory, 'scripts'), { recursive: true });
    await powershell(`Add-Type -OutputAssembly ${ps(path.join(roots[0], 'heart-portal.exe'))} -OutputType ConsoleApplication -TypeDefinition @'
using System.Threading;
public class Fixture { public static void Main(string[] args) { Thread.Sleep(120000); } }
'@`);
    await copyFile(path.join(roots[0], 'heart-portal.exe'), path.join(roots[1], 'heart-portal.exe'));
    const connection = parseConnection(`http://127.0.0.1:1/${path.basename(root).replace(/[^a-z0-9]/gi, '')}/?token=fixture`);
    for (const [index, directory] of roots.entries()) {
      await writeFile(path.join(directory, '.portal-connection.url'), index ? 'http://127.0.0.1:1/unrelated/?token=other' : connection.link);
      const script = path.join(directory, 'scripts', 'portal-supervisor.ps1');
      await writeFile(script, '\ufeff' + `param([string]$Root)
$ErrorActionPreference='Stop'
while ($true) {
  $engine=Start-Process -FilePath (Join-Path $Root 'heart-portal.exe') -WindowStyle Hidden -PassThru
  [IO.File]::WriteAllText((Join-Path $Root 'fixture.pid'), [string]$engine.Id)
  $engine.WaitForExit()
  Start-Sleep -Milliseconds 100
}`);
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Root', directory], { windowsHide: true, stdio: 'ignore' });
      children.push(child);
      await vi.waitFor(async () => expect(Number(await readFile(path.join(directory, 'fixture.pid'), 'utf8'))).toBeGreaterThan(0), { timeout: 10_000 });
      pids.push(Number(await readFile(path.join(directory, 'fixture.pid'), 'utf8')));
    }
    const recovery = new WindowsForcePortal();
    const targets = await recovery.conflicts(connection);
    expect(targets.map(item => item.root)).toEqual([roots[0]]);
    expect(await recovery.stop(targets[0])).toContain('force-stopped');
    expect(() => process.kill(pids[0], 0)).toThrow();
    expect(() => process.kill(children[0].pid!, 0)).toThrow();
    expect(() => process.kill(pids[1], 0)).not.toThrow();
    expect(await recovery.conflicts(connection)).toEqual([]);
    await new Promise(resolve => setTimeout(resolve, 1000));
    expect(Number(await readFile(path.join(roots[0], 'fixture.pid'), 'utf8'))).toBe(pids[0]);
    // Exercise the production scheduler branch with an isolated registration
    // fixture; this test never creates or alters a real scheduled task.
    const taskState = path.join(root, 'task-disabled');
    const taskEvents = path.join(root, 'task-events');
    const taskScript = `
function Get-ScheduledTask {
  [pscustomobject]@{ TaskName='fixture-legacy-portal'; TaskPath='\\';
    Principal=[pscustomobject]@{ UserId=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value };
    Settings=[pscustomobject]@{ Enabled=(-not (Test-Path -LiteralPath ${ps(taskState)})) }; State='Ready';
    Actions=@([pscustomobject]@{ Execute='powershell.exe'; Arguments=${ps('-NoProfile -File "' + path.join(roots[0], 'scripts/portal-supervisor-bootstrap.ps1') + '" -Root "' + roots[0] + '"')} }) }
}
function Disable-ScheduledTask($TaskName, $TaskPath) { [IO.File]::WriteAllText(${ps(taskState)}, 'disabled'); [IO.File]::AppendAllText(${ps(taskEvents)}, "disable:$TaskName;") }
function Stop-ScheduledTask($TaskName, $TaskPath) { [IO.File]::AppendAllText(${ps(taskEvents)}, "stop:$TaskName;") }
`;
    const taskRecovery = new WindowsForcePortal((file, args, input) => {
      const source = Buffer.from(args.at(-1)!, 'base64').toString('utf16le');
      return command(file, [...args.slice(0, -1), Buffer.from(taskScript + source, 'utf16le').toString('base64')], input);
    });
    const sleeping = await taskRecovery.conflicts(connection);
    expect(sleeping).toHaveLength(1);
    await taskRecovery.stop(sleeping[0]);
    expect(await readFile(taskEvents, 'utf8')).toBe('disable:fixture-legacy-portal;stop:fixture-legacy-portal;');
    expect(await taskRecovery.conflicts(connection)).toEqual([]);
    expect(() => process.kill(pids[1], 0)).not.toThrow();
  } finally {
    // Only process handles and PID records created by this fixture are eligible.
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    await vi.waitFor(() => expect(children.every(child => child.exitCode !== null || child.signalCode !== null)).toBe(true));
    for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch { /* exited */ } }
    await vi.waitFor(() => { for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow(); });
    await cleanup(root);
  }
}, 70_000);
