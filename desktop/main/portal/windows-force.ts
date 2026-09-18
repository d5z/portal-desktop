import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { command, windowsPowerShellScript, type Command } from './background';
import { parseConnection, type Connection } from '../chat/connection';
import { portalIdentity, type PortalConflict } from './external';
import script from './windows-force.ps1?raw';

const ps = (value: string) => "'" + value.replaceAll("'", "''") + "'";
/** Explicit Windows recovery, independent of the old binary's stop/status API. */
export class WindowsForcePortal {
  constructor(private run: Command = command) {}
  private execute(source: string) {
    return this.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(windowsPowerShellScript(source), 'utf16le').toString('base64')]);
  }
  async conflicts(connection: Connection): Promise<PortalConflict[]> {
    const entries: { root: string; task?: string; execute?: string; arguments?: string }[] = JSON.parse(
      await this.execute("$operation='inventory'; " + script));
    const groups = new Map<string, typeof entries>();
    for (const entry of entries) {
      // The recovery script only runs on Windows, where resolving junctions
      // is part of validating the process root. On other hosts, preserve the
      // lexical path because macOS maps /var to /private/var during realpath().
      let root: string | undefined;
      try {
        root = process.platform === 'win32' ? await realpath(entry.root) : path.resolve(entry.root);
      } catch { continue; }
      if (!root) continue;
      const key = root.toLowerCase();
      groups.set(key, [...(groups.get(key) || []), { ...entry, root }]);
    }
    const targets: PortalConflict[] = [];
    for (const group of groups.values()) {
      const root = group[0].root;
      let link: string;
      try {
        const credential = path.join(root, 'connection.dpapi');
        const hasCredential = await readFile(credential).then(() => true, error => {
          if (error.code === 'ENOENT') return false;
          throw error;
        });
        if (hasCredential) {
          link = await this.execute(`[System.Net.NetworkCredential]::new('', (Get-Content -LiteralPath ${ps(credential)} -Raw | ConvertTo-SecureString)).Password`);
        } else {
          const launch = JSON.parse(await readFile(path.join(root, '.portal-launch.json'), 'utf8').catch(error => {
            if (error.code === 'ENOENT') return '{}';
            throw error;
          }));
          link = launch.environment?.PORTAL_CONNECT_LINK || await readFile(path.join(root, '.portal-connection.url'), 'utf8');
        }
        if (portalIdentity(parseConnection(link)) !== portalIdentity(connection)) continue;
      } catch { continue; } // Missing ownership evidence is never permission to kill.
      const registrations = group.filter(entry => entry.task).sort((a, b) => a.task!.localeCompare(b.task!));
      targets.push({ id: createHash('sha256').update(JSON.stringify([root, portalIdentity(connection), registrations])).digest('hex'),
        root, label: '旧 Portal（强制接管）', service: { root, label: 'force-recovery', file: '', existing: true } });
    }
    return targets;
  }
  async stop(target: PortalConflict) {
    return this.execute(`$operation='stop'; $targetRoot=${ps(target.root)}; ` + script);
  }
}
