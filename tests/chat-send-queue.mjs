import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const assets = new Map(await Promise.all(['loom.html','chat.js','chat.css','highlight.css'].map(async f=>['/'+f,await readFile('desktop/generated/'+f)])));
const sends=[];
let stream;
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
  if(assets.has(url.pathname)){res.setHeader('Content-Type',url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':'text/html; charset=utf-8');return res.end(assets.get(url.pathname));}
  if(url.pathname==='/health')return res.end('OK fixture');
  if(url.pathname==='/api/history')return json({messages:[]});
  if(url.pathname==='/api/stream/active'){res.writeHead(204);return res.end();}
  if(url.pathname==='/api/chat/stream'){
    let body='';for await(const chunk of req)body+=chunk;sends.push(JSON.parse(body));
    if(sends.length>1){res.writeHead(202);return res.end('{}');}
    stream=res;res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.write('event: reasoning\ndata: {"text":"处理中"}\n\n');return;
  }
  json({sbs_enabled:false,being_name:'Fixture',presets:[]});
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage();page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/loom.html?scene_id=queue-test&scene_strict=1`);
  const input=page.getByRole('textbox',{name:'消息输入框'});
  const sendControl = page.locator('#send-btn');
  await sendControl.and(page.getByRole('button',{name:'发送消息',exact:true})).waitFor();
  await input.fill('开始任务');await input.press('Enter');
  await page.getByRole('button',{name:'停止处理',exact:true}).waitFor();
  const stopGlyph = sendControl.locator('svg rect');
  await stopGlyph.waitFor();
  const { width: stopWidth, height: stopHeight } = await stopGlyph.boundingBox();
  assert.ok(stopWidth >= 9 && stopHeight >= 9, 'Desktop stop glyph must fit the standard composer icon size');
  await input.fill('反向检查');
  await sendControl.and(page.getByRole('button',{name:'引导',exact:true})).waitFor();
  await input.fill('稍后发送');
  assert.equal(await page.getByRole('button',{name:'停止处理',exact:true}).count(),0);
  await input.press('Control+Enter');
  await page.locator('.composer-queue-item').filter({hasText:'稍后发送'}).waitFor();
  await sendControl.locator('svg rect').waitFor();
  assert.equal(await sendControl.getAttribute('aria-label'),'停止处理','An empty composer keeps the active turn stop action while messages are queued');
  await input.fill('优先处理');
  const send = page.locator('#send-btn[aria-label="引导"]');
  const tip = page.getByRole('group',{name:'发送选项'});
  assert.equal(await tip.count(),0);
  await send.hover();
  await tip.getByRole('button',{name:'排队',exact:true}).waitFor();
  assert.deepEqual(await tip.getByRole('button').allTextContents(), ['引导↵', /Mac/.test(await page.evaluate(() => navigator.platform)) ? '排队⌘ ↵' : '排队Ctrl ↵']);
  const menuBounds = await tip.boundingBox();
  const sendBounds = await send.boundingBox();
  await page.mouse.move(sendBounds.x + 1, sendBounds.y + sendBounds.height * 0.55);
  await page.mouse.move(sendBounds.x - 12, sendBounds.y + 2);
  await page.waitForTimeout(75);
  await page.mouse.move(menuBounds.x + 10, menuBounds.y + 10, { steps: 6 });
  await page.waitForTimeout(220);
  assert.equal(await tip.isVisible(),true);
  assert.ok(await input.evaluate(node => node === document.activeElement));
  await page.keyboard.press('Escape');
  await tip.waitFor({state:'detached'});
  assert.ok(await input.evaluate(node => node === document.activeElement));
  await send.hover();
  await tip.waitFor();
  await page.mouse.move(0, 0);
  await tip.waitFor({state:'detached'});
  await send.press('ArrowUp');
  await page.setViewportSize({width:375,height:800});
  const bounds=await tip.boundingBox();
  assert.ok(bounds.x>=0 && bounds.x+bounds.width<=375);
  await page.keyboard.press('Tab');
  assert.equal(await tip.getByRole('button',{name:'引导',exact:true}).evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Tab');
  assert.equal(await tip.getByRole('button',{name:'排队',exact:true}).evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Enter');
  await page.locator('.composer-queue-item').filter({hasText:'优先处理'}).waitFor();
  assert.equal(sends.length,1);
  assert.equal(await page.locator('.message.user').count(),1);
  const later = page.locator('.composer-queue-item').filter({hasText:'稍后发送'});
  assert.deepEqual(await later.locator('.composer-queue-row-actions button').evaluateAll(
    buttons => buttons.map(button => button.getAttribute('aria-label'))
  ), ['引导','编辑消息：稍后发送','取消排队：稍后发送']);
  assert.equal(await later.locator(':is(.composer-queue-leading, .composer-queue-drag-handle) > svg').count(), 1);
  const summary = later.getByRole('button', { name: /^预览第/ });
  const preview = page.getByRole('dialog', { name: '待发消息预览' });
  await summary.hover();
  await page.waitForTimeout(800);
  assert.equal(await preview.count(), 0, 'hover leaves the queue preview closed');
  await summary.click();
  await preview.waitFor();
  await page.keyboard.press('Escape');
  await preview.waitFor({ state: 'detached' });
  await later.hover();
  await later.getByRole('button',{name:'取消排队：稍后发送',exact:true}).click();
  await page.locator('.composer-queue-item').filter({hasText:'稍后发送'}).waitFor({state:'detached'});
  await input.fill('');
  await input.press('ArrowUp');
  const editing = page.locator('#input').and(page.getByRole('textbox', { name: '编辑待发消息', exact: true }));
  await editing.waitFor();
  assert.equal(await editing.evaluate(el=>el.value??el.editor.getMarkdown()), '优先处理');
  await editing.press('Escape');
  await input.and(page.locator(':focus')).waitFor();
  await input.fill('保留草稿');
  const editPriority = page.getByRole('button', { name: '编辑消息：优先处理', exact: true });
  await editPriority.press('Enter');
  await editing.waitFor();
  assert.equal(await page.locator('.composer-queue-item').filter({hasText:'优先处理'}).count(), 0);
  assert.equal(await page.locator('#input').count(), 1);
  await editing.fill('准备优先处理');
  await editing.press('Escape');
  await input.and(page.locator(':focus')).waitFor();
  await editPriority.waitFor();
  assert.equal(await input.evaluate(el=>el.value??el.editor.getMarkdown()),'保留草稿');
  await editPriority.locator('xpath=ancestor::*[@data-queue-id]').hover();
  await editPriority.click();
  await editing.and(page.locator(':focus')).waitFor();
  await editing.fill('已编辑优先处理');
  await editing.press('Enter');
  await page.getByRole('button', { name: '编辑消息：已编辑优先处理', exact: true }).waitFor();
  assert.equal(sends.length, 1);
  assert.equal(await input.evaluate(el=>el.value??el.editor.getMarkdown()),'保留草稿');
  const next = page.locator('.composer-queue-item');
  await next.hover();
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/api/chat/stream') && response.status() === 202),
    next.getByRole('button',{name:'引导',exact:true}).click(),
  ]);
  await page.waitForFunction(()=>!document.querySelector('.composer-queue-item'));
  assert.equal(sends.length,2);
  assert.equal(sends[1].message,'已编辑优先处理');
  assert.equal(await input.evaluate(el=>el.value??el.editor.getMarkdown()),'保留草稿');
  assert.equal(await page.locator('.message.user').filter({hasText:'已编辑优先处理'}).count(),1);
  await input.fill('下一个任务');await input.press('Control+Enter');
  await page.locator('.composer-queue-item').waitFor();
  await input.fill('直接调整');
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/api/chat/stream') && response.status() === 202),
    input.press('Enter'),
  ]);
  await page.waitForFunction(()=>[...document.querySelectorAll('.message.user')].some(el=>el.textContent.includes('直接调整')));
  assert.equal(sends.at(-1).message,'直接调整');
  assert.equal(await page.locator('.composer-queue-item').count(),1,'Enter leaves pending queue intact');
  const before=sends.length;
  await input.fill('第一行');await input.press('Shift+Enter');await input.press('a');
  assert.ok((await input.evaluate(el=>el.value??el.editor.getMarkdown())).includes('\n'));
  assert.equal(sends.length,before);
  await input.dispatchEvent('compositionstart');await input.press('Enter');
  assert.equal(sends.length,before,'IME confirmation must not send');
  await input.dispatchEvent('compositionend');
  // Each CI OS exercises its native modifier. Spoofing navigator.platform after
  // mount does not update the rendered key handler or the host's Meta key behavior.
  await input.fill('平台快捷键排队');await page.waitForTimeout(60);await input.press('ControlOrMeta+Enter');
  await page.locator('.composer-queue-item').filter({hasText:'平台快捷键排队'}).waitFor();
  assert.equal(sends.length,before);
  await input.fill('触屏排队');
  const touchSend=page.locator('#send-btn');
  await touchSend.dispatchEvent('pointerdown',{pointerType:'touch',bubbles:true});
  await touchSend.dispatchEvent('click');
  await tip.getByRole('button',{name:'引导',exact:true}).waitFor();
  await tip.getByRole('button',{name:'排队',exact:true}).click();
  await page.locator('.composer-queue-item').filter({hasText:'触屏排队'}).waitFor();
  assert.equal(sends.length,before);
  await page.setViewportSize({width:375,height:800});
  await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/chat-send-queue.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
  // A reload can leave a durable sending record without matching history.
  // Removing it must release later messages without resending the uncertain one.
  const recovered=await browser.newPage();
  await recovered.goto(page.url());
  await recovered.getByRole('textbox',{name:'消息输入框'}).waitFor();
  await recovered.evaluate(async()=>{
    const request=indexedDB.open('portal-scene-outbox',1);
    const db=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    await new Promise((resolve,reject)=>{
      const transaction=db.transaction('sends','readwrite');
      const store=transaction.objectStore('sends');
      for(const [index,text] of ['未确认的旧消息','恢复后继续发送'].entries())store.put({
        id:`recovery-${index}`,endpoint:location.origin,scene:{sceneId:'queue-test',strict:true},text,files:[],
        createdAt:Date.now(),order:index,phase:index===0?'sending':'queued',
      });
      transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);
    });
    db.close();
  });
  const sendsBeforeRecovery=sends.length;
  await recovered.reload();
  const removeUncertain=recovered.getByRole('button',{name:'移除待发记录：未确认的旧消息',exact:true});
  await removeUncertain.waitFor();
  assert.equal(sends.length,sendsBeforeRecovery,'An uncertain send must not be automatically retried');
  await Promise.all([
    recovered.waitForResponse(response=>response.url().endsWith('/api/chat/stream') && response.status()===202),
    removeUncertain.click(),
  ]);
  await recovered.locator('.message.user').filter({hasText:'恢复后继续发送'}).waitFor();
  assert.equal(sends.length,sendsBeforeRecovery+1);
  assert.equal(sends.at(-1).message,'恢复后继续发送');
  await recovered.close();
  console.log('PASS: same-scene queue, cancel, interrupt, single echo, preserved draft and mobile layout');
}finally{stream?.end();await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
