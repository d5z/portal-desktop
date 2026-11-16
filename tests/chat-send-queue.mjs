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
  const input=page.getByRole('textbox',{name:'message input'});
  await input.fill('开始任务');await input.press('Enter');
  await page.getByRole('button',{name:'停止处理',exact:true}).waitFor();
  await input.fill('稍后发送');await input.press('Control+Enter');
  await page.locator('.composer-queue-item').filter({hasText:'稍后发送'}).waitFor();
  await input.fill('优先处理');await page.getByRole('button',{name:'加入队列',exact:true}).click();
  await page.locator('.composer-queue-item').filter({hasText:'优先处理'}).waitFor();
  assert.equal(sends.length,1);
  assert.equal(await page.locator('.message.user').count(),1);
  await page.getByRole('button',{name:'取消排队：稍后发送',exact:true}).click();
  await page.locator('.composer-queue-item').filter({hasText:'稍后发送'}).waitFor({state:'detached'});
  await input.fill('保留草稿');
  await page.locator('.composer-queue-item').getByRole('button',{name:'调整方向',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.composer-queue-item'));
  assert.equal(sends.length,2);
  assert.equal(sends[1].message,'优先处理');
  assert.equal(await input.evaluate(el=>el.value??el.editor.getMarkdown()),'保留草稿');
  assert.equal(await page.locator('.message.user').filter({hasText:'优先处理'}).count(),1);
  await input.fill('下一个任务');await input.press('Control+Enter');
  await page.locator('.composer-queue-item').waitFor();
  await input.fill('直接调整');await input.press('Enter');
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
  const queuePanel = page.locator('.composer-queue');
  const inputArea = page.locator('#input-area');
  for (const [width, height] of [[1280,800], [375,800], [363,204]]) {
    await page.setViewportSize({width,height});
    const queue = await queuePanel.boundingBox();
    const composer = await inputArea.boundingBox();
    assert.ok(queue.x > composer.x && queue.x + queue.width < composer.x + composer.width, 'Queue is inset inside both composer edges');
    assert.ok(queue.y < composer.y && queue.y + queue.height > composer.y, 'Queue tucks under the top edge of the composer');
    await input.fill('草稿第一行\n草稿第二行\n草稿第三行');
    const expandedQueue = await queuePanel.boundingBox();
    const expandedComposer = await inputArea.boundingBox();
    assert.ok(expandedComposer.y < composer.y, 'A multiline draft grows upward');
    assert.equal(queue.y - expandedQueue.y, composer.y - expandedComposer.y, 'Queue moves with the composer');
    assert.ok(expandedQueue.y >= 0, 'Queue remains visible above a multiline draft in a short split panel');
    assert.ok(expandedComposer.y + expandedComposer.height < height, 'Composer remains inside the viewport');
    await queuePanel.getByRole('button',{name:'取消排队：平台快捷键排队',exact:true}).click({trial:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await input.fill('');
  }
  const queuedText = '平台快捷键排队';
  await queuePanel.getByRole('button',{name:`编辑排队消息：${queuedText}`,exact:true}).click();
  await input.fill('多行修改\n'.repeat(12) + '最后一行');
  const editingQueueBounds = await queuePanel.boundingBox();
  assert.ok(editingQueueBounds.y >= 0, 'Editing a long queued message keeps the queue inside a short split panel');
  await queuePanel.getByRole('button',{name:`取消排队：${queuedText}`,exact:true}).click({trial:true});
  await page.getByRole('button',{name:'取消编辑',exact:true}).click();
  await mkdir('test-results',{recursive:true});
  await page.locator('.composer-stack').screenshot({path:'test-results/chat-send-queue-short.png'});
  await page.setViewportSize({width:375,height:800});
  await page.screenshot({path:'test-results/chat-send-queue.png',fullPage:true});
  await page.setViewportSize({width:1280,height:800});
  await page.locator('html').evaluate(el => el.dataset.theme = 'dark');
  await page.locator('.composer-stack').screenshot({path:'test-results/chat-send-queue-dark.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS: same-scene queue, cancel, interrupt, single echo, preserved draft and mobile layout');
}finally{stream?.end();await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
