// Real Chromium/IndexedDB persistence, using an isolated profile and local API.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const assets = new Map(await Promise.all(['loom.html', 'chat.js', 'chat.css', 'highlight.css', 'client-context.html', 'client-context.js'].map(async file => ['/' + file, await readFile('desktop/generated/' + file)])));
const profile = await mkdtemp(path.join(os.tmpdir(), 'portal-chat-history-'));
let history = [], seq = 0, offline = false;
const queries = [], sent = [];
const append = (role, content, scene_id) => history.push({ seq: ++seq, role, content, scene_id, at: new Date().toISOString(), token: 'must-not-be-cached', attachments: ['not-history-fields'] });
for (let i = 1; i <= 100; i++) append(i % 2 ? 'user' : 'being', `历史 ${i}`, i % 3 ? 'loom-Willow' : 'town-mail');
history[2].scene_meta = { scene_label: '小镇私信', token: 'must-not-be-cached' };
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const json = (data, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data)); };
  if (url.pathname.startsWith('/api/') || url.pathname === '/health') {
    if (offline) return json({ error: 'offline fixture' }, 503);
    if (url.pathname === '/api/history') {
      const after = url.searchParams.get('after'); queries.push(after);
      return json({ messages: after === null ? history.slice(-100) : history.filter(m => m.seq > Number(after)).slice(0, 100) });
    }
    if (url.pathname === '/api/status') return json({ being_id: 'willow-id', being_name: 'Willow' });
    if (url.pathname === '/api/stream/active') { response.writeHead(204); response.end(); return; }
    if (url.pathname === '/api/llm/config') return json({ sbs_enabled: false });
    if (url.pathname === '/health') { response.end('OK fixture'); return; }
    if (url.pathname === '/api/chat/stream') {
      let body = ''; for await (const chunk of request) body += chunk;
      const input = JSON.parse(body); sent.push(input); append('user', input.message, 'town-mail');
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write('event: meta\ndata: {"stream_id":"history-fixture"}\n\n');
      // The history cursor sync at meta must not swallow the reply sync.
      setTimeout(() => {
        append('being', '已持久化的流式回复', 'another-client');
        response.end('event: content_block_delta\ndata: {"scene_id":"another-client","delta":{"text":"已持久化的流式回复"}}\n\nevent: message_stop\ndata: {}\n\n');
      }, 100);
      return;
    }
    return json({ error: 'unexpected route' }, 404);
  }
  if (url.pathname === '/empty') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>History test</title>'); return; }
  if (!assets.has(url.pathname)) { response.writeHead(404); response.end(); return; }
  response.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
  response.end(assets.get(url.pathname));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const dbName = 'loom-history-' + encodeURIComponent(origin);
