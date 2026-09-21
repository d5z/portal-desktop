import { spawn } from 'node:child_process';
import { access, chmod, copyFile, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { redact, type Connection } from '../chat/connection';
import { portalArguments, portalConfig } from './supervisor';
import { readPortalSample, readPortalReady, portalSampleState } from './status';
import type { BackgroundState, PortalState, Settings } from '../../shared/types';
import { windowsEnvironment, windowsExecutable } from './windows';

// No shell interpolation or credentials in command arguments. Windows DPAPI input uses stdin.
export type Command = (file: string, args: string[], input?: string) => Promise<string>;
export const command: Command = (file, args, input) => new Promise((resolve, reject) => {
  const child = spawn(process.platform === 'win32' ? windowsExecutable(file) : file, args, {
    windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
    env: process.platform === 'win32' ? windowsEnvironment(process.env) : process.env,
  });
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  let stdout = ''; let stderr = '';
  const timer = setTimeout(() => { child.kill(); reject(new Error(`${path.basename(file)} 超时`)); }, 30_000);
  child.stdout.on('data', data => { stdout = (stdout + data).slice(-256_000); });
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-8000); });
  child.on('error', error => { clearTimeout(timer); reject(error); });
  child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(stdout) : reject(new Error(`${path.basename(file)} (${code}): ${redact(stderr)}`)); });
  child.stdin.on('error', () => {}); child.stdin.end(input);
});
const sh = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const ps = (value: string) => `'${value.replaceAll("'", "''")}'`;
// A Node/Electron parent launched by pwsh inherits PS7 module paths. Native
// Windows PowerShell must load its own compatible management/security modules.
export const windowsModulePath = '$env:PSModulePath = "$PSHOME\\Modules"; ';
export function windowsPowerShellScript(script: string) {
  return windowsModulePath + `$ProgressPreference='SilentlyContinue';
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);
function Find-PortalTask([string]$name) {
  try { Get-ScheduledTask -TaskName $name -ErrorAction Stop }
  catch {
    # A saved runtime can outlive its task (uninstall, OS cleanup, migration).
    # Only absence is normal; permission and scheduler failures must surface.
    if ($_.FullyQualifiedErrorId -notlike 'CmdletizationQuery_NotFound*') { throw }
  }
}
try { $ErrorActionPreference='Stop'; ${script} }
catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
`;
}
export async function portableCommand(binary: string, action: 'stop' | 'status' | 'start', platform = process.platform, run: Command = command) {
  if (platform !== 'win32') return run(binary, action === 'start' ? [] : [action]);
  const script = windowsPowerShellScript(`& ${ps(binary)} ${action === 'start' ? '' : action} | Write-Output; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`);
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
}
const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16);
export interface Service { label: string; file: string; root: string; existing: boolean; kind?: 'portable'; login?: boolean; name?: string; environmentPath?: string; environment?: Record<string, string>; fingerprint?: string; bundleId?: string; configPath?: string; generatedConfig?: boolean; cwd?: string; binary?: string }
export function fingerprint(settings: Settings, connection: Connection) {
  return hash(JSON.stringify([connection.link, settings.portalBinary, settings.portalConfigPath, settings.portalName,
    settings.workspace, settings.portalEnvironmentPath, settings.allowExec, settings.kitsEnabled, 'client-tools-v5-scene-context']));
}
export function launchAgent(label: string, root: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>Label</key><string>${xml(label)}</string><key>ProgramArguments</key><array><string>/bin/sh</string><string>${xml(path.join(root, 'run.sh'))}</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>PathState</key><dict><key>${xml(path.join(root, '.portal-start-failure'))}</key><false/></dict></dict><key>ThrottleInterval</key><integer>5</integer><key>ExitTimeOut</key><integer>15</integer><key>AbandonProcessGroup</key><false/><key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>${xml(path.join(root, 'supervisor.log'))}</string><key>StandardErrorPath</key><string>${xml(path.join(root, 'supervisor.err.log'))}</string>
</dict></plist>`;
}
function environmentEntries(environment: Record<string, string>) {
  return Object.entries(environment).filter(([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === 'string' && !value.includes('\0'));
}
export function unixRunner(root: string, config: string, settings: Settings, environment: Record<string, string> = {}): string {
  // Keep exec so launchd's PID remains the engine PID. Persist the attempt count
  // across launchd retries. The failure marker stops KeepAlive recovery while
  // normal exits (including the native portal_restart tool) still restart.
  return `#!/bin/sh\nset -eu\numask 077
failure=${sh(path.join(root, '.portal-start-failure'))}
attempt=${sh(path.join(root, '.portal-start-attempt'))}
if [ -s "$failure" ]; then exit 0; fi
previous=0; crashes=0
if [ -f "$attempt" ]; then read -r previous crashes < "$attempt" || true; fi
case "$previous:$crashes" in *[!0-9:]*) previous=0; crashes=0;; esac
now=$(/bin/date +%s)
if [ "$previous" -gt 0 ] && /usr/bin/grep -Eq 'another (legacy )?Portal instance is already running' ${sh(path.join(root, 'portal.err.log'))} 2>/dev/null; then
  printf '%s' conflict > "$failure"; exit 0
