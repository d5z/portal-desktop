import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { build } from '../scripts/renderer-build.mjs';

const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import { createRoot } from 'react-dom/client';
import { HomeFileThumbnail } from './desktop/renderer/app/components/home-file-thumbnail';
const root = createRoot(document.querySelector('#root'));
const source = document.createElement('canvas'); source.width = 4096; source.height = 3072;
source.getContext('2d').fillRect(0, 0, source.width, source.height);
const blob = await new Promise(resolve => source.toBlob(resolve));
const bytes = new Uint8Array(await blob.arrayBuffer());
window.previewCalls = 0; window.urls = []; window.revoked = [];
const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = blob => { const url = create(blob); window.urls.push(url); return url; };
URL.revokeObjectURL = url => { window.revoked.push(url); revoke(url); };
const api = { preview: async () => { window.previewCalls++; return { bytes }; } };
root.render(<HomeFileThumbnail file={{ name: 'large.png', path: 'large.png', type: 'file', size: bytes.length }} api={api} />);
window.unmount = () => root.unmount();
` }, bundle: true, write: false, jsx: 'automatic', format: 'esm', outfile: 'thumbnail.js', define: { 'process.env.NODE_ENV': '"production"' } });
const server = createServer((req, res) => {
  const file = bundle.outputFiles.find(file => file.path.replaceAll('\\', '/').endsWith(req.url));
  res.setHeader('Content-Type', file ? req.url.endsWith('.css') ? 'text/css' : 'text/javascript' : 'text/html');
  res.end(file ? file.contents : '<link rel="stylesheet" href="/thumbnail.css"><div id="root" style="margin-top:2000px"></div><script type="module" src="/thumbnail.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage(); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => typeof window.unmount === 'function').catch(error => { console.log(errors); throw error; });
  assert.equal(await page.evaluate(() => window.previewCalls), 0, 'Offscreen thumbnails must not fetch');
  await page.locator('#root').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('img')?.naturalWidth > 0);
  const size = await page.locator('img').first().evaluate(image => ({ width: image.naturalWidth, height: image.naturalHeight }));
  assert.ok(size.width <= 208 && size.height <= 152, `Retained thumbnail is bounded: ${JSON.stringify(size)}`);
  assert.equal(await page.evaluate(() => window.previewCalls), 1);
  await page.evaluate(() => window.unmount());
  assert.deepEqual(await page.evaluate(() => window.revoked), await page.evaluate(() => window.urls), 'Unmount releases every thumbnail URL');
  assert.deepEqual(errors, []);
  console.log(`PASS: offscreen deferral, 4096x3072 -> ${size.width}x${size.height}, object URL cleanup.`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
