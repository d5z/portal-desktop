// Exercise the actual bundled React chat against a local protocol fixture.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const assets = new Map(await Promise.all(['loom.html', 'chat.js', 'chat.css', 'highlight.css'].map(async file => ['/' + file, await readFile('desktop/generated/' + file)])));
let seq = 1, heldResponse = null;
const history = [];
for (let i = 0; i < 12; i++) {
  for (const role of ['user', 'being']) history.push({ seq: seq++, role, content: `${role} 历史 ${i}\n\n第二段\n\n第三段`, scene_id: 'desktop-fixture', at: new Date().toISOString() });
}
const event = (response, name, data) => response.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const json = data => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data)); };
  if (url.pathname === '/api/history') return json({ messages: history });
  if (url.pathname === '/api/status') return json({ being_name: 'Willow' });
  if (url.pathname === '/api/llm/config') return json({ sbs_enabled: false });
  if (url.pathname === '/api/stream/active') { response.writeHead(204); response.end(); return; }
  if (url.pathname === '/api/chat/stream') {
    for await (const chunk of request) {} // Consume the request before holding the stream open.
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    heldResponse = response;
    event(response, 'meta', { stream_id: 'scroll-fixture' });
    event(response, 'thinking', { text: '思考中' });
    event(response, 'content_block_delta', { delta: { text: '开始回复。' } });
    return;
  }
  if (assets.has(url.pathname)) {
    response.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
    response.end(assets.get(url.pathname)); return;
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><html><meta charset="utf-8"><style>body{margin:0}iframe{border:0;width:100vw;height:100vh}</style><iframe id="chat" src="/loom.html?revision=fixture&scene_id=desktop-fixture&scene_label=Desktop"></iframe><script>
    window.received=[];
    window.addEventListener('message', event => {
      if(event.source!==document.querySelector('iframe').contentWindow) return;
      window.received.push(event.data);
      if(event.data.type==='beings:scene-capture') event.source.postMessage({type:'beings:scene-captured',id:event.data.id},location.origin);
    });
  </script></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const origin = 'http://127.0.0.1:' + server.address().port;
  await page.goto(origin);
  const frame = page.frameLocator('#chat');
  const child = () => page.frames().find(frame => frame.url().includes('/loom.html'));
  const post = data => page.evaluate(data => document.querySelector('iframe').contentWindow.postMessage(data, location.origin), data);
  await frame.locator('.chat-index-tick').nth(11).waitFor();
  await frame.locator('#input').fill('hold');
  await frame.locator('#send-btn').click();
  await frame.locator('.run-activity.running .run-stop').waitFor();
  const messages = frame.locator('#messages');
  const replyOffset = () => messages.evaluate(el => {
    const reply = [...el.querySelectorAll('.message.being')].at(-1);
    return reply ? reply.getBoundingClientRect().top - el.getBoundingClientRect().top : null;
  });
  // Reply starts near the bottom while content is short (follow-bottom mode).
  assert.ok(await replyOffset() > 100, 'Short reply stays near the bottom, not forced to top');
  // Stream enough content so the reply start scrolls out of view, triggering anchor.
  for (let i = 0; i < 30; i++) {
    event(heldResponse, 'content_block_delta', { delta: { text: `\n\n锚定测试段落 ${i}，用于填充足够的内容让回复开头超出视口。` } });
  }
  await frame.getByText('锚定测试段落 29').waitFor();
  const anchoredOffset = await replyOffset();
  const anchorMetrics = await messages.evaluate((el, offset) => ({
    anchoredOffset: offset,
    scrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    bottomGap: el.scrollHeight - el.scrollTop - el.clientHeight,
  }), anchoredOffset);
  assert.ok(Math.abs(anchoredOffset - 20) < 5, `Long reply anchors its start near the viewport top (${JSON.stringify(anchorMetrics)})`);
  // Small trackpad micro-movements must NOT release the anchor (accumulated threshold).
  await messages.hover();
  await page.mouse.wheel(0, -5);
  await new Promise(r => setTimeout(r, 100));
  assert.ok(Math.abs(await replyOffset() - 20) < 5, 'Tiny wheel delta does not release anchor');
  // Larger intentional scroll releases the anchor.
  await page.mouse.wheel(0, -40);
  await new Promise(r => setTimeout(r, 100));
  // Resume: click latest, then verify follow-bottom works.
  await frame.locator('#chat-index-latest').click();
  const bottomBeforeWheel = await messages.evaluate(el => el.scrollTop);
  await messages.hover();
  await page.mouse.wheel(0, -40);
  await child().waitForFunction(top => document.querySelector('#messages').scrollTop < top - 10, bottomBeforeWheel);
  const readingTop = await messages.evaluate(el => el.scrollTop);
  for (let i = 0; i < 5; i++) {
    event(heldResponse, 'content_block_delta', { delta: { text: `\n\n滚动回归段落 ${i}` } });
    await frame.getByText(`滚动回归段落 ${i}`, { exact: true }).waitFor();
    assert.ok(Math.abs(await messages.evaluate(el => el.scrollTop) - readingTop) < 2,
      'Streaming must preserve the reading position after a small upward scroll');
  }
  await frame.locator('#chat-index-latest').click();
  event(heldResponse, 'content_block_delta', { delta: { text: '\n\n恢复跟随底部' } });
  await frame.getByText('恢复跟随底部', { exact: true }).waitFor();
  assert.ok(await messages.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 2),
    'Returning to latest resumes following streamed output');

  event(heldResponse, 'message_stop', {});
  event(heldResponse, 'content_block_delta', { delta: { text: '第二条回复开始。' } });
  await frame.getByText('第二条回复开始。', { exact: true }).waitFor();
  for (let i = 0; i < 30; i++) {
    event(heldResponse, 'content_block_delta', { delta: { text: `\n\n第二条锚定段落 ${i}，验证同一轮回复经过工具阶段后仍会重新锚定。` } });
  }
  await frame.getByText('第二条锚定段落 29').waitFor();
  assert.ok(Math.abs(await replyOffset() - 20) < 5, 'A later reply in the same turn anchors independently');
  event(heldResponse, 'message_stop', {});
  await browser.contexts()[0].grantPermissions(['clipboard-read', 'clipboard-write']);
  const copyTarget = frame.locator('.message.being:not(.thinking-indicator):not(.consecutive)').last();
  await copyTarget.hover();
  await copyTarget.getByRole('button', { name: '复制正文', exact: true }).click();
  await copyTarget.getByRole('button', { name: '已复制', exact: true }).waitFor();
  assert.match(await child().evaluate(() => navigator.clipboard.readText()), /开始回复/);
  assert.deepEqual(errors, []);
  console.log('PASS: short reply stays at bottom; long and later same-turn replies anchor at top; tiny wheel keeps anchor; intentional scroll releases; reading position stable; latest resumes follow; message copy works.');
} finally {
  heldResponse?.end(); await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
