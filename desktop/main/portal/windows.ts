import path from 'node:path';
import { spawn } from 'node:child_process';

function variable(environment: NodeJS.ProcessEnv, name: string) {
  return Object.entries(environment).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
}

export function windowsRoot(environment: NodeJS.ProcessEnv = process.env) {
  return [variable(environment, 'SystemRoot'), variable(environment, 'windir')]
    .find(value => value && /^[a-z]:[\\/]/i.test(value)) || 'C:\\Windows';
}

export function windowsExecutable(file: string, environment: NodeJS.ProcessEnv = process.env) {
  const system = path.win32.join(windowsRoot(environment), 'System32');
  if (/^powershell(?:\.exe)?$/i.test(file)) return path.win32.join(system, 'WindowsPowerShell/v1.0/powershell.exe');
  if (/^(cmd|taskkill)(?:\.exe)?$/i.test(file)) return path.win32.join(system, file.replace(/\.exe$/i, '') + '.exe');
  return file;
}

// Shared by foreground shutdown and service unload. OpenExisting never creates
// an event or grants access; only live descendants of the verified roots qualify.
export const windowsSandboxCancellation = String.raw`
function Stop-PortalSandboxTasks($roots, [DateTime]$stopDeadline) {
  if (-not $roots.Count) { return }
  $all=@(Get-CimInstance Win32_Process);
  $tree=@{}; $queue=[Collections.Generic.Queue[object]]::new();
  foreach ($root in $roots) {
    $current=$all | Where-Object { $_.ProcessId -eq $root.ProcessId -and $_.CreationDate -eq $root.CreationDate -and $_.ExecutablePath -eq $root.ExecutablePath -and $_.CommandLine -eq $root.CommandLine };
    if ($current) { $tree[[int]$current.ProcessId]=$current; $queue.Enqueue($current) }
  }
  while ($queue.Count) {
    $parent=$queue.Dequeue();
    foreach ($item in $all | Where-Object { $_.ParentProcessId -eq $parent.ProcessId -and $_.CreationDate -ge $parent.CreationDate }) {
      if (-not $tree.ContainsKey([int]$item.ProcessId)) { $tree[[int]$item.ProcessId]=$item; $queue.Enqueue($item) }
    }
  }
  $waiting=[Collections.Generic.List[Diagnostics.Process]]::new();
  try {
    foreach ($item in $tree.Values) {
      $process=$null; $event=$null;
      try {
        $process=[Diagnostics.Process]::GetProcessById($item.ProcessId);
        $null=$process.Handle;
        $current=Get-CimInstance Win32_Process -Filter ('ProcessId=' + $item.ProcessId);
        if (-not $current -or $current.CreationDate -ne $item.CreationDate -or $current.ExecutablePath -ne $item.ExecutablePath -or $current.CommandLine -ne $item.CommandLine) { continue }
        $event=[Threading.EventWaitHandle]::OpenExisting(('Local\Town.Portal.SandboxCancel.' + $item.ProcessId));
        if ($event.Set()) { $waiting.Add($process); $process=$null }
      } catch [Threading.WaitHandleCannotBeOpenedException] { }
        catch [ArgumentException] { }
        catch [InvalidOperationException] { }
      finally { if ($event) { $event.Dispose() }; if ($process) { $process.Dispose() } }
    }
    $deadline=[DateTime]::UtcNow.AddSeconds(10);
    if ($stopDeadline -lt $deadline) { $deadline=$stopDeadline }
    while (@($waiting | Where-Object { -not $_.HasExited }).Count -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 50 }
  } finally { foreach ($process in $waiting) { $process.Dispose() } }
}
`;

/** Wait for the foreground engine's sandbox descendants to revoke their ACLs. */
export function signalWindowsSandboxCancel(pid: number, platform = process.platform): Promise<boolean> {
  if (platform !== 'win32') return Promise.resolve(false);
  const script = `$env:PSModulePath="$PSHOME\\Modules"; $ErrorActionPreference='Stop'; ${windowsSandboxCancellation}
    $roots=@(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' | Where-Object ParentProcessId -eq ${process.pid});
    Stop-PortalSandboxTasks $roots ([DateTime]::UtcNow.AddSeconds(10)); exit 0`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise(resolve => {
    const child = spawn(windowsExecutable('powershell'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'], env: windowsEnvironment(process.env),
    });
    const timer = setTimeout(() => { child.kill(); resolve(false); }, 14_000);
    child.once('error', () => { clearTimeout(timer); resolve(false); });
    child.once('close', code => { clearTimeout(timer); resolve(code === 0); });
  });
}

// Windows environment keys are case-insensitive, but Node sorts duplicate keys
// before spawning. Merge them ourselves so an explicit PATH cannot lose to Path.
export function windowsEnvironment(...sources: NodeJS.ProcessEnv[]): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const source of sources) for (const [key, value] of Object.entries(source)) {
    const previous = Object.keys(environment).find(name => name.toLowerCase() === key.toLowerCase());
    if (previous) delete environment[previous];
    environment[key.toLowerCase() === 'path' ? 'PATH' : key] = value;
  }
  const root = windowsRoot(environment);
  const entries = (environment.PATH || '').split(';').filter(Boolean);
  for (const directory of [path.win32.join(root, 'System32'), root,
    path.win32.join(root, 'System32/Wbem'), path.win32.join(root, 'System32/WindowsPowerShell/v1.0')]) {
    if (!entries.some(entry => path.win32.normalize(entry).toLowerCase() === directory.toLowerCase())) entries.push(directory);
  }
  environment.PATH = entries.join(';');
  if (!variable(environment, 'SystemRoot')) environment.SystemRoot = root;
  return environment;
}
