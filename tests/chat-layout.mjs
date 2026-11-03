// Real bundled chat: long Markdown must fit even a 300px split pane.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const assets = new Map(await Promise.all(['loom.html','chat.js','chat.css','highlight.css'].map(async f => ['/'+f,await readFile('desktop/generated/'+f)])));
const long = 'very_long_identifier_'.repeat(35);
const bodies = [
  '你好',
  'Hi',
  '这是一条短消息',
  '布局检查：长链接与行内代码\n\nhttps://example.com/'+long+'\n\n`'+long+'`',
  '代码应完整换行，复制时保留原文。\n\n```javascript\nconst result = "'+long+'";\n```',
  '| 场景 | 内容 | 状态 |\n| --- | --- | --- |\n| 日常对话 | '+long+' | 已完成 |',
  '> 多层列表\n> - '+long+'\n>   - '+long,
  '![布局检查](data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="160"><rect width="1600" height="160" fill="#cce5ff"/></svg>').toString('base64')+')',
];
const history = bodies.flatMap((content,i)=>['being','user'].map((role,j)=>({seq:i*2+j+1,role,content,scene_id:'layout',at:'2026-10-10T08:00:00Z'})));
const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/wide.svg'){res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="160"><rect width="1600" height="160" fill="#cce5ff"/></svg>');return;}
  if(assets.has(url.pathname)){res.setHeader('Content-Type',url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(assets.get(url.pathname));return;}
  if(url.pathname==='/api/stream/active'){res.writeHead(204);res.end();return;}
  if(url.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(url.pathname==='/api/history'?{messages:history}:{being_name:'Willow',sbs_enabled:false}));return;}
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><style>body{margin:0}iframe{display:block;border:0;width:100vw;height:100vh}</style><iframe src="/loom.html?scene_id=layout&scene_label=布局检查"></iframe>');
});
await new Promise(r=>server.listen(Number(process.env.CHAT_LAYOUT_PORT)||0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
history.slice(-2).forEach(row=>row.content='![布局检查]('+origin+'/wide.svg)');
if(process.env.CHAT_LAYOUT_PREVIEW){console.log(origin);await new Promise(()=>{});}
let browser;
try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({reducedMotion:'reduce'});
  await page.goto(origin);
  const frame=page.frameLocator('iframe');
  await frame.locator('.message').nth(history.length - 1).waitFor();
  await mkdir('test-results',{recursive:true});
  await frame.locator('#file-input').setInputFiles([{name:'很长的附件名称'.repeat(18)+'.txt',mimeType:'text/plain',buffer:Buffer.from('layout fixture')},{name:'第二份附件.txt',mimeType:'text/plain',buffer:Buffer.from('layout fixture')}]);
  await frame.getByRole('button',{name:'移除 第二份附件.txt'}).waitFor();
  for(const width of [1100,640,380,300]){
    await page.setViewportSize({width,height:800});
    // A side action must not make short messages wrap inside a second percentage width.
    for (const role of ['being', 'user']) {
      for (const text of bodies.slice(0, 3)) {
        const paragraph = frame.locator(`.message.${role} .content p`).filter({hasText: new RegExp(`^${text}$`)});
        const metrics = await paragraph.evaluate(el => ({height: el.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(el).lineHeight)}));
        assert.ok(metrics.height <= metrics.lineHeight + 1, `${role} "${text}" should stay on one line at ${width}px`);
      }
      const row = frame.locator(`.message.${role}`).first();
      const bubble = row.locator('.content');
      const copy = row.getByRole('button', { name: '复制正文', exact: true });
      await bubble.hover();
      const before = await bubble.boundingBox();
      const button = await copy.boundingBox();
      assert.ok(role === 'user' ? button.x + button.width <= before.x : button.x >= before.x + before.width, 'Copy stays outside the bubble');
      await copy.hover();
      assert.deepEqual(await bubble.boundingBox(), before, 'Hover does not resize or move the bubble');
      assert.equal(await copy.evaluate(el => getComputedStyle(el).opacity), '1');
    }
    const overflow=await frame.locator('#messages, .message, .message .content, .code-block, .table-wrap, #input-area, #pending-files, .pending-file').evaluateAll(nodes=>nodes.filter(n=>n.scrollWidth>n.clientWidth+1).map(n=>({element:n.id||n.className,width:n.clientWidth,contentWidth:n.scrollWidth})));
    assert.deepEqual(overflow,[],`Horizontal overflow at ${width}px`);
    assert.equal(await frame.locator('#chat-index').count(),1);
    await frame.locator('#input').fill(long);
    assert.ok(await frame.locator('#input').evaluate(n=>n.scrollWidth<=n.clientWidth+1));
    assert.ok(await frame.locator('#messages').evaluate(n=>n.scrollHeight>n.clientHeight),'Vertical reading must remain available');
    await page.screenshot({path:`test-results/chat-layout-${width}.png`});
  }
  await frame.locator('html').evaluate(n=>n.dataset.theme='dark');
  await page.screenshot({path:'test-results/chat-layout-dark.png'});
  // Wrapping must never rewrite the copyable source.
  assert.equal(await frame.locator('.message.being .code-block code').textContent(),'const result = "'+long+'";');
  const keyboardCopy = frame.locator('.message.being').first().getByRole('button', {name:'复制正文',exact:true});
  await page.mouse.move(0, 0);
  await keyboardCopy.focus();
  assert.equal(await keyboardCopy.evaluate(el => getComputedStyle(el).opacity), '1', 'Keyboard focus reveals Copy without hovering');
  assert.equal(await keyboardCopy.evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
  const touchPage = await browser.newPage({hasTouch:true,viewport:{width:380,height:800},reducedMotion:'reduce'});
  await touchPage.goto(origin);
  const touchCopy = touchPage.frameLocator('iframe').getByRole('button', {name:'复制正文',exact:true}).first();
  await touchCopy.waitFor();
  assert.equal(await touchCopy.evaluate(el => getComputedStyle(el).opacity), '1', 'Touch users can discover Copy without hovering');
  assert.equal(await touchCopy.evaluate(el => getComputedStyle(el).pointerEvents), 'auto');
  assert.equal((await touchCopy.boundingBox()).width, 32);
  await touchPage.close();
  console.log('PASS: chat Markdown, attachments and composer fit 1100/640/380/300px, with intact code and vertical reading.');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
