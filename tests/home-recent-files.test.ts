import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeRecentFiles, homeRecentFiles } from '../desktop/renderer/app/models/home-recent-files';
import { HomeLibrary } from '../desktop/renderer/app/models/home-library';
import type { HomeState, HomeFilePreview } from '../desktop/shared/home';

const state: HomeState = { authenticated: true, authenticating: false, username: 'one', binding: 'matched', viewer: 'closed' };
const file = { path: 'artifacts/intro.txt', name: 'intro.txt', size: 4, type: 'file' as const };
beforeEach(() => {
  const saved = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) });
  homeRecentFiles.setIdentity({ ...state, authenticated: false });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('recent Home files', () => {
  it('deduplicates, sorts by last open, and persists removal per account', () => {
    const recent = new HomeRecentFiles(); recent.setIdentity(state);
    recent.record(file); recent.record({ ...file, path: 'two.txt' }); recent.record(file);
    expect(recent.entries.map(entry => entry.path)).toEqual([file.path, 'two.txt']);
    recent.remove(file.path);
    const restored = new HomeRecentFiles(); restored.setIdentity(state);
    expect(restored.entries.map(entry => entry.path)).toEqual(['two.txt']);
    restored.setIdentity({ ...state, username: 'other' });
    expect(restored.entries).toEqual([]);
    restored.setIdentity(state); expect(restored.entries).toHaveLength(1);
    restored.setIdentity({ ...state, binding: 'mismatch' }); expect(restored.entries).toEqual([]);
  });
  it('bounds persisted history and ignores malformed stored entries', () => {
    const recent = new HomeRecentFiles(); recent.setIdentity(state);
    for (let index = 0; index < 40; index++) recent.record({ ...file, path: `${index}.txt` });
    expect(recent.entries).toHaveLength(30); expect(recent.entries[0].path).toBe('39.txt');
    localStorage.setItem('beings:recent-home-files:other', JSON.stringify({entries:[null,{path:3},{...file,openedAt:1}]}));
    recent.setIdentity({ ...state, username: 'other' }); expect(recent.entries).toHaveLength(1);
  });
  it('shares successful opens across preview models, without tracking failures or stale responses', async () => {
    homeRecentFiles.setIdentity(state);
    let finish!: (file: HomeFilePreview) => void;
    const preview = vi.fn<() => Promise<HomeFilePreview>>(async () => ({...file, bytes: new Uint8Array(4)}));
    const model = new HomeLibrary({preview, list:vi.fn(), download:vi.fn()});
    await model.open(file); expect(homeRecentFiles.entries[0].path).toBe(file.path);
    homeRecentFiles.remove(file.path);
    preview.mockRejectedValueOnce(new Error('not found'));
    await model.open(file); expect(homeRecentFiles.entries).toEqual([]);
    preview.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = model.open(file); model.reset(); homeRecentFiles.setIdentity({ ...state, username: 'other' });
    finish({...file, bytes:new Uint8Array(4)}); await pending;
    expect(homeRecentFiles.entries).toEqual([]);
  });
});
