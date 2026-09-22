// Public reading fixtures only; no live planting, forking or absorption writes.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const queries = [];
const seeds = Array.from({ length: 26 }, (_, index) => ({
  id: 'seed-' + index, name: index === 0 ? 'Portal 连接排障' : '经验种子 ' + (index + 1),
  display_name: index === 0 ? '河流' : '柳树', town_id: 't_PrivateId', domain: index === 0 ? '连接诊断' : '协作',
  brief_excerpt: '先确认连接状态，再检查当前进程，避免重复执行。',
  brief: '## 先确认现场\n\n**先检查状态**，再决定是否重试。\n\n<img src=x onerror="window.seedPwned=true">',
  tags: ['可靠性'], kits: ['portal'], lifecycle: 'seed', revision: 1, absorb_count: 2,
  created_at: '2026-09-14T00:00:00Z', updated_at: '2026-09-14T00:00:00Z',
  skeleton: [{ cmd_path: 'portal_process', exec: 10, ok_pct: 90, observations: ['检查副作用之后再决定重试。'] }],
}));
const { outputFiles } = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'seed-garden-fixture.tsx', contents: `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { Town } from './desktop/renderer/town/page';
  import { Dialog } from './desktop/renderer/shared/components/dialog';
  import { PlaceHeading } from './desktop/renderer/app/components/navigation';
  import { useModel } from './desktop/renderer/shared/hooks/use-model';
  import { TownModel } from './desktop/renderer/town/models/town';
  import { SceneStore } from './desktop/renderer/shared/models/scene';
  const scenes = new SceneStore();
  const town = new TownModel({
    town: async query => {
      const result = await (await fetch('/query', { method: 'POST', body: JSON.stringify(query) })).json();
      if (window.holdRefresh) await new Promise(resolve => { window.pendingRefresh = resolve; });
      return window.failRefresh ? { ok: false, code: 'network', message: '测试超时' } : result;
    },
    townAuth: async () => ({ configured: false }),
    copyText: async value => { window.copiedSeedLink = value; },
    openTownLink: async value => { window.openedSeedLink = value; },
  }, () => {}, view => town.show(view), scenes, () => {}, () => {});
  window.seedTown = town;
  function Fixture() {
    useModel(town);
    return <Dialog id="place-sheet" aria-labelledby="view-title" open onClose={() => {}}>
      <PlaceHeading view={town.view} navigate={town.navigate} /><Town model={town} />
    </Dialog>;
  }
  createRoot(document.getElementById('root')).render(<Fixture />);
  town.show('town');
` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic' });
const css = await readFile('desktop/renderer/app/styles.css', 'utf8');
const server = createServer(async (request, response) => {
  if (request.url === '/query') {
    let body = ''; for await (const chunk of request) body += chunk;
    const query = JSON.parse(body); queries.push(query);
    let data;
    if (query.kind === 'home') data = { services: { '🌱 seed garden': { what: '种下经验，少走弯路。', help: 'GET /api/seeds/help' } }, whats_new: [], version: 'fixture' };
    else if (query.kind === 'seeds') {
      const matches = seeds.filter(seed => (!query.q || (seed.name + seed.brief).includes(query.q)) && (!query.kit || seed.kits.includes(query.kit)) && (!query.tag || seed.tags.includes(query.tag)) && (!query.domain || seed.domain === query.domain));
      data = { seeds: matches.slice(query.offset || 0, (query.offset || 0) + 24), count: matches.length };
    } else if (query.kind === 'seed') data = seeds.find(seed => seed.id === query.id);
    else if (query.kind === 'bonfire') {
      const revision = queries.filter(query => query.kind === 'bonfire').length;
      await new Promise(resolve => setTimeout(resolve, 150));
      data = { messages: [{ seq: revision, sender: '河流', content: '篝火内容 · 第 ' + revision + ' 次读取', created_at: '2026-09-14T00:00:00Z' }] };
    }
    else if (query.kind === 'firesides') data = { owned: [{ id: '1', name: '测试围炉' }], joined: [] };
    else if (query.kind === 'fireside') data = { messages: [{ seq: 1, sender: '柳树', content: '围炉的新消息', created_at: '2026-09-14T00:00:00Z' }] };
    else if (['inbox', 'sent'].includes(query.kind)) data = { messages: [] };
    else if (query.kind === 'embers') data = { scrolls: [{ id: 'book-1', title: '测试书籍', display_name: '河流' }], total: 1 };
    else if (query.kind === 'ember') data = { id: 'book-1', title: '测试书籍', content: '书籍正文', display_name: '河流' };
    else if (query.kind === 'grove') data = { kits: [], total: 0 };
    else if (query.kind === 'scrolls') data = { scrolls: [{ id: 'scroll-1', title: '卷轴排版参考', display_name: '河流', kind: 'note', visibility: 'public', lifecycle: 'verified' }], total: 1 };
    else if (query.kind === 'scroll') data = { id: 'scroll-1', title: '卷轴排版参考', display_name: '河流', content: '卷轴正文', kind: 'note', visibility: 'public', lifecycle: 'verified', updated_at: '2026-09-14T00:00:00Z' };
    else if (query.kind === 'seed-lineage') data = { ancestors: [{ id: 'seed-1', name: '前一颗经验' }], descendants: [] };
    else if (query.kind === 'seed-absorbs') data = { count: 2, absorbs: [
      { display_name: '河流', town_id: 't_Hidden', absorbed_at: '2026-09-14T01:00:00Z' },
      { display_name: '河流', town_id: 't_Hidden', absorbed_at: '2026-09-14T02:00:00Z' },
    ] };
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(data ? { ok: true, data, fetchedAt: new Date().toISOString() } : { ok: false, code: 'not-found', message: '种子不存在' }));
  } else {
    response.setHeader('Content-Type', request.url === '/fixture.js' ? 'text/javascript' : 'text/html; charset=utf-8');
    response.end(request.url === '/fixture.js' ? outputFiles[0].text : `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script></html>`);
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  const page = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const verifyRefresh = async (selectors, label) => {
    for (const failure of [false, true]) {
      await page.evaluate(({ selectors, failure }) => {
        window.refreshNodes = selectors.map(selector => document.querySelector(selector));
        window.holdRefresh = true;
        window.failRefresh = failure;
        window.pendingRefresh = undefined;
      }, { selectors, failure });
      await page.locator('#town-refresh').click();
      await page.waitForFunction(() => Boolean(window.pendingRefresh));
      assert.equal(await page.locator('#town-body > #town-refresh-indicator .startup-spinner').isVisible(), true);
      assert.equal(await page.evaluate(selectors => selectors.every((selector, index) => document.querySelector(selector) === window.refreshNodes[index]), selectors), true);
      if (await page.locator('#town-pagination button').count())
        assert.equal(await page.locator('#town-pagination button').evaluateAll(buttons => buttons.every(button => button.disabled)), true);
      await mkdir('test-results', { recursive: true });
      if (!failure) await page.screenshot({ path: `test-results/${label}-refresh.png` });
      await page.evaluate(() => { window.holdRefresh = false; window.pendingRefresh(); });
      await page.waitForFunction(() => !window.seedTown.loading && !window.seedTown.detailLoading);
      assert.equal(await page.locator('#town-refresh-indicator').count(), 0);
      assert.equal(await page.evaluate(selectors => selectors.every((selector, index) => document.querySelector(selector) === window.refreshNodes[index]), selectors), true);
      if (failure) assert.match(await page.locator('#town-status').innerText(), /刷新失败，仍显示上次内容/);
      await page.evaluate(() => { window.failRefresh = false; });
    }
  };
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('.service-card').filter({ has: page.getByRole('heading', { name: '种子花园 · Seed Garden', exact: true }) }).getByRole('button', { name: '打开', exact: true }).click();
  await page.getByText('26 颗种子', { exact: true }).waitFor();
  assert.equal(await page.locator('.catalog-item').count(), 24);
  await page.getByRole('button', { name: '下一页 →' }).click();
  await page.getByText('第 2 页 · 共 26 项').waitFor();
  assert.equal(await page.locator('.catalog-item').count(), 2);
  await page.getByRole('searchbox', { name: '搜索种子' }).fill('Portal');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByText('1 颗种子', { exact: true }).waitFor();
  assert.equal(queries.at(-1).q, 'Portal'); assert.equal(queries.at(-1).offset, 0);
  await page.locator('.catalog-item').click();
  await page.locator('.seed-detail .reading-title').getByText('Portal 连接排障', { exact: true }).waitFor();
  await verifyRefresh(['.catalog-item', '.seed-detail .reading-title', '.seed-detail .reading-text'], 'seed-garden');
  assert.equal(await page.evaluate(() => window.seedPwned), undefined);
  assert.doesNotMatch(await page.locator('.seed-detail').innerText(), /t_PrivateId/);
  assert.equal(queries.some(query => query.kind === 'seed-lineage'), false);
  await page.getByRole('button', { name: '一起看', exact: true }).click();
  assert.equal(await page.evaluate(() => window.seedTown.scenes.reference.selection.private), false);
  await page.getByRole('button', { name: '复制链接', exact: true }).click();
  assert.equal(await page.evaluate(() => window.copiedSeedLink), 'https://beings.town/seeds/seed-0');
  await page.getByRole('button', { name: '浏览器打开 ↗', exact: true }).click();
  assert.equal(await page.evaluate(() => window.openedSeedLink), '/seeds/seed-0');
  const actionLayout = () => page.locator('.reading-actions button').evaluateAll(buttons => buttons.map(button => {
    const rect = button.getBoundingClientRect(); return { x: rect.x, y: rect.y, right: rect.right, height: rect.height };
  }));
  const seedActions = await actionLayout();
  assert.equal(seedActions.length, 2);
  assert.equal(seedActions[0].y, seedActions[1].y);
  assert.equal(seedActions[0].height, seedActions[1].height);
  assert.equal(seedActions[1].x - seedActions[0].right, 8, 'Seed link buttons stay grouped');
  await page.getByText('内化记录', { exact: true }).click();
  await page.getByText('共 2 次内化', { exact: true }).waitFor();
  assert.equal(await page.locator('.seed-extra[open] p').count(), 3);
  assert.doesNotMatch(await page.locator('.seed-extra[open]').innerText(), /t_Hidden/);
  await page.getByText('派生关系', { exact: true }).click();
  await page.getByRole('button', { name: '前一颗经验 →' }).waitFor();
  await mkdir('test-results', { recursive: true });
  await page.locator('#town-view, .seed-detail').evaluateAll(elements => elements.forEach(el => { el.scrollTop = 0; }));
  await page.screenshot({ path: 'test-results/seed-garden.png', animations: 'disabled' });
  await page.getByRole('button', { name: '前一颗经验 →' }).click();
  await page.locator('.seed-detail .reading-title').getByText('经验种子 2', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'portal →', exact: true }).click();
  await page.getByText('portal · 经验墙', { exact: true }).waitFor();
  assert.equal(queries.at(-1).kit, 'portal');
  await page.locator('.seed-filter-menu > summary').click();
  await page.getByRole('textbox', { name: '领域', exact: true }).fill('连接诊断');
  await page.getByRole('button', { name: '应用筛选' }).click();
  await page.getByText('1 颗种子', { exact: true }).waitFor();
  assert.equal(queries.at(-1).domain, '连接诊断');
  await page.getByRole('searchbox', { name: '搜索种子' }).fill('没有这样的种子');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByText('这里还没有种子', { exact: true }).waitFor();
  await page.getByRole('button', { name: '清除筛选' }).click();
  await page.getByText('26 颗种子', { exact: true }).waitFor();

  const nav = page.getByRole('navigation', { name: '小镇功能切换' });
  await page.locator('#place-sheet').evaluate(el => { window.originalSheet = el; });
  const switchTo = async (label, title, kind) => {
    const before = queries.filter(query => query.kind === kind).length;
    await nav.getByRole('button', { name: label, exact: true }).click();
    await page.waitForFunction(() => !window.seedTown.loading);
    assert.equal(await page.locator('#view-title').innerText(), title);
    assert.equal(await nav.locator('[aria-current="page"]').innerText(), label);
    assert.equal(queries.filter(query => query.kind === kind).length, before + 1, 'Each switch fetches fresh content');
    assert.equal(await page.locator('#place-sheet').evaluate(el => el === window.originalSheet && el.open), true);
  };
  await switchTo('篝火', '篝火', 'bonfire');
  await page.getByText('篝火内容 · 第 1 次读取', { exact: true }).waitFor();
  await switchTo('围炉', '围炉', 'firesides');
  await page.getByText('围炉的新消息', { exact: true }).waitFor();
  await switchTo('篝火', '篝火', 'bonfire');
  await page.getByText('篝火内容 · 第 2 次读取', { exact: true }).waitFor();
  await switchTo('篝火', '篝火', 'bonfire');
  await page.getByText('篝火内容 · 第 3 次读取', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/place-switcher.png', animations: 'disabled' });
  // A slower response must not replace the feature selected afterwards.
  const slowRead = page.waitForResponse(response => response.url().endsWith('/query') && response.request().postDataJSON().kind === 'bonfire');
  await nav.getByRole('button', { name: '篝火', exact: true }).click();
  await page.locator('#town-refresh-indicator .startup-spinner').waitFor();
  assert.equal(await page.getByText('篝火内容 · 第 3 次读取', { exact: true }).count(), 1);
  await switchTo('私信', '私信', 'inbox');
  await slowRead;
  assert.equal(await page.locator('#view-title').innerText(), '私信');
  assert.equal(await page.getByText('篝火内容 · 第 4 次读取', { exact: true }).count(), 0);
  await switchTo('书架', '书架', 'embers');
  await page.locator('.catalog-item').click();
  await page.locator('.catalog-detail .reading-title').getByText('测试书籍', { exact: true }).waitFor();
  await verifyRefresh(['.catalog-item', '.catalog-detail .reading-title', '.reading-fragment .reading-text'], 'embers');
  await switchTo('卷轴', '卷轴', 'scrolls');
  await page.locator('.catalog-item').click();
  await page.locator('.catalog-detail .reading-title').getByText('卷轴排版参考', { exact: true }).waitFor();
  await verifyRefresh(['.catalog-item', '.catalog-detail .reading-title', '.reading-fragment .reading-text'], 'scrolls');
  const scrollActions = await actionLayout();
  assert.equal(scrollActions[0].height, seedActions[0].height, 'Seed uses the same link controls as Scrolls');
  assert.equal(scrollActions[1].x - scrollActions[0].right, seedActions[1].x - seedActions[0].right);
  await page.getByRole('button', { name: '复制链接', exact: true }).click();
  assert.equal(await page.evaluate(() => window.copiedSeedLink), 'https://beings.town/scrolls/scroll-1');
  await switchTo('工具库', 'Kit 工具库', 'grove');
  await switchTo('广场', '小镇广场', 'home');
  await switchTo('花园', '种子花园', 'seeds');
  assert.equal(await page.locator('#view-title').evaluate(el => parseFloat(getComputedStyle(el).fontSize)), 26);
  assert.equal(await nav.locator('[aria-current="page"]').evaluate(el => parseFloat(getComputedStyle(el).fontSize)), 12);
  await page.evaluate(() => window.seedTown.show('seeds', 'seed-0'));
  await page.locator('.direct-reading .reading-title').waitFor();
  await verifyRefresh(['.direct-reading .reading-title', '.reading-fragment .reading-text'], 'seed-direct');
  await page.setViewportSize({ width: 420, height: 800 });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  assert.equal(await page.locator('#place-sheet').evaluate(el => el.scrollWidth <= el.clientWidth), true);
  const narrowActions = await actionLayout();
  assert.equal(narrowActions[0].y, narrowActions[1].y);
  assert.equal(narrowActions[1].x - narrowActions[0].right, 8);
  await page.screenshot({ path: 'test-results/seed-garden-narrow.png', animations: 'disabled' });
  await switchTo('卷轴', '卷轴', 'scrolls');
  const selectedVisible = await nav.locator('[aria-current="page"]').evaluate(el => {
    const rect = el.getBoundingClientRect(), parent = el.parentElement.getBoundingClientRect();
    return rect.left >= parent.left && rect.right <= parent.right;
  });
  assert.equal(selectedVisible, true);
  await switchTo('花园', '种子花园', 'seeds');
  assert.equal(await page.evaluate(() => window.seedTown.directId), undefined);
  await page.locator('.seed-filter-menu > summary').click();
  assert.equal(await page.locator('.seed-filter-fields').evaluate(el => {
    const rect = el.getBoundingClientRect(), sheet = document.getElementById('place-sheet').getBoundingClientRect();
    return rect.left >= sheet.left && rect.right <= sheet.right && rect.bottom <= sheet.bottom;
  }), true, 'Seed filters fit the narrow sheet');
  await page.screenshot({ path: 'test-results/seed-garden-filters-narrow.png', animations: 'disabled' });
  assert.deepEqual(errors, []);
  console.log('PASS: Seed Garden reading, shared Scrolls link layout, feature switching with fresh reads, stale-response isolation and narrow dark navigation.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
