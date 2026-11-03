// Built Web documents, isolated storage and local responses only.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { preview } from 'vite';
import { chromium } from 'playwright';

const server = await preview({ configFile: 'vite.web.config.mjs', preview: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname.endsWith('/web-config.json')) return route.fulfill({ json: { mode: 'static', apiBase: '' } });
    if (!url.pathname.startsWith('/fixture/')) return route.continue();
    if (url.pathname.endsWith('/stream/active')) return route.fulfill({ status: 204 });
    if (url.pathname.endsWith('/history')) return route.fulfill({ json: { messages: [
      { seq: 1, role: 'user', content: '网页样式检查', scene_id: url.searchParams.get('scene_id'), at: '2026-10-01T08:00:00Z' },
      { seq: 2, role: 'being', content: '主题、布局与 **输入框** 都应正常。', scene_id: url.searchParams.get('scene_id'), at: '2026-10-01T08:00:01Z' },
    ] } });
    return route.fulfill({ json: { being_name: '样式测试', model: 'fixture', sbs_enabled: false, presets: [] } });
  });
  await page.addInitScript(endpoint => {
    localStorage.setItem('town-web:connection', JSON.stringify({ endpoint, token: 'fixture', relaySecret: 'fixture' }));
  }, `${origin}/fixture`);
  await page.goto(origin);
  const frame = page.frameLocator('iframe');
  try {
    await frame.getByRole('textbox', { name: 'message input' }).waitFor({ timeout: 15000 });
  } catch (error) {
    console.error({ errors, frames: page.frames().map(frame => frame.url()), body: await page.locator('body').innerText() });
    throw error;
  }
  await mkdir('test-results', { recursive: true });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const navigation = page.getByRole('navigation', { name: width > 760 ? '主导航' : '底部导航', exact: true });
    for (const [label, theme] of [['浅色', 'light'], ['深色', 'dark']]) {
      await navigation.getByRole('button', { name: '设置', exact: true }).click();
      await page.getByRole('group', { name: '外观主题' }).getByRole('button', { name: label, exact: true }).click();
      await navigation.getByRole('button', { name: '对话', exact: true }).click();
      await frame.locator(`html[data-theme="${theme}"]`).waitFor();
      await frame.getByRole('textbox', { name: 'message input' }).fill('保留编辑器布局');
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
      assert.equal(await page.locator('.web-app').evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
      assert.equal(await frame.locator('#input-area').evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
      const composer = await frame.locator('#input-area').boundingBox();
      assert.ok(composer.width > 200 && composer.height >= 80, 'The shared editor styles must be loaded');
      await page.screenshot({ path: `test-results/web-styles-${width}-${theme}.png` });
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS: Web shell and chat share SCSS, retain theme switching, and fit desktop/mobile widths.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
