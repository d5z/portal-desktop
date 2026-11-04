import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { build } from '../scripts/renderer-build.mjs';
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
  import { createRoot } from 'react-dom/client';
  import { useRef, useState } from 'react';
  import { Markdown } from './desktop/renderer/shared/components/markdown';
  import { HomeFileViewer } from './desktop/renderer/app/components/home-file-viewer';
  import './desktop/renderer/app/styles.scss';
  const path='artifacts/20261104-delivery-v5/index.html';
  const url='https://home.beings.town/v1/me/files/content?path='+path;
  const receipt={type:'being.files',version:1,files:[{path,url,name:'文件交付链路测试',size:5446,content_type:'text/html',caption:'云电脑生成 · 自包含 · 无外链'}]};
  const listeners=new Set(); let state={authenticated:true,authenticating:false,username:'fixture',binding:'matched'};
  window.calls=[];window.downloads=[];
  window.setHome=patch=>{state={...state,...patch};listeners.forEach(fn=>fn(state));};
  const api={state:async()=>state,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},files:{
    list:async()=>({entries:[]}),
    preview:async path=>{window.calls.push(path);if(!state.authenticated)throw Error('请先在电脑栏连接 Being Home。');
      if(window.hold)await new Promise(resolve=>window.finish=resolve);
      return {path,name:path.split('/').pop(),bytes:new TextEncoder().encode('<h1>文件交付链路测试</h1><p>客户端内预览成功</p><script>parent.unsafe=true</script><img src="https://example.invalid/private">')};},
    download:async path=>{window.downloads.push(path);return true;}
  }};
  function Fixture(){
    const frame=useRef(null),[source,setSource]=useState('已在云电脑生成 **小镇介绍页**。下面是文件信息： '+JSON.stringify(receipt)+'\\n\\n下载后可以离线查看。'),[streaming,setStreaming]=useState(false);
    window.setSource=setSource; window.receipt=receipt;
    window.setReceipt=(mode)=>{setStreaming(mode==='stream');setSource(mode==='invalid'?'{'+'"type":"being.files","version":1,"files":[':JSON.stringify(receipt));};
    return <HomeFileViewer api={api} frame={frame} scope="fixture"><div className="workspace-body" style={{height:'100vh'}}><main className="workspace-stage" style={{padding:20}}>
      <h2>Being 的回复</h2><Markdown content={source} chat streaming={streaming}/>
      <Markdown content={'[查看交付文件]('+url+')'} chat/>
      <iframe ref={frame} id="chat" src="/empty?revision=one" title="fixture bridge" style={{display:'none'}}/>
    </main></div></HomeFileViewer>;
  }
  createRoot(document.querySelector('#root')).render(<Fixture/>);
` }, bundle:true, format:'esm', write:false, outdir:'/fixture', jsx:'automatic', define:{'process.env.NODE_ENV':'"production"'} });
const server=createServer((req,res)=>{
  if(req.url.startsWith('/empty')){res.setHeader('Content-Type','text/html');res.end('<!doctype html>');return;}
  const file=bundle.outputFiles.find(f=>f.path.endsWith(req.url));
  res.setHeader('Content-Type',file?req.url.endsWith('.css')?'text/css':'text/javascript':'text/html; charset=utf-8');
  res.end(file?file.contents:'<!doctype html><link rel="stylesheet" href="/stdin.css"><div id="root"></div><script type="module" src="/stdin.js"></script>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1000,height:760}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let external=0;page.on('request',req=>{if(!req.url().startsWith('http://127.0.0.1:'))external++;});
  await page.goto('http://127.0.0.1:'+server.address().port);
  const card=page.getByRole('button',{name:'预览文件：文件交付链路测试',exact:true});
  await card.waitFor();
  assert.equal(await page.locator('a[href*="/files/content"]').count(),0);
  assert.deepEqual(await page.evaluate(()=>window.calls),[], 'rendering must not read private files');
  await mkdir('output/playwright',{recursive:true});
  await page.screenshot({animations:'disabled',path:'output/playwright/being-files-desktop.png'});
  const initialBackground=await card.evaluate(el=>getComputedStyle(el).backgroundColor);
  await card.getByText('云电脑生成 · 自包含 · 无外链',{exact:true}).hover();
  await page.screenshot({animations:'disabled',path:'output/playwright/being-files-hover.png'});
  assert.notEqual(await card.evaluate(el=>getComputedStyle(el).backgroundColor),initialBackground);
  assert.equal(await card.getByText('云电脑生成 · 自包含 · 无外链',{exact:true}).evaluate(el=>el.closest('button')?.matches(':hover')),true);

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
  assert.equal(external,0);
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
  await page.evaluate(()=>{
    const source=document.querySelector('#chat').contentWindow;
    for(const [origin,revision,path] of [['https://evil.test','one','a.html'],['beings://chat','stale','a.html'],['beings://chat','one','../secret']])
      window.dispatchEvent(new MessageEvent('message',{origin,source,data:{type:'beings:home-file-preview',revision,path}}));
  });
  assert.equal(await page.evaluate(()=>window.calls.length),count);
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
  console.log('being.files UI: cards, narrow/dark layout, private preview/download, link interception, streaming, auth changes and bridge validation passed');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
