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
  const toggle = page.getByRole('button', {name:'资料',exact:true});
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
    const closing = parseFloat(getComputedStyle(rail).getPropertyValue('--drawer-size'));
    const inert = rail.inert;
    app.toggleBeingInfo();
    const reversedAnimation=await animation(); reversedAnimation.pause(); reversedAnimation.currentTime=0;
    const reversalStart = parseFloat(getComputedStyle(rail).getPropertyValue('--drawer-size'));
    reversedAnimation.currentTime=100;
    const reversed = parseFloat(getComputedStyle(rail).getPropertyValue('--drawer-size'));
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
    return {closing,reversed,reversalStart,debug,inert,hidden,frames:frames.slice(1)};
  });
  assert.ok(measurements.closing>0 && measurements.closing<full.width);
  assert.ok(measurements.reversed>measurements.closing && measurements.reversed<=full.width);
  assert.ok(Math.abs(measurements.reversalStart-measurements.closing)<1, "Reversal starts at the current drawer width");
  assert.ok(Math.abs(parseFloat(measurements.debug[0].frames[0]['--drawer-size'])-measurements.closing)<1);
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
  // Every docked surface uses one shared animation, including conditional roots.
  const chatBeforeCompanion=await page.locator('#chat-view').boundingBox();
  await page.evaluate(()=>window.fixtureApp.workspace.receive({type:'beings:scene-select',id:'fixture-together',role:'being',text:'把这段内容放进对话，一起讨论新的想法。'}));
  await page.getByRole('dialog',{name:'一起看',exact:true}).waitFor();
  assert.deepEqual(await page.locator('#chat-view').boundingBox(),chatBeforeCompanion,'Together popup does not resize chat');
  assert.equal(await page.locator('#companion-panel').evaluate(node=>node.parentElement.id),'chat-view');
  await page.screenshot({path:'output/playwright/motion-together-popup.png',animations:'disabled'});
  await page.getByRole('button',{name:'收起话题',exact:true}).click();
  await page.locator('#companion-panel').waitFor({state:'hidden'});
  for (const [kind, selector] of [['browser','#browser-panel'], ['model','#subagent-model-panel'], ['plugin','.dsh-rightbar']]) {
    const change = open => page.evaluate(({kind,open}) => {
      const app=window.fixtureApp;
      if(kind==='browser') window.fixtureBrowserState({open,address:'',tabs:[]});
      if(kind==='model') { app.subagentSettingsOpen=open; app.changed(); }
      if(kind==='plugin') { const runtime=window.fixtureDsh; runtime.rightbar={open,track:true,fullscreen:false}; runtime.changed(); }
    }, {kind,open});
    for (const open of [true,false]) {
      await change(open);
      await page.waitForFunction(selector => document.querySelector(selector)?.getAnimations().length,selector);
      const motion=await page.locator(selector).evaluate(node => {
        const animations=node.getAnimations();
        const animation=animations[0]; animation.pause(); animation.currentTime=85;
        const frames=animation.effect.getKeyframes();
        const result={count:animations.length,shared:node.hasAttribute('data-workspace-drawer'),width:parseFloat(getComputedStyle(node).getPropertyValue('--drawer-size')),surfaceWidth:node.getBoundingClientRect().width,from:parseFloat(frames[0]['--drawer-size']),to:parseFloat(frames[1]['--drawer-size'])};
        animation.finish(); return result;
      });
      assert.equal(motion.shared,true,`${kind} uses the shared drawer`);
      assert.equal(motion.count,1,`${kind} has no competing entrance animation`);
      assert.ok(Math.abs(motion.surfaceWidth-Math.max(motion.from,motion.to))<1,`${kind} keeps a full-width surface while sliding`);
      assert.ok(motion.width>Math.min(motion.from,motion.to) && motion.width<Math.max(motion.from,motion.to),`${kind} ${open?'opens':'closes'} continuously: ${JSON.stringify(motion)}`);
      await page.waitForFunction(selector => !document.querySelector(selector)?.hasAttribute('data-animating'),selector);
    }
  }
  // A sibling can restart space allocation while this conditional drawer exits.
  // Retention must follow animation completion, not an independent timeout.
  await page.evaluate(()=>{const app=window.fixtureApp;app.subagentSettingsOpen=true;app.changed();});
  await page.waitForFunction(()=>!document.querySelector('#subagent-model-panel')?.dataset.animating);
  await page.evaluate(()=>{const app=window.fixtureApp;app.subagentSettingsOpen=false;app.changed();});
  await page.waitForFunction(()=>document.querySelector('#subagent-model-panel')?.getAnimations().length);
  await page.locator('#subagent-model-panel').evaluate(node=>{const animation=node.getAnimations()[0];animation.pause();animation.currentTime=85;});
  await page.evaluate(()=>window.fixtureBrowserState({open:true,address:'',tabs:[]}));
  await page.waitForFunction(()=>document.querySelector('#browser-panel').getAnimations().length);
  await page.evaluate(()=>{for(const node of document.querySelectorAll('[data-workspace-drawer]'))for(const animation of node.getAnimations())animation.pause();});
  await page.waitForTimeout(420);
  assert.equal(await page.locator('#subagent-model-panel').count(),1,'Exit contents remain mounted until their actual animation finishes');
  await page.evaluate(()=>{for(const node of document.querySelectorAll('[data-workspace-drawer]'))for(const animation of node.getAnimations())animation.finish();});
  await page.locator('#subagent-model-panel').waitFor({state:'detached'});
  await page.evaluate(()=>window.fixtureBrowserState({open:false,address:'',tabs:[]}));
  await page.locator('#browser-panel').waitFor({state:'hidden'});
  // Feed pages keep their complete layout and slide from the right edge.
  for (const view of ['bonfire','mail','firesides']) {
    await page.evaluate(view=>window.fixtureApp.navigate(view),view);
    await page.waitForFunction(()=>document.querySelector('#place-panel')?.getAnimations().length);
    const samples=await page.evaluate(()=>{
      const animations=[...document.querySelectorAll('[data-workspace-drawer]')].flatMap(node=>node.getAnimations());
      const chat=document.querySelector('#chat-view'),place=document.querySelector('#place-panel');
      const samples=[0,85,170,300].map(time=>{
        for(const animation of animations) { animation.pause(); animation.currentTime=time; }
        const rect=place.getBoundingClientRect(),content=place.querySelector('.plugin-place-layout').getBoundingClientRect();
        return {left:rect.left,width:rect.width,contentWidth:content.width,chat:chat.getBoundingClientRect().width,gap:parseFloat(getComputedStyle(place).marginLeft),total:chat.parentElement.clientWidth,right:chat.parentElement.getBoundingClientRect().right};
      });
      for(const animation of animations) animation.currentTime=85;
      return samples;
    });
    assert.equal(new Set(samples.map(sample=>sample.width)).size,1,`${view}: panel width stays fixed throughout the slide`);
    assert.equal(new Set(samples.map(sample=>sample.contentWidth)).size,1,`${view}: contents do not stretch or reflow horizontally`);
    assert.ok(Math.abs(samples[0].left-samples[0].right)<1,`${view}: enters from the right edge`);
    assert.ok(samples.every((sample,index)=>!index || sample.left<samples[index-1].left),`${view}: slides right to left`);
    for(const sample of samples) assert.ok(Math.abs(sample.chat+sample.width+sample.gap-sample.total)<2,'Chat and drawer trade exactly the available space');
    await page.screenshot({path:`output/playwright/drawer-${view}-midpoint.png`});
    await page.evaluate(()=>{for(const node of document.querySelectorAll('[data-workspace-drawer]')) for(const animation of node.getAnimations()) animation.finish();});
    await page.waitForFunction(()=>!document.querySelector('#place-panel').hasAttribute('data-animating'));
    if(view!=='firesides') {
      const exit = await page.evaluate(async () => {
        const panel=document.querySelector('#place-panel');
        const before=panel.innerText;
        window.fixtureApp.closePlace();
        await new Promise(resolve=>requestAnimationFrame(resolve));
        return {before,after:panel.innerText,inert:panel.inert};
      });
      assert.equal(exit.after,exit.before,`${view}: outgoing content and heading survive until the drawer closes`);
      assert.equal(exit.inert,true);
      await page.waitForFunction(()=>!document.querySelector('#place-panel'));
    }
  }
  await page.waitForFunction(()=>!document.querySelector('#chat-view').hasAttribute('data-animating'));
  assert.equal(await page.locator('#chat-view').isVisible(),true,'Opening a right page preserves chat');
  assert.equal(await page.getByRole('button',{name:'收起并排对话',exact:true}).count(),0,'Only the right header controls chat collapse');
  const rightPage=await page.locator('#place-panel').elementHandle();
  await page.getByRole('button',{name:'收起对话',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#chat-view').hidden);
  await page.getByRole('button',{name:'一起看',exact:true}).first().click();
  await page.getByRole('dialog',{name:'一起看',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.fixtureApp.view),'firesides');
  assert.ok(await rightPage.evaluate(node=>node===document.querySelector('#place-panel')),'Together preserves the existing right page');
  await page.getByRole('button',{name:'收起话题',exact:true}).click();
  await page.getByRole('button',{name:'收起对话',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#chat-view').hidden);
  await page.getByRole('button',{name:'回到对话',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#place-panel') && !document.querySelector('#chat-view').hasAttribute('data-animating'));
  assert.equal(await page.locator('#chat-view').isVisible(),true,'Closing the last right page restores chat');
  await page.getByRole('button',{name:'展开场景列表',exact:true}).click();
  await page.getByRole('complementary',{name:'场景列表'}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('#chat-session-panel').hasAttribute('data-animating'));
  await toggle.click();
  await page.waitForFunction(()=>document.querySelector('#being-info').getAnimations().length);
  const stableLeft=await page.evaluate(()=>{
    const panel=document.querySelector('#being-info');
    for(const animation of panel.getAnimations()) { animation.pause(); animation.currentTime=85; }
    const chat=document.querySelector('#chat-view'),frame=document.querySelector('#chat-frame'),left=document.querySelector('#chat-session-panel');
    const result={leftAnimations:left.getAnimations().length,offset:frame.getBoundingClientRect().left-chat.getBoundingClientRect().left,width:frame.getBoundingClientRect().width-chat.getBoundingClientRect().width,transform:getComputedStyle(chat).transform,opacity:getComputedStyle(chat).opacity};
    for(const animation of panel.getAnimations()) animation.finish();
    return result;
  });
  assert.equal(stableLeft.leftAnimations,0,'Opening the right drawer does not replay the left drawer');
  assert.ok(Math.abs(stableLeft.offset)<1 && Math.abs(stableLeft.width)<1,'Chat has no blank strip or centering jump during drawer motion');
  assert.equal(stableLeft.transform,'none'); assert.equal(stableLeft.opacity,'1');
  await settle();
  await page.getByRole('button',{name:'关闭 Being 信息',exact:true}).click();
  await panel.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'收起场景列表',exact:true}).focus();
  await page.keyboard.press('Escape');
  await page.locator('#chat-session-panel').waitFor({state:'hidden'});
  // Responsive panes keep the same layout axis when chat is collapsed or restored.
  await page.evaluate(()=>window.fixtureApp.navigate('firesides'));
  await page.waitForFunction(()=>!document.querySelector('#place-panel').dataset.animating);
  await page.setViewportSize({width:700,height:800});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  for(const open of [false,true]) {
    const before=await page.locator('#place-panel').evaluate(node=>node.getBoundingClientRect().height);
    await page.evaluate(()=>window.fixtureApp.toggleChatSplit());
    await page.waitForFunction(()=>document.querySelector('#place-panel').getAnimations().length);
    const geometry=await page.evaluate(()=>{
      const panel=document.querySelector('#place-panel'),chat=document.querySelector('#chat-view');
      for(const node of [panel,chat]) for(const animation of node.getAnimations()) {animation.pause();animation.currentTime=0;}
      const result={axis:panel.dataset.drawerMotion,start:parseFloat(getComputedStyle(panel).getPropertyValue('--drawer-size')),chatStart:parseFloat(getComputedStyle(chat).getPropertyValue('--drawer-size'))};
      for(const node of [panel,chat]) for(const animation of node.getAnimations()) animation.finish();
      return result;
    });
    assert.equal(geometry.axis,'vertical','Narrow workspace retains its vertical axis even with only one pane');
    assert.ok(Math.abs(geometry.start-before)<1,'Responsive drawer starts at its measured height, not its previous width');
    if(open) assert.equal(geometry.chatStart,0,'Hidden chat starts from zero height');
    await page.waitForFunction(()=>!document.querySelector('#place-panel').dataset.animating && !document.querySelector('#chat-view').dataset.animating);
  }
  await page.setViewportSize({width:1440,height:900});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const exit=await page.evaluate(async()=>{
    const panel=document.querySelector('#place-panel'),before=panel.innerText;
    window.fixtureApp.closePlace();
    await new Promise(resolve=>requestAnimationFrame(resolve));
    return {before,after:panel.innerText,axis:panel.dataset.drawerMotion};
  });
  assert.equal(exit.axis,'horizontal','Returning to desktop restores horizontal motion');
  assert.equal(exit.after,exit.before,'Firesides contents survive closing after responsive changes');
  // Window resize interrupts a running drawer and removes its temporary styles.
  await page.setViewportSize({width:1400,height:900});
  await page.waitForFunction(()=>!document.querySelector('#place-panel') && !document.querySelector('#chat-view').dataset.animating);
  assert.equal(await page.locator('[data-drawer-motion]').count(),0);
  await page.setViewportSize({width:700,height:800});
  await toggle.click(); await settle();
  await page.screenshot({path:'output/playwright/motion-narrow.png'});
  assert.ok((await panel.boundingBox()).x>=64);
  await page.getByRole('button',{name:'关闭 Being 信息',exact:true}).click();
  await panel.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'展开场景列表',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#chat-session-panel')?.getAnimations().length);
  assert.equal(await page.locator('#chat-session-panel').evaluate(node=>{
    for(const animation of node.getAnimations()) { animation.pause(); animation.currentTime=85; }
    return document.elementFromPoint(38,150)?.closest('#chat-session-panel')!==null;
  }),false,'Sliding scenes stay clipped inside the content area and do not cover navigation');
  await page.screenshot({path:'output/playwright/motion-narrow-scene-midpoint.png'});
  await page.locator('#chat-session-panel').evaluate(node=>node.getAnimations().forEach(animation=>animation.finish()));
  await page.getByRole('button',{name:'收起场景列表',exact:true}).click();
  await page.locator('#chat-session-panel').waitFor({state:'hidden'});
  await toggle.click(); await settle();
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
  console.log('Motion: shared drawers, coordinated middle/right navigation, reversal, exit retention, focus, SBS, scenes, narrow clipping and reduced motion passed.');
  console.log(JSON.stringify(measurements));
} finally {
  await browser?.close();
  server.kill();
}