let context, page;
const errors = [];
async function launch() {
  context = await chromium.launchPersistentContext(profile, { headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  page = context.pages()[0]; page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
}
async function open(suffix = '') {
  await page.goto(origin + '/loom.html?revision=' + Math.random() + suffix);
  await page.waitForFunction(() => performance.getEntriesByName('loom:ready').length > 0);
}
async function cached() {
  return page.evaluate(name => new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['messages', 'meta']);
      const rows = tx.objectStore('messages').getAll(), meta = tx.objectStore('meta').get('state');
      tx.oncomplete = () => { db.close(); resolve({ messages: rows.result, meta: meta.result }); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }), dbName);
}
async function waitCache(count) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const snapshot = await cached();
    if (snapshot.messages.length === count && snapshot.meta?.lastSeq === seq) return snapshot;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(`Cache did not commit ${count} messages and cursor ${seq}`);
}
async function clearCache() {
  await page.goto(origin + '/empty'); // Dispose the mounted runtime first.
  await page.evaluate(name => new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  }), dbName);
}
try {
  await launch(); await open('&name=Willow');
  await waitCache(100);
  assert.equal(await page.locator('#messages .message').count(), 100);
  await page.getByText('历史 3', { exact: true }).waitFor(); // A different scene remains visible.
  await page.locator('#input').fill('本地记录验证'); await page.locator('#send-btn').click();
  await page.getByText('已持久化的流式回复', { exact: true }).waitFor();
  const initial = await waitCache(102);
  assert.equal(sent[0].scene_id, 'loom-willow-id', 'Standalone browsers use the Being identity rather than its display name');
  assert.deepEqual(sent[0].scene_meta, { client: 'loom/1.8.2', scene_label: 'Loom' });
  assert.equal(JSON.stringify(initial).includes('must-not-be-cached'), false);
  assert.equal(JSON.stringify(initial).includes('not-history-fields'), false);
  assert.ok(initial.messages.some(m => m.scene_id === 'town-mail'));
  assert.ok(initial.messages.some(m => m.scene_id === 'another-client'));
  assert.equal(initial.messages.find(m => m.seq === 3).scene_label, '小镇私信');
  assert.equal(initial.messages.some(m => m.scene_meta), false);
  // Switching views uses one all-scene cache/cursor and preserves the draft and reading position.
  await open('&name=Willow&scene_id=loom-Willow&scene_label=Loom');
  assert.equal(await page.getByRole('button', { name: '当前场景', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#messages .message').count(), 67);
  assert.equal(await page.getByText('历史 3', { exact: true }).count(), 0);
  await page.locator('#input').fill('切换时保留草稿');
  await page.locator('#messages').evaluate(el => { el.scrollTop = 120; });
  await page.waitForFunction(() => document.querySelector('#messages').scrollTop === 120);
  const queryCount = queries.length;
  await page.getByRole('button', { name: '全部场景', exact: true }).click();
  assert.equal(await page.locator('#messages .message').count(), 102);
  assert.equal(await page.getByText('历史 3', { exact: true }).count(), 1);
  assert.ok(await page.locator('.message-scene').getByText('town-mail', { exact: true }).count());
  assert.equal(await page.locator('#input').inputValue(), '切换时保留草稿');
  assert.match(await page.locator('.chat-scope-caption').textContent(), /发送到：Loom/);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/chat-scenes-all.png' });
  await page.getByRole('button', { name: '当前场景', exact: true }).click();
  assert.equal(await page.locator('#messages .message').count(), 67);
  assert.equal(await page.locator('#messages').evaluate(el => el.scrollTop), 120);
  assert.equal(queries.length, queryCount, 'Scope changes do not reset or refetch the global history cursor');
  assert.equal((await cached()).messages.length, 102);
  await page.screenshot({ path: 'test-results/chat-scenes-current.png' });
  await context.close(); context = null;

  // Close the browser process, then restart against the same profile offline.
  offline = true; await launch(); await open('&name=ChangedDisplayName&theme=dark');
  assert.equal(await page.locator('#messages .message').count(), 102);
  assert.equal(await page.getByText('已持久化的流式回复', { exact: true }).count(), 1);
  await page.getByText('历史 3', { exact: true }).waitFor();

  // A gap larger than one page must not skip the earliest missed messages.
  offline = false;
  for (let i = 1; i <= 250; i++) append('being', `离线期间 ${i}`, i % 2 ? 'town-mail' : 'loom-Willow');
  queries.length = 0; await open(); await waitCache(352);
  assert.ok(queries.includes('102') && queries.includes('202') && queries.includes('302'));
  assert.equal(await page.locator('#messages .message').count(), 352);
  assert.equal(await page.getByText('离线期间 1', { exact: true }).count(), 1);
  assert.equal(await page.getByText('离线期间 250', { exact: true }).count(), 1);

  // Latest-window responses do not erase earlier cached history. The 300 limit
  // bounds rendering only, not retention in IndexedDB.
  history = history.slice(-5); await open();
  assert.equal(await page.locator('#messages .message').count(), 300);
  assert.equal((await cached()).messages.length, 352);
  // The client reader shares IDB but does not require a mounted chat UI.
  const reader = await context.newPage();
  await reader.goto(origin + '/client-context.html');
  const run = (verb, args = '', sceneId) => reader.evaluate(
    ([endpoint, verb, args, sceneId]) => window.clientCommand(endpoint, verb, args, sceneId),
    [origin, verb, args, sceneId]);
  const crossScene = await run('context', 'town-mail');
  assert.equal((crossScene.match(/\] (user|being):/g) || []).length, 50);
  assert.ok(crossScene.indexOf('离线期间 153') < crossScene.indexOf('离线期间 249'));
  assert.ok(!crossScene.includes('离线期间 250'));
  assert.equal(await run('context', '', 'town-mail'), crossScene);
  // This scene is older than the visible 300-message window.
  assert.match(await run('context', 'another-client'), /已持久化的流式回复/);
  const scenes = await run('scenes');
  assert.match(scenes, /town-mail — 小镇私信.*messages: 159/);
  assert.match(scenes, /another-client.*messages: 1/);
  assert.match(await reader.evaluate(endpoint => window.clientCommand(endpoint, 'scenes', ''), origin + '/other-being'), /No locally cached scenes/);
  await reader.close();
  await clearCache(); await open();
  assert.equal(await page.locator('#messages .message').count(), 5);
  await waitCache(5);

  // Failed writes leave no advanced cursor; rendering still uses the network.
  await clearCache();
  await context.addInitScript(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(...args) {
      const tx = original.apply(this, args);
      if (args[1] === 'readwrite') queueMicrotask(() => tx.abort());
      return tx;
    };
  });
  await open();
  assert.equal(await page.locator('#messages .message').count(), 5);
  const failed = await cached();
  assert.deepEqual(failed.messages, []); assert.equal(failed.meta, undefined);
  await context.close(); context = null;

  await launch();
  await context.addInitScript(() => Object.defineProperty(globalThis, 'indexedDB', { value: { open() { throw new Error('storage unavailable'); } } }));
  await open();
  assert.equal(await page.locator('#messages .message').count(), 5);
  assert.deepEqual(errors, []);
  console.log('PASS: IndexedDB survives process restart offline, retains all returned sources and live replies, paginates 250 missed messages, keeps older records beyond the render limit, and falls back after storage failures.');
} finally {
  await context?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  const target = path.resolve(profile), temp = path.resolve(os.tmpdir());
  if (path.dirname(target) !== temp || !path.basename(target).startsWith('portal-chat-history-')) throw new Error('Unexpected test profile path');
  await rm(target, { recursive: true, force: true });
}
