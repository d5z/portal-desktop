import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const directory = await mkdtemp(path.join(os.tmpdir(), 'portal-chat-sessions-'));
let application;
try {
  for (const file of ['loom.html', 'chat.js', 'chat.css', 'highlight.css']) await copyFile(path.resolve('desktop/generated', file), path.join(directory, file));
  await writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="shell.css"></head><body><div id="root"></div><script src="shell.js"></script></body></html>');
  await build({ stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
    import React, {useRef, useEffect, useSyncExternalStore} from 'react';
    import {createRoot} from 'react-dom/client';
    import {AppModel} from './desktop/renderer/app/models/app';
    import {EditContextMenu} from './desktop/renderer/shared/components/context-menu';
    import {ChatSceneIndicator} from './desktop/renderer/app/components/chat-scene';
    import {useChatBridge} from './desktop/renderer/app/hooks/use-chat-bridge';
    import './desktop/renderer/app/styles.css';
    const app = new AppModel(window.beings);
    function Shell() {
      useSyncExternalStore(app.subscribe, app.getVersion);
      const frame = useRef(null); useChatBridge(app, frame);
      useEffect(() => { window.beings.snapshot().then(value => app.applySnapshot(value)); }, []);
      return <div id="client-main" className="workspace-stage" style={{height:'100vh',width:'100%'}}><header className="topbar">
        <ChatSceneIndicator scene={app.snapshot?.chatScene} sessions={app.snapshot?.chatSessions} connected={true}
          createRequest={app.chatSessionCreateRequest}
          activity={app.chatSceneActivity}
          scope={app.chatHistoryScope} scopeReady={!app.chatLoading && app.chatHistoryScopeKnown}
          onScope={scope => app.changeChatHistoryScope(scope)} onCopy={() => {}}
          onSession={(operation,value,sceneId) => app.changeChatSession(operation,value,sceneId)} />
        <span>同一个 Being · 会话测试</span></header>
        <section id="chat-view" className="view"><iframe id="chat-frame" ref={frame} src={app.chatSource || undefined} onLoad={() => app.frameLoaded()} /></section>
        <EditContextMenu edit={async () => true} rootSelector="#client-main, dialog[open]" selectionSelector=".reading-text, .dialog-body, #town-body" />
      </div>;
    }
    createRoot(document.getElementById('root')).render(<Shell />);
  ` }, bundle: true, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' }, outfile: path.join(directory, 'shell.js') });
  await build({ stdin: { loader: 'ts', resolveDir: process.cwd(), contents: `
    const {contextBridge, ipcRenderer} = require('electron');
    contextBridge.exposeInMainWorld('beings', {
      platform: process.platform, snapshot: () => ipcRenderer.invoke('snapshot'),
      sceneTasks: () => Promise.resolve({endpoint:'https://fixture.test/being',tasks:[],subagentReady:true}),
      changeChatSession: (operation,value,endpoint,sceneId) => ipcRenderer.invoke('session',operation,value,endpoint,sceneId),
    });
  ` }, bundle: true, platform: 'node', external: ['electron'], outfile: path.join(directory, 'preload.cjs') });
  await build({ stdin: { loader: 'ts', resolveDir: process.cwd(), contents: `
    import {app, protocol, BrowserWindow, ipcMain} from 'electron';
    import {ChatSessions, loadDesktopScene} from './desktop/main/chat/scene';
    import {ChatProxy} from './desktop/main/chat/proxy';
    import {registerLocalProtocol, configureLocalSession} from './desktop/main/app/protocol';
    app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
    protocol.registerSchemesAsPrivileged([{scheme:'beings',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
    app.whenReady().then(async () => {
      const original = await loadDesktopScene(${JSON.stringify(directory)}, 'test', '测试设备');
      const sessions = new ChatSessions(${JSON.stringify(directory)}, original); await sessions.load();
      const connection = {endpoint:'https://fixture.test/being',being:'being',token:'fixture',relaySecret:'fixture',link:''};
      const requests = [], history = []; globalThis.fixture = {requests, history, streams: new Map()};
      const proxy = new ChatProxy(() => connection, async (url, init) => {
        const route = new URL(url).pathname;
        if (route.endsWith('/api/history')) return Response.json({messages:history});
        if (route.endsWith('/api/stream/active')) return new Response(null,{status:204});
        if (route.endsWith('/api/chat/stream')) {
          const body = JSON.parse(init.body); requests.push(body);
          if (body.message.startsWith('并发')) {
            return new Response(new ReadableStream({start(controller) {
              globalThis.fixture.streams.set(body.scene_id, controller);
            }}), {headers:{'content-type':'text/event-stream'}});
          }
          if (body.message.startsWith('排队')) return Response.json({queued:true},{status:202});
          const row = {seq:history.length+1,role:'user',content:body.message,scene_id:body.scene_id,at:new Date().toISOString()}; history.push(row);
          history.push({...row,seq:history.length+1,role:'being',content:'回复：'+body.message});
          return new Response('event: content_block_delta\\ndata: '+JSON.stringify({scene_id:body.scene_id,delta:{text:'回复：'+body.message}})+'\\n\\nevent: message_stop\\ndata: '+JSON.stringify({scene_id:body.scene_id})+'\\n\\n', {headers:{'content-type':'text/event-stream'}});
        }
        if (route.endsWith('/health')) return new Response('OK');
        return Response.json({sbs_enabled:false,being_name:'同一个 Being'});
      }, () => sessions.current(connection.endpoint), id => sessions.list(connection.endpoint).find(scene => scene.scene_id === id));
      registerLocalProtocol(${JSON.stringify(directory)},proxy); configureLocalSession();
      const snapshot = () => ({settings:{endpoint:connection.endpoint,being:'being',hasToken:true},portal:{phase:'stopped',logs:[]},chatScene:sessions.current(connection.endpoint),chatSessions:sessions.list(connection.endpoint)});
      ipcMain.handle('snapshot',snapshot);
      ipcMain.handle('session',async (_,operation,value,endpoint,sceneId) => { if(endpoint !== connection.endpoint) throw new Error('Wrong Being'); await sessions.change(endpoint,operation,value,sceneId); return snapshot(); });
      const window = new BrowserWindow({width:1100,height:800,show:false,webPreferences:{preload:${JSON.stringify(path.join(directory,'preload.cjs'))},sandbox:true,contextIsolation:true,nodeIntegration:false}});
      await window.loadURL('beings://desktop/');
    });
  ` }, bundle: true, platform: 'node', external: ['electron'], outfile: path.join(directory, 'main.cjs') });
  application = await electron.launch({ args: [path.join(directory,'main.cjs')], env: {...process.env} });
  const page = await application.firstWindow();
  page.setDefaultTimeout(15000);
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  const chat = page.frameLocator('iframe');
  await chat.locator('#input').waitFor();
  const original = await page.evaluate(async () => (await window.beings.snapshot()).chatScene.scene_id);
  await chat.locator('#input').fill('原会话草稿');
  await page.getByRole('button',{name:'新建场景',exact:true}).click();
  await page.getByRole('textbox',{name:'场景名称'}).fill('方案讨论');
  await page.getByRole('button',{name:'创建并进入'}).click();
  await page.locator('#chat-session-editor').waitFor({state:'hidden'});
  await page.waitForFunction(async () => (await window.beings.snapshot()).chatSessions.length === 2);
  await chat.locator('#input').fill('方案内容');
  await chat.locator('#send-btn').click();
  await chat.getByText('回复：方案内容',{exact:true}).waitFor();
  const discussion = await page.evaluate(async () => (await window.beings.snapshot()).chatScene.scene_id);
  assert.notEqual(discussion,original);
  await chat.locator('#input').fill('方案草稿');
  await page.getByRole('button',{name:'切换到场景：桌面·测试设备'}).click();
  await chat.locator('#input').waitFor();
  await page.waitForFunction(() => document.querySelector('#chat-scene-indicator')?.textContent.includes('桌面·测试设备'));
  assert.equal(await chat.locator('#input').inputValue(),'原会话草稿');
  assert.equal(await chat.getByText('回复：方案内容',{exact:true}).count(),0);
  await page.getByRole('button',{name:'切换到场景：方案讨论'}).click();
  await chat.getByText('回复：方案内容',{exact:true}).waitFor();
  assert.equal(await chat.locator('#input').inputValue(),'方案草稿');
  await page.getByRole('button',{name:'切换到场景：方案讨论'}).click({button:'right'});
  await page.getByRole('menuitem',{name:'重命名',exact:true}).click();
  await page.getByRole('textbox',{name:'场景名称'}).fill('技术方案');
  await page.getByRole('button',{name:'保存名称'}).click();
  await page.locator('#chat-session-editor').waitFor({state:'hidden'});
  const persisted = await page.evaluate(() => window.beings.snapshot());
  assert.equal(persisted.chatScene.scene_id,discussion);
  assert.equal(persisted.chatScene.scene_meta.scene_label,'技术方案');
  const selectedItemBox = await page.getByRole('button',{name:'切换到场景：技术方案'}).boundingBox();
  const composerBeforeAll = await chat.locator('#input-area').boundingBox();
  await page.getByRole('button',{name:'全部场景',exact:true}).click();
  await chat.locator('#input:disabled').waitFor();
  assert.equal(await chat.locator('#send-btn').isDisabled(),true);
  const unselectedItemBox = await page.getByRole('button',{name:'切换到场景：技术方案'}).boundingBox();
  assert.equal(selectedItemBox.height,40);
  assert.equal(unselectedItemBox.height,selectedItemBox.height,'Selecting a session must not change its row height');
  const composerInAll = await chat.locator('#input-area').boundingBox();
  assert.ok(Math.abs(composerInAll.height - composerBeforeAll.height) < 1, 'Switching to all scenes must preserve composer height');
  assert.equal(await page.locator('.chat-session-list [data-scene-id][aria-current="true"]').count(),0);
  assert.equal(await page.evaluate(async () => (await window.beings.snapshot()).chatScene.scene_id),discussion);
  await chat.locator('.message-scene').filter({hasText:'技术方案'}).first().waitFor();
  await page.getByRole('button',{name:'切换到场景：技术方案'}).click();
  await chat.locator('#input:not(:disabled)').waitFor();
  assert.equal(await chat.locator('#input').inputValue(),'方案草稿');
  assert.equal((await application.evaluate(() => globalThis.fixture.requests))[0].scene_id,discussion);
  await mkdir('test-results',{recursive:true});
  const panel = page.getByRole('complementary',{name:'场景列表'});
  assert.equal(await panel.isVisible(),true);
  const panelBox = await panel.boundingBox(), chatBox = await page.locator('#chat-view').boundingBox();
  assert.ok(panelBox.x + panelBox.width <= chatBox.x, 'Floating panel must not cover the conversation');
  await chat.locator('#input').click();
  assert.equal(await panel.isVisible(),true, 'Typing must not dismiss session navigation');
  await page.screenshot({animations:'disabled',path:'test-results/chat-sessions-panel.png'});
  await page.getByRole('button',{name:'关闭场景列表',exact:true}).click();
  assert.equal(await panel.count(),0);
  await page.getByRole('button',{name:'展开场景列表',exact:true}).click();
  assert.equal(await panel.isVisible(),true);
  await application.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setSize(920,700));
  await page.screenshot({animations:'disabled',path:'test-results/chat-sessions-panel-narrow.png'});
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; document.querySelector('iframe').contentWindow.postMessage({type:'beings:appearance',theme:'dark'},'beings://chat'); });
  await page.screenshot({animations:'disabled',path:'test-results/chat-sessions-panel-dark.png'});
  // One Being owns one live breath. Messages from other scenes queue locally
  // in FIFO order, then dispatch after the active stream finishes.
  await page.getByRole('button',{name:'切换到场景：桌面·测试设备'}).click();
  await chat.locator('#input').fill('并发 A');
  await chat.locator('#send-btn').click();
  const emit = async (scene, text, close = false) => application.evaluate((_, {scene,text,close}) => {
    const stream = globalThis.fixture.streams.get(scene);
    assertStream(stream);
    stream.enqueue(new TextEncoder().encode('event: content_block_delta\ndata: '+JSON.stringify({scene_id:scene,delta:{text}})+'\n\n'));
    if (close) {
      stream.enqueue(new TextEncoder().encode('event: message_stop\ndata: '+JSON.stringify({scene_id:scene})+'\n\n'));
      stream.close();
    }
    function assertStream(value) { if (!value) throw new Error('Missing stream for '+scene); }
  }, {scene,text,close});
  await page.waitForFunction(() => document.querySelector('#chat-scene-indicator')?.textContent.includes('桌面·测试设备'));
  // Wait on the main-process fixture, rather than assuming click completion means POST completion.
  for (let i=0; !(await application.evaluate((_,id) => globalThis.fixture.streams.has(id),original)); i++) {
    assert.ok(i < 100, 'A stream must open'); await new Promise(resolve => setTimeout(resolve,20));
  }
  await emit(original,'A1');
  await chat.getByText('A1',{exact:true}).waitFor();
  await page.locator(`[data-scene-id="${original}"] [data-status="replying"]`).waitFor();
  await page.getByRole('button',{name:'切换到场景：技术方案'}).click();
  await chat.locator('#input').fill('并发 B');
  await chat.locator('#send-btn').click();
  await page.locator(`[data-scene-id="${discussion}"] [data-status="queued"]`).waitFor();
  assert.equal(await application.evaluate((_,id) => globalThis.fixture.streams.has(id),discussion),false,'B must wait for A');
  await page.locator(`[data-scene-id="${original}"] [data-status="replying"]`).waitFor();
  await page.getByRole('button',{name:'新建场景',exact:true}).click();
  await page.getByRole('textbox',{name:'场景名称'}).fill('排队测试');
  await page.getByRole('button',{name:'创建并进入'}).click();
  await page.locator('#chat-session-editor').waitFor({state:'hidden'});
  await chat.locator('#input').fill('排队 C');
  await chat.locator('#send-btn').click();
  const queuedScene = await page.evaluate(async () => (await window.beings.snapshot()).chatScene.scene_id);
  const localQueueStatus = chat.locator('.local-queue-status').filter({hasText:'排队中 · 等待其他场景完成，尚未发送'});
  await localQueueStatus.waitFor();
  await page.locator(`[data-scene-id="${queuedScene}"] [data-status="queued"]`).waitFor();
  await page.screenshot({animations:'disabled',path:'test-results/chat-sessions-activity.png'});
  assert.equal(await chat.getByText('已结束',{exact:true}).count(),0);
  await emit(original,'A2',true);
  let bOpened = false;
  for (let i=0; !(bOpened = await application.evaluate((_,id) => globalThis.fixture.streams.has(id),discussion)) && i < 300; i++)
    await new Promise(resolve => setTimeout(resolve,20));
  if (!bOpened) {
    const activity = await page.locator('.chat-session-list [data-scene-id]').evaluateAll(nodes => nodes.map(node => ({scene:node.getAttribute('data-scene-id'),status:node.querySelector('[data-status]')?.getAttribute('data-status')})));
    const requests = await application.evaluate(() => globalThis.fixture.requests);
    assert.fail(`B stream must open after A finishes: ${JSON.stringify({activity,requests})}`);
  }
  await page.locator(`[data-scene-id="${discussion}"] [data-status="thinking"]`).waitFor();
  await emit(discussion,'B1');
  assert.equal(await chat.getByText('B1',{exact:true}).count(),0,'Queued scene output stays out of the selected C scene');
  await page.getByRole('button',{name:'切换到场景：桌面·测试设备'}).click();
  await chat.getByText('A1A2',{exact:true}).waitFor();
  await page.getByRole('button',{name:'切换到场景：技术方案'}).click();
  await chat.getByText('B1',{exact:true}).waitFor();
  await page.getByRole('button',{name:'切换到场景：排队测试'}).click();
  await emit(discussion,'B2',true);
  for (let i=0; !(await application.evaluate((_,id) => globalThis.fixture.requests.some(request => request.scene_id === id),queuedScene)); i++) {
    assert.ok(i < 300, 'C must dispatch after B finishes'); await new Promise(resolve => setTimeout(resolve,20));
  }
  await page.locator(`[data-scene-id="${discussion}"] [data-status="done"]`).waitFor();
  await chat.getByText('已排队，等待回复',{exact:true}).waitFor();
  await page.locator(`[data-scene-id="${queuedScene}"] [data-status="waiting"]`).waitFor();
  await application.evaluate((_,sceneId) => {
    const history = globalThis.fixture.history;
    history.push({seq:history.length+1,role:'being',content:'C 排队回复完成',scene_id:sceneId,at:new Date().toISOString()});
  },queuedScene);
  await chat.getByText('C 排队回复完成',{exact:true}).waitFor();
  await chat.getByText('已回复',{exact:true}).waitFor();
  assert.equal(await page.locator(`[data-scene-id="${queuedScene}"] [data-status="done"]`).count(),0);
  await page.getByRole('button',{name:'切换到场景：技术方案'}).click();
  await page.locator(`[data-scene-id="${discussion}"] [data-status="done"]`).waitFor({state:'hidden'});
  await page.getByRole('button',{name:'切换到场景：排队测试'}).click();
  await page.getByRole('button',{name:'切换到场景：排队测试'}).click({button:'right'});
  await page.getByRole('menuitem',{name:'删除场景'}).click();
  await page.locator('#chat-session-delete').getByRole('button',{name:'确认删除'}).click();
  await page.locator('#chat-session-delete').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'切换到场景：桌面·测试设备'}).click();
  await chat.getByText('A1A2',{exact:true}).waitFor();
  await page.getByRole('button',{name:'切换到场景：技术方案'}).click();
  await chat.getByText('B1B2',{exact:true}).waitFor();
  await page.reload();
  await chat.getByText('回复：方案内容',{exact:true}).waitFor();
  assert.equal(await page.evaluate(async () => (await window.beings.snapshot()).chatScene.scene_id),discussion);
  // Right-click an inactive scene: rename and delete must not select it.
  await page.getByRole('button',{name:'切换到场景：桌面·测试设备'}).click({button:'right'});
  await page.getByRole('menu',{name:'场景操作'}).waitFor();
  assert.equal(await page.getByRole('menu',{name:'编辑菜单'}).count(),0,'Session context menu must suppress the global edit menu');
  await page.getByRole('menuitem',{name:'重命名',exact:true}).click();
  await page.getByRole('textbox',{name:'场景名称'}).fill('旧会话');
  await page.getByRole('button',{name:'保存名称'}).click();
  await page.locator('#chat-session-editor').waitFor({state:'hidden'});
  assert.equal(await page.evaluate(async () => (await window.beings.snapshot()).chatScene.scene_id),discussion);
  const oldScene = page.getByRole('button',{name:'切换到场景：旧会话'});
  await oldScene.click({button:'right'});
  await page.screenshot({animations:'disabled',path:'test-results/chat-session-context-menu.png'});
  await page.getByRole('menuitem',{name:'删除场景'}).click();
  await page.screenshot({animations:'disabled',path:'test-results/chat-session-delete-confirm.png'});
  assert.equal((await page.evaluate(() => window.beings.snapshot())).chatSessions.length,2);
  await page.locator('#chat-session-delete').getByRole('button',{name:'取消',exact:true}).click();
  assert.equal(await oldScene.count(),1);
  await oldScene.click({button:'right'});
  await page.getByRole('menuitem',{name:'删除场景'}).click();
  await page.locator('#chat-session-delete').getByRole('button',{name:'确认删除'}).click();
  await page.locator('#chat-session-delete').waitFor({state:'hidden'});
  assert.equal(await oldScene.count(),0);
  assert.equal(await page.evaluate(async () => (await window.beings.snapshot()).chatScene.scene_id),discussion);
  await page.getByRole('button',{name:'切换到场景：技术方案'}).click({button:'right'});
  await page.getByRole('menuitem',{name:'删除场景'}).click();
  await page.locator('#chat-session-delete').getByRole('button',{name:'确认删除'}).click();
  await page.locator('#chat-session-delete').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'切换到场景：新场景'}).waitFor();
  const replacement = await page.evaluate(async () => (await window.beings.snapshot()).chatScene.scene_id);
  assert.notEqual(replacement,discussion);
  await page.reload();
  await page.getByRole('button',{name:'切换到场景：新场景'}).waitFor();
  assert.equal(await page.evaluate(async () => (await window.beings.snapshot()).chatScene.scene_id),replacement);
  await page.getByRole('button',{name:'全部场景',exact:true}).click();
  await chat.locator('#input:disabled').waitFor();
  await chat.getByRole('button',{name:'新建场景',exact:true}).click();
  await page.getByRole('textbox',{name:'场景名称'}).fill('快捷新会话');
  await page.getByRole('button',{name:'创建并进入'}).click();
  await page.locator('#chat-session-editor').waitFor({state:'hidden'});
  await chat.locator('#input:not(:disabled)').waitFor();
  const quick = await page.evaluate(() => window.beings.snapshot());
  assert.equal(quick.chatScene.scene_meta.scene_label,'快捷新会话');
  assert.notEqual(quick.chatScene.scene_id,replacement);
  assert.equal(await chat.locator('.all-scenes-notice').count(),0);
  await page.getByRole('button',{name:'绑定已有场景',exact:true}).click();
  await page.screenshot({animations:'disabled',path:'test-results/chat-bind-dialog.png'});
  await page.getByRole('textbox',{name:'场景 ID',exact:true}).fill('feishu-shared');
  await page.getByRole('textbox',{name:'场景名称'}).fill('跨客户端场景');
  await page.getByRole('button',{name:'绑定并进入'}).click();
  await page.locator('#chat-session-editor').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'切换到场景：跨客户端场景'}).waitFor();
  assert.equal((await page.evaluate(() => window.beings.snapshot())).chatScene.scene_id,'feishu-shared');
  await chat.locator('#input').fill('Bound scene message');
  await chat.locator('#send-btn').click();
  await chat.locator('.message.user').filter({hasText:'Bound scene message'}).waitFor();
  assert.equal((await application.evaluate(() => globalThis.fixture.requests)).at(-1).scene_id,'feishu-shared');
  await page.reload();
  await page.getByRole('button',{name:'切换到场景：跨客户端场景'}).waitFor();
  assert.equal((await page.evaluate(() => window.beings.snapshot())).chatScene.scene_id,'feishu-shared');
  // Scheduling is inspectable process metadata, never inline conversation prose.
  const wire = '独立问题\n\n[Desktop 场景调度提示]\n当前输入属于 scene_id="feishu-shared"。本客户端其他场景尚在处理或等待回复：\n[{"scene_id":"background-a"}]\n[/Desktop 场景调度提示]';
  await chat.locator('#input').fill(wire);
  await chat.locator('#send-btn').click();
  await chat.locator('.run-activity .scene-scheduling').waitFor({state:'attached'});
  const visibleQuestion = chat.locator('.message.user').filter({hasText:'独立问题'});
  assert.equal(await visibleQuestion.locator('.content').innerText(), '独立问题');
  assert.equal(await visibleQuestion.locator('.scene-scheduling').count(), 0);
  const schedulingRun = chat.locator('.run-activity').filter({has:chat.locator('.scene-scheduling pre')});
  assert.equal(await schedulingRun.getAttribute('open'), null);
  await schedulingRun.locator('summary').click();
  assert.match(await schedulingRun.locator('.scene-scheduling pre').innerText(), /background-a/);
  const pushTasks = async status => page.evaluate(async status => {
    const frame = document.querySelector('iframe');
    const snapshot = await window.beings.snapshot();
    frame.contentWindow.postMessage({type:'beings:scene-tasks', revision:new URL(frame.src).searchParams.get('revision'), endpoint:snapshot.settings.endpoint,
      subagentReady:true, tasks:[{id:'sub-fixture',sceneId:'feishu-shared',status,createdAt:Date.now()+1000,endedAt:status==='done'?Date.now()+2000:undefined,error:status==='failed'?'模型鉴权失败，请检查 subagent 密钥':undefined}]},'beings://chat');
  },status);
  await pushTasks('running');
  await page.getByRole('button',{name:'切换到场景：跨客户端场景'}).getByText('执行中').waitFor();
  if (await schedulingRun.getAttribute('open') === null) await schedulingRun.locator('summary').click();
  await chat.locator('.scene-task-list').getByText('后台执行中',{exact:true}).waitFor();
  await page.screenshot({animations:'disabled',path:'test-results/scene-scheduling-running.png'});
  await pushTasks('done');
  await schedulingRun.getByText('后台已完成，尚未收到回复',{exact:true}).waitFor();
  assert.equal((await schedulingRun.getAttribute('class')).includes('running'),false);
  assert.equal(await schedulingRun.locator('.run-elapsed').isVisible(),false);
  await page.screenshot({animations:'disabled',path:'test-results/scene-scheduling-awaiting-reply.png'});
  await pushTasks('failed');
  await chat.locator('.scene-task-error').waitFor({state:'attached'});
  if (await schedulingRun.getAttribute('open') === null) await schedulingRun.locator('summary').click();
  await chat.locator('.scene-task-list').getByText('模型鉴权失败，请检查 subagent 密钥',{exact:true}).waitFor();
  await page.screenshot({animations:'disabled',path:'test-results/scene-scheduling-failed.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS: same Being, create/switch/rename scenes through the actual UI, isolated history, per-scene drafts, send identity, persistent left panel, collapse/reopen, FIFO scene queue, context-menu rename, confirmed deletion, last-scene replacement and reload.');
} finally { await application?.close(); await rm(directory,{recursive:true,force:true}); }
