// Exercise real editor transactions and verify that typing does not render history.
import { build } from '../scripts/renderer-build.mjs';
import { chromium } from 'playwright';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const dir = await mkdtemp(path.join(tmpdir(), 'chat-composer-performance-'));
let browser;
try {
  await build({ stdin: { contents: `
    import React, {useRef} from 'react';
    import {createRoot} from 'react-dom/client';
    import {ChatComposer} from './desktop/renderer/chat/components/composer';
    import {RichComposer} from './desktop/renderer/shared/components/rich-composer';
    import {ChatState} from './desktop/renderer/chat/models/chat';
    import {useModel} from './desktop/renderer/shared/hooks/use-model';
    import {Markdown} from './desktop/renderer/shared/components/markdown';
    import './desktop/renderer/shared/styles/_composer.scss';
    const state=window.state=new ChatState();
    window.renders=0; window.sent=[];
    function App(){
      useModel(state); window.renders++;
      const ref=useRef(null);
      const props={textareaRef:ref,id:'input',placeholder:'说点什么，或输入 / 选择功能…',onKeyDown:event=>{
        if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){
          event.preventDefault();window.sent.push(state.draft);state.draft='';state.changed();
        }
      }};
      return <>
        <div id="history">{Array.from({length:100},(_,i)=><Markdown key={i} content={'## Reply '+i+'\\n\\n**Formatted** history with \`code\`.'}/>)}</div>
        <output id="has-text">{String(Boolean(state.draft.trim()))}</output>
        {location.search ? <RichComposer {...props} value={state.draft} onChange={value=>{state.draft=value;state.changed();}}/>
          : <ChatComposer {...props} state={state}/>}
      </>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  `, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' }, outfile: path.join(dir, 'ui.js') });
  await writeFile(path.join(dir, 'index.html'), '<meta charset="utf-8"><link rel="stylesheet" href="ui.css"><div id="root"></div><script src="ui.js"></script>');
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = pathToFileURL(path.join(dir, 'index.html')).href;
  const counts = {};
  for (const baseline of [true, false]) {
    await page.goto(url + (baseline ? '?baseline' : ''));
    const input = page.locator('#input');
    await input.waitFor();
    await input.pressSequentially('x');
    const before = await page.evaluate(() => window.renders);
    const text = ' typing should not rerender the history';
    await input.pressSequentially(text);
    counts[baseline ? 'before' : 'after'] = await page.evaluate(() => window.renders) - before;
    assert.equal(await page.evaluate(() => window.state.draft), 'x' + text);
    assert.equal(await page.locator('#has-text').textContent(), 'true');
    await input.press('Enter');
    assert.equal(await page.evaluate(() => window.sent.at(-1)), 'x' + text, 'Send reads the latest keystroke synchronously');
    assert.equal(await input.textContent(), '');
    assert.equal(await page.locator('#has-text').textContent(), 'false');
    assert.equal(await input.getAttribute('data-empty'), 'true');
    await input.pressSequentially('3.');
    assert.equal(await input.getAttribute('data-empty'), 'false', 'Literal numbering hides the placeholder');
    await input.press('Space');
    assert.equal(await input.locator('ol').getAttribute('start'), '3');
    assert.equal(await input.getAttribute('data-empty'), 'false', 'An empty list item must not show the blank-input placeholder');
    assert.equal(await input.evaluate(el => getComputedStyle(el, '::before').content), 'none');
    assert.match(await page.evaluate(() => window.state.draft), /^3\./, 'The unfinished list remains in the draft');
    await input.pressSequentially('第三项');
    await input.press('Enter');
    assert.equal(await page.evaluate(() => window.sent.at(-1)), '3. 第三项');
    assert.equal(await input.getAttribute('data-empty'), 'true', 'Sending restores the empty paragraph and placeholder');
  }
  assert.ok(counts.before >= 30, 'Baseline exercises the old global update path');
  assert.equal(counts.after, 0, 'Nonempty-to-nonempty typing must never rerender history');
  const input = page.locator('#input');
  await page.evaluate(() => { window.state.draft = '**外部草稿**'; window.state.changed(); });
  await input.locator('strong').waitFor();
  await input.fill('');
  assert.equal(await page.evaluate(() => window.state.draft), '');
  await input.evaluate(el => {
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', '{"name":"中文"}');
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
  });
  await page.locator('textarea#input').waitFor();
  await input.press('End');
  await input.pressSequentially(' ');
  assert.equal(await page.evaluate(() => window.state.draft), '{"name":"中文"} ');
  await input.press('Enter');
  assert.equal(await page.evaluate(() => window.sent.at(-1)), '{"name":"中文"} ');
  await page.locator('#input[contenteditable]').waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: history renders during continuous typing:', counts, '; immediate send, clear, external draft and JSON mode preserved.');
} finally {
  await browser?.close();
  await rm(dir, { recursive: true, force: true });
}
