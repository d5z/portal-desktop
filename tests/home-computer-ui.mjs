import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { build } from '../scripts/renderer-build.mjs';
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
  import { createRoot } from 'react-dom/client';
  import { useState } from 'react';
  import { BeingComputer } from './desktop/renderer/app/components/being-computer';
  import './desktop/renderer/app/styles.scss';
  let state = { authenticated:true,authenticating:false,username:'willow-human',beingName:'Willow',binding:'matched',enabled:true,storageReady:true,browserReady:true,viewer:'closed',computer:{id:'one',being_profile_id:'profile',status:'stopped',generation:1} };
  const listeners = new Set(); window.actions = []; window.layouts = [];
  window.setHome = patch => { state = {...state,...patch}; listeners.forEach(fn=>fn(state)); };
  const api = {
    state:async()=>state,refresh:async()=>state,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
    bounds:async value=>{window.layouts.push(value);},
    preview:async()=> 'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#f6f6f4"/><text x="50" y="80" font-size="24">Cloud browser fixture</text></svg>'),
    action:async action=>{
      window.actions.push(action);
      if(action==='wake') window.setHome({pending:'ensure',operation:{id:'op',status:'pending'},computer:{...state.computer,status:'starting'}});
      if(action==='open') window.setHome({viewer:'page'});
      if(action==='close') window.setHome({viewer:'closed'});
      if(action==='logout') window.setHome({authenticated:false,viewer:'closed'});
      if(action==='bind') window.setHome({binding:'matched'});
      return state;
    },
  };
  function Fixture(){
    const [active,setActive]=useState(true),[available,setAvailable]=useState(true),[host,setHost]=useState(null);
    return <><div style={{position:'fixed',left:80,top:4,zIndex:30}}><button id="toggle" onClick={()=>setActive(!active)}>Toggle tab</button><button id="route" onClick={()=>setAvailable(!available)}>Toggle route</button><button id="dialog" onClick={()=>document.querySelector('dialog').showModal()}>Settings</button></div>
      <main id="client-main"><div className="workspace-body" ref={setHost} style={{height:'100vh'}}>
        <nav className="workspace-rail"/><div className="workspace-stage"/>
        <aside id="being-info" className="being-info" style={{width:320,flexBasis:320}}>
          <div className="being-overview"><div className="being-profile"><div className="being-avatar">W</div><h2>Willow</h2></div>
          <div className="being-tabs"><button>详情</button><button>动态</button><button>资料库</button><button aria-selected="true">电脑</button></div>
          <div className="being-info-content"><section hidden={!active}><BeingComputer name="Willow" api={api} active={active} available={available} context="fixture" browserHost={host}/></section><p hidden={active}>Library content</p></div></div>
        </aside>
      </div></main><dialog><p>Settings fixture</p><button onClick={()=>document.querySelector('dialog').close()}>Close settings</button></dialog></>;
  }
  createRoot(document.querySelector('#root')).render(<Fixture/>);
