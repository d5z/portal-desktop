// Real bundled chat: long Markdown must fit even a 300px split pane.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const assets = new Map(await Promise.all(['loom.html','chat.js','chat.css','highlight.css'].map(async f => ['/'+f,await readFile('desktop/generated/'+f)])));
const long = 'very_long_identifier_'.repeat(35);
const bodies = [
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
  await frame.locator('.message').nth(9).waitFor();
  await mkdir('test-results',{recursive:true});
  await frame.locator('#file-input').setInputFiles([{name:'很长的附件名称'.repeat(18)+'.txt',mimeType:'text/plain',buffer:Buffer.from('layout fixture')},{name:'第二份附件.txt',mimeType:'text/plain',buffer:Buffer.from('layout fixture')}]);
  await frame.getByRole('button',{name:'移除 第二份附件.txt'}).waitFor();
  for(const width of [1100,640,380,300]){
    await page.setViewportSize({width,height:800});
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
  console.log('PASS: chat Markdown, attachments and composer fit 1100/640/380/300px, with intact code and vertical reading.');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
