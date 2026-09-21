import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { command, portableCommand } from '../desktop/main/portal/background';
const execute = promisify(execFile);

it.skipIf(process.platform !== 'win32')('starts PowerShell without a console, preserves Unicode arguments and cwd, and returns its exit code', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "portal hidden 中文 ' "));
  const binary = path.resolve('resources/heart-portal.exe');
  const helper = path.join(root, 'portal-background-v1.exe');
  try {
    expect((await execute(binary, ['--version'])).stdout).toMatch(/^heart-portal \d/);
    await execute(binary, ['--export-windows-launcher', helper]);
    // IMAGE_SUBSYSTEM_WINDOWS_GUI means Windows never allocates a console,
    // including before application code runs. No windowsHide in these calls.
    for (const file of [binary, helper]) {
      const pe = await readFile(file);
      expect(pe.readUInt16LE(pe.readUInt32LE(0x3c) + 24 + 68)).toBe(2);
    }
    const script = path.join(root, 'console probe.ps1');
    await writeFile(script, `\ufeffparam([string]$Value)
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class ConsoleProbe { [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); }'
@{window=[ConsoleProbe]::GetConsoleWindow().ToInt64(); value=$Value; cwd=(Get-Location).Path} | ConvertTo-Json | Set-Content -LiteralPath 'result.json' -Encoding UTF8
exit 23
`);
    await expect(execute(helper, ['-File', script, '-Value', "中文 spaces ' quote"], { cwd: root, timeout: 20_000 }))
      .rejects.toMatchObject({ code: 23 });
    const result = JSON.parse((await readFile(path.join(root, 'result.json'), 'utf8')).replace(/^\ufeff/, ''));
    expect(result).toEqual({ window: 0, value: "中文 spaces ' quote", cwd: root });
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);

it.skipIf(process.platform !== 'win32')('waits for GUI lifecycle commands and preserves their output and failure code', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "portal GUI lifecycle ' "));
  const binary = path.join(root, 'fixture.exe');
  try {
    const script = `Add-Type -OutputAssembly '${binary.replaceAll("'", "''")}' -OutputType WindowsApplication -TypeDefinition @'
using System;
using System.Threading;
public class LifecycleFixture {
  public static int Main(string[] args) {
    Thread.Sleep(300);
    if (args[0] == "stop") return 23;
    Console.WriteLine("{\\"ready\\":true}");
    return 0;
  }
}
'@`;
    await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
    expect(JSON.parse(await portableCommand(binary, 'status'))).toEqual({ ready: true });
    await expect(portableCommand(binary, 'stop')).rejects.toThrow('(23)');
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);
