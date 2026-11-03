// Original DSH package in Town's unchanged shell; isolated profile and no messages sent.
import { build } from 'esbuild';
import { build as buildRenderer, createServer } from 'vite';
import electron from 'electron';
import { launchDesktop } from './support/electron-lifecycle.mjs';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const root = process.cwd();
const sources = (process.env.DSH_COMMUNITY_DIRS || '').split(path.delimiter).filter(Boolean);
if (!sources.length) throw new Error('Set DSH_COMMUNITY_DIRS to unmodified community package directories.');
const temp = await mkdtemp(path.join(os.tmpdir(), 'town-dsh-compat-'));
const dev = process.env.DSH_TEST_DEV === '1';
const profile = path.join(temp, 'profile'), assets = dev ? path.resolve('desktop/generated') : path.join(temp, 'renderer');
let server, url = '';
if (dev) { server = await createServer({configFile:path.join(root,'vite.renderer.config.ts'),server:{host:'127.0.0.1',port:0}}); await server.listen(); url='http://127.0.0.1:'+server.httpServer.address().port+'/'; }
await mkdir(path.join(temp, 'build'), {recursive:true});
if (!dev) await buildRenderer({configFile:path.join(root,'vite.renderer.config.ts'),logLevel:'warn',build:{outDir:assets}});
await build({entryPoints:['desktop/main/main.ts'],outfile:path.join(temp,'build/main.js'),bundle:true,platform:'node',format:'cjs',external:['electron'],loader:{'.py':'text','.ps1':'text'},plugins:[{name:'isolated-assets',setup(b){b.onLoad({filter:/main\/main\.ts$/},async args=>({loader:'ts',contents:(await readFile(args.path,'utf8')).replace("path.resolve('desktop/generated')",JSON.stringify(assets))}));}}],define:{MAIN_WINDOW_VITE_DEV_SERVER_URL:JSON.stringify(url),MAIN_WINDOW_VITE_NAME:'"main_window"',PORTAL_DESKTOP_BUILD:'"dsh-compat-test"',PORTAL_DESKTOP_UPDATE_REPOSITORY:'"fixture/repo"'}});
await build({entryPoints:['desktop/preload/preload.ts'],outfile:path.join(temp,'build/preload.js'),bundle:true,platform:'node',format:'cjs',external:['electron']});
if (process.env.DSH_TEST_CONTRACTS === '1') {
 const fixture = path.join(temp, 'slot-fixture'); await mkdir(fixture);
 await writeFile(path.join(fixture,'package.json'), JSON.stringify({name:'town-dsh-slot-fixture',version:'1.0.0',type:'module',main:'host.js',exports:{'.':'./host.js','./client':'./client.js'},dependencies:{'@deepseek-ai/schemastery':'3.18.1'},dsh:{client:{platform:'web'}}}));
 await writeFile(path.join(fixture,'host.js'), `import z from '@deepseek-ai/schemastery';export const Config=z.object({enabled:z.boolean().default(true),count:z.natural().default(3),items:z.array(z.string()).default([])});export function apply(ctx){ctx.on('webserver/index-inject',rows=>rows.push({kind:'html',placement:'head',html:'<link rel="stylesheet" href="/missing-fixture.css">'}));}`);
 await writeFile(path.join(fixture,'client.js'), `window.__ModuleLoader__.load({id:'town-dsh-slot-fixture',factory:require=>{const React=require('react');const {defineStore}=require('@deepseek-ai/dsh-client-store');return {inject:['slots','locale','layout'],apply(ctx){ctx.effect(()=>ctx.locale.register('town.fixture',{en:{count:'Count'},zh:{count:'计数'}}));const store=defineStore({init:()=>({count:0}),actions:{increment:d=>{d.count++}}});ctx.slots.register({name:'settings.section',id:'fixture',label:'契约测试',store,locale:'town.fixture',inject:actions=>({increment:actions.increment}),children:{'town.fixture.child':{kind:'list',scope:'root'}}},props=>React.createElement('div',null,React.createElement('button',{onClick:props.increment},props.t('count')+': '+props.useStore(s=>s.count)),props.renderSlot('town.fixture.child',{}),React.createElement('button',{onClick:props.close},'关闭契约设置')));ctx.slots.register({name:'town.fixture.child',id:'child'},()=>React.createElement('p',null,'嵌套插槽正常'));ctx.slots.register({name:'main',key:'fixture-panel'},()=>React.createElement('p',null,'主面板正常'));ctx.slots.register({name:'sidebar.panellist',id:'fixture-launcher'},()=>React.createElement('button',{onClick:()=>ctx.layout.selectPanel('fixture-panel')},'契约主面板'));}}}});`);
 sources.push(fixture);
}
const app = await launchDesktop({executablePath:electron,args:[path.join(temp,'build/main.js')],cwd:root,env:{...process.env,PORTAL_DESKTOP_USER_DATA:profile,PORTAL_DESKTOP_TEST_MOCK_KEYCHAIN:'1'}});
try {
 const page = await app.firstWindow(); page.setDefaultTimeout(30000);
 const openManager = async () => {
   await page.locator('#options-trigger').click();
   await page.locator('#client-settings-button').click();
   await page.getByRole('tab',{name:'插件',exact:true}).click();
   await page.getByRole('button',{name:'管理第三方插件',exact:true}).click();
 };
 page.on('pageerror', error => console.log('PAGE ERROR', error.message));
 page.on('console', message => { if (message.type() === 'error') console.log('CONSOLE', message.text().slice(0, 500)); });
 await page.locator('#client-main').waitFor({ state: 'visible' });
 assert.equal(await page.evaluate(()=>Notification.permission),'denied');
 await page.evaluate(()=>window.beings.notifications({enabled:true}));
 assert.equal(await page.evaluate(()=>Notification.requestPermission()),'granted');
 await page.evaluate(()=>window.beings.notifications({enabled:false}));
 assert.equal(await page.evaluate(()=>Notification.permission),'denied');
 await page.evaluate(()=>window.beings.notifications({enabled:true}));
 console.log('PASS plugin browser notification permission follows Town master switch');
 await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
 await page.getByRole('button', { name: '更多功能', exact: true }).click();
 await page.getByRole('button', { name: '工具库', exact: true }).click();
 await page.getByRole('tab', { name: 'Plugin', exact: true }).click();
 await page.getByRole('button', { name: '第三方插件', exact: true }).click();
 await page.evaluate(()=>{window.__installDocument=document;window.__installTown=document.querySelector('#client-main');});
 for (const source of sources) {
   await page.locator('#dsh-source').fill(source);
   await page.getByRole('button',{name:'安装',exact:true}).click();
   await page.waitForFunction(()=>!document.querySelector('#third-party-plugins').hasAttribute('aria-busy'));
   const state = await page.evaluate(() => window.beings.dshPlugins.state());
   console.log('INSTALLED LIVE', JSON.stringify(state.plugins.map(p => ({ id: p.id, status: p.status, error: p.error }))));
   assert.ok(state.plugins.every(p => p.status === 'active'), JSON.stringify(state.plugins));
   assert.equal(await page.evaluate(()=>window.__installDocument===document&&window.__installTown===document.querySelector('#client-main')),true,'Installing must preserve the document and Town component tree');
   assert.equal(await page.getByRole('button',{name:'重新加载页面',exact:true}).count(),0);
 }
 console.log('MANAGER', (await page.locator('#third-party-plugins').innerText()).slice(0, 6500));
 assert.equal(await page.getByText('加载受阻', { exact: false }).count(), 0);
 await mkdir('output/dsh-compat', { recursive: true });
 await page.screenshot({ path: 'output/dsh-compat/community-manager.png' });
 const cards = page.locator('#third-party-plugins .plugin-card');
 for (let index = 0; index < await cards.count(); index++) {
   const buttons = cards.nth(index).locator('.dsh-contributions button');
   if (!await buttons.count()) continue;
   const target = await buttons.filter({hasText:'契约测试'}).count() ? buttons.filter({hasText:'契约测试'}) : buttons.first();
   const label = await target.innerText();
   await target.click();
   await page.waitForTimeout(500);
   assert.equal(await page.getByText('插件界面加载失败', { exact: false }).count(), 0);
   if (await page.locator('.pomo-card-header').count()) {
   await page.locator('.pomo-card-header').click();
   await page.locator('#dsh-pomodoro-focus-minutes').waitFor({state:'visible'});
     assert.equal(await page.locator('#dsh-pomodoro-focus-minutes').inputValue(), '25');
     const labelBox = await page.locator('label[for=dsh-pomodoro-focus-minutes]').boundingBox();
     const inputBox = await page.locator('#dsh-pomodoro-focus-minutes').boundingBox();
     assert.ok(labelBox.height < 60 && inputBox.width < 130, 'Town styles must not stretch the original plugin input and crush its label');
   await page.locator('#dsh-pomodoro-focus-minutes').fill('7');
   await page.getByRole('button', { name: '保存', exact: true }).click();
   await page.waitForFunction(async()=>{const response=await fetch('/@town-dsh/rpc',{method:'POST',body:JSON.stringify({service:'settings',method:'describe',args:[]})});const data=await response.json();return data.value.namespaces.some(n=>n.ns==='ui-pomodoro'&&n.value.focusMinutes===7)});
     console.log('PASS original Pomodoro configuration persisted');
   }
   if (label === 'VS Code Themes') {
   await page.getByText('Dracula', {exact:true}).click();
   await page.waitForFunction(()=>document.documentElement.dataset.theme === 'dark');
     assert.ok(await page.evaluate(()=>localStorage.getItem('town.dsh.theme')?.includes('dracula')));
     console.log('PASS original VS Code theme applied without page reload');
   }
   if (label === '契约测试') {
   await page.getByRole('button', {name:'计数: 0',exact:true}).click();
   await page.getByRole('button', {name:'计数: 1',exact:true}).waitFor();
   await page.getByText('嵌套插槽正常',{exact:true}).waitFor();
     console.log('PASS injected store actions, locale and child slots despite another failed index resource');
   }
   console.log('PANEL', label, (await page.locator('.dsh-plugin-content').innerText()).slice(0, 2500));
   await page.screenshot({ path: `output/dsh-compat/community-${index}.png` });
   await page.getByRole('button', { name: '返回插件管理', exact: true }).click();
 }
 if (process.env.DSH_TEST_CONTRACTS === '1') {
   await page.getByRole('button',{name:'town-dsh-slot-fixture 配置',exact:true}).click();
   await page.getByLabel('items',{exact:true}).fill('[invalid');
   await page.getByLabel('count',{exact:true}).fill('8');
   assert.equal(await page.getByRole('button',{name:'保存配置',exact:true}).isDisabled(),true,'Another field must not clear invalid JSON');
   await page.getByRole('button',{name:'返回插件管理',exact:true}).click();
   await page.getByText('配置尚未保存，是否放弃更改？',{exact:true}).waitFor();
   await page.getByRole('button',{name:'继续编辑',exact:true}).click();
   assert.equal(await page.getByLabel('count',{exact:true}).inputValue(),'8');
   await page.getByLabel('items',{exact:true}).fill('["desktop"]');
   await page.getByRole('button',{name:'保存配置',exact:true}).click();
   await page.waitForFunction(async()=>{const r=await fetch('/@town-dsh/rpc',{method:'POST',body:JSON.stringify({service:'settings',method:'describe'})});return (await r.json()).value.namespaces.some(n=>n.ns==='town-dsh-slot-fixture'&&n.value.count===8)});
   await page.getByRole('button',{name:'返回插件管理',exact:true}).click();
   console.log('PASS generated schema form saves validated host configuration');
 }
 // Nonmodal settings must contain keyboard focus while still allowing plugin previews.
 await page.locator('#third-party-plugins .close').focus();
 await page.keyboard.press('Shift+Tab');
 assert.ok(await page.evaluate(()=>document.activeElement.closest('#third-party-plugins')));
 assert.equal(await page.locator('#client-main').evaluate(el=>el.inert),true);
 await page.keyboard.press('Escape');
 await page.locator('#third-party-plugins').waitFor({state:'hidden'});
 assert.equal(await page.locator('#client-main').evaluate(el=>el.inert),false);
 await page.locator('.workspace-rail').waitFor({state:'visible'});
 if (sources.some(source=>source.includes('pomodoro'))) {
   const entry = page.locator('.workspace-rail .rail-links').getByRole('button',{name:'番茄钟',exact:true});
   assert.equal(await page.getByRole('button',{name:'插件工具',exact:true}).count(),0);
   await entry.waitFor({state:'visible'});
   const box = await entry.boundingBox();
   const nativeBox = await page.getByRole('button',{name:'篝火',exact:true}).boundingBox();
   assert.equal(box.width,nativeBox.width); assert.equal(box.height,nativeBox.height);
   assert.equal(box.x,nativeBox.x);
   await entry.focus();
   await page.getByRole('tooltip',{name:'番茄钟',exact:true}).waitFor();
   await page.keyboard.press('Enter');
   await page.getByRole('button',{name:'开始',exact:true}).click();
   await page.getByRole('button',{name:'暂停',exact:true}).waitFor();
   await page.getByRole('button',{name:'暂停',exact:true}).click();
   await page.screenshot({path:'output/dsh-compat/community-pomodoro-running.png'});
   await entry.click();
   await page.screenshot({path:'output/dsh-compat/desktop-plugin-navigation.png'});
   console.log('PASS original Pomodoro direct rail entry, same sizing/alignment as Town, keyboard activation, overlay, start and pause without reload');
 }
 if (process.env.DSH_TEST_CONTRACTS === '1') {
   await page.getByRole('button',{name:'契约主面板',exact:true}).click();
   await page.getByText('主面板正常',{exact:true}).waitFor();
   await page.getByRole('button',{name:'返回 Town',exact:true}).click();
   const fixtureCard = page.locator('.plugin-card').filter({has:page.getByRole('heading',{name:/^town-dsh-slot-fixture /})});
   for (let cycle=0;cycle<3;cycle++) {
     await openManager();
     await fixtureCard.getByRole('button',{name:'停用',exact:true}).click();
     await page.waitForFunction(()=>!document.querySelector('#third-party-plugins').hasAttribute('aria-busy'));
     if (sources.some(source=>source.includes('pomodoro'))) {
       assert.equal(await page.locator('.dsh-rail-entries').getByRole('button',{name:'番茄钟',exact:true}).count(),1);
       const pomodoro = page.locator('.plugin-card').filter({has:page.getByRole('heading',{name:/^dsh-pomodoro /})});
       assert.ok(await pomodoro.locator('.dsh-contributions button').count(),'Peer configuration must remain available');
     }
     assert.equal(await page.getByRole('button',{name:'契约主面板',exact:true}).count(),0);
     await fixtureCard.getByRole('button',{name:'启用',exact:true}).click();
     await page.waitForFunction(()=>!document.querySelector('#third-party-plugins').hasAttribute('aria-busy'));
     assert.ok(await fixtureCard.locator('.dsh-contributions button').count(), await fixtureCard.innerText());
     await page.getByRole('button',{name:'关闭',exact:true}).click();
     await page.getByRole('button',{name:'契约主面板',exact:true}).waitFor();
     assert.equal(await page.getByRole('button',{name:'契约主面板',exact:true}).count(),1);
   }
   console.log('PASS three real host/client enable-disable cycles preserve peer icons and configuration');
   if (sources.some(source=>source.includes('pomodoro'))) {
     const pomodoro = page.locator('.plugin-card').filter({has:page.getByRole('heading',{name:/^dsh-pomodoro /})});
     for (let cycle=0;cycle<2;cycle++) {
       await openManager();await pomodoro.getByRole('button',{name:'停用',exact:true}).click();
       await page.waitForFunction(()=>!document.querySelector('#third-party-plugins').hasAttribute('aria-busy'));
       assert.equal(await page.locator('.dsh-rail-entries').getByRole('button',{name:'番茄钟',exact:true}).count(),0);
       assert.ok(await fixtureCard.locator('.dsh-contributions button').count());
       await pomodoro.getByRole('button',{name:'启用',exact:true}).click();
       await page.waitForFunction(()=>!document.querySelector('#third-party-plugins').hasAttribute('aria-busy'));
       assert.ok(await pomodoro.locator('.dsh-contributions button').count(),await pomodoro.innerText());
       await page.getByRole('button',{name:'关闭',exact:true}).click();
       await page.locator('.dsh-rail-entries').getByRole('button',{name:'番茄钟',exact:true}).waitFor();
     }
     console.log('PASS original Pomodoro unload/remount preserves peer navigation and restores its entry');
   }
 }
 if (process.env.DSH_TEST_CONTRACTS === '1') {
   // Faults in a label, a component and an unresolved lifecycle must leave Town usable.
   const faults = path.join(temp,'fault-fixture'); await mkdir(faults);
   await writeFile(path.join(faults,'package.json'),JSON.stringify({name:'town-dsh-fault-fixture',version:'1.0.0',type:'module',main:'host.js',exports:{'.':'./host.js','./client':'./client.js'},dsh:{client:{platform:'web'}}}));
   await writeFile(path.join(faults,'host.js'),'export function apply(){}');
   await writeFile(path.join(faults,'client.js'),`window.__ModuleLoader__.load({id:'town-dsh-fault-fixture',factory:require=>{const React=require('react');return {inject:['slots','layout'],async apply(ctx){ctx.slots.register({name:'settings.section',id:'bad-label',label:()=>{throw Error('fixture label failure')}},()=>null);ctx.slots.register({name:'sidebar'},()=>React.createElement('button',{onClick:()=>ctx.layout.toggleSidebar()},'插件折叠侧栏'));ctx.slots.register({name:'main',key:'bad-panel'},()=>{throw Error('fixture render failure')});await new Promise(()=>{});}}}});`);
   assert.equal(await page.evaluate(source=>window.beings.dshPlugins.install(source),faults),true);
   await page.reload();
   await page.locator('#client-main').waitFor({state:'visible',timeout:5000});
   await page.getByRole('button',{name:'插件折叠侧栏',exact:true}).click();
   assert.equal(await page.locator('#dsh-tools').count(),0);
   await page.locator('.workspace-rail').waitFor({state:'visible'});
   assert.ok(await page.locator('.workspace-rail').evaluate(el=>el.getBoundingClientRect().width < 100));
   await openManager();
   const faulty = page.locator('.plugin-card').filter({has:page.getByRole('heading',{name:/town-dsh-fault-fixture/})});
   await faulty.getByRole('button',{name:'bad-panel',exact:true}).click();
   await page.getByRole('button',{name:'返回插件管理',exact:true}).click();
   await page.getByText(/客户端插件启动超时/).first().waitFor({timeout:20000});
   await page.locator('#third-party-plugins .close').click();
   await page.locator('.workspace-rail').waitFor({state:'visible'});
   await openManager();
   await faulty.getByRole('button',{name:'停用',exact:true}).click();
   await page.waitForFunction(()=>!document.querySelector('#third-party-plugins').hasAttribute('aria-busy'));
   await page.locator('#third-party-plugins .close').click();
   await page.getByRole('button',{name:'契约主面板',exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'插件折叠侧栏',exact:true}).count(),0);
   await openManager();
   assert.ok(await page.locator('.plugin-card').filter({has:page.getByRole('heading',{name:/^town-dsh-slot-fixture /})}).locator('.dsh-contributions button').count());
   await page.locator('#third-party-plugins .close').click();
   console.log('PASS desktop navigation, invalid JSON and unsaved guard, keyboard focus, throwing label/component, bounded startup and peer recovery after disable');
 }
 if (sources.some(source=>source.includes('vscode-themes'))) await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
 await page.getByRole('button',{name:'对话',exact:true}).click();
 if (sources.some(source=>source.includes('vscode-themes'))) {
 assert.equal(await page.locator('.welcome-logo.town-logo-dark').isVisible(),true);
 assert.equal(await page.locator('.welcome-logo.town-logo-light').isVisible(),false);
 }
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(920,640));
 await openManager();
 const bounds=await page.locator('#third-party-plugins').evaluate(el=>{const r=el.getBoundingClientRect();return {inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,overflow:el.scrollWidth>el.clientWidth};});
 assert.equal(bounds.inside,true); assert.equal(bounds.overflow,false);
 await page.waitForFunction(()=>document.elementFromPoint(innerWidth/2,innerHeight/2)?.closest('#third-party-plugins'));
 await page.locator('#third-party-plugins').evaluate(async el=>{await Promise.allSettled(el.getAnimations().map(animation=>animation.finished));});
 assert.equal(await page.locator('#third-party-plugins').evaluate(el=>getComputedStyle(el).opacity),'1');
 await page.screenshot({path:'output/dsh-compat/desktop-compact-settings.png',animations:'disabled'});
 await page.keyboard.press('Escape');
 await page.locator('#third-party-plugins').waitFor({state:'hidden'});
 assert.equal(await page.evaluate(()=>document.activeElement.id),'options-trigger');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1280,860));
 console.log('PASS dark branding and 920×640 desktop settings, focus restored to Town settings');
 console.log('PROFILE', temp);
 if (process.env.DSH_TEST_HOLD === '1') { await app.evaluate(({ app, BrowserWindow }) => { app.focus({ steal: true }); BrowserWindow.getAllWindows()[0].focus(); }); await new Promise(resolve => setTimeout(resolve, 180000)); }
 console.log('PASS community plugin installation, coexistence and settings');
} catch (error) { const page=(await app.windows())[0]; console.log('FAILURE UI', await page?.locator('body').innerText().catch(()=>'')); await page?.screenshot({path:'output/dsh-compat/failure.png'}).catch(()=>{}); throw error; } finally { await app.close(); await server?.close(); }
