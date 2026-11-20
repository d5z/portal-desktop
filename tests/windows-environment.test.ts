import { afterEach, expect, it, vi } from 'vitest';
import path from 'node:path';
import { command, portableCommand, windowsPowerShellScript, windowsRunner } from '../desktop/main/portal/background';
import { signalWindowsSandboxCancel, windowsEnvironment, windowsExecutable, windowsRoot } from '../desktop/main/portal/windows';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';

afterEach(() => vi.unstubAllEnvs());

it('resolves system executables independently of PATH and the current directory', () => {
  const environment = { SystemRoot: 'E:\\Windows', PATH: '' };
  expect(windowsExecutable('powershell.exe', environment)).toBe('E:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  expect(windowsExecutable('taskkill', environment)).toBe('E:\\Windows\\System32\\taskkill.exe');
  expect(windowsExecutable('D:\\Portal\\heart-portal.exe', environment)).toBe('D:\\Portal\\heart-portal.exe');
  expect(windowsRoot({ systemroot: '.', windir: 'E:\\Windows' })).toBe('E:\\Windows');
});

it('merges mixed-case PATH keys, preserves custom tools and adds missing Windows utilities exactly once', () => {
  const environment = windowsEnvironment({ SystemRoot: 'E:\\Windows', Path: 'D:\\old-tools' }, { PATH: 'D:\\my-tools;E:\\Windows\\System32' });
  expect(Object.keys(environment).filter(key => key.toLowerCase() === 'path')).toEqual(['PATH']);
  expect(environment.PATH!.split(';')).toEqual(['D:\\my-tools', 'E:\\Windows\\System32', 'E:\\Windows',
    'E:\\Windows\\System32\\Wbem', 'E:\\Windows\\System32\\WindowsPowerShell\\v1.0']);
  expect(windowsEnvironment(environment)).toEqual(environment);
  const runner = windowsRunner('E:\\profile', 'E:\\profile\\portal.toml', {
    endpoint: '', being: '', hasToken: true, portalName: 'fixture', workspace: 'E:\\workspace',
    portalBinary: 'E:\\app\\heart-portal.exe', autoStart: false, allowExec: true, kitsEnabled: true,
    portalEnvironmentPath: 'D:\\my-tools',
  });
  expect(runner).toContain("$env:PATH = 'D:\\my-tools;");
  expect(runner).toContain('WindowsPowerShell\\v1.0');
});

it('quotes the exact legacy binary and passes status as an argument with plain error handling', async () => {
  const run = vi.fn(async () => '{}');
  await portableCommand("E:\\old user's Portal\\heart-portal.exe", 'status', 'win32', run);
  const script = Buffer.from((run.mock.calls[0] as unknown as [string, string[]])[1].at(-1)!, 'base64').toString('utf16le');
  expect(script).toContain("& 'E:\\old user''s Portal\\heart-portal.exe' status | Write-Output;");
  expect(script).toContain('[Console]::Error.WriteLine');
  expect(script).not.toContain("throw 'Portal lifecycle command failed'");
});

it.skipIf(process.platform !== 'win32')('runs real Windows PowerShell with an empty PATH and readable Unicode errors', async () => {
  vi.stubEnv('PATH', '');
  const script = windowsPowerShellScript("Write-Output '中文运行成功'; (Get-Command taskkill.exe).Source");
  const args = ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
  const output = await command('powershell.exe', args);
  expect(output).toContain('中文运行成功');
  expect(output).toContain(path.win32.join(windowsRoot(), 'System32\\taskkill.exe'));
  const failure = windowsPowerShellScript("throw '中文生命周期错误'");
  const error = await command('powershell.exe', [...args.slice(0, -1), Buffer.from(failure, 'utf16le').toString('base64')]).catch(error => error);
  expect(error.message).toContain('中文生命周期错误');
  expect(error.message).not.toContain('CLIXML');
}, 15_000);

it.skipIf(process.platform !== 'win32')('signals and waits for a descendant sandbox wrapper before force-kill', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'portal-cancel-helper-'));
  const child = path.join(root, 'child.ps1');
  const parent = path.join(root, 'parent.ps1');
  const ready = path.join(root, 'ready');
  const clean = path.join(root, 'clean');
  const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
  await writeFile(child, `$event=[Threading.EventWaitHandle]::new($false,[Threading.EventResetMode]::ManualReset,('Local\\Town.Portal.SandboxCancel.'+$PID));
    [IO.File]::WriteAllText(${quote(ready)},'ready'); $null=$event.WaitOne(); Start-Sleep -Milliseconds 3500;
    [IO.File]::WriteAllText(${quote(clean)},'clean'); $event.Dispose();`);
  await writeFile(parent, `Start-Process powershell.exe -WindowStyle Hidden -ArgumentList ${quote('-NoProfile -NonInteractive -File "' + child + '"')} -Wait\n`);
  const engine = spawn(windowsExecutable('powershell'), ['-NoProfile', '-NonInteractive', '-File', parent], { windowsHide: true });
  const exited = new Promise<void>((resolve, reject) => { engine.once('error', reject); engine.once('close', code => code === 0 ? resolve() : reject(new Error(`exit ${code}`))); });
  try {
    await vi.waitFor(async () => expect(await readFile(ready, 'utf8')).toBe('ready'), { timeout: 5000 });
    expect(await signalWindowsSandboxCancel(engine.pid!)).toBe(true);
    expect(await readFile(clean, 'utf8')).toBe('clean');
    await exited;
  } finally { engine.kill(); await rm(root, { recursive: true, force: true }); }
}, 20_000);
