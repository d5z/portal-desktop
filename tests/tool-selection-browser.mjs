import { build } from '../scripts/renderer-build.mjs';
import { chromium } from 'playwright';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const dir = await mkdtemp(path.join(tmpdir(), 'town-tool-selection-'));
let browser;
try {
  await build({ stdin: { contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {ToolsLibrary} from './desktop/renderer/town/components/tools-library';
    import {TownModel} from './desktop/renderer/town/models/town';
    import {SceneStore} from './desktop/renderer/shared/models/scene';
    import {useModel} from './desktop/renderer/shared/hooks/use-model';
    const entries = [{id:'goals',name:'目标',kind:'plugin'}, {id:'pipeline',name:'星图流程看板',kind:'plugin'}];
    const pending = []; window.pending = pending;
    const api = {
      town: query => query.kind === 'kit' ? new Promise(resolve => pending.push({id:query.id,resolve})) : Promise.resolve({ok:true,data:query.kind === 'grove' ? {kits:entries} : {comments:[]},fetchedAt:''}),
      townAuth: async () => ({configured:false}),
    };
    const town = window.town = new TownModel(api,()=>{},()=>{},new SceneStore(),()=>{},()=>{});
    town.view='kits';town.tab='grove';town.visible=true;town.groveKind='plugin';town.localOnly=false;town.data={kits:entries};
    window.finish = (id, fail=false) => {
      const index=pending.findIndex(request=>request.id===id);
      if(index<0) throw Error('Missing request '+id);
      pending.splice(index,1)[0].resolve(fail ? {ok:false,message:'读取失败'} : {ok:true,data:entries.find(entry=>entry.id===id),fetchedAt:''});
    };
    function App(){useModel(town);return <ToolsLibrary town={town}/>;}
    createRoot(document.getElementById('root')).render(<App/>);
  `, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', outfile: path.join(dir, 'ui.js') });
  await writeFile(path.join(dir, 'index.html'), '<meta charset="utf-8"><link rel="stylesheet" href="ui.css"><div id="root"></div><script src="ui.js"></script>');
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  const page = await browser.newPage(); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(pathToFileURL(path.join(dir, 'index.html')).href);
  const choose = name => page.locator('.catalog-list button').filter({hasText:name}).click();
  const heading = name => page.getByRole('heading', {name,exact:true});
  const waitRequest = (id, count=1) => page.waitForFunction(({id,count}) => window.pending.filter(item=>item.id===id).length === count, {id,count});
  const finish = (id, fail=false) => page.evaluate(({id,fail})=>window.finish(id,fail), {id,fail});
  await waitRequest('goals'); await finish('goals'); await heading('目标').waitFor();
  await choose('星图流程看板'); await waitRequest('pipeline');
  assert.equal(await heading('目标').count(),0,'Old details disappear immediately on selection');
  await finish('pipeline'); await heading('星图流程看板').waitFor();

  // Reproduce stale cache restoration while the selected list key stays unchanged.
  await page.evaluate(()=>{
    window.town.selectedId='goals';
    window.town.detail={query:{kind:'kit',id:'goals'},fragments:[{id:'goals',kind:'plugin',name:'目标'}]};
    window.town.changed();
  });
  await waitRequest('pipeline');
  assert.equal(await heading('目标').count(),0,'A restored cache cannot show another plugin');
  await finish('pipeline'); await heading('星图流程看板').waitFor();

  // Old response arrives after switching twice: only the current request may commit.
  await choose('目标'); await waitRequest('goals');
  await choose('星图流程看板'); await waitRequest('pipeline');
  await finish('pipeline'); await finish('goals');
  await heading('星图流程看板').waitFor();
  assert.equal(await page.locator('.catalog-item.selected strong').textContent(),'星图流程看板');

  // A list refresh cancels a pending detail read; the visible selection must retry it.
  await choose('目标'); await waitRequest('goals');
  await page.evaluate(()=>window.town.load(true));
  await waitRequest('goals',2);
  await finish('goals'); await finish('goals'); await heading('目标').waitFor();

  // Errors remain on the selected entry and retry on demand, without request loops.
  await choose('星图流程看板'); await waitRequest('pipeline'); await finish('pipeline',true);
  await page.getByText('读取失败',{exact:true}).waitFor();
  assert.equal(await heading('目标').count(),0);
  assert.equal(await page.evaluate(()=>window.pending.length),0);
  await page.getByRole('button',{name:'重试',exact:true}).click();
  await waitRequest('pipeline'); await finish('pipeline'); await heading('星图流程看板').waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS: tool selection, stale cache recovery, out-of-order responses, refresh cancellation and error retry.');
} catch (error) {
  if (browser) for (const context of browser.contexts()) for (const page of context.pages()) console.error(await page.evaluate(()=>({html:document.body.innerText,pending:window.pending?.map(x=>x.id)})));
  throw error;
} finally {
  await browser?.close(); await rm(dir,{recursive:true,force:true});
}
