import { TownClient, townRoute } from '../desktop/main/town/client';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Catalog, CatalogDetail } from '../desktop/renderer/town/components/catalog';
import type { TownModel } from '../desktop/renderer/town/models/town';

function town(kit: Record<string, unknown>) {
  return {
    tab: 'grove', view: 'kits', selectedId: kit.id, installedLoading: false, installedError: '',
    supportsLocalKits: true,
    installedLibrary: { enabled: true, kits: [] }, installedKit: () => undefined,
    matches: () => true, directId: undefined, detailLoading: false, detailError: undefined,
    detail: { fragments: [kit], query: { kind: 'kit', id: kit.id } },
  } as unknown as TownModel;
}

describe('Grove catalog presentation', () => {
  it('renders the server growth stage, vitality, progress, adoption and linked experience', () => {
    const kit = {
      id: 'kit-1', name: 'hand', version: '6.9.0', kind: 'kit', status: 'growing',
      display_name: 'alice', description: 'A useful kit', adopter_count: 9, total_calls: 30,
      maturity: { progress: 0.37, progress_label: '已完成 1/4 项', vitality: 'active', vitality_label: '最近还在用' },
      seed_summaries: [{ id: 'seed-1', name: 'hand-perception-contract', domain: '实践' }],
      manifest: { tools: [] }, has_bundle: true,
    };
    const model = town(kit);
    const listing = renderToStaticMarkup(createElement(Catalog, { town: model, data: { kits: [kit] } }));
    expect(listing).toContain('🌿 成长中');
    expect(listing).toContain('9 beings 在用');
    expect(listing).toContain('aria-valuenow="37"');
    expect(listing).toContain('最近还在用');
    const detail = renderToStaticMarkup(createElement(CatalogDetail, { town: model }));
    expect(detail).toContain('hand-perception-contract');
    expect(detail).toContain('安装到本机');
  });

  it('distinguishes unmaintained kits and never offers App bundle installation', () => {
    const oldKit = { id: 'old', kind: 'kit', name: 'old-kit', status: 'unmaintained', version: '1.0' };
    expect(renderToStaticMarkup(createElement(Catalog, { town: town(oldKit), data: { kits: [oldKit] } }))).toContain('🥀 已停维护');
    const app = {
      id: 'app-1', name: 'voice-memo', version: '1.0', kind: 'app', status: 'sprouting',
      repo_url: 'https://github.com/example/voice-memo', release_tag: 'v1.0', has_bundle: true,
      manifest: { tools: [{ name: 'not-a-portal-tool' }] },
    };
    const markup = renderToStaticMarkup(createElement(CatalogDetail, { town: town(app) }));
    expect(markup).toContain('App ·');
    expect(markup).toContain('查看 App 仓库');
    expect(markup).not.toContain('安装到本机');
    expect(markup).not.toContain('not-a-portal-tool');
    const untrusted = renderToStaticMarkup(createElement(CatalogDetail, { town: town({ ...app, repo_url: 'https://github.com.evil.test/example/app' }) }));
    expect(untrusted).not.toContain('查看 App 仓库');
  });
});

it('reads public Grove comments without credentials and rejects invalid identifiers', async () => {
  expect(townRoute({ kind: 'kit-comments', id: 'kit-1' })).toEqual({ route: '/api/grove/kit-1/comments', private: false });
  expect(() => townRoute({ kind: 'kit-comments', id: '../token' })).toThrow();
  let headers: Headers | undefined;
  const client = new TownClient(() => 'private-token', async (_url, init) => {
    headers = new Headers(init?.headers);
    return Response.json({ comments: [], count: 0 });
  });
  expect((await client.query({ kind: 'kit-comments', id: 'kit-1' })).ok).toBe(true);
  expect(headers?.has('Authorization')).toBe(false);
});
it('places usage feedback before discussion and shows server evidence statistics', () => {
  const data = { id: 'kit-1', kind: 'kit', name: 'hand', seed_badge: 'backed',
    success_count: 19, failure_count: 1, success_rate: 0.95, feedback_count: 1,
    seeds: [{ id: 'feedback-1', domain: 'grove-feedback', brief_excerpt: '冷启动需要等待', display_name: '读者' }] };
  const html = renderToStaticMarkup(createElement(CatalogDetail, { town: town(data) }));
  expect(html).toContain('有经验背书');
  expect(html).toContain('95.0%');
  expect(html).toContain('冷启动需要等待');
  expect(html.indexOf('使用者反馈')).toBeLessThan(html.indexOf('补充讨论'));
});
