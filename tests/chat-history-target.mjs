// Shell activity -> trusted bridge -> real IndexedDB -> bundled chat -> visible target.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const assets = new Map(await Promise.all(['loom.html','chat.js','chat.css','highlight.css'].map(async file=>['/'+file,await readFile('desktop/generated/'+file)])));
const {outputFiles} = await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {AppModel} from './desktop/renderer/app/models/app';
import {RecentHistory} from './desktop/renderer/app/components/recent-history';
import {useModel} from './desktop/renderer/shared/hooks/use-model';
import {HistoryCache} from './desktop/renderer/chat/services/history-cache';
(async()=>{
  const scenes=['a','b'].map(id=>({scene_id:id,scene_meta:{client:'fixture',scene_label:id}}));
  const remote={seq:1500,role:'user',content:'仅在接口的目标',scene_id:'b',scene_label:'b',at:'2026-10-22T00:00:00Z'};
  const rows=Array.from({length:1000},(_,i)=>({seq:i+1,role:i%100===0?'user':'being',content:i%100===0?'重复提问':'缓存回复 '+(i+1),scene_id:i<500?'a':'b',at:'2026-10-21T00:00:00Z'}));
  const cache=new HistoryCache(location.origin);await cache.write(rows,1000);cache.close();
  const app=new AppModel({recentChatHistory:async()=>[remote,{...remote,seq:1600,content:'已不存在的目标'}],
    changeChatSession:async(op,id)=>({...app.snapshot,chatScene:scenes.find(s=>s.scene_id===id)})});
  app.applySnapshot({settings:{endpoint:location.origin,being:'fixture',hasToken:true},portal:{phase:'stopped',logs:[]},chatScene:scenes[0],chatSessions:scenes});
  window.app=app;window.received=[];window.sent=[];
  const frame=document.querySelector('iframe');
  app.post=data=>{window.sent.push(data);frame.contentWindow.postMessage(data,location.origin);};
  addEventListener('message',event=>{
    if(event.source!==frame.contentWindow||event.origin!==location.origin)return;
    window.received.push(event.data);
    if(event.data.type==='beings:ready'){app.chatLoading=false;app.changed();}
    app.localHistory.receive(event.data);
    if(event.data.type==='beings:history-target-result')app.finishHistoryTarget(event.data.sceneId,event.data.seq,event.data.ok);
  });
  frame.addEventListener('load',()=>{app.chatLoading=false;app.changed();});
  frame.src='/loom.html?'+new URL(app.chatSource).searchParams;
  function Fixture(){useModel(app);return <>
    <button onClick={()=>{app.beingInfoOpen=true;app.changed();}}>打开动态</button>
    {app.beingInfoOpen&&<aside><RecentHistory app={app}/></aside>}
    <div role="status">{app.toastMessage}</div>
  </>;}
  createRoot(document.getElementById('root')).render(<Fixture/>);
})();
`},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic'});
const historyRequests=[];
let releaseDelayed;
const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
  if(url.pathname==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(outputFiles[0].text);return;}
  if(url.pathname==='/api/history'){
    historyRequests.push(url.search);
    if(url.searchParams.get('after')==='1499') return json({messages:[{seq:1500,role:'user',content:'仅在接口的目标',scene_id:'b'}]});
    if(url.searchParams.get('after')==='1599'){releaseDelayed=()=>json({messages:[]});return;}
    return json({messages:[]});
  }
  if(url.pathname==='/api/status')return json({being_name:'fixture'});
  if(url.pathname==='/api/llm/config')return json({sbs_enabled:false});
  if(url.pathname==='/api/stream/active'){res.writeHead(204);res.end();return;}
  if(assets.has(url.pathname)){res.setHeader('Content-Type',url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':'text/html');res.end(assets.get(url.pathname));return;}
  if(url.pathname.startsWith('/api/'))return json({});
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><style>body{margin:0}iframe{width:100vw;height:90vh;border:0}aside{position:fixed;right:0;top:0;background:white;width:320px;max-height:75vh;overflow:auto;z-index:3}</style><div id="root"></div><iframe id="chat"></iframe><script src="/fixture.js"></script>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await chromium.launch({headless:true,channel:'chrome'});
  const page=await browser.newPage({viewport:{width:1100,height:850}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);
  const frame=page.frameLocator('#chat');
  await frame.getByText('缓存回复 500',{exact:true}).waitFor();
  // The activity has equal text in many scenes; seq, never text, chooses the target.
  const jump=async seq=>{
    await page.getByRole('button',{name:'打开动态',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.being-history-row').length===12);
    const index=[1600,1500,901,801,701,601,501,401,301,201,101,1].indexOf(seq);
    await page.locator('.being-history-row').nth(index).click();
  };
  const landed=async seq=>{
    await page.waitForFunction(seq=>window.received.some(m=>m.type==='beings:history-target-result'&&m.seq===seq&&m.ok),seq);
    await page.waitForTimeout(250);
    const position=await frame.locator('.index-target').evaluate(el=>{const list=document.querySelector('#messages'),r=el.getBoundingClientRect(),v=list.getBoundingClientRect();return {seq:Number(el.dataset.historySeq),top:r.top-v.top,bottom:r.bottom-v.top,height:v.height};});
    assert.equal(position.seq,seq);
    assert.ok(position.top>=0&&position.bottom<=position.height,JSON.stringify(position));
    assert.ok(await frame.locator('.message').count()<160,'A jump loads context, not all 1,000 cached rows');
    assert.equal(await page.locator('aside').count(),0);
  };
  await jump(101);await landed(101); // same scene, outside initial cache/DOM window
  assert.ok(!historyRequests.some(q=>q.includes('after=100&')),'Cache target needs no targeted network read');
  await jump(601);await landed(601); // cross-scene
  await jump(1500);await landed(1500); // not in local cache
  assert.ok(historyRequests.some(q=>q==='?after=1499&limit=21'));
  await jump(1600); // a delayed old request must not steal the new selection
  while(!releaseDelayed)await new Promise(resolve=>setTimeout(resolve,20));
  await jump(201);await landed(201);
  releaseDelayed();releaseDelayed=undefined;
  await page.waitForTimeout(200);
  assert.equal(await frame.locator('.index-target').getAttribute('data-history-seq'),'201');
  assert.ok(!await page.getByRole('status').filter({hasText:'未能定位'}).count());
  await jump(1600);
  while(!releaseDelayed)await new Promise(resolve=>setTimeout(resolve,20));
  releaseDelayed();releaseDelayed=undefined;
  await page.getByRole('status').filter({hasText:'未能定位这条对话'}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS: activity targets exact seq, old cache context, same/cross scene, remote fallback, stale request cancellation and missing target feedback.');
}finally{releaseDelayed?.();await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
