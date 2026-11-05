import type { HomeFileEntry, HomeState } from '../../../shared/home';
import { Store } from '../../shared/models/store';

type RecentFile = HomeFileEntry & { openedAt: number };

/** Shared by conversation previews and the library; metadata stays on this device. */
export class HomeRecentFiles extends Store {
  entries: RecentFile[] = [];
  private account?: string;

  setIdentity(state: HomeState) {
    const account = state.authenticated && !state.authenticating && state.binding === 'matched' ? state.username : undefined;
    if (account === this.account) return;
    this.account = account; this.entries = [];
    if (account) {
      try {
        const saved = JSON.parse(localStorage.getItem(`beings:recent-home-files:${account}`) || 'null');
        if (saved) {
          if (Array.isArray(saved.entries)) this.entries = saved.entries.filter((entry: unknown): entry is RecentFile => {
            if (!entry || typeof entry !== 'object') return false;
            const file = entry as Partial<RecentFile>;
            return file.type === 'file' && typeof file.path === 'string' && typeof file.name === 'string' &&
              typeof file.size === 'number' && Number.isFinite(file.size) && file.size >= 0 &&
              typeof file.openedAt === 'number' && Number.isFinite(file.openedAt);
          }).slice(0, 30);
        }
      } catch { /* Optional local history. */ }
    }
    this.changed();
  }

  record(entry: HomeFileEntry) {
    if (!this.account) return;
    this.entries = [{ ...entry, openedAt: Date.now() }, ...this.entries.filter(file => file.path !== entry.path)].slice(0, 30);
    this.save();
  }

  remove(path: string) {
    this.entries = this.entries.filter(file => file.path !== path);
    this.save();
  }

  private save() {
    if (this.account) {
      try { localStorage.setItem(`beings:recent-home-files:${this.account}`, JSON.stringify({ entries: this.entries })); }
      catch { /* Keep history usable when local storage is unavailable. */ }
    }
    this.changed();
  }
}

export const homeRecentFiles = new HomeRecentFiles();
