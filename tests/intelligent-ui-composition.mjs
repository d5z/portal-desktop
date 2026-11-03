import { build } from '../scripts/renderer-build.mjs';
import { chromium } from 'playwright';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const dir = await mkdtemp(path.join(tmpdir(), 'town-composition-'));
let browser;
try {
  await build({stdin:{contents:`import './desktop/renderer/chat/styles.scss';import React from 'react';import {createRoot} from 'react-dom/client';import {IntelligentUI} from './desktop/renderer/shared/intelligent-ui/view';import {gdp} from './desktop/renderer/shared/intelligent-ui/scenarios';const root=createRoot(document.getElementById('root'));window.show=(doc)=>root.render(<IntelligentUI key={doc.title} source={JSON.stringify(doc)}/>);window.show(gdp);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,platform:'browser',jsx:'automatic',outfile:path.join(dir,'ui.js')});
  await writeFile(path.join(dir,'index.html'),`<meta charset="utf-8"><link rel="stylesheet" href="ui.css"><style>html,body,#root{overflow:visible;height:auto}body{padding:16px}#root{max-width:960px;margin:0 auto}</style><div id="root"></div><script src="ui.js"></script>`);
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
  const page=await browser.newPage({viewport:{width:1100,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.join(dir,'index.html')).href);
  await page.getByRole('button',{name:'试试进出口平衡'}).waitFor();
  const columns = await page.locator('.iui-split').evaluate(el=>[...el.children].map(c=>c.getBoundingClientRect().width));
  assert.ok(columns[0]>columns[1]*1.9);
  assert.equal(await page.locator('.iui-metric output').textContent(),'100');
  await page.getByRole('button',{name:'试试进出口平衡'}).click();
  assert.equal(await page.locator('.iui-metric output').textContent(),'105');
  assert.equal(await page.getByText(/当前进口大于出口/).isVisible(),false);
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/intelligent-ui-composition-desktop.png',fullPage:true});
  for (const width of [375,320]) {
    await page.setViewportSize({width,height:900});
    const rects=await page.locator('.iui-split').evaluate(el=>[...el.children].map(c=>{const r=c.getBoundingClientRect();return {top:r.top,bottom:r.bottom};}));
    assert.ok(rects[1].top>=rects[0].bottom);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  await page.screenshot({path:'test-results/intelligent-ui-composition-mobile.png',fullPage:true});
  await page.evaluate(()=>window.show({version:1,title:'自由组合验证',state:{choice:'a',shown:true,note:'保留内容',a:2,b:5},body:[
    {id:'choice',type:'choice',label:'方案',bind:'choice',items:[{id:'a',label:'简洁'},{id:'b',label:'详细',description:'显示更多说明'}]},
    {id:'toggle',type:'toggle',label:'显示备注',bind:'shown'},
    {id:'note',type:'input',label:'备注',bind:'note',when:{state:'shown'}},
    {id:'detail',type:'text',value:'详细说明',when:{op:'eq',args:[{state:'choice'},'b']}},
    {id:'swap',type:'button',label:'交换数值',action:'set',changes:{a:{state:'b'},b:{state:'a'}}},
    {id:'total',type:'metric',label:'数值',value:{op:'concat',args:[{state:'a'},' / ',{state:'b'}]}},
    {id:'progress',type:'progress',label:'完成进度',value:{state:'a'},min:0,max:10},
    {id:'grid',type:'grid',variant:'three',children:[{id:'wide',type:'box',appearance:{span:2,surface:'outline'},children:[{id:'body',type:'text',value:'跨列内容'}]},{id:'last',type:'badge',value:'状态'}]},
  ]}));
  await page.getByRole('radio',{name:'简洁',exact:true}).focus();
  await page.keyboard.press('ArrowRight');
  await page.getByText('详细说明',{exact:true}).waitFor();
  await page.getByRole('textbox',{name:'备注'}).fill('用户内容');
  await page.getByRole('checkbox',{name:'显示备注'}).uncheck();
  assert.equal(await page.getByRole('textbox',{name:'备注'}).count(),0);
  await page.getByRole('checkbox',{name:'显示备注'}).check();
  assert.equal(await page.getByRole('textbox',{name:'备注'}).inputValue(),'用户内容');
  await page.getByRole('button',{name:'交换数值'}).click();
  assert.equal(await page.locator('.iui-metric output').textContent(),'5 / 2');
  assert.equal(await page.getByRole('progressbar',{name:'完成进度'}).getAttribute('value'),'5');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.setViewportSize({width:1100,height:900});
  const spans=await page.locator('.iui-grid').evaluate(el=>[...el.children].map(c=>c.getBoundingClientRect().width));
  assert.ok(spans[0]>spans[1]*1.9);
  assert.deepEqual(errors,[]);
  console.log('Composition: responsive 2:1 layout, spanning grid, keyboard choices, atomic actions, retained hidden inputs and progress passed.');
} finally { await browser?.close(); await rm(dir,{recursive:true,force:true}); }
