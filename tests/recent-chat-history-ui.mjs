import assert from 'node:assert/strict';
import { createServer } from 'node:http';
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
window.historyCalls = [];
const app = new AppModel({
  beingModelConfig:async()=>({model:'fixture'}),
  recentChatHistory:async endpoint=>{window.historyCalls.push(endpoint);return [];},
});
app.applySnapshot(snapshot); app.chatLoading=false; app.sbsKnown=true; app.sbsEnabled=true; app.beingInfoOpen=true;
  app.startup = 'ready';
window.app=app;
function Fixture(){useModel(app);return <div className="workspace-body"><div className="workspace-stage"><Topbar model={app}/><div className="workspace-content">对话区域</div></div><BeingInfo app={app}/></div>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
` }, bundle:true,write:false,outfile:'fixture.js',format:'iife',platform:'browser',jsx:'automatic',define:{'import.meta.env.DEV':'false'} });
const css = await readShellStyles() + (outputFiles.find(file => file.path.endsWith('.css'))?.text || '');
const server = createServer((request,response)=>{
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
  const dot=page.locator('.topbar [aria-label="SBS 状态与显示设置"] [data-enabled]');
  assert.equal(await dot.isVisible(),true);
  assert.equal(await dot.getAttribute('data-enabled'),'true');
  await page.getByRole('button',{name:'SBS 状态与显示设置'}).click();
  await page.getByRole('dialog',{name:'SBS 自主活动'}).waitFor();
  await page.getByRole('button',{name:'关闭 SBS 设置'}).click();
  assert.equal(await page.evaluate(()=>window.historyCalls.length),0,'Profile does not fetch history');
  assert.deepEqual(await page.getByRole('tablist',{name:'Being 信息分类'}).getByRole('tab').allTextContents(),['详情','资料库','电脑']);
  await page.getByRole('tab',{name:'详情',exact:true}).click();
  await page.getByRole('button',{name:'应用设置',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.app.settingsRoute),'apps');
  assert.equal(await page.evaluate(()=>window.historyCalls.length),0,'Opening app settings does not fetch retired activity history');
  assert.deepEqual(errors,[]);
  console.log('Being profile: remaining tabs, app settings entry, SBS controls and no activity history requests passed.');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
