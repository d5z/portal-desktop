import { isDeepStrictEqual } from 'node:util';
import { powershell } from './windows-installation.mjs';

export async function processIdentity(pid) {
  return JSON.parse(await powershell(`
    $item=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}';
    if ($item) { @{pid=$item.ProcessId; created=$item.CreationDate.ToUniversalTime().Ticks.ToString(); executable=$item.ExecutablePath} | ConvertTo-Json -Compress } else { 'null' }
  `));
}

export async function replacementProcess(pid, previous) {
  // The connected status file can outlive its process during an installer
  // restart. Keep polling until it names a live replacement, not just a new PID.
  const current = await processIdentity(pid);
  return current && !isDeepStrictEqual(current, previous) ? current : null;
}
