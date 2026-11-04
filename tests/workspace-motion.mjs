// Real desktop shell, isolated browser storage and synthetic services.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const server = spawn(process.execPath, ['tests/workspace-layout.mjs'], {
  env: { ...process.env, PORTAL_LAYOUT_PREVIEW: '1', PORTAL_LAYOUT_PORT: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let browser;
try {
  const origin = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Preview startup timed out')), 20000);
    let output = '';
    server.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/Layout preview: (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
    server.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Preview exited: ${code}`));
    });
  });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);

  await mkdir('output/playwright', {recursive:true});
  const toggle = page.getByRole('button', {name:'Being 信息',exact:true});
  const panel = page.locator('#being-info');
  const settle = () => page.waitForFunction(() => !document.querySelector('#being-info').hasAttribute('data-animating'));
  await toggle.click();
  await settle();
  const full = await panel.boundingBox();
  const identity = await page.locator('.being-profile').boundingBox();
  await page.getByRole('tab',{name:'电脑',exact:true}).click();
  assert.deepEqual(await page.locator('.being-profile').boundingBox(), identity);
  await page.getByRole('tab',{name:'详情',exact:true}).click();
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('#being-profile-panel')).opacity==='1');
  await page.screenshot({path:'output/playwright/motion-desktop.png'});
  // Run state changes within the same frame so interruption cannot be hidden by click auto-wait.
  const measurements = await page.evaluate(async () => {
    const app = window.fixtureApp;
    const rail = document.querySelector('#being-info');
    const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
    const settled = () => new Promise(resolve => { function check() { if (!rail.hasAttribute("data-animating")) resolve(); else requestAnimationFrame(check); } requestAnimationFrame(check); });
    const animation = () => new Promise(resolve => {
      function check() { const a=rail.getAnimations()[0]; if(a) resolve(a); else requestAnimationFrame(check); }
      requestAnimationFrame(check);
    });
    app.toggleBeingInfo();
    const closingAnimation=await animation(); closingAnimation.pause(); closingAnimation.currentTime=70;
    const closing = new DOMMatrixReadOnly(getComputedStyle(rail).transform).m41;
    const inert = rail.inert;
    app.toggleBeingInfo();
    const reversedAnimation=await animation(); reversedAnimation.pause(); reversedAnimation.currentTime=100;
    const reversed = new DOMMatrixReadOnly(getComputedStyle(rail).transform).m41;
    const debug=rail.getAnimations().map(a=>({time:a.currentTime,frames:a.effect.getKeyframes()}));
    reversedAnimation.finish(); await settled();
    app.toggleBeingInfo(); await settled(); await delay(50);
    const hidden = rail.hidden;
    const frames=[]; let last=performance.now();
    app.toggleBeingInfo();
    const start=performance.now();
    await new Promise(resolve => {
      function frame(now) { frames.push(now-last);last=now;if(now-start<380)requestAnimationFrame(frame);else resolve(); }
      requestAnimationFrame(frame);
    });
    return {closing,reversed,debug,inert,hidden,frames:frames.slice(1)};
  });
  assert.ok(measurements.closing>0 && measurements.closing<full.width);
  assert.ok(measurements.reversed>=0 && measurements.reversed<measurements.closing);
  assert.ok(Math.abs(Number(measurements.debug[0].frames[0].transform.match(/matrix\(([^)]+)\)/)[1].split(',')[4])-measurements.closing)<1, "Reversal starts at the current translation");
  assert.equal(measurements.inert,true);
  assert.equal(measurements.hidden,true);
  await settle();
  assert.equal((await panel.boundingBox()).width,full.width);
  assert.equal(await page.locator('#conversation-name').innerText(),'Willow');
  assert.ok((await page.locator('#conversation-name').boundingBox()).width>20, 'Being name is visibly displayed');
  assert.equal(await page.locator('[data-slot="being-pet"]').count(),0);
  assert.equal(await page.getByRole('button',{name:/编辑 .* 的宠物形象/}).count(),0);
  await page.getByRole('button',{name:'SBS 状态与显示设置'}).click();
  await page.getByRole('dialog',{name:'SBS 自主活动'}).waitFor();
  await page.getByRole('button',{name:'关闭 SBS 设置'}).click();
  await page.getByRole('dialog',{name:'SBS 自主活动'}).waitFor({state:'hidden'});
  await page.getByRole('button',{name:'关闭 Being 信息',exact:true}).click();
  await panel.waitFor({state:'hidden'});
  assert.equal(await toggle.evaluate(e=>e===document.activeElement),true);
  await page.getByRole('button',{name:'展开场景列表',exact:true}).click();
  await page.getByRole('complementary',{name:'场景列表'}).waitFor();
  await page.keyboard.press('Escape');
  await page.locator('#chat-session-panel').waitFor({state:'hidden'});
  await page.setViewportSize({width:700,height:800});
  await toggle.click(); await settle();
  await page.screenshot({path:'output/playwright/motion-narrow.png'});
  assert.ok((await panel.boundingBox()).x>=64);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.getByRole('button',{name:'关闭 Being 信息',exact:true}).click();
  await panel.waitFor({state:'hidden'});
  await toggle.click();
  assert.equal(await panel.getAttribute('data-animating'),null);
  await page.setViewportSize({width:1440,height:900});
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await page.locator('#chat-frame').contentFrame().locator('html').evaluate(e=>e.dataset.theme='dark');
  await page.screenshot({path:'output/playwright/motion-dark.png'});
  assert.deepEqual(errors,[]);
  console.log('Motion: reversal, exit retention, stable identity, focus, name identity, SBS, scenes, narrow and reduced motion passed.');
  console.log(JSON.stringify(measurements));
} finally {
  await browser?.close();
  server.kill();
}
