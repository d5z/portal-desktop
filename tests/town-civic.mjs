import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const notices = Array.from({ length: 26 }, (_, index) => ({
  id: 'notice-' + index, title: index === 0 ? '小镇通讯录与公告板上线' : '小镇公告 ' + (index + 1),
  content: '## 小镇的新消息\n\n**欢迎来到小镇**，在通讯录认识 Being 与人类伙伴。\n\n<img src=x onerror="window.civicPwned=true">\n\n' + '公告正文，保留完整阅读空间。\n\n'.repeat(30),
  display_name: '河流', town_id: 't_Author', pinned: index === 0,
  category: index < 2 ? 'update' : 'event', expires_at: index === 25 ? '2020-01-01T00:00:00Z' : null,
  created_at: '2026-09-24T01:00:00Z', updated_at: '2026-09-24T01:00:00Z',
}));
const contacts = [
  { town_id: 't_First', display_name: '河流', human_name: '小林', note: '一起写代码、读故事，也一起探索这个世界。' },
  { town_id: 't_Second', display_name: '河流', human_name: '小溪', note: '同名 Being，由 Town ID 区分。' },
  { town_id: 't_Self', display_name: '柳树', human_name: '小叶', note: '' },
].map(entry => ({ ...entry, updated_at: '2026-09-24T02:00:00Z' }));
const { outputFiles } = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'town-civic-fixture.tsx', contents: `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { Town } from './desktop/renderer/town/page';
  import { TownComposer } from './desktop/renderer/town/components/composer';
  import { Dialog } from './desktop/renderer/shared/components/dialog';
  import { PlaceHeading } from './desktop/renderer/app/components/navigation';
  import { useModel } from './desktop/renderer/shared/hooks/use-model';
  import { TownModel } from './desktop/renderer/town/models/town';
  import { SceneStore } from './desktop/renderer/shared/models/scene';
  const scenes = new SceneStore();
  scenes.configure('willow', 'https://fixture.test/willow');
  const town = new TownModel({
    town: async query => {
      const result = await (await fetch('/query', { method: 'POST', body: JSON.stringify(query) })).json();
      return window.failCivic && ['announcements', 'announcement', 'contacts'].includes(query.kind)
        ? { ok: false, code: 'network', message: 'fixture offline' } : result;
    },
    townAuth: async () => ({ configured: true, beingId: 't_Self' }),
    copyText: async value => { window.copied = value; },
    openTownLink: async value => { window.opened = value; },
  }, () => {}, (view, id) => { if (view !== 'chat') town.show(view, id); }, scenes, () => {}, data => {
    if (data.type === 'beings:scene-draft') {
      window.contactDraft = data;
      queueMicrotask(() => town.receiveContactDraft({ type: 'beings:scene-draft-result', id: data.id, ok: !window.rejectDraft }));
    }
  });
  town.live = { phase: 'connected', beingId: 't_Self', display: '柳树', generation: 1, revision: 1, sync: 0, message: '已连接', versions: { bonfire: 0, mail: 0, firesides: 0 } };
  window.civicTown = town;
  function Fixture() {
    useModel(town);
    return <><Dialog id="place-sheet" aria-labelledby="view-title" open onClose={() => {}}>
      <PlaceHeading view={town.view} navigate={town.navigate} onBack={town.returnView ? () => town.returnToSource() : undefined} />
      <Town model={town} />
    </Dialog><TownComposer model={town} /></>;
  }
  createRoot(document.getElementById('root')).render(<Fixture />);
  town.show('bonfire');
` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic' });
const css = await readFile('desktop/renderer/app/styles.css', 'utf8');
const server = createServer(async (request, response) => {
  if (request.url === '/query') {
    let body = ''; for await (const chunk of request) body += chunk;
    const query = JSON.parse(body);
    let data;
    if (query.kind === 'announcements') {
      const entries = notices.filter(entry => (!query.category || query.category === entry.category) && (query.includeExpired || !entry.expires_at));
      const items = entries.slice(query.offset || 0, (query.offset || 0) + 24);
      data = { items, count: items.length, total: entries.length };
    } else if (query.kind === 'announcement') data = notices.find(entry => entry.id === query.id);
    else if (query.kind === 'contacts') data = { entries: contacts, count: contacts.length };
    else if (query.kind === 'bonfire') data = { messages: Array.from({ length: 20 }, (_, index) => ({ seq: index + 1, sender: '河流', content: '篝火消息 ' + (index + 1), created_at: '2026-09-24T01:00:00Z' })) };
    else if (query.kind === 'home') data = { services: { '📢 announcements': { what: '小镇的版本更新、规约与活动。' }, '📒 contacts': { what: '认识 Being 与人类伙伴。' } }, whats_new: [], version: 'fixture' };
    else if (['inbox', 'sent'].includes(query.kind)) data = { messages: [] };
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(data ? { ok: true, data, fetchedAt: new Date().toISOString() } : { ok: false, code: 'not-found', message: '内容不存在' }));
  } else {
    response.setHeader('Content-Type', request.url === '/fixture.js' ? 'text/javascript' : 'text/html; charset=utf-8');
    response.end(request.url === '/fixture.js' ? outputFiles[0].text : '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style><div id="root"></div><script src="/fixture.js"></script></html>');
  }
});
await new Promise(resolve => server.listen(process.argv.includes('--serve') ? 4318 : 0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port;
if (process.argv.includes('--serve')) {
  console.log(url);
} else {
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1180, height: 900 }, hasTouch: true });
    page.setDefaultTimeout(10000);
    await page.clock.install();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.locator('.announcement-compact-regular').waitFor();
    assert.equal(await page.locator('#bonfire-announcement-panel').count(), 0);
    assert.ok((await page.locator('.bonfire-announcements').boundingBox()).height <= 40);
    const chevron = page.locator('.announcement-toggle svg');
    assert.equal(await chevron.locator('path').getAttribute('d'), 'm5 8 5 5 5-5');
    const toggleBox = await page.locator('.announcement-toggle').boundingBox();
    const iconBox = await chevron.boundingBox();
    assert.equal(iconBox.width, 16);
    assert.ok(Math.abs(iconBox.x + iconBox.width / 2 - toggleBox.x - toggleBox.width / 2) < 1);
    assert.ok(Math.abs(iconBox.y + iconBox.height / 2 - toggleBox.y - toggleBox.height / 2) < 1);
    const compactTitle = page.locator('.announcement-compact-regular');
    const rotatingTitle = page.locator('.announcement-rotation .bonfire-announcement-title');
    assert.equal(await compactTitle.textContent(), '小镇公告 2');
    await page.clock.fastForward(5100);
    await page.waitForFunction(() => document.querySelector('.announcement-compact-regular')?.textContent === '小镇公告 3');
    const bodyBefore = await page.locator('#town-body').boundingBox();
    await page.locator('.announcement-compact').hover();
    await page.locator('#bonfire-announcement-panel').waitFor();
    assert.equal(await chevron.locator('path').getAttribute('d'), 'm5 12 5-5 5 5');
    const bodyAfter = await page.locator('#town-body').boundingBox();
    assert.ok(Math.abs(bodyAfter.y - bodyBefore.y) < 2 && Math.abs(bodyAfter.height - bodyBefore.height) < 2);
    assert.equal(await page.locator('.bonfire-announcement').count(), 1);
    assert.equal(await page.locator('#bonfire-announcement-panel').evaluate(el => {
      const rect = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(rect.left + 20, rect.bottom - 20));
    }), true);
    await mkdir('output/playwright', { recursive: true });
    await page.screenshot({ animations: 'disabled', path: 'output/playwright/civic-bonfire-expanded.png' });
    await rotatingTitle.hover();
    await page.clock.fastForward(10000);
    assert.equal(await rotatingTitle.textContent(), '小镇公告 3');
    await page.getByRole('button', { name: '下一条公告', exact: true }).click();
    assert.equal(await rotatingTitle.textContent(), '小镇公告 4');
    await page.getByRole('button', { name: '暂停公告轮播', exact: true }).click();
    await page.locator('#town-search').focus();
    await page.mouse.move(0, 0);
    await page.clock.fastForward(10000);
    assert.equal(await compactTitle.textContent(), '小镇公告 4');
    await page.locator('.announcement-compact').hover();
    await page.locator('.announcement-rotation-item').click();
    await page.locator('.announcement-board .catalog-item.selected').waitFor();
    assert.match(await page.locator('.announcement-board .catalog-item.selected').textContent(), /小镇公告 4/);
    assert.equal(await page.locator('.announcement-detail .reading-title').textContent(), '小镇公告 4');
    assert.equal(await page.evaluate(() => window.civicTown.directId), undefined);
    await page.getByRole('button', { name: '篝火', exact: true }).click();
    await page.locator('.announcement-compact-regular').waitFor();
    const pinnedTop = await page.locator('.bonfire-announcements').evaluate(el => el.getBoundingClientRect().top);
    await page.locator('#town-body').evaluate(el => { el.scrollTop = 400; });
    assert.ok(Math.abs(await page.locator('.bonfire-announcements').evaluate(el => el.getBoundingClientRect().top) - pinnedTop) < 2);
    await mkdir('output/playwright', { recursive: true });
    await page.screenshot({ animations: 'disabled', path: 'output/playwright/civic-bonfire.png' });
    await page.locator('.announcement-compact-title').first().click();
    await page.locator('.announcement-board .catalog-item').first().waitFor();
    assert.equal(await page.locator('#view-title').textContent(), '公告');
    assert.equal(await page.evaluate(() => window.civicTown.directId), undefined);
    await page.locator('.announcement-board .catalog-item.selected').waitFor();
    assert.match(await page.locator('.announcement-board .catalog-item.selected').textContent(), /小镇通讯录与公告板上线/);
    await page.locator('.announcement-detail .reading-title').waitFor();
    assert.equal(await page.locator('.announcement-detail .reading-text strong').textContent(), '欢迎来到小镇');
    await page.getByRole('button', { name: '复制链接', exact: true }).click();
    assert.equal(await page.evaluate(() => window.copied), 'https://beings.town/api/announcements/notice-0');
    assert.equal(await page.evaluate(() => window.civicPwned), undefined);
    await page.getByRole('button', { name: '公告', exact: true }).click();
    await page.locator('.announcement-board .catalog-item').first().waitFor();
    assert.match(await page.locator('#town-pagination').textContent(), /共 25 项/);
    await page.getByRole('button', { name: '下一页 →', exact: true }).click();
    await page.waitForFunction(() => window.civicTown.offset === 24 && !window.civicTown.loading);
    assert.equal(await page.locator('.announcement-board .catalog-item').count(), 1);
    await page.getByRole('tab', { name: '全部历史' }).click();
    await page.waitForFunction(() => window.civicTown.offset === 0 && !window.civicTown.loading);
    assert.match(await page.locator('#town-pagination').textContent(), /共 26 项/);
    await page.getByLabel('公告分类').selectOption('update');
    await page.waitForFunction(() => !window.civicTown.loading && window.civicTown.data?.items?.length === 2);
    await page.locator('.announcement-board .catalog-item').first().click();
    await page.locator('.announcement-detail .reading-title').waitFor();
    await page.screenshot({ animations: 'disabled', path: 'output/playwright/civic-announcements.png' });
    await page.getByRole('button', { name: '通讯录', exact: true }).click();
    await page.locator('.contact-card').first().waitFor();
    assert.equal(await page.locator('.contact-card').count(), 3);
    await page.getByLabel('搜索通讯录').fill('小溪');
    assert.equal(await page.locator('.contact-card').count(), 1);
    await page.getByRole('button', { name: '写私信', exact: true }).click();
    assert.equal(await page.locator('#town-recipient').inputValue(), 't_Second');
    await page.getByRole('button', { name: '关闭发送窗口' }).click();
    await page.getByLabel('搜索通讯录').fill('');
    await page.getByRole('button', { name: '编辑人类伙伴', exact: true }).click();
    assert.equal(await page.getByLabel('人类伙伴姓名', { exact: true }).inputValue(), '小叶');
    await page.getByLabel('人类伙伴姓名', { exact: true }).fill('小叶的新称呼');
    await page.getByLabel('备注（选填）', { exact: true }).fill('一起探索世界');
    await page.evaluate(() => { window.rejectDraft = true; });
    await page.getByRole('button', { name: '放入对话草稿', exact: true }).click();
    await page.locator('#town-contact-dialog [role="alert"]').waitFor();
    await page.screenshot({ animations: 'disabled', path: 'output/playwright/civic-contact-declaration.png' });
    await page.evaluate(() => { window.rejectDraft = false; });
    await page.getByRole('button', { name: '放入对话草稿', exact: true }).click();
    await page.locator('#town-contact-dialog').waitFor({ state: 'detached' });
    assert.match(await page.evaluate(() => window.contactDraft.text), /"human_name":"小叶的新称呼","note":"一起探索世界"/);
    assert.equal(await page.evaluate(() => window.civicTown.live.display), '柳树');
    await page.screenshot({ animations: 'disabled', path: 'output/playwright/civic-contacts.png' });
    await page.evaluate(() => { window.failCivic = true; });
    await page.getByRole('button', { name: '刷新内容', exact: true }).click();
    await page.waitForFunction(() => window.civicTown.refreshError.includes('fixture offline'));
    assert.equal(await page.locator('.contact-card').count(), 3);
    await page.getByRole('button', { name: '篝火', exact: true }).click();
    await page.locator('.announcement-compact').hover();
    await page.locator('.bonfire-announcement-status').filter({ hasText: '公告刷新失败' }).waitFor();
    await page.locator('.social-message').first().waitFor();
    await page.evaluate(() => { window.failCivic = false; });
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.waitForFunction(() => !window.civicTown.announcementsLoading);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#town-search').focus();
    await page.mouse.move(0, 0);
    await page.locator('#bonfire-announcement-panel').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: '展开公告', exact: true }).tap();
    await page.locator('#bonfire-announcement-panel').waitFor();
    await page.getByRole('button', { name: '收起公告', exact: true }).tap();
    await page.locator('#bonfire-announcement-panel').waitFor({ state: 'detached' });
    await page.screenshot({ animations: 'disabled', path: 'output/playwright/civic-bonfire-mobile.png' });
    await page.getByRole('button', { name: '通讯录', exact: true }).click();
    await page.locator('.contact-card').first().waitFor();
    assert.equal(await page.locator('#town-view').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
    await page.screenshot({ animations: 'disabled', path: 'output/playwright/civic-contacts-mobile.png' });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await page.screenshot({ animations: 'disabled', path: 'output/playwright/civic-contacts-dark.png' });
    assert.deepEqual(errors, []);
    console.log('Civic UI passed: compact overlay, rotating summaries, pause, automatic list selection, detail, pagination, contacts, DM, human-partner declaration, failed refresh, mobile and dark theme.');
  } finally { await browser?.close(); server.close(); }
}
