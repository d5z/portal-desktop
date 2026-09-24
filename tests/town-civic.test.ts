import { describe, expect, it, vi } from 'vitest';
import { TownClient, townRoute } from '../desktop/shared/town-client';
import type { DesktopAPI, TownQuery, TownResult } from '../desktop/shared/types';
import { TownModel } from '../desktop/renderer/town/models/town';
import { SceneStore } from '../desktop/renderer/shared/models/scene';
import { placeFromURL, validPlaceTarget } from '../desktop/renderer/shared/lib/navigation';
import { registerTownIpc, type TownIpcOptions } from '../desktop/main/town/ipc';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { Town } from '../desktop/renderer/town/page';

vi.mock('../desktop/renderer/shared/hooks/use-model', () => ({ useModel: (model: unknown) => model }));

const success = (data: Record<string, unknown>): TownResult => ({ ok: true, data, fetchedAt: '2026-09-24T00:00:00Z' });
const notice = { id: 'notice_1', title: '小镇更新', content: '**欢迎**', display_name: '同名 Being', category: 'update', pinned: true, expires_at: null };
function model(query: DesktopAPI['town']) {
  return new TownModel({ town: query, townAuth: async () => ({ configured: false }) } as DesktopAPI, vi.fn(), vi.fn(), new SceneStore(), vi.fn(), vi.fn());
}

describe('Town civic public API', () => {
  it('uses public reads, server category/history filters and real pagination', async () => {
    const fetcher = vi.fn(async () => Response.json({ items: [notice], count: 1, total: 25 }));
    const client = new TownClient(() => 'private-pairing-token', fetcher as typeof fetch);
    await client.query({ kind: 'announcements', category: 'update', includeExpired: true, offset: 24 });
    await client.query({ kind: 'announcement', id: 'notice_1' });
    await client.query({ kind: 'contacts' });
    const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([url]) => new URL(url).pathname)).toEqual(['/api/announcements', '/api/announcements/notice_1', '/api/contacts']);
    expect(Object.fromEntries(new URL(calls[0][0]).searchParams)).toEqual({ limit: '24', offset: '24', category: 'update', include_expired: 'true' });
    for (const [, init] of calls) {
      expect(init).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'error', headers: { Accept: 'application/json' } });
      expect(JSON.stringify(init)).not.toContain('private-pairing-token');
    }
  });
  it.each([
    { kind: 'announcements', category: 'bad' }, { kind: 'announcements', includeExpired: 'true' },
    { kind: 'announcements', offset: -1 }, { kind: 'announcement', id: '../messages' },
    ...['help', 'subscribe', 'mentions', 'id?token=secret'].map(id => ({ kind: 'announcement', id })),
  ])('rejects malformed requests %j', query => expect(() => townRoute(query as TownQuery)).toThrow());

  it('routes public announcement links without turning management routes into details', () => {
    expect(placeFromURL('https://beings.town/api/announcements/notice_1')).toEqual({ view: 'announcements', id: 'notice_1' });
    expect(placeFromURL('/api/contacts')).toEqual({ view: 'contacts' });
    expect(validPlaceTarget({ view: 'announcements', id: 'notice_1' })).toBe(true);
    expect(validPlaceTarget({ view: 'contacts', id: 'someone' })).toBe(false);
    for (const id of ['help', 'mentions', 'subscribe']) {
      expect(validPlaceTarget({ view: 'announcements', id })).toBe(false);
      expect(placeFromURL('/api/announcements/' + id)).toBeNull();
    }
    expect(placeFromURL('https://beings.town/api/announcements/x?token=secret')).toBeNull();
  });
  it('allows opening verified detail URLs and rejects path/query injection', async () => {
    const handlers = new Map<string, (...args: any[]) => any>();
    const open = vi.fn();
    registerTownIpc({ handle: (name: string, callback: (...args: any[]) => any) => handlers.set(name, callback), open } as unknown as TownIpcOptions);
    const action = handlers.get('beings:town-open')!;
    await action('/api/announcements/notice_1');
    expect(open).toHaveBeenCalledWith('https://beings.town/api/announcements/notice_1');
    for (const route of ['/api/announcements/../messages', '/api/announcements/x?token=secret', '//evil.test/']) await expect(action(route)).rejects.toThrow();
  });
});

