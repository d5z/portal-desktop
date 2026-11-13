// Exercise the actual Markdown component with a controlled browser frame clock.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { build } from '../scripts/renderer-build.mjs';

const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Markdown } from './desktop/renderer/shared/components/markdown';
let time = 0, nextFrame = 0, root;
const frames = new Map();
if (!location.search.includes('realtime')) {
  window.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
  window.cancelAnimationFrame = id => frames.delete(id);
  performance.now = () => time;
}
window.tick = ms => {
  time += ms;
  const callbacks = [...frames.values()]; frames.clear();
  flushSync(() => callbacks.forEach(callback => callback(time)));
};
window.parentRenders = 0;
function App({ initial }) {
  const [props, setProps] = useState(initial);
  window.parentRenders++;
  window.update = patch => flushSync(() => setProps(previous => ({ ...previous, ...patch })));
  return <Markdown chat {...props} />;
}
window.mount = initial => {
  root = createRoot(document.querySelector('#root'));
  flushSync(() => root.render(<StrictMode><App initial={initial} /></StrictMode>));
};
window.unmount = () => flushSync(() => root.unmount());
window.snapshot = () => ({ text: document.querySelector('#root').textContent, pending: frames.size, parentRenders: window.parentRenders });
` }, bundle: true, write: false, format: 'iife', outfile: 'streaming.js', define: { 'process.env.NODE_ENV': '"development"' } });
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/streaming.js' ? 'text/javascript' : 'text/html; charset=utf-8');
  res.end(req.url === '/streaming.js' ? bundle.outputFiles.find(file => file.path.endsWith('.js')).contents
    : '<div id="root"></div><script src="/streaming.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.waitForFunction(() => typeof window.mount === 'function');
  const text = '连续显示中文和 emoji 🌱，避免整段突然跳出。'.repeat(12);

  await page.evaluate(content => mount({ content, streaming: false }), text);
  assert.equal((await page.evaluate(() => snapshot())).text, text, 'History appears immediately');
  assert.equal((await page.evaluate(() => snapshot())).pending, 0);
  await page.evaluate(() => unmount());

  await page.evaluate(content => mount({ content, streaming: true }), text);
  const initial = await page.evaluate(() => snapshot());
  assert.ok(initial.text.length > 0 && initial.text.length < text.length, 'First packet must not appear as one block');
  assert.equal(initial.pending, 1, 'StrictMode leaves exactly one frame writer');
  const samples = [];
  for (let i = 0; i < 16; i++) {
    samples.push(await page.evaluate(() => { tick(16); return snapshot(); }));
  }
  assert.ok(new Set(samples.map(sample => sample.text)).size >= 10, 'A burst is distributed across paint frames');
  for (let i = 0; i < samples.length; i++) {
    assert.ok(text.startsWith(samples[i].text));
    assert.ok(samples[i].text.length >= (samples[i - 1]?.text.length || initial.text.length));
    assert.ok(samples[i].text.isWellFormed(), 'Never paint a split surrogate pair');
    assert.equal(samples[i].parentRenders, initial.parentRenders, 'Animation must not rerender the chat parent');
  }
  assert.equal(samples.at(-1).text, text, 'Even large packets catch up promptly');
  assert.equal(samples.at(-1).pending, 0, 'No idle animation loop');

  const final = text + '结束包也应连续输出，最后一个字不能丢。'.repeat(20);
  await page.evaluate(content => update({ content }), final);
  await page.evaluate(() => tick(16));
  const beforeStop = await page.evaluate(() => snapshot());
  await page.evaluate(() => update({ streaming: false }));
  assert.equal((await page.evaluate(() => snapshot())).text, beforeStop.text, 'Stopping does not dump the buffered tail');
  await page.evaluate(() => { for (let i = 0; i < 16; i++) tick(16); });
  assert.equal((await page.evaluate(() => snapshot())).text, final, 'Final text is complete and unique');
  assert.equal((await page.evaluate(() => snapshot())).pending, 0);

  await page.evaluate(() => update({ content: '另一条历史消息', streaming: false }));
  assert.equal((await page.evaluate(() => snapshot())).text, '另一条历史消息', 'Replacement resets immediately');
  await page.evaluate(() => unmount());
  await page.evaluate(content => mount({ content, streaming: true }), text);
  await page.evaluate(() => update({ content: '重连后的完整内容', streaming: false }));
  assert.equal((await page.evaluate(() => snapshot())).text, '重连后的完整内容');
  assert.equal((await page.evaluate(() => snapshot())).pending, 0, 'Replacement cancels the old writer');
  await page.evaluate(() => unmount());

  // Frequent one-character packets at 120 Hz must retain fractional progress.
  await page.evaluate(() => mount({ content: '开', streaming: true }));
  const frequent = await page.evaluate(() => {
    let source = '开', changes = 0, previous = snapshot().text;
    for (let i = 0; i < 120; i++) {
      source += '字'; update({ content: source }); tick(1000 / 120);
      const current = snapshot().text;
      if (current !== previous) changes++;
      previous = current;
    }
    update({ streaming: false });
    for (let i = 0; i < 32; i++) tick(1000 / 120);
    return { changes, source, ...snapshot() };
  });
  assert.ok(frequent.changes > 60, 'Rapid packets must not starve the animation');
  assert.equal(frequent.text, frequent.source);
  await page.evaluate(() => unmount());

  await page.evaluate(() => mount({ content: '```javascript\nconst complete = true;\n```', streaming: true }));
  await page.evaluate(() => { tick(80); update({ streaming: false }); });
  assert.equal(await page.locator('code .hljs-keyword').count(), 0, 'Do not highlight an unfinished visual tail');
  await page.evaluate(() => { for (let i = 0; i < 16; i++) tick(16); });
  assert.equal(await page.locator('pre code').textContent(), 'const complete = true;');
  assert.ok(await page.locator('code .hljs-keyword').count() > 0, 'Highlight once the complete code is visible');
  await page.evaluate(() => unmount());

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(content => mount({ content, streaming: true }), text);
  assert.equal((await page.evaluate(() => snapshot())).text, text, 'Respect reduced motion');
  assert.equal((await page.evaluate(() => snapshot())).pending, 0);
  await page.evaluate(() => unmount());
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(content => mount({ content, streaming: true }), text);
  await page.evaluate(() => unmount());
  assert.equal((await page.evaluate(() => snapshot())).pending, 0, 'Unmount cancels pending animation');

  // Confirm the real browser clock also paints intermediate, monotonic text.
  await page.goto('http://127.0.0.1:' + server.address().port + '/?realtime');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const paints = await page.evaluate(content => new Promise(resolve => {
    const values = [];
    const observer = new MutationObserver(() => {
      values.push(snapshot().text);
      if (values.at(-1) === content) { observer.disconnect(); resolve(values); }
    });
    observer.observe(document.querySelector('#root'), { childList: true, characterData: true, subtree: true });
    mount({ content, streaming: true });
  }), text);
  assert.ok(new Set(paints).size >= 3, 'Real paint frames reveal intermediate text: ' + JSON.stringify(paints.map(value => value.length)));
  assert.ok(paints.every((value, index) => text.startsWith(value) && (!index || value.length >= paints[index - 1].length)), 'Real frame timestamps must not move the reveal backwards');
  assert.deepEqual(errors, []);
  console.log('PASS: smooth packet reveal, bounded catch-up, final drain, Unicode, 120 Hz, isolated renders, history, code highlighting and cleanup.');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
