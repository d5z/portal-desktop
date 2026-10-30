import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
await mkdir('test-results',{recursive:true});
const assets=new Map(await Promise.all(['loom.html','chat.js','chat.css','highlight.css'].map(async f=>['/'+f,await readFile('desktop/generated/'+f)])));
const base=new Date(2026,9,29,15,30).getTime();
const history=[['user','第一条消息',0],['being','这段文字可以选中并添加到聊天。',60000],['being','**加粗内容**\n\n> 引用内容\n\n`# 保留符号 *不是格式*`\n\n```js\nconst value = 1;\n```',120000],['user','六分钟后的问题',480000]].map(([role,content,offset],i)=>({seq:i+1,role,content,scene_id:'message-flow',at:new Date(base+offset).toISOString()}));
let sends=0;
const server=createServer((req,res)=>{
 const url=new URL(req.url,'http://local');const json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
 if(url.pathname==='/api/history')return json({messages:history});
 if(url.pathname==='/api/status')return json({being_name:'Willow',tools:0});
 if(url.pathname==='/api/stream/active'){res.writeHead(204);return res.end();}
 if(url.pathname==='/api/llm/config')return json({model:'fixture',sbs_enabled:false});
 if(url.pathname==='/api/chat/stream'){sends++;res.writeHead(500);return res.end();}
 if(assets.has(url.pathname)){res.setHeader('Content-Type',url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':'text/html; charset=utf-8');return res.end(assets.get(url.pathname));}
 if(url.pathname==='/health')return res.end('OK');
 return json({});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1100,height:850}});page.setDefaultTimeout(10000);
 await page.addInitScript(()=>{window.copied=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{if(window.failCopy)throw Error('test failure');window.copied.push(text);}}});});
 await page.addInitScript(()=>{
   const tracked=new Map();const add=EventTarget.prototype.addEventListener,remove=EventTarget.prototype.removeEventListener;
   const key=(target,type,options)=>(target===window?'window:':'document:')+type+':'+Boolean(typeof options==='boolean'?options:options?.capture);
   EventTarget.prototype.addEventListener=function(type,fn,options){if(this===window||this===document){const id=key(this,type,options);if(!tracked.has(id))tracked.set(id,new Set());tracked.get(id).add(fn);}return add.call(this,type,fn,options);};
   EventTarget.prototype.removeEventListener=function(type,fn,options){if(this===window||this===document)tracked.get(key(this,type,options))?.delete(fn);return remove.call(this,type,fn,options);};
   window.listenerCounts=()=>Object.fromEntries([...tracked].filter(([key,values])=>values.size&&/:(contextmenu|pointermove|pointerdown|scroll|resize|blur):/.test(key)).map(([key,values])=>[key,values.size]));
 });
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/loom.html?scene_id=message-flow`);
 await page.getByText('六分钟后的问题',{exact:true}).waitFor();
 assert.equal(await page.locator('.message-time-divider').count(),2);
 assert.equal(await page.locator('.message .meta time').count(),0);
 assert.equal(await page.locator('.message-time-divider').first().evaluate(n=>getComputedStyle(n).textAlign),'center');
 // Blank space, timestamps, and controls never open the app's custom menu.
 for(const selector of ['#messages','.message-time-divider','#send-btn']){
   assert.equal(await page.locator(selector).first().evaluate(node=>{const event=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});node.dispatchEvent(event);return event.defaultPrevented;}),false);
   assert.equal(await page.getByRole('menu').count(),0);
 }
 const idle=await page.evaluate(()=>listenerCounts());
 assert.equal(idle['document:contextmenu:false'],1);
 assert.equal(idle['window:pointermove:true']||0,0);
 const bubble=page.locator('[data-history-seq="2"] .message-bubble-body');
 await bubble.click({button:'right'});
 const menu=page.getByRole('menu',{name:'消息操作'});
 await menu.waitFor();assert.equal(await menu.evaluate(n=>getComputedStyle(n).borderRadius),'20px');assert.match(await menu.locator('time').innerText(),/10月29日.*15:31/);
 assert.doesNotMatch(await menu.locator('time').innerText(),/2026|15:31:00/);
 assert.deepEqual(await menu.getByRole('menuitem').allTextContents(),['复制']);
 assert.equal(await menu.locator('small').count(),0);
 await page.evaluate(()=>window.failCopy=true);
 await menu.getByRole('menuitem',{name:'复制',exact:true}).click();
 await menu.getByRole('alert').waitFor();assert.equal(await menu.isVisible(),true);
 await page.evaluate(()=>window.failCopy=false);
 await menu.getByRole('menuitem',{name:'复制',exact:true}).click();
 await menu.waitFor({state:'detached'});
 assert.equal(await page.evaluate(()=>copied.at(-1)),history[1].content);
 await bubble.focus();await page.keyboard.press('Shift+F10');await menu.waitFor();
 await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
 await menu.waitFor({state:'detached'});assert.equal(await page.evaluate(()=>copied.at(-1)),history[1].content);
 await page.locator('#input').fill('保留我的草稿');
 const select=async()=>{
  // Tiptap restores composer focus on the next frame; finish that before a new selection.
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await bubble.focus();
  await bubble.evaluate(node=>{const text=node.querySelector('.content')||node;const range=document.createRange();range.selectNodeContents(text);const s=getSelection();s.removeAllRanges();s.addRange(range);});
 };
 // Empty drafts must not retain the editor's placeholder paragraph or gain a trailing one.
 await page.locator('#input').press('ControlOrMeta+a');await page.locator('#input').press('Backspace');
 await page.waitForFunction(()=>document.querySelector('#input').editor.isEmpty);
 await bubble.focus();await select();await page.locator('#scene-selection-action').click();
 assert.equal(await page.locator('#input').evaluate(n=>n.editor.getMarkdown()),history[1].content);
 assert.equal(await page.locator('#input > p').count(),1,'Adding into an empty draft creates only the selected paragraph');
 await page.locator('#input').evaluate(n=>n.editor.commands.undo());
 assert.equal(await page.locator('#input').evaluate(n=>n.editor.isEmpty),true,'Adding text remains a single undoable edit');
 await page.locator('#input').fill('保留我的草稿');
 await bubble.focus();await select();await page.getByRole('button',{name:'添加到聊天',exact:true}).waitFor();
 await page.screenshot({path:'test-results/message-selection-light.png'});
 await page.locator('#scene-selection-action').click();
 const draft=()=>page.locator('#input').evaluate(n=>n.value??n.editor.getMarkdown());
 assert.equal(await draft(),`保留我的草稿\n\n${history[1].content}`);
 assert.match(await draft(),/^保留我的草稿/);assert.match(await draft(),/这段文字/);assert.equal(await page.locator('#input blockquote').count(),0);assert.doesNotMatch(await draft(),/^> /m);assert.equal(sends,0);
 await page.waitForFunction(()=>{const n=document.querySelector('#input');return n===document.activeElement||n.contains(document.activeElement);});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await bubble.focus();await select();await page.locator('#scene-selection-action').waitFor({state:'visible'});
 const shortcut=await page.evaluate(()=>/Mac|iPhone|iPad|iPod/.test(navigator.platform)?'Meta+l':'Control+l');
 await page.keyboard.press(shortcut);await page.locator('#scene-selection-action').waitFor({state:'hidden'});
 assert.equal((await draft()).split('这段文字').length,3);assert.equal(sends,0);
 await page.waitForFunction(()=>document.querySelector('#input')===document.activeElement);
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 // A selection still has one Copy command; it copies only the selected characters.
 await bubble.focus();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));await bubble.evaluate(node=>{const text=node.querySelector('.content p').firstChild;const range=document.createRange();range.setStart(text,0);range.setEnd(text,4);getSelection().removeAllRanges();getSelection().addRange(range);});
 await bubble.dispatchEvent('contextmenu',{button:2,clientX:120,clientY:180});await menu.waitFor();
 assert.deepEqual(await menu.getByRole('menuitem').allTextContents(),['复制']);
 await menu.getByRole('menuitem',{name:'复制',exact:true}).click();
 assert.equal(await page.evaluate(()=>copied.at(-1)),'这段文字');
 await page.evaluate(()=>getSelection().removeAllRanges());
 // Selection adds literal text only; there is no Reply action in the menu.
 await page.locator('#input').fill('保留我的草稿');
 const formatted=page.locator('[data-history-seq="3"] .message-bubble-body');
 await formatted.locator('p code').scrollIntoViewIfNeeded();
 await formatted.evaluate(node=>node.focus({preventScroll:true}));
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await formatted.evaluate(node=>{const range=document.createRange();range.selectNodeContents(node.querySelector('p code'));getSelection().removeAllRanges();getSelection().addRange(range);});
 await page.locator('#scene-selection-action').click();
 await page.waitForFunction(()=>document.querySelector('#input').innerText.includes('保留符号'));
 assert.match(await page.locator('#input').innerText(),/^保留我的草稿[\s\S]*# 保留符号 \*不是格式\*/);
 assert.equal(await page.locator('#input blockquote, #input strong, #input code, #input h1').count(),0);
 await page.waitForFunction(()=>document.querySelector('#input')===document.activeElement);
 assert.equal(sends,0);
 await page.screenshot({path:'test-results/message-selection-plain.png'});
 await page.setViewportSize({width:435,height:746});
 await bubble.scrollIntoViewIfNeeded();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await bubble.click({button:'right'});await menu.waitFor();
 const rect=await menu.boundingBox();assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=435&&rect.y+rect.height<=746);
 await page.waitForFunction(()=>{const n=document.querySelector('.message-context-menu');return n?.matches(':popover-open')&&n.getAnimations().length===0;});
 await page.screenshot({path:'test-results/message-menu-narrow.png'});
 await page.keyboard.press('Escape');assert.equal(await bubble.evaluate(n=>n===document.activeElement),true);
 await page.evaluate(()=>document.documentElement.dataset.theme='dark');await bubble.click({button:'right'});
 await page.waitForFunction(()=>{const n=document.querySelector('.message-context-menu');return n?.matches(':popover-open')&&n.getAnimations().length===0;});
 await page.screenshot({path:'test-results/message-menu-dark.png'});
 await page.locator('#input').dispatchEvent('scroll');assert.equal(await menu.isVisible(),true);
 await page.locator('#messages').evaluate(node=>{node.scrollTop+=60;});
 await menu.waitFor({state:'detached'});
 // Repeated open/close cycles must not accumulate global listeners.
 for(let i=0;i<5;i++){
   await bubble.focus();await page.keyboard.press('Shift+F10');await menu.waitFor();
   await page.keyboard.press('Escape');await menu.waitFor({state:'detached'});
 }
 assert.deepEqual(await page.evaluate(()=>listenerCounts()),idle);
 // Drag cleanup listeners are present only during a file drag.
 await page.locator('.chat-root').dispatchEvent('dragenter',{dataTransfer:await page.evaluateHandle(()=>{const d=new DataTransfer();d.items.add(new File(['x'],'x.txt',{type:'text/plain'}));return d;})});
 await page.waitForFunction(()=>listenerCounts()['window:pointermove:true']===1);
 await page.keyboard.press('Escape');
 await page.waitForFunction(()=>!listenerCounts()['window:pointermove:true']);
 assert.deepEqual(await page.evaluate(()=>listenerCounts()),idle);
 assert.deepEqual(errors,[]);console.log('PASS: grouped time, compact menu, copy/retry/selection, keyboard menu, selection click/shortcut, plain-text selection, preserved draft and zero sends, narrow/dark menu.');
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
