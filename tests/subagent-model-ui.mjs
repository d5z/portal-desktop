import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const bundle = await build({ stdin: { contents: `
import {createRoot} from 'react-dom/client';
import {StrictMode,useSyncExternalStore} from 'react';
import {Store} from './desktop/renderer/shared/models/store';
import {SubagentModelSettings} from './desktop/renderer/app/components/subagent-model-settings';
const app=Object.assign(new Store(), {
  modelSettingsTarget:'Heart',subagentSettingsOpen:true,subagentFromConnection:false,
  form:{connectionLink:'keep-this-draft'},snapshot:{settings:{hasToken:true,workspace:'/tmp',portalName:'fixture'}},
  api:{subagentConfig:async()=>({provider:'openai',model:'local-fixture',thinking:'high'}),
    beingModelConfig:async patch=>{if(patch){window.heartPatches.push(patch);return {ok:true,config:{provider:patch.provider,model:patch.model}}}return window.currentBeing || {provider:'anthropic',model:'heart-fixture',presets:[]}},
    save:async input=>{window.saves.push(input);if(window.failSave)throw new Error('fixture save failed');return {settings:input}}},
  editForm(k,v){this.form[k]=v;this.changed()},closeSubagentSettings(){this.subagentSettingsOpen=false;this.changed()},
  applySnapshot(s){this.snapshot=s;this.changed()}
});
window.saves=[];window.heartPatches=[];window.app=app;
window.openSettings=(staged,target='subagent')=>{app.modelSettingsTarget=target;app.subagentFromConnection=staged;app.subagentSettingsOpen=true;app.changed()};
function Fixture(){useSyncExternalStore(app.subscribe,app.getVersion);return app.subagentSettingsOpen?<SubagentModelSettings app={app}/>:null}
createRoot(document.getElementById('root')).render(<StrictMode><Fixture/></StrictMode>);
`, loader: 'tsx', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', jsx: 'automatic', platform: 'browser' });
const css = (await readFile('desktop/renderer/app/styles.css', 'utf8')).replace('@import "../shared/model-settings.css";', '') + await readFile('desktop/renderer/shared/model-settings.css', 'utf8');
const server = createServer((req,res)=>{
  if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].contents)}
  else if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css)}
  else{res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script>')}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try {
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1100,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);
  const being=page.getByRole('tab',{name:'Being 模型',exact:true}), subagent=page.getByRole('tab',{name:'subagent',exact:true});
  await page.getByRole('heading',{name:'heart-fixture',exact:true}).waitFor();
  await page.evaluate(()=>{window.panelNode=document.querySelector('#settings-panel');window.tabNode=document.querySelector('[role=tablist]')});
  await page.getByRole('button',{name:/自定义/}).click();
  await page.locator('#Heart-s2-model').fill('heart-new-model');
  await page.locator('#Heart-s2-provider').fill('openai-responses');
  await page.locator('#Heart-s2-base-url').fill('https://fixture.invalid/v1');
  await page.locator('#Heart-s2-api-key').fill('heart-key');
  await subagent.click();
  await page.getByRole('heading',{name:'local-fixture',exact:true}).waitFor();
  assert.equal(await page.locator('dialog[open]').count(),0);
  await page.getByRole('button',{name:'编辑配置'}).click();
  await page.locator('#subagent-s2-model').fill('new-local-model');
  await page.locator('#subagent-s2-api-key').fill('local-key');
  assert.equal(await page.locator('#subagent-s2-base-url').isVisible(),false);
  for(let i=0;i<3;i++) {
    await being.click();assert.equal(await page.locator('#Heart-s2-api-key').inputValue(),'heart-key');
    await subagent.click();assert.equal(await page.locator('#subagent-s2-model').inputValue(),'new-local-model');
    assert.equal(await page.locator('#subagent-s2-api-key').inputValue(),'local-key');
  }
  assert.equal(await page.evaluate(()=>window.panelNode===document.querySelector('#settings-panel') && window.tabNode===document.querySelector('[role=tablist]')),true);
  assert.equal(await page.locator('#settings-panel').count(),1);
  const bounds=await page.locator('#subagent-model-panel').boundingBox();assert.equal(Math.round(bounds.x+bounds.width),1100);
  await being.click();await page.locator('#Heart-s2-apply').click();
  await page.waitForFunction(()=>window.heartPatches.length===1);
  assert.deepEqual(await page.evaluate(()=>window.heartPatches[0]),{model:'heart-new-model',provider:'openai-responses',base_url:'https://fixture.invalid/v1',api_key:'heart-key'});
  assert.equal(await page.evaluate(()=>window.saves.length),0);
  await subagent.click();await page.evaluate(()=>{window.failSave=true});await page.locator('#subagent-s2-apply').click();
  await page.getByRole('alert').filter({hasText:'fixture save failed'}).waitFor();
  await page.evaluate(()=>{window.failSave=false});await page.locator('#subagent-s2-apply').click();
  await page.getByRole('heading',{name:'new-local-model',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.saves.at(-1).subagentSetup.api_key),'local-key');
  assert.equal(await page.evaluate(()=>window.heartPatches.length),1);
  await page.getByRole('button',{name:'关闭模型设置'}).click();
  await page.evaluate(()=>window.openSettings(true));
  await page.getByRole('heading',{name:'local-fixture',exact:true}).waitFor();
  await being.click();await page.getByRole('heading',{name:'heart-fixture',exact:true}).waitFor();await subagent.click();
  await page.getByRole('button',{name:'编辑配置'}).click();await page.locator('#subagent-s2-model').fill('staged-model');
  await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/shared-subagent-model.png'});
  await page.getByRole('button',{name:'使用此配置并返回'}).click();await page.waitForFunction(()=>!window.app.subagentSettingsOpen);
  assert.equal(await page.evaluate(()=>window.app.form.subagentSetup.model),'staged-model');
  assert.equal(await page.evaluate(()=>window.app.form.connectionLink),'keep-this-draft');
  assert.equal(await page.evaluate(()=>window.saves.length),2);
  await page.evaluate(()=>{window.currentBeing={provider:'self-hosted',model:'custom-being-model',base_url:'http://127.0.0.1:9900/v1',api:'openai-completions',api_key:'must-not-copy-server-key',presets:[{id:'catalog',provider:'openai-responses',model:'catalog-model-id',label:'Catalog Model'}]};window.openSettings(false)});
  await page.getByRole('button',{name:'Catalog Model 选择此模型',exact:true}).click();
  assert.equal(await page.locator('#subagent-s2-model').inputValue(),'catalog-model-id');
  assert.equal(await page.locator('#subagent-s2-base-url').inputValue(),'https://api.openai.com/v1');
  await page.getByRole('button',{name:'返回模型列表',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'使用 Being 当前模型',exact:true}).isDisabled(),true);
  await page.getByText('Being 当前使用自部署模型，不能直接应用到 subagent。请为 subagent 单独选择并配置模型。',{exact:true}).waitFor();
  await page.screenshot({path:'test-results/subagent-self-hosted-blocked.png'});
  await page.getByRole('button',{name:'关闭模型设置'}).click();
  await page.evaluate(()=>{window.currentBeing={provider:'openai',model:'gpt-fixture',presets:[]};window.openSettings(false)});
  await page.getByRole('button',{name:'使用 Being 当前模型',exact:true}).click();
  assert.equal(await page.locator('#subagent-s2-model').inputValue(),'gpt-fixture');
  assert.equal(await page.locator('#subagent-s2-base-url').inputValue(),'https://api.openai.com/v1');
  assert.equal(await page.locator('#subagent-s2-api').inputValue(),'openai-responses');
  assert.equal(await page.locator('#subagent-s2-api-key').inputValue(),'');
  await page.screenshot({path:'test-results/subagent-copy-being.png'});
  await page.locator('#subagent-s2-apply').click();
  await page.getByRole('heading',{name:'gpt-fixture',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.saves.at(-1).subagentSetup.base_url),'https://api.openai.com/v1');
  assert.equal(await page.evaluate(()=>JSON.stringify(window.saves).includes('must-not-copy-server-key')),false);
  await page.getByRole('button',{name:'关闭模型设置'}).click();
  await page.evaluate(()=>{window.app.api.subagentConfig=async()=>({enabled:false,provider:'openai',model:'disabled-model',thinking:'medium'});window.openSettings(false)});
  await page.getByText('subagent 尚未启用',{exact:true}).waitFor();
  assert.equal(await page.locator('#subagent-llm-current .current-model-caption').innerText(),'未启用');
  await page.getByRole('button',{name:'编辑配置'}).click();
  await page.getByText('subagent 尚未启用',{exact:true}).waitFor();
  await page.locator('#subagent-s2-apply').click();
  await page.getByRole('heading',{name:'disabled-model',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.saves.at(-1).subagentSetup.enabled),false);
  await page.getByText('subagent 尚未启用',{exact:true}).waitFor();
  await being.click();
  assert.equal(await page.getByText('subagent 尚未启用',{exact:true}).isVisible(),false);
  await subagent.click();
  await page.screenshot({path:'test-results/subagent-disabled-notice.png'});
  await page.getByRole('button',{name:'关闭模型设置'}).click();
  await page.evaluate(()=>{window.app.api.subagentConfig=undefined;window.openSettings(false)});
  await page.getByRole('status').filter({hasText:'客户端接口尚未更新'}).waitFor();
  assert.equal(await page.getByText('正在读取模型…',{exact:true}).count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: one persistent right panel, repeated tab switches retain both drafts, independent saves, retry and initialization.');
} finally {await browser?.close();server.close()}
