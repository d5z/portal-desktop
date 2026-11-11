// Exercise the actual bundled React chat against a local protocol fixture.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
const assets = new Map(await Promise.all(['loom.html', 'chat.js', 'chat.css', 'highlight.css'].map(async file => ['/' + file, await readFile('desktop/generated/' + file)])));
const topInset = process.argv.includes('--floating-header') ? 68 : 0;
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
  await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
  page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const origin = 'http://127.0.0.1:' + server.address().port;
  await page.goto(origin);
  const frame = page.frameLocator('#chat');
  const child = () => page.frames().find(frame => frame.url().includes('/loom.html'));
  const post = data => page.evaluate(data => document.querySelector('iframe').contentWindow.postMessage(data, location.origin), data);
  await frame.locator('.message.user').nth(11).waitFor();
  await post({type:'beings:chat-top-inset',value:topInset});
  await child().waitForFunction(value => document.querySelector('.chat-root').style.getPropertyValue('--chat-top-inset') === `${value}px`, topInset);
  const jump=frame.locator('#chat-jump-latest');
  await jump.waitFor({state:'hidden'});
  // Moving through the bottom whitespace does not hide any message.
  await frame.locator('#messages').evaluate(el=>{
    const tail=el.lastElementChild.getBoundingClientRect().bottom;
    const bottom=document.querySelector('#input-area').getBoundingClientRect().top;
    el.scrollTop-=Math.min(12,(bottom-tail)/2);
  });
  await page.waitForTimeout(100);
  assert.equal(await jump.isVisible(),false,'Latest stays hidden while the last message is fully visible');
  // Reveal the shortcut once the last message actually passes behind the composer.
  await frame.locator('#messages').evaluate(el=>{
    const tail=el.lastElementChild.getBoundingClientRect().bottom;
    const bottom=document.querySelector('#input-area').getBoundingClientRect().top;
    el.scrollTop-=bottom-tail+12;
  });
  await jump.waitFor({state:'visible'});
  await jump.click();
  await jump.waitFor({state:'hidden'});
  await frame.locator('#messages').evaluate(el=>{
    const nodes=el.querySelectorAll('.message');
    el.scrollTop+=nodes[nodes.length-11].getBoundingClientRect().bottom-document.querySelector('#input-area').getBoundingClientRect().top+1;
  });
  await child().waitForFunction(()=>document.querySelector('#chat-jump-latest').textContent==='10条消息');
  assert.equal(await jump.evaluate(node=>getComputedStyle(node).borderWidth),'0px');
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/chat-jump-muse-light.png'});
  await child().evaluate(()=>document.documentElement.dataset.theme='dark');
  await page.screenshot({path:'test-results/chat-jump-muse-dark.png'});
  await child().evaluate(()=>document.documentElement.dataset.theme='light');
  await page.setViewportSize({width:435,height:746});
  await child().waitForFunction(()=>{
    const el=document.querySelector('#messages'),bottom=document.querySelector('#input-area').getBoundingClientRect().top;
    const count=[...el.querySelectorAll('.message')].filter(node=>node.getBoundingClientRect().bottom>bottom+2).length;
    return document.querySelector('#chat-jump-latest').textContent===`${count}条消息`;
  });
  const bounds=await jump.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=435);
  await page.screenshot({path:'test-results/chat-jump-muse-narrow.png'});
  await jump.click();await jump.waitFor({state:'hidden'});
  await page.setViewportSize({width:1100,height:850});
  await frame.locator('#input').fill('hold');
  await frame.locator('#send-btn').click();
  await frame.locator('#send-btn.stop').waitFor();
  const messages = frame.locator('#messages');
  const replyOffset = () => messages.evaluate(el => {
    const reply = [...el.querySelectorAll('.message.being')].at(-1);
    return reply ? reply.getBoundingClientRect().top - el.getBoundingClientRect().top : null;
  });
  await frame.getByText('开始回复。', {exact:true}).waitFor();
  // Reply starts near the bottom while content is short (follow-bottom mode).
  assert.ok(await replyOffset() > 100, 'Short reply stays near the bottom, not forced to top');
  // Long replies keep following the live tail, including later bubbles in the same turn.
  for (let i = 0; i < 30; i++) {
    event(heldResponse, 'content_block_delta', { delta: { text: `\n\n跟随测试段落 ${i}，用于填充足够的内容让回复开头超出视口。` } });
  }
  await frame.getByText('跟随测试段落 29').waitFor();
  const expectBottom = async label => {
    const gap = await messages.evaluate(async el => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return el.scrollHeight - el.scrollTop - el.clientHeight;
    });
    assert.ok(Math.abs(gap) < 2, `${label}: bottom gap ${gap}`);
  };
  await expectBottom('Long streaming reply follows the bottom');
  await jump.waitFor({state:'hidden'});
  for (const [step, [width, height]] of [[435,746],[1100,850],[620,500],[1100,850]].entries()) {
    await page.setViewportSize({width,height});
    await expectBottom(`Resize to ${width}×${height} keeps bottom ownership`);
    // Deliver an older programmatic scroll event after new content grows but
    // before ResizeObserver. A new gap is not a reader's upward gesture.
    await messages.evaluate(el => {
      el.querySelector('.message.being:last-of-type').style.paddingBottom = '80px';
      el.dispatchEvent(new Event('scroll'));
    });
    await expectBottom('Delayed scroll after reflow cannot steal bottom ownership');
    await messages.evaluate(el => el.querySelector('.message.being:last-of-type').style.removeProperty('padding-bottom'));
    await expectBottom('Tail shrink after reflow stays pinned');
    const marker = `调整布局 ${step} 后继续推送 ${width}×${height}`;
    event(heldResponse, 'content_block_delta', {delta:{text:`\n\n${marker}`}});
    await frame.getByText(marker, {exact:true}).last().waitFor();
    await expectBottom('Streaming after reflow stays pinned');
  }
  await frame.locator('#input').fill(Array.from({length:12},(_,i)=>`草稿第 ${i} 行`).join('\n'));
  await expectBottom('Growing composer keeps the tail visible');
  await frame.locator('#input').fill('');
  await expectBottom('Shrinking composer keeps the tail visible');
  // Late content above the viewport must not let native anchoring fight the controller.
  await messages.evaluate(el => { el.querySelector('.message').style.minHeight = '900px'; });
  await expectBottom('Late content growth keeps the tail visible');
  await messages.evaluate(el => { el.querySelector('.message').style.minHeight = ''; });
  await expectBottom('Content shrink keeps the tail visible');
  await messages.evaluate(el => { el.querySelector('.message.being:last-of-type').style.paddingBottom = '80px'; });
  await expectBottom('Padding-only layout growth is observed before paint');
  await messages.evaluate(el => el.querySelector('.message.being:last-of-type').style.removeProperty('padding-bottom'));
  await expectBottom('Padding-only shrink stays pinned');
  const bottomBeforeWheel = await messages.evaluate(el => el.scrollTop);
  await messages.hover();
  await page.mouse.wheel(0, -40);
  await child().waitForFunction(top => document.querySelector('#messages').scrollTop < top - 10, bottomBeforeWheel);
  const readingTop = await messages.evaluate(el => el.scrollTop);
  for (let i = 0; i < 5; i++) {
    event(heldResponse, 'content_block_delta', { delta: { text: `\n\n滚动回归段落 ${i}` } });
    await frame.getByText(`滚动回归段落 ${i}`, { exact: true }).waitFor();
    assert.match(await jump.innerText(),/^(1条消息|最新消息)$/,'Streaming text in the same bubble does not increment the message count');
    assert.ok(Math.abs(await messages.evaluate(el => el.scrollTop) - readingTop) < 2,
      'Streaming must preserve the reading position after a small upward scroll');
  }
  const readingAnchor = await messages.evaluate(el => {
    const top = el.getBoundingClientRect().top;
    const boundary = top + parseFloat(getComputedStyle(el).scrollPaddingTop) + 1;
    const node = [...el.querySelectorAll('.message p')].find(node => node.getBoundingClientRect().bottom > boundary);
    node.dataset.readingAnchor = 'true';
    return {offset:node.getBoundingClientRect().top - top};
  });
  for (const width of [435, 1100]) {
    await page.setViewportSize({width,height:850});
    const offset = await messages.evaluate(async el => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return el.querySelector('[data-reading-anchor="true"]').getBoundingClientRect().top - el.getBoundingClientRect().top;
    });
    assert.ok(Math.abs(offset - readingAnchor.offset) < 2, 'Reflow while reading preserves the visible paragraph position');
  }
  await frame.locator('#chat-jump-latest').click();
  await child().waitForFunction(()=>{const el=document.querySelector('#messages');return el.scrollHeight-el.scrollTop-el.clientHeight<2;});
  event(heldResponse, 'content_block_delta', { delta: { text: '\n\n恢复跟随底部' } });
  await frame.getByText('恢复跟随底部', { exact: true }).waitFor();
  assert.ok(await messages.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 2),
    'Returning to latest resumes following streamed output');

  // A tiny upward gesture still belongs to the reader; a downward gesture at
  // the floor must not turn off following when it produces no scroll event.
  await messages.hover();
  await page.mouse.wheel(0, 50);
  event(heldResponse, 'content_block_delta', {delta:{text:'\n\n底部向下滚动后继续推送'}});
  await frame.getByText('底部向下滚动后继续推送', {exact:true}).waitFor();
  await expectBottom('Downward wheel at bottom retains follow');
  const tinyBefore = await messages.evaluate(el => el.scrollTop);
  await page.mouse.wheel(0, -5);
  await child().waitForFunction(top => document.querySelector('#messages').scrollTop < top - 2, tinyBefore);
  const tinyTop = await messages.evaluate(el => el.scrollTop);
  event(heldResponse, 'content_block_delta', {delta:{text:'\n\n轻微上翻时不抢回底部'}});
  await frame.getByText('轻微上翻时不抢回底部', {exact:true}).waitFor();
  assert.ok(Math.abs(await messages.evaluate(el => el.scrollTop) - tinyTop) < 2, 'Small upward wheel is not erased by streaming');
  await page.mouse.wheel(0, 10000);
  await expectBottom('Manual downward scroll returns to bottom');
  event(heldResponse, 'content_block_delta', {delta:{text:'\n\n手动回底部后恢复跟随'}});
  await frame.getByText('手动回底部后恢复跟随', {exact:true}).waitFor();
  await expectBottom('Manual return resumes streaming follow');
  await messages.focus();
  await page.keyboard.press('PageUp');
  await jump.waitFor({state:'visible'});
  // Wait for the browser's keyboard scroll animation to finish.
  await page.waitForTimeout(250);
  const keyboardTop = await messages.evaluate(el => el.scrollTop);
  event(heldResponse, 'content_block_delta', {delta:{text:'\n\n键盘上翻时保留阅读位置'}});
  await frame.getByText('键盘上翻时保留阅读位置', {exact:true}).waitFor();
  assert.ok(Math.abs(await messages.evaluate(el => el.scrollTop) - keyboardTop) < 2, 'Keyboard paging holds reading position');
  await page.keyboard.press('End');
  await jump.waitFor({state:'hidden'});
  await expectBottom('End restores bottom-follow');
  // Scroll events without wheel/keyboard/touch handlers (e.g. scrollbar drag)
  // can arrive after layout growth, so sample movement before following.
  await messages.evaluate(el => { el.scrollTop -= 120; el.querySelector('.message.being:last-of-type')?.style.setProperty('padding-bottom', '120px'); });
  await jump.waitFor({state:'visible'});
  await jump.click();
  await expectBottom('Explicit latest clears the old reading anchor');
  await messages.evaluate(el => el.querySelector('.message.being:last-of-type').style.removeProperty('padding-bottom'));
  await expectBottom('Shrinking the tail does not release follow');

  // Chromium touch input exercises the real native scrolling path.
  const touch = await page.context().newCDPSession(page);
  await touch.send('Emulation.setTouchEmulationEnabled', {enabled:true,maxTouchPoints:1});
  const box = await messages.boundingBox();
  const x = Math.round(box.x + box.width / 2), y = Math.round(box.y + box.height / 3);
  const touchBefore = await messages.evaluate(el => el.scrollTop);
  await touch.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x,y}]});
  for (let i = 1; i <= 10; i++) {
    await touch.send('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:[{x,y:y+i*15}]});
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(100);
  await touch.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
  await child().waitForFunction(top => document.querySelector('#messages').scrollTop < top - 50, touchBefore);
  await page.waitForTimeout(250);
  const touchTop = await messages.evaluate(el => el.scrollTop);
  event(heldResponse, 'content_block_delta', {delta:{text:'\n\n触摸上翻时保留阅读位置'}});
  await frame.getByText('触摸上翻时保留阅读位置', {exact:true}).waitFor();
  assert.ok(Math.abs(await messages.evaluate(el => el.scrollTop) - touchTop) < 2, 'Touch scrolling holds the reading position');
  await jump.click();
  await expectBottom('Latest resumes follow after touch scrolling');
  await touch.send('Emulation.setTouchEmulationEnabled', {enabled:false});
  await touch.detach();
  await page.screenshot({path:'test-results/chat-scroll-follow.png'});

  event(heldResponse, 'message_stop', {});
  event(heldResponse, 'content_block_delta', { delta: { text: '第二条回复开始。' } });
  await frame.getByText('第二条回复开始。', { exact: true }).waitFor();
  for (let i = 0; i < 30; i++) {
    event(heldResponse, 'content_block_delta', { delta: { text: `\n\n第二条跟随段落 ${i}，验证同一轮回复经过工具阶段后仍会跟随底部。` } });
  }
  await frame.getByText('第二条跟随段落 29').waitFor();
  await expectBottom('A later reply in the same turn follows the bottom');
  event(heldResponse, 'message_stop', {});
  await browser.contexts()[0].grantPermissions(['clipboard-read', 'clipboard-write']);
  const copyTarget = frame.locator('.message.being:not(.thinking-indicator):not(.consecutive)').last();
  await copyTarget.hover();
  await copyTarget.getByRole('button', { name: '复制正文', exact: true }).click();
  await copyTarget.getByRole('button', { name: '已复制', exact: true }).waitFor();
  assert.match(await child().evaluate(() => navigator.clipboard.readText()), /开始回复/);
  assert.deepEqual(errors, []);
  console.log('PASS: long and same-turn replies follow bottom; viewport/composer/content resizing preserves follow; upward scroll holds reading position; latest resumes follow; message copy works.');
} catch (error) {
  await mkdir('test-results', {recursive:true});
  await browser.contexts()[0].tracing.stop({path:`test-results/chat-scroll${topInset ? '-floating-header' : ''}-trace.zip`});
  throw error;
} finally {
  heldResponse?.end(); await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
