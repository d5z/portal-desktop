import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TownModel } from '../desktop/renderer/town/models/town';
import { SceneStore } from '../desktop/renderer/shared/models/scene';
import { Pagination } from '../desktop/renderer/town/components/catalog';
import { collectTownPages, paginate } from '../desktop/renderer/town/models/pagination';
import type { DesktopAPI, TownQuery, TownResult } from '../desktop/shared/types';

const ok = (data: Record<string, unknown>): TownResult => ({ ok: true, data, fetchedAt: '2026-10-09T00:00:00Z' });
function fixture(read: DesktopAPI['town']) {
  return new TownModel({ town: read, townAuth: async () => ({ configured: false }) } as DesktopAPI,
    () => {}, () => {}, new SceneStore(), () => {}, () => {});
}

describe('filtered Town pagination', () => {
  it('searches remote metadata after merging local tools and searches plugin authors', () => {
    const town = fixture(async () => ok({ kits: [] }));
    town.view = 'kits'; town.tab = 'grove';
    town.data = { kits: [{ id: 'app-1', name: 'Remote name', kind: 'app', title: 'Remote title',
      description: 'Remote description', display_name: 'River', being_id: 't_author', status: 'grown',
      tags: ['automation', { name: 'productivity' }] }] };
    town.localApps = [{ id: 'app-1', name: 'Local name', path: '/app', exists: true }];
    town.plugins = { library: { plugins: [{ manifest: { id: 'board', name: 'Board', description: '', author: 'Willow' },
      source: { kind: 'local' } }] } } as any;
    for (const query of ['Remote name', 'Remote title', 'Remote description', 'River', 't_author', 'grown', 'automation', 'productivity']) {
      town.setSearch(query);
      expect(town.pagination().items.map(item => item.key), query).toEqual(['app:app-1']);
    }
    town.setSearch('Willow');
    expect(town.pagination().items.map(item => item.key)).toEqual(['plugin:board']);
  });
  it.each([['kits', 'grove', 'kits'], ['embers', 'embers', 'scrolls'], ['scrolls', 'scrolls', 'scrolls'],
    ['announcements', 'announcements', 'items'], ['seeds', 'seeds', 'seeds']])('uses the same collection for the %s list, pages and total', async (view, kind, key) => {
    const all = Array.from({ length: 27 }, (_, i) => ({ id: String(i), name: `entry-${i}`, title: `entry-${i}` }));
    const read = vi.fn(async (q: TownQuery) => ok({ [key]: all.slice(q.offset, (q.offset || 0) + 24), count: 27 }));
    const town = fixture(read); town.view = view; town.tab = kind; town.visible = true;
    await town.load();
    expect(read.mock.calls.map(([q]) => q.offset)).toEqual([0, 24]);
    expect(town.pagination()).toMatchObject({ total: 27, pages: 2, page: 1 });
    town.turnPage(1);
    expect(town.pagination()).toMatchObject({ total: 27, pages: 2, page: 2 });
    expect(town.pagination().items).toHaveLength(3);
    expect(read).toHaveBeenCalledTimes(2); // Client paging does not reload a different server slice.
    const html = renderToStaticMarkup(createElement(Pagination, { town }));
    expect(html).toContain('第 2 / 2 页'); expect(html).toContain('<small class="pagination-total">共 27 项</small>');
    if (view !== 'seeds') {
      town.setSearch('entry-26');
      expect(town.offset).toBe(0);
      expect(town.pagination()).toMatchObject({ total: 1, pages: 1, page: 1 });
      town.setSearch('no-match');
      expect(town.pagination()).toMatchObject({ total: 0, pages: 0, page: 0 });
      expect(renderToStaticMarkup(createElement(Pagination, { town }))).toContain('共 0 项');
    }
  });
  it('counts a local Plugin once after merging with a matching remote entry on page two', async () => {
    const all = [...Array.from({ length: 26 }, (_, i) => ({ id: String(i), name: `kit-${i}`, kind: 'kit' })),
      { id: 'board', name: 'Board', kind: 'app', tags: ['plugin'] }];
    const town = fixture(async q => ok({ kits: all.slice(q.offset, (q.offset || 0) + 24), count: 27 }));
    town.plugins = { library: { plugins: [{ manifest: { id: 'example.board', name: 'Board', description: '' }, source: { kind: 'grove', id: 'board' } }] }, refresh: async () => {} } as any;
    town.view = 'kits'; town.tab = 'grove'; town.visible = true;
    await town.load(); town.groveKind = 'plugin'; town.offset = 24;
    expect(town.pagination()).toMatchObject({ total: 1, pages: 1, page: 1, offset: 0 });
    expect(town.pagination().items[0]).toMatchObject({ local: true, remote: { id: 'board' } });
    town.localOnly = true;
    expect(town.pagination().total).toBe(1);
  });
  it('does not replace a complete list with a partial refresh when a later page fails', async () => {
    const all = Array.from({ length: 25 }, (_, i) => ({ id: String(i) })); let fail = false;
    const town = fixture(async q => fail && q.offset ? { ok: false, code: 'network', message: 'offline' } : ok({ scrolls: all.slice(q.offset, (q.offset || 0) + 24), total: 25 }));
    town.view = 'embers'; town.tab = 'embers'; town.visible = true;
    await town.load(); const data = town.data;
    fail = true; await town.load(true);
    expect(town.data).toBe(data); expect(town.refreshError).toContain('offline');
  });
  it('stops reading after cancellation and detects servers repeating the same page', async () => {
    const page = Array.from({ length: 24 }, (_, id) => ({ id })); let active = true;
    const read = vi.fn(async () => { active = false; return ok({ kits: page, count: 100 }); });
    await expect(collectTownPages({ kind: 'grove' }, read, () => active)).rejects.toThrow('取消');
    expect(read).toHaveBeenCalledTimes(1);
    const repeated = vi.fn(async () => ok({ kits: page, count: 100 }));
    await expect(collectTownPages({ kind: 'grove' }, repeated, () => true)).rejects.toThrow('重复分页');
    expect(repeated).toHaveBeenCalledTimes(2);
  });
  it('clamps an outdated page after removing entries and has no phantom page for zero results', () => {
    expect(paginate([1], 624)).toMatchObject({ total: 1, page: 1, pages: 1, offset: 0 });
    expect(paginate([], 24)).toMatchObject({ total: 0, page: 0, pages: 0, offset: 0 });
  });
});
