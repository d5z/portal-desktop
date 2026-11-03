import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const assets = new Map(await Promise.all(['loom.html','chat.js','chat.css','highlight.css'].map(async file=>['/'+file,await readFile('desktop/generated/'+file)])));
const receipt={type:'being.image-generation',version:1,being_id:'alice',jobs:['窗台晨光','沙发暖阳','木地板'].map((title,i)=>({index:i+1,title:'暹罗猫 · '+title,submission:'accepted',generation_id:'gen_'+(i+1),client_request_id:'cats-'+(i+1),error_code:null}))};
const history=[{seq:1,role:'user',content:'生成三张暹罗猫图片',scene_id:'desktop-fixture',at:new Date().toISOString()},{seq:2,role:'being',content:'三张图片任务已提交。\n\n```json\n'+JSON.stringify(receipt)+'\n```\n\n完成后可以直接下载原图。',scene_id:'desktop-fixture',at:new Date().toISOString()}];
const imageVariants=new Map();
const requests=[]; const completed=new Set(); let rejectImage=true, streamResponse;
const streamPrefix='已提交，正在交接任务。\n\n```json\n';
const streamJSON=JSON.stringify(receipt);
const splitAt=streamJSON.indexOf('"jobs"');
const event=(name,data)=>streamResponse.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
let png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  if(url.pathname==='/api/history')return json({messages:history});
  if(url.pathname==='/api/status')return json({being_name:'alice'});
  if(url.pathname==='/api/llm/config')return json({sbs_enabled:false});
  if(url.pathname==='/api/chat/stream'){
    for await(const chunk of req) {};
    streamResponse=res;res.writeHead(200,{'Content-Type':'text/event-stream'});
    event('content_block_delta',{delta:{text:streamPrefix+streamJSON.slice(0,splitAt)}});return;
  }
  if(url.pathname==='/api/stream/active'){res.writeHead(204);return res.end();}
  if(url.pathname.startsWith('/api/image-generations/')){
    requests.push({path:url.pathname,method:req.method,endpoint:req.headers['x-portal-being-endpoint'],being:req.headers['x-portal-generation-being']});
    const id=url.pathname.split('/').at(-1),n=id.split('_')[1],finished=completed.has(n);
    return json({id,client_request_id:'cats-'+n,status:finished?'succeeded':n==='1'?'running':'queued',stage:finished?'complete':'generating',deadline:Date.now()+60000,poll_after_ms:1000,required_action:null,error_code:null,availability:finished?'available':'pending',outputs:finished?[{id:'out_'+n,attachment_id:'att_'+n,mime:'image/png',view_url:`http://127.0.0.1:${server.address().port}/image/${n}?token=unchanged-3a-original`}]:[]});
  }
  if(url.pathname.startsWith('/image/')){if(url.pathname.endsWith('/3')&&rejectImage){res.writeHead(503);return res.end();}res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store'});return res.end(imageVariants.get(url.pathname)||png);}
  if(assets.has(url.pathname)){res.setHeader('Content-Type',url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':'text/html; charset=utf-8');return res.end(assets.get(url.pathname));}
  return json({});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
  let page=await browser.newPage({viewport:{width:1100,height:850}});page.setDefaultTimeout(12000);
  // Render a non-square raster fixture so layout QA exercises real image dimensions.
  png=Buffer.from(await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
    const ctx=canvas.getContext('2d');
    const sky=ctx.createLinearGradient(0,0,0,480);sky.addColorStop(0,'#c9d9dd');sky.addColorStop(1,'#f2e8d5');ctx.fillStyle=sky;ctx.fillRect(0,0,640,480);
    ctx.fillStyle='#f9f1dc';ctx.beginPath();ctx.arc(430,130,48,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#9daea6';ctx.beginPath();ctx.moveTo(0,340);ctx.quadraticCurveTo(190,130,400,330);ctx.lineTo(640,420);ctx.lineTo(640,480);ctx.lineTo(0,480);ctx.fill();
    ctx.fillStyle='#526e69';ctx.beginPath();ctx.moveTo(0,430);ctx.quadraticCurveTo(350,235,640,320);ctx.lineTo(640,480);ctx.lineTo(0,480);ctx.fill();
    return canvas.toDataURL('image/png').split(',')[1];
  }),'base64');
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/loom.html?scene_id=desktop-fixture&history_scope=${encodeURIComponent('https://echo.beings.town/alice')}`);
  await page.locator('.image-generation-card').last().waitFor();
  assert.equal(await page.locator('.image-generation-card').count(),3);
  assert.equal(await page.locator('.image-generation-number').allTextContents().then(v=>v.join(',')),'01,02,03');
  await page.getByText('排队中',{exact:true}).first().waitFor();
  const bubble=page.locator('.message.being').filter({has:page.locator('.image-generation-message')});
  await bubble.getByText('三张图片任务已提交。',{exact:true}).waitFor();
  await bubble.getByText('完成后可以直接下载原图。',{exact:true}).waitFor();
  const ordered=await bubble.evaluate(el=>{
    const gallery=el.querySelector('.image-generation-message');
    const prose=[...el.querySelectorAll('.content')];
    return prose.length===2 && !!(prose[0].compareDocumentPosition(gallery)&Node.DOCUMENT_POSITION_FOLLOWING) && !!(gallery.compareDocumentPosition(prose[1])&Node.DOCUMENT_POSITION_FOLLOWING);
  });
  assert.ok(ordered,'prose stays before and after the gallery');
  const unified=await bubble.locator('.image-generation-answer').evaluate(el=>{
    const box=el.getBoundingClientRect();
    return {
      background:getComputedStyle(el).backgroundColor,
      prose:[...el.querySelectorAll('.image-generation-prose .content')].map(p=>getComputedStyle(p).backgroundColor),
      contained:[...el.querySelectorAll('.image-generation-prose, .image-generation-message')].every(child=>{
        const r=child.getBoundingClientRect();return r.left>box.left&&r.right<box.right&&r.top>=box.top&&r.bottom<=box.bottom;
      }),
    };
  });
  assert.notEqual(unified.background,'rgba(0, 0, 0, 0)','one reply surface contains text and images');
  assert.ok(unified.prose.every(bg=>bg==='rgba(0, 0, 0, 0)'),'text no longer has separate bubble backgrounds');
  assert.ok(unified.contained,'all content stays inside the common bubble');
  const messageId=await bubble.getAttribute('data-message-id');
  await bubble.evaluate(el=>el.dataset.retained='yes');
  assert.equal(await bubble.locator('pre, code').count(),0);
  await page.locator('.image-generation-placeholder[data-phase=running]').waitFor();
  await mkdir('test-results/image-generations',{recursive:true});
  await bubble.locator('.image-generation-answer').screenshot({path:'test-results/image-generations/skeleton-light.png',animations:'allow'});
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await bubble.locator('.image-generation-answer').screenshot({path:'test-results/image-generations/skeleton-dark.png',animations:'allow'});
  await page.evaluate(()=>document.documentElement.dataset.theme='light');
  await page.emulateMedia({reducedMotion:'reduce'});
  const motion=await page.locator('.image-generation-placeholder[data-active=true]').evaluateAll(nodes=>nodes.flatMap(node=>[...node.querySelectorAll('.generation-aurora,.generation-shimmer,.generation-skeleton-glyph,.generation-status-dot')].map(el=>getComputedStyle(el).animationName)));
  assert.ok(motion.length>0&&motion.every(name=>name==='none'),'reduced motion disables all skeleton animation');
  assert.equal(await page.locator('.image-generation-placeholder [aria-valuenow]').count(),0,'skeleton does not invent percentage progress');
  await page.emulateMedia({reducedMotion:'no-preference'});
  completed.add('1');
  await page.getByText('已生成 1 / 3 张',{exact:true}).waitFor();
  assert.equal(await page.locator('.image-generation-images img').count(),1);
  await page.waitForFunction(()=>document.querySelector('.image-generation-images img')?.naturalWidth>0);
  const frames=await page.locator('.image-generation-card').evaluateAll(cards=>cards.map(card=>{
    const frame=card.querySelector('[data-slot="image-thumbnail"], .image-generation-placeholder').getBoundingClientRect();
    const caption=card.querySelector('.image-generation-caption').getBoundingClientRect();
    return {width:frame.width,height:frame.height,left:frame.left,top:frame.top,bottom:frame.bottom,captionTop:caption.top};
  }));
  for(const [index,frame] of frames.entries()){
    assert.ok(Math.abs(frame.height-frame.width*(index===0?480/640:1))<2,'completed image uses its natural ratio; unknown-size skeleton stays square');
    // The bubble can wrap the gallery into several rows. Align cards within
    // each row and keep subsequent rows below it rather than assuming 3 columns.
    if (index > 0) {
      const previous = frames[index - 1];
      assert.ok(frame.left > previous.left ? Math.abs(frame.top - previous.top) < 2 : frame.top >= previous.bottom,
        'mixed states align without overlap: ' + JSON.stringify(frames));
    }
    assert.ok(frame.captionTop>=frame.bottom,'captions stay below media');
  }
  await mkdir('test-results/image-generations',{recursive:true});
  await page.screenshot({path:'test-results/image-generations/mixed.png'});
  // Keep the preview open while another job finishes; the batch grows in place.
  await page.getByRole('button',{name:'预览 暹罗猫 · 窗台晨光',exact:true}).click();
  await page.getByLabel('图片位置',{exact:true}).filter({hasText:'1 / 1'}).waitFor();
  completed.add('2');
  await page.getByLabel('图片位置',{exact:true}).filter({hasText:'1 / 2'}).waitFor();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('dialog',{name:'图片预览：暹罗猫 · 沙发暖阳',exact:true}).waitFor();
  assert.equal(await page.getByLabel('图片位置',{exact:true}).textContent(),'2 / 2');
  await page.keyboard.press('Escape');
  completed.add('3');
  await page.getByText('已生成 3 / 3 张',{exact:true}).waitFor();
  await page.getByText('图片加载失败，生成任务已成功。',{exact:true}).waitFor();
  assert.equal(await bubble.getAttribute('data-message-id'),messageId);
  assert.equal(await bubble.getAttribute('data-retained'),'yes');
  assert.equal(await page.locator('.message.being').count(),1);
  const calls=requests.length;await page.waitForTimeout(1200);assert.equal(requests.length,calls,'terminal jobs stop polling');
  rejectImage=false;await page.getByRole('button',{name:'重新加载图片',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.image-generation-images img').length===3&&[...document.querySelectorAll('.image-generation-images img')].every(img=>img.complete&&img.naturalWidth>0));
  assert.equal(requests.length,calls,'image retry must not restart generation polling');
  await page.getByRole('button',{name:'预览 暹罗猫 · 窗台晨光',exact:true}).hover();
  assert.equal(await page.locator('.image-generation-photo').first().locator('.image-generation-zoom').textContent(),'查看大图 ↗');
  assert.ok((await page.locator('.image-generation-images img').first().getAttribute('src')).endsWith('?token=unchanged-3a-original'));
  const downloadButton=page.getByRole('button',{name:'下载原图 暹罗猫 · 窗台晨光',exact:true});
  const imageBounds=await page.locator('.image-generation-photo').first().boundingBox();
  const buttonBounds=await downloadButton.boundingBox();
  assert.ok(buttonBounds.x < imageBounds.x+imageBounds.width/2 && buttonBounds.y > imageBounds.y+imageBounds.height/2,'download is at bottom left');
  const downloaded=page.waitForEvent('download');
  await downloadButton.click();
  const file=await downloaded;
  assert.equal(file.suggestedFilename(),'暹罗猫 · 窗台晨光.png');
  assert.deepEqual(await readFile(await file.path()),png,'downloads original image bytes');
  assert.equal(await page.locator('dialog[open]').count(),0,'download does not open preview');
  await page.getByRole('button',{name:'预览 暹罗猫 · 窗台晨光',exact:true}).click();
  await page.locator('dialog[open]').waitFor();
  assert.equal(await page.getByLabel('图片位置',{exact:true}).textContent(),'1 / 3');
  assert.ok(await page.getByRole('button',{name:'上一张图片',exact:true}).isDisabled());
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.getByLabel('图片位置',{exact:true}).textContent(),'1 / 3');
  await page.getByRole('button',{name:'放大图片',exact:true}).click();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('dialog',{name:'图片预览：暹罗猫 · 沙发暖阳',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('dialog[aria-label^="图片预览："] img')?.naturalWidth>0);
  assert.equal(await page.getByLabel('缩放比例',{exact:true}).textContent(),'100%','switching resets zoom');
  assert.ok((await page.locator('dialog[aria-label^="图片预览："] img').getAttribute('src')).includes('/image/2?'));
  const secondDownload=page.waitForEvent('download');
  await page.getByRole('button',{name:'下载原图',exact:true}).click();
  assert.equal((await secondDownload).suggestedFilename(),'暹罗猫 · 沙发暖阳.png');
  await page.getByRole('button',{name:'下一张图片',exact:true}).click();
  assert.equal(await page.getByLabel('图片位置',{exact:true}).textContent(),'3 / 3');
  assert.ok(await page.getByRole('button',{name:'下一张图片',exact:true}).isDisabled());
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByLabel('图片位置',{exact:true}).textContent(),'3 / 3');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.getByLabel('图片位置',{exact:true}).textContent(),'1 / 3');
  await page.waitForFunction(()=>document.querySelector('dialog[aria-label^="图片预览："] img')?.naturalWidth>0);
  await page.screenshot({path:'test-results/image-generations/gallery-preview.png'});
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'预览 暹罗猫 · 木地板',exact:true}).click();
  assert.equal(await page.getByLabel('图片位置',{exact:true}).textContent(),'3 / 3','open the clicked image');
  await page.keyboard.press('Escape');
  history[1].content='三张图片任务已提交。\n\n'+JSON.stringify(receipt)+'\n\n完成后可以直接下载原图。';
  await page.reload();await page.getByText('已生成 3 / 3 张',{exact:true}).waitFor();
  await page.getByText('完成后可以直接下载原图。',{exact:true}).waitFor();
  assert.equal(await page.locator('.message.being').count(),1);
  assert.ok(requests.length>=calls+3,'reload recovers tasks from persisted receipt');
  assert.ok(requests.every(r=>r.method==='GET'&&r.endpoint==='https://echo.beings.town/alice'&&r.being==='alice'));
  await mkdir('test-results/image-generations',{recursive:true});
  await page.screenshot({path:'test-results/image-generations/desktop.png'});
  await page.setViewportSize({width:375,height:900});
  await page.screenshot({path:'test-results/image-generations/narrow.png'});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  history.length=0;
  const streamURL=page.url();await page.close();
  page=await browser.newPage({viewport:{width:1100,height:850}});page.setDefaultTimeout(12000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(streamURL);
  await page.getByRole('textbox',{name:'message input'}).fill('继续生成图片');
  const beforeStreaming=requests.length;
  await page.getByRole('button',{name:'发送消息',exact:true}).click();
  await page.getByText('正在接收图片任务回执…',{exact:true}).waitFor();
  await page.getByText('已提交，正在交接任务。',{exact:true}).waitFor();
  await page.waitForTimeout(1200);
  assert.equal(requests.length,beforeStreaming,'incomplete streaming receipt never starts queries');
  event('content_block_delta',{delta:{text:streamJSON.slice(splitAt)+'\n```\n\n图片会在这里陆续显示。'}});
  await page.getByText('图片会在这里陆续显示。',{exact:true}).waitFor();
  assert.equal(requests.length,beforeStreaming,'wait for the final reply boundary even after JSON closes');
  event('message_stop',{});streamResponse.end();streamResponse=null;
  await page.getByText('已生成 3 / 3 张',{exact:true}).waitFor();
  assert.equal(await page.locator('.message.being').count(),1);
  // Old Markdown images keep their original viewer/download flow, including next to JSON receipts.
  const legacyURL=`http://127.0.0.1:${server.address().port}/image/legacy?token=legacy-3a-original`;
  for(const mixed of [false,true]){
    history.splice(0,history.length,{seq:1,role:'being',content:'历史图片：\n\n![旧图片][old]\n\n'+(mixed?JSON.stringify(receipt)+'\n\n':'')+'[old]: '+legacyURL,scene_id:'desktop-fixture',at:new Date().toISOString()});
    await page.close();page=await browser.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
    const beforeLegacy=requests.length;
    await page.goto(streamURL);
    const old=page.getByRole('button',{name:'预览 旧图片',exact:true});await old.waitFor();
    assert.equal(await old.locator('img').getAttribute('src'),legacyURL);
    if(mixed)await page.getByText('已生成 3 / 3 张',{exact:true}).waitFor();
    else {await page.waitForTimeout(1100);assert.equal(requests.length,beforeLegacy,'legacy image does not start task polling');assert.equal(await page.locator('.image-generation-card').count(),0);}
    await old.click();await page.locator('dialog[open]').waitFor();
    assert.equal(await page.getByLabel('图片位置',{exact:true}).count(),0,'legacy images stay independent');
    const legacyDownload=page.waitForEvent('download');await page.getByRole('button',{name:'下载原图',exact:true}).click();
    const legacyFile=await legacyDownload;assert.deepEqual(await readFile(await legacyFile.path()),png);
    await page.keyboard.press('Escape');
  }
  // Mixed landscape, portrait, and square images keep their full natural proportions.
  const variants=await page.evaluate(()=>[[640,360],[360,640],[480,480]].map(([width,height])=>{
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d');const gradient=ctx.createLinearGradient(0,0,width,height);
    gradient.addColorStop(0,'#b7d8e7');gradient.addColorStop(1,'#526e69');ctx.fillStyle=gradient;ctx.fillRect(0,0,width,height);
    ctx.strokeStyle='#fff';ctx.lineWidth=8;ctx.strokeRect(8,8,width-16,height-16);
    ctx.fillStyle='#fff';ctx.font='28px sans-serif';ctx.fillText(`${width} × ${height}`,24,56);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  variants.forEach((data,i)=>imageVariants.set('/image/'+(i+1),Buffer.from(data,'base64')));
  history.splice(0,history.length,{seq:1,role:'being',content:JSON.stringify(receipt),scene_id:'desktop-fixture',at:new Date().toISOString()});
  await page.close();page=await browser.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(streamURL);await page.getByText('已生成 3 / 3 张',{exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('.image-generation-images img').length===3&&[...document.querySelectorAll('.image-generation-images img')].every(img=>img.naturalWidth>0));
  for(const width of [1100,375]){
    await page.setViewportSize({width,height:width===375?2000:1000});
    const layouts=await page.locator('.image-generation-photo').evaluateAll(photos=>photos.map(photo=>{
      const img=photo.querySelector('img'),frame=photo.getBoundingClientRect(),rect=img.getBoundingClientRect();
      return {frame:{width:frame.width,height:frame.height},image:{width:rect.width,height:rect.height},ratio:img.naturalWidth/img.naturalHeight};
    }));
    for(const layout of layouts){
      assert.ok(Math.abs(layout.frame.width-layout.image.width)<1&&Math.abs(layout.frame.height-layout.image.height)<1,'frame hugs the image with no empty bands');
      assert.ok(Math.abs(layout.image.height-layout.image.width/layout.ratio)<1,'full image keeps its original aspect ratio');
    }
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.locator('.image-generation-answer').screenshot({path:`test-results/image-generations/natural-ratios-${width}.png`});
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: original bubble retained, 3 jobs complete independently, image retry, batch keyboard navigation, live gallery updates, history recovery, GET only, narrow layout.');
}finally{streamResponse?.end();await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
