import { build } from 'esbuild';
import { chromium } from 'playwright';
import { browserAssets } from './support/browser-assets.mjs';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { compile } from 'sass';

// Real Cordis + published slot renderer; the transport substitutes deterministic
// host snapshots so lifecycle races do not depend on npm or a live Being.
const record = id => ({ id, version: '1', source: id, installedAt: '1', enabled: true, status: 'active' });
let plugins, injections, sources;
const reset = () => {
  plugins = ['healthy', 'switchable'].map(record); injections = [];
  sources = {
    healthy: client('healthy'),
    switchable: client('switchable', true),
  };
};
function client(id, sidebar = false, version = '1') {
  return `window.__ModuleLoader__.load({id:${JSON.stringify(id)},factory:require=>{
    const React=require('react'); return {inject:['slots','layout'],apply(ctx){
      window.applied ??={}; window.disposed ??={}; window.applied[${JSON.stringify(id)}]=(window.applied[${JSON.stringify(id)}]||0)+1;
      ctx.effect(()=>()=>{window.disposed[${JSON.stringify(id)}]=(window.disposed[${JSON.stringify(id)}]||0)+1});
      ctx.slots.register({name:${JSON.stringify(sidebar ? 'sidebar' : 'sidebar.panellist')},id:${JSON.stringify(id)}},props=>React.createElement('div',null,
        React.createElement('button',{'aria-label':${JSON.stringify(id)},onClick:()=>ctx.layout.selectPanel(${JSON.stringify(id)})},${JSON.stringify(id)}),
        null));
      ctx.slots.register({name:'main',key:${JSON.stringify(id)}},()=>React.createElement('p',null,${JSON.stringify(id + ' panel ' + version)}));
      ctx.slots.register({name:'settings.section',id:${JSON.stringify(id)},label:${JSON.stringify(id + ' settings')}},()=>React.createElement('p',null,${JSON.stringify(id + ' settings body ' + version)}));
    }};
  }});`;
}
const snapshot = () => ({ plugins, clients: plugins.filter(p => p.enabled && p.status === 'active' && sources[p.id]).map(p => ({ id: p.id, owner: p.id, url: '/client/' + p.id, inject: [] })), routes: [], injections: injections.filter(row => !row.owner || plugins.some(p => p.id === row.owner && p.enabled)) });
const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
  import React from 'react'; import {createRoot} from 'react-dom/client';
  import {dshRuntime} from './desktop/renderer/plugins/dsh/runtime';
  import {DshPluginSurfaces} from './desktop/renderer/plugins/dsh/page';
  window.runtime=dshRuntime;
  const request=async(path,data)=>{const r=await fetch(path,{method:data?'POST':'GET',body:data&&JSON.stringify(data)});if(!r.ok)throw new Error(await r.text());return r.json()};
  window.beings={dshPlugins:{state:()=>request('/state'),reportFailures:failures=>request('/failed',failures),enable:(id,enabled)=>request('/enable',{id,enabled}),remove:id=>request('/remove',{id}),install:source=>request('/install',{source})}};
  dshRuntime.setNavigationHost(document.getElementById('nav'));
  document.getElementById('manager').onclick=()=>dshRuntime.openManager();
  document.getElementById('embed').onclick=()=>dshRuntime.setManagerHost(document.getElementById('inline-manager'));
  const original=dshRuntime.script.bind(dshRuntime);
  dshRuntime.script=async(src,type)=>{if(location.search.includes('delay')&&src.startsWith('data:')&&atob(src.split(',')[1]).includes('id: "@deepseek-ai/dsh-client-ui-settings"')){window.settingsPending=true;await new Promise(r=>window.releaseSettings=r)}return original(src,type)};
  createRoot(document.getElementById('root')).render(<DshPluginSurfaces/>);void dshRuntime.start();
