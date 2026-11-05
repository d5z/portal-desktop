import type { HomeFileEntry, HomeState } from '../../../shared/home';
import { Store } from '../../shared/models/store';

type LocalEntry = { path: string; name: string };
export type RecentFile = { openedAt: number } & (
  { source: 'cloud' } & HomeFileEntry | { source: 'local' } & LocalEntry
);

/** Local history is device-wide; cloud history remains isolated by Home account. */
export class HomeRecentFiles extends Store {
  entries: RecentFile[] = [];
  private account?: string;
  private initialized = false;

  setIdentity(state: HomeState) {
    const account = state.authenticated && !state.authenticating && state.binding === 'matched' ? state.username : undefined;
    if (this.initialized && account === this.account) return;
    this.account = account;
    this.entries = [];
    for (const source of ['local', 'cloud'] as const) {
      if (source === 'cloud' && !account) continue;
      const key = source === 'local' ? 'beings:recent-local-files' : `beings:recent-home-files:${account}`;
      try {
        const saved = JSON.parse(localStorage.getItem(key) || 'null');
        if (Array.isArray(saved?.entries)) {
          for (const entry of saved.entries) {
            if (!entry || typeof entry.path !== 'string' || typeof entry.name !== 'string' ||
                typeof entry.openedAt !== 'number' || !Number.isFinite(entry.openedAt)) continue;
            if (source === 'cloud' && (entry.type !== 'file' || typeof entry.size !== 'number' || !Number.isFinite(entry.size) || entry.size < 0)) continue;
            this.entries.push({ ...entry, source });
          }
        }
      } catch { /* Optional local history. */ }
    }
    this.entries.sort((a, b) => b.openedAt - a.openedAt);
    this.entries = this.entries.slice(0, 30);
    this.initialized = true;
    this.changed();
  }

  record(entry: HomeFileEntry) {
    if (!this.account) return;
    this.add({ ...entry, source: 'cloud', openedAt: Date.now() });
  }

  recordLocal(entry: LocalEntry) {
    if (!this.initialized) this.setIdentity({ authenticated: false, authenticating: false, viewer: 'closed' });
    this.add({ path: entry.path, name: entry.name, source: 'local', openedAt: Date.now() });
  }

  private add(entry: RecentFile) {
    this.entries = [entry, ...this.entries.filter(file => file.path !== entry.path || file.source !== entry.source)].slice(0, 30);
    this.save(entry.source);
  }

  remove(path: string, source: RecentFile['source'] = 'cloud') {
    this.entries = this.entries.filter(file => file.path !== path || file.source !== source);
    this.save(source);
  }

  private save(source: RecentFile['source']) {
    const key = source === 'local' ? 'beings:recent-local-files' : `beings:recent-home-files:${this.account}`;
    try { localStorage.setItem(key, JSON.stringify({ entries: this.entries.filter(file => file.source === source) })); }
    catch { /* Keep history usable when local storage is unavailable. */ }
    this.changed();
  }
}

export const homeRecentFiles = new HomeRecentFiles();
