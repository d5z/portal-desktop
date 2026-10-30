// Exercise the actual bundled React chat against a local protocol fixture.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const assets = new Map(await Promise.all(['loom.html', 'chat.js', 'chat.css', 'highlight.css'].map(async file => ['/' + file, await readFile('desktop/generated/' + file)])));
let seq = 1, heldResponse = null;
const history = [];
for (let i = 0; i < 100; i++) {
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
  browser = await chromium.launch({headless:true,channel:'chrome'});
  const page = await browser.newPage({viewport:{width:1100,height:850}});
  page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);
  const frame=page.frameLocator('#chat');
  await frame.getByText('being 历史 99',{exact:true}).waitFor();
  const count=()=>frame.locator('.message').count();
  assert.ok(await count()<=40, 'Initial history must render only the latest page');
  const messages=frame.locator('#messages');
  // One index click must survive the synchronous highlight render and later layout.
  for (const question of [85, 92]) {
    const tick=frame.getByRole('button',{name:new RegExp(`跳转到提问 .*user 历史 ${question}`)});
    await tick.click();
    await page.waitForTimeout(200);
    const position=await messages.evaluate((el,question)=>{
      const target=[...el.querySelectorAll('.message.user')].find(node=>node.textContent.includes(`user 历史 ${question}`));
      return target.getBoundingClientRect().top-el.getBoundingClientRect().top;
    },question);
    assert.ok(Math.abs(position-24)<3,`Single index click must land on question ${question}, got offset ${position}`);
  }
  await frame.getByRole('button',{name:'回到底部',exact:true}).click();
  await messages.hover();
  await page.mouse.wheel(0,-50);
  await page.waitForTimeout(100);
  // Prepend before the reader reaches the top, not after hitting an empty edge.
  await messages.evaluate(el=>{el.scrollTop=700;});
  await page.waitForFunction(() => document.querySelector('#chat').contentDocument.querySelectorAll('.message').length > 40, undefined, {timeout:2000});
  await frame.locator('.history-page-loading').waitFor({state:'detached'});
  const anchor=await messages.evaluate(el=>{
    const top=el.getBoundingClientRect().top;
    const node=[...el.querySelectorAll('.message')].find(n=>n.getBoundingClientRect().bottom>top+2);
    return {id:node.dataset.messageId,offset:node.getBoundingClientRect().top-top};
  });
  const before=await count();
  await page.waitForTimeout(400);
  const offset=await messages.evaluate((el,id)=>el.querySelector(`[data-message-id="${id}"]`).getBoundingClientRect().top-el.getBoundingClientRect().top,anchor.id);
  assert.ok(Math.abs(offset-anchor.offset)<3,'Reading position must settle without jumping after prepend');
  assert.ok(before>40,'Scrolling to top loads older history');
  // A resize and user scroll can happen in one frame before scroll dispatch.
  // Layout compensation must retain the 80px user movement, not cancel it.
  const race=await messages.evaluate(async el=>{
    const top=el.getBoundingClientRect().top;
    const target=[...el.querySelectorAll('.message')].find(n=>n.getBoundingClientRect().top>=top);
    const before=target.getBoundingClientRect().top-top;
    const earlier=el.querySelector('.message');
    earlier.style.minHeight=(earlier.getBoundingClientRect().height+180)+'px';
    el.scrollTop-=80;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    return {movement:target.getBoundingClientRect().top-el.getBoundingClientRect().top-before};
  });
  assert.ok(Math.abs(race.movement-80)<3,`Resize must preserve user scroll: ${JSON.stringify(race)}`);
  // Repeated late content growth above the viewport must settle before paint.
  const growth=await messages.evaluate(async el=>{
    const top=el.getBoundingClientRect().top;
    const target=[...el.querySelectorAll('.message')].find(n=>n.getBoundingClientRect().top>=top);
    const expected=target.getBoundingClientRect().top-top, shifts=[];
    const earlier=el.querySelector('.message');
    for(let i=0;i<8;i++){
      earlier.style.minHeight=(earlier.getBoundingClientRect().height+35)+'px';
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      shifts.push(Math.abs(target.getBoundingClientRect().top-el.getBoundingClientRect().top-expected));
    }
    return shifts;
  });
  assert.ok(Math.max(...growth)<3,`Late content must preserve anchor: ${growth}`);
  // Load more and keep the existing bubbles mounted throughout each page.
  const stable=await frame.locator('.message').last().getAttribute('data-message-id');
  for(let i=0;i<3;i++){
    const previousCount=await count();
    await messages.hover();await page.mouse.wheel(0,-100000);
    await page.waitForFunction(previous => document.querySelector('#chat').contentDocument.querySelectorAll('.message').length > previous,previousCount);
    await frame.locator('.history-page-loading').waitFor({state:'detached'});
    assert.equal(await frame.locator(`[data-message-id="${stable}"]`).count(),1);
  }
  assert.ok(await count()>before);
  await frame.locator('#chat-jump-latest').click();
  await page.waitForFunction(()=>{
    const doc=document.querySelector('#chat').contentDocument,el=doc.querySelector('#messages');
    return doc.querySelectorAll('.message').length<=40&&el.scrollHeight-el.scrollTop-el.clientHeight<2;
  });
  await frame.getByText('being 历史 99',{exact:true}).waitFor();
  await page.reload();
  await frame.getByText('being 历史 99',{exact:true}).waitFor();
  assert.ok(await count()<=60,'Cached reload must also bound initial history');
  assert.deepEqual(errors,[]);
  console.log('PASS: bounded initial/cache history, incremental prepend, stable reader and retained DOM.');
} finally {await browser?.close();heldResponse?.end();server.closeAllConnections();await new Promise(r=>server.close(r));}
