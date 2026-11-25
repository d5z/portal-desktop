import assert from 'node:assert/strict';
import { build } from '../scripts/renderer-build.mjs';
import { browserAssets } from './support/browser-assets.mjs';
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';
import { waitForChatReady } from './support/desktop.mjs';

const directory = await mkdtemp(path.join(os.tmpdir(), 'portal-chat-sessions-'));
let application;
try {
  for (const file of ['loom.html', 'chat.js', 'chat.css', 'highlight.css']) await copyFile(path.resolve('desktop/generated', file), path.join(directory, file));
  await writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="shell.css"></head><body><div id="root"></div><script src="shell.js"></script></body></html>');
  await build({ plugins: [browserAssets()], stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
    import React, {useRef, useEffect, useSyncExternalStore} from 'react';
    import {createRoot} from 'react-dom/client';
    import {AppModel} from './desktop/renderer/app/models/app';
    import {EditContextMenu} from './desktop/renderer/shared/components/context-menu';
    import {ChatSceneIndicator} from './desktop/renderer/app/components/chat-scene';
    import {SbsControl} from './desktop/renderer/shared/components/sbs-control';
    import {useChatBridge} from './desktop/renderer/app/hooks/use-chat-bridge';
    import './desktop/renderer/app/styles.scss';
    const app = new AppModel(window.beings); app.showReasoning = true; (window as any).fixtureApp = app;
    function Shell() {
      useSyncExternalStore(app.subscribe, app.getVersion);
      const frame = useRef(null); useChatBridge(app, frame);
      useEffect(() => { window.beings.snapshot().then(value => app.applySnapshot(value)); }, []);
      return <div id="client-main" className="workspace-stage" style={{height:'100vh',width:'100%'}}><header className="topbar">
        <ChatSceneIndicator scene={app.snapshot?.chatScene} sessions={app.snapshot?.chatSessions} connected={true}
          createRequest={app.chatSessionCreateRequest}
          activity={app.chatSceneActivity}
          scope={app.chatHistoryScope} scopeReady={!app.chatLoading && app.chatHistoryScopeKnown}
          onScope={scope => app.changeChatHistoryScope(scope)} onCopy={id => { (window as any).copiedSceneId = id; }}
          onSession={(operation,value,sceneId) => app.changeChatSession(operation,value,sceneId)} />
        <SbsControl known={app.sbsKnown} enabled={app.sbsEnabled} origin={app.chatSbsOrigin}
          showContent={app.chatShowSbsMessages} allScenes={app.chatHistoryScope==='all'}
          visibilityReady={!app.chatLoading && app.chatSbsSceneId===app.snapshot?.chatScene?.scene_id}
          onVisibility={show=>app.changeChatSbsVisibility(show)} onToggle={()=>app.toggleSbs()} />
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
      sceneTasks: () => Promise.resolve({endpoint:'https://fixture.test/being',tasks:[],subagentReady:false,subagentConfigured:false,subagentEnabled:false}),
      changeChatSession: (operation,value,endpoint,sceneId) => ipcRenderer.invoke('session',operation,value,endpoint,sceneId),
    });
  ` }, bundle: true, platform: 'node', external: ['electron'], outfile: path.join(directory, 'preload.cjs') });
  await build({ stdin: { loader: 'ts', resolveDir: process.cwd(), contents: `
    import {app, protocol, BrowserWindow, ipcMain} from 'electron';
    import {ChatSessions, loadDesktopScene} from './desktop/main/chat/scene';
    import {ChatProxy} from './desktop/main/chat/proxy';
    import {registerLocalProtocol, configureLocalSession} from './desktop/main/app/protocol';
    import {WorkNetwork} from './desktop/main/portal/work-network';
    app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
    protocol.registerSchemesAsPrivileged([{scheme:'beings',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
    app.whenReady().then(async () => {
      const original = await loadDesktopScene(${JSON.stringify(directory)}, 'test', '测试设备');
      const sessions = new ChatSessions(${JSON.stringify(directory)}, original); await sessions.load();
      const connection = {endpoint:'https://fixture.test/being',being:'being',token:'fixture',relaySecret:'fixture',link:''};
      const requests = [], history = [{seq:1,role:"being",content:"SBS 全局测试消息"}]; globalThis.fixture = {requests, history, streams: new Map()};
      const proxy = new ChatProxy(() => connection, async (url, init) => {
        const route = new URL(url).pathname;
        if (route.endsWith('/api/history')) return Response.json({messages:history});
        if (route.endsWith('/api/stream/active')) return new Response(null,{status:204});
        if (route.endsWith('/api/chat/stream')) {
          const body = JSON.parse(init.body); requests.push(body);
          const content = body.message.replace(/^【新消息来自 scene「[^」\\r\\n]{1,256}」】\\r?\\n\\r?\\n/, '');
          if (content.startsWith('并发')) {
            return new Response(new ReadableStream({start(controller) {
              globalThis.fixture.streams.set(body.scene_id, controller);
            }}), {headers:{'content-type':'text/event-stream'}});
          }
          if (content.startsWith('排队')) return Response.json({queued:true},{status:202});
          const row = {seq:history.length+1,role:'user',content,scene_id:body.scene_id,at:new Date().toISOString()}; history.push(row);
          history.push({...row,seq:history.length+1,role:'being',content:'回复：'+content});
          return new Response('event: content_block_delta\\ndata: '+JSON.stringify({scene_id:body.scene_id,delta:{text:'回复：'+content}})+'\\n\\nevent: message_stop\\ndata: '+JSON.stringify({scene_id:body.scene_id})+'\\n\\n', {headers:{'content-type':'text/event-stream'}});
        }
        if (route.endsWith('/health')) return new Response('OK');
        return Response.json({sbs_enabled:false,being_name:'同一个 Being'});
      }, () => sessions.current(connection.endpoint), id => sessions.list(connection.endpoint).find(scene => scene.scene_id === id));
      const work = new WorkNetwork(() => 'beings://desktop/', () => ({directory:${JSON.stringify(directory)},endpoint:connection.endpoint}));
      globalThis.fixture.work = work;
      registerLocalProtocol(${JSON.stringify(directory)},proxy,undefined,undefined,undefined,undefined,undefined,undefined,undefined,work);
      configureLocalSession();
      const snapshot = () => ({settings:{endpoint:connection.endpoint,being:'being',hasToken:true},portal:{phase:'stopped',logs:[]},chatScene:sessions.current(connection.endpoint),chatSessions:sessions.list(connection.endpoint)});
      ipcMain.handle('snapshot',snapshot);
      ipcMain.handle('session',async (_,operation,value,endpoint,sceneId) => { if(endpoint !== connection.endpoint) throw new Error('Wrong Being'); await sessions.change(endpoint,operation,value,sceneId); return snapshot(); });
      const window = new BrowserWindow({width:1100,height:800,show:true,webPreferences:{preload:${JSON.stringify(path.join(directory,'preload.cjs'))},sandbox:true,contextIsolation:true,nodeIntegration:false}});
      await window.loadURL('beings://desktop/');
    });
  ` }, bundle: true, platform: 'node', external: ['electron'], outfile: path.join(directory, 'main.cjs') });
  application = await electron.launch({ args: [path.join(directory,'main.cjs')], env: {...process.env} });
  const page = await application.firstWindow();
  // Keep animated menu bounds out of the native pointer-readiness checks.
  await page.emulateMedia({reducedMotion:'reduce'});
  page.setDefaultTimeout(15000);
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  const chat = page.frameLocator('iframe');
  await waitForChatReady(page);
  await page.waitForFunction(() => !window.fixtureApp.chatLoading);
  await page.evaluate(async () => {
    const frame = document.querySelector('iframe');
    const snapshot = await window.beings.snapshot();
    frame.contentWindow.postMessage({type:'beings:scene-tasks',revision:new URL(frame.src).searchParams.get('revision'),endpoint:snapshot.settings.endpoint,
      tasks:[],subagentReady:false,subagentConfigured:false,subagentEnabled:false},'beings://chat');
  });
  // Subagent uses the Being model; stale setup flags must not block either picker.
  const subagentSetup = chat.getByRole('menuitem',{name:/Subagent/});
  const commandInput = chat.getByRole('textbox',{name:'消息输入框'});
  await commandInput.fill('保留已有要求');
  await chat.getByRole('button',{name:'添加附件和工具'}).click();
  await subagentSetup.click();
  assert.equal(await commandInput.evaluate(el => el.value ?? el.editor.getMarkdown()),'/subagent 保留已有要求');
  assert.equal(await page.evaluate(() => window.fixtureApp.subagentSettingsOpen),false);
  await commandInput.press('ControlOrMeta+a');
  await commandInput.press('Backspace');
  await commandInput.fill('/sub');
  await commandInput.press('Tab');
  assert.equal((await commandInput.evaluate(el => el.value ?? el.editor.getMarkdown())).trim(),'/subagent');
  await commandInput.fill('');
  const original = await page.evaluate(async () => (await window.beings.snapshot()).chatScene.scene_id);
  await chat.locator('#input').fill('原会话草稿');
  await page.getByRole('button',{name:'展开场景列表',exact:true}).click();
  const sbsVisibility = page.locator('[role="dialog"][aria-labelledby][data-open="true"] input').first();
  const visibilityState = async (method) => {
    if (!await sbsVisibility.isVisible()) await page.getByLabel('SBS 状态与显示设置',{exact:true}).click();
    const result = await sbsVisibility[method]();
    await page.keyboard.press('Escape');
    return result;
  };
  await page.getByLabel('SBS 状态与显示设置',{exact:true}).click();
  await page.waitForFunction(() => document.querySelector('input[type="checkbox"]') && window.fixtureApp.chatSbsSceneId === window.fixtureApp.snapshot.chatScene.scene_id);
  assert.equal(await visibilityState('isChecked'),false);
  assert.equal(await chat.getByText('SBS 全局测试消息',{exact:true}).count(),0);
  if (!await sbsVisibility.isVisible()) await page.getByLabel('SBS 状态与显示设置',{exact:true}).click();
  await sbsVisibility.check();
  await page.keyboard.press('Escape');
  await chat.getByText('SBS 全局测试消息',{exact:true}).waitFor();
  await page.getByRole('searchbox',{name:'搜索场景'}).fill('不存在的对话');
  await page.getByRole('status').getByText('没有找到匹配的对话').waitFor();
  assert.equal(await page.locator('.chat-session-list [data-scene-id]').count(),0);
  await page.getByRole('searchbox',{name:'搜索场景'}).fill('');
  await page.getByRole('button',{name:'新建场景',exact:true}).click();
  await page.getByRole('textbox',{name:'场景名称'}).fill('方案讨论');
  await page.getByRole('button',{name:'创建并进入'}).click();
  await page.locator('#chat-session-editor').waitFor({state:'hidden'});
  await page.waitForFunction(async () => (await window.beings.snapshot()).chatSessions.length === 2);
  const discussion = await page.evaluate(async () => (await window.beings.snapshot()).chatScene.scene_id);
  assert.notEqual(discussion,original);
  await page.getByLabel('场景列表选项',{exact:true}).click();
  await page.getByRole('button',{name:'场景详情',exact:true}).click();
  const currentDetails = page.getByRole('dialog',{name:'当前场景',exact:true});
  await currentDetails.getByText(discussion,{exact:true}).waitFor();
  await currentDetails.getByRole('button',{name:'关闭场景详情'}).click();
  const originalRow = page.getByRole('button',{name:'切换到场景：桌面·测试设备'});
  await originalRow.click({button:'right'});
  await page.getByRole('menuitem',{name:'场景详情',exact:true}).and(page.locator(':focus')).waitFor();
  await page.keyboard.press('Enter');
  const rowDetails = page.getByRole('dialog',{name:'场景详情',exact:true});
  await rowDetails.getByText('桌面·测试设备',{exact:true}).waitFor();
  await rowDetails.getByText(original,{exact:true}).waitFor();
  await rowDetails.getByText('portal-desktop/test',{exact:true}).waitFor();
  await rowDetails.getByRole('button',{name:'复制场景 ID'}).click();
  assert.equal(await page.evaluate(() => window.copiedSceneId),original);
  assert.equal(await page.evaluate(async () => (await window.beings.snapshot()).chatScene.scene_id),discussion);
  await page.keyboard.press('Escape');
  await rowDetails.waitFor({state:'hidden'});
  await originalRow.and(page.locator(':focus')).waitFor();
  await chat.locator('#input').fill('方案内容');
  await chat.locator('#send-btn').click();
  await chat.getByText('回复：方案内容',{exact:true}).waitFor();
  assert.equal(await visibilityState('isChecked'),false);
  assert.equal(await chat.getByText('SBS 全局测试消息',{exact:true}).count(),0);
  await chat.locator('#input').fill('方案草稿');
  await page.getByRole('button',{name:'切换到场景：桌面·测试设备'}).click();
  await chat.locator('#input').waitFor();
  await page.waitForFunction(() => document.querySelector('#chat-scene-indicator')?.title.includes('桌面·测试设备'));
  assert.equal(await chat.locator('#input').evaluate(el => el.value ?? el.editor.getMarkdown()),'原会话草稿');
  await chat.getByText('SBS 全局测试消息',{exact:true}).waitFor();
  assert.equal(await visibilityState('isChecked'),true);
  assert.equal(await chat.getByText('回复：方案内容',{exact:true}).count(),0);
  await page.getByRole('button',{name:'切换到场景：方案讨论'}).click();
  await chat.getByText('回复：方案内容',{exact:true}).waitFor();
  assert.equal(await chat.locator('#input').evaluate(el => el.value ?? el.editor.getMarkdown()),'方案草稿');
  await page.getByRole('button',{name:'切换到场景：方案讨论'}).click({button:'right'});
  await page.getByRole('menuitem',{name:'重命名',exact:true}).click();
  const renameInput = page.getByRole('navigation',{name:'切换场景'}).getByRole('textbox',{name:'场景名称'});
  await renameInput.waitFor();
  assert.equal(await page.locator('#chat-session-editor').isVisible(),false);
  assert.equal(await renameInput.evaluate(input => input === document.activeElement && input.selectionStart === 0 && input.selectionEnd === input.value.length),true);
  await renameInput.fill('取消这次改名');
  await renameInput.press('Escape');
  const discussionRow = page.getByRole('button',{name:'切换到场景：方案讨论'});
  await discussionRow.waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '切换到场景：方案讨论');
  await discussionRow.click({button:'right'});
  await page.getByRole('menuitem',{name:'重命名',exact:true}).click();
  await renameInput.fill('技术方案');
  await renameInput.press('Enter');
  await renameInput.waitFor({state:'hidden'});
  const persisted = await page.evaluate(() => window.beings.snapshot());
  assert.equal(persisted.chatScene.scene_id,discussion);
  assert.equal(persisted.chatScene.scene_meta.scene_label,'技术方案');
  const selectedItemBox = await page.getByRole('button',{name:'切换到场景：技术方案'}).boundingBox();
  const composerBeforeAll = await chat.locator('#input-area').boundingBox();
  await page.getByRole('checkbox',{name:'显示全部场景上下文',exact:true}).check();
  await chat.locator('#input:not(:disabled)').waitFor();
  await chat.getByText('SBS 全局测试消息',{exact:true}).waitFor();
  assert.equal(await visibilityState('isChecked'),true);
  assert.equal(await visibilityState('isDisabled'),true);
  assert.equal(await chat.locator('#send-btn').isDisabled(),false);
  const unselectedItemBox = await page.getByRole('button',{name:'切换到场景：技术方案'}).boundingBox();
  assert.equal(selectedItemBox.height,44);
  assert.equal(unselectedItemBox.height,selectedItemBox.height,'Selecting a session must not change its row height');
  const composerInAll = await chat.locator('#input-area').boundingBox();
  assert.ok(Math.abs(composerInAll.height - composerBeforeAll.height) < 1, 'Switching to all scenes must preserve composer height');
  assert.equal(await page.locator('.chat-session-list [data-scene-id][aria-current="true"]').count(),1);
  assert.equal(await page.evaluate(async () => (await window.beings.snapshot()).chatScene.scene_id),discussion);
  await chat.locator('.message-scene').filter({hasText:'技术方案'}).first().waitFor();
  await page.getByRole('button',{name:'切换到场景：技术方案'}).click();
  await chat.locator('#input:not(:disabled)').waitFor();
  assert.equal(await chat.locator('#input').evaluate(el => el.value ?? el.editor.getMarkdown()),'方案草稿');
  assert.equal(await page.getByRole('checkbox',{name:'显示全部场景上下文',exact:true}).isChecked(),true, 'Selecting the same scene retains its saved history scope');
  await page.getByRole('checkbox',{name:'显示全部场景上下文',exact:true}).uncheck();
  await chat.getByText('SBS 全局测试消息',{exact:true}).waitFor({state:'hidden'});
  assert.equal(await visibilityState('isChecked'),false, 'All-scenes view must preserve the scene preference');
  assert.equal((await application.evaluate(() => globalThis.fixture.requests))[0].scene_id,discussion);
  await mkdir('test-results',{recursive:true});
  const panel = page.getByRole('complementary',{name:'场景列表'});
  assert.equal(await panel.isVisible(),true);
  const panelBox = await panel.boundingBox(), chatBox = await page.locator('#chat-view').boundingBox();
  assert.ok(panelBox.x >= chatBox.x && panelBox.x + panelBox.width <= chatBox.x + chatBox.width, 'Scene picker must stay within the conversation width');
  assert.ok(panelBox.y < chatBox.y + 20, 'Scene picker must open at the top of the conversation');
  await chat.locator('#input').click();
  assert.equal(await panel.isVisible(),true, 'Typing must not dismiss session navigation');
  await page.screenshot({animations:'disabled',path:'test-results/chat-sessions-panel.png'});
  await page.getByLabel('场景列表选项',{exact:true}).click();
  await page.getByRole('button',{name:'关闭场景列表',exact:true}).click();
  await panel.waitFor({state:'hidden'});
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
  await page.waitForFunction(scene => !window.fixtureApp.chatLoading && window.fixtureApp.snapshot.chatScene.scene_id === scene, original);
  await chat.locator('#input').fill('并发 A');
  await chat.locator('#send-btn').click();
  await chat.locator('.message.user').getByText('并发 A',{exact:true}).waitFor();
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
  await page.waitForFunction(() => document.querySelector('#chat-scene-indicator')?.title.includes('桌面·测试设备'));
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
  const localQueueStatus = chat.locator('.composer-queue-item').filter({hasText:'排队 C'});
  await localQueueStatus.waitFor();
  await localQueueStatus.getByRole('button',{name:'编辑消息：排队 C',exact:true}).and(chat.locator(':enabled')).waitFor();
  assert.equal(await localQueueStatus.getByRole('button',{name:'引导',exact:true}).count(),0,'Cannot steer another scene');
  assert.ok(await localQueueStatus.getByRole('button',{name:'编辑消息：排队 C',exact:true}).isEnabled());
  assert.ok(await localQueueStatus.getByRole('button',{name:'取消排队：排队 C',exact:true}).isEnabled());
  assert.equal(await chat.locator('#messages .message.user').filter({hasText:'排队 C'}).count(),0,'Unsent queue stays beside the composer');
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
  await chat.getByText('消息已接收',{exact:true}).waitFor();
  await page.locator(`[data-scene-id="${queuedScene}"] [data-status="queued"]`).waitFor();
  await application.evaluate((_,sceneId) => {
    const history = globalThis.fixture.history;
    history.push({seq:history.length+1,role:'being',content:'C 排队回复完成',scene_id:sceneId,at:new Date().toISOString()});
  },queuedScene);
  await chat.getByText('C 排队回复完成',{exact:true}).waitFor();
  await chat.locator('.chat-run .run-label').filter({hasText:/^用时 /}).waitFor();
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
  await page.getByRole('button',{name:'收起场景列表',exact:true}).waitFor();
  // Right-click an inactive scene: rename and delete must not select it.
  await page.getByRole('button',{name:'切换到场景：桌面·测试设备'}).click({button:'right'});
  await page.getByRole('menu',{name:'场景操作'}).waitFor();
  assert.equal(await page.getByRole('menu',{name:'编辑菜单'}).count(),0,'Session context menu must suppress the global edit menu');
  await page.getByRole('menuitem',{name:'重命名',exact:true}).click();
  await renameInput.fill('旧会话');
  await page.getByRole('button',{name:'保存名称'}).click();
  await renameInput.waitFor({state:'hidden'});
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
  await waitForChatReady(page);
  await page.getByRole('button',{name:'收起场景列表',exact:true}).waitFor();
  await page.getByRole('button',{name:'切换到场景：新场景'}).waitFor();
  assert.equal(await page.evaluate(async () => (await window.beings.snapshot()).chatScene.scene_id),replacement);
  await page.getByRole('checkbox',{name:'显示全部场景上下文',exact:true}).check();
  await chat.locator('#input:not(:disabled)').waitFor();
  await page.locator('#new-chat-session').click();
  await page.getByRole('textbox',{name:'场景名称'}).fill('快捷新会话');
  await page.getByRole('button',{name:'创建并进入'}).click();
  await page.locator('#chat-session-editor').waitFor({state:'hidden'});
  await chat.locator('#input:not(:disabled)').waitFor();
  const quick = await page.evaluate(() => window.beings.snapshot());
  assert.equal(quick.chatScene.scene_meta.scene_label,'快捷新会话');
  assert.notEqual(quick.chatScene.scene_id,replacement);
  assert.equal(await chat.locator('.all-scenes-notice').count(),0);
  await page.getByLabel('场景列表选项',{exact:true}).click();
  await page.getByRole('button',{name:'绑定已有场景',exact:true}).click();
  await page.screenshot({animations:'disabled',path:'test-results/chat-bind-dialog.png'});
  await page.getByRole('textbox',{name:'场景 ID',exact:true}).fill('feishu-shared');
  await page.getByRole('textbox',{name:'场景名称'}).fill('跨客户端场景');
  await page.getByRole('button',{name:'绑定并进入'}).click();
  await page.locator('#chat-session-editor').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'切换到场景：跨客户端场景'}).waitFor();
  assert.equal((await page.evaluate(() => window.beings.snapshot())).chatScene.scene_id,'feishu-shared');
  await page.waitForFunction(() => !window.fixtureApp.chatLoading);
  await chat.locator('#input:not(:disabled)').waitFor();
  await chat.locator('#input').fill('Bound scene message');
  await chat.locator('#send-btn').click();
  await chat.locator('.message.user').filter({hasText:'Bound scene message'}).waitFor();
  assert.equal(await chat.locator('.message.user').filter({hasText:'Bound scene message'}).count(),1);
  assert.equal((await application.evaluate(() => globalThis.fixture.requests)).at(-1).scene_id,'feishu-shared');
  await page.reload();
  await waitForChatReady(page);
  await page.getByRole('button',{name:'收起场景列表',exact:true}).waitFor();
  await page.getByRole('button',{name:'切换到场景：跨客户端场景'}).waitFor();
  assert.equal((await page.evaluate(() => window.beings.snapshot())).chatScene.scene_id,'feishu-shared');
  await page.waitForFunction(() => !window.fixtureApp.chatLoading);
  await chat.locator('.message.user').filter({hasText:'Bound scene message'}).waitFor();
  // Scheduling is inspectable process metadata, never inline conversation prose.
  const wire = '独立问题\n\n[Desktop 场景调度提示]\n当前输入属于 scene_id="feishu-shared"。本客户端其他场景尚在处理或等待回复：\n[{"scene_id":"background-a"}]\n[/Desktop 场景调度提示]';
  // Preserve transport metadata verbatim instead of typing it through Markdown serialization.
  await chat.locator('#input').evaluate((el, text) => {
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
  }, wire);
  await chat.locator('#send-btn').click();
  const visibleQuestion = chat.locator('.message.user').filter({hasText:'独立问题'});
  await visibleQuestion.waitFor();
  assert.equal(await visibleQuestion.locator('.content').innerText(), '独立问题');
  assert.equal(await visibleQuestion.locator('.scene-scheduling').count(), 0);
  const schedulingRun = visibleQuestion.locator('xpath=following-sibling::div[@class="chat-run"][1]');
  await schedulingRun.locator('.run-summary').waitFor();
  assert.equal(await schedulingRun.locator('.scene-scheduling').count(), 0, 'Transport hints do not create process rows');
  const pushTasks = async (status, session) => page.evaluate(async ({status, session}) => {
    const frame = document.querySelector('iframe');
    const snapshot = await window.beings.snapshot();
    frame.contentWindow.postMessage({type:'beings:scene-tasks', revision:new URL(frame.src).searchParams.get('revision'), endpoint:snapshot.settings.endpoint,
      subagentReady:true, subagentConfigured:true, subagentEnabled:true, tasks:[{id:'sub-fixture',sceneId:'feishu-shared',...(session ? {session} : {}),status,createdAt:Date.now()+1000,endedAt:status==='done'?Date.now()+2000:undefined,error:status==='failed'?'模型鉴权失败，请检查 subagent 密钥':undefined}]},'beings://chat');
  },{status, session});
  await pushTasks('running');
  assert.equal(await chat.getByText('尚未配置 · 点击配置模型',{exact:true}).count(),0);
  const runningScene = page.getByRole('button',{name:'切换到场景：跨客户端场景'});
  await runningScene.locator('.chat-session-activity[data-status="working"]').waitFor();
  assert.equal(await runningScene.getAttribute('aria-description'),'执行中');
  await schedulingRun.locator(':scope > details > summary').click();
  await schedulingRun.locator('.run-subagent-status').getByText('1 项运行中',{exact:true}).waitFor();
  await page.screenshot({animations:'disabled',path:'test-results/scene-scheduling-running.png'});
  await pushTasks('done');
  await schedulingRun.locator('.run-subagent-status').getByText('全部完成',{exact:true}).waitFor();
  await runningScene.locator('.chat-session-activity[data-status="waiting"]').waitFor();
  assert.equal(await schedulingRun.locator('details.run-activity.running').count(),0,'Child tasks do not reopen a completed parent run');
  await page.screenshot({animations:'disabled',path:'test-results/scene-scheduling-awaiting-reply.png'});
  await pushTasks('failed');
  await schedulingRun.locator('.run-subagent-status').getByText('1 项失败',{exact:true}).waitFor();
  await runningScene.locator('.chat-session-activity[data-status="task-failed"]').waitFor();
  assert.equal(await schedulingRun.getByRole('button',{name:'查看子智能体执行详情'}).count(),1);
  await page.screenshot({animations:'disabled',path:'test-results/scene-scheduling-failed.png'});
  await pushTasks('running', 'work-6e1769d9-3a48-4b98-8c5d-87bc3e3fd279');
  await schedulingRun.locator('.run-subagent-status').getByText('1 项运行中',{exact:true}).waitFor();
  await runningScene.locator('.chat-session-activity').waitFor({state:'hidden'});
  await pushTasks('done', 'work-6e1769d9-3a48-4b98-8c5d-87bc3e3fd279');
  await schedulingRun.locator('.run-subagent-status').getByText('全部完成',{exact:true}).waitFor();
  assert.equal(await runningScene.locator('.chat-session-activity').count(),0);
  if (!await sbsVisibility.isVisible()) await page.getByLabel('SBS 状态与显示设置',{exact:true}).click();
  await sbsVisibility.check();
  await page.keyboard.press('Escape');
  await chat.getByText('SBS 全局测试消息',{exact:true}).waitFor();
  await page.evaluate(async () => window.fixtureApp.applySnapshot(await window.beings.snapshot(), true));
  await chat.getByText('SBS 全局测试消息',{exact:true}).waitFor();
  await page.waitForFunction(() => !window.fixtureApp.chatLoading && window.fixtureApp.chatSbsSceneId === window.fixtureApp.snapshot.chatScene.scene_id);
  assert.equal(await visibilityState('isChecked'),true, 'Scene SBS visibility survives a fresh chat frame');
  // Real sandboxed chat -> source/revision checked shell -> exact Work selection.
  const workIds = ['sub_894ccaa9-1d4e-4afe-a509-57d22523b7ff', 'agent_codex_01a207e5-52f1-7440-bc5c-b0b579e7620f', 'agent_deepseek_session-61285e6b-8b49-4306-9689-56c0b8ad59be'];
  const itemIds = ['work_6e1769d9-3a48-4b98-8c5d-87bc3e3fd279', 'work_41811c01-9e3b-4420-8a6e-c94dc08e9042'];
  const itemTitles = ['生成 [欢迎页] & 说明', '生成 HTML 使用指南'];
  await application.evaluate(async (_, { ids, items, titles }) => {
    await globalThis.fixture.work.items.update('https://fixture.test/being', data => {
      data.items.push(...items.map((id, index) => ({id, title:titles[index], stage:'todo', runIds:[]})));
    });
    const history = globalThis.fixture.history;
    history.push({seq:history.length+1,role:'being',scene_id:'feishu-shared',at:new Date().toISOString(),content:
      'Work 跳转验收\n\n' + ids.map((id,i)=>'[链接'+['内置','Codex','DeepSeek'][i]+'会话](beings://work/'+id+')').join('\n\n') +
      '\n\n行内 ID：`'+ids[1]+'`\n\n```json\n'+JSON.stringify({task_id:ids[2]})+'\n```\n\n' +
      items.map(id => '[Work 任务](beings://work/'+id+')').join('\n\n')});
  }, { ids: workIds, items: itemIds, titles: itemTitles });
  const requestCount = (await application.evaluate(() => globalThis.fixture.requests)).length;
  const titleReads = [];
  page.on('response', response => {
    if (response.url() === 'beings://desktop/api/work/items' && response.request().method() === 'GET') titleReads.push(response);
  });
  await page.evaluate(ids => {
    const app = window.fixtureApp;
    app.work.configure(app.snapshot.settings.endpoint);
    const snapshot = {endpoint:app.work.endpoint,tasks:ids.map((id,i)=>({id,sceneId:'feishu-shared',createdAt:i,status:'done',brief:'会话 '+i}))};
    app.work.snapshot = snapshot;
    app.work.request = async path => path ? {taskId:path.slice(1),steps:[{kind:'message',at:1,output:'独立历史 '+path.slice(1)}]} : snapshot;
    const revision = new URL(document.querySelector('iframe').src).searchParams.get('revision');
    app.post({type:'beings:chat-refresh',id:'work-link-fixture',revision});
  }, workIds);
  await chat.getByText('Work 跳转验收',{exact:true}).waitFor();
  for (const [index, title] of itemTitles.entries()) {
    await chat.getByRole('button',{name:title,exact:true}).click();
    await page.waitForFunction(id => window.fixtureApp.view==='work' && window.fixtureApp.work.itemId===id, itemIds[index]);
  }
  assert.equal(titleReads.length, 1);
  assert.equal(titleReads[0].status(), 200);
  assert.deepEqual((await titleReads[0].json()).map(({id,title}) => [id,title]), itemIds.map((id, i) => [id,itemTitles[i]]));
  await chat.getByRole('button',{name:'链接内置会话',exact:true}).click();
  await page.waitForFunction(id => window.fixtureApp.view==='work' && window.fixtureApp.work.selectedId===id && window.fixtureApp.work.details[0]?.taskId===id, workIds[0]);
  await chat.getByRole('button',{name:'链接Codex会话',exact:true}).click();
  await page.waitForFunction(id => window.fixtureApp.work.selectedId===id && window.fixtureApp.work.details[0]?.taskId===id, workIds[1]);
  await chat.getByRole('button',{name:'链接DeepSeek会话',exact:true}).click();
  await page.waitForFunction(id => window.fixtureApp.work.selectedId===id && window.fixtureApp.work.details[0]?.taskId===id, workIds[2]);
  await chat.getByRole('button',{name:'打开 Work 会话 '+workIds[1],exact:true}).click();
  await page.waitForFunction(id => window.fixtureApp.work.selectedId===id,workIds[1]);
  await chat.getByRole('button',{name:'打开 Work 会话 '+workIds[2],exact:true}).click();
  await page.waitForFunction(id => window.fixtureApp.work.selectedId===id,workIds[2]);
  await page.evaluate(id => {
    const revision = new URL(document.querySelector('iframe').src).searchParams.get('revision');
    // This event originates in the shell, not the chat frame, and must be ignored.
    window.postMessage({type:'beings:open-place',view:'work',id,revision},'*');
  },workIds[0]);
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(()=>window.fixtureApp.work.selectedId),workIds[2]);
  assert.equal((await application.evaluate(() => globalThis.fixture.requests)).length,requestCount,'Opening Work references must not send messages or dispatch tasks');
  const arrangeText = `请为 [@${itemTitles[0]}](beings://work/${itemIds[0]}#run=after-fixture-run) 安排下一轮执行。`;
  const compose = chat.locator('#input');
  await compose.fill('一起看看 @' + itemTitles[0].slice(0, 3));
  const mentionOption = chat.getByRole('listbox',{name:'Work 任务',exact:true}).getByRole('option',{name:itemTitles[0],exact:true});
  await mentionOption.waitFor();
  await mentionOption.click();
  const workMention = compose.locator('[data-work-mention="true"]');
  await workMention.getByText('@'+itemTitles[0],{exact:true}).waitFor();
  assert((await compose.evaluate(el => el.editor.getMarkdown())).includes(`beings://work/${itemIds[0]}#read`));
  assert.equal((await application.evaluate(() => globalThis.fixture.requests)).length,requestCount);
  await compose.press('End');
  await compose.press('Backspace');
  if (await workMention.count()) await compose.press('Backspace');
  await workMention.waitFor({state:'detached'});
  await compose.fill('已有的对话草稿');
  const draftScene = await page.evaluate(() => {
    const { chatScene, chatSessions } = window.fixtureApp.snapshot;
    return { current: chatScene.scene_id, first: chatSessions[0].scene_id };
  });
  assert.notEqual(draftScene.current,draftScene.first);
  await page.evaluate(text => window.fixtureApp.draftWorkMessage(text), arrangeText);
  await workMention.getByText('@'+itemTitles[0],{exact:true}).waitFor();
  assert.equal(await page.evaluate(() => window.fixtureApp.snapshot.chatScene.scene_id),draftScene.current);
  const combinedDraft = await compose.evaluate(el => el.value ?? el.editor.getMarkdown());
  assert(combinedDraft.startsWith('已有的对话草稿\n\n请为 '));
  assert(combinedDraft.includes(`beings://work/${itemIds[0]}#run=after-fixture-run`));
  assert.equal((await compose.innerText()).replace(/\s+/g,' ').trim(),'已有的对话草稿 请为 @'+itemTitles[0]+' 安排下一轮执行。');
  await compose.screenshot({path:'test-results/work-mention-composer.png'});
  assert.equal((await application.evaluate(() => globalThis.fixture.requests)).length,requestCount);
  const scopedSend = page.waitForRequest(request => request.url().endsWith('/api/chat/stream') && request.postData()?.includes('#run=after-fixture-run'));
  await chat.locator('#send-btn').click();
  const dispatchChip = chat.locator('.message.user').getByRole('button',{name:'@'+itemTitles[0],exact:true});
  await dispatchChip.waitFor();
  const sentBubble = chat.locator('.message.user').filter({hasText:'已有的对话草稿'});
  assert(!(await sentBubble.innerText()).includes('@work run'));
  const scopedRequest = (await scopedSend).postDataJSON();
  assert(scopedRequest.message.includes(`@work run {"item_id":"${itemIds[0]}","request_id":"after-fixture-run"}`));
  assert(scopedRequest.message.includes(`@work status ${itemIds[0]}`));
  await dispatchChip.click();
  await page.waitForFunction(id => window.fixtureApp.view==='work' && window.fixtureApp.work.itemId===id, itemIds[0]);
  const resultScene = await page.evaluate(() => window.fixtureApp.snapshot.chatSessions.find(scene => scene.scene_id !== window.fixtureApp.snapshot.chatScene.scene_id).scene_id);
  const reviewText = `请按验收标准评估 [@${itemTitles[1]}](beings://work/${itemIds[1]}#stage=review) 的最新交付。`;
  await page.evaluate(([text,scene]) => window.fixtureApp.draftWorkMessage(text,scene), [reviewText,resultScene]);
  await workMention.getByText('@'+itemTitles[1],{exact:true}).waitFor();
  assert(!(await compose.innerText()).includes('@work'));
  assert.equal((await application.evaluate(() => globalThis.fixture.requests.filter(row=>row.message.includes('#stage=review')))).length,0);
  const reviewSend = page.waitForResponse(response => response.url().endsWith('/api/chat/stream') && response.request().postData()?.includes('#stage=review'));
  await chat.locator('#send-btn').click();
  const reviewResponse=await reviewSend;
  assert.equal(reviewResponse.status(),200);
  const reviewRequest=reviewResponse.request().postDataJSON();
  const routedReviews=await application.evaluate(() => globalThis.fixture.requests.filter(row=>row.message.includes('#stage=review')));
  assert.equal(routedReviews.length,1);
  assert.equal(routedReviews[0].scene_id,resultScene);
  assert(reviewRequest.message.includes(`@work results ${itemIds[1]}`));
  assert(reviewRequest.message.includes('只做评估'));
  assert(!reviewRequest.message.includes('@work run '));
  assert.deepEqual(errors,[]);
  console.log('PASS: same Being, create/switch/rename scenes through the actual UI, isolated history, per-scene SBS visibility and persistence, per-scene drafts, send identity, scene sidebar, collapse/reopen, FIFO scene queue, context-menu rename, confirmed deletion, last-scene replacement and reload.');
} finally { await application?.close(); await rm(directory,{recursive:true,force:true}); }
