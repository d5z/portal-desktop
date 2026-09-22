import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parse } from 'smol-toml';
import type { PortalState, SceneTask, Settings } from '../../shared/types';

/** Local readiness only: no installation, credential disclosure or paid model probe. */
export async function subagentReady(directory: string, settings: Settings, portal: PortalState, tasks: SceneTask[]) {
  if (portal.phase !== 'connected') return false;
  try {
    const config = settings.portalConfigPath || path.join(directory, 'desktop-portal.toml');
    const document = parse(await readFile(config, 'utf8')) as { subagent?: {
      enabled?: boolean; command?: string[]; model?: { provider?: string; model?: string };
    } };
    const sub = document.subagent;
    if (sub?.enabled === false || !sub?.model?.provider?.trim() || !sub.model.model?.trim()) return false;
    const latest = tasks.filter(t => t.endedAt).sort((a,b) => b.endedAt! - a.endedAt!)[0];
    if (latest && ['failed', 'interrupted', 'timeout'].includes(latest.status)) return false;
    const expand = (value: string) => value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
    const paths = (settings.portalEnvironmentPath || process.env.PATH || '').split(path.delimiter).filter(Boolean);
    const names = process.platform === 'win32' ? ['pi', 'pi.cmd', 'pi.exe'] : ['pi'];
    const command = sub.command?.[0];
    const candidates = command
      ? /[/\\]/.test(command) ? [expand(command)] : paths.flatMap(dir =>
          (process.platform === 'win32' ? [command, command+'.exe', command+'.cmd'] : [command]).map(name => path.join(dir,name)))
      : [path.join(os.homedir(), '.heart-portal/pi/bin/pi'), ...paths.flatMap(dir => names.map(name => path.join(dir,name)))];
    for (const candidate of candidates) {
      try { await access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK); return true; } catch { /* Try next candidate. */ }
    }
  } catch { /* Unknown or malformed configuration is not a readiness signal. */ }
  return false;
}
