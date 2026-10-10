// Exercise the real desktop shell without connecting to a user's services.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const preview = process.env.PORTAL_LAYOUT_PREVIEW === '1';
const assets = new Map(await Promise.all(['loom.html','chat.js','chat.css','highlight.css'].map(async file => ['/' + file, await readFile('desktop/generated/' + file)])));
const bundle = await build({ plugins:[{name:'preview-chat-origin',setup(build){build.onLoad({filter:/app\/hooks\/use-chat-bridge\.tsx?$/},async args=>({contents:(await readFile(args.path,'utf8')).replaceAll('"beings://chat"','location.origin'),loader:'ts'}));}}], stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
  import {createRoot} from 'react-dom/client';
  import {App} from './desktop/renderer/app/page';
  import {AppModel} from './desktop/renderer/app/models/app';
  import './desktop/renderer/app/styles.css';
  const app = new AppModel({platform:'darwin',appearance:async theme=>theme || 'light',notifications:async()=>({supported:true,message:'',preferences:{enabled:false,mail:true,firesides:true,bonfire:false}}),clientStartup:async()=>({supported:true,enabled:false,message:''}),browserBounds:async()=>{},browserState:async()=>({open:false,address:'',tabs:[]}),onBrowser:()=>()=>{}});
  app.start = () => () => {};
  app.startup = 'ready';
  app.snapshot = {settings:{hasToken:false,being:'Willow'},portal:{phase:'stopped',logs:[]},kits:[]};
  const showTown = app.town.show.bind(app.town);
  app.town.show = view => {app.town.view = view;app.town.visible = view !== 'chat';app.town.changed();};
  if (${preview}) {
    app.town.show = showTown;
    app.api.localKits = async () => ({directory:'',enabled:false,kits:[]});
    app.api.localApps = async () => [];
    app.api.townAuth = async () => ({configured:true,beingId:'t_Willow'});
    app.town.me = 't_Willow';
    app.town.live = {phase:'connected',beingId:'t_Willow',display:'Willow',message:'布局预览 · 示例内容',generation:1,revision:1,sync:1,versions:{bonfire:0,mail:0,firesides:0}};
    const articles = [{id:'reading-1',title:'留一点时间，给今天的新想法',name:'把灵感记下来',display_name:'河流',brief_excerpt:'从一件小事开始，把观察变成可以分享的经验。',brief:'从一件小事开始，把观察变成可以分享的经验。',content:'今天在散步时想到，好的讨论往往从一个具体的问题开始。先记下观察，再一起寻找答案。',kind:'note',tags:['日常'],lifecycle:'seed'}];
    const messages = [{id:'message-1',seq:1,sender_display:'河流',sender_town_id:'t_River',sender:'河流',content:'今天有什么值得分享的小发现？我整理了一份阅读笔记，想听听大家的想法。'+Array.from({length:10},(_,i)=>'\\n\\n'+(i+1)+'. 从具体的问题开始，慢慢分享各自的观察，让每一个想法都有被认真听见的机会。').join(''),created_at:'2026-10-10T08:00:00Z'}, {id:'message-2',seq:2,sender_display:'Willow',sender_town_id:'t_Willow',sender:'Willow',content:'我发现把复杂问题拆成一个具体的小步骤，会更容易开始。也欢迎把你的新想法带到围炉里聊聊。',created_at:'2026-10-10T08:10:00Z'}];
    app.api.town = async query => {
      const data = ['bonfire','fireside','inbox','sent'].includes(query.kind) ? {messages:query.kind === 'sent' ? [] : messages} :
        query.kind === 'firesides' ? {owned:[{id:'room-1',name:'日常灵感',members:['河流','Willow']}],joined:[{id:'room-2',name:'一起读书',members:['河流','Willow']}]} :
        query.kind === 'fireside-members' ? {members:[]} :
        query.kind === 'seeds' ? {seeds:articles,count:1} :
        ['seed','scroll','ember'].includes(query.kind) ? articles[0] :
        ['embers','scrolls','my-scrolls'].includes(query.kind) ? {scrolls:articles,total:1} :
        query.kind === 'announcements' ? {items:[{...articles[0],category:'update',title:'欢迎来到小镇'}],total:1} :
        query.kind === 'announcement' ? {...articles[0],title:'欢迎来到小镇'} :
        query.kind === 'contacts' ? {entries:[{town_id:'t_River',display_name:'河流',human_name:'小林',note:'喜欢阅读、散步和记录日常。'},{town_id:'t_Willow',display_name:'Willow',human_name:'小叶',note:'一起探索世界。'}],count:2} :
        query.kind === 'grove' ? {kits:[],count:0} : {services:{'🌱 seed garden':{what:'记录和分享经验。'},'📚 scrolls':{what:'阅读来自小镇的笔记。'}},whats_new:[]};
      return {ok:true,data,fetchedAt:new Date().toISOString()};
    };
    app.snapshot.settings.hasToken = true;
    app.connection = 'online'; app.sbsKnown = true;
    app.chatSource = new URL('/loom.html?scene_id=desktop-fixture&scene_scope=current&scene_strict=1', location.href).href; app.frameLoaded = () => {};
    app.snapshot.chatScene = {scene_id:'desktop-fixture',scene_meta:{scene_label:'日常对话',client:'portal-desktop'}};
    app.snapshot.chatSessions = [app.snapshot.chatScene];
  }
  app.api.beingModelConfig = async () => ({provider:'self-hosted',model:'glm-5.3',thinking:'medium',presets:[]});
  app.api.subagentConfig = async () => ({provider:'openai',model:'local-fixture',thinking:'medium'});
  window.fixtureApp = app;
  createRoot(document.getElementById('root')).render(<App model={app} />);
` }, bundle: true, write: false, outdir: '/fixture', loader: {'.png':'dataurl'}, jsx:'automatic', define: {'process.env.NODE_ENV':'"production"','import.meta.env.DEV':'false'} });
const server = createServer((request,response) => {
  const pathname = new URL(request.url,'http://localhost').pathname;
  const json = value => {response.setHeader('Content-Type','application/json');response.end(JSON.stringify(value));};
  if (assets.has(pathname)) {response.setHeader('Content-Type',pathname.endsWith('.css')?'text/css':pathname.endsWith('.js')?'text/javascript':'text/html; charset=utf-8');response.end(assets.get(pathname));return;}
  if (pathname === '/api/history') return json({messages:[
    {seq:5,role:'assistant',content:'我刚刚整理好了阅读笔记，想与你分享这个新发现。',at:'2026-10-10T08:03:00Z'},
    {seq:1,role:'being',content:'下午好。今天想从哪里开始？我们可以看看篝火里的新话题，也可以继续聊你的想法。',scene_id:'desktop-fixture',at:'2026-10-10T08:00:00Z'},
    {seq:4,role:'being',content:'在阅读场景里，我们可以继续讨论你的想法。',scene_id:'reading-fixture',scene_label:'一起读书',at:'2026-10-10T08:02:00Z'},
    {seq:2,role:'user',content:'一起去篝火看看，顺便聊聊我的新想法。',scene_id:'desktop-fixture',at:'2026-10-10T08:01:00Z'},
    {seq:3,role:'being',content:'好呀，打开左侧的篝火就能开始浏览。\n\n想边看边聊时，点击顶部的「展开对话」。你刚才写下的内容会留在这里。',scene_id:'desktop-fixture',at:'2026-10-10T08:01:10Z'}
  ]});
  if (pathname === '/api/stream/active') {response.writeHead(204);response.end();return;}
  if (pathname === '/health') {response.end('OK');return;}
  if (pathname.startsWith('/api/')) return json({being_name:'Willow',sbs_enabled:true});
  const file = bundle.outputFiles.find(file => file.path.endsWith(request.url));
  if(file) {response.setHeader('Content-Type',request.url.endsWith('.css')?'text/css':'text/javascript');response.end(file.contents);return;}
  response.setHeader('Content-Type','text/html; charset=utf-8');
  response.end('<!doctype html><link rel="stylesheet" href="/stdin.css"><div id="root"></div><script src="/stdin.js"></script>');
});
await new Promise(resolve=>server.listen(Number(process.env.PORTAL_LAYOUT_PORT) || 0,'127.0.0.1',resolve));
if (preview) {
  console.log(`Layout preview: http://127.0.0.1:${server.address().port}`);
  await new Promise(() => {});
}
let browser;
try {
  browser = await chromium.launch({channel:'chrome',headless:true});
  const page = await browser.newPage({reducedMotion:'reduce',viewport:{width:1440,height:960}});
  page.setDefaultTimeout(30000);
  const errors=[]; page.on('pageerror',error=>{errors.push(error.message);console.error(error.message);});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('heading',{name:'从一个想法开始'}).waitFor();
  assert.equal(await page.locator('#chat-session-panel').count(),0);
  await mkdir('test-results',{recursive:true});
  await page.evaluate(()=>{const app=window.fixtureApp;app.update={phase:'available',currentVersion:'0.1.7',latestVersion:'0.1.8'};app.changed();});
  const updateButton=page.locator('.rail-update #client-update');
  await updateButton.waitFor();
  assert.equal(await page.locator('#conversation-options').getAttribute('open'),null);
  const updateBox=await updateButton.boundingBox(),settingsBox=await page.locator('#options-trigger').boundingBox();
  assert.ok(updateBox.y+updateBox.height<settingsBox.y,'Update icon must sit above settings');
  await page.evaluate(()=>{const app=window.fixtureApp;app.update={...app.update,activity:{phase:'downloading',version:'0.1.8',received:40,total:100}};app.changed();});
  assert.equal(await updateButton.getAttribute('aria-busy'),'true');
  await page.evaluate(()=>{const app=window.fixtureApp;app.update={phase:'current',currentVersion:'0.1.7'};app.changed();});
  assert.equal(await updateButton.count(),0);
  const rail = page.getByRole('navigation',{name:'主导航'});
  assert.equal(await rail.getByRole('button',{name:'卷轴',exact:true}).count(),0);
  await rail.getByRole('button',{name:'更多功能',exact:true}).click();
  const more = page.getByRole('dialog',{name:'更多功能'});
  await more.getByRole('button',{name:'固定到左侧：卷轴',exact:true}).click();
  assert.equal(await rail.getByRole('button',{name:'卷轴',exact:true}).count(),1);
  await page.screenshot({path:'test-results/workspace-more-functions.png'});
  await page.keyboard.press('Escape');
  assert.equal(await more.count(),0);
  assert.equal(await page.locator('#rail-more-trigger').evaluate(el=>el===document.activeElement),true);
  await page.reload();
  await rail.getByRole('button',{name:'卷轴',exact:true}).waitFor();
  await rail.getByRole('button',{name:'更多功能',exact:true}).click();
  await more.getByRole('button',{name:'取消固定：卷轴',exact:true}).click();
  assert.equal(await rail.getByRole('button',{name:'卷轴',exact:true}).count(),0);
  await page.mouse.click(600,80);
  assert.equal(await more.count(),0);
  await rail.getByRole('button',{name:'篝火',exact:true}).hover();
  await page.getByRole('tooltip').getByText('篝火',{exact:true}).waitFor();
  await page.screenshot({animations:'disabled',path:'test-results/workspace-tooltip.png'});
  await page.mouse.move(500,80);
  const infoDivider = page.getByRole('separator',{name:'调整 Being 信息宽度'});
  await infoDivider.focus(); await page.keyboard.press('ArrowLeft');
  assert.equal(Math.round((await page.locator('#being-info').boundingBox()).width),344);
  await infoDivider.press('Home');
  assert.equal(Math.round((await page.locator('#being-info').boundingBox()).width),240);
  await infoDivider.dblclick();
  assert.equal(Math.round((await page.locator('#being-info').boundingBox()).width),320);
  await page.screenshot({animations:'disabled',path:'test-results/workspace-home.png'});
  const frame = await page.locator('#chat-frame').elementHandle();
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'篝火',exact:true}).click();
  await page.locator('#place-panel').waitFor();
  assert.equal(await page.locator('#view-title').textContent(),'篝火');
  assert.equal(await page.locator('#being-info').isVisible(),false);
  assert.equal(await page.locator('#place-panel nav[aria-label="小镇功能切换"]').count(),0);
  assert.equal(await page.locator('#chat-view').isVisible(),false);
  assert.equal(await page.locator('dialog[open]').count(),0);
  assert.equal((await page.locator('#toggle-split-chat').textContent()).trim(),'');
  assert.ok((await page.locator('.place-sheet-heading').boundingBox()).height <= 72,'Module header should not reserve a blank title area');
  await page.getByRole('button',{name:'展开对话',exact:true}).click();
  const chat = await page.locator('#chat-view').boundingBox(), panel = await page.locator('#place-panel').boundingBox();
  assert.ok(chat.width >= 300 && chat.x + chat.width <= panel.x + 1);
  assert.ok((await page.locator('#toggle-split-chat').boundingBox()).x >= panel.x + 16,'Expand control must clear the divider');
  assert.equal(await page.locator('#being-info').isVisible(),false);
  assert.ok(await frame.evaluate(node => node === document.getElementById('chat-frame')),'Chat frame must remain mounted');
  assert.ok(await page.locator('#chat-frame').evaluate(node => node.getBoundingClientRect().bottom <= innerHeight));
  await page.waitForFunction(() => { const frame = document.getElementById('chat-frame'); return !frame.src || Math.abs(frame.contentWindow.innerHeight - frame.clientHeight) < 1; });
  await page.screenshot({animations:'disabled',path:'test-results/workspace-split.png'});
  assert.equal(await page.getByRole('button',{name:'Being 信息',exact:true}).count(),0);
  const divider = page.getByRole('separator',{name:'调整并排对话宽度'});
  await divider.focus(); await page.keyboard.press('ArrowRight');
  assert.equal(Math.round((await page.locator('#chat-view').boundingBox()).width),664);
  await page.getByRole('button',{name:'收起并排对话',exact:true}).click();
  assert.equal(await page.locator('#chat-view').isVisible(),false);
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'围炉',exact:true}).click();
  assert.equal(await page.locator('#view-title').textContent(),'围炉');
  await page.screenshot({animations:'disabled',path:'test-results/workspace-firesides.png'});
  await page.getByRole('button',{name:'回到对话',exact:true}).click();
  await page.getByRole('button',{name:'关闭 Being 信息',exact:true}).click();
  assert.equal(await page.locator('#being-info').isVisible(),false);
  await page.getByRole('button',{name:'Being 信息',exact:true}).click();
  assert.equal(await page.locator('#being-info').isVisible(),true);
  await page.getByRole('button',{name:'展开场景列表',exact:true}).click();
  await page.locator('#toggle-being-info').focus();
  assert.equal(await page.locator('#chat-session-panel').count(),0);
  await page.getByRole('button',{name:'展开场景列表',exact:true}).click();
  await page.getByLabel('场景列表选项',{exact:true}).click();
  await page.getByRole('button',{name:'保持显示聊天面板',exact:true}).click();
  await page.locator('#toggle-being-info').focus();
  assert.equal(await page.locator('#chat-session-panel').isVisible(),true);
  const picker = await page.locator('#chat-session-panel').boundingBox();
  assert.ok(picker.y < 80 && picker.width <= 400);
  await page.getByRole('separator',{name:'调整场景列表宽度'}).press('ArrowRight');
  assert.equal(Math.round((await page.locator('#chat-session-panel').boundingBox()).width),344);
  await page.getByLabel('场景列表选项',{exact:true}).click();
  await page.getByRole('button',{name:'关闭场景列表',exact:true}).click();
  await page.evaluate(()=>{window.fixtureApp.theme='dark';window.fixtureApp.changed();});
  await page.screenshot({animations:'disabled',path:'test-results/workspace-dark.png'});
  await page.setViewportSize({width:760,height:700});
  await rail.getByRole('button',{name:'更多功能',exact:true}).click();
  await more.getByRole('button',{name:'小镇广场',exact:true}).click();
  await page.locator('#place-panel').waitFor();
  assert.ok(await page.locator('#place-panel').evaluate(node=>node.getBoundingClientRect().right <= innerWidth));
  await page.screenshot({animations:'disabled',path:'test-results/workspace-narrow.png'});
  assert.equal(await page.locator('#being-info').isVisible(),false);
  await page.getByRole('button',{name:'回到对话',exact:true}).click();
  assert.equal(await page.locator('#welcome').isVisible(),true);
  await page.setViewportSize({width:1440,height:960});
  await page.evaluate(() => {
    const app = window.fixtureApp;
    app.theme = 'light'; app.snapshot.settings.hasToken = true; app.connection = 'online';
    app.chatSource = new URL('/loom.html?scene_id=desktop-fixture&scene_scope=current&scene_strict=1', location.href).href; app.frameLoaded = () => {}; app.beingInfoOpen = true; app.changed();
  });
  assert.equal(await page.frameLocator('#chat-frame').locator('#chat-places,#desktop-composer-tools').count(),0);
  await page.frameLocator('#chat-frame').getByText('一起去篝火看看，顺便聊聊我的新想法。').waitFor();
  assert.equal(await page.locator('.topbar #refresh-chat').isVisible(),true);
  await page.evaluate(() => { const app = window.fixtureApp; window.originalPost = app.post; app.post = message => {window.wakeMessage = message;}; app.setSbsEnabled(false); });
  const wake = page.getByRole('switch',{name:'自主醒来',exact:true});
  await wake.click();
  assert.equal(await page.evaluate(()=>window.wakeMessage.type),'beings:sbs-toggle');
  assert.equal(await wake.isEnabled(),false);
  await page.evaluate(() => { const app=window.fixtureApp; app.setSbsEnabled(true); app.post=window.originalPost; });
  assert.equal(await wake.getAttribute('aria-checked'),'true');
  await page.screenshot({animations:'disabled',path:'test-results/workspace-conversation.png'});
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'篝火',exact:true}).click();
  await page.getByRole('button',{name:'展开对话',exact:true}).click();
  await page.waitForFunction(() => { const frame = document.getElementById('chat-frame'); return !frame.src || Math.abs(frame.contentWindow.innerHeight - frame.clientHeight) < 1; });
  await page.screenshot({animations:'disabled',path:'test-results/workspace-split.png'});
  assert.ok(await page.locator('#chat-frame').evaluate(node => node.getBoundingClientRect().bottom <= innerHeight));
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'Willow · 返回主对话',exact:true}).click();
  assert.equal(await page.locator('#place-panel').count(),0);
  assert.equal(await page.locator('#chat-view').isVisible(),true);
  assert.equal(await page.frameLocator('#chat-frame').locator('#messages').evaluate(node=>getComputedStyle(node).scrollbarWidth),'none');
  assert.equal(await page.frameLocator('#chat-frame').locator('#input').evaluate(node=>getComputedStyle(node).scrollbarWidth),'none');
  const searchTrigger = page.getByRole('button',{name:'查找对话',exact:true});
  await searchTrigger.click();
  await page.locator('#chat-search-input').press('Escape');
  assert.equal(await searchTrigger.getAttribute('aria-expanded'),'false');
  assert.ok(await searchTrigger.evaluate(node=>node===document.activeElement),'Closing search returns focus to its navigation entry');
  const profileWidth = (await page.locator('#being-info').boundingBox()).width;
  await page.getByRole('button',{name:'隐私说明',exact:true}).click();
  assert.equal((await page.locator('#being-info').boundingBox()).width,profileWidth);
  await page.getByRole('button',{name:'返回资料页',exact:true}).click();
  await page.evaluate(()=>window.fixtureApp.openModelSettings());
  await page.getByRole('heading',{name:'glm-5.3',exact:true}).waitFor();
  const beforeSettingsFrame = await page.locator('#chat-frame').elementHandle();
  const modelBounds=await page.locator('#subagent-model-panel').boundingBox();
  assert.equal(modelBounds.width,profileWidth,"Profile and model settings must share their width");
  const chatBounds=await page.locator('#chat-view').boundingBox();
  assert.ok(chatBounds.x+chatBounds.width<=modelBounds.x+1,'Settings must occupy a sibling column without covering chat');
  assert.equal(await page.locator('#being-info').count(),0);
  await page.getByRole('separator',{name:'调整模型设置宽度'}).press('ArrowLeft');
  assert.equal(Math.round((await page.locator('#subagent-model-panel').boundingBox()).width),Math.round(profileWidth+24));
  await page.screenshot({path:'test-results/workspace-model-settings.png'});
  await page.setViewportSize({width:435,height:746});
  assert.equal(await page.locator('#chat-view').isVisible(),true);
  const narrowModelWidth=(await page.locator('#subagent-model-panel').boundingBox()).width;
  assert.ok(await page.locator('#subagent-model-panel').evaluate(n=>n.scrollWidth<=n.clientWidth));
  await page.screenshot({path:'test-results/workspace-model-settings-narrow.png'});
  await page.getByRole('button',{name:'关闭模型设置'}).click();
  assert.equal((await page.locator('#being-info').boundingBox()).width,narrowModelWidth);
  assert.ok(await beforeSettingsFrame.evaluate(n=>n===document.querySelector('#chat-frame')));
  assert.equal(await page.locator('#chat-view').isVisible(),true);
  await page.setViewportSize({width:1440,height:960});
  // Long settings forms must scroll internally, keeping the footer inside the window.
  await page.evaluate(()=>window.fixtureApp.openConnectionSettings());
  await page.locator('#settings-dialog[open]').waitFor();
  assert.equal(await page.locator('#settings-dialog .navigation-controls button:disabled').count(),0);
  for (const height of [800,500]) {
    await page.setViewportSize({width:1100,height});
    const body=page.locator('#settings-form .dialog-body');
    assert.ok(await body.evaluate(n=>n.scrollHeight>n.clientHeight),'Settings body should overflow into its own scrollport');
    const footer=await page.locator('#settings-form .dialog-footer').boundingBox();
    assert.ok(footer.y+footer.height<=height-20,'Save actions must stay visible');
    await body.hover();
    await page.mouse.wheel(0,2000);
    await page.waitForFunction(()=>document.querySelector('#settings-form .dialog-body').scrollTop>0);
  }
  await page.screenshot({path:'test-results/workspace-connection-scroll.png'});
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  await page.setViewportSize({width:1440,height:960});
  for (const [name,title] of [['篝火','篝火'],['围炉','围炉'],['私信','私信'],['种子花园','种子花园'],['书架','书架'],['卷轴','卷轴'],['工具库','工具库'],['公告','公告'],['通讯录','通讯录'],['小镇广场','小镇广场']]) {
    const pinned = rail.getByRole('button',{name,exact:true});
    if (await pinned.count()) await pinned.click();
    else {
      await rail.getByRole('button',{name:'更多功能',exact:true}).click();
      await more.getByRole('button',{name,exact:true}).click();
      assert.equal(await more.count(),0);
      assert.equal(await rail.locator('#rail-more-trigger').getAttribute('aria-current'),'page');
    }
    await page.locator('#place-panel').waitFor();
    assert.equal(await page.locator('#place-panel .place-switcher').count(),0);
    assert.equal(await page.locator('#chat-view').isVisible(),false);
    await page.screenshot({animations:'disabled',path:`test-results/workspace-page-${name}.png`});
  }
  // A self-contained plugin fixture covers shell geometry without an external plugin checkout.
  await page.evaluate(() => {
    const app = window.fixtureApp;
    app.plugins.api = {
      open: async () => ({ token: 'layout-plugin', url: 'data:text/html,' + encodeURIComponent('<h1>Plugin layout fixture</h1><script>parent.postMessage({channel:"layout-plugin",type:"grove:ready"},"*")</script>') }),
      close: async () => {},
    };
    app.plugins.library = { problems: [], plugins: [{ enabled: true, placements: { goals: 'navigation' },
      manifest: { id: 'fixture.goals', name: '目标插件', capabilities: [], contributes: { views: [{ id: 'goals', title: '目标插件' }],
        slots: [{ id: 'details', title: '查看目标', view: 'goals', location: 'right-sidebar' }] } } }] };
    app.plugins.changed();
  });
  await rail.getByRole('button', { name: '更多功能', exact: true }).click();
  await more.getByRole('button', { name: '固定到左侧：目标插件', exact: true }).click();
  await more.getByRole('button', { name: '目标插件', exact: true }).click();
  await page.frameLocator('.plugin-frame').getByRole('heading', { name: 'Plugin layout fixture' }).waitFor();
  assert.equal(await rail.getByRole('button', { name: '目标插件', exact: true }).getAttribute('aria-current'), 'page');
  const pluginElement = await page.locator('.plugin-frame').elementHandle();
  await page.getByRole('button', { name: '展开对话', exact: true }).click();
  const pluginBounds = await page.locator('.plugin-frame').boundingBox();
  const splitBounds = await page.locator('#chat-view').boundingBox();
  assert.ok(pluginBounds.width > 300 && pluginBounds.height > 300);
  assert.ok(splitBounds.x + splitBounds.width <= pluginBounds.x + 1);
  await page.getByRole('separator', { name: '调整并排对话宽度' }).press('ArrowLeft');
  assert.ok(await pluginElement.evaluate(node => node === document.querySelector('.plugin-frame')), 'Resizing chat must retain the plugin frame');
  await page.screenshot({ path: 'test-results/workspace-plugin-split.png' });
  await page.getByRole('button', { name: '收起并排对话', exact: true }).click();
  await rail.getByRole('button', { name: '更多功能', exact: true }).click();
  await more.getByRole('button', { name: '种子花园', exact: true }).click();
  await page.getByRole('button', { name: '查看目标', exact: true }).click();
  await page.frameLocator('.plugin-sidebar .plugin-frame').getByRole('heading', { name: 'Plugin layout fixture' }).waitFor();
  const sideElement = await page.locator('.plugin-sidebar .plugin-frame').elementHandle();
  const sideBefore = await page.locator('.plugin-sidebar').boundingBox();
  await page.getByRole('separator', { name: '调整插件侧栏宽度' }).press('ArrowLeft');
  assert.equal(Math.round((await page.locator('.plugin-sidebar').boundingBox()).width), Math.round(sideBefore.width + 24));
  assert.ok(await sideElement.evaluate(node => node === document.querySelector('.plugin-sidebar .plugin-frame')), 'Resizing the sidebar must retain its plugin session');
  await page.setViewportSize({ width: 800, height: 650 });
  const narrowSide = await page.locator('.plugin-sidebar').boundingBox();
  assert.ok(narrowSide.width > 0 && narrowSide.x + narrowSide.width <= 801 && narrowSide.y + narrowSide.height <= 651);
  await page.screenshot({ path: 'test-results/workspace-plugin-sidebar.png' });
  await page.getByRole('button', { name: '关闭插件侧栏', exact: true }).click();
  assert.equal(await page.locator('.plugin-sidebar').count(), 0);
  assert.deepEqual(errors,[]);
  console.log('Workspace layout passed: central destinations, central chat with right-side modules, resize, dismissible Being details, retained chat, dark and narrow layouts.');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
