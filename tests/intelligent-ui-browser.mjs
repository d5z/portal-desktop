import { build } from '../scripts/renderer-build.mjs';
import { chromium } from 'playwright';
import { mkdtemp, writeFile, rm, copyFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const dir = await mkdtemp(path.join(tmpdir(), 'town-intelligent-ui-'));
let browser;
try {
  await copyFile('web/public/iui-runtime.html', path.join(dir, 'iui-runtime.html'));
  await build({ stdin: { contents: `import './desktop/renderer/chat/styles.scss';import React from 'react'; import {createRoot} from 'react-dom/client'; import {IntelligentUI} from './desktop/renderer/shared/intelligent-ui/view'; import {CodeClipboard} from './desktop/renderer/shared/components/clipboard'; import {demoSource} from './desktop/renderer/shared/intelligent-ui/examples'; import {templates,toUIStream} from './desktop/renderer/shared/intelligent-ui/templates'; const root=createRoot(document.getElementById('root')); window.source=demoSource; window.templates=templates;window.toUIStream=toUIStream;window.followups=[]; window.update=(source,streaming=false,key='demo')=>root.render(<CodeClipboard.Provider value={async text=>{if(window.failCopy)throw new Error('bridge unavailable');window.copied=text;}}><IntelligentUI key={key} storageKey={key} source={source} streaming={streaming} onContinue={text=>window.followups.push(text)}/></CodeClipboard.Provider>); window.showFeedbackPair=()=>root.render(<CodeClipboard.Provider value={async text=>{if(text==='fail')throw new Error('bridge unavailable');}}>{['ok','fail'].map(name=><IntelligentUI key={name} source={JSON.stringify({version:1,title:name,state:{},body:[{id:'copy',type:'button',action:'copy',label:name,value:name}]})}/>)}</CodeClipboard.Provider>);window.update(demoSource);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', outfile: path.join(dir, 'ui.js') });
  await writeFile(path.join(dir, 'index.html'), `<meta charset="utf-8"><link rel="stylesheet" href="ui.css"><style>html,body,#root{overflow:visible;height:auto}</style><div style="max-width:800px;margin:24px auto" id="root"></div><script src="ui.js"></script>`);
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  const page = await browser.newPage(); page.setDefaultTimeout(15000);
  const errors = [], network = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
  await page.goto(pathToFileURL(path.join(dir, 'index.html')).href);
  const total = page.locator('.iui-metric output');
  await page.getByRole('slider').waitFor();
  assert.equal(await total.textContent(), '232');
  await page.getByRole('slider').fill('10');
  await page.getByLabel('方案', { exact: true }).selectOption('专业版');
  await page.getByRole('checkbox').check();
  assert.equal(await total.textContent(), '472');
  await page.getByLabel('界面更多选项').click();
  await page.getByRole('button', { name: '源码', exact: true }).click();
  await page.getByRole('button', { name: '预览', exact: true }).click();
  assert.equal(await total.textContent(), '472');
  await page.getByRole('button', { name: '展开界面' }).click();
  assert.equal(await total.textContent(), '472');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.update('{"version":', true));
  assert.equal(await total.textContent(), '472');
  await page.evaluate(() => { const doc = JSON.parse(window.source); doc.title = '流式更新完成'; window.update(JSON.stringify(doc)); });
  await page.getByRole('heading', { name: '流式更新完成' }).waitFor();
  assert.equal(await total.textContent(), '472');
  await page.waitForFunction(async () => new Promise(resolve => { const r = indexedDB.open('town-intelligent-ui', 1); r.onsuccess = () => { const get = r.result.transaction('state').objectStore('state').get('demo'); get.onsuccess = () => { resolve(get.result?.seats === 10);r.result.close(); }; }; }));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.iui-metric output')?.textContent === '472');
  await page.getByRole('button', { name: '恢复默认' }).click();
  assert.equal(await total.textContent(), '232');
  // Exercise every original protocol sample with the actual renderer.
  for (const name of ['bicycle', 'meal', 'bill', 'savings']) {
    await page.evaluate(name => window.update(window.toUIStream(window.templates[name]), false, name), name);
    await page.getByRole('heading', { name: await page.evaluate(name => window.templates[name].title, name) }).waitFor();
    assert.equal(await page.locator('.iui-notice').count(), 0);
  }
  await page.evaluate(() => {
    window.checklist = {version:1,title:'聚餐步骤核对',state:{},body:[{id:'plan',type:'timeline',label:'当天流程（可勾选核对）',items:Array.from({length:8},(_,i)=>({id:'t'+i,label:'准备步骤 '+(i+1)}))}]};
    window.update(JSON.stringify(window.checklist),false,'checklist');
  });
  await page.getByRole('heading',{name:'聚餐步骤核对',exact:true}).waitFor();
  assert.equal(await page.getByRole('checkbox').count(),8);
  await page.getByRole('checkbox',{name:'准备步骤 1',exact:true}).check();
  await page.evaluate(()=>{window.checklist.body[0].items.reverse();window.update(JSON.stringify(window.checklist),false,'checklist');});
  assert.equal(await page.getByRole('checkbox',{name:'准备步骤 1',exact:true}).isChecked(),true);
  await page.evaluate(source => window.update(source, false, 'motorcycle-regression'), await readFile('tests/fixtures/intelligent-ui-motorcycle.jsonl','utf8'));
  await page.getByRole('heading', {name:'摩托车结构原理',exact:true}).waitFor();
  assert.equal(await page.locator('.iui-notice').count(),0);
  await page.locator('.iui-segments').getByRole('button',{name:'发动机',exact:true}).click();
  assert.ok(await page.locator('svg rect[width="65"][height="36"]').count()>0);
  await page.screenshot({path:path.resolve('test-results/intelligent-ui-motorcycle.png'),fullPage:true});
  await page.evaluate(() => window.update(window.toUIStream(window.templates.bicycle), false, 'bicycle'));
  await page.locator('.iui-segments').getByRole('button', { name: '车架', exact: true }).click();
  await page.locator('.iui-part-description').getByRole('heading', { name: '车架' }).waitFor();
  await page.getByRole('button', { name: '继续了解这个部件' }).click();
  assert.match(await page.evaluate(() => window.followups[0]), /五个系统，协同前进: frame/);
  assert.equal(await page.getByRole('button', { name: '用当前选择继续' }).count(), 0);
  await page.evaluate(() => {
    window.fallbackDoc = { version: 1, title: '选择方案', state: { plan: 'A', ready: false }, body: [
      { id: 'plan', type: 'select', label: '方案', bind: 'plan', options: ['A', 'B'] },
      { id: 'ready', type: 'toggle', label: '显示专用按钮', bind: 'ready' },
      { id: 'next', type: 'button', label: '生成方案', action: 'continue', when: { state: 'ready' } },
    ] };
    window.update(JSON.stringify(window.fallbackDoc), false, 'fallback');
  });
  await page.getByRole('button', { name: '用当前选择继续' }).waitFor();
  await page.getByLabel('方案', { exact: true }).selectOption('B');
  await page.getByRole('button', { name: '用当前选择继续' }).click();
  assert.match(await page.evaluate(() => window.followups.at(-1)), /方案: B/);
  assert.equal(await page.locator('.iui-action-status').count(), 0);
  assert.equal(await page.locator('.iui-continue p').count(), 0);
  await page.getByLabel('显示专用按钮', { exact: true }).check();
  assert.equal(await page.getByRole('button', { name: '用当前选择继续' }).count(), 0);
  await page.getByLabel('显示专用按钮', { exact: true }).uncheck();
  await page.evaluate(() => window.update(JSON.stringify(window.fallbackDoc), true, 'fallback'));
  await page.waitForFunction(() => document.querySelector('.iui-continue button')?.disabled);
  await page.evaluate(() => window.update(window.toUIStream(window.templates.bicycle), false, 'bicycle'));
  await page.locator('.iui-segments').getByRole('button', { name: '车架', exact: true }).click();
  await page.setViewportSize({ width: 375, height: 800 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.resolve('test-results/intelligent-ui-bicycle-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.screenshot({ path: path.resolve('test-results/intelligent-ui-bicycle-desktop.png'), fullPage: true });
  await page.getByRole('slider', {name:'拆解程度'}).fill('1');
  assert.ok(await page.locator('svg g[transform="translate(-46 25)"]').count() > 0);
  await page.evaluate(() => window.update(window.toUIStream(window.templates.meal), false, 'meal-preview'));
  await page.getByRole('heading',{name:'把周末，留给一桌好菜',exact:true}).waitFor();
  await page.getByRole('button',{name:'增加用餐人数',exact:true}).click();
  await page.getByRole('button',{name:'增加用餐人数',exact:true}).click();
  assert.equal(await page.locator('.iui-task-value').filter({hasText:'2000 克'}).count(), 1);
  await page.getByRole('checkbox',{name:'鸡肉',exact:true}).check();
  assert.match(await page.locator('.iui-checklist-heading').first().innerText(), /1 \/ 5 已完成/);
  assert.equal(await page.getByRole('slider',{name:'用餐人数',exact:true}).inputValue(),'8');
  await page.getByRole('slider',{name:'用餐人数',exact:true}).fill('4');
  await page.getByRole('button',{name:'丰盛',exact:true}).click();
  assert.equal(await page.locator('.iui-task-value').first().textContent(),'1250 克');
  assert.equal(await page.getByRole('checkbox',{name:'鸡肉',exact:true}).isChecked(),true);
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('Browser clipboard unavailable');}}}));
  const beforeCopy = await page.locator('.intelligent-ui').boundingBox();
  await page.getByRole('button',{name:'复制清单',exact:true}).click();
  assert.match(await page.evaluate(()=>window.copied), /\[✓\] 鸡肉 · 1250 克/);
  assert.match(await page.evaluate(()=>window.copied), /配菜与水果/);
  assert.equal((await page.locator('.intelligent-ui').boundingBox()).height,beforeCopy.height);
  assert.equal(await page.locator('.intelligent-ui .iui-toast').count(),0);
  await page.locator('.iui-toast').waitFor({state:'visible'});
  assert.equal(await page.getByRole('button',{name:'用当前选择继续',exact:true}).count(),0);
  await page.evaluate(()=>{window.failCopy=true;});
  await page.getByRole('button',{name:'复制清单',exact:true}).click();
  await page.getByText('复制失败，请重试',{exact:true}).waitFor();
  await page.evaluate(()=>{window.failCopy=false;});
  await page.getByRole('button',{name:'复制清单',exact:true}).click();
  await page.getByText('已复制',{exact:true}).waitFor();
  await page.locator('.iui-toast').waitFor({state:'detached',timeout:5000});
  assert.equal(await page.locator('.iui-numbered-timeline .iui-timeline-number').count(),4);
  assert.equal(await page.getByRole('heading',{name:'把周末，留给一桌好菜',exact:true}).count(),1);

  for (const width of [320,375]) {
    await page.setViewportSize({width,height:800});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('.iui-grid:not(.iui-summary-grid)').first().evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),1);
  }
  await page.screenshot({path:path.resolve('test-results/intelligent-ui-meal-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1200,height:800});
  await page.screenshot({path:path.resolve('test-results/intelligent-ui-meal-desktop.png'),fullPage:true});
  // New generic layouts work outside the meal example, including failed optional media.
  await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 8;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#83a995'; ctx.fillRect(0,0,8,8);
    const src = canvas.toDataURL('image/png');
    window.update(JSON.stringify({version:1,title:'露营装备',state:{people:1},body:[
      {id:'photos',type:'gallery',children:[1,2,3].map(i=>({id:'photo'+i,type:'image',src,label:'装备 '+i}))},
      {id:'broken',type:'media',label:'备用装备',value:'图片失效也保留说明',src:'data:image/png;base64,AAAA'},
      {id:'people',type:'stepper',label:'同行人数',bind:'people',min:1,max:2},
      {id:'facts',type:'facts',rows:[['饮用水',{op:'mul',args:[{state:'people'},2]}]]},
    ]}),false,'generic-layout');
  });
  await page.getByRole('heading',{name:'露营装备',exact:true}).waitFor();
  await page.locator('.iui-image-unavailable').waitFor();
  assert.equal(await page.getByText('图片失效也保留说明',{exact:true}).isVisible(),true);
  assert.equal(await page.getByRole('button',{name:'减少同行人数'}).isDisabled(),true);
  await page.getByRole('button',{name:'增加同行人数'}).focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.getByRole('button',{name:'增加同行人数'}).isDisabled(),true);
  assert.equal(await page.locator('.iui-facts dd').innerText(),'4');
  for(const width of [320,800]) {
    await page.setViewportSize({width,height:800});
    const gallery = await page.locator('.iui-gallery').boundingBox();
    assert.ok(Math.abs(gallery.width/gallery.height-2)<.05);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  await page.setViewportSize({width:1200,height:800});
  // Exercise the remaining task families through the same generated-UI protocol.
  await page.evaluate(()=>window.update(window.toUIStream(window.templates.wardrobe),false,'wardrobe'));
  await page.getByRole('tab',{name:'晚餐聚会',exact:true}).click();
  await page.getByRole('heading',{name:'连衣裙 × 小号手袋',exact:true}).waitFor();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('tab',{name:'婚礼',exact:true}).getAttribute('aria-selected'),'true');
  await page.getByRole('checkbox',{name:'衬衫与可叠穿上装',exact:true}).check();
  await page.screenshot({path:path.resolve('test-results/intelligent-ui-wardrobe.png'),fullPage:true});
  await page.evaluate(()=>window.update(window.toUIStream(window.templates.roadtrip),false,'roadtrip'));
  await page.getByRole('heading',{name:'每日安排',exact:true}).waitFor();
  assert.equal(await page.locator('.iui-route').count(),0);
  await page.setViewportSize({width:375,height:800});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:path.resolve('test-results/intelligent-ui-roadtrip-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1200,height:800});
  for (const name of ['retirement','itemizedBill','clt','gdp','photography','monty','arcade']) {
    await page.evaluate(name=>window.update(window.toUIStream(window.templates[name]),false,'scenario-'+name),name);
    if(name!=='gdp') await page.locator('.iui-app .iui-body').waitFor();
    else await page.getByRole('heading',{name:'GDP · 看懂支出构成',exact:true}).waitFor();
    assert.equal(await page.locator('.iui-notice,.iui-app-error').count(),0);
    if(name==='retirement') {
      assert.equal(await page.getByRole('button',{name:'暂停',exact:true}).count(),0);
      await page.getByRole('slider',{name:'假设年增长率（%）',exact:true}).fill('0');
      await page.waitForFunction(()=>document.querySelector('.iui-app .iui-metric output')?.textContent==='150000');
      await page.screenshot({path:path.resolve('test-results/intelligent-ui-retirement.png'),fullPage:true});
    }
    if(name==='itemizedBill') {
      await page.getByRole('button',{name:'添加菜品',exact:true}).click();
      await page.waitForFunction(()=>document.querySelectorAll('.iui-app .iui-card').length===3);
      await page.getByLabel('金额（元）',{exact:true}).first().fill('90');
      await page.waitForFunction(()=>document.querySelector('.iui-app .iui-metric output')?.textContent==='114.00');
    }
    if(name==='clt') {
      await page.getByRole('button',{name:'抽样 100 组',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('.iui-app .iui-metric output')?.textContent==='100');
    }
    if(name==='photography') await page.getByRole('slider',{name:'水平视场角（度）',exact:true}).fill('90');
    if(name==='monty') {
      await page.getByRole('button',{name:'门 1',exact:true}).click();
      await page.getByRole('button',{name:'换到另一扇门',exact:true}).click();
      await page.getByText(/你赢得了奖品！|这次是空门。/).waitFor();
    }
    if(name==='arcade') {
      await page.getByRole('button',{name:'向左移动',exact:true}).click();
      await page.getByRole('button',{name:'重新开局',exact:true}).click();
      await page.screenshot({path:path.resolve('test-results/intelligent-ui-arcade.png'),fullPage:true});
    }
  }
  // Worker-rendered state is authoritative, including events arriving while it is busy.
  await page.evaluate(() => window.update(JSON.stringify({version:1,title:'Worker 状态回归',state:{},body:[{
    id:'counter',type:'app',code:`
      let count=0;
      function draw(){ui.render({version:1,title:'计数器',state:{count},body:[
        {id:'bound',type:'metric',label:'绑定计数',value:{state:'count'}},
        {id:'literal',type:'metric',label:'实际计数',value:count},
        {id:'increment',type:'button',action:'event',label:'递增计数'}
      ]});}
      ui.onEvent(()=>{const until=performance.now()+100;while(performance.now()<until){} count++;draw();});draw();`
  }]}),false,'worker-state-regression'));
  const increment = page.getByRole('button',{name:'递增计数',exact:true});
  await increment.click();
  await page.waitForFunction(()=>document.querySelectorAll('.iui-app .iui-metric output')[1]?.textContent==='1');
  assert.equal(await page.locator('.iui-app .iui-metric output').first().textContent(),'1', 'Expressions receive the latest Worker state');
  await increment.evaluate(button=>{button.click();button.click();button.click();});
  await page.waitForFunction(()=>document.querySelectorAll('.iui-app .iui-metric output')[1]?.textContent==='4');
  assert.equal(await page.locator('.iui-app .iui-metric output').first().textContent(),'4', 'All rapid clicks reach the busy Worker in order');
  // Measure input-to-next-paint latency while an already rendered card is interactive.
  await page.evaluate(() => window.update(window.toUIStream(window.templates.savings), false, 'performance'));
  await page.getByRole('heading',{name:'看看储蓄如何增长',exact:true}).waitFor();
  await page.getByRole('slider').waitFor();
  await page.screenshot({path:path.resolve('test-results/intelligent-ui-slider-desktop.png'),fullPage:true});
  const timings = await page.evaluate(async () => {
    const values = [];
    for (let i = 0; i < 40; i++) {
      const t = performance.now(), slider = document.querySelector('input[type=range]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, String((i % 10) + .1));
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(resolve => requestAnimationFrame(resolve)); values.push(performance.now() - t);
    }
    return values.sort((a, b) => a - b);
  });
  console.log(`Local control input-to-next-frame p95: ${timings[37].toFixed(1)}ms (40 operations, headless Chrome).`);

  await page.evaluate(() => window.update(window.toUIStream(window.templates.simulation), false, 'simulation'));
  await page.locator('.iui-app svg').waitFor();
  await page.getByRole('slider').fill('2');
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByRole('button', { name: '播放', exact: true }).waitFor();
  await page.evaluate(() => window.update(window.toUIStream(window.templates.game), false, 'game'));
  await page.getByRole('button', { name: '第 1 格', exact: true }).click();
  await page.getByRole('button', { name: 'X', exact: true }).waitFor();
  await page.getByRole('button', { name: '第 2 格', exact: true }).click();
  await page.getByRole('button', { name: 'O', exact: true }).waitFor();
  await page.getByRole('button', { name: '重新开始', exact: true }).click();
  await page.getByRole('button', { name: '第 1 格', exact: true }).waitFor();
  await page.evaluate(() => window.update(JSON.stringify({ version: 1, title: '异常计算', state: {}, body: [{ id: 'bad', type: 'app', code: 'while(true){}' }] }), false, 'bad-app'));
  await page.getByText(/应用计算超时/).waitFor();
  await page.evaluate(() => window.update(JSON.stringify({version:1,title:'错误图片',state:{},body:[{id:'image-app',type:'app',code:`ui.render({version:1,title:'图片',state:{},body:[{id:'photo',type:'image',src:'data:image/svg+xml,<svg/>'}]});`}]}),false,'invalid-image'));
  await page.getByText(/生成内容格式不符合要求/).waitFor();
  assert.equal(await page.getByRole('button',{name:'重新启动',exact:true}).count(),0);
  assert.equal(await page.getByText('正在准备交互体验…',{exact:true}).count(),0);
  await page.getByRole('button',{name:'让 Being 修正',exact:true}).click();
  assert.match(await page.evaluate(()=>window.followups.at(-1)), /SVG.*diagram/);
  await page.evaluate(() => window.update(window.source, false, 'cleanup'));
  await page.getByRole('heading', { name: '团队预算计算器' }).waitFor();
  assert.equal(await page.locator('iframe').count(), 0);
  await page.evaluate(()=>window.showFeedbackPair());
  await page.getByRole('button',{name:'ok',exact:true}).click();
  await page.locator('.iui-toast').filter({hasText:'已复制'}).waitFor();
  await page.getByRole('button',{name:'fail',exact:true}).click();
  assert.equal(await page.locator('.iui-toast').count(),1);
  assert.equal(await page.locator('.iui-toast').textContent(),'复制失败，请重试');
  await page.locator('.iui-toast').waitFor({state:'detached',timeout:5000});
  assert.deepEqual(network, []);
  assert.deepEqual(errors, []);
  assert.ok(timings[37] < 100, 'interactive update budget');
  console.log('Intelligent UI: persistence, progressive streams, expand/collapse, diagram selection, four tasks, sandbox simulation, timeout recovery, cleanup and zero network passed.');
} finally { await browser?.close(); await rm(dir, { recursive: true, force: true }); }
