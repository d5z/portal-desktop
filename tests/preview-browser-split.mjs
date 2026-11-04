import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { build } from '../scripts/renderer-build.mjs';
import { launchDesktop } from './support/electron-lifecycle.mjs';
const directory = await mkdtemp(path.join(os.tmpdir(), 'preview-browser-split-'));
const web = createServer((_request, response) => { response.setHeader('Content-Type','text/html; charset=utf-8'); response.end('<title>链接目标页</title><h1>右侧网页</h1><p>原对话保持在左侧</p>'); });
await new Promise(resolve => web.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${web.address().port}/`;
let application;
try {
  const csp = (await readFile('desktop/renderer/index.html', 'utf8')).match(/<meta http-equiv="Content-Security-Policy"[^>]+>/)[0];
  await writeFile(path.join(directory, 'index.html'), `<!doctype html>${csp}<link rel="stylesheet" href="shell.css"><div id="root"></div><script type="module" src="shell.js"></script>`);
  await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import {createRoot} from 'react-dom/client';
    import {Browser} from './desktop/renderer/browser/page';
    import {HomeFilePanel} from './desktop/renderer/app/components/home-file-panel';
    import {HomeLibrary} from './desktop/renderer/app/models/home-library';
    import './desktop/renderer/app/styles.scss';
    const html=${JSON.stringify(`<h1>index.html</h1><a href="${url}">访问链接</a>`)};
    const store=new HomeLibrary({preview:async path=>({path,name:'index.html',bytes:new TextEncoder().encode(html)})});
    const app={api:window.beings,startup:'ready',run:async task=>task(),toast:message=>{throw Error(message)}};
    window.openFile=()=>store.open({name:'index.html',path:'index.html',type:'file',size:100});
    createRoot(document.getElementById('root')).render(<main id="client-main"><div className="workspace-body" style={{height:'100vh'}}>
      <nav className="workspace-rail"/><div className="workspace-stage"><div style={{padding:40}}><h1>当前工作区</h1><textarea aria-label="对话草稿" defaultValue="尚未发送的内容"/><button onClick={window.openFile}>打开文件</button></div></div>
      <aside id="fixture-info">资料栏</aside><Browser model={app}/><HomeFilePanel store={store}/>
    </div></main>);
  ` }, bundle: true, format: 'esm', jsx:'automatic', outfile: path.join(directory, 'shell.js'), define: {'process.env.NODE_ENV':'"production"'} });
  await build({ entryPoints: ['desktop/preload/preload.ts'], bundle:true, platform:'node', format:'cjs', external:['electron'], outfile:path.join(directory,'preload.js') });
  await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import {app,protocol,ipcMain} from 'electron';
    import {registerLocalProtocol,configureLocalSession} from './desktop/main/app/protocol';
    import {createMainWindow} from './desktop/main/app/window';
    app.setPath('userData',${JSON.stringify(path.join(directory, 'profile'))});
    protocol.registerSchemesAsPrivileged([{scheme:'beings',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
    app.whenReady().then(()=>{
      registerLocalProtocol(${JSON.stringify(directory)},{handle:async()=>new Response('fixture')});configureLocalSession();
      let browser;
      const {window}=createMainWindow({shellURL:()=> 'beings://desktop/',isQuitting:()=>true,isSessionEnding:()=>false,markSessionEnding:()=>{},openExternal:url=>browser.open(url),onBrowser:value=>browser=value,onClosed:()=>{}});
      window.setContentSize(1280,800);globalThis.fixtureWindow=window;
      for(const [channel,run] of [['beings:browser-state',()=>browser.state],['beings:browser-open',url=>browser.open(url)],['beings:browser-action',action=>browser.action(action)],['beings:browser-bounds',bounds=>browser.setBounds(bounds)]])ipcMain.handle(channel,(event,value)=>{if(event.senderFrame!==window.webContents.mainFrame)throw Error('Untrusted');return run(value)});
    });
  ` }, bundle: true, platform:'node', format:'cjs', external:['electron'], outfile:path.join(directory,'main.cjs') });
  application = await launchDesktop({ args:[path.join(directory,'main.cjs')],env:{...process.env,PORTAL_DESKTOP_USER_DATA:path.join(directory,'profile'),PORTAL_DESKTOP_TEST_MOCK_KEYCHAIN:'1'} });
  const page=await application.firstWindow();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const native=()=>application.evaluate(()=>{const view=globalThis.fixtureWindow.contentView.children.find(view=>view.webContents);return view?{bounds:view.getBounds(),visible:view.getVisible()}:null});
  await page.getByRole('button',{name:'打开文件',exact:true}).click();
  await page.getByRole('button',{name:'展开全部',exact:true}).click();
  await page.frameLocator('iframe[title="云端 HTML 预览"]').getByRole('link',{name:'访问链接'}).click();
  await page.locator('.client-file-viewer').waitFor({state:'detached'});
  await page.locator('#browser-title').filter({hasText:'链接目标页'}).waitFor();
  await page.waitForFunction(async()=>!(await window.beings.browserState()).loading);
  const layout=()=>page.evaluate(()=>{const box=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,right:r.right,width:r.width}};return {stage:box('.workspace-stage'),browser:box('#browser-panel'),viewport:box('#browser-viewport'),width:innerWidth,info:document.querySelector('#fixture-info').checkVisibility()}});
  let sizes=await layout();
  assert(sizes.stage.width>=280);assert(sizes.browser.x>=sizes.stage.right-1);assert(sizes.browser.right<=sizes.width+1);assert.equal(sizes.info,false);
  assert.equal(await page.getByRole('textbox',{name:'对话草稿'}).inputValue(),'尚未发送的内容');
  const divider=page.getByRole('separator',{name:'调整浏览器宽度'});
  const handle=await divider.boundingBox(),before=sizes.browser.width;
  await page.mouse.move(handle.x+handle.width/2,handle.y+220);await page.mouse.down();
  assert.equal((await native()).visible,false,'Native view must release the drag hit area');
  await page.mouse.move(handle.x+handle.width/2+100,handle.y+220,{steps:8});await page.mouse.up();
  await page.waitForFunction(width=>Math.abs(document.querySelector('#browser-panel').getBoundingClientRect().width-width)<2,before-100);
  sizes=await layout();assert.equal((await native()).visible,true);assert(Math.abs((await native()).bounds.x-sizes.viewport.x)<2);
  await divider.press('ArrowLeft');
  await page.waitForFunction(width=>Math.abs(document.querySelector('#browser-panel').getBoundingClientRect().width-width)<2,before-76);
  await divider.dblclick({position:{x:10,y:30}});
  await page.waitForFunction(()=>Math.abs(document.querySelector('#browser-panel').getBoundingClientRect().width-640)<2);
  await mkdir('output/playwright',{recursive:true});
  const capture=await application.evaluate(async()=>{
    const view=globalThis.fixtureWindow.contentView.children.find(view=>view.webContents);
    if(!view.getVisible())throw Error('Native view hidden after divider reset');
    if(await view.webContents.executeJavaScript('document.querySelector("h1").textContent')!=='右侧网页')throw Error('Native content missing');
    return (await globalThis.fixtureWindow.capturePage()).toPNG().toString('base64');
  });
  await writeFile('output/playwright/preview-browser-split.png',Buffer.from(capture,'base64'));
  await page.getByRole('button',{name:'打开文件',exact:true}).click();
  await page.locator('#browser-panel').waitFor({state:'hidden'});
  await page.frameLocator('iframe[title="云端 HTML 预览"]').getByRole('heading',{name:'index.html'}).waitFor();
  assert.equal(await native(),null,'Opening a file releases the native browser');
  await page.frameLocator('iframe[title="云端 HTML 预览"]').getByRole('link',{name:'访问链接'}).click();
  await page.locator('.client-file-viewer').waitFor({state:'detached'});
  await application.evaluate(()=>globalThis.fixtureWindow.setContentSize(920,680));
  await page.waitForFunction(()=>document.querySelector('#browser-panel').getBoundingClientRect().right<=innerWidth+1);
  sizes=await layout();assert(sizes.stage.width>=280);assert(sizes.browser.width>=280);
  await page.locator('#browser-close').click();
  await page.locator('#browser-panel').waitFor({state:'hidden'});
  assert.equal(await page.getByRole('textbox',{name:'对话草稿'}).inputValue(),'尚未发送的内容');
  assert.deepEqual(errors,[]);
  console.log('PASS: maximized file → right-side browser, two columns, native pointer drag/keyboard/reset, file-browser replacement, narrow layout and draft retention.');
} finally {await application?.close();web.close();await rm(directory,{recursive:true,force:true});}
