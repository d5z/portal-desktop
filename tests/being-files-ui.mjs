import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { build } from '../scripts/renderer-build.mjs';
const runtimeBundle = await build({ entryPoints: ['desktop/main/app/html-preview.ts'], bundle: true, write: false, format: 'esm' });
const { HTML_PREVIEW_RUNTIME, htmlPreviewPolicy } = await import('data:text/javascript;base64,' + Buffer.from(runtimeBundle.outputFiles[0].contents).toString('base64'));
const fixtureOptions = { plugins: [{ name: 'preview-protocol-fixture', setup(builder) {
  builder.onLoad({ filter: /home-file-preview\.tsx$/ }, async args => ({ loader: 'tsx', contents: (await readFile(args.path, 'utf8')).replace('beings://preview/runtime.html', '/runtime.html') }));
} }], stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
  import { createRoot } from 'react-dom/client';
  import { useRef, useState } from 'react';
  import { Markdown } from './desktop/renderer/shared/components/markdown';
  import { HomeFileViewer } from './desktop/renderer/app/components/home-file-viewer';
  import './desktop/renderer/app/styles.scss';
  const path='artifacts/20261104-delivery-v5/index.html';
  const url='https://home.beings.town/v1/me/files/content?path='+path;
  const receipt={type:'being.files',version:1,files:[{path,url,name:'文件交付链路测试',size:5446,content_type:'text/html',caption:'云电脑生成 · 自包含 · 无外链'}]};
  const listeners=new Set(); let state={authenticated:true,authenticating:false,username:'fixture',binding:'matched'};
  window.calls=[];window.downloads=[];window.notices=[];
  window.setHome=patch=>{state={...state,...patch};listeners.forEach(fn=>fn(state));};
  const api={state:async()=>state,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},files:{
    list:async()=>({entries:[]}),
    preview:async path=>{window.calls.push(path);if(!state.authenticated)throw Error('请先在电脑栏连接 Being Home。');
      if(window.hold)await new Promise(resolve=>window.finish=resolve);
      return {path,name:path.split('/').pop(),bytes:new TextEncoder().encode('<h1>文件交付链路测试</h1><p>客户端内预览成功</p><script>try{parent.unsafe=true}catch{}</script><img src="https://example.invalid/private">')};},
    download:async path=>{window.downloads.push(path);if(window.downloadError)throw Error(window.downloadError);return !window.cancelDownload;}
  }};
  function Fixture(){
    const frame=useRef(null),[source,setSource]=useState('已在云电脑生成 **小镇介绍页**。下面是文件信息： '+JSON.stringify(receipt)+'\\n\\n下载后可以离线查看。'),[streaming,setStreaming]=useState(false);
    window.setSource=setSource; window.receipt=receipt;
    window.setReceipt=(mode)=>{setStreaming(mode==='stream');setSource(mode==='invalid'?'{'+'"type":"being.files","version":1,"files":[':JSON.stringify(receipt));};
    return <HomeFileViewer api={api} frame={frame} scope="fixture" onNotice={message=>window.notices.push(message)}><div className="workspace-body" style={{height:'100vh'}}><main className="workspace-stage" style={{padding:20}}>
      <h2>Being 的回复</h2><Markdown content={source} chat streaming={streaming}/>
      <Markdown content={'[查看交付文件]('+url+')'} chat/>
      <iframe ref={frame} id="chat" src="/empty?revision=one" title="fixture bridge" style={{display:'none'}}/>
    </main></div></HomeFileViewer>;
  }
  createRoot(document.querySelector('#root')).render(<Fixture/>);
