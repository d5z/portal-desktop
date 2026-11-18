// Actual Electron protocol, preload and model panel; isolated HTTP model fixture.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { build as rendererBuild } from '../scripts/renderer-build.mjs';
import electronPath from 'electron';
import { launchDesktop } from './support/electron-lifecycle.mjs';
const root = await mkdtemp(path.join(os.tmpdir(), 'town-model-network-'));
const requests = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let body = ''; for await (const chunk of req) body += chunk;
  requests.push({path:url.pathname, method:req.method, body});
  assert.equal(url.searchParams.get('token'), 'fixture-token');
  assert.equal(req.headers['x-relay-secret'], 'fixture-secret');
  if (url.pathname.endsWith('/keys')) { res.writeHead(429, {'Content-Type':'text/plain'}); res.end('fixture raw key rejection'); return; }
  res.setHeader('Content-Type', 'application/json');
  if (url.pathname.endsWith('/config')) return res.end(JSON.stringify(req.method==='PATCH' ? {ok:true, config:{provider:'openai',model:'changed-being'}} : {provider:'openai',model:'being-only',thinking:'medium'}));
  res.end(JSON.stringify(url.pathname.endsWith('/routes') ? {routes:[{id:'openai',name:'OpenAI',has_key:true}]} : {models:[{id:'being-only',name:'Being only'}]}));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${server.address().port}/fixture`;
let app;
try {
  const assets = path.join(root, 'assets'); await mkdir(assets);
  const html = await readFile('desktop/renderer/index.html','utf8');
  const csp = html.match(/<meta http-equiv="Content-Security-Policy"[^>]+>/)[0];
  await writeFile(path.join(assets,'index.html'), `<!doctype html><html>${csp}<meta charset="utf-8"><link rel="stylesheet" href="/ui.css"><div id="root"></div><script src="/ui.js"></script></html>`);
  await rendererBuild({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
    import {createRoot} from 'react-dom/client';
    import {SubagentModelSettings} from './desktop/renderer/app/components/subagent-model-settings';
    import './desktop/renderer/app/styles.scss';
    const app={snapshot:{settings:{hasToken:true,endpoint:${JSON.stringify(endpoint)}}},api:window.beings,closeSubagentSettings(){},applySnapshot(){}};
    createRoot(document.getElementById('root')).render(<div className="workspace-body" style={{height:'100vh'}}><main className="workspace-stage">本机模型网络验证</main><SubagentModelSettings app={app}/></div>);
  `},bundle:true,platform:'browser',jsx:'automatic',outfile:path.join(assets,'ui.js')});
  await build({entryPoints:['desktop/preload/preload.ts'],bundle:true,platform:'node',format:'cjs',external:['electron'],outfile:path.join(root,'preload.cjs')});
  await build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:`
    import {app,BrowserWindow,protocol,ipcMain,net} from 'electron';
    import {readFile,writeFile} from 'node:fs/promises';
    import {registerLocalProtocol} from './desktop/main/app/protocol';
    import {ChatProxy} from './desktop/main/chat/proxy';
    import {parseConnection} from './desktop/main/chat/connection';
    import {readSubagentConfig,saveSubagentPreferences} from './desktop/main/portal/subagent-setup';
    import {SubagentModelNetwork} from './desktop/main/portal/subagent-network';
    const root=${JSON.stringify(root)};
    app.setPath('userData',root);
    protocol.registerSchemesAsPrivileged([{scheme:'beings',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
    app.whenReady().then(async()=>{
      const connection=parseConnection(${JSON.stringify(endpoint+'/?token=fixture-token&relay_secret=fixture-secret')});
      const settings={endpoint:connection.endpoint,being:connection.being,workspace:root,portalName:'fixture',allowExec:false,kitsEnabled:false};
      const modelNetwork = new SubagentModelNetwork(()=> 'beings://desktop/', ()=> '配置验证失败', async (_target, init)=> {
        const body=JSON.parse(String(init?.body));
        return body.model==='rejected' ? new Response('raw model unauthorized',{status:401,headers:{'Content-Type':'text/plain'}}) : new Response('data: '+JSON.stringify({choices:[{delta:{content:'OK'},finish_reason:'stop'}]})+String.fromCharCode(10,10)+'data: [DONE]'+String.fromCharCode(10,10),{headers:{'Content-Type':'text/event-stream'}});
      });
      modelNetwork.save=async(input,request)=>{
        await saveSubagentPreferences(root,settings,input.subagentSetup,connection,request);
        return {settings};
      };
      ipcMain.handle('beings:subagent-network-prepare',(_event,input)=>modelNetwork.prepare(input,connection.being));
      ipcMain.handle('beings:subagent-network-result',(_event,key)=>modelNetwork.result(key));
      ipcMain.handle('beings:subagent-config',()=>readSubagentConfig(root,settings));
      ipcMain.handle('beings:subagent-status',async()=>{
        const c=await readSubagentConfig(root,settings);
        return {enabled:true,configured:true,ready:true,inheritModel:c.inherit_model,provider:c.provider,model:c.model,health:'ok'};
      });
      const proxy=new ChatProxy(()=>connection,(url,init)=>net.fetch(String(url),init));
      registerLocalProtocol(${JSON.stringify(assets)},proxy,undefined,{} as any,undefined,undefined,undefined,modelNetwork);
      const window=new BrowserWindow({width:1100,height:850,webPreferences:{preload:${JSON.stringify(path.join(root,'preload.cjs'))},contextIsolation:true,sandbox:true,nodeIntegration:false}});
      await window.loadURL('beings://desktop/');
    });
    app.on('window-all-closed',()=>app.quit());
  `},bundle:true,platform:'node',format:'cjs',external:['electron'],outfile:path.join(root,'main.cjs')});
  app=await launchDesktop({executablePath:electronPath,args:[path.join(root,'main.cjs')],env:{...process.env,PORTAL_DESKTOP_USER_DATA:root,PORTAL_DESKTOP_TEST_MOCK_KEYCHAIN:'1'}});
  const page=await app.firstWindow(); page.setDefaultTimeout(12000);
  page.on('pageerror',error=>console.error('PAGE',error.message));
  page.on('console',message=>{if(message.type()==='error')console.error('CONSOLE',message.text());});
  const network=[];
  const cdp=await page.context().newCDPSession(page); await cdp.send('Network.enable');
  cdp.on('Network.responseReceived', ({response})=>{if(response.url.startsWith('beings://'))network.push({url:response.url,status:response.status,mimeType:response.mimeType});});
  await page.reload();
  await page.getByRole('heading',{name:'being-only',exact:true}).waitFor();
  const raw = await page.evaluate(async(endpoint)=>{
    const response=await fetch('beings://chat/api/llm/keys',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json','X-Portal-Being-Endpoint':endpoint},body:JSON.stringify({route:'openai',api_key:'fixture-key'})});
    return {status:response.status,type:response.headers.get('content-type'),body:await response.text()};
  }, endpoint);
  assert.deepEqual(raw,{status:429,type:'text/plain',body:'fixture raw key rejection'});
  assert.equal(await page.evaluate(()=>typeof window.beings.beingModelConfig),'undefined');
  await page.getByRole('button',{name:'subagent',exact:true}).click();
  await page.getByRole('button',{name:'验证并应用 subagent 配置'}).click();
  await page.getByText('模型验证成功，已应用并重启 Portal。',{exact:true}).waitFor();
  const configFile=path.join(root,'desktop-portal.toml');
  const defaultConfig=await readFile(configFile,'utf8');
  assert.match(defaultConfig,/glm5.3flash/);
  await page.getByRole('button',{name:'Being 模型',exact:true}).click();
  await page.getByRole('button',{name:'高',exact:true}).click();
  await page.getByText('Being 模型已更新',{exact:true}).waitFor();
  assert.equal(await readFile(configFile,'utf8'),defaultConfig,'Being changes must not modify the default subagent');
  await page.getByRole('button',{name:'subagent',exact:true}).click();
  await page.getByLabel('模型来源',{exact:true}).selectOption('custom');
  await page.getByLabel('接口地址',{exact:true}).fill('https://custom.example/v1');
  await page.getByLabel('模型名称',{exact:true}).fill('custom-model');
  await page.getByRole('button',{name:'验证并应用 subagent 配置'}).click();
  await page.getByText('模型验证成功，已应用并重启 Portal。',{exact:true}).waitFor();
  const customConfig=await readFile(configFile,'utf8'); assert.match(customConfig,/custom-model/);
  await page.evaluate(async()=>{await fetch('beings://chat/api/llm/config',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({thinking:'low'})});});
  assert.equal(await readFile(configFile,'utf8'),customConfig,'Being changes must not modify custom subagent');
  await page.getByLabel('模型名称',{exact:true}).fill('rejected');
  const failedResponse=page.waitForResponse(response=>response.url()==='beings://desktop/v1/chat/completions'&&response.status()===401);
  await page.getByRole('button',{name:'验证并应用 subagent 配置'}).click();
  await page.getByRole('alert').filter({hasText:'401'}).waitFor();
  assert.equal(await readFile(configFile,'utf8'),customConfig);
  const failedBody=await (await failedResponse).text();
  assert.equal(failedBody,'raw model unauthorized');
  assert(network.some(r=>r.url==='beings://chat/api/llm/config'&&r.status===200));
  assert(network.some(r=>r.url==='beings://chat/api/llm/keys'&&r.status===429));
  assert(network.some(r=>r.url==='beings://desktop/llm/fixture/v1/chat/completions'&&r.status===200));
  assert(network.some(r=>r.url==='beings://desktop/v1/chat/completions'&&r.status===401));
  await mkdir('output/playwright',{recursive:true});
  await page.getByRole('alert').filter({hasText:'401'}).scrollIntoViewIfNeeded();
  await page.screenshot({path:'output/playwright/review-model-network.png'});
  await writeFile('output/playwright/review-model-network.json',JSON.stringify({kind:'Actual Electron and production protocol/preload/UI; isolated model responses',network,raw,failedBody,requests},null,2));
  console.log('PASS: native Electron Network paths/status/raw responses, default/custom models, failed verification rollback, Being/subagent independence. Model responses are fixtures; no production credentials used.');
} catch(error) { if(app){const pages=app.windows();for(const page of pages){console.error((await page.locator('body').innerText().catch(()=>'' )).slice(-5000));}} throw error;
} finally {if(app)await app.close();server.closeAllConnections();server.close();await rm(root,{recursive:true,force:true});}
