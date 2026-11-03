import { build } from 'esbuild';
import { chromium } from 'playwright';
import { browserAssets } from './support/browser-assets.mjs';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

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
const snapshot = () => ({ plugins, clients: plugins.filter(p => p.enabled && p.status === 'active').map(p => ({ id: p.id, owner: p.id, url: '/client/' + p.id, inject: [] })), routes: [], injections });
const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
  import React from 'react'; import {createRoot} from 'react-dom/client';
  import {dshRuntime} from './desktop/renderer/plugins/dsh/runtime';
  import {DshPluginSurfaces} from './desktop/renderer/plugins/dsh/page';
  window.runtime=dshRuntime;
  const request=async(path,data)=>{const r=await fetch(path,{method:data?'POST':'GET',body:data&&JSON.stringify(data)});return r.json()};
  window.beings={dshPlugins:{state:()=>request('/state'),enable:(id,enabled)=>request('/enable',{id,enabled}),remove:id=>request('/remove',{id}),install:source=>request('/install',{source})}};
  dshRuntime.setNavigationHost(document.getElementById('nav'));
  document.getElementById('manager').onclick=()=>dshRuntime.openManager();
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
    if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="client-main"><div class="workspace-rail"><div id="nav"></div></div><button id="manager">Manage</button></div><div id="root"></div><script src="/lifecycle.js"></script>' });
    if (pathname === '/lifecycle.js') return route.fulfill({ contentType: 'text/javascript', body: code });
    if (pathname.startsWith('/client/')) return route.fulfill({ contentType: 'text/javascript', body: sources[decodeURIComponent(pathname.slice(8))] });
    if (pathname === '/state') return json(snapshot());
    if (pathname === '/enable') { const {id,enabled}=route.request().postDataJSON(); Object.assign(plugins.find(p=>p.id===id),{enabled,status:enabled?'active':'disabled'});return json(null); }
    if (pathname === '/remove') { plugins=plugins.filter(p=>p.id!==route.request().postDataJSON().id);return json(true); }
    if (pathname === '/install') { const {source}=route.request().postDataJSON();if(!plugins.some(p=>p.id===source))plugins.push(record(source));return json(true); }
    if (pathname === '/@town-dsh/rpc') return json({ok:true,value:{writable:true,hasDocument:true,namespaces:[]}});
    if (pathname === '/@town-dsh/events') return route.fulfill({contentType:'text/event-stream',body:': ready\n\n'});
    return route.fulfill({status:404});
  });
  const card = id => page.locator('.plugin-card').filter({has:page.getByRole('heading',{name:new RegExp('^'+id+' ')})});
  const open = () => page.getByRole('button',{name:'Manage',exact:true}).click();
  const close = () => page.getByRole('button',{name:'关闭',exact:true}).click();
  const ready = () => page.waitForFunction(()=>window.runtime.phase==='ready');
  reset(); await page.goto('http://lifecycle.test/'); await ready();
  await page.getByRole('button',{name:'switchable',exact:true}).waitFor();
  await open(); await card('switchable').getByRole('button',{name:'停用',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#third-party-plugins').hasAttribute('aria-busy'));
  assert.equal(await card('healthy').getByRole('button',{name:'healthy settings',exact:true}).count(),1,'disabling a peer must retain healthy settings');
  await close();
  assert.equal(await page.getByRole('button',{name:'switchable',exact:true}).count(),0,'disabled sidebar must be disposed');
  await page.getByRole('button',{name:'healthy',exact:true}).click();
  await page.getByText('healthy panel 1',{exact:true}).waitFor();
  await page.getByRole('button',{name:'返回 Town',exact:true}).click();
  for (let i=0;i<3;i++) {
    await open();await card('switchable').getByRole('button',{name:'启用',exact:true}).click();await close();
    assert.equal(await page.getByRole('button',{name:'switchable',exact:true}).count(),1);
    assert.equal(await page.getByRole('button',{name:'healthy',exact:true}).count(),0,'explicit sidebar owns the rail while enabled');
    await page.getByRole('button',{name:'switchable',exact:true}).click();
    await page.getByText('switchable panel 1',{exact:true}).waitFor();
    await open();await card('switchable').getByRole('button',{name:'停用',exact:true}).click();await close();
    assert.equal(await page.getByText('switchable panel 1',{exact:true}).count(),0,'disabling the active panel must return to Town');
  }
  assert.equal(await page.evaluate(()=>window.applied.healthy),1,'unrelated client must retain its live instance');
  assert.equal(await page.evaluate(()=>window.disposed.switchable),4);
  await open();await card('switchable').getByRole('button',{name:'卸载',exact:true}).click();
  await page.getByLabel('npm 包名、Git URL 或本地包路径').fill('switchable');await page.getByRole('button',{name:'安装',exact:true}).click();await close();
  assert.equal(await page.getByRole('button',{name:'switchable',exact:true}).count(),1);
  sources.switchable=client('switchable',true,'2');plugins.find(p=>p.id==='switchable').installedAt='2';
  await page.evaluate(()=>window.runtime.applyChanges());
  await page.getByRole('button',{name:'switchable',exact:true}).click();await page.getByText('switchable panel 2',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.applied.healthy),1);
  await open();await card('switchable').getByRole('button',{name:'停用',exact:true}).click();await close();
  await page.reload();await ready();assert.equal(await page.getByRole('button',{name:'healthy',exact:true}).count(),1);
  console.log('PASS disable/re-enable loops, sidebar fallback, active panel cleanup, remove/reinstall, update, reload and unaffected instance retention');
  reset();injections=[{kind:'html',placement:'head',html:'<style>:root { --lifecycle-injection: 1; }</style>'}];
  sources.newcomer=client('newcomer');
  await page.goto('http://lifecycle.test/');await ready();
  injections=[];
  await open();await card('switchable').getByRole('button',{name:'停用',exact:true}).click();
  await page.getByRole('button',{name:'重新加载页面',exact:true}).waitFor();
  assert.equal(await card('healthy').getByRole('button',{name:'healthy settings',exact:true}).count(),1);
  await page.getByLabel('npm 包名、Git URL 或本地包路径').fill('newcomer');await page.getByRole('button',{name:'安装',exact:true}).click();await close();
  assert.equal(await page.getByRole('button',{name:'newcomer',exact:true}).count(),1,'pending global reload must not block a new independent client');
  assert.equal(await page.getByRole('button',{name:'healthy',exact:true}).count(),1);
  injections=[{kind:'html',placement:'head',html:'<style>:root { --lifecycle-injection: 1; }</style>'}];
  await open();await card('switchable').getByRole('button',{name:'启用',exact:true}).click();
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
  assert.equal(await card('healthy').getByRole('button',{name:'healthy settings',exact:true}).count(),1);
  assert.deepEqual(errors,[]);
  console.log('PASS root startup race');
  await mkdir('output/dsh-lifecycle',{recursive:true});await page.screenshot({path:'output/dsh-lifecycle/browser.png'});
} finally { await browser.close(); }
