import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { windowsEnvironment, windowsExecutable } from '../portal/windows';
import { mkdir, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { command, windowsModulePath } from '../portal/background';
import { macInstallLocation, validateMacApp } from './mac-package';
import windowsInstaller from '../../windows-installer.json';
import type { UpdateActivity } from '../../shared/types';

interface StageOptions {
  signal?: AbortSignal;
  onProgress?: (progress: Omit<UpdateActivity, 'version'>) => void;
}

const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
const ps = (s: string) => `'${s.replaceAll("'", "''")}'`;
export function assetName(version: string, platform = process.platform, arch = process.arch) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('无效的更新版本。');
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) return `portal-desktop-${version}-macos-${arch}.zip`;
  if (platform === 'win32' && arch === 'x64') return `portal-desktop-${version}-windows-x64-Setup.exe`;
  throw new Error('当前平台没有配套安装包，请查看发布页。');
}
export async function downloadUpdateFile(url: string, file: string, max: number, fetcher: typeof fetch,
  onProgress?: (received: number, total?: number) => void, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(15 * 60_000);
  const lifetime = signal ? AbortSignal.any([signal, timeout]) : timeout;
  lifetime.throwIfAborted();
  onProgress?.(0);
  const response = await fetcher(url, { signal: lifetime });
  if (!response.ok || !response.body) throw new Error('安装包下载失败，原服务未停止。');
  const reader = response.body.getReader(), handle = await open(file, 'wx', 0o600), hash = createHash('sha256');
  const length = Number(response.headers.get('content-length'));
  const total = Number.isSafeInteger(length) && length > 0 && length <= max ? length : undefined;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  lifetime.addEventListener('abort', cancel, { once: true });
  let size = 0;
  try {
    lifetime.throwIfAborted();
    onProgress?.(0, total);
    while (true) {
      const next = await reader.read(); lifetime.throwIfAborted(); if (next.done) break;
      size += next.value.byteLength;
      if (size > max) throw new Error('安装包超出大小限制。');
      hash.update(next.value); await handle.writeFile(next.value);
      onProgress?.(size, total);
    }
  } finally { lifetime.removeEventListener('abort', cancel); await reader.cancel().catch(() => {}); await handle.close(); }
  return hash.digest('hex');
}
export function checksumFor(text: string, name: string) {
  const matches = text.split(/\r?\n/).map(line => /^([a-f0-9]{64})  (.+)$/.exec(line)).filter(m => m?.[2] === name);
  if (matches.length !== 1) throw new Error('发布包校验清单缺失或重复。');
  return matches[0]![1];
}
export function macInstallerScript(parentPid: number, current: string, candidate: string, backup: string, profile?: string) {
  const launch = `/usr/bin/open${profile ? ` --env ${quote(`PORTAL_DESKTOP_USER_DATA=${profile}`)}` : ''} -n ${quote(current)}`;
  return `#!/bin/sh
set -eu
ready_file=\${1:-}
cancel_file=\${2:-}
status_file=\${3:-}
state() {
  printf '%s\\n' "$1"
  [ -z "$status_file" ] || printf '{"stage":"%s"}\\n' "$1" > "$status_file"
}
active() {
  if [ -n "$cancel_file" ] && [ -e "$cancel_file" ]; then state cancelled; exit 1; fi
}
active
state waiting-for-client
[ -z "$ready_file" ] || printf '%s\\n' "$$" > "$ready_file"
count=0
while kill -0 ${parentPid} 2>/dev/null; do
  active
  count=$((count + 1))
  if [ "$count" -ge 120 ]; then state shutdown-timeout; exit 1; fi
  sleep 1
done
active
state replacing-client
if /bin/mv ${quote(current)} ${quote(backup)}; then
  if /bin/mv ${quote(candidate)} ${quote(current)} && ${launch}; then state completed; exit 0; fi
  # Keep a failed candidate for diagnosis; restore the old app on launch failure.
  [ ! -e ${quote(current)} ] || /bin/mv ${quote(current)} ${quote(candidate + '.failed')}
  /bin/mv ${quote(backup)} ${quote(current)}
fi
state restoring-client
${launch}
state failed
exit 1
`;
}