` }, bundle: true, format: 'iife', platform: 'browser', write: false, outfile: 'lifecycle.js', plugins: [browserAssets()], loader: { '.css': 'empty', '.scss': 'empty' } });
const code = result.outputFiles.find(f => f.path.endsWith('.js')).text;
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage(); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('http://lifecycle.test/**', async route => {
    const { pathname } = new URL(route.request().url());
    const json = value => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
    if (pathname === '/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<div id="client-main"><div class="workspace-rail"><div id="nav"></div></div><button id="manager">Manage</button><button id="embed">Embed</button><div id="inline-manager"></div></div><div id="root"></div><script src="/lifecycle.js"></script>' });
    if (pathname === '/lifecycle.js') return route.fulfill({ contentType: 'text/javascript', body: code });
    if (pathname.startsWith('/client/')) return route.fulfill({ contentType: 'text/javascript', body: sources[decodeURIComponent(pathname.slice(8))] });
    if (pathname === '/state') return json(snapshot());
    if (pathname === '/failed') {
      for (const {id,error} of route.request().postDataJSON()) Object.assign(plugins.find(p=>p.id===id),{enabled:false,status:'disabled',error});
      return json(null);
    }
    if (pathname === '/install' && route.request().postDataJSON().source === 'dsh-plugin-whale-pet') {
      plugins.push({...record('dsh-plugin-whale-pet'), version:'0.2.9', description:'Your little whale buddy for work, wins, and well-earned naps.', enabled:false,status:'disabled',missingServices:['agents']});
      return route.fulfill({status:409,body:'启用失败，插件已停用。'});
    }
    if (pathname === '/enable' && route.request().postDataJSON().id === 'dsh-plugin-whale-pet') return route.fulfill({status:409,body:'启用失败，插件已停用。'});
    if (pathname === '/enable') { const {id,enabled}=route.request().postDataJSON(); Object.assign(plugins.find(p=>p.id===id),{enabled,status:enabled?'active':'disabled'});return json(null); }
    if (pathname === '/remove') { plugins=plugins.filter(p=>p.id!==route.request().postDataJSON().id);return json(true); }
    if (pathname === '/install') { const {source}=route.request().postDataJSON();if(!plugins.some(p=>p.id===source))plugins.push(record(source));return json(true); }
    if (pathname === '/@town-dsh/rpc') return json({ok:true,value:route.request().postDataJSON().service === 'commands' ? [] : {writable:true,hasDocument:true,namespaces:[]}});
    if (pathname === '/@town-dsh/events') return route.fulfill({contentType:'text/event-stream',body:': ready\n\n'});
    return route.fulfill({status:404});
  });
  const detail = async id => { await page.waitForFunction(()=>!document.querySelector('#third-party-plugins').hasAttribute('aria-busy')); const back = page.getByRole('button',{name:'返回插件列表',exact:true}); if (await back.isVisible()) await back.click(); await page.getByRole('button',{name:'配置 '+id,exact:true}).click(); };
  const install = async source => { await page.waitForFunction(()=>!document.querySelector('#third-party-plugins').hasAttribute('aria-busy')); const back = page.getByRole('button',{name:'返回插件列表',exact:true}); if(await back.isVisible()) await back.click(); await page.getByRole('navigation',{name:'插件管理导航'}).getByRole('button',{name:'安装插件',exact:true}).click(); await page.getByLabel('插件来源',{exact:true}).fill(source); await page.getByRole('button',{name:'安装',exact:true}).click(); };
  const open = () => page.getByRole('button',{name:'Manage',exact:true}).click();
  const close = () => page.getByRole('button',{name:'关闭',exact:true}).click();
  const ready = () => page.waitForFunction(()=>window.runtime.phase==='ready');
  reset(); plugins.forEach(p => Object.assign(p, { status: 'error', error: 'shared worker exited' }));
  await page.goto('http://lifecycle.test/'); await ready();
  assert.ok(plugins.every(p => p.enabled), 'a shared host crash must retain enabled preferences');
  reset(); plugins.push(record('missing-js'), record('missing-css'));
  injections = [
    { owner: 'missing-js', kind: 'script-src', placement: 'head', src: '/missing.js' },
    { owner: 'missing-css', kind: 'html', placement: 'head', html: '<link rel="stylesheet" href="/missing.css">' },
  ];
  await page.reload(); await ready();
  assert.deepEqual(plugins.filter(p => p.enabled).map(p => p.id), ['healthy', 'switchable']);
  for (const p of plugins.slice(2)) assert.match(p.error, /加载失败/);
  assert.equal(await page.locator('link[href="/missing.css"],script[src="/missing.js"]').count(), 0);
  console.log('PASS shared host crash retains preferences; injection-only JS/CSS failures disable only their owners');
  reset(); await page.goto('http://lifecycle.test/'); await ready();
  await page.getByRole('button',{name:'switchable',exact:true}).waitFor();
  await open();
  const settingsNav = page.getByRole('navigation', {name:'插件管理导航'});
  await detail('healthy');
  await page.getByText('healthy settings body 1', {exact:true}).waitFor();
  assert.equal(await page.locator('.dsh-plugin-row').count(),0,'settings replace the plugin list');
  assert.equal(await page.locator('.settings-detail-page').count(),1,'settings occupy their own page');
  await page.getByRole('button',{name:'返回插件列表',exact:true}).click();
  await detail('switchable');
  await page.getByRole('button',{name:'停用',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#third-party-plugins').hasAttribute('aria-busy'));
  await detail('healthy');
  await page.getByText('healthy settings body 1', {exact:true}).waitFor();
  await close();
  assert.equal(await page.getByRole('button',{name:'switchable',exact:true}).count(),0,'disabled sidebar must be disposed');
  await page.getByRole('button',{name:'healthy',exact:true}).click();
  await page.getByText('healthy panel 1',{exact:true}).waitFor();
  await page.getByRole('button',{name:'返回 Town',exact:true}).click();
  for (let i=0;i<3;i++) {
    await open();await detail('switchable');await page.getByRole('button',{name:'启用',exact:true}).click();await close();
    assert.equal(await page.getByRole('button',{name:'switchable',exact:true}).count(),1);
    assert.equal(await page.getByRole('button',{name:'healthy',exact:true}).count(),0,'explicit sidebar owns the rail while enabled');
    await page.getByRole('button',{name:'switchable',exact:true}).click();
    await page.getByText('switchable panel 1',{exact:true}).waitFor();
    await open();await detail('switchable');await page.getByRole('button',{name:'停用',exact:true}).click();await close();
    assert.equal(await page.getByText('switchable panel 1',{exact:true}).count(),0,'disabling the active panel must return to Town');
  }
  assert.equal(await page.evaluate(()=>window.applied.healthy),1,'unrelated client must retain its live instance');
  assert.equal(await page.evaluate(()=>window.disposed.switchable),4);
  await open();await detail('switchable');await page.getByText('管理',{exact:true}).click();await page.getByRole('button',{name:'卸载',exact:true}).click();
  await install('switchable');await close();
  assert.equal(await page.getByRole('button',{name:'switchable',exact:true}).count(),1);
  sources.switchable=client('switchable',true,'2');plugins.find(p=>p.id==='switchable').installedAt='2';
  await page.evaluate(()=>window.runtime.applyChanges());
  await page.getByRole('button',{name:'switchable',exact:true}).click();await page.getByText('switchable panel 2',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.applied.healthy),1);
  await open();await detail('switchable');await page.getByRole('button',{name:'停用',exact:true}).click();await close();
  await page.reload();await ready();assert.equal(await page.getByRole('button',{name:'healthy',exact:true}).count(),1);
  console.log('PASS disable/re-enable loops, sidebar fallback, active panel cleanup, remove/reinstall, update, reload and unaffected instance retention');
  reset();injections=[{kind:'html',placement:'head',html:'<style>:root { --lifecycle-injection: 1; }</style>'}];
  sources.newcomer=client('newcomer');
  await page.goto('http://lifecycle.test/');await ready();
  injections=[];
  await open();await detail('switchable');await page.getByRole('button',{name:'停用',exact:true}).click();
  await page.getByRole('button',{name:'重新加载页面',exact:true}).waitFor();
  await detail('healthy'); await page.getByText('healthy settings body 1',{exact:true}).waitFor();
  await install('newcomer');await close();
  assert.equal(await page.getByRole('button',{name:'newcomer',exact:true}).count(),1,'pending global reload must not block a new independent client');
  assert.equal(await page.getByRole('button',{name:'healthy',exact:true}).count(),1);
  injections=[{kind:'html',placement:'head',html:'<style>:root { --lifecycle-injection: 1; }</style>'}];
  await open();await detail('switchable');await page.getByRole('button',{name:'启用',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#third-party-plugins').hasAttribute('aria-busy'));
  assert.equal(await page.getByRole('button',{name:'重新加载页面',exact:true}).count(),0,'restoring the original snapshot cancels pending reload');
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('style')].filter(s=>s.textContent.includes('--lifecycle-injection')).length),1);
  await close();
  assert.equal(await page.getByRole('button',{name:'switchable',exact:true}).count(),1);
  assert.equal(await page.evaluate(()=>window.applied.healthy),1);
  console.log('PASS global injection reload isolation, unrelated installation, and undo without duplicate injection');
  reset();await page.goto('http://lifecycle.test/?delay');await page.waitForFunction(()=>window.settingsPending);
  await page.evaluate(()=>window.runtime.changed());await page.evaluate(()=>window.releaseSettings());await ready();await open();
  assert.equal(await page.getByText(/插件界面出现异常/).count(),0,'startup rerender must not poison root boundary');
  await detail('healthy'); await page.getByText('healthy settings body 1',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS root startup race');
  await mkdir('output/dsh-lifecycle',{recursive:true});await page.screenshot({path:'output/dsh-lifecycle/browser.png'});
  await page.addStyleTag({content: ['desktop/renderer/app/styles.scss','desktop/renderer/plugins/dsh/styles.scss'].map(file => compile(file).css).join('\n')});
  await install('dsh-plugin-whale-pet');
  const issue = page.getByRole('group',{name:'dsh-plugin-whale-pet：与当前 Town 不适配'});
  await page.waitForFunction(() => document.activeElement?.id === 'dsh-issue-dsh-plugin-whale-pet');
  assert.ok(await issue.getByText(/缺少插件需要的服务：agents/).isVisible());
  await page.screenshot({path:'output/dsh-lifecycle/incompatible.png'});
  const whale = page.locator('#third-party-plugins');
  assert.equal(await whale.getByRole('button',{name:'停用',exact:true}).count(),0);
  await whale.getByRole('button',{name:'启用',exact:true}).click();
  await page.waitForFunction(() => document.activeElement?.id === 'dsh-issue-dsh-plugin-whale-pet');
  assert.equal(await whale.getByRole('button',{name:'停用',exact:true}).count(),0);
  sources['bad-client'] = "window.__ModuleLoader__.load({id:'bad-client',factory:()=>({inject:['absent-client-service'],apply(){}})})";
  await install('bad-client');
  const bad = page.locator('#third-party-plugins');
  await bad.getByRole('button',{name:'启用',exact:true}).waitFor();
  assert.equal(plugins.find(p=>p.id==='bad-client').enabled,false);
  await page.waitForFunction(()=>!document.querySelector('#third-party-plugins').hasAttribute('aria-busy'));
  assert.ok(await bad.getByText(/absent-client-service/).isVisible(), (await bad.textContent()) + JSON.stringify(await page.evaluate(()=>window.runtime.state.plugins.find(p=>p.id==='bad-client'))));
  Object.assign(plugins.find(p=>p.id==='bad-client'), {enabled:true,status:'active',error:undefined});
  await page.goto('http://lifecycle.test/'); await ready();
  assert.match(await page.evaluate(()=>window.runtime.startupNotice),/bad-client.*不适配/);
  assert.equal(plugins.find(p=>p.id==='bad-client').enabled,false);
  assert.equal(plugins.find(p=>p.id==='healthy').enabled,true);
  console.log('PASS installation and activation bring the compatibility reason into focus');
  reset(); plugins.push(record('tabs-fixture'));
  sources['tabs-fixture'] = `window.__ModuleLoader__.load({id:'tabs-fixture',factory:require=>{
    const React=require('react'); return {inject:['slots','sidebarRightTabs'],apply(ctx){
      ctx.sidebarRightTabs.register({id:'fixture-chat',kind:'fixture-chat',title:()=> 'Fixture chat'});
      ctx.slots.register({name:'sidebar.right.pane.tab',key:'fixture-chat'},()=>{const [draft,setDraft]=React.useState('');return React.createElement('textarea',{'aria-label':'Sidebar draft',value:draft,onChange:e=>setDraft(e.target.value)})});
      ctx.slots.register({name:'settings.plugin.item',key:'tabs-fixture'},()=>React.createElement('p',null,'Legacy settings'));
      ctx.slots.register({name:'plugins.bundle.config',key:'tabs-fixture'},()=>React.createElement('p',null,'Bundle settings'));
    }};
  }});`;
  await page.goto('http://lifecycle.test/'); await ready(); await open();
  await page.getByRole('searchbox',{name:'搜索已安装插件'}).fill('tabs-fixture');
  assert.equal(await page.locator('.dsh-plugin-row').count(),1);
  await page.getByRole('button',{name:'配置 tabs-fixture',exact:true}).click();
  await page.getByText('Bundle settings',{exact:true}).waitFor();
  assert.equal(await page.getByText('Legacy settings',{exact:true}).count(),0);
  assert.equal(await page.getByRole('navigation',{name:'当前插件设置'}).count(),0,'one custom settings page needs no redundant tab');
  await page.getByRole('button',{name:'返回插件列表',exact:true}).click();
  assert.equal(await page.getByRole('searchbox',{name:'搜索已安装插件'}).inputValue(),'tabs-fixture','return preserves the list filter');
  await page.getByRole('searchbox',{name:'搜索已安装插件'}).fill('');
  assert.equal(await page.getByRole('button',{name:'模型与语音',exact:true}).count(),0);
  await close();
  await page.evaluate(()=>window.runtime.openSidebarTab('fixture-chat'));
  await page.getByLabel('Sidebar draft',{exact:true}).fill('preserve across unrelated changes');
  await open(); await detail('switchable'); await page.getByRole('button',{name:'停用',exact:true}).click();
  await close();
  assert.equal(await page.getByLabel('Sidebar draft',{exact:true}).inputValue(),'preserve across unrelated changes');
  await page.getByRole('button',{name:'Embed',exact:true}).click();

  await detail('tabs-fixture');
  await page.getByText('Bundle settings',{exact:true}).waitFor();
  assert.equal(await page.locator('dialog#third-party-plugins').count(),0);
  assert.equal(await page.locator('#inline-manager #third-party-plugins').count(),1);
  assert.equal(await page.locator('#client-main').evaluate(el=>el.inert),false);
  assert.deepEqual(errors,[]);
  console.log('PASS filtered list return, legacy/bundle deduplication, unrelated sidebar draft retention, and inline slot context');

} finally { await browser.close(); }
