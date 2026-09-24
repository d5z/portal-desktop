import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const bundle = await build({ stdin: { contents: `
  import { createRoot } from 'react-dom/client';
  import { Topbar } from './desktop/renderer/app/components/topbar';
  import { AppModel } from './desktop/renderer/app/models/app';
  let finishDownload, failDownload;
  const app = new AppModel({
    platform: 'win32',
    checkUpdates: () => {
      window.checks = (window.checks || 0) + 1;
      return new Promise(resolve => { window.finishCheck = phase => resolve({ ...app.update, phase, latestVersion: '0.2.0', message: phase === 'current' ? '当前已是最新正式版本。' : '发现新版本' }); });
    },
    downloadUpdate: () => {
      window.downloads = (window.downloads || 0) + 1;
      return new Promise((resolve, reject) => { finishDownload = resolve; failDownload = reject; });
    },
    cancelUpdate: async () => {
      window.cancellations = (window.cancellations || 0) + 1;
      window.updateActivity(undefined); finishDownload();
    },
    installUpdate: async () => { window.installations = (window.installations || 0) + 1; },
  });
  app.update = { phase: 'idle', currentVersion: '0.1.0', message: '尚未检查更新', releaseUrl: '' };
  window.updateActivity = activity => { app.update = { ...app.update, activity }; app.changed(); if (activity?.phase === 'ready') finishDownload?.(); };
  window.failDownload = () => failDownload(new Error('下载失败，请重试'));
  window.app = app;
  createRoot(document.getElementById('root')).render(<Topbar model={app} />);
`, loader: 'tsx', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', jsx: 'automatic', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } });
const css = await readFile('desktop/renderer/app/styles.css');
const server = createServer((request, response) => {
  if (request.url === '/app.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].contents); return; }
  if (request.url === '/app.css') { response.setHeader('Content-Type', 'text/css'); response.end(css); return; }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end('<!doctype html><link rel="stylesheet" href="/app.css"><div id="root" style="width:100%"></div><script src="/app.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  const page = await browser.newPage(); page.setDefaultTimeout(5000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.waitForFunction(() => typeof window.updateActivity === 'function');
  assert.equal(await page.locator('#client-update').count(), 0);
  await page.locator('#options-trigger').click();
  assert.equal(await page.locator('#check-updates').evaluate(el => el.nextElementSibling?.id), 'quit-client');
  await page.getByRole('button', { name: '手动检查更新' }).click();
  await page.getByRole('button', { name: '正在检查更新…', disabled: true }).waitFor();
  assert.equal(await page.locator('#options-trigger').getAttribute('aria-expanded'), 'true');
  await page.evaluate(() => window.finishCheck('current'));
  await page.getByRole('button', { name: '手动检查更新' }).waitFor();
  assert.equal(await page.evaluate(() => window.app.toastMessage), '当前已是最新正式版本。');
  await page.getByRole('button', { name: '手动检查更新' }).click();
  await page.evaluate(() => window.finishCheck('available'));
  await page.getByRole('button', { name: '下载更新 v0.2.0' }).waitFor();
  assert.equal(await page.locator('#options-trigger').getAttribute('aria-expanded'), 'true');
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/update-menu-available.png' });
  await page.getByRole('button', { name: '下载更新 v0.2.0' }).click();
  assert.equal(await page.evaluate(() => window.downloads), 1);
  assert.equal(await page.locator('#options-trigger').getAttribute('aria-expanded'), 'false');
  await page.getByRole('button', { name: '正在准备下载更新…' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('#conversation-options').open);
  await page.evaluate(() => window.failDownload());
  await page.getByRole('button', { name: '发现新版本 0.2.0，点击下载' }).waitFor();
  assert.match(await page.evaluate(() => window.app.toastMessage), /下载失败/);
  await page.locator('#options-trigger').click();
  await page.getByRole('button', { name: '发现新版本 0.2.0，点击下载' }).click();
  assert.equal(await page.evaluate(() => window.downloads), 2);
  assert.equal(await page.locator('#options-trigger').getAttribute('aria-expanded'), 'false');
  const phase = (value, extra = {}) => page.evaluate(activity => window.updateActivity(activity), { phase: value, version: '0.2.0', ...extra });
  await phase('metadata');
  await page.getByRole('button', { name: '正在准备下载更新…' }).waitFor();
  await phase('downloading', { received: 26_214_400, total: 104_857_600 });
  await page.getByText('25', { exact: true }).waitFor();
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/update-progress-light.png' });
  await phase('downloading', { received: 26_214_400 });
  await page.locator('.client-update-progress:empty').waitFor();
  await page.locator('#client-update').click();
  await page.waitForFunction(() => window.cancellations === 1);
  await page.getByRole('button', { name: '发现新版本 0.2.0，点击下载' }).click();
  await phase('verifying'); await page.getByRole('button', { name: '正在校验安装包…' }).waitFor();
  await phase('preparing'); await page.getByRole('button', { name: '正在准备安装文件…' }).waitFor();
  await phase('ready');
  await page.locator('#client-update').getByText('安装', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/update-ready.png' });
  await page.getByRole('button', { name: '下载完成，点击安装' }).click();
  assert.equal(await page.evaluate(() => window.installations), 1);
  await phase('installing');
  await page.locator('#client-update:disabled').waitFor();
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.setViewportSize({ width: 380, height: 640 });
  await page.screenshot({ path: 'test-results/update-progress-dark.png' });
  await page.evaluate(() => window.updateActivity(undefined));
  await page.getByRole('button', { name: '发现新版本 0.2.0，点击下载' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: menu checks above Quit, stays open for results, closes on download, immediately displays progress, recovers after failure, supports cancellation, and becomes Install when ready.');
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