describe('Town civic rendering and state', () => {
  it('loads both pinned and ordinary active notices independently from the bonfire', async () => {
    let fail = false;
    const query = vi.fn(async (query: TownQuery): Promise<TownResult> => query.kind === 'bonfire' ? success({ messages: [] }) : fail
      ? { ok: false, code: 'network', message: 'offline' }
      : success({ items: [notice, { ...notice, id: 'expired', expires_at: '2020-01-01T00:00:00Z' }, { ...notice, id: 'unpinned', pinned: false }] }));
    const town = model(query);
    town.show('bonfire');
    await vi.waitFor(() => expect(town.bonfireAnnouncements).toEqual([notice, { ...notice, id: 'unpinned', pinned: false }]));
    fail = true;
    await town.load(true);
    expect(town.error).toBeUndefined();
    expect(town.data).toEqual({ messages: [] });
    expect(town.announcementsError).toBe('offline');
    expect(town.bonfireAnnouncements).toEqual([notice, { ...notice, id: 'unpinned', pinned: false }]);
  });
  it('selects the clicked notice inside the list after navigation, clearing earlier filters', async () => {
    const query = vi.fn(async (query: TownQuery) => success(query.kind === 'announcement' ? notice : { items: [notice], total: 1 }));
    const town = model(query);
    town.view = 'bonfire';
    town.announcementCategory = 'rule';
    town.tabs.announcements = 'history';
    town.search = 'old filter';
    town.openAnnouncements(notice.id);
    expect(town.navigate).toHaveBeenCalledWith('announcements');
    // The Web shell applies navigation asynchronously; select only after its list loads.
    town.show('announcements');
    await vi.waitFor(() => expect(town.detail?.query.id).toBe(notice.id));
    expect(town.directId).toBeUndefined();
    expect(town.selectedId).toBe(notice.id);
    expect(town.search).toBe('');
    expect(town.data?.items).toEqual([notice]);
    expect(query).toHaveBeenCalledWith({ kind: 'announcements', offset: 0, category: '', includeExpired: false });
    expect(town.returnView).toBe('bonfire');
  });
  it('renders both new list shapes without falling through to the scrolls renderer', async () => {
    const query = vi.fn(async (query: TownQuery) => success(query.kind === 'contacts' ? { count: 1, entries: [{ town_id: 't_ExactID', display_name: '小河', human_name: '伙伴', note: '<img onerror=alert(1)>' }] } : { count: 1, total: 30, items: [notice] }));
    const town = model(query);
    town.show('announcements');
    await vi.waitFor(() => expect(town.loading).toBe(false));
    let html = renderToStaticMarkup(createElement(Town, { model: town }));
    expect(html).toContain('小镇更新');
    expect(html).toContain('共 30 项');
    town.offset = 24;
    town.selectTab('history');
    await vi.waitFor(() => expect(town.loading).toBe(false));
    expect(query).toHaveBeenLastCalledWith({ kind: 'announcements', offset: 0, category: '', includeExpired: true });
    town.show('contacts');
    await vi.waitFor(() => expect(town.loading).toBe(false));
    html = renderToStaticMarkup(createElement(Town, { model: town }));
    expect(html).toContain('人类伙伴');
    expect(html).not.toContain('<img onerror');
    expect(html).not.toContain('下一页');
    town.setSearch('无匹配');
    expect(renderToStaticMarkup(createElement(Town, { model: town }))).toContain('没有找到匹配');
  });
  it('opens direct details, keeps content after failed refresh, and reports invalid list data', async () => {
    let fail = false;
    const query = vi.fn(async (): Promise<TownResult> => fail ? { ok: false, code: 'network', message: 'offline' } : success(notice));
    const town = model(query);
    town.show('announcements', 'notice_1');
    await vi.waitFor(() => expect(town.detail?.fragments[0].title).toBe('小镇更新'));
    expect(query).toHaveBeenCalledWith({ kind: 'announcement', id: 'notice_1' });
    fail = true;
    await town.load(true);
    expect(town.detail?.fragments[0].title).toBe('小镇更新');
    expect(town.refreshError).toContain('offline');
    const broken = model(async () => success({ entries: null }));
    broken.show('contacts');
    await vi.waitFor(() => expect(broken.error?.message).toContain('列表格式不正确'));
  });
  it('uses exact Town IDs for DM drafts and protects separate recipients and identities', () => {
    const town = model(async () => success({ entries: [] }));
    town.view = 'contacts';
    town.live = { phase: 'connected', beingId: 't_Self', generation: 1, revision: 1, sync: 0, message: '', versions: { mail: 0, bonfire: 0, firesides: 0 } };
    town.compose(undefined, 't_First');
    expect(town.sendTarget?.kind).toBe('dm');
    expect(town.recipient).toBe('t_First');
    town.content = 'first draft';
    town.compose(undefined, 't_Second');
    expect(town.content).toBe('');
    town.compose(undefined, 't_First');
    expect(town.content).toBe('first draft');
    town.sendOpen = false;
    town.compose(undefined, 't_Self');
    expect(town.sendOpen).toBe(false);
    town.live.phase = 'unpaired';
    town.compose(undefined, 't_Second');
    expect(town.sendOpen).toBe(false);
  });
  it('prepares a guarded human-partner declaration and waits for draft acknowledgement without changing data locally', async () => {
    const post = vi.fn(), navigate = vi.fn(), scenes = new SceneStore();
    scenes.configure('willow', 'https://example.test/willow');
    const town = new TownModel({} as DesktopAPI, vi.fn(), navigate, scenes, vi.fn(), post);
    town.live = { phase: 'connected', beingId: 't_Self', display: '柳树', generation: 1, revision: 1, sync: 0, message: '', versions: { mail: 0, bonfire: 0, firesides: 0 } };
    const draft = town.prepareContactDeclaration('小叶', '一起探索世界', 't_Self');
    const message = post.mock.calls[0][0];
    expect(message.type).toBe('beings:scene-draft');
    expect(message.text).toContain('t_Self');
    expect(message.text).toContain('如果不一致，请不要执行');
    expect(message.text).toContain('POST https://beings.town/api/contacts');
    expect(message.text).toContain('"human_name":"小叶","note":"一起探索世界"');
    expect(message.text).not.toContain('/api/me/display-name');
    expect(navigate).not.toHaveBeenCalled();
    expect(town.receiveContactDraft({ type: 'beings:scene-draft-result', id: 'unrelated', ok: true })).toBe(false);
    town.receiveContactDraft({ type: 'beings:scene-draft-result', id: message.id, ok: true });
    await draft;
    expect(navigate).toHaveBeenCalledWith('chat');
    expect(town.live.display).toBe('柳树');
    const rejected = town.prepareContactDeclaration('小叶', '', 't_Self');
    expect(post.mock.calls.at(-1)![0].text).toContain('"note":""');
    town.receiveContactDraft({ type: 'beings:scene-draft-result', id: post.mock.calls.at(-1)![0].id, ok: false });
    await expect(rejected).rejects.toThrow('草稿');
    await expect(town.prepareContactDeclaration(' ', '', 't_Self')).rejects.toThrow('1–60');
    await expect(town.prepareContactDeclaration('人'.repeat(61), '', 't_Self')).rejects.toThrow('1–60');
    await expect(town.prepareContactDeclaration('小叶', '注'.repeat(201), 't_Self')).rejects.toThrow('200');
    await expect(town.prepareContactDeclaration('别人的伙伴', '', 't_Other')).rejects.toThrow('身份已变化');
  });
});
