import { afterEach, expect, it, vi } from 'vitest';
import path from 'node:path';
import { command, portableCommand, windowsPowerShellScript, windowsRunner } from '../desktop/main/portal/background';
import { windowsEnvironment, windowsExecutable, windowsRoot } from '../desktop/main/portal/windows';

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
