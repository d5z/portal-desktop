// Exercise themed native pickers inside the real client's modal and filter menus.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { launchDesktop } from './support/electron-lifecycle.mjs';
import { desktopExecutable } from './support/desktop.mjs';

const directory = await mkdtemp(path.join(os.tmpdir(), 'portal-select-controls-'));
let app;
try {
  app = await launchDesktop({ executablePath: await desktopExecutable(), env: { ...process.env, PORTAL_DESKTOP_USER_DATA: directory } });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ protocol }) => {
    globalThis.selectRequests = [];
    protocol.handle('https', request => {
      const url = new URL(request.url);
      globalThis.selectRequests.push(url.pathname + url.search);
      if (url.pathname === '/api/client/stream') return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode('event: hello\ndata: {"town_id":"t_SelectFixture","anonymous":false,"token_kind":"client"}\n\n'));
      } }), { headers: { 'Content-Type': 'text/event-stream' } });
      if (url.pathname === '/api') return Response.json({ services: Object.fromEntries(['scroll', 'seeds', 'bonfire', 'messages', 'fireside'].map(name => [name, { what: '筛选控件验证' }])) });
      if (url.pathname === '/api/scrolls') return Response.json({ scrolls: [{ id: 'guide', title: '协作指南', kind: 'guide' }], total: 1 });
      if (url.pathname === '/api/scrolls/guide') return Response.json({ id: 'guide', title: '协作指南', content: '筛选控件验证。' });
      if (url.pathname === '/api/seeds') return Response.json({ seeds: [], count: 0 });
      if (url.pathname === '/api/fireside/list') return Response.json({ owned: [{ id: 10, name: '筛选围炉' }], joined: [] });
      if (url.pathname === '/api/fireside/members') return Response.json([]);
      if (['/api/bonfire/hear', '/api/messages', '/api/fireside/hear'].includes(url.pathname)) return Response.json({ messages: [
        { id: '1', seq: 1, sender: '河流', speaker_name: '河流', message: '第一条消息', content: '第一条消息', created_at: '2026-09-16T00:00:00Z', at: '2026-09-16T00:00:00Z' },
        { id: '2', seq: 2, sender: '名字很长的花园居民用于检查下拉菜单换行和边界', speaker_name: '名字很长的花园居民用于检查下拉菜单换行和边界', message: '第二条消息', content: '第二条消息', created_at: '2026-09-17T00:00:00Z', at: '2026-09-17T00:00:00Z' },
      ] });
      return Response.json({});
    });
  });
  await page.evaluate(() => window.beings.saveTownToken('select-fixture-token'));
  await page.waitForFunction(async () => (await window.beings.townLive()).phase === 'connected');
  await mkdir('test-results/select-controls', { recursive: true });
  const navigate = async title => {
    if (await page.locator('#place-sheet').evaluate(el => el.open)) await page.locator('#back-to-chat').click();
    await page.locator('#options-trigger').click();
    await page.locator('#conversation-options [data-view="town"]').click();
    await page.locator('.service-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).getByRole('button', { name: '打开', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#town-body').hasAttribute('aria-busy'));
  };
  const screenshot = async name => {
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `test-results/select-controls/${name}.png`, animations: 'disabled' });
  };
  const opened = select => select.evaluate(el => el.matches(':open'));
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') {
      await page.locator('#back-to-chat').click();
      await page.locator('#options-trigger').click();
      await page.locator('#client-settings-button').click();
      await page.locator('#settings-tab-appearance').click();
      await page.locator('#theme-dark').click();
      await page.locator('#close-client-settings').click();
    }
    await navigate('卷轴');
    const kind = page.getByLabel('卷轴类型');
    await kind.click();
    assert.equal(await opened(kind), true);
    await screenshot(`scrolls-${theme}`);
    await page.getByRole('option', { name: '指南', exact: true }).click();
    assert.equal(await kind.inputValue(), 'guide');
    assert.equal(await opened(kind), false);
    await page.waitForFunction(() => !document.querySelector('#town-body').hasAttribute('aria-busy'));
    assert.ok((await app.evaluate(() => globalThis.selectRequests)).some(url => url.includes('/api/scrolls?') && url.includes('kind=guide')));
    await kind.click();
    await page.keyboard.press('Escape');
    assert.equal(await opened(kind), false);
    assert.equal(await page.locator('#place-sheet').evaluate(el => el.open), true);
    await navigate('种子花园 · Seed Garden');
    await page.locator('.seed-filter-menu summary').click();
    const lifecycle = page.getByLabel('种子状态');
    await lifecycle.click();
    await screenshot(`seeds-${theme}`);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    assert.equal(await lifecycle.inputValue(), 'superseded');
    await page.getByRole('button', { name: '应用筛选', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#town-body').hasAttribute('aria-busy'));
    assert.ok((await app.evaluate(() => globalThis.selectRequests)).some(url => url.includes('/api/seeds?') && url.includes('lifecycle=superseded')));
    for (const title of ['篝火', '私信', '围炉']) {
      await navigate(title);
      await page.locator('.feed-options summary').click();
      const order = page.getByLabel('排序', { exact: true });
      await order.click();
      await page.getByRole('option', { name: '最早在前', exact: true }).click();
      assert.equal(await order.inputValue(), 'oldest');
      assert.match(await page.locator('.social-message').first().textContent(), /第一条消息/);
      const days = page.getByLabel('时间', { exact: true });
      await days.click();
      await page.keyboard.press('Escape');
      assert.equal(await opened(days), false);
      assert.equal(await page.locator('.feed-options').evaluate(el => el.open), true);
      const author = page.getByLabel('作者', { exact: true });
      await author.click();
      await screenshot(`${title}-${theme}`);
      await page.getByRole('option', { name: '河流', exact: true }).click();
      assert.equal(await page.locator('.social-message').count(), 1);
      if (title === '篝火' && theme === 'light') {
        await author.click();
        await page.getByRole('option', { name: '名字很长的花园居民用于检查下拉菜单换行和边界', exact: true }).click();
        await screenshot('long-author-selected');
        await author.selectOption({ label: '河流' });
      }
      await author.click();
      await page.locator('.feed-summary').click();
      assert.equal(await opened(author), false);
    }
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 640));
  await navigate('种子花园 · Seed Garden');
  await page.locator('.seed-filter-menu summary').click();
  await page.getByLabel('种子状态').click();
  await screenshot('seeds-minimum-window');
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const visibleOptions = await page.getByRole('option').all();
  for (const option of visibleOptions) {
    const box = await option.boundingBox();
    assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height);
  }
  const fields = await page.locator('.seed-filter-fields').boundingBox();
  const dialog = await page.locator('#place-sheet').boundingBox();
  assert.ok(fields.y + fields.height <= dialog.y + dialog.height);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.seed-filter-menu').evaluate(el => el.open), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.seed-filter-menu').evaluate(el => el.open), false);
  assert.equal(await page.locator('#place-sheet').evaluate(el => el.open), true);
  await page.locator('.seed-filter-menu summary').click();
  await page.locator('#view-title').click();
  assert.equal(await page.locator('.seed-filter-menu').evaluate(el => el.open), false);
  assert.deepEqual(errors, []);
  console.log('PASS: themed pickers, scroll/seed request filters, message ordering/authors, keyboard selection, Escape/outside dismissal, minimum window.');
} finally {
  await app?.close();
  if (path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('portal-select-controls-')) await rm(directory, { recursive: true, force: true });
}