fi
if [ "$((now - previous))" -ge 60 ]; then crashes=0; fi
if [ "$crashes" -ge 6 ]; then printf '%s' crash-limit > "$failure"; exit 0; fi
printf '%s %s\\n' "$now" "$((crashes + 1))" > "$attempt"
${environmentEntries(environment).map(([key, value]) => `export ${key}=${sh(value)}\n`).join('')}cd ${sh(settings.workspace)}\nexport PATH=${sh(settings.portalEnvironmentPath || environment.PATH || process.env.PATH || '/usr/local/bin:/usr/bin:/bin')}\nexport PORTAL_CONNECT_LINK="$(cat ${sh(path.join(root, 'connection.url'))})"\nexport HEART_PORTAL_SUPERVISED=1 HEART_PORTAL_CLIENT_MANAGED=1 RUST_LOG=info NO_COLOR=1\n` +
    `export HEART_PORTAL_STATUS_FILE=${sh(path.join(root, '.portal-connection-status.json'))}\nexport HEART_PORTAL_STATUS_NONCE="$(/usr/bin/uuidgen)"\nprintf '%s' "$HEART_PORTAL_STATUS_NONCE" >${sh(path.join(root, '.portal-status-nonce'))}\n` +
    `printf '%s' "$HEART_PORTAL_STATUS_NONCE" >${sh(path.join(root, '.portal-launch-nonce'))}\n` +
    `export HEART_PORTAL_READY_FILE=${sh(path.join(root, '.portal-ready.json'))}\nexport HEART_PORTAL_READY_NONCE="$HEART_PORTAL_STATUS_NONCE"\n` +
    `for log in ${sh(path.join(root, 'portal.log'))} ${sh(path.join(root, 'portal.err.log'))}; do [ ! -f "$log" ] || mv -f "$log" "$log.previous"; done\n` +
    `exec ${sh(path.join(root, 'heart-portal'))} ${portalArguments(config, settings).map(sh).join(' ')} >${sh(path.join(root, 'portal.log'))} 2>${sh(path.join(root, 'portal.err.log'))}\n`;
}
export function windowsRunner(root: string, config: string, settings: Settings, environment: Record<string, string> = {}): string {
  // The scheduled task owns this process tree; it has no client/Electron dependency.
  return `$ErrorActionPreference = 'Stop'\n$root = ${ps(root)}\n` +
`function Write-PortalSupervisorLog([string]$message, [bool]$isError = $false) {
  $name = if ($isError) { 'supervisor.err.log' } else { 'supervisor.log' }
  $file = Join-Path $root $name
  if ((Test-Path -LiteralPath $file) -and (Get-Item -LiteralPath $file).Length -ge 524288) {
    Move-Item -LiteralPath $file -Destination ($file + '.previous') -Force
  }
  [IO.File]::AppendAllText($file, ([DateTime]::UtcNow.ToString('o') + ' ' + $message + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
}
$stage = 'initialize'
try {
Write-PortalSupervisorLog ('supervisor-start pid=' + $PID)
$failure = Join-Path $root '.portal-start-failure'
if (Test-Path -LiteralPath $failure) {
  Write-PortalSupervisorLog 'recovery-paused: use Start Portal to reset the failure marker'
  exit 0
}
${environmentEntries(environment).map(([key, value]) => `$env:${key}=${ps(value)}\n`).join('')}${windowsModulePath}$stage = 'decrypt-credential'
$env:PORTAL_CONNECT_LINK = [System.Net.NetworkCredential]::new('', (Get-Content -LiteralPath (Join-Path $root 'connection.dpapi') -Raw | ConvertTo-SecureString)).Password
$PID | Set-Content -LiteralPath (Join-Path $root 'supervisor.pid')
$env:HEART_PORTAL_SUPERVISED = '1'
$env:HEART_PORTAL_CLIENT_MANAGED = '1'
$env:RUST_LOG = 'info'
$env:NO_COLOR = '1'
$env:PATH = ${ps(windowsEnvironment(process.env, environment, ...(settings.portalEnvironmentPath ? [{ PATH: settings.portalEnvironmentPath }] : [])).PATH!)}
$stage = 'working-directory'
Set-Location -LiteralPath ${ps(settings.workspace)}
$crashes = 0
while ($true) {
  $child = $null
  $out = $null; $err = $null
  $exitCode = $null
  $started = [DateTime]::UtcNow
  try {
    $stage = 'prepare-engine'
    $env:HEART_PORTAL_STATUS_FILE = Join-Path $root '.portal-connection-status.json'
    $env:HEART_PORTAL_STATUS_NONCE = [Guid]::NewGuid().ToString()
    [IO.File]::WriteAllText((Join-Path $root '.portal-status-nonce'), $env:HEART_PORTAL_STATUS_NONCE)
    $env:HEART_PORTAL_READY_FILE = Join-Path $root '.portal-ready.json'
    $env:HEART_PORTAL_READY_NONCE = $env:HEART_PORTAL_STATUS_NONCE
    $si = New-Object System.Diagnostics.ProcessStartInfo
    $si.FileName = Join-Path $root 'heart-portal.exe'
    $si.Arguments = ${ps(portalArguments(config, settings).map(windowsArgument).join(' '))}
    $si.WorkingDirectory = ${ps(settings.workspace)}
    $si.UseShellExecute = $false
    $si.CreateNoWindow = $true
    $si.RedirectStandardOutput = $true
    $si.RedirectStandardError = $true
    foreach ($name in @('portal.log', 'portal.err.log')) {
      $file = Join-Path $root $name
      if (Test-Path -LiteralPath $file) { Move-Item -LiteralPath $file -Destination ($file + '.previous') -Force }
    }
    $out = [System.IO.File]::Open((Join-Path $root 'portal.log'), 'Create', 'Write', 'ReadWrite')
    $err = [System.IO.File]::Open((Join-Path $root 'portal.err.log'), 'Create', 'Write', 'ReadWrite')
    $stage = 'launch-engine'
    $child = [System.Diagnostics.Process]::Start($si)
    Write-PortalSupervisorLog ('engine-start pid=' + $child.Id + ' attempt=' + ($crashes + 1))
    $child.Id | Set-Content -LiteralPath (Join-Path $root 'pid')
    $outCopy = $child.StandardOutput.BaseStream.CopyToAsync($out)
    $errCopy = $child.StandardError.BaseStream.CopyToAsync($err)
    $stage = 'wait-engine'
    $child.WaitForExit()
    $exitCode = $child.ExitCode
    Write-PortalSupervisorLog ('engine-exit pid=' + $child.Id + ' code=' + $exitCode + ' runtime_ms=' + [int64]([DateTime]::UtcNow - $started).TotalMilliseconds)
    if (-not $outCopy.Wait(1000)) { $child.StandardOutput.Close() }
    if (-not $errCopy.Wait(1000)) { $child.StandardError.Close() }
  } catch { Write-PortalSupervisorLog ('stage=' + $stage + ' error=' + $_.Exception.Message) $true }
  finally {
    if ($child) { if (-not $child.HasExited) { $child.Kill() }; $child.Dispose() }
    if ($out) { $out.Dispose() }; if ($err) { $err.Dispose() }
  }
  if (([DateTime]::UtcNow - $started).TotalSeconds -ge 60) { $crashes = 0 }
  $crashes++
  if ($exitCode -eq 73 -or (Select-String -LiteralPath (Join-Path $root 'portal.err.log') -Pattern 'another (legacy )?Portal instance is already running' -Quiet -ErrorAction SilentlyContinue)) {
    Write-PortalSupervisorLog 'recovery-stopped reason=conflict'
    [IO.File]::WriteAllText($failure, 'conflict'); break
  }
  if ($crashes -ge 6) {
    Write-PortalSupervisorLog 'recovery-stopped reason=crash-limit attempts=6'
    [IO.File]::WriteAllText($failure, 'crash-limit'); break
  }
  Write-PortalSupervisorLog ('engine-retry delay_seconds=5 failures=' + $crashes)
  Start-Sleep -Seconds 5
}
} catch {
  try { Write-PortalSupervisorLog ('supervisor-fatal stage=' + $stage + ' error=' + $_.Exception.Message) $true }
  catch { [Console]::Error.WriteLine($_.Exception.Message) }
  exit 1
}
exit 0
`;
}
export function windowsArgument(value: string) { return '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"'; }
export async function atomic(file: string, contents: string) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + '.' + randomUUID();
  const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(contents); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temp, file);
  if (process.platform !== 'win32') {
    const parent = await open(path.dirname(file), 'r');
    try { await parent.sync(); } finally { await parent.close(); }
  }
}
async function tail(file: string) {
  try {
    const handle = await open(file, 'r');
    try { const { size } = await handle.stat(); const data = Buffer.alloc(Math.min(size, 64_000)); await handle.read(data, 0, data.length, Math.max(0, size - data.length)); return data.toString(); }
    finally { await handle.close(); }
  } catch { return ''; }
}

export class BackgroundPortal {
  private service: Service | null = null;
  private connection: Connection | null = null;
  private launcherSource?: string;
  state: BackgroundState;
  readonly label: string;
  get runtimeDirectory() { return path.join(this.directory, 'portal-service'); }
  constructor(private directory: string, private run: Command = command, private platform = process.platform, private home = os.homedir()) {
    this.label = `town.beings.portal-desktop.portal.${hash(path.resolve(directory))}`;
    this.state = { supported: ['darwin', 'win32'].includes(platform), installed: false, enabled: false, running: false, existing: false,
      message: ['darwin', 'win32'].includes(platform) ? '未启用后台服务' : '此版本的后台服务支持 macOS 和 Windows' };
  }
  private get domain() { return `gui/${process.getuid?.() ?? 0}`; }
  private powershell(script: string, input?: string) {
    return this.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(windowsPowerShellScript(script), 'utf16le').toString('base64')], input);
  }
  async discover(settings: Settings, connection: Connection | null) {
    this.connection = connection;
    this.launcherSource = settings.portalBinary;
    try { this.service = JSON.parse(await readFile(path.join(this.directory, 'portal-service.json'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    // Old adoption records are configuration sources, never runtime ownership.
    if (this.service && (this.service.existing || this.service.kind || this.service.label !== this.label)) this.service = null;
    if (this.service && this.platform === 'darwin' && this.service.kind !== 'portable') {
      try { await access(this.service.file); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') this.service = null; else throw error; }
    }
    return this.refresh();
  }
  async refresh(): Promise<BackgroundState> {
    const service = this.service;
    if (!service) return this.state;
    let enabled = false, running = false, loaded = true, pid: number | undefined;
    if (service.kind === 'portable') {
      const status = JSON.parse(await portableCommand(service.binary!, 'status', this.platform, this.run));
      running = this.platform === 'win32' ? Boolean(status.ready) : Array.isArray(status.portal_pids) && status.portal_pids.length === 1 && Boolean(status.supervisor || status.launchagent_loaded);
      enabled = running; pid = running ? (this.platform === 'win32' ? status.pid : status.portal_pids[0]) : undefined;
    } else if (this.platform === 'darwin') {
      await access(service.file); // Missing registration must not be presented as healthy.
      const disabled = await this.run('/bin/launchctl', ['print-disabled', this.domain]);
      const entry = disabled.split('\n').find(line => line.includes(`"${service.label}"`));
      enabled = !entry || !/=>\s*(?:true|disabled)\b/.test(entry);
      const status = await this.run('/bin/launchctl', ['print', `${this.domain}/${service.label}`]).catch(() => '');
      loaded = Boolean(status); enabled = enabled && loaded;
      running = /state = running/.test(status); pid = Number(status.match(/\bpid = (\d+)/)?.[1]) || undefined;
    } else if (this.platform === 'win32') {
      const status = JSON.parse(await this.powershell(`$t=Find-PortalTask ${ps(service.label)};
$childRunning=$false; $portalId=0; $pidFile=${ps(path.join(service.root, 'pid'))};
if ([string]$t.State -eq 'Running' -and (Test-Path -LiteralPath $pidFile)) {
  if ([int]::TryParse((Get-Content -LiteralPath $pidFile -Raw).Trim(), [ref]$portalId)) {
    $p=Get-Process -Id $portalId -ErrorAction SilentlyContinue;
    $childRunning=($null -ne $p -and $p.Path -eq ${ps(path.join(service.root, 'heart-portal.exe'))});
  }
}
@{ loaded=($null -ne $t); enabled=[bool]$t.Settings.Enabled; running=$childRunning; pid=$portalId } | ConvertTo-Json -Compress`));
      loaded = status.loaded !== false; enabled = status.enabled; running = status.running;
      if (running) pid = Number(status.pid) || undefined;
    }
    this.state = { supported: this.state.supported, installed: true, enabled, running, existing: service.existing, label: service.label, pid,
      message: !loaded ? '后台服务当前未注册或未加载，配置已保留，可点击启动 Portal 恢复' : enabled ? '登录后自动启动 · 退出客户端后继续运行 · 连续异常退出最多重试 5 次' : '后台服务已停用，不会随登录启动' };
    return this.state;
  }
  async portalState(): Promise<PortalState> {
    await this.refresh();
    if (!this.service) return { phase: 'stopped', message: this.state.message, logs: [] };
    const root = this.service.root;
    const logName = this.service.existing ? 'portal-runtime' : 'portal';
    const text = await tail(path.join(root, logName + '.log'));
    const errors = await tail(path.join(root, logName + '.err.log'));
    // Windows scheduled-task startup failures are written by the runner before
    // Portal itself can create portal.err.log. Include that supervisor output in
    // the same state/log export so diagnostics explain the actual failure.
    const previousErrors = await tail(path.join(root, logName + '.err.log.previous'));
    const supervisorEvents = await tail(path.join(root, 'supervisor.log'));
    const previousSupervisorErrors = await tail(path.join(root, 'supervisor.err.log.previous'));
    const supervisorErrors = await tail(path.join(root, 'supervisor.err.log'));
    const secrets = this.connection ? [this.connection.token, this.connection.relaySecret] : [];
    const logs = redact([previousErrors, text, errors, supervisorEvents, previousSupervisorErrors, supervisorErrors].join('\n'), secrets).split(/\r?\n/).filter(Boolean).slice(-300);
    const nonce = (await readFile(path.join(root, '.portal-status-nonce'), 'utf8')
      .catch(() => readFile(path.join(root, '.portal-launch-nonce'), 'utf8')).catch(() => '')).trim();
    const sample = this.state.running && this.state.pid
      ? await readPortalSample(path.join(root, '.portal-connection-status.json'), this.state.pid, nonce) : null;
    const ready = !sample && this.state.running && this.state.pid && await readPortalReady(path.join(root, '.portal-ready.json'), this.state.pid, nonce);
    const state = portalSampleState(sample, Boolean(ready));
    if (this.state.enabled && !this.state.running) {
      const failure = (await tail(path.join(root, '.portal-start-failure'))).trim();
      const conflict = failure === 'conflict' || /another (legacy )?Portal instance is already running/.test(errors);
      return { phase: failure || conflict ? 'error' : 'reconnecting', conflict, managed: !this.service.existing, runtimePath: root, logs,
        message: conflict ? '同一个 Being 已有本机 Portal 在运行，已停止重复启动。请先停止原服务，再点击启动 Portal。'
          : failure ? 'Portal 连续启动失败，已停止自动重试。请检查运行日志，修正后点击启动 Portal。'
          : '后台 Portal 已退出，正在等待恢复；可点击「重启 Portal」立即重试，无需重启电脑。' };
    }
    return { ...state, phase: !this.state.enabled || !this.state.running ? 'stopped' : state.phase,
      pid: this.state.pid, managed: !this.service.existing, runtimePath: root,
      message: !this.state.enabled ? this.state.message : this.state.running ? state.message : '后台 Portal 当前未运行；尚未确认自动恢复', logs };
  }
  async enable(settings: Settings, connection: Connection) {
    this.launcherSource = settings.portalBinary;
    if (!this.state.supported) throw new Error(this.state.message);
    this.connection = connection;
    const signature = fingerprint(settings, connection);
    const previous = this.service;
    if (previous?.existing || previous?.kind === 'portable') throw new Error('请先停止旧 Portal，再启动客户端 Portal。');
    if (previous && previous.fingerprint === signature) {
      await this.load(previous); return this.refresh();
    }
    await access(settings.portalBinary, this.platform === 'win32' ? constants.F_OK : constants.X_OK);
    if (settings.portalConfigPath) await access(settings.portalConfigPath, constants.R_OK);
    const root = path.join(this.runtimeDirectory, randomUUID());
    await mkdir(root, { recursive: true, mode: 0o700 });
    let registrationChanged = false;
    let wasEnabled = false;
    let oldPlist: string | undefined;
    const service: Service = { label: this.label, root, existing: false, name: settings.portalName, fingerprint: signature,
      environment: { HEART_PORTAL_CLIENT_FILE: path.join(this.directory, '.portal-client.json') },
      file: this.platform === 'darwin' ? path.join(this.home, 'Library/LaunchAgents', this.label + '.plist') : '' };
    try {
      const binary = path.join(root, this.platform === 'win32' ? 'heart-portal.exe' : 'heart-portal');
      await copyFile(settings.portalBinary, binary); await chmod(binary, 0o700);
      const config = settings.portalConfigPath || path.join(root, 'portal.toml');
      service.configPath = config; service.generatedConfig = !settings.portalConfigPath; service.cwd = settings.workspace;
      if (!settings.portalConfigPath) await atomic(config, portalConfig(settings));
      if (this.platform === 'darwin') {
        await atomic(path.join(root, 'connection.url'), connection.link);
        await atomic(path.join(root, 'run.sh'), unixRunner(root, config, settings, { HEART_PORTAL_CLIENT_FILE: path.join(this.directory, '.portal-client.json') }));
        oldPlist = await readFile(service.file, 'utf8').catch(() => undefined);
      } else {
        const encrypted = await this.powershell(`[Console]::In.ReadToEnd() | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString`, connection.link);
        await atomic(path.join(root, 'connection.dpapi'), encrypted.trim());
        await atomic(path.join(root, 'run.ps1'), '\ufeff' + windowsRunner(root, config, settings, { HEART_PORTAL_CLIENT_FILE: path.join(this.directory, '.portal-client.json') }));
      }
      if (previous) { wasEnabled = (await this.refresh()).enabled; await this.unload(previous); }
      registrationChanged = true;
      if (this.platform === 'darwin') await atomic(service.file, launchAgent(service.label, root));
      else await this.registerWindows(service);
      await this.load(service);
      this.service = service;
      await this.refresh();
      // Persist ownership only after registration succeeds. Stable runtime survives app moves/updates.
      await atomic(path.join(this.directory, 'portal-service.json'), JSON.stringify(service));
      // Keep the previous runtime: it may still own the original configuration.
      return this.state;
    } catch (error) {
      if (registrationChanged) {
        await this.unload(service).catch(() => {});
        if (this.platform === 'darwin') {
          if (oldPlist) await atomic(service.file, oldPlist); else await rm(service.file, { force: true });
        } else if (previous) await this.registerWindows(previous);
        else await this.powershell(`Unregister-ScheduledTask -TaskName ${ps(service.label)} -Confirm:$false`).catch(() => {});
        if (previous && wasEnabled) await this.load(previous);
      }
      this.service = previous;
      if (previous) await this.refresh();
      else this.state = { supported: true, installed: false, enabled: false, running: false, existing: false, message: '后台服务安装失败，请重试' };
      await rm(root, { recursive: true, force: true });
      throw error;
    }
  }
  async registerWindows(service: Service) {
    const launcher = path.join(service.root, 'portal-background-v1.exe');
    try { await access(launcher); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await this.run(this.launcherSource || path.join(service.root, 'heart-portal.exe'), ['--export-windows-launcher', launcher]);
    }
    const args = '-File ' + windowsArgument(path.join(service.root, 'run.ps1'));
    await this.powershell(`$user=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;
$a=New-ScheduledTaskAction -Execute ${ps(launcher)} -Argument ${ps(args)};
${service.login === false ? '' : '$t=New-ScheduledTaskTrigger -AtLogOn -User $user;'}
$p=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited;
$s=New-ScheduledTaskSettingsSet -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable;
Register-ScheduledTask -TaskName ${ps(service.label)} -Action $a ${service.login === false ? '' : '-Trigger $t'} -Principal $p -Settings $s -Force | Out-Null`);
  }
  async load(service: Service) {
    if (service.existing || service.kind || service.label !== this.label) throw new Error('仅支持启动客户端 Portal。');
    if (this.platform === 'darwin') {
      await this.run('/bin/launchctl', ['enable', `${this.domain}/${service.label}`]);
      const status = await this.run('/bin/launchctl', ['print', `${this.domain}/${service.label}`]).catch(() => '');
      const loaded = Boolean(status);
      if (!service.existing && !/state = running/.test(status)) await this.resetRecovery(service);
      if (!loaded) {
        // bootout can return while launchd is still releasing the old job.
        for (let attempt = 0; ; attempt++) {
          try { await this.run('/bin/launchctl', ['bootstrap', this.domain, service.file]); break; }
          catch (error) {
            if (attempt >= 19 || !/\(5\)/.test(String(error))) throw error;
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      } else if (!/state = running/.test(status)) {
        // A loaded launchd job may have stopped after a terminal startup error.
        await this.run('/bin/launchctl', ['kickstart', `${this.domain}/${service.label}`]);
      }
    } else {
      const result = await this.powershell(`$t=Find-PortalTask ${ps(service.label)};
if (-not $t) { 'Missing' }
elseif ($t.Actions[0].Execute -ne ${ps(path.join(service.root, 'portal-background-v1.exe'))}) { 'Legacy:' + [string]$t.State }
else { [string]$t.State }`);
      const status = result.trim().replace(/^Legacy:/, '');
      if (status === 'Missing' || result.trim().startsWith('Legacy:')) {
        if (service.existing) throw new Error('原 Portal 计划任务已不存在，请先恢复原服务或迁入客户端管理。');
        // Recreate only the client's saved runtime when explicitly loading it.
        // A read-only status query never creates a task or enables login startup.
        for (const file of ['run.ps1', 'heart-portal.exe', 'connection.dpapi']) await access(path.join(service.root, file));
        await this.registerWindows(service);
      }
      if (status.trim() !== 'Running' && !service.existing) await this.resetRecovery(service);
      await this.powershell(`Enable-ScheduledTask -TaskName ${ps(service.label)} | Out-Null; Start-ScheduledTask -TaskName ${ps(service.label)}`);
    }
  }
  private async resetRecovery(service: Service) {
    await rm(path.join(service.root, '.portal-start-attempt'), { force: true });
    // Removing this marker may wake launchd immediately, so clear the budget first.
    await rm(path.join(service.root, '.portal-start-failure'), { force: true });
  }
  async unload(service: Service) {
    if (service.kind === 'portable') {
      await portableCommand(service.binary!, 'stop', this.platform, this.run);
      const status = JSON.parse(await portableCommand(service.binary!, 'status', this.platform, this.run));
      if (status.supervisor || status.portal_pids?.length || status.launchagent_loaded || status.supervised || status.ready) throw new Error('原 Portal 或守护程序尚未退出。');
      return;
    }
    if (this.platform === 'darwin') {
      await this.run('/bin/launchctl', ['disable', `${this.domain}/${service.label}`]);
      const registration = await this.run('/bin/launchctl', ['print', `${this.domain}/${service.label}`]).catch(() => '');
      const loaded = Boolean(registration);
      const pid = registration.match(/\bpid = (\d+)/)?.[1];
      const identity = pid ? await this.run('/bin/ps', ['-p', pid, '-o', 'lstart=,comm=']).then(s => s.trim(), () => '') : '';
      if (loaded) {
        await this.run('/bin/launchctl', ['bootout', `${this.domain}/${service.label}`]);
        for (let attempt = 0; ; attempt++) {
          const present = await this.run('/bin/launchctl', ['print', `${this.domain}/${service.label}`]).then(() => true, () => false);
          if (!present) break;
          if (attempt >= 60) throw new Error('旧 Portal 服务尚未退出，已中止切换。');
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      }
      // A removed launchd registration is not proof that its engine exited.
      // Wait for that exact process identity before replacing or starting it.
      if (pid && identity) for (let attempt = 0; ; attempt++) {
        const current = await this.run('/bin/ps', ['-p', pid, '-o', 'lstart=,comm=']).then(s => s.trim(), () => '');
        if (current !== identity) break;
        if (attempt >= 120) throw new Error('旧 Portal 进程尚未退出，已中止安装。');
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    } else await this.powershell(`$task=Find-PortalTask ${ps(service.label)};
if ($task) { Disable-ScheduledTask -TaskName ${ps(service.label)} | Out-Null; Stop-ScheduledTask -TaskName ${ps(service.label)}; }
# The runner may have started the engine before its PID file was written.
# Select only this installation's executable, never a global process name kill.
$engine=${ps(path.join(service.root, 'heart-portal.exe'))};
$children=@(Get-CimInstance Win32_Process -Filter "Name='heart-portal.exe'" | Where-Object { $_.ExecutablePath -eq $engine });
foreach ($child in $children) {
  $portalId=$child.ProcessId;
  & taskkill.exe /PID $portalId /T /F | Out-Null;
  if ($LASTEXITCODE -ne 0 -and (Get-Process -Id $portalId -ErrorAction SilentlyContinue)) { throw 'Portal process tree did not stop' }
  Wait-Process -Id $portalId -Timeout 15 -ErrorAction SilentlyContinue;
  if (Get-Process -Id $portalId -ErrorAction SilentlyContinue) { throw 'Portal is still running' }
}
if (@(Get-CimInstance Win32_Process -Filter "Name='heart-portal.exe'" | Where-Object { $_.ExecutablePath -eq $engine }).Count) { throw 'Old Portal is still running' }
$deadline=[DateTime]::UtcNow.AddSeconds(15);
while (($task=Find-PortalTask ${ps(service.label)}) -and $task.State -eq 'Running') {
  if ([DateTime]::UtcNow -ge $deadline) { throw 'Portal supervisor task is still running' }
  Start-Sleep -Milliseconds 200;
}`);
  }
  get installedService(): Service | null { return this.service; }
  async forget() {
    // Release an already-stopped adopted service; retain its files and registration.
    await rm(path.join(this.directory, 'portal-service.json'), { force: true });
    this.service = null;
    this.state = { supported: this.state.supported, installed: false, enabled: false, running: false, existing: false, message: '等待启动客户端 Portal' };
  }
  async setService(service: Service) {
    await atomic(path.join(this.directory, 'portal-service.json'), JSON.stringify(service));
    this.service = service;
    return this.refresh();
  }
  async installRegistration(service: Service) {
    if (this.platform === 'darwin') await atomic(service.file, launchAgent(service.label, service.root));
    else await this.registerWindows(service);
  }
  async protectCredential(root: string, connection: Connection) {
    if (this.platform === 'darwin') await atomic(path.join(root, 'connection.url'), connection.link);
    else {
      const encrypted = await this.powershell(`[Console]::In.ReadToEnd() | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString`, connection.link);
      await atomic(path.join(root, 'connection.dpapi'), encrypted.trim());
    }
  }
  async disable() { if (this.service) await this.unload(this.service); return this.refresh(); }
  async restart() {
    if (!this.service || !this.state.enabled) throw new Error('后台 Portal 尚未启用。');
    await this.unload(this.service); await this.load(this.service);
    return this.refresh();
  }
}