` }, bundle:true, format:'esm', write:false, outdir:'/fixture', jsx:'automatic', define:{'process.env.NODE_ENV':'"production"'} };
const bundle = await build(fixtureOptions);
const chatBundle = await build({...fixtureOptions, outdir:'/chat-fixture', stdin:{...fixtureOptions.stdin, contents:fixtureOptions.stdin.contents.replace("import './desktop/renderer/app/styles.scss';", "import './desktop/renderer/chat/document.scss';")}});
const server=createServer((req,res)=>{
  if(req.url==='/runtime.html'){res.setHeader('Content-Type','text/html');res.setHeader('Content-Security-Policy',htmlPreviewPolicy());res.end(HTML_PREVIEW_RUNTIME);return;}
  if(req.url.startsWith('/empty')){res.setHeader('Content-Type','text/html');res.end('<!doctype html>');return;}
  if(req.url==='/chat-card'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><link rel="stylesheet" href="/chat-fixture/stdin.css"><div id="root"></div><script type="module" src="/chat-fixture/stdin.js"></script>');return;}
  const file=req.url.startsWith('/chat-fixture/')?chatBundle.outputFiles.find(f=>f.path===req.url):bundle.outputFiles.find(f=>f.path.endsWith(req.url));
  res.setHeader('Content-Type',file?req.url.endsWith('.css')?'text/css':'text/javascript':'text/html; charset=utf-8');
  res.end(file?file.contents:'<!doctype html><link rel="stylesheet" href="/stdin.css"><div id="root"></div><script type="module" src="/stdin.js"></script>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1000,height:760}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let external=0;page.on('request',req=>{if(!req.url().startsWith('http://127.0.0.1:'))external++;});
  await page.route('https://example.invalid/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'}));
  await page.goto('http://127.0.0.1:'+server.address().port);
  const card=page.getByRole('button',{name:'预览文件：文件交付链路测试',exact:true});
  await card.waitFor();
  const download=page.getByRole('button',{name:'下载文件：文件交付链路测试',exact:true});
  assert.equal(await download.evaluate(el=>getComputedStyle(el).opacity),'0');
  assert.equal(await page.locator('a[href*="/files/content"]').count(),0);
  assert.deepEqual(await page.evaluate(()=>window.calls),[], 'rendering must not read private files');
  await mkdir('output/playwright',{recursive:true});
  await page.screenshot({animations:'disabled',path:'output/playwright/being-files-desktop.png'});
  const initialBackground=await card.evaluate(el=>getComputedStyle(el.parentElement).backgroundColor);
  await card.getByText('云电脑生成 · 自包含 · 无外链',{exact:true}).hover();
  await page.screenshot({animations:'disabled',path:'output/playwright/being-files-hover.png'});
  assert.notEqual(await card.evaluate(el=>getComputedStyle(el.parentElement).backgroundColor),initialBackground);
  assert.equal(await card.getByText('云电脑生成 · 自包含 · 无外链',{exact:true}).evaluate(el=>el.closest('button')?.matches(':hover')),true);
  assert.equal(await download.evaluate(el=>getComputedStyle(el).opacity),'1');
  const cardHoverBackground=await card.evaluate(el=>getComputedStyle(el.parentElement).backgroundColor);
  await download.hover();
  await page.screenshot({animations:'disabled',path:'output/playwright/being-files-download-hover.png'});
  assert.equal(await card.evaluate(el=>getComputedStyle(el.parentElement).backgroundColor),cardHoverBackground,'card stays highlighted when pointer moves onto download');
  assert.equal(await card.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)','preview button does not paint a competing hover surface');
  await download.click();
  await page.waitForFunction(()=>window.notices.includes('文件已保存'));
  assert.deepEqual(await page.evaluate(()=>window.downloads),['artifacts/20261104-delivery-v5/index.html']);
  assert.deepEqual(await page.evaluate(()=>window.calls),[], 'direct download does not fetch preview content');
  assert.equal(await page.locator('.client-file-viewer').count(),0, 'direct download does not open a preview panel');
  await page.mouse.move(0,0);
  await card.focus();await page.keyboard.press('Tab');
  assert.equal(await download.evaluate(el=>document.activeElement===el && getComputedStyle(el).opacity==='1'),true);
  await page.evaluate(()=>{window.cancelDownload=true;window.notices=[];});
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>window.downloads.length===2);
  assert.deepEqual(await page.evaluate(()=>window.notices),[],'cancelled saves do not claim success');
  await page.evaluate(()=>{window.cancelDownload=false;window.downloadError='下载失败，请重试。';});
  await download.click();
  await page.waitForFunction(()=>window.notices.includes('下载失败，请重试。'));
  await page.evaluate(()=>{window.downloadError='';window.downloads=[];window.notices=[];});

  await page.setViewportSize({width:360,height:760});
  assert(await card.evaluate(el=>el.getBoundingClientRect().right<=innerWidth));
  await page.screenshot({animations:'disabled',path:'output/playwright/being-files-narrow.png'});
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await page.screenshot({animations:'disabled',path:'output/playwright/being-files-dark.png'});
  assert.equal(await card.evaluate(el=>getComputedStyle(el).color), 'rgb(236, 238, 241)');
  await page.evaluate(()=>document.documentElement.dataset.theme='light');
  await card.getByText('云电脑生成 · 自包含 · 无外链',{exact:true}).click();
  const dialog=page.getByRole('complementary',{name:'文件预览：index.html'});
  assert.equal(await page.locator('dialog[open]').count(),0);
  await page.frameLocator('iframe[title="云端 HTML 预览"]').getByRole('heading',{name:'文件交付链路测试'}).waitFor();
  assert.equal(await page.evaluate(()=>window.unsafe),undefined);
  assert.equal(external,1,'isolated HTML can load external resources');
  const header=dialog.locator(':scope > header');
  const htmlFrame=dialog.locator('iframe[title="云端 HTML 预览"]');
  const headerBounds=await header.boundingBox();
  assert(headerBounds.height<=48,'Preview controls should occupy a single compact row');
  assert(Math.abs((await htmlFrame.boundingBox()).y-headerBounds.y-headerBounds.height)<2,'HTML starts immediately below the toolbar');
  assert.equal(await header.getByRole('button',{name:'源码',exact:true}).count(),1);
  assert.equal(await header.getByRole('button',{name:'下载文件',exact:true}).count(),1);
  assert(await header.evaluate(el=>el.scrollWidth<=el.clientWidth),'Toolbar must fit the narrow viewport');
  await page.screenshot({animations:'disabled',path:'output/playwright/being-files-preview-narrow.png'});
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await page.screenshot({animations:'disabled',path:'output/playwright/being-files-preview-dark.png'});
  await page.evaluate(()=>document.documentElement.dataset.theme='light');

  await page.setViewportSize({width:1000,height:760});
  await page.screenshot({animations:'disabled',path:'output/playwright/being-files-preview.png'});
  const stageBounds=await page.locator('.workspace-stage').boundingBox();
  const panelBounds=await dialog.boundingBox();
  assert(stageBounds.width>=280 && Math.abs(stageBounds.x+stageBounds.width-panelBounds.x)<2);
  const handle=dialog.getByRole('separator');
  await handle.focus();await handle.press('ArrowRight');
  assert((await dialog.boundingBox()).width<panelBounds.width);
  await dialog.getByRole('button',{name:'展开全部',exact:true}).click();
  assert.equal(await page.locator('.workspace-stage').isVisible(),false);
  await dialog.getByRole('button',{name:'恢复对话',exact:true}).click();
  assert.equal(await page.locator('.workspace-stage').isVisible(),true);

  await dialog.getByRole('button',{name:'下载文件',exact:true}).click();
  await page.getByText('文件已保存',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.downloads),['artifacts/20261104-delivery-v5/index.html']);
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'查看交付文件',exact:true}).click();
  await dialog.waitFor();
  await page.evaluate(()=>window.setHome({authenticated:false}));
  await dialog.waitFor({state:'hidden'});
  await card.click();
  await page.getByText('请先在电脑栏连接 Being Home。',{exact:true}).waitFor();
  await page.keyboard.press('Escape');
  await page.evaluate(()=>window.setHome({authenticated:true}));
  await page.evaluate(()=>{window.hold=true;});
  await card.click();
  await page.getByText('正在读取文件…',{exact:true}).waitFor();
  await page.evaluate(()=>{window.setHome({username:'another'});window.finish();window.hold=false;});
  await dialog.waitFor({state:'hidden'});
  // Foreign windows, stale revisions and unsafe paths cannot trigger native access.
  const count=await page.evaluate(()=>window.calls.length);
  const downloadCount=await page.evaluate(()=>window.downloads.length);
  await page.evaluate(()=>{
    const source=document.querySelector('#chat').contentWindow;
    for(const type of ['beings:home-file-preview','beings:home-file-download'])
      for(const [origin,revision,path] of [['https://evil.test','one','a.html'],['beings://chat','stale','a.html'],['beings://chat','one','../secret']])
        window.dispatchEvent(new MessageEvent('message',{origin,source,data:{type,revision,path}}));
  });
  assert.equal(await page.evaluate(()=>window.calls.length),count);
  assert.equal(await page.evaluate(()=>window.downloads.length),downloadCount);
  await page.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{origin:'beings://chat',source:document.querySelector('#chat').contentWindow,data:{type:'beings:home-file-download',revision:'one',path:'artifacts/20261104-delivery-v5/index.html'}})));
  await page.waitForFunction(expected=>window.downloads.length===expected,downloadCount+1);
  assert.equal(await page.evaluate(()=>window.calls.length),count);
  assert.equal(await page.locator('.client-file-viewer').count(),0);
  await page.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{origin:'beings://chat',source:document.querySelector('#chat').contentWindow,data:{type:'beings:home-file-preview',revision:'one',path:'artifacts/20261104-delivery-v5/index.html'}})));
  await dialog.waitFor();
  await page.keyboard.press('Escape');
  await page.evaluate(()=>window.setReceipt('stream'));
  await page.getByText('正在接收文件信息…',{exact:true}).waitFor();
  assert.equal(await card.count(),0);
  await page.evaluate(()=>window.setReceipt('invalid'));
  await page.getByRole('alert').filter({hasText:'文件信息不完整'}).waitFor();
  assert.equal(await page.locator('a[href*="/files/content"]').count(),0);
  await page.evaluate(()=>window.setSource('说明文字\n\n```json\n'+JSON.stringify(window.receipt)+'\n```\n\n文件已交付。'));
  await card.waitFor();
  await page.getByText('文件已交付。',{exact:true}).waitFor();
  assert.equal(await page.locator('.reading-text pre').count(),0);
  assert(!(await page.locator('main').innerText()).includes('"version"'));
  await page.screenshot({animations:'disabled',path:'output/playwright/being-files-fenced.png'});
  assert.deepEqual(errors,[]);
  // Exercise the actual chat stylesheet, whose hover token differs from the shell.
  const chat=await browser.newPage({viewport:{width:680,height:420}});
  await chat.goto('http://127.0.0.1:'+server.address().port+'/chat-card');
  const chatCard=chat.getByRole('button',{name:'预览文件：文件交付链路测试',exact:true});
  const chatDownload=chat.getByRole('button',{name:'下载文件：文件交付链路测试',exact:true});
  for(const theme of ['light','dark']){
    await chat.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await chatCard.getByText('云电脑生成 · 自包含 · 无外链',{exact:true}).hover();
    await chat.screenshot({animations:'disabled',path:`output/playwright/being-files-chat-${theme}-hover.png`});
    const background=await chatCard.evaluate(el=>getComputedStyle(el.parentElement).backgroundColor);
    await chatDownload.hover();
    await chat.screenshot({animations:'disabled',path:`output/playwright/being-files-chat-${theme}-download-hover.png`});
    assert.equal(await chatCard.evaluate(el=>getComputedStyle(el.parentElement).backgroundColor),background);
    assert.notEqual(await chatDownload.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
    const before=await chatDownload.boundingBox();
    await chat.mouse.down();await chat.mouse.up();
    assert.deepEqual(await chatDownload.boundingBox(),before,'download hover/click does not shift layout');
  }
  assert.equal(await chat.locator('.client-file-viewer').count(),0);
  assert.equal(await chat.evaluate(()=>window.downloads.length),2);
  await chat.close();
  const touch=await browser.newPage({viewport:{width:360,height:760},hasTouch:true,isMobile:true});
  await touch.goto('http://127.0.0.1:'+server.address().port);
  const touchDownload=touch.getByRole('button',{name:'下载文件：文件交付链路测试',exact:true});
  await touchDownload.waitFor();
  assert.equal(await touchDownload.evaluate(el=>getComputedStyle(el).opacity),'1');
  await touchDownload.tap();
  await touch.waitForFunction(()=>window.downloads.length===1);
  assert.equal(await touch.locator('.client-file-viewer').count(),0);
  await touch.close();
  console.log('being.files UI: cards, narrow/dark layout, private preview/download, link interception, streaming, auth changes and bridge validation passed');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
