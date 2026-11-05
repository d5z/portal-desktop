import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const assets = new Map(await Promise.all(['loom.html', 'chat.js', 'chat.css', 'highlight.css'].map(async file => ['/' + file, await readFile('desktop/generated/' + file)])));
const paragraphs = Array.from({ length: 12 }, (_, i) => `说明段落 ${i}：${'这里是一段较长的文件说明，在预览面板展开与关闭时会重新换行。'.repeat(6)}`).join('\n\n');
const receipt = JSON.stringify({ type: 'being.files', version: 1, files: [{ path: 'report.pdf', name: 'report.pdf', url: 'https://home.beings.town/v1/me/files/content?path=report.pdf' }] });
const history = Array.from({ length: 20 }, (_, i) => ({ seq: i + 1, role: i % 2 ? 'being' : 'user',
  content: i === 15 ? `${paragraphs}\n\n${receipt}\n\n文件生成完成。` : i % 2 ? paragraphs : `测试提问 ${i}`,
  scene_id: 'desktop-fixture', at: new Date().toISOString() }));
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const json = data => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(data)); };
  if (url.pathname === '/api/history') return json({ messages: history });
  if (url.pathname === '/api/status') return json({ being_name: 'Willow' });
  if (url.pathname === '/api/llm/config') return json({ sbs_enabled: false });
  if (url.pathname === '/api/stream/active') { response.writeHead(204); response.end(); return; }
  if (assets.has(url.pathname)) {
    response.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html');
    response.end(assets.get(url.pathname)); return;
  }
  response.end(`<!doctype html><meta charset="utf-8"><style>body{margin:0;display:flex}iframe{border:0;width:100vw;height:100vh}body.preview iframe{width:500px}aside{display:none}body.preview aside{display:block}</style>
    <iframe id="chat" src="/loom.html?revision=fixture&scene_id=desktop-fixture"></iframe>
    <aside><button id="close">关闭文件预览</button></aside><script>
      const frame=document.querySelector('iframe');
      window.addEventListener('message',event=>{if(event.source===frame.contentWindow&&event.data.type==='beings:home-file-preview')document.body.classList.add('preview');});
      document.querySelector('#close').onclick=()=>{document.body.classList.remove('preview');frame.focus();};
    </script>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  page.setDefaultTimeout(5000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const chat = page.frameLocator('#chat');
  const messages = chat.locator('#messages');
  const card = chat.getByRole('button', { name: '预览文件：report.pdf', exact: true });
  await card.waitFor();
  const settle = () => messages.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const paragraph = card.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," message ")][1]').locator('p').filter({ hasText: '说明段落 10：' });
  await paragraph.evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await settle();
  const before = (await paragraph.boundingBox()).y;
  // Any right-hand panel changes the iframe width, without navigating the chat.
  for (const width of [500, 420, 640, 500]) {
    await page.evaluate(width => { document.body.classList.add('preview'); document.querySelector('iframe').style.width = width + 'px'; }, width);
    await settle();
    const after = (await paragraph.boundingBox()).y;
    assert.ok(Math.abs(after - before) < 3, `Opening/resizing a side panel preserves the reading paragraph at width ${width}: ${before} -> ${after}`);
  }
  await page.evaluate(() => document.querySelector('iframe').style.removeProperty('width'));
  // The reader can move while a panel is open; closing must retain the new position.
  const next = card.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," message ")][1]').locator('p').filter({ hasText: '说明段落 11：' });
  await next.evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await settle();
  const moved = (await next.boundingBox()).y;
  await page.getByRole('button', { name: '关闭文件预览' }).click();
  await settle();
  const after = (await next.boundingBox()).y;
  assert.ok(Math.abs(after - moved) < 3, `Closing a preview preserves the new reading paragraph: ${moved} -> ${after}`);
  assert.deepEqual(errors, []);
  console.log('PASS: opening, resizing and closing side panels preserve the reading position, including scrolling while a panel is open.');
} finally { await browser.close(); server.closeAllConnections(); server.close(); }