` }, bundle: true, write: false, outdir: '/fixture', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
const server = createServer((request, response) => {
  const file = bundle.outputFiles.find(f => f.path.endsWith(request.url));
  response.setHeader('Content-Type', file ? request.url.endsWith('.css') ? 'text/css' : 'text/javascript' : 'text/html; charset=utf-8');
  response.end(file ? file.contents : '<link rel="stylesheet" href="/stdin.css"><div id="root"></div><script src="/stdin.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button', { name: '唤醒', exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.actions), []);
  await mkdir('output/playwright', { recursive: true });
  await page.locator('#being-info').screenshot({ path: 'output/playwright/home-sleeping.png' });
  await page.getByRole('button', { name: '唤醒', exact: true }).click();
  await page.getByText('正在唤醒…', { exact: true }).waitFor();
  await page.locator('#being-info').screenshot({ path: 'output/playwright/home-waking.png' });
  await page.evaluate(() => window.setHome({ pending: undefined, operation: undefined, computer: { id: 'one', being_profile_id: 'profile', status: 'running', generation: 1 } }));
  const expand = page.getByRole('button', { name: '放大展示云端浏览器', exact: true });
  const collapse = page.getByRole('button', { name: '关闭云电脑面板', exact: true });
  await expand.waitFor();
  await page.locator('.being-computer-preview img').waitFor();
  await page.waitForFunction(() => window.layouts.at(-1)?.presentation === 'preview' && window.layouts.at(-1)?.visible);
  assert.equal(await page.locator('.cloud-browser-pane').isVisible(), false, 'waking must not expand the profile');
  assert.equal(await page.locator('.being-profile').isVisible(), true);
  const profileWidth = (await page.locator('#being-info').boundingBox()).width;
  assert.deepEqual(await page.evaluate(() => window.actions), ['wake', 'open']);
  await page.locator('#toggle').click();
  await page.getByText('Library content').waitFor();
  await page.locator('#toggle').click();
  await expand.waitFor();
  assert.deepEqual(await page.evaluate(() => window.actions), ['wake', 'open'], 'switching tabs must retain the session');
  await expand.click();
  await collapse.waitFor();
  await page.waitForFunction(() => window.layouts.at(-1)?.visible === true && window.layouts.at(-1)?.presentation === 'browser');
  assert.equal(await page.getByRole('button', { name: '电脑更多操作' }).isVisible(), false);
  const divider = page.getByRole('separator', { name: '调整云端浏览器宽度' });
  const pane = page.locator('.cloud-browser-pane');
  const beforeDrag = await pane.boundingBox();
  const handle = await divider.boundingBox();
  assert.equal(handle.width, 20, 'resize hit target should span both sides of the divider');
  const nativeBounds = await page.locator('.being-computer-viewport').boundingBox();
  assert(nativeBounds.x >= handle.x + handle.width, 'native view must not cover the resize target');
  assert.equal(handle.x + handle.width / 2, beforeDrag.x - 4, 'resize target is centered in the 8px gutter');
  await page.mouse.move(handle.x + handle.width / 2, beforeDrag.y + beforeDrag.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 - 50, beforeDrag.y + beforeDrag.height / 2, { steps: 5 });
  await page.mouse.up();
  assert((await pane.boundingBox()).width > beforeDrag.width + 40, 'dragging from the gutter center should resize');
  await divider.dblclick();
  const rect = await page.locator('.being-computer-viewport').boundingBox();
  assert(rect.height > 800, 'expanded browser should use the full available height');
  assert.equal(await page.locator('.cloud-browser-pane').evaluate(el => el.parentElement.className), 'workspace-body');
  await page.locator('#dialog').click();
  await page.waitForFunction(() => window.layouts.at(-1)?.visible === false);
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.waitForFunction(() => window.layouts.at(-1)?.visible === true);
  await collapse.click();
  const openCount = await page.evaluate(() => window.actions.filter(a => a === 'open').length);
  await page.getByRole('button', { name: '刷新电脑状态' }).click();
  assert.equal(await page.evaluate(() => window.actions.filter(a => a === 'open').length), openCount, 'refreshing status must retain the existing viewing session');
  await page.getByRole('button', { name: '电脑更多操作' }).click();
  await page.waitForFunction(() => window.layouts.at(-1)?.visible === false);
  await page.getByRole('button', { name: '停止电脑…', exact: true }).click();
  assert.equal(await page.evaluate(() => window.actions.includes('stop')), false);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.waitForFunction(() => window.layouts.at(-1)?.visible === true);
  await expand.click();
  await page.locator('#route').click();
  await page.waitForFunction(() => window.layouts.at(-1)?.visible === false);
  await page.locator('#route').click();
  await page.waitForFunction(() => window.layouts.at(-1)?.visible === true);
  await page.evaluate(() => { window.layouts = []; });
  await page.getByRole('button', { name: '收起对话' }).click();
  assert.equal(await page.locator('.workspace-stage').isVisible(), false);
  await page.getByRole('button', { name: '展开对话' }).click();
  assert.equal(await page.evaluate(() => window.layouts.some(b => !b.visible)), false, 'changing panel layout must not briefly hide the viewer or release control');
  await collapse.click();
  await expand.waitFor();
  assert.equal((await page.locator('#being-info').boundingBox()).width, profileWidth, 'profile width must be unchanged');
  assert.equal(await page.locator('.being-profile').isVisible(), true);
  assert.deepEqual(await page.evaluate(() => window.actions), ['wake', 'open'], 'expand/collapse and routing must never exchange a fresh ticket');
  await expand.click();
  await collapse.click();
  await page.evaluate(() => window.setHome({ viewer: 'expired' }));
  await page.getByRole('button', { name: '重新打开', exact: true }).click();
  await expand.waitFor();
  assert.equal(await page.evaluate(() => window.actions.filter(a => a === 'open').length), 2);
  await page.getByRole('button', { name: '电脑更多操作' }).click();
  await page.getByRole('button', { name: '关闭浏览器', exact: true }).click();
  assert.equal(await page.evaluate(() => window.actions.at(-1)), 'close');
  await page.getByRole('button', { name: '电脑更多操作' }).click();
  await page.locator('#being-info').screenshot({ path: 'output/playwright/home-ready-menu.png' });
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.setHome({ binding: 'missing', viewer: 'closed' }));
  await page.getByRole('button', { name: '关联 Being', exact: true }).click();
  assert.equal(await page.evaluate(() => window.actions.includes('bind')), false);
  await page.getByRole('button', { name: '确认关联', exact: true }).click();
  await page.getByRole('button', { name: '打开浏览器', exact: true }).waitFor();
  await page.evaluate(() => window.setHome({ binding: 'mismatch' }));
  await page.getByText('Home 账号关联了其他 Being').waitFor();
  assert.equal(await page.getByRole('button', { name: '打开浏览器', exact: true }).count(), 0);
  await page.evaluate(() => window.setHome({ authenticated: false }));
  await page.getByRole('button', { name: '连接 Being Home', exact: true }).waitFor();
  await page.locator('#being-info').screenshot({ path: 'output/playwright/home-login.png' });
  await page.evaluate(() => window.setHome({ authenticated: true, binding: 'matched', computer: { id: 'one', status: 'stopped', generation: 1 } }));
  for (const width of [900, 435, 360]) {
    await page.setViewportSize({ width, height: 800 });
    await page.getByRole('button', { name: '唤醒', exact: true }).waitFor();
    assert.equal(await page.locator('.being-info-content').evaluate(el => el.scrollWidth > el.clientWidth), false);
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; document.body.setAttribute('data-ds-dark-theme', ''); });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.being-computer-controls button')).color !== 'rgb(36, 36, 36)');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.being-computer-primary')).color === 'rgb(27, 28, 30)');
  await page.locator('#being-info').screenshot({ path: 'output/playwright/home-narrow-dark.png' });
  assert.deepEqual(errors, []);
  console.log('PASS Home UI: preview before explicit expansion, separate full-height pane, unchanged profile, retained tab/route/collapse session, modal/menu occlusion, maximize, expiration, binding and responsive layouts.');
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
