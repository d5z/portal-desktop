// Verify subscription lifetimes with the actual production hooks under React StrictMode.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React, { StrictMode, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import useEventListener from 'ahooks/es/useEventListener';
import { useFileDrop } from './desktop/renderer/chat/hooks/use-file-drop';
import { useChatViewport } from './desktop/renderer/chat/hooks/use-chat-viewport';
import { useChatShortcuts } from './desktop/renderer/chat/hooks/use-chat-shortcuts';
import { useMenuDismiss } from './desktop/renderer/shared/hooks/use-menu-dismiss';
window.calls = []; window.viewportCommits = 0;
function Harness({ value, open, targetIndex }) {
  const first = useRef(null), second = useRef(null), menu = useRef(null);
  const { viewport } = useChatViewport(true);
  useLayoutEffect(() => { window.viewportCommits++; window.viewportWidth = viewport.width; }, [viewport]);
  const { dragging, dropHandlers } = useFileDrop('scene', files => window.calls.push('files:' + files.length));
  useChatShortcuts({ send: message => window.calls.push(message.type) }, value, text => window.calls.push(text), false);
  useMenuDismiss(open, menu, (...args) => { window.closeArgumentCount = args.length; window.calls.push('close:' + value); }, () => window.calls.push('scroll:' + value));
  useEventListener('fixture', () => window.calls.push('target:' + value), { target: () => targetIndex === 0 ? first.current : second.current });
  return <div id="drop" {...dropHandlers} data-dragging={dragging}><div id="menu" ref={menu}/><div id="first" ref={first}/><div id="second" ref={second}/></div>;
}
function App() {
  const [props, update] = useState({value:'old',open:false,targetIndex:0});
  window.update = patch => flushSync(() => update(previous => ({...previous,...patch})));
  return <Harness {...props}/>;
}
let root;
window.mount = () => { root = createRoot(document.querySelector('#root')); flushSync(() => root.render(<StrictMode><App/></StrictMode>)); };
window.unmount = () => flushSync(() => root.unmount());
` }, bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"development"' } });
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/hooks.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/hooks.js' ? result.outputFiles[0].contents : '<div id="root"></div><script src="/hooks.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
    const active = new Map(); let registrations = 0;
    const watched = (target, type) => (target === window || target === document) && ['keydown','blur','resize','scroll','pointerdown','pointermove','pointerup','drop','dragend','visibilitychange'].includes(type);
    const key = (target, type, options) => (target === window ? 'window:' : 'document:') + type + ':' + !!(typeof options === 'boolean' ? options : options?.capture);
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      if (watched(this, type)) { const k = key(this, type, options); if (!active.has(k)) active.set(k, new Set()); active.get(k).add(listener); registrations++; }
      return add.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function(type, listener, options) {
      if (watched(this, type)) active.get(key(this, type, options))?.delete(listener);
      return remove.call(this, type, listener, options);
    };
    window.stats = () => ({ registrations, active: Object.fromEntries([...active].filter(([, handlers]) => handlers.size).map(([k, handlers]) => [k, handlers.size])) });
    const request = requestAnimationFrame, cancel = cancelAnimationFrame, frames = new Set();
    window.requestAnimationFrame = callback => { const id = request(time => { frames.delete(id); callback(time); }); frames.add(id); return id; };
    window.cancelAnimationFrame = id => { frames.delete(id); cancel(id); };
    window.pendingFrames = () => frames.size;
  });
  await page.goto('http://127.0.0.1:' + server.address().port);
  // Warm Playwright's injected helpers before recording the non-app listener baseline.
  await page.waitForFunction(() => typeof window.mount === 'function');
  const beforeMount = await page.evaluate(() => stats());
  await page.evaluate(() => mount());
  await page.waitForFunction(() => window.update && pendingFrames() === 0);
  const idle = await page.evaluate(() => stats());
  assert.equal(idle.active['document:keydown:true'], 1, 'StrictMode must leave one shortcut listener');
  assert.equal(idle.active['document:pointerdown:true'], undefined, 'Closed menu has no dismissal listeners');
  assert.equal(idle.active['window:pointermove:true'], undefined, 'Idle drag has no recovery listeners');
  const commits = await page.evaluate(() => viewportCommits);
  await page.evaluate(() => { for(let i=0;i<50;i++) window.dispatchEvent(new Event('resize')); });
  await page.waitForFunction(() => pendingFrames() === 0);
  assert.equal(await page.evaluate(() => viewportCommits), commits, 'Unchanged viewport bursts must not commit');
  const changedWidth = await page.evaluate(() => {
    const start = innerWidth;
    for(let i=1;i<=50;i++) {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: start + i });
      window.dispatchEvent(new Event('resize'));
    }
    if (pendingFrames() !== 1) throw new Error('Viewport burst should queue one frame');
    return innerWidth;
  });
  await page.waitForFunction(() => pendingFrames() === 0);
  assert.equal(await page.evaluate(() => viewportCommits), commits + 1, 'Changed viewport burst commits once');
  assert.equal(await page.evaluate(() => viewportWidth), changedWidth, 'Viewport keeps the final dimensions');
  await page.evaluate(() => update({ value: 'fresh', open: true }));
  const opened = await page.evaluate(() => stats());
  await page.evaluate(() => { for(let i=0;i<20;i++) update({ value: 'fresh-' + i }); });
  assert.equal((await page.evaluate(() => stats())).registrations, opened.registrations, 'Renders/handler changes must not rebind listeners');
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', {key:'l', code:'KeyL', ctrlKey:true, bubbles:true, cancelable:true})));
  assert.equal(await page.evaluate(() => calls.at(-1)), 'fresh-19', 'Shortcut sees latest selection');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.equal(await page.evaluate(() => closeArgumentCount), 0, 'Dismissal must not pass Event as a restore-focus argument');
  await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  assert.equal(await page.evaluate(() => calls.at(-1)), 'close:fresh-19', 'Menu dismissal sees latest handler');
  await page.evaluate(() => { update({ targetIndex: 1 }); window.calls = []; document.querySelector('#first').dispatchEvent(new Event('fixture')); document.querySelector('#second').dispatchEvent(new Event('fixture')); });
  assert.deepEqual(await page.evaluate(() => calls), ['target:fresh-19'], 'Target replacement removes old subscription');
  await page.evaluate(() => update({ open: false }));
  assert.deepEqual((await page.evaluate(() => stats())).active, idle.active);
  for(let i=0;i<3;i++) {
    await page.evaluate(() => { const dataTransfer = new DataTransfer(); dataTransfer.items.add(new File(['x'], 'x.txt')); document.querySelector('#drop').dispatchEvent(new DragEvent('dragenter', {dataTransfer, bubbles:true, cancelable:true})); });
    await page.waitForFunction(() => stats().active['window:pointermove:true'] === 1);
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})));
    await page.waitForFunction(() => !stats().active['window:pointermove:true']);
    assert.deepEqual((await page.evaluate(() => stats())).active, idle.active);
  }
  await page.evaluate(() => {
    window.dispatchEvent(new Event('resize'));
    if (!pendingFrames()) throw new Error('Expected pending viewport frame');
    unmount();
    if (pendingFrames()) throw new Error('Unmount must cancel pending viewport frame');
  });
  assert.deepEqual((await page.evaluate(() => stats())).active, beforeMount.active, 'Unmount removes all owned global listeners');
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => mount());
    await page.waitForFunction(() => pendingFrames() === 0);
    await page.evaluate(() => unmount());
    assert.deepEqual((await page.evaluate(() => stats())).active, beforeMount.active, 'Repeated mounts must not accumulate listeners');
  }
  assert.deepEqual(errors, []);
  console.log('PASS: StrictMode, stable subscriptions, fresh handlers, target replacement, drag/menu cleanup, unchanged viewport bursts and frame cancellation.');
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
