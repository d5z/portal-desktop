# Inputs ($operation, $targetRoots) come from the main process, never renderer data.
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
function Test-Owner($item) {
  try { return (Invoke-CimMethod -InputObject $item -MethodName GetOwnerSid).Sid -eq $sid }
  catch { if ($_.FullyQualifiedErrorId -match '^HRESULT 0x80041002,') { return $false }; throw }
}
function Get-GuardianRoot([string]$exe, [string]$arguments) {
  $exe = $exe.Trim('"')
  if ($exe.IndexOfAny([IO.Path]::GetInvalidPathChars()) -ge 0) { return }
  $name = [IO.Path]::GetFileName($exe)
  $script = $null
  if ($name -in @('powershell.exe', 'pwsh.exe')) {
    if ($arguments -match '(?i)(?:^|\s)-File\s+(?:"([^"]+)"|([^\s"]+))') {
      $script = if ($Matches[1]) { $Matches[1] } else { $Matches[2] }
    }
  } elseif ($name -in @('wscript.exe', 'cscript.exe')) {
    if ($arguments -match '(?i)(?:^|\s)"([^"]+\\portal-supervisor-hidden\.vbs)"(?:\s|$)') { $script = $Matches[1] }
  }
  if (-not $script -or $script.IndexOfAny([IO.Path]::GetInvalidPathChars()) -ge 0 -or -not [IO.Path]::IsPathRooted($script)) { return }
  $leaf = [IO.Path]::GetFileName($script)
  $parent = [IO.Path]::GetDirectoryName($script)
  if ($leaf -eq 'run.ps1') { $root = $parent }
  elseif ($leaf -in @('portal-supervisor.ps1', 'portal-supervisor-bootstrap.ps1', 'portal-supervisor-hidden.vbs') -and [IO.Path]::GetFileName($parent) -eq 'scripts') {
    $root = [IO.Path]::GetDirectoryName($parent)
  } else { return }
  # A redirected supervisor must not be attributed to the script's installation.
  if ($arguments -match '(?i)(?:^|\s)-Root\s+(?:"([^"]+)"|([^\s"]+))') {
    $override = if ($Matches[1]) { $Matches[1] } else { $Matches[2] }
    if ($override -ne $root) { return }
  }
  if ($leaf -eq 'portal-supervisor-hidden.vbs' -and $arguments -notmatch ([regex]::Escape('"' + $script + '" "' + $root + '"'))) { return }
  return [IO.Path]::GetFullPath($root)
}
function Get-EngineRoot($item) {
  if ($item.Name -notmatch '^heart-portal(?:-[a-zA-Z0-9_-]+)?\.exe$' -or -not $item.ExecutablePath) { return }
  # Commands running an upgrade are not engines available for replacement.
  if ($item.CommandLine -match '(?i)(?:^|\s)"?(?:upgrade|--upgrade|--version|stop|status)"?(?:\s|$)') { return }
  $root = [IO.Path]::GetDirectoryName($item.ExecutablePath)
  if ([IO.Path]::GetFileName($root) -eq 'release' -and [IO.Path]::GetFileName([IO.Path]::GetDirectoryName($root)) -eq 'target') {
    $root = [IO.Path]::GetDirectoryName([IO.Path]::GetDirectoryName($root))
  }
  return $root
}
function Get-OwnedTasks {
  foreach ($task in @(Get-ScheduledTask)) {
    if (-not $task.Settings.Enabled -and [string]$task.State -ne 'Running') { continue }
    if ($task.Actions.Count -ne 1) { continue }
    try {
      $owner = New-Object -TypeName Security.Principal.NTAccount -ArgumentList $task.Principal.UserId
      $owned = $owner.Translate([Security.Principal.SecurityIdentifier]).Value -eq $sid
    } catch { $owned = $task.Principal.UserId -eq $sid }
    if (-not $owned) { continue }
    $root = Get-GuardianRoot $task.Actions[0].Execute $task.Actions[0].Arguments
    if ($root) { @{ root=$root; task=$task } }
  }
}
function Get-OwnedProcesses {
  foreach ($item in @(Get-CimInstance Win32_Process -Filter "Name LIKE 'heart-portal%.exe' OR Name='powershell.exe' OR Name='pwsh.exe' OR Name='wscript.exe' OR Name='cscript.exe'")) {
    if ($item.ProcessId -eq $PID -or -not $item.ExecutablePath) { continue }
    $root = Get-GuardianRoot $item.ExecutablePath $item.CommandLine
    $guardian = [bool]$root
    if (-not $root) { $root = Get-EngineRoot $item }
    if ($root -and (Test-Owner $item)) { @{ root=$root; guardian=$guardian; item=$item } }
  }
}
if ($operation -eq 'inventory') {
  $entries = @(
    foreach ($entry in @(Get-OwnedTasks)) {
      @{ root=$entry.root; task=$entry.task.TaskPath + $entry.task.TaskName; execute=$entry.task.Actions[0].Execute; arguments=$entry.task.Actions[0].Arguments }
    }
    foreach ($entry in @(Get-OwnedProcesses)) { @{ root=$entry.root } }
  )
  ConvertTo-Json -InputObject $entries -Compress
} elseif ($operation -eq 'stop') {
  if (-not $targetRoots -or @($targetRoots | Where-Object { -not [IO.Path]::IsPathRooted($_) }).Count) { throw 'Invalid Portal runtime path' }
  # Disable relaunch before terminating a guardian or engine. Never unregister or
  # remove its files, so configuration and crash evidence remain available.
  foreach ($entry in @(Get-OwnedTasks | Where-Object { $_.root -in $targetRoots })) {
    Disable-ScheduledTask -TaskName $entry.task.TaskName -TaskPath $entry.task.TaskPath | Out-Null
    Stop-ScheduledTask -TaskName $entry.task.TaskName -TaskPath $entry.task.TaskPath
  }
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  $quiet = $null
  do {
    $entries = @(Get-OwnedProcesses | Where-Object { $_.root -in $targetRoots } | Sort-Object { -[int]$_.guardian })
    foreach ($entry in $entries) {
      $item = $entry.item
      $live = Get-CimInstance Win32_Process -Filter "ProcessId=$($item.ProcessId)"
      if (-not $live) { continue }
      if ($live.CreationDate -ne $item.CreationDate -or $live.ExecutablePath -ne $item.ExecutablePath -or $live.CommandLine -ne $item.CommandLine -or -not (Test-Owner $live)) { throw 'Portal process identity changed; retry recovery' }
      $process = Get-Process -Id $item.ProcessId -ErrorAction SilentlyContinue
      if (-not $process) { continue }
      try {
        # Accessing the handle pins the process identity before Kill/WaitForExit.
        $null = $process.Handle
        if ([Math]::Abs(($process.StartTime.ToUniversalTime() - $live.CreationDate.ToUniversalTime()).TotalMilliseconds) -ge 1) { throw 'Portal PID was reused' }
        if ($process.HasExited) { continue }
        & "$env:SystemRoot\System32\taskkill.exe" /PID $item.ProcessId /T /F | Out-Null
        if ($LASTEXITCODE -ne 0 -and -not $process.HasExited) { throw 'Portal process tree did not stop' }
        if (-not $process.WaitForExit(3000)) { throw 'Old Portal did not exit' }
        Write-Output ('force-stopped pid=' + $item.ProcessId + ' guardian=' + $entry.guardian)
      } finally { $process.Dispose() }
    }
    if ($entries.Count) { $quiet = $null }
    elseif (-not $quiet) { $quiet = [DateTime]::UtcNow }
    elseif (([DateTime]::UtcNow - $quiet).TotalSeconds -ge 2) { return }
    if ([DateTime]::UtcNow -ge $deadline) { throw 'Old Portal keeps restarting; replacement was not started' }
    Start-Sleep -Milliseconds 200
  } while ($true)
} else { throw 'Invalid recovery operation' }
