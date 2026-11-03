import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { build } from '../scripts/renderer-build.mjs';
import { chromium } from 'playwright';
import { readShellStyles } from './support/shell-styles.mjs';
import { browserAssets } from './support/browser-assets.mjs';

const { outputFiles } = await build({ plugins: [browserAssets()], stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppModel } from './desktop/renderer/app/models/app';
import { useModel } from './desktop/renderer/shared/hooks/use-model';
import { BeingInfo } from './desktop/renderer/app/components/workspace-navigation';
import { Topbar } from './desktop/renderer/app/components/topbar';
const scenes = ['a','b'].map(id => ({scene_id:id,scene_meta:{client:'fixture',scene_label:'本地场景 '+id}}));
const snapshot = {settings:{endpoint:'https://fixture.test/first',being:'fixture',hasToken:true},portal:{phase:'stopped',logs:[]},chatScene:scenes[0],chatSessions:scenes};
window.historyMode = 'initial-hold'; window.historyCalls = []; window.selections = [];
const rows = Array.from({length:100}, (_, i) => ({seq:100-i,role:i<3||i%2?'user':'being',content:i===0?'最新消息：可跳转到本地场景':i===1?'其他设备场景消息':i===2?'无场景消息':i===3?'帮我制作一个介绍出图流程的网页，包含详细步骤、参数说明、示例图片和常见问题，适配手机与桌面':'历史消息 '+(100-i),at:i<4?'2026-10-22T01:00:00Z':'2026-10-21T08:24:00Z',scene_id:i===1?'remote':i===2?'':'b',scene_label:i===1?'远程场景':''}));
rows[0].scene_id='';
rows.push({...rows[0], seq:101, content:'[breath yielded to human]', from:'system', type:'marker'});
rows.push({...rows[0], seq:102, content:'[breath interrupted]'});
const app = new AppModel({
  beingModelConfig:async()=>({model:'fixture'}),
  recentChatHistory:async endpoint=>{window.historyCalls.push(endpoint);if(window.historyMode==='initial-hold')return new Promise(resolve=>window.releaseInitial=()=>resolve(rows));if(window.historyMode==='hold')return new Promise(resolve=>window.releaseHistory=()=>resolve([{...rows[0],content:'旧连接迟到的消息'}]));if(window.historyMode==='error')throw new Error('fixture');return endpoint.endsWith('/second')?[{...rows[0],content:'新 Being 消息',scene_id:'remote'}]:window.historyMode==='empty'?[]:rows;},
  changeChatSession:async(op,id,endpoint)=>{window.selections.push({op,id,endpoint});return {...app.snapshot,chatScene:scenes.find(scene=>scene.scene_id===id)};}
});
app.applySnapshot(snapshot); app.chatLoading=false; app.sbsKnown=true; app.sbsEnabled=true; app.beingInfoOpen=true;
window.app=app;
const frame=document.createElement('iframe');frame.hidden=true;document.body.append(frame);
const loadLocal=()=>{app.chatLoading=true;const params=new URL(app.chatSource).searchParams;frame.src='/local.html?'+params;};
app.post=data=>frame.contentWindow.postMessage(data,location.origin);
addEventListener('message',event=>{if(event.source!==frame.contentWindow||event.origin!==location.origin)return;if(event.data.type==='fixture:local-ready'){app.chatLoading=false;app.changed();}else if(event.data.type==='beings:history-target-result'){window.lastTarget=event.data;app.finishHistoryTarget(event.data.sceneId,event.data.seq,event.data.ok);}else app.localHistory.receive(event.data);});
loadLocal();
window.switchBeing=()=>{app.applySnapshot({...app.snapshot,settings:{...app.snapshot.settings,endpoint:'https://fixture.test/second',being:'second'}});loadLocal();};
function Fixture(){useModel(app);return <div className="workspace-body"><div className="workspace-stage"><Topbar model={app}/><div className="workspace-content">对话区域</div></div><BeingInfo app={app}/></div>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
` }, bundle:true,write:false,outfile:'fixture.js',format:'iife',platform:'browser',jsx:'automatic',define:{'import.meta.env.DEV':'false'} });
const localBundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
import { ChatState } from './desktop/renderer/chat/models/chat';
import { createChatBridge } from './desktop/renderer/chat/services/bridge';
import { HistoryCache } from './desktop/renderer/chat/services/history-cache';
(async()=>{
  const endpoint=new URLSearchParams(location.search).get('history_scope');
  const cache=new HistoryCache(endpoint);
  if(endpoint.endsWith('/first'))await cache.write([
    {seq:100,role:'user',content:'最新消息：可跳转到本地场景',scene_id:'b',at:'2026-10-22T01:00:00Z'},
    {seq:60,role:'user',content:'仅在本地缓存的场景提问',scene_id:'a',at:'2026-10-21T08:24:00Z'},
    {seq:58,role:'user',content:'缓存中的外部场景',scene_id:'remote-cache',at:'2026-10-21T08:24:00Z'},
    {seq:106,role:'being',content:'不显示缓存回复',scene_id:'a'},
    ...Array.from({length:250},(_,i)=>({seq:i+200,role:'being',content:'缓存最新窗口内的自主回复',scene_id:'background'}))
  ],106);
  cache.close();
  const state=new ChatState(),bridge=createChatBridge(state);
  bridge.start({loadSbsState:async()=>true,selectScene:async scene=>{state.currentScene=scene;},loadHistoryTarget:async()=>true},{scope:value=>{state.historyScope=value;},reveal:(seq,sceneId)=>bridge.send({type:'beings:history-target-result',seq,sceneId,ok:true})});
  addEventListener('pagehide',()=>bridge.dispose());
  parent.postMessage({type:'fixture:local-ready'},location.origin);
})();
` }, bundle:true, write:false, format:'iife', platform:'browser' });
const css = await readShellStyles() + (outputFiles.find(file => file.path.endsWith('.css'))?.text || '');
const server = createServer((request,response)=>{
  if(request.url.startsWith('/local.html')){response.setHeader('Content-Type','text/html');response.end('<!doctype html><script src="/local.js"></script>');return;}
  if(request.url==='/local.js'){response.setHeader('Content-Type','text/javascript');response.end(localBundle.outputFiles[0].text);return;}
  if(request.url==='/fixture.js'){response.setHeader('Content-Type','text/javascript');response.end(outputFiles[0].text);return;}
  response.setHeader('Content-Type','text/html; charset=utf-8');response.end('<!doctype html><style>'+css+'</style><body data-view="chat"><div id="root"></div><script src="/fixture.js"></script>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{channel:'chrome'})});
  const page=await browser.newPage({viewport:{width:1000,height:780},timezoneId:'Asia/Shanghai'}), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const origin='http://127.0.0.1:'+server.address().port;
  await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await page.goto(origin);
  await page.waitForFunction(()=>!window.app.chatLoading);
  assert.equal(await page.locator('.pair-human,.pair-link').count(),0);
  assert.equal(await page.locator('#conversation-name').textContent(),'fixture');
  assert.equal(await page.locator('#conversation-name').isVisible(),true);
  const dot=page.locator('.topbar [aria-label="SBS 状态与显示设置"] > span');
  assert.equal(await dot.isVisible(),true);
  assert.equal(await dot.getAttribute('data-enabled'),'true');
  await page.getByRole('button',{name:'SBS 状态与显示设置'}).click();
  await page.getByRole('dialog',{name:'SBS 自主活动'}).waitFor();
  await page.getByRole('button',{name:'关闭 SBS 设置'}).click();
  assert.equal(await page.evaluate(()=>window.historyCalls.length),0,'Profile does not fetch history');
  assert.deepEqual(await page.getByRole('tablist',{name:'Being 信息分类'}).getByRole('tab').allTextContents(),['详情','动态','资料库','电脑']);
  await page.getByRole('tab',{name:'动态',exact:true}).click();
  const list=page.getByRole('region',{name:'最近提问'});
  await page.getByRole('heading',{name:'场景动态',exact:true}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'场景动态',exact:true}).count(),1);
  assert.equal(await page.getByRole('heading',{name:'最近消息',exact:true}).count(),0);
  assert.equal(await page.getByText('暂时没有新的场景动态',{exact:true}).count(),0);
  await list.getByText('最新消息：可跳转到本地场景').waitFor();
  await list.getByText('仅在本地缓存的场景提问',{exact:true}).waitFor();
  assert.equal(await list.locator('li').count(),3,'Local cache appears before the history response');
  await page.evaluate(()=>{window.historyMode='normal';window.releaseInitial();});
  await list.getByText('其他设备场景消息',{exact:true}).waitFor();
  assert.equal(await list.locator('li').count(),54);
  assert.equal(await list.getByText('[breath yielded to human]',{exact:true}).count(),0);
  assert.equal(await list.getByText('[breath interrupted]',{exact:true}).count(),0);
  assert.equal(await list.locator('.being-history-date').count(),2);
  assert.equal(await list.locator('.being-history-date').first().textContent(),'2026年10月22日');
  assert.equal(await list.locator('time').first().textContent(),'09:00');
  assert.equal(await list.getByText('历史消息 96',{exact:true}).count(),0,'Being responses are omitted');
  assert.equal(await list.getByText('本地场景 b',{exact:true}).count(),0);
  assert.equal(await list.getByText('进入场景 ↗',{exact:true}).count(),0);
  assert.equal(await list.locator('.being-history-preview').nth(3).evaluate(el=>getComputedStyle(el).textOverflow==='ellipsis'&&getComputedStyle(el).whiteSpace==='nowrap'&&el.scrollWidth>el.clientWidth),true,'Long questions have single-line ellipsis');
  assert.equal(await list.locator('li').nth(1).getByRole('button').count(),0);
  assert.equal(await list.locator('li').nth(2).getByRole('button').count(),0);
  await list.locator('li').first().getByRole('button').click();
  await page.waitForFunction(()=>window.app.snapshot.chatScene.scene_id==='b');
  assert.deepEqual(await page.evaluate(()=>window.selections),[{op:'select',id:'b',endpoint:'https://fixture.test/first'}]);
  assert.equal(await page.evaluate(()=>window.app.chatHistoryScope),'current');
  await page.waitForFunction(()=>window.lastTarget?.seq===100);
  assert.equal(await page.evaluate(()=>window.app.beingInfoOpen),false);
  await page.evaluate(()=>{window.app.beingInfoOpen=true;window.app.changed();});
  await page.getByRole('tab',{name:'动态',exact:true}).click();
  await page.evaluate(()=>{window.savedScenes=window.app.snapshot.chatSessions;window.app.snapshot.chatSessions=[];window.app.changed();});
  assert.equal(await list.locator('li').count(),54,'All history questions remain even with no local scenes');
  assert.equal(await list.getByRole('button').count(),0,'Local availability affects navigation only');
  await list.getByText('其他设备场景消息',{exact:true}).click();
  assert.equal(await page.evaluate(()=>window.selections.length),1,'Remote rows do not navigate');
  await page.evaluate(()=>{window.app.snapshot.chatSessions=window.savedScenes;window.app.changed();});
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/scene-recent-history-light.png'});
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await page.setViewportSize({width:640,height:780});
  await page.screenshot({path:'test-results/scene-recent-history-dark.png'});
  assert.equal(await list.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  await page.evaluate(()=>window.historyMode='error');
  await page.getByRole('button',{name:'刷新',exact:true}).click();
  await page.getByText('网络历史读取失败，已保留可用对话。',{exact:false}).waitFor();
  assert.equal(await list.locator('li').count(),54,'A failed refresh preserves the last successful list');
  await page.evaluate(()=>window.historyMode='empty');
  await page.getByRole('button',{name:'重试',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.being-history-list li').length===3);
  await list.getByText('仅在本地缓存的场景提问',{exact:true}).waitFor();
  await list.getByRole('button',{name:/仅在本地缓存的场景提问/}).click();
  await page.waitForFunction(()=>window.app.snapshot.chatScene.scene_id==='a');
  await page.waitForFunction(()=>window.lastTarget?.seq===60);
  await page.evaluate(()=>{window.app.beingInfoOpen=true;window.app.changed();});
  await page.getByRole('tab',{name:'动态',exact:true}).click();
  await page.evaluate(()=>window.historyMode='hold');
  await page.getByRole('button',{name:'刷新',exact:true}).click();
  await page.waitForFunction(()=>typeof window.releaseHistory==='function');
  await page.evaluate(()=>{window.historyMode='normal';window.switchBeing();});
  await list.getByText('新 Being 消息',{exact:true}).waitFor();
  await page.evaluate(()=>window.releaseHistory());
  await page.waitForFunction(()=>document.querySelector('.being-history-preview').textContent==='新 Being 消息');
  assert.equal(await list.getByText('旧连接迟到的消息').count(),0);
  await page.evaluate(()=>{window.app.snapshot.settings.hasToken=false;window.app.changed();});
  await page.getByText('连接 Being 后查看场景动态').waitFor();
  assert.equal(await list.locator('li').count(),0);
  await page.evaluate(()=>{window.app.api.recentChatHistory=undefined;window.app.snapshot.settings.hasToken=true;window.app.changed();});
  await page.getByText('客户端接口已更新，请重新打开客户端后查看场景动态。',{exact:false}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS: real IndexedDB + remote question union, seq deduplication, cache-only navigation, empty/failed history fallback, identity isolation, ellipsis and SBS menu');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
