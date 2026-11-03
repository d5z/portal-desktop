import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from '../scripts/renderer-build.mjs';
import { chromium } from 'playwright';

// Exercise the real desktop viewer with a controlled chat-frame message/Blob transport.
const bundle=await build({stdin:{contents:`
  import {useRef} from 'react';
  import {createRoot} from 'react-dom/client';
  import {AttachmentImageViewer} from './desktop/renderer/app/components/attachment-image-viewer';
  function Fixture(){const frame=useRef(null);return <><iframe ref={frame} src="/frame?revision=current"/><AttachmentImageViewer frame={frame}/></>}
  createRoot(document.getElementById('root')).render(<Fixture/>);
`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outfile:'fixture.js',format:'esm',jsx:'automatic'});
const css=bundle.outputFiles.find(file=>file.path.endsWith('.css')).text;
const server=createServer((req,res)=>{
  if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');return res.end(bundle.outputFiles[0].text);}
  if(req.url==='/fixture.css'){res.setHeader('Content-Type','text/css');return res.end(css);}
  res.setHeader('Content-Type','text/html');
  res.end(req.url.startsWith('/frame')?'<html></html>':'<html><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
  const page=await browser.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('iframe').waitFor();
  await page.evaluate(()=>{
    const frame=document.querySelector('iframe');
    window.imageRequests=[];window.cancelled=[];window.held=[];
    const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
    frame.contentWindow.postMessage=(data,origin,ports)=>{
      if(data.type!=='beings:remote-image-content')return;
      window.imageRequests.push(data.src);
      const port=structuredClone(ports[0],{transfer:[ports[0]]});port.onmessage=event=>{if(event.data==='abort')window.cancelled.push(data.src);};
      const respond=()=>port.postMessage({blob:new Blob([bytes],{type:'image/png'})});
      if(data.src.endsWith('/1'))window.held.push(respond);else respond();
    };
    window.sendGallery=(data,origin='beings://chat',sameSource=true)=>window.dispatchEvent(new MessageEvent('message',{
      source:sameSource?frame.contentWindow:window,origin,data:{revision:'current',...data},
    }));
  });
  const items=[1,2,3].map(n=>({src:`https://beings.town/image/${n}`,name:`图片 ${n}`}));
  const open={type:'beings:remote-image-preview',...items[0],gallery:{id:'batch-1',items:items.slice(0,2)}};
  for(const variant of [{data:{...open,revision:'stale'}},{data:open,origin:'https://untrusted.example'},{data:open,sameSource:false},{data:{...open,gallery:{id:'batch-1',items:[{src:'file:///secret',name:'bad'}]}}}]) {
    await page.evaluate(({data,origin,sameSource})=>window.sendGallery(data,origin,sameSource),variant);
  }
  assert.equal(await page.locator('dialog[open]').count(),0);
  await page.evaluate(data=>window.sendGallery(data),open);
  await page.getByRole('dialog',{name:'图片预览：图片 1',exact:true}).waitFor();
  await page.getByText('正在加载原图…',{exact:true}).waitFor();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('dialog',{name:'图片预览：图片 2',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('dialog[aria-label^="图片预览："] img')?.naturalWidth>0);
  await page.waitForFunction(()=>window.cancelled.length===1);
  await page.evaluate(()=>window.held.forEach(respond=>respond()));
  assert.equal(await page.getByLabel('图片位置',{exact:true}).textContent(),'2 / 2');
  await page.evaluate(items=>window.sendGallery({type:'beings:remote-image-gallery-update',gallery:{id:'other-batch',items}}),items);
  assert.equal(await page.getByLabel('图片位置',{exact:true}).textContent(),'2 / 2','unrelated batches cannot alter the viewer');
  await page.evaluate(items=>window.sendGallery({type:'beings:remote-image-gallery-update',gallery:{id:'batch-1',items}}),items);
  await page.getByLabel('图片位置',{exact:true}).filter({hasText:'2 / 3'}).waitFor();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('dialog',{name:'图片预览：图片 3',exact:true}).waitFor();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载原图',exact:true}).click();
  assert.equal((await download).suggestedFilename(),'图片 3.png');
  assert.deepEqual(await page.evaluate(()=>window.imageRequests),items.map(item=>item.src),'gallery updates do not reload the active image');
  await page.keyboard.press('Escape');await page.locator('dialog').waitFor({state:'detached'});
  await page.evaluate(items=>window.sendGallery({type:'beings:remote-image-gallery-update',gallery:{id:'batch-1',items}}),items);
  assert.equal(await page.locator('dialog').count(),0,'background updates never reopen a closed preview');
  await page.evaluate(data=>window.sendGallery(data),{...open,...items[1]});
  await page.getByRole('dialog',{name:'图片预览：图片 2',exact:true}).waitFor();
  await page.evaluate(()=>window.sendGallery({type:'beings:remote-image-gallery-update',gallery:{id:'batch-1',items:[]}}));
  await page.locator('dialog').waitFor({state:'detached'});
  await page.evaluate(data=>window.sendGallery(data),open);
  await page.getByRole('dialog',{name:'图片预览：图片 1',exact:true}).waitFor();
  await page.waitForFunction(()=>window.imageRequests.filter(src=>src.endsWith('/1')).length===2);
  await page.evaluate(()=>document.querySelector('iframe').src='/frame?revision=next');
  await page.locator('dialog').waitFor({state:'detached'});
  await page.waitForFunction(()=>window.cancelled.length===2);
  await page.evaluate(data=>window.sendGallery(data),open);
  assert.equal(await page.locator('dialog').count(),0,'previous document cannot reopen the viewer after navigation');
  assert.deepEqual(errors,[]);
  console.log('PASS: desktop gallery validation, keyboard switching, cancellation, live updates, current-image download, cleanup.');
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
