import { build } from '../scripts/renderer-build.mjs';
import { chromium } from 'playwright';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const dir = await mkdtemp(path.join(tmpdir(), 'town-rich-reply-'));
let browser;
try {
  await build({ stdin: {contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {TownComposer} from './desktop/renderer/town/components/composer';
    import {TownModel} from './desktop/renderer/town/models/town';
    import {SceneStore} from './desktop/renderer/shared/models/scene';
    import {Markdown} from './desktop/renderer/shared/components/markdown';
    import {useModel} from './desktop/renderer/shared/hooks/use-model';
    import './desktop/renderer/app/styles.scss';
    const sent=window.sent=[];
    const town=window.town=new TownModel({sendTown:async input=>{sent.push(input);return {ok:true};}},()=>{},()=>{},new SceneStore(),()=>{},()=>{});
    town.visible=false;
    town.live={phase:'connected',beingId:'fixture',generation:1};
    window.openReply=kind=>{
      town.sendTarget={kind,generation:1,beingId:'fixture',firesideId:'1',reply:{id:'7',author:'对方',preview:'**原消息**',recipient:'recipient'}};
      town.recipient='recipient';town.content='';town.sendOpen=true;town.changed();
    };
    window.openReply('dm');
    function App(){useModel(town);return <><TownComposer model={town}/><div id="reply-result"><Markdown richCode content={sent.at(-1)?.content || ''} /></div></>;}
    createRoot(document.getElementById('root')).render(<App/>);
  `,resolveDir:process.cwd(),loader:'tsx'},bundle:true,platform:'browser',jsx:'automatic',outfile:path.join(dir,'ui.js')});
  await writeFile(path.join(dir,'index.html'),'<meta charset="utf-8"><link rel="stylesheet" href="ui.css"><div id="root"></div><script src="ui.js"></script>');
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
  const page=await browser.newPage({viewport:{width:1000,height:900}});page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(pathToFileURL(path.join(dir,'index.html')).href);
  const input=page.locator('#town-send-content');
  const paste=async text=>{
    await input.fill('');
    await input.evaluate((el,text)=>{const clipboardData=new DataTransfer();clipboardData.setData('text/plain',text);el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData}));},text);
  };
  const source='这次的改动要点：\n\n1. **每个事件单行完整**——一行一个 JSON\n2. **支持嵌套**，所有节点平铺\n3. state key 从 `type` 改为 `meal`\n\n功能不变：人数与聚餐类型联动。';
  for(const [i,kind] of ['dm','bonfire','fireside'].entries()){
    if(i)await page.evaluate(kind=>window.openReply(kind),kind);
    await input.waitFor();
    const layout = () => page.evaluate(() => ['#town-send-dialog', '#town-send-content', '.dialog-footer'].map(selector => {
      const { y, height } = document.querySelector(selector).getBoundingClientRect(); return { y, height };
    }));
    const emptyLayout = await layout();
    assert.equal(await page.locator('[data-slot="composer-format"]').count(), 0);
    await input.pressSequentially('1312');
    assert.deepEqual(await layout(), emptyLayout, 'Typing the first characters must not shift the reply dialog');
    await input.press('Meta+a'); await input.press('Backspace');
    assert.deepEqual(await layout(), emptyLayout, 'Clearing the draft must preserve the dialog layout');
    await paste(source);
    await input.locator('strong').first().waitFor();
    assert.equal(await input.locator('ol li').count(),3);
    assert.equal(await input.locator('code').count(),2);
    assert.equal(await page.evaluate(()=>window.town.content),source);
    if(!i){await mkdir('test-results',{recursive:true});await page.locator('#town-send-dialog').screenshot({path:'test-results/reply-markdown-editor.png'});}
    await input.press('Control+Enter');
    await page.waitForFunction(count=>window.sent.length===count,i+1);
    assert.equal(await page.evaluate(()=>window.sent.at(-1).content),source);
    await page.locator('#reply-result strong').first().waitFor();
    assert.equal(await page.locator('#reply-result ol li').count(),3);
  }
  await page.evaluate(()=>window.openReply('dm'));
  await paste('{"标题":"聚餐","人数":4}');
  await page.locator('[data-slot="composer-highlight"] .hljs-attr').first().waitFor();
  assert.equal(await input.inputValue(),'{"标题":"聚餐","人数":4}');
  await input.press('Control+Enter');
  await page.locator('#reply-result code.lang-json').waitFor();
  assert.equal(await page.locator('#reply-result .hljs-attr').count(),2);
  await page.evaluate(()=>window.openReply('dm'));
  await paste('<script>window.pwned=true</script>\n\n[危险](javascript:alert(1))\n\n<img src=x onerror=alert(1)>');
  assert.equal(await input.locator('script,img,a[href^="javascript:"]').count(),0);
  assert.equal(await page.evaluate(()=>window.pwned),undefined);
  await paste(source+'\n\n'+Array.from({length:30},(_,i)=>'第 '+i+' 段内容').join('\n\n')+'\n\n最后一行');
  await page.setViewportSize({width:390,height:844});
  await input.evaluate(el=>{el.scrollTop=el.scrollHeight;});
  assert.equal(await input.evaluate(el=>{
    const last=el.lastElementChild.getBoundingClientRect(), box=el.getBoundingClientRect();
    return el.scrollWidth<=el.clientWidth+1 && last.bottom<=box.bottom+1;
  }),true,'Long rich text wraps and its final line can be fully scrolled into view');
  await page.locator('#town-send-dialog .dialog-body').evaluate(el=>{el.scrollTop=el.scrollHeight;});
  await page.locator('#town-send-dialog').screenshot({path:'test-results/reply-markdown-editor-mobile.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS: rich Markdown editing and send in private replies, bonfire and fireside; safe markup and long narrow layout.');
}finally{await browser?.close();await rm(dir,{recursive:true,force:true});}
