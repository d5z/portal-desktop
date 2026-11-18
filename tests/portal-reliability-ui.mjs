// Real renderer components with isolated approval and outbox fixtures.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { build } from '../scripts/renderer-build.mjs';
import { browserAssets } from './support/browser-assets.mjs';

const assets = new Map(await Promise.all(['loom.html','chat.js','chat.css','highlight.css'].map(async name => ['/'+name,await readFile('desktop/generated/'+name)])));
const bundle = await build({plugins:[browserAssets()],stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
  import {createRoot} from 'react-dom/client';
  import {PermissionSettings,ToolApprovalDialog} from './desktop/renderer/app/components/permissions';
  import {AppModel} from './desktop/renderer/app/models/app';
  import {useModel} from './desktop/renderer/shared/hooks/use-model';
  import {ChatSceneIndicator} from './desktop/renderer/app/components/chat-scene';
  import {ChatActivity} from './desktop/renderer/chat/components/messages';
  import './desktop/renderer/app/styles.scss';
  import './desktop/renderer/chat/styles.scss';
  const request = id => ({id,title:'工具操作审批',message:'允许 portal_exec 执行这一次操作？',detail:'本机工具 · 本次命令需要访问输入文件\\n\\npython3 inputs/report.py',expiresAt:Date.now()+60000});
  let listener;
  window.answers=[];
  window.approval = id => listener(request(id));
  const api = {save:async settings=>({...app.snapshot,settings}),toolApprovalPending:async()=>null,onToolApproval:fn=>{listener=fn;return()=>{};},answerToolApproval:async(id,allowed)=>{
    window.answers.push({id,allowed});listener(null);
    if(id==='first'){listener(request('second'));await new Promise(resolve=>window.resolveOld=resolve);}
  }};
  const app=new AppModel(api);
  app.snapshot={settings:{permissionMode:'supervised',hasToken:true,being:'Fixture',endpoint:'https://fixture.test'},portal:{phase:'stopped',logs:[]}};
  window.permissionMode=()=>app.snapshot.settings.permissionMode;
  function Permissions(){useModel(app);return <><button style={{position:'absolute',top:10,left:360}} onClick={()=>app.openPermissionSettings()}>电脑操作权限</button><PermissionSettings app={app}/><ToolApprovalDialog app={app}/></>;}
  const scene={scene_id:'building',scene_meta:{scene_label:'building',client:'fixture'}};
  localStorage.setItem('beings:scenes-pinned','true');
  const run={kind:'run',id:'failure',start:1,end:1000,status:'done',outcome:'done',label:'执行记录',entries:[{type:'tool',id:'timeout',name:'portal_exec',done:true,error:true,result:'命令运行超过 30 秒，进程已终止。',nextAction:'查看已保留的输出；长任务使用 background=true。',resultDetail:'started\\nCommand timed out after 30s',durationMs:30000}]};
  createRoot(document.getElementById('root')).render(<><div className="workspace-stage" style={{height:'100vh'}}><ChatSceneIndicator scene={scene} sessions={[scene]} activity={{building:'send-failed'}} connected scope="current" scopeReady onScope={()=>{}} onCopy={()=>{}} onSession={async()=>{}}/><main style={{marginLeft:340,padding:24,width:'min(660px, 100%)'}}><ChatActivity run={run}/></main></div><Permissions/></>);
`},bundle:true,write:false,outdir:'/fixture',jsx:'automatic',loader:{'.png':'dataurl'},define:{'process.env.NODE_ENV':'"production"','import.meta.env.DEV':'false'}});
let modelRequests=0;
const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
  if(assets.has(pathname)){res.setHeader('Content-Type',pathname.endsWith('.js')?'text/javascript':pathname.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(assets.get(pathname));return;}
  const output=bundle.outputFiles.find(file=>file.path.endsWith(pathname));
  if(output){res.setHeader('Content-Type',pathname.endsWith('.css')?'text/css':'text/javascript');res.end(output.contents);return;}
  if(pathname==='/api/history')return json({messages:[]});
  if(pathname==='/api/chat/stream'&&req.method==='POST'){
    let body='';for await(const bytes of req)body+=bytes;
    const scene_id=JSON.parse(body).scene_id;
    res.setHeader('Content-Type','text/event-stream');
    const error={scene_id,message:'LLM API error 429 Too Many Requests: Rate exceeded.'};
    res.end(`event: meta\ndata: ${JSON.stringify({scene_id,stream_id:'rate-limit-'+(++modelRequests)})}\n\nevent: error\ndata: ${JSON.stringify(error)}\n\nevent: error\ndata: ${JSON.stringify(error)}\n\n`);return;
  }
  if(pathname==='/api/stream/active'){res.writeHead(204);res.end();return;}
  if(pathname==='/health')return res.end('OK fixture');
  if(pathname.startsWith('/api/'))return json({being_name:'Fixture',sbs_enabled:false,presets:[]});
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html data-theme="light"><meta charset="utf-8"><link rel="stylesheet" href="/stdin.css"><div id="root"></div><script src="/stdin.js"></script></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
if(process.env.PORTAL_RELIABILITY_PREVIEW==='1'){console.log(url);await new Promise(()=>{});}
let browser;
try {
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1200,height:800},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);
  await page.getByText('消息未发送',{exact:true}).waitFor();
  assert.match(await page.getByText('消息未发送',{exact:true}).getAttribute('title'),/重试附件处理或删除/);
  await page.locator('.run-activity > summary').click();
  await page.getByText('查看已保留的输出；长任务使用 background=true。',{exact:true}).waitFor();
  const menu=page.getByRole('menu',{name:'电脑操作权限',exact:true});
  await page.getByRole('button',{name:'电脑操作权限',exact:true}).click();
  await menu.waitFor();
  assert.equal(await menu.getByRole('menuitemradio').count(),2);
  assert.equal(await menu.getByRole('menuitemradio',{name:/每次询问/}).getAttribute('aria-checked'),'true');
  await mkdir('output/playwright',{recursive:true});
  await menu.screenshot({path:'output/playwright/portal-permissions-two-options.png'});
  await menu.getByRole('menuitemradio',{name:/始终允许/}).click();
  await page.waitForFunction(()=>window.permissionMode()==='full-access');
  await page.getByRole('button',{name:'电脑操作权限',exact:true}).click();
  await menu.getByRole('menuitemradio',{name:/每次询问/}).click();
  await page.waitForFunction(()=>window.permissionMode()==='supervised');
  await page.evaluate(()=>window.approval('first'));
  await page.getByRole('button',{name:'允许这一次',exact:true}).click();
  await page.waitForFunction(()=>window.resolveOld);
  await page.evaluate(()=>window.resolveOld());
  await page.waitForFunction(()=>document.querySelector('dialog[open]'));
  await page.getByRole('button',{name:'允许这一次',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
  assert.deepEqual(await page.evaluate(()=>window.answers),[{id:'first',allowed:true},{id:'second',allowed:true}]);
  await mkdir('output/playwright',{recursive:true});
  await page.screenshot({path:'output/playwright/portal-reliability-light.png'});
  await page.evaluate(()=>{document.documentElement.dataset.theme='dark';window.approval('third');});
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'允许这一次',exact:true}).waitFor();
  const dialog=await page.locator('dialog[open]').boundingBox();assert.ok(dialog.width<=390);
  await page.screenshot({path:'output/playwright/portal-approval-dark-narrow.png'});
  await page.keyboard.press('Escape');
  assert.equal((await page.evaluate(()=>window.answers)).at(-1).allowed,false);
  // Seed a failed outbox row, then let the real chat restore and remove it.
  await page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('portal-scene-outbox',1);request.onupgradeneeded=()=>request.result.createObjectStore('sends',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    await new Promise((resolve,reject)=>{const tx=db.transaction('sends','readwrite');tx.objectStore('sends').put({id:'failed-input',endpoint:location.origin,scene:{sceneId:'building'},text:'处理报告附件',files:[],createdAt:Date.now(),phase:'failed',error:'附件解析失败：report.pdf，请重试或删除这条排队消息'});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
  });
  await page.goto(url+'/loom.html?scene_id=building&scene_strict=1');
  const row=page.locator('.composer-queue-item');await row.waitFor();
  await row.getByText('附件解析失败：report.pdf，请重试或删除这条排队消息',{exact:true}).waitFor();
  await page.screenshot({path:'output/playwright/portal-failed-queue-narrow.png'});
  await row.getByRole('button',{name:'取消排队：处理报告附件',exact:true}).click();
  await row.waitFor({state:'detached'});
  const input=page.getByRole('textbox',{name:'message input'});
  const rateLimit=page.getByText('⚠ LLM API error 429 Too Many Requests: Rate exceeded.',{exact:true});
  await input.fill('test duplicate model error');await input.press('Enter');
  await rateLimit.waitFor();assert.equal(await rateLimit.count(),1);
  await page.getByRole('button',{name:'发送消息',exact:true}).waitFor();
  await page.screenshot({path:'output/playwright/model-error-once.png'});
  await input.fill('new turn, same rate limit');await input.press('Enter');
  await page.waitForFunction(()=>document.querySelectorAll('.message.system').length===2);
  assert.equal(await rateLimit.count(),2,'A new request must retain its own failure');
  assert.deepEqual(errors,[]);
  console.log('Portal reliability UI passed: two permission options and saving, consecutive approval, visible recovery, narrow/dark dialog, restored failure/removal, repeated 429 once per turn.');
} finally {await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
