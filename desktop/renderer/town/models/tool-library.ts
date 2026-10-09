import { groveEntryKind, type InstalledPlugin } from '../../../shared/plugins';
import type { LocalApp, LocalKit } from '../../../shared/types';
import type { Data } from './town';
const str = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : '';

export interface ToolEntry { key: string; kind: 'app' | 'kit' | 'plugin'; name: string; description: string; local: boolean; kit?: LocalKit; plugin?: InstalledPlugin; app?: LocalApp; remote?: Data }
export function toolEntries(remote: Data[], kits: LocalKit[], plugins: InstalledPlugin[], apps: LocalApp[]): ToolEntry[] {
  const entries: ToolEntry[] = [
    ...plugins.map(plugin => ({ key: `plugin:${plugin.manifest.id}`, kind: 'plugin' as const, name: plugin.manifest.name, description: plugin.manifest.description, local: true, plugin })),
    ...kits.map(kit => ({ key: `kit:${kit.name}`, kind: 'kit' as const, name: kit.name, description: kit.description, local: true, kit })),
    ...apps.map(app => ({ key: `app:${app.id}`, kind: 'app' as const, name: app.name, description: app.exists ? '已关联本机程序' : '关联的程序已不存在', local: app.exists, app })),
  ];
  for (const item of remote) {
    const kind = groveEntryKind(item), id = str(item.id), name = str(item.name);
    const found = entries.find(entry => entry.kind === kind && (kind === 'plugin' ? entry.plugin?.source.id === id || entry.plugin?.manifest.id === item.plugin_id : kind === 'kit' ? entry.name === name : entry.app?.id === id));
    if (found) { found.remote = item; continue; }
    entries.push({ key: `grove:${id}`, kind, name, description: str(item.description), local: false, remote: item });
  }
  return entries;
}
