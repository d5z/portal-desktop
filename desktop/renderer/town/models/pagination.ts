import type { DesktopAPI, TownQuery, TownResult } from '../../../shared/types';
import type { Data, TownModel } from './town';
import { toolEntries } from './tool-library';
import { groveEntryKind } from '../../../shared/plugins';

export const PAGE_SIZE = 24;
export const paginatedViews = new Set(['kits', 'embers', 'scrolls', 'announcements', 'seeds']);
const array = (data: Data | null, key: string): Data[] => Array.isArray(data?.[key]) ? data[key] as Data[] : [];

export function paginate<T>(entries: T[], offset: number) {
  const total = entries.length;
  const start = Math.min(Math.max(0, Math.floor((offset || 0) / PAGE_SIZE) * PAGE_SIZE), Math.max(0, Math.ceil(total / PAGE_SIZE) - 1) * PAGE_SIZE);
  return { items: entries.slice(start, start + PAGE_SIZE), total, offset: start, pages: Math.ceil(total / PAGE_SIZE), page: total ? start / PAGE_SIZE + 1 : 0 };
}

export function toolPage(town: TownModel) {
  const entries = toolEntries(array(town.data, 'kits'), town.installedLibrary?.kits || [], town.plugins?.library.plugins || [], town.localApps || []);
  return paginate(entries.filter(entry => (!town.groveKind || town.groveKind === entry.kind) && (!town.localOnly || entry.local) &&
    town.matches(entry.name, entry.description, entry.kind, entry.plugin?.manifest.author,
      entry.remote?.name, entry.remote?.title, entry.remote?.description, entry.remote?.display_name,
      entry.remote?.being_id, entry.remote?.kind, entry.remote?.status,
      ...(Array.isArray(entry.remote?.tags) ? entry.remote.tags.map(tag => typeof tag === 'string' ? tag : tag?.name) : []))), town.offset);
}

export function catalogPage(town: TownModel, data = town.data) {
  const key = town.tab === 'grove' ? 'kits' : town.view === 'seeds' ? 'seeds' : town.view === 'announcements' ? 'items' : 'scrolls';
  const entries = array(data, key).filter(entry => (!town.groveKind || key !== 'kits' || groveEntryKind(entry) === town.groveKind) && (town.view === 'seeds' || (town.view === 'announcements'
    ? town.matches(entry.title, entry.content, entry.display_name, entry.display, entry.town_id)
    : town.matches(entry.name, entry.title, entry.description, entry.display_name, entry.being_id, entry.kind, entry.status, ...(Array.isArray(entry.tags) ? entry.tags : [])))));
  return paginate(entries, town.offset);
}

/** Read the server's pages before client-only filters; never present a partial collection as an exact total. */
export async function collectTownPages(query: TownQuery, read: DesktopAPI['town'], active: () => boolean): Promise<TownResult> {
  const key = query.kind === 'grove' ? 'kits' : query.kind === 'seeds' ? 'seeds' : query.kind === 'announcements' ? 'items' : 'scrolls';
  const entries: Data[] = [], seen = new Set<string>();
  let first: Extract<TownResult, { ok: true }> | undefined;
  for (let offset = 0; offset <= 100000; offset += PAGE_SIZE) {
    if (!active()) throw new Error('列表请求已取消。');
    const result = await read({ ...query, offset });
    if (!active()) throw new Error('列表请求已取消。');
    if (!result.ok) return result;
    if (!Array.isArray(result.data[key])) throw new Error('Town 返回的列表格式不正确，请稍后刷新。');
    first ||= result;
    const page = array(result.data, key);
    let added = 0;
    for (const entry of page) {
      const id = String(entry.id ?? JSON.stringify(entry));
      if (!seen.has(id)) { seen.add(id); entries.push(entry); added++; }
    }
    const total = Number(result.data.total ?? result.data.count);
    const more = typeof result.data.has_more === 'boolean' ? result.data.has_more :
      page.length >= PAGE_SIZE && (!Number.isSafeInteger(total) || total < 0 || offset + page.length < total);
    if (!more) return { ...first, data: { ...first.data, [key]: entries } };
    if (!added) throw new Error('Town 返回了重复分页，请稍后刷新。');
  }
  throw new Error('列表超过可读取的分页范围，请缩小筛选条件。');
}
