import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const bundle = await build({ stdin: { contents: `
  import { createRoot } from 'react-dom/client';
  import { useState } from 'react';
  import { UpdateProgress } from './desktop/renderer/app/components/update-progress';
  function Fixture() {
    const [state, setState] = useState({ phase: 'available', currentVersion: '0.1.0', latestVersion: '0.2.0', message: '发现新版本', releaseUrl: '' });
    window.updateActivity = activity => setState(value => ({ ...value, activity }));
    return <UpdateProgress state={state}
      onDownload={() => { window.downloads = (window.downloads || 0) + 1; }}
      onCancel={() => { window.cancellations = (window.cancellations || 0) + 1; setState(value => ({ ...value, activity: undefined })); }}
      onInstall={() => { window.installations = (window.installations || 0) + 1; }} />;
  }
  createRoot(document.getElementById('root')).render(<Fixture />);
`, loader: 'tsx', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', jsx: 'automatic', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } });
const css = await readFile('desktop/renderer/app/styles.css');
const server = createServer((request, response) => {
  if (request.url === '/app.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].contents); return; }
  if (request.url === '/app.css') { response.setHeader('Content-Type', 'text/css'); response.end(css); return; }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end('<!doctype html><link rel="stylesheet" href="/app.css"><header class="topbar"><div></div><div></div><div class="topbar-actions" id="root"></div></header><script src="/app.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  const page = await browser.newPage(); page.setDefaultTimeout(5000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.waitForFunction(() => typeof window.updateActivity === 'function');
  await page.getByRole('button', { name: '发现新版本 0.2.0，点击下载' }).click();
  assert.equal(await page.evaluate(() => window.downloads), 1);
  const phase = (value, extra = {}) => page.evaluate(activity => window.updateActivity(activity), { phase: value, version: '0.2.0', ...extra });
  await phase('metadata');
  await page.getByRole('button', { name: '正在读取更新信息…' }).waitFor();
  await phase('downloading', { received: 26_214_400, total: 104_857_600 });
  await page.getByText('25', { exact: true }).waitFor();
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/update-progress-light.png' });
  await phase('downloading', { received: 26_214_400 });
  await page.locator('.client-update-progress:empty').waitFor();
  await page.locator('#client-update').click();
  await page.waitForFunction(() => window.cancellations === 1);
  await phase('verifying'); await page.getByRole('button', { name: '正在校验安装包…' }).waitFor();
  await phase('preparing'); await page.getByRole('button', { name: '正在准备安装文件…' }).waitFor();
  await phase('ready');
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
  console.log('PASS: top-right update button downloads on demand, displays progress, supports cancellation, and becomes an install action when ready.');
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
