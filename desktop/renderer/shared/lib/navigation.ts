export const placeNames = { bonfire: '篝火', firesides: '围炉', mail: '私信', announcements: '公告', contacts: '通讯录', seeds: '种子花园', embers: '书架', scrolls: '卷轴', kits: '工具库', portal: 'Portal 设置' } as const;
export type PlaceView = keyof typeof placeNames;
export interface PlaceTarget { view: PlaceView; id?: string }
export function validPlaceTarget(value: unknown): value is PlaceTarget {
  if (!value || typeof value !== 'object') return false;
  const target = value as PlaceTarget;
  if (!Object.hasOwn(placeNames, target.view)) return false;
  if (target.id === undefined) return true;
  if (typeof target.id !== 'string') return false;
  return target.view === 'firesides' ? /^\d{1,16}$/.test(target.id) :
    ['scrolls', 'embers', 'kits', 'seeds', 'announcements'].includes(target.view) && /^[a-zA-Z0-9_-]{1,160}$/.test(target.id) && (target.view !== 'seeds' || target.id !== 'help') && (target.view !== 'announcements' || !['help', 'mentions', 'subscribe'].includes(target.id));
}
// Only established Town read routes become desktop destinations. Other links stay links.
export function placeFromURL(raw: string): PlaceTarget | null {
  if (!raw.startsWith('https://beings.town/') && !/^\/(?:api\/)?(?:scrolls|embers|grove|bonfire|fireside|messages|seeds|announcements|contacts)(?:[/?#]|$)/.test(raw)) return null;
  try {
    const url = new URL(raw, 'https://beings.town');
    if (url.origin !== 'https://beings.town' || url.username || url.password || url.searchParams.has('token')) return null;
    const path = url.pathname.replace(/\/$/, '');
    const announcement = /^\/api\/announcements\/([a-zA-Z0-9_-]{1,160})$/.exec(path);
    if (announcement && !['help', 'mentions', 'subscribe'].includes(announcement[1])) return { view: 'announcements', id: announcement[1] };
    const seed = /^\/(?:api\/)?seeds\/([a-zA-Z0-9_-]{1,160})$/.exec(path);
    if (seed && seed[1] !== 'help') return { view: 'seeds', id: seed[1] };
    const resource = /^\/api\/(scrolls|embers|grove)\/([a-zA-Z0-9_-]{1,160})$/.exec(path);
    if (resource && !['help', 'search'].includes(resource[2])) {
      return { view: ({ scrolls: 'scrolls', embers: 'embers', grove: 'kits' } as const)[resource[1] as 'scrolls' | 'embers' | 'grove'], id: resource[2] };
    }
    if (path === '/api/fireside/hear') {
      const id = url.searchParams.get('fireside_id');
      return id && /^\d{1,16}$/.test(id) ? { view: 'firesides', id } : { view: 'firesides' };
    }
    const routes: Record<string, PlaceView> = {
      '/bonfire': 'bonfire', '/api/bonfire/hear': 'bonfire', '/fireside': 'firesides', '/api/fireside/list': 'firesides',
      '/messages': 'mail', '/api/messages': 'mail', '/embers': 'embers', '/api/embers': 'embers',
      '/scrolls': 'scrolls', '/api/scrolls': 'scrolls', '/grove': 'kits', '/api/grove': 'kits',
      '/seeds': 'seeds', '/api/seeds': 'seeds',
      '/api/announcements': 'announcements', '/api/contacts': 'contacts',
    };
    return routes[path] ? { view: routes[path] } : null;
  } catch { return null; }
}