// The shell must acknowledge its wait loop before this client quits. A failed
// or timed-out attempt is cancelled so it cannot replace the app on a later exit.
export async function launchMacInstaller(root: string, scriptFile: string, timeoutMs = 20_000) {
  const attempt = path.join(root, `install-${randomUUID()}`);
  const ready = attempt + '.ready', cancel = attempt + '.cancel';
  const log = await open(path.join(root, 'install.log'), 'a', 0o600);
  const child = spawn('/bin/sh', [scriptFile, ready, cancel, attempt + '.json'], {
    detached: true, stdio: ['ignore', log.fd, log.fd],
  });
  let failure: Error | undefined;
  child.once('error', error => { failure = error; });
  child.once('exit', (code, signal) => { failure = new Error(`安装助手在交接前退出（${signal || code}），请查看 install.log。`); });
  try {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      if (failure) throw failure;
      const acknowledgement = await readFile(ready, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return '';
        throw error;
      });
      if (failure) throw failure;
      if (acknowledgement.trim() === String(child.pid)) break;
      if (Date.now() >= deadline) throw new Error('启动客户端安装助手超时，请查看 install.log。');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    child.unref();
  } catch (error) {
    try { await writeFile(cancel, 'cancelled'); }
    finally { child.kill(); }
    throw error;
  } finally { await log.close(); }
}
export function windowsInstallerScript(parentPid: number, setup: string, oldExecutable: string) {
  return `param([string]$ReadyFile, [string]$CancelFile, [string]$StatusFile)
` + windowsModulePath + `
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$parentExited=$false
function Write-InstallState([string]$stage, [string]$detail = '') {
  if (!$StatusFile) { return }
  $state=@{stage=$stage; detail=$detail; pid=$PID; time=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($StatusFile, $state, [Text.UTF8Encoding]::new($false))
}
function Assert-InstallActive {
  if ($CancelFile -and (Test-Path -LiteralPath $CancelFile)) { throw 'Installation handoff cancelled' }
}
try {
  Write-InstallState 'waiting-for-client'
  Assert-InstallActive
  if ($ReadyFile) { [IO.File]::WriteAllText($ReadyFile, [string]$PID) }
  $deadline=(Get-Date).AddSeconds(120)
  while (Get-Process -Id ${parentPid} -ErrorAction SilentlyContinue) {
    Assert-InstallActive
    if ((Get-Date) -ge $deadline) { throw 'Client shutdown timed out' }
    Wait-Process -Id ${parentPid} -Timeout 1 -ErrorAction SilentlyContinue
  }
  Assert-InstallActive
  $parentExited=$true
  Write-InstallState 'stopping-children'
  # Chromium children can briefly outlive the Electron main process and keep
  # native DLLs locked. Give them time to exit, then stop only processes that
  # still run from the exact client executable being replaced.
  $oldExecutable=${ps(oldExecutable)}
  $deadline=(Get-Date).AddSeconds(15)
  do {
    $remaining=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $oldExecutable })
    if ($remaining.Count -eq 0) { break }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  if ($remaining.Count -gt 0) {
    $remaining | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 500
  }
  Assert-InstallActive
  Write-InstallState 'running-setup'
  $result=Start-Process -FilePath ${ps(setup)} -WindowStyle Normal -PassThru
  $null=$result.Handle
  # Wait for Setup itself, not any newly launched long-lived client descendants.
  $result.WaitForExit()
  if ($result.ExitCode -ne 0) { throw ('Client installation failed: exit=' + $result.ExitCode) }
  Write-InstallState 'starting-client'
  $location=(Get-ItemProperty -LiteralPath 'HKCU:\\Software\\${windowsInstaller.guid}' -Name InstallLocation).InstallLocation
  $installed=Join-Path $location '${windowsInstaller.executableName}.exe'
  if (!(Test-Path -LiteralPath $installed)) { throw 'Installed client missing' }
  # NSIS starts the app normally. Also launch directly to retain an explicit
  # profile/environment for managed installations; the single-instance lock
  # ensures the standard NSIS launch never creates a second client.
  Start-Process -FilePath $installed -WindowStyle Normal
  Write-InstallState 'completed'
} catch {
  $failure=$_
  Write-InstallState 'failed' $failure.Exception.Message
  if ($parentExited) {
    try { Start-Process -FilePath ${ps(oldExecutable)} -WindowStyle Normal }
    catch { [Console]::Error.WriteLine('Client recovery failed: ' + $_.Exception.Message) }
  }
  [Console]::Error.WriteLine($failure)
  exit 1
}
`;
}
// Everything expensive and fallible is staged before stopping Portal.
export async function stageInstaller(directory: string, version: string, repository: string, executable: string,
  fetcher: typeof fetch = fetch, options: StageOptions = {}) {
  options.signal?.throwIfAborted();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('无效的更新源。');
  const current = process.platform === 'darwin' ? await macInstallLocation(executable) : undefined;
  const name = assetName(version), root = path.join(directory, 'client-updates', randomUUID());
  await mkdir(root, { recursive: true, mode: 0o700 });
  let stage: string | undefined;
  const discard = async () => {
    if (stage) await rm(stage, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  };
  try {
    const base = `https://github.com/${repository}/releases/download/v${version}/`;
    const sums = path.join(root, 'SHA256SUMS.txt'), installer = path.join(root, name);
    options.onProgress?.({ phase: 'metadata' });
    await downloadUpdateFile(base + 'SHA256SUMS.txt', sums, 64_000, fetcher, undefined, options.signal);
    const expected = checksumFor(await readFile(sums, 'utf8'), name);
    const actual = await downloadUpdateFile(base + name, installer, 1024 * 1024 * 1024, fetcher,
      (received, total) => options.onProgress?.({ phase: 'downloading', received, total }), options.signal);
    options.onProgress?.({ phase: 'verifying' });
    options.signal?.throwIfAborted();
    if (actual !== expected) throw new Error('安装包校验失败，原服务未停止。');
    options.onProgress?.({ phase: 'preparing' });
    let script: string, scriptFile: string;
    if (process.platform === 'darwin') {
      stage = path.join(path.dirname(current!), `.portal-desktop-update-${randomUUID()}`);
      await mkdir(stage, { mode: 0o700 });
      await command('/usr/bin/ditto', ['-xk', installer, stage]);
      const apps = (await readdir(stage)).filter(name => name.endsWith('.app'));
      if (apps.length !== 1) throw new Error('更新包内客户端结构无效。');
      const candidate = path.join(stage, apps[0]);
      await validateMacApp(candidate, version);
      script = macInstallerScript(process.pid, current!, candidate, path.join(stage, 'Previous.app'), process.env.PORTAL_DESKTOP_USER_DATA ? directory : undefined);
      scriptFile = path.join(root, 'install.sh');
    } else {
      script = '\ufeff' + windowsInstallerScript(process.pid, installer, executable);
      scriptFile = path.join(root, 'install.ps1');
    }
    await writeFile(scriptFile, script, { mode: 0o700 });
    options.signal?.throwIfAborted();
    const handoff = async () => {
      if (process.platform === 'win32') {
        // DETACHED_PROCESS makes Windows PowerShell exit before executing the
        // script; an attached console can also close with the old client.
        // Start-Process gives the worker its own hidden console and returns as
        // soon as it starts, so the worker can wait for this client to exit.
        const attempt = path.join(root, `install-${randomUUID()}`);
        const ready = attempt + '.ready', cancel = attempt + '.cancel';
        const args = `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${scriptFile}" -ReadyFile "${ready}" -CancelFile "${cancel}" -StatusFile "${attempt}.json"`;
        const launch = windowsModulePath + `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue';
try {
  $worker=Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -WindowStyle Hidden -PassThru -ArgumentList ${ps(args)} -RedirectStandardOutput ${ps(path.join(root, 'install.log'))} -RedirectStandardError ${ps(path.join(root, 'install-error.log'))}
  $null=$worker.Handle
  $deadline=(Get-Date).AddSeconds(20)
  while ($true) {
    $worker.Refresh()
    if ($worker.HasExited) { $worker.WaitForExit(); throw ('Installer worker exited before handoff: ' + $worker.ExitCode) }
    if (Test-Path -LiteralPath ${ps(ready)}) { break }
    if ((Get-Date) -ge $deadline) { throw 'Installer worker readiness timed out' }
    Start-Sleep -Milliseconds 100
  }
} catch {
  [IO.File]::WriteAllText(${ps(cancel)}, 'cancelled')
  [Console]::Error.WriteLine($_)
  exit 1
}`;
        const log = await open(path.join(root, 'install-launch.log'), 'a', 0o600);
        const bootstrap = spawn(windowsExecutable('powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(launch, 'utf16le').toString('base64')],
          { windowsHide: true, env: windowsEnvironment(process.env), stdio: ['ignore', log.fd, log.fd] });
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          // Wait for the bootstrap's exit, not inherited pipe handles held by
          // the worker that is itself waiting for this client to exit.
          await new Promise<void>((resolve, reject) => {
            bootstrap.once('error', reject);
            bootstrap.once('exit', code => code === 0 ? resolve() : reject(new Error('无法启动客户端安装助手，请查看 install-launch.log。')));
            timer = setTimeout(() => { bootstrap.kill(); reject(new Error('启动客户端安装助手超时。')); }, 30_000);
          });
        } catch (error) {
          // A delayed worker must not install if this client later exits normally.
          await writeFile(cancel, 'cancelled');
          throw error;
        } finally { clearTimeout(timer); await log.close(); }
        return;
      }
      await launchMacInstaller(root, scriptFile);
    };
    return Object.assign(handoff, { discard });
  } catch (error) {
    await discard();
    throw error;
  }
}
