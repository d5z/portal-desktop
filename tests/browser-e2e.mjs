import { launchDesktop } from './support/electron-lifecycle.mjs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { desktopExecutable } from './support/desktop.mjs';
const directory = await mkdtemp(path.join(os.tmpdir(), 'beings-browser-'));
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<title>${req.url.startsWith('/two') ? '第二页' : '浏览器测试'}</title><style>body{font:20px system-ui;padding:32px;background:#eef3ed;color:#234}</style><h1>在客户端里浏览</h1><p>左侧继续对话，右侧打开网页。</p><a href="/two">第二页</a><p><a href="/popup" target="_blank">新窗口链接</a></p>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let app;
try {
  app = await launchDesktop({ executablePath: await desktopExecutable(), env: { ...process.env, PORTAL_DESKTOP_USER_DATA: directory } });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1008, 680));
  page.setDefaultTimeout(10000);
  await page.getByRole('button', { name: '连接我的 Being' }).waitFor();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const native = code => app.evaluate(({ BrowserWindow }, code) => BrowserWindow.getAllWindows()[0].contentView.children.find(v => v.webContents).webContents.executeJavaScript(code), code);
  const visible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.find(v => v.webContents)?.getVisible());
  // Browser links now open through the shell API; the compact menu has no browser item.
  await page.evaluate(() => window.beings.openBrowser());
  await page.locator('#browser-address').fill(base + '/one?token=fixture-secret');
  await page.locator('#browser-address').press('Enter');
  await page.waitForFunction(() => document.querySelector('#browser-title').textContent === '浏览器测试');
  await page.waitForFunction(async () => !(await window.beings.browserState()).loading);
  assert.equal(await visible(), true);
  const divider = page.locator('#browser-divider');
  const originalWidth = await page.locator('#browser-panel').evaluate(el => el.getBoundingClientRect().width);
  const stageWidth = await page.locator('.workspace-stage').evaluate(el => el.getBoundingClientRect().width);
  const expectedWidth = originalWidth + Math.min(20, Math.max(0, stageWidth - 300));
  const originalPercent = Number(await divider.getAttribute('aria-valuenow'));
  // Native page navigation can take keyboard focus after its title arrives.
  // Focus the shell separator after navigation has fully settled.
  await divider.click();
  await page.waitForFunction(() => document.activeElement?.id === 'browser-divider');
  await divider.press('ArrowLeft');
  await page.waitForFunction(width => Math.abs(document.querySelector('#browser-panel').getBoundingClientRect().width - width) < 1, expectedWidth).catch(async error => {
    console.error('Browser resize', await page.evaluate(before => ({before,width:document.querySelector('#browser-panel').getBoundingClientRect().width,
      stage:document.querySelector('.workspace-stage').getBoundingClientRect().width,viewport:innerWidth,
      divider:document.querySelector('#browser-divider').outerHTML,focus:document.activeElement?.id}), originalWidth));
    throw error;
  });
  assert(Number(await divider.getAttribute('aria-valuenow')) >= originalPercent);
  await divider.dblclick();
  await page.waitForFunction(width => Math.abs(document.querySelector('#browser-panel').getBoundingClientRect().width - width) < 2, originalWidth);
  assert.equal((await page.evaluate(() => window.beings.browserState())).address, base + '/one');
  assert.equal(await native('typeof window.beings + ":" + typeof require'), 'undefined:undefined');
  await page.waitForFunction(async () => !(await window.beings.browserState()).loading);
  await native('document.cookie="fixture=retained; path=/"; document.querySelector("a").click()');
  await page.waitForFunction(() => document.querySelector('#browser-title').textContent === '第二页');
  await page.waitForFunction(() => !document.querySelector('#browser-back').disabled);
  await page.locator('#browser-back').click();
  await page.waitForFunction(() => document.querySelector('#browser-title').textContent === '浏览器测试');
  await page.waitForFunction(() => !document.querySelector('#browser-forward').disabled);
  await page.locator('#browser-forward').click();
  await page.waitForFunction(() => document.querySelector('#browser-title').textContent === '第二页');
  await page.locator('#options-trigger').click();
  await page.locator('#client-settings-button').click();
  await page.locator('#settings-tab-general').click();
  await page.waitForTimeout(100);
  assert.equal(await visible(), false);
  await page.locator('#close-client-settings').click();
  await page.waitForTimeout(100);
  assert.equal(await visible(), true);
  await native('document.querySelector("a[target]").click()');
  await page.waitForFunction(() => document.querySelector('#browser-address').value.endsWith('/popup'));
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  await page.locator('#browser-close').click();
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(v => v.webContents).length), 0);
  await page.evaluate(url => window.beings.openBrowser(url), base);
  await page.waitForFunction(() => document.querySelector('#browser-title').textContent === '浏览器测试');
  assert.match(await native('document.cookie'), /fixture=retained/);
  await assert.rejects(page.evaluate(() => window.beings.openBrowser('file:///etc/passwd')), /HTTP/);
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
  const screenshot = path.join(os.tmpdir(), 'beings-browser.png');
  await writeFile(screenshot, Buffer.from(png, 'base64'));
  assert.deepEqual(errors, []);
  console.log('PASS embedded browser: native page, address, history, popup, modal layering, session retention, isolation, close cleanup. Screenshot: ' + screenshot);
} finally {
  if (app) await app.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
