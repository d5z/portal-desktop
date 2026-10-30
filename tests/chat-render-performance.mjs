// Real chat bundle, 1,000 cached rows, resource requests and streamed/tool output.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const assets = new Map(await Promise.all(['loom.html','chat.js','chat.css','highlight.css'].map(async name=>['/'+name,await readFile('desktop/generated/'+name)])));
const id = n => 'msg_' + n.toString(16).padStart(64,'0');
const receipt = {type:'being.image-generation',version:1,being_id:'fixture',jobs:[{index:1,title:'row 967',submission:'accepted',generation_id:'gen_perf',client_request_id:'perf',error_code:null}]};
const history = Array.from({length:1000},(_,i)=>({seq:i+1,role:i%2?'being':'user',scene_id:'perf',content:`row ${i+1}\n\n历史第二段\n\n历史第三段`,at:'2026-10-22T01:00:00Z'}));
for(const seq of [965,999])history[seq-1].content=`[attachment-message:v1:${id(seq)}]`;
history[966]={...history[966],role:'being',content:'```json\n'+JSON.stringify(receipt)+'\n```'};
let stream, answer='', historyCalls=0;const resources=[], liveEvents=[];
const emit=(event,data)=>{
  const payload={...data,scene_id:'perf'};
  if(event!=='meta')liveEvents.push({seq:liveEvents.length+1,event,data:payload});
  return stream.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
};
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');const json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
  if(url.pathname==='/api/history'){historyCalls++;const after=url.searchParams.get('after');return json({messages:(after===null?history.slice(-100):history.filter(row=>row.seq>Number(after))).slice().reverse()});}
  if(url.pathname==='/api/status')return json({being_name:'fixture'});
  if(url.pathname==='/api/llm/config')return json({sbs_enabled:false});
  if(url.pathname==='/api/stream/active'){
    if(stream&&!stream.writableEnded)return json({stream_id:'perf-stream',scene_id:'perf',origin:'human',finished:false,next_seq:liveEvents.length+1,
      events:liveEvents.filter(item=>item.seq>Number(url.searchParams.get('after')||0))});
    res.writeHead(204);return res.end();
  }
  if(url.pathname==='/health')return res.end('OK fixture');
  if(url.pathname.startsWith('/api/attachment-messages/')){const message_id=url.pathname.split('/').at(-1);resources.push(message_id);return json({version:1,message_id,channel:'portal',scene_id:'perf',created_at:Date.now(),delivery_status:'accepted',parts:[{type:'text',text:'row '+parseInt(message_id.slice(4),16)}]});}
  if(url.pathname.startsWith('/api/image-generations/')){resources.push('generation');return json({id:'gen_perf',client_request_id:'perf',status:'failed',error_code:'fixture',availability:'expired',outputs:[],required_action:null});}
  if(url.pathname==='/api/chat/stream'){for await(const chunk of req){}stream=res;res.writeHead(200,{'Content-Type':'text/event-stream'});emit('meta',{stream_id:'perf-stream'});emit('thinking',{text:'working'});return;}
  if(assets.has(url.pathname)){res.setHeader('Content-Type',url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':'text/html;charset=utf-8');return res.end(assets.get(url.pathname));}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Cache seed</title>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try {
  browser=await chromium.launch({headless:true,channel:'chrome'});
  const page=await browser.newPage({viewport:{width:1100,height:850}});page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const origin='http://127.0.0.1:'+server.address().port;
  await page.addInitScript(()=>{const original=window.fetch;window.fetch=(input,init)=>original(typeof input==='string'&&input.startsWith('beings://chat/')?location.origin+input.slice('beings://chat'.length):input,init);});

  await page.addInitScript(() => localStorage.setItem('beings:show-reasoning','true'));
  await page.goto(origin+'/seed');
  await page.evaluate(rows=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('loom-history-'+encodeURIComponent(location.origin),2);
    request.onupgradeneeded=()=>{const db=request.result;db.createObjectStore('messages',{keyPath:'seq'}).createIndex('scene','scene_id');db.createObjectStore('meta',{keyPath:'key'});};
    request.onsuccess=()=>{const db=request.result,tx=db.transaction(['messages','meta'],'readwrite');for(const row of rows)tx.objectStore('messages').put(row);tx.objectStore('meta').put({key:'state',lastSeq:1000});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};
  }),history);
  await page.goto(origin+'/loom.html?revision=perf&scene_id=perf&history_scope='+encodeURIComponent(origin));
  await page.getByText('row 1000',{exact:true}).waitFor();
  await page.getByText('row 999',{exact:true}).waitFor();
  assert.ok(await page.locator('.message').count()<=40,'1,000 cached rows only mount the latest page');
  assert.deepEqual(resources,[id(999)],'Offscreen attachment metadata and generation status must not load');
  const reads=historyCalls;
  await page.locator('#input').fill('性能验证');
  await page.waitForTimeout(100);
  assert.equal(historyCalls,reads,'Typing must not fetch history');
  await page.locator('#messages').hover(); await page.mouse.wheel(0,-800);
  await page.locator('[data-history-seq="965"]').scrollIntoViewIfNeeded();
  await page.getByText('row 965',{exact:true}).waitFor();
  await page.locator('[data-history-seq="967"]').scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>document.querySelector('.image-generation-notice')?.textContent==='fixture').catch(async error=>{
    console.log(JSON.stringify({resources,errors,card:await page.locator('[data-history-seq="967"]').innerText()}));
    await page.screenshot({path:'test-results/performance-debug.png'});throw error;
  });
  assert.equal(resources.filter(value=>value===id(965)).length,1);
  await page.getByRole('button',{name:'回到底部',exact:true}).click();
  await page.locator('#send-btn').click();
  await page.locator('#send-btn.stop').waitFor();
  for(let i=0;i<80;i++){emit('tool_use',{id:'tool-'+i,name:'read',input:{path:'/fixture/'+i}});emit('tool_result',{id:'tool-'+i,name:'read',summary:'fixture output '+i,is_error:false});}
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.run-entry').count(),0,'Collapsed tools must not mount hidden detail rows');
  await page.locator('.run-activity > summary').last().click();
  await page.waitForFunction(()=>document.querySelectorAll('.run-entry').length>=30);
  assert.ok(await page.locator('.run-entry').count()>=30);
  await page.locator('.run-activity > summary').last().click();
  await page.locator('.run-entry').first().waitFor({state:'detached'});
  assert.equal(await page.locator('.run-entry').count(),0);
  // Hosted browsers can present at 10 Hz even when their main thread is idle.
  // Measure that cadence on this page before streaming, so compositor scheduling
  // is not mistaken for application work. Long tasks still have an absolute cap.
  const idleP95FrameMs=await page.evaluate(()=>new Promise(resolve=>{
    const samples=[];let last;
    function tick(now){
      if(last!==undefined)samples.push(now-last);last=now;
      if(samples.length<30)return requestAnimationFrame(tick);
      const values=samples.slice(2).sort((a,b)=>a-b);
      resolve(values[Math.floor(values.length*.95)]);
    }
    requestAnimationFrame(tick);
  }));
  await page.evaluate(()=>{
    window.samples=[];window.longTasks=[];window.measuring=true;window.messageLayoutReads=0;
    const bounds=Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect=function(){if(window.measuring&&this.classList.contains('message'))window.messageLayoutReads++;return bounds.call(this);};
    new PerformanceObserver(list=>{if(window.measuring)window.longTasks.push(...list.getEntries().map(entry=>entry.duration));}).observe({type:'longtask',buffered:false});
    let last=performance.now();function tick(now){if(!window.measuring)return;window.samples.push(now-last);last=now;requestAnimationFrame(tick);}requestAnimationFrame(tick);
  });
  answer='';
  for(let i=0;i<90;i++){const text=`流式段落 ${i}。\n\n`;answer+=text;emit('content_block_delta',{delta:{text}});await new Promise(resolve=>setTimeout(resolve,16));}
  answer+='```javascript\n';emit('content_block_delta',{delta:{text:'```javascript\n'}});
  for(let i=0;i<40;i++){const text=`const value_${i} = ${i};\n`;answer+=text;emit('content_block_delta',{delta:{text}});await new Promise(resolve=>setTimeout(resolve,16));}
  await page.waitForFunction(()=>[...document.querySelectorAll('pre code')].at(-1)?.textContent.includes('const value_39'));
  assert.equal(await page.locator('.message.being').last().locator('code .hljs-keyword').count(),0,'Live code avoids highlighting on every delta');
  answer+='```';emit('content_block_delta',{delta:{text:'```'}});
  emit('message_stop',{});stream.end();
  await page.getByText('流式段落 89。',{exact:true}).waitFor();
  await page.locator('.message.being').last().locator('code .hljs-keyword').first().waitFor();
  const metrics=await page.evaluate(()=>{window.measuring=false;const values=window.samples.slice(2).sort((a,b)=>a-b);return{frames:values.length,messageLayoutReads:window.messageLayoutReads,p95FrameMs:values[Math.floor(values.length*.95)],maxLongTaskMs:Math.max(0,...window.longTasks),mountedMessages:document.querySelectorAll('.message').length};});
  metrics.idleP95FrameMs=idleP95FrameMs;
  metrics.frameBudgetMs=Math.max(100,idleP95FrameMs+50);
  await mkdir('test-results',{recursive:true});await writeFile('test-results/chat-render-performance.json',JSON.stringify(metrics,null,2));
  console.log('Rendering metrics: '+JSON.stringify(metrics));
  assert.ok(metrics.frames>=20,'Stream must paint incrementally');
  // Frame timestamps are quantized; ignore floating-point subtraction noise
  // at the inclusive budget boundary, while retaining millisecond precision.
  assert.ok(Math.round(metrics.p95FrameMs)<=Math.round(metrics.frameBudgetMs),'Streaming must not repeatedly stall beyond the idle frame cadence');
  assert.ok(metrics.maxLongTaskMs<100,'Streaming must not block the main thread for 100ms');
  history.push({seq:1001,role:'user',scene_id:'perf',content:'性能验证',at:new Date().toISOString()},{seq:1002,role:'being',scene_id:'perf',content:answer,at:new Date().toISOString()});
  await page.evaluate(()=>postMessage({type:'beings:chat-refresh',id:'verify',revision:'perf'},location.origin));
  await page.locator('[data-history-seq="1002"]').waitFor();
  const order=await page.locator('.message[data-history-seq]').evaluateAll(nodes=>nodes.map(node=>Number(node.dataset.historySeq)));
  assert.deepEqual(order,[...new Set(order)].sort((a,b)=>a-b),'Cache, reversed history and live echo retain unique seq order');
  assert.equal(await page.locator('[data-history-seq="1001"]').count(),1);
  assert.equal(resources.filter(value=>value===id(965)).length,1,'Retained rows do not reload on unrelated stream updates');
  assert.deepEqual(errors,[]);
  console.log('PASS: lazy history resources, collapsed tools, incremental stream and durable order. '+JSON.stringify(metrics));
} finally {await browser?.close();stream?.end();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
