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
  await page.route('**/api/history**', route => route.fulfill({json:{messages:Array.from({length:120},(_,i)=>({seq:i+1,role:i%2?'being':'user',content:`历史消息 ${i}\n\n`+'用于验证面板开合时的长对话排版与滚动位置。'.repeat(18),scene_id:'desktop-fixture',at:'2026-11-04T08:00:00Z'}))}}));
  await page.goto(origin);

  await mkdir('output/playwright',{recursive:true});
  const toggle=page.getByRole('button',{name:'资料库',exact:true});
  await toggle.click();
  await page.waitForFunction(()=>!document.querySelector('#being-info').hasAttribute('data-animating'));
  await page.frameLocator('#chat-frame').locator('.message').nth(9).waitFor();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(({name,value})=>[name,value]));
  const measure = async () => {
    const before = await metrics();
    const result = await page.evaluate(async () => {
      const frame=document.querySelector('#chat-frame');
      const widths=[frame.clientWidth], panelWidths=[], chatWidths=[], alignment=[];
      const panel=document.querySelector('#being-info'), chat=document.querySelector('#chat-view');
      const observer=new ResizeObserver(()=>widths.push(frame.clientWidth));
      observer.observe(frame);
      await new Promise(requestAnimationFrame);
      const start=performance.now();
      window.fixtureApp.toggleBeingInfo();
      await new Promise(resolve=>{function check(now){const c=chat.getBoundingClientRect(),f=frame.getBoundingClientRect();panelWidths.push(panel.dataset.animating ? parseFloat(getComputedStyle(panel).getPropertyValue('--drawer-size')) : panel.getBoundingClientRect().width);chatWidths.push(c.width);alignment.push({left:f.left-c.left,width:f.width-c.width});if(now-start>650)resolve();else requestAnimationFrame(check);}requestAnimationFrame(check);});
      observer.disconnect();
      return {widths,panelWidths,chatWidths,alignment,hidden:document.querySelector('#being-info').hidden};
    });
    const after = await metrics();
    return {...result, performance: {taskMs: (after.TaskDuration-before.TaskDuration)*1000, layoutMs: (after.LayoutDuration-before.LayoutDuration)*1000, layouts: after.LayoutCount-before.LayoutCount, styles: after.RecalcStyleCount-before.RecalcStyleCount}};
  };
  const child=page.frames().find(frame=>frame.url().includes('/loom.html'));
  const readingBefore = await child.evaluate(async()=>{
    const messages=document.querySelector('#messages');
    messages.dispatchEvent(new WheelEvent('wheel',{deltaY:-300,bubbles:true}));
    messages.scrollTop=messages.scrollHeight/2;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const top=messages.getBoundingClientRect().top;
    window.readingNode=[...messages.querySelectorAll('.message')].find(node=>node.getBoundingClientRect().bottom>top+1);
    return window.readingNode.getBoundingClientRect().top-top;
  });
  const close=await measure();
  const readingAfter=await child.evaluate(()=>window.readingNode.getBoundingClientRect().top-document.querySelector('#messages').getBoundingClientRect().top);
  const open=await measure();
  console.log(JSON.stringify({close,open,readingBefore,readingAfter}));
  if(!process.env.MOTION_BASELINE) {
    assert.ok(close.panelWidths.some(width=>width>2 && width<318),'Closing drawer passes through intermediate widths');
    assert.ok(open.panelWidths.some(width=>width>2 && width<318),'Opening drawer passes through intermediate widths');
    assert.ok(close.chatWidths.some(width=>width>1030 && width<1354),'Chat viewport grows continuously with the drawer');
    assert.ok(open.chatWidths.some(width=>width>1030 && width<1354),'Chat viewport contracts continuously with the drawer');
    for (const sample of [...close.alignment,...open.alignment]) {
      assert.ok(Math.abs(sample.left)<1,'Chat stays attached to the left edge, with no extra centering jump');
      assert.ok(Math.abs(sample.width)<1,'Chat always fills its viewport without blank strips');
    }
    assert.ok(Math.abs(readingBefore-readingAfter)<2, "Closing preserves the current message reading anchor");
    assert.equal(close.hidden,true); assert.equal(open.hidden,false);
    assert.ok(close.widths.every((w,i,a)=>!i || w>=a[i-1]),'Closing never shrinks the chat back before hiding');
  }
  assert.deepEqual(errors,[]);
} finally {
  await browser?.close();server.kill();
}
