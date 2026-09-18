import { access, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { command, portableCommand, windowsModulePath, type Command, type Service } from './background';
import macLaunch from './mac-launch.py?raw';
import { parseConnection, type Connection } from '../chat/connection';
import type { PortalState } from '../../shared/types';
import { readPortalSample, portalSampleState } from './status';

export const portalIdentity = (connection: Connection) => `${new URL(connection.endpoint).host.toLowerCase()}/${connection.being}`;
export interface PortalConflict { id: string; root: string; roots?: string[]; label: string; pid?: number; service?: Service; problem?: string }
const proof = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ps = (value: string) => `'${value.replaceAll("'", "''")}'`;
async function localPortalName(root: string): Promise<string | undefined> {
  const valid = (name: unknown): name is string => typeof name === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(name);
  const savedName = (await readFile(path.join(root, '.portal-name'), 'utf8').catch(() => '')).trim();
  if (valid(savedName)) return savedName;
  try {
    const saved = JSON.parse(await readFile(path.join(root, '../../portal-service.json'), 'utf8'));
    if (await realpath(saved.root) === root && valid(saved.name)) return saved.name;
  } catch { /* Older services did not persist the display name. */ }
  const script = await readFile(path.join(root, 'run.sh'), 'utf8').catch(() => '');
  const name = /--name '([a-zA-Z0-9_-]{1,80})'/.exec(script)?.[1];
  if (name) return name;
  const config = await readFile(path.join(root, 'portal.toml'), 'utf8').catch(() => '');
  return /^name\s*=\s*"([a-zA-Z0-9_-]{1,80})"/m.exec(config)?.[1];
}

// Read-only discovery. Finding a process does not grant the desktop ownership of it.
export class ExternalPortalObserver {
  constructor(private run: Command = command, private platform = process.platform, private home = os.homedir()) {}
  // Identify a conflicting guardian by OS user, live binary and Being.
  // Its configuration is optional: it may already be gone after installation.
  async forUpgrade(connection: Connection, label: string, excludeRoot?: string, attempt = 0, matchBeing = false, registeredRoots: string[] = []): Promise<Service[]> {
    let processes: { pid: number; binary: string }[];
    if (this.platform === 'darwin') {
      const listing = await this.run('/bin/ps', ['-axo', 'pid=,uid=,comm=']);
      processes = listing.split('\n').flatMap(line => {
        const m = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
        return m && Number(m[2]) === process.getuid!() && path.basename(m[3]) === 'heart-portal' ? [{ pid: Number(m[1]), binary: m[3] }] : [];
      });
    } else if (this.platform === 'win32') {
      const script = windowsModulePath + `$ErrorActionPreference='Stop'; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;
@(@(Get-CimInstance Win32_Process -Filter "Name LIKE 'heart-portal%.exe'") | ForEach-Object {
  $candidate=$_; $owner=$null
  if ($candidate.ExecutablePath) {
    try { $owner=Invoke-CimMethod -InputObject $candidate -MethodName GetOwnerSid }
    catch {
      # A process can exit between the WMI snapshot and the ownership query.
      # Skip only WBEM_E_NOT_FOUND; fail closed for every other owner error.
      if ($_.FullyQualifiedErrorId -notmatch '^HRESULT 0x80041002,') { throw }
    }
  }
  if ($owner -and $owner.Sid -eq $sid) { @{pid=$candidate.ProcessId;binary=$candidate.ExecutablePath} }
}) | ConvertTo-Json -Compress`;
      const output = await this.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
      const data = output.trim() ? JSON.parse(output) : [];
      processes = Array.isArray(data) ? data : [data];
    } else return [];
    const found: Service[] = [];
    let changing = false;
    for (const process of processes) {
      let root: string, binary: string, launch: { arguments: string[]; cwd: string; environment: Record<string, string> };
      try {
        binary = await realpath(process.binary);
        const parent = path.dirname(binary);
        root = path.basename(parent) === 'release' && path.basename(path.dirname(parent)) === 'target' ? path.dirname(path.dirname(parent)) : parent;
        if (root === excludeRoot || found.some(s => s.root === root)) continue;
        // A verified desktop task already supplies its management channel.
        // Older engines can interpret `status` as a positional config filename.
        if (registeredRoots.some(registered => this.platform === 'win32'
          ? registered.toLowerCase() === root.toLowerCase() : registered === root)) continue;
        if (this.platform === 'darwin') {
          await access(path.join(root, '.portal-supervisor.json'));
          launch = JSON.parse(await this.run('/usr/bin/python3', ['-c', macLaunch, String(process.pid), binary]));
        } else {
          const saved = JSON.parse(await readFile(path.join(root, '.portal-launch.json'), 'utf8'));
          launch = { arguments: saved.arguments, cwd: saved.working_directory, environment: saved.environment };
        }
        const link = launch.environment?.PORTAL_CONNECT_LINK || await readFile(path.join(root, '.portal-connection.url'), 'utf8');
        const savedConnection = parseConnection(link);
        if (matchBeing ? portalIdentity(savedConnection) !== portalIdentity(connection) : savedConnection.link !== connection.link) continue;
      } catch { continue; }
      const argument = (name: string) => { const i = launch.arguments.indexOf(name); return i >= 0 ? launch.arguments[i + 1] : launch.arguments.find(a => a.startsWith(name + '='))?.slice(name.length + 1); };
      const config = argument('--config');
      const configPath = config && path.isAbsolute(launch.cwd) ? path.resolve(launch.cwd, config) : undefined;
      let output: string;
      try { output = await portableCommand(binary, 'status', this.platform, this.run); }
      catch (error) {
        if (/Config file not found:\s*status|(?:unrecognized|unexpected)[^\n]*status/i.test(String(error))) {
          throw new Error(`旧 Portal（${binary}）不支持状态命令，无法确认其守护程序。请先通过原管理方式停止该实例，再点击「启动 Portal」使用客户端内置版本。`);
        }
        throw error;
      }
      const status = JSON.parse(output);
      if (this.platform === 'darwin' ? !status.portal_pids?.includes(process.pid) : Number(status.pid) !== process.pid) {
        // Windows start/status helpers use the same executable as the engine.
        // Only the status-verified engine owns the launch; rescan if the initial
        // process snapshot caught bootstrap before its supervised child existed.
        changing = true; continue;
      }
      const environment = Object.fromEntries(Object.entries(launch.environment).filter(([key, value]) =>
        !key.startsWith('HEART_PORTAL_') && key !== 'PORTAL_CONNECT_LINK' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === 'string' && !value.includes('\0')));
      found.push({ label, root, binary, file: '', existing: true, kind: 'portable', login: Boolean(status.launchagent_loaded),
        configPath, cwd: launch.cwd, name: argument('--name') || (await readFile(path.join(root, '.portal-name'), 'utf8').catch(() => '')).trim(), environment });
    }
    if (changing && !found.length) {
      if (attempt >= 3) throw new Error('Portal 仍在启动或重启，未停止服务，请稍后重试升级。');
      await new Promise(resolve => setTimeout(resolve, 500));
      return this.forUpgrade(connection, label, excludeRoot, attempt + 1, matchBeing, registeredRoots);
    }
    return found;
  }
  /** Read registrations as well as live processes: a sleeping guardian can
   * relaunch an old engine after the replacement has already started. */
  async conflicts(connection: Connection, excludeRoot?: string): Promise<PortalConflict[]> {
    const found: PortalConflict[] = [];
    const excluded = excludeRoot && await realpath(excludeRoot).catch(() => excludeRoot);
    const matches = (link: string) => portalIdentity(parseConnection(link)) === portalIdentity(connection);
    if (this.platform === 'darwin') {
      const agents = path.join(this.home, 'Library/LaunchAgents');
      const domain = `gui/${process.getuid!()}`;
      const disabled = await this.run('/bin/launchctl', ['print-disabled', domain]);
      for (const name of await readdir(agents).catch(() => [])) {
        if (!/^town\.beings\.(?:(?:portal-desktop|desktop)\.portal|heart-portal)\.[a-f0-9]+\.plist$/.test(name)) continue;
        const file = path.join(agents, name);
        let data: { Label: string; ProgramArguments: string[] }, contents: string, root: string, script: string;
        try {
          if ((await stat(file)).uid !== process.getuid!()) continue;
          contents = await readFile(file, 'utf8');
          data = JSON.parse(await this.run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file]));
          if (data.Label !== name.slice(0, -6) || data.ProgramArguments?.length !== 2 || data.ProgramArguments[0] !== '/bin/sh') continue;
          script = data.ProgramArguments[1];
          if (!path.isAbsolute(script) || !['run.sh', 'portal-launchagent.sh'].includes(path.basename(script))) continue;
          root = await realpath(path.basename(script) === 'run.sh' ? path.dirname(script) : path.dirname(path.dirname(script)));
          if (root === excluded) continue;
          const link = await readFile(path.join(root, 'connection.url'), 'utf8').catch(() => readFile(path.join(root, '.portal-connection.url'), 'utf8'));
          if (!matches(link)) continue;
        } catch { continue; }
        const status = await this.run('/bin/launchctl', ['print', `${domain}/${data.Label}`]).catch(() => '');
        const entry = disabled.split('\n').find(line => line.includes(`"${data.Label}"`));
        if (!status && entry && /=>\s*(?:true|disabled)\b/.test(entry)) continue;
        const service: Service = { label: data.Label, file, root, existing: path.basename(script) !== 'run.sh', name: await localPortalName(root) };
        const conflict: PortalConflict = { id: proof([contents, root, portalIdentity(connection)]), label: data.Label, root,
          pid: Number(status.match(/\bpid = (\d+)/)?.[1]) || undefined, service };
        if (status && !status.includes(script)) {
          conflict.service = undefined; conflict.problem = '系统实际加载的守护路径与登记文件不一致，请先用原管理方式停止。';
        }
        found.push(conflict);
      }
    } else if (this.platform === 'win32') {
      const script = windowsModulePath + `$ErrorActionPreference='Stop'; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;
@(@(Get-ScheduledTask) | Where-Object { $_.TaskPath -eq '\\' -and $_.TaskName -match '^town\\.beings\\.(?:(?:portal-desktop|desktop)\\.portal)\\.[a-f0-9]+$' } | ForEach-Object {
  try { $owner=New-Object -TypeName Security.Principal.NTAccount -ArgumentList $_.Principal.UserId; $owned=$owner.Translate([Security.Principal.SecurityIdentifier]).Value -eq $sid } catch { $owned=$_.Principal.UserId -eq $sid }
  if ($owned -and ($_.Settings.Enabled -or [string]$_.State -eq 'Running') -and $_.Actions.Count -eq 1) {
    @{label=$_.TaskName; execute=$_.Actions[0].Execute; arguments=$_.Actions[0].Arguments}
  }
}) | ConvertTo-Json -Compress`;
      const output = await this.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
      const tasks = output.trim() ? JSON.parse(output) : [];
      for (const task of Array.isArray(tasks) ? tasks : [tasks]) {
        try {
          if (path.win32.basename(task.execute).toLowerCase() !== 'powershell.exe') continue;
          const file = /-File\s+"([^"]+)"\s*$/i.exec(task.arguments)?.[1];
          if (!file || path.win32.basename(file) !== 'run.ps1') continue;
          const root = await realpath(path.dirname(file));
          if (root === excluded) continue;
          const credential = path.join(root, 'connection.dpapi');
          const decrypt = windowsModulePath + `$ErrorActionPreference='Stop'; [System.Net.NetworkCredential]::new('', (Get-Content -LiteralPath ${ps(credential)} -Raw | ConvertTo-SecureString)).Password`;
          const link = await this.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(decrypt, 'utf16le').toString('base64')]);
          if (!matches(link)) continue;
          found.push({ id: proof([task, root, portalIdentity(connection)]), label: task.label, root,
            service: { label: task.label, root, file: '', existing: false, name: await localPortalName(root) } });
        } catch { /* Inaccessible or unrelated tasks are not eligible for takeover. */ }
      }
    }
    for (const service of await this.forUpgrade(connection, 'confirmed-portal-takeover', excluded, 0, true, found.map(item => item.root))) {
      if (found.some(item => item.root === service.root)) continue;
      found.push({ id: proof([service.root, service.binary, service.configPath, portalIdentity(connection)]), root: service.root, label: '独立 Portal 守护程序', service });
    }
    const observed = await this.read(connection, excluded);
    if (observed?.runtimePath && !found.some(item => item.root === observed.runtimePath)) {
      found.push({ id: proof([observed.runtimePath, observed.pid]), label: '未识别的本机 Portal', root: observed.runtimePath, pid: observed.pid,
        problem: '已确认 Being，但无法确认守护管理方式。请先使用原管理方式停止，客户端不会仅按进程名强制结束。' });
    }
    return found;
  }
  async read(connection: Connection | null, excludeRoot?: string): Promise<PortalState | null> {
    if (!connection || this.platform !== 'darwin') return null;
    const listing = await this.run('/bin/ps', ['-axo', 'pid=,uid=,comm=']);
    for (const line of listing.split('\n')) {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
      if (!match || Number(match[2]) !== process.getuid!() || path.basename(match[3]) !== 'heart-portal') continue;
      const pid = Number(match[1]);
      try {
        const binary = await realpath(match[3]);
        const parent = path.dirname(binary);
        const root = path.basename(parent) === 'release' && path.basename(path.dirname(parent)) === 'target'
          ? path.dirname(path.dirname(parent)) : parent;
        if (root === excludeRoot) continue;
        const nonce = (await readFile(path.join(root, '.portal-status-nonce'), 'utf8')
          .catch(() => readFile(path.join(root, '.portal-launch-nonce'), 'utf8'))).trim();
        if (!nonce) continue;
        const link = parseConnection(await readFile(path.join(root, '.portal-connection.url'), 'utf8')
          .catch(() => readFile(path.join(root, 'connection.url'), 'utf8')));
        if (portalIdentity(link) !== portalIdentity(connection)) continue;
        const sample = await readPortalSample(path.join(root, '.portal-connection-status.json'), pid, nonce);
        const state = portalSampleState(sample);
        return { ...state, phase: sample ? state.phase : 'external', pid, managed: false, runtimePath: root,
          message: `${state.message} 点击「使用客户端 Portal」将关闭已识别的旧服务及其守护程序。`, logs: [] };
      } catch { /* Incomplete, unrelated or changing runtimes are not adopted. */ }
    }
    return null;
  }
}
