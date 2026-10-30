// Exercise the packaged shell + embedded chat + real bundled Portal with an isolated profile.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { mkdtemp, mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { launchDesktop } from './support/electron-lifecycle.mjs';
import { desktopExecutable, waitForChatReady } from './support/desktop.mjs';

const directory = await mkdtemp(path.join(os.tmpdir(), 'portal-permissions-package-'));
const workspace = path.join(directory, 'workspace');
await mkdir(workspace); await mkdir('output/playwright', {recursive:true});
const pending = new Map(); let relay, nextId=0, relayGeneration=0, application, page;
const server = createServer((req,res) => {
  const url = new URL(req.url,'http://localhost');
  res.setHeader('Content-Type','application/json');
  if (url.pathname.endsWith('/api/stream/active')) {res.writeHead(204);res.end();return;}
  const data = url.pathname.endsWith('/api/history') ? {messages:[]}
    : url.pathname.endsWith('/api/scenes') ? {scenes:[]}
    : {being_name:'Permission fixture',status:'ok',sbs_enabled:false,presets:[]};
  res.end(JSON.stringify(data));
});
const sockets = new WebSocketServer({server,path:'/_relay'});
sockets.on('connection',socket => {
  let ready=false;
  socket.on('message',data=>{
    const msg=JSON.parse(data.toString());
    if (!ready) {assert.equal(msg.loom_token,'permission-test');relay=socket;relayGeneration++;ready=true;socket.send(JSON.stringify({ok:true,relay_keepalive:'text-v1'}));return;}
    if (msg.type==='keepalive') {socket.send(JSON.stringify({type:'keepalive_ack'}));return;}
    const entry=pending.get(msg.id); if(entry){clearTimeout(entry.timer);pending.delete(msg.id);entry.resolve(msg);}
  });
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
function call(command, name = 'portal_exec', args = {command}) {
  return new Promise((resolve,reject)=>{
    const id=++nextId;
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Tool call timed out'));},30000);
    pending.set(id,{resolve,timer});
    relay.send(JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}}));
  });
}
async function reconnectedAfter(generation) {
  const deadline=Date.now()+20000;
  while(Date.now()<deadline) {
    if(relayGeneration>generation && relay?.readyState===1) return;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error('New permission runtime did not reconnect');
}
try {
  application=await launchDesktop({executablePath:await desktopExecutable(),env:{...process.env,PORTAL_DESKTOP_USER_DATA:path.join(directory,'profile')}});
  page=await application.firstWindow();page.setDefaultTimeout(20000);
  await page.getByRole('button',{name:'连接我的 Being'}).click();
  await page.locator('#connection-link').fill(`http://127.0.0.1:${server.address().port}/fixture/?token=permission-test`);
  await page.getByRole('tab',{name:'Portal',exact:true}).click();
  await page.locator('.settings-disclosure > summary').filter({hasText:'本机配置'}).click();
  await page.locator('#portal-name-input').fill('permission-test');
  await page.locator('#workspace-input').fill(workspace);
  await page.locator('#background-input').uncheck();
  await page.getByRole('tab',{name:'Being',exact:true}).click();
  await page.getByRole('button',{name:'保存、连接并启动'}).click();
  await page.waitForFunction(async () => (await window.beings.snapshot()).settings.hasToken && !document.querySelector('#save-settings').disabled, null, { timeout: 15000 });
  await page.locator('#close-client-settings').click();
  await page.locator('#client-settings-dialog').waitFor({state:'hidden'});
  await waitForChatReady(page);
  const chat=page.frameLocator('#chat-frame');
  await chat.getByRole('button',{name:'快捷设置工作权限'}).waitFor();
  const add=chat.getByRole('button',{name:'添加附件和工具',exact:true});
  const addMenu=chat.getByRole('menu',{name:'添加附件和工具',exact:true});
  await add.click();await addMenu.waitFor();
  assert.equal(await chat.locator('.iui-trigger, .iui-message-option').count(),0);
  assert.equal(await addMenu.getByRole('menuitem',{name:/智能 UI.*\/ui/}).isEnabled(),true);
  await addMenu.screenshot({path:'output/playwright/composer-add-menu-light.png'});
  await chat.locator('html').evaluate(el=>el.dataset.theme='dark');
  await addMenu.screenshot({path:'output/playwright/composer-add-menu-dark.png'});
  await chat.locator('html').evaluate(el=>el.dataset.theme='light');
  await addMenu.press('Escape');await addMenu.waitFor({state:'hidden'});
  await add.click();await addMenu.getByRole('menuitem',{name:/智能 UI.*\/ui/}).click();
  await addMenu.waitFor({state:'hidden'});
  assert.equal((await chat.locator('#input').evaluate(el => el.value ?? el.editor.getMarkdown())).trim(),'/ui');
  await add.click();await addMenu.getByRole('menuitem',{name:/出图.*\/image/}).click();
  assert.equal((await chat.locator('#input').evaluate(el => el.value ?? el.editor.getMarkdown())).trim(),'/ui /image');
  await chat.locator('#input').fill('');
  await add.click();await chat.locator('#messages').click({position:{x:10,y:10}});await addMenu.waitFor({state:'hidden'});
  await add.click();await add.click();await addMenu.waitFor({state:'hidden'});
  await add.click();
  const choosing=page.waitForEvent('filechooser');
  await addMenu.getByRole('menuitem',{name:/上传附件/}).click();
  const chooser=await choosing;
  assert.equal(chooser.isMultiple(),true);
  await chooser.setFiles({name:'add-menu-test.txt',mimeType:'text/plain',buffer:Buffer.from('Attachment selected through the add menu.')});
  await addMenu.waitFor({state:'hidden'});
  await chat.getByRole('button',{name:'移除 add-menu-test.txt',exact:true}).click();
  await add.click();await addMenu.getByRole('menuitem',{name:/交互示例/}).click();
  await page.frameLocator('.ui-examples-frame').getByRole('combobox',{name:'选择交互示例'}).waitFor();
  await page.getByRole('button',{name:'回到对话',exact:true}).click();
  for(const width of [900,640,380,300]) {
    await page.locator('#chat-frame').evaluate((el,w)=>{el.style.width=`${w}px`;el.style.maxWidth='none';},width);
    const metrics=await chat.locator('#input-row').evaluate(row=>{
      const bounds=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
      const controls=[...row.querySelectorAll(':scope > button, :scope > .composer-add > button')].map(el=>({name:el.getAttribute('aria-label'),...bounds(el)}));
      const button=row.querySelector('.permission-quick-trigger');
      const span=button.querySelector('span');
      return {area:bounds(row.closest('#input-area')),controls,button:bounds(button),label:bounds(span),font:getComputedStyle(button).fontSize,nowrap:getComputedStyle(button).whiteSpace};
    });
    assert.equal(metrics.font,'12px');assert.equal(metrics.nowrap,'nowrap');
    for(const button of metrics.controls) {
      assert.ok(button.bottom<=metrics.area.bottom+1 && button.x>=metrics.area.x && button.right<=metrics.area.right+1,`Control outside composer at ${width}: ${JSON.stringify(button)}`);
      for(const other of metrics.controls) if(other!==button) assert.ok(button.right<=other.x+1 || other.right<=button.x+1 || button.bottom<=other.y+1 || other.bottom<=button.y+1,`Overlapping controls at ${width}`);
    }
    if(width>520) assert.ok(metrics.label.height<=20 && metrics.label.right<=metrics.button.right,'Permission text must stay inside its button on one line');
    await chat.locator('#input-area').screenshot({path:`output/playwright/permissions-composer-${width}.png`});
    await add.click();await addMenu.waitFor();
    const menuBounds=await addMenu.evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight};});
    assert.ok(menuBounds.x>=0 && menuBounds.y>=0 && menuBounds.right<=menuBounds.width && menuBounds.bottom<=menuBounds.height,`Add menu outside viewport at ${width}: ${JSON.stringify(menuBounds)}`);
    await addMenu.press('Escape');await addMenu.waitFor({state:'hidden'});
  }
  await page.locator('#chat-frame').evaluate(el=>{el.style.width='';el.style.maxWidth='';});
  await chat.getByRole('button',{name:'快捷设置工作权限'}).click();
  const menu=page.getByRole('menu',{name:'工作权限',exact:true});
  await menu.waitFor();
  assert.equal(await page.getByRole('dialog',{name:'工作权限',exact:true}).count(),0);
  assert.equal(await menu.getByRole('menuitemradio',{name:/帮我批准/}).getAttribute('aria-checked'),'true');
  const initialPid=(await page.evaluate(()=>window.beings.snapshot())).portal.pid;
  await page.screenshot({path:'output/playwright/permissions-packaged-menu.png'});
  await page.locator('html').evaluate(el=>el.dataset.theme='dark');
  await menu.screenshot({path:'output/playwright/permissions-menu-dark.png'});
  await page.locator('html').evaluate(el=>el.dataset.theme='light');
  await menu.press('Escape');await menu.waitFor({state:'hidden'});
  assert.equal((await page.evaluate(()=>window.beings.snapshot())).portal.pid,initialPid,'Dismiss must not restart runtime');
  await chat.getByRole('button',{name:'快捷设置工作权限'}).click();await menu.waitFor();
  await chat.locator('#input').click();await menu.waitFor({state:'hidden'});
  await chat.getByRole('button',{name:'快捷设置工作权限'}).click();await menu.waitFor();
  await chat.getByRole('button',{name:'快捷设置工作权限'}).click();await menu.waitFor({state:'hidden'});
  await chat.getByRole('button',{name:'快捷设置工作权限'}).click();
  await menu.getByRole('menuitemradio',{name:/帮我批准/}).click();await menu.waitFor({state:'hidden'});
  assert.equal((await page.evaluate(()=>window.beings.snapshot())).portal.pid,initialPid,'Current mode is a no-op');
  await chat.getByRole('button',{name:'快捷设置工作权限'}).click();
  assert.equal(await menu.getByRole('menuitemradio',{name:/帮我批准/}).getAttribute('aria-checked'),'true');
  const beforeSupervised=relayGeneration;
  await menu.press('ArrowUp');await menu.press('Enter');await menu.waitFor({state:'hidden'});
  await reconnectedAfter(beforeSupervised);
  assert.equal((await page.evaluate(()=>window.beings.snapshot())).settings.permissionMode,'supervised');
  await chat.getByRole('button',{name:'快捷设置工作权限'}).getByText('请求批准',{exact:true}).waitFor();
  // Wait for the new runtime's relay after changing modes.
  await page.waitForFunction(async()=> (await window.beings.snapshot()).portal.phase === 'running');
  for(let i=0;i<100&&!relay;i++) await new Promise(r=>setTimeout(r,100));
  assert.ok(relay,'Bundled Portal must connect');
  const ordinary=await call('echo sandbox>sandbox.txt');
  assert.notEqual(ordinary.result?.isError,true,JSON.stringify(ordinary));
  const denied=call('', 'portal_exec', {command:'echo denied>denied.txt',sandbox_permissions:'require_escalated',justification:'Test host approval'});
  await page.getByRole('button',{name:'拒绝',exact:true}).click();
  assert.match(JSON.stringify(await denied),/approval|denied|rejected/i);
  await assert.rejects(access(path.join(workspace,'denied.txt')));
  const approved=call('', 'portal_exec', {command:'echo approved>approved.txt',sandbox_permissions:'require_escalated',justification:'Test host approval'});
  await page.getByRole('button',{name:'允许这一次'}).waitFor();
  assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'拒绝');
  await page.getByText('本机工具',{exact:false}).waitFor();
  await page.screenshot({path:'output/playwright/permissions-approved-sandbox.png'});
  await page.getByRole('button',{name:'允许这一次'}).click();
  const result=await approved;
  assert.equal(result.error,undefined,JSON.stringify(result));
  assert.notEqual(result.result?.isError,true,JSON.stringify(result));
  assert.match(await readFile(path.join(workspace,'approved.txt'),'utf8'),/approved/);
  if(process.platform==='darwin') {
    await writeFile(path.join(directory,'outside-secret'), 'private-test-content');
    const outside=call('cat ../outside-secret');
    const blocked=await outside;
    assert.equal(blocked.result?.isError,true,JSON.stringify(blocked));
    assert.doesNotMatch(JSON.stringify(blocked),/private-test-content/);
  }
  await chat.getByRole('button',{name:'快捷设置工作权限'}).click();
  const beforeFull=relayGeneration;
  await menu.getByRole('menuitemradio',{name:/完全访问/}).click();
  await reconnectedAfter(beforeFull);
  const full=await call('echo full>full.txt');
  assert.notEqual(full.result?.isError,true,JSON.stringify(full));
  assert.match(await readFile(path.join(workspace,'full.txt'),'utf8'),/full/);
  const beforeFinalReadonly=relayGeneration;
  await page.evaluate(async()=>{const s=await window.beings.snapshot();await window.beings.save({...s.settings,permissionMode:'read-only'});});
  await reconnectedAfter(beforeFinalReadonly);
  assert.match(JSON.stringify(await call('echo forbidden>readonly.txt')),/denied by permission mode/);
  const readonlyWrite=await call('', 'portal_file_write', {path:'readonly.txt',content:'blocked'});
  assert.match(JSON.stringify(readonlyWrite),/denied by permission mode/);
  await assert.rejects(access(path.join(workspace,'readonly.txt')));
  console.log('PASS packaged app: unified add menu handles keyboard, UI toggles, examples and real file chooser; composer and menus fit 900/640/380/300px; permission dropdown and real approval/sandbox execution work.');
} finally {
  if(page) await page.evaluate(()=>window.beings.stopPortal()).catch(()=>{});
  await application?.close();
  for(const entry of pending.values()) clearTimeout(entry.timer);
  for(const socket of sockets.clients) socket.terminate();sockets.close();
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await rm(directory,{recursive:true,force:true});
}
