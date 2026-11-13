// Real shell + embedded chat; clicks must never paint a page-sized scrim.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const server=spawn(process.execPath,['tests/workspace-layout.mjs'],{env:{...process.env,PORTAL_LAYOUT_PREVIEW:'1'},stdio:['ignore','pipe','inherit']});
let browser;
try {
 const url=await new Promise((resolve,reject)=>{let output='';server.stdout.on('data',data=>{output+=data;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]);});server.on('exit',code=>reject(Error(`Fixture exited ${code}`)));});
 browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:960},hasTouch:true});
 await page.goto(url);
 const frame=page.frameLocator('#chat-frame');
 await frame.locator('.message-bubble-body').first().waitFor();
 const cdp=await page.context().newCDPSession(page);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await mkdir('test-results',{recursive:true});
 const unobstructed=async()=>{
  assert.equal(await frame.locator(':modal,#drop-zone.active,#soul-card.active').count(),0);
  assert.equal(await frame.locator('#app').evaluate(n=>n.inert),false);
  await frame.locator('#input').click();
  assert.equal(await frame.locator('#input').evaluate(n=>n===document.activeElement),true,'Composer remains reachable after dismissing other UI');
 };
 for(const width of [1440,435]){
  await page.setViewportSize({width,height:960});
  // Connection notices share the shell toast and never change composer geometry.
  const composerBefore=await frame.locator('#input-area').boundingBox();
  await page.context().setOffline(true);
  const toast=page.locator('#toast');
  await page.waitForFunction(()=>document.querySelector('#toast:popover-open')?.textContent.includes('已离线'));
  assert.equal(await frame.locator('#reconnect-banner').count(),0);
  assert.equal(await frame.locator('#toast').count(),0,'Embedded chat must not duplicate the shell toast');
  assert.deepEqual(await frame.locator('#input-area').boundingBox(),composerBefore,'Offline notice must not move the composer');
  const toastBounds=await toast.boundingBox();
  assert.equal(toastBounds.y,18);
  assert.ok(toastBounds.x>=0&&toastBounds.x+toastBounds.width<=width,'Toast fits narrow windows');
  await page.screenshot({path:`test-results/chat-offline-toast-${width}.png`});
  await page.context().setOffline(false);
  await page.waitForFunction(()=>fixtureApp.connection==='online');
  await toast.waitFor({state:'hidden'});
  assert.deepEqual(await frame.locator('#input-area').boundingBox(),composerBefore,'Recovery leaves no bottom notice strip');
  const rect=await page.locator('#chat-frame').boundingBox();
  const point={x:Math.round(rect.x+rect.width-12),y:Math.round(rect.y+rect.height/2)};
  for(let i=0;i<3;i++){
   await page.mouse.click(point.x,point.y);
   await unobstructed();
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await unobstructed();
  }
  const add=frame.getByRole('button',{name:'添加附件和工具',exact:true});
  const menu=frame.getByRole('menu',{name:'添加附件和工具',exact:true});
  for(let i=0;i<3;i++){
   await add.click();await menu.waitFor();
   assert.equal(await menu.evaluate(n=>getComputedStyle(n,'::backdrop').backgroundColor),'rgba(0, 0, 0, 0)');
   await page.mouse.click(point.x,rect.y+12);await menu.waitFor({state:'hidden'});
   await unobstructed();
  }
  assert.equal(await frame.locator('.chat-root').evaluate(n=>getComputedStyle(n).webkitTapHighlightColor),'rgba(0, 0, 0, 0)');
  const send=frame.locator('#send-btn');
  const bounds=await send.boundingBox();assert.equal(bounds.width,34);assert.equal(bounds.height,34);
  assert.equal(await send.locator('svg').evaluate(n=>getComputedStyle(n).width),'20px');
  assert.equal(await send.isDisabled(),true);
  await frame.locator('#input').fill('保留草稿，按钮样式检查');
  assert.equal(await send.isEnabled(),true);
  await send.hover();
  await page.screenshot({path:`test-results/chat-controls-${width}-light.png`});
  await frame.locator('html').evaluate(n=>n.dataset.theme='dark');
  await frame.locator('#input-area').screenshot({path:`test-results/chat-composer-${width}-dark.png`});
  await frame.locator('html').evaluate(n=>n.dataset.theme='light');
  await frame.locator('#input').fill('');
 }
 // Startup notices, action information and errors all use the same top toast.
 await page.evaluate(()=>{fixtureApp.snapshot.notice='连接检查失败，请检查设置后重试。';fixtureApp.changed();});
 await page.waitForFunction(()=>document.querySelector('#toast:popover-open')?.textContent==='连接检查失败，请检查设置后重试。');
 assert.equal(await page.locator('#startup-notice').count(),0);
 await page.evaluate(()=>{fixtureApp.snapshot.notice=undefined;fixtureApp.changed();});
 await page.locator('#toast').waitFor({state:'hidden'});
 for(const failure of [false,true]) {
  await page.evaluate(failure=>fixtureApp.toast(failure?new Error('操作失败，请重试。'):'设置已保存。'),failure);
  await page.locator('#toast:popover-open').waitFor();
  assert.equal(await page.locator('#toast').textContent(),failure?'操作失败，请重试。':'设置已保存。');
  assert.equal((await page.locator('#toast').boundingBox()).y,18);
 }
 await page.context().setOffline(true);
 await page.waitForFunction(()=>fixtureApp.connection==='offline');
 await page.evaluate(()=>fixtureApp.toast('设置已保存。'));
 await page.context().setOffline(false);
 await page.waitForFunction(()=>fixtureApp.connection==='online');
 assert.equal(await page.locator('#toast').textContent(),'设置已保存。','Recovery must not clear a newer action notice');
 await page.locator('#toast').waitFor({state:'hidden',timeout:8000});
 await page.setViewportSize({width:1440,height:960});
 await page.evaluate(()=>fixtureApp.openClientSettings());
 const settings=page.locator('#client-settings-dialog');
 for(const label of ['Being','Portal','Town','模型']) assert.equal(await settings.getByRole('tab',{name:label,exact:true}).count(),1);
 await settings.getByRole('tab',{name:'Portal',exact:true}).click();
 await page.screenshot({path:'test-results/settings-short-labels.png'});
 await page.keyboard.press('Escape');await settings.waitFor({state:'hidden'});
 await unobstructed();
 assert.deepEqual(errors,[]);
 console.log('PASS: unified top toasts, offline/recovery without composer movement, startup and action notices, automatic dismissal, blank clicks, menus, send states, wide/narrow and light/dark.');

} finally {await browser?.close();server.kill();}
