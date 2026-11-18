import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from '../scripts/renderer-build.mjs';
import { chromium } from 'playwright';

const bundle = await build({ stdin: { contents: `
import {createRoot} from 'react-dom/client';
import {StrictMode} from 'react';
import {Store} from './desktop/renderer/shared/models/store';
import {SubagentModelSettings} from './desktop/renderer/app/components/subagent-model-settings';
const main={provider:'portal-custom',model:'local-model',base_url:'http://127.0.0.1:9900/v1',api:'openai-completions',thinking:'high'};
let local={...main,enabled:true,inherit_model:true,api_key_configured:false};
const snapshot={settings:{hasToken:true,workspace:'/tmp',portalName:'fixture'}};
window.saves=[];
const app=Object.assign(new Store(), {
  subagentSettingsOpen:true,snapshot,
  api:{
    beingModelConfig:async patch => patch ? {ok:true,config:{...main,...patch}} : {...main,presets:[]},
    subagentConfig:async()=>local,
    subagentStatus:async()=>({enabled:true,configured:true,ready:true,provider:local.provider,model:local.model,thinking:local.thinking,api:local.api,baseUrl:local.base_url,apiKeyConfigured:local.api_key_configured,inheritModel:local.inherit_model,health:'error',message:'最近一次 subagent 任务未完成。',lastTask:{id:'test-failed',status:'failed',turns:1,error:'模型鉴权失败，请检查接口凭据'}}),
    save:async input=>{window.saves.push(input);local=input.subagentSetup?{...input.subagentSetup,inherit_model:false,api_key_configured:!!input.subagentSetup.api_key}:{...main,inherit_model:true,api_key_configured:false};return snapshot},
    onPortal:()=>()=>{},onSceneTasks:()=>()=>{}
  },
  applySnapshot(){},
  closeSubagentSettings(){this.subagentSettingsOpen=false;this.changed()}
});
window.app=app;

const originalFetch = window.fetch.bind(window);
window.fetch = async (target, init = {}) => {
 const url = new URL(String(target), location.href);
 if (url.protocol !== 'beings:' || url.hostname !== 'chat') return originalFetch(target, init);
 const kind = url.pathname.split('/').pop();
 if (kind === 'config') {
   const data = await app.api.beingModelConfig(init.body ? JSON.parse(init.body) : undefined);
   return Response.json(data, {status:data.ok === false ? data.http_status || 400 : 200});
 }
 const input = kind === 'keys' ? JSON.parse(init.body) : {route:url.searchParams.get('route')};
 const result = app.api.beingModelCatalog ? await app.api.beingModelCatalog({...input, kind}) : {status:200,data:kind==='routes'?{routes:[]}:{models:[]}};
 return Response.json(result.data, {status:result.status});
};
createRoot(document.getElementById('root')).render(<StrictMode><SubagentModelSettings app={app}/></StrictMode>);
`, loader: 'tsx', resolveDir: process.cwd() }, bundle: true, write: false, outdir: 'fixture', format: 'iife', jsx: 'automatic', platform: 'browser' });
const css = bundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
const server = createServer((req,res)=>{ if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles.find(file=>file.path.endsWith('.js')).contents)} else if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css)} else {res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script>')} });
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
if (process.env.SUBAGENT_UI_PREVIEW) {
  console.log(`http://127.0.0.1:${server.address().port}`);
  await new Promise(()=>{});
}
let browser;
try {
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1100,height:900}});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('heading',{name:'local-model',exact:true}).waitFor();
  await page.getByRole('alert').filter({hasText:'subagent 配置出错'}).waitFor();
  assert.equal(await page.getByText('启用 subagent',{exact:true}).count(),0);
  await page.getByRole('button',{name:'重新配置',exact:true}).click();
  await page.getByLabel('模型来源',{exact:true}).selectOption('custom');
  await page.getByLabel('模型名称',{exact:true}).fill('custom-model');
  await page.getByRole('button',{name:'验证并应用 subagent 配置'}).click();
  await page.getByText('模型验证成功，已应用并重启 Portal。',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.saves.at(-1).subagentSetup.model),'custom-model');
  assert.equal(await page.evaluate(()=>window.saves.at(-1).subagentInherit),false);
  await page.getByLabel('模型来源',{exact:true}).selectOption('inherit');
  await page.getByRole('button',{name:'验证并应用 subagent 配置'}).click();
  await page.getByText('模型验证成功，已应用并重启 Portal。',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.saves.at(-1).subagentInherit),true);
  console.log('PASS: default inheritance, visible failure status, explicit custom save and return to inheritance.');
} finally { await browser?.close(); server.close(); }
