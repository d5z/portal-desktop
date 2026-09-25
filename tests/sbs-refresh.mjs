// Real generated Loom + its desktop bridge, served only by a local fixture.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const { outputFiles } = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { AppModel } from './desktop/renderer/app/models/app';
  import { useModel } from './desktop/renderer/shared/hooks/use-model';
  import { Topbar } from './desktop/renderer/app/components/topbar';
  const app = new AppModel({ copyText: async text => { window.copiedScene = text; }, appearance: async theme => theme,
    changeChatSession: async () => snapshot });
  window.sbsApp = app;
  window.sbsStates = [];
  window.scopeStates = [];
  const scene = { scene_id: 'desktop-fixture', scene_meta: { client: 'portal-desktop/0.1.3', scene_label: '桌面·测试电脑' } };
  const snapshot = { settings: { endpoint: 'https://fixture.test/being', being: 'fixture', hasToken: true }, portal: { phase: 'stopped', logs: [] },
    chatScene: scene, chatSessions: [scene] };
  app.post = data => document.getElementById('chat-frame')?.contentWindow?.postMessage(data, location.origin);
  // HTTP transport for the fixture; production validates beings://chat and the same frame revision.
  window.addEventListener('message', event => {
    const frame = document.getElementById('chat-frame');
    if (!frame || event.source !== frame.contentWindow || event.origin !== location.origin) return;
    const message = event.data;
    if (message?.revision !== new URL(frame.src).searchParams.get('revision')) return;
    if (message.type === 'beings:history-scope-state' && ['current', 'all'].includes(message.scope)) {
      window.scopeStates.push(message.scope);
      app.setChatHistoryScope(message.scope);
    }
    if (message.type === 'beings:sbs-state') {
      window.sbsStates.push(message);
      if (typeof message.enabled === 'boolean') app.setSbsEnabled(message.enabled);
      else if (message.known === false) app.setSbsEnabled();
    }
  });
  function Fixture() {
    useModel(app);
    return <><Topbar model={app} /><iframe id="chat-frame" title="Loom fixture"
      src={'/loom' + new URL(app.chatSource).search} onLoad={() => app.frameLoaded()} /></>;
  }
  app.applySnapshot(snapshot);
  createRoot(document.getElementById('root')).render(<Fixture />);
` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic' });
const css = await readFile('desktop/renderer/app/styles.css', 'utf8');
const loom = await readFile('desktop/generated/loom.html', 'utf8');
const assets = new Map(await Promise.all(['chat.js', 'chat.css', 'highlight.css'].map(async file => [ '/' + file, await readFile('desktop/generated/' + file) ])));
let enabled = false, status = 200, malformed = false, holdReads = true, holdPatch = false, rejectPatch = false;
const reads = [], patches = [], pendingReads = [], pendingPatches = [];
const history = [
  { seq: 1, role: 'user', content: '当前桌面的对话', scene_id: 'desktop-fixture', at: '2026-09-15T08:00:00Z' },
  { seq: 2, role: 'being', content: '这是来自 Loom 网页的对话', scene_id: 'loom-fixture', at: '2026-09-15T08:00:01Z' },
  { seq: 3, role: 'being', content: '共享的历史消息', at: '2026-09-15T08:00:02Z' },
];
const historyReads = [];
const release = queue => { for (const finish of queue.splice(0)) finish(); };
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const json = (data, code = 200) => { response.writeHead(code, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data)); };
  if (url.pathname === '/api/llm/config') {
    if (request.method === 'PATCH') {
      let body = ''; for await (const chunk of request) body += chunk;
      const patch = JSON.parse(body); patches.push(patch);
      const finish = () => {
        if (rejectPatch) return json({ error: 'fixture rejection' }, 500);
        enabled = patch.sbs_enabled === 'on';
        json({ ok: true, config: { sbs_enabled: enabled, model: 'fixture', presets: [] } });
      };
      if (holdPatch) pendingPatches.push(finish); else finish();
    } else {
      const config = { model: 'fixture', presets: [], ...(malformed ? {} : { sbs_enabled: enabled }) }, code = status;
      reads.push(config);
      const finish = () => json(config, code);
      if (holdReads) pendingReads.push(finish); else finish();
    }
    return;
  }
  if (url.pathname === '/api/status') return json({ being_name: 'fixture' });
  if (url.pathname === '/api/history') {
    const after = Number(url.searchParams.get('after') || 0);
    historyReads.push(after);
    return json({ messages: history.filter(row => row.seq > after) });
  }
  if (url.pathname === '/api/stream/active') { response.writeHead(204); response.end(); return; }
  if (url.pathname === '/health') return json({ status: 'ok', commit: 'fixture' });
  if (assets.has(url.pathname)) {
    response.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css');
    response.end(assets.get(url.pathname)); return;
  }
  if (url.pathname === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(outputFiles[0].text); return; }
  if (url.pathname === '/loom') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(loom); return; }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>${css}body{display:block;background:var(--bg)}#chat-frame{height:650px}</style><body data-view="chat"><div id="root"></div><script src="/fixture.js"></script></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const until = async (predicate, timeout = 10000) => {
  const end = Date.now() + timeout;
  while (!await predicate()) { assert.ok(Date.now() < end, 'fixture request arrived'); await new Promise(resolve => setTimeout(resolve, 10)); }
};
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  const errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  const origin = 'http://127.0.0.1:' + server.address().port;
  await page.route('**/*', route => {
    if (route.request().url().startsWith(origin + '/')) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  const button = page.getByRole('button', { name: '切换 SBS 自主醒来', exact: true });
  const confirmed = value => page.waitForFunction(value => {
    const button = document.querySelector('.sbs-header-switch');
    return button?.getAttribute('aria-pressed') === String(value) && !button.disabled;
  }, value);
  const frame = () => page.frames().find(frame => frame.url().startsWith(origin + '/loom'));
  const request = () => page.evaluate(() => window.sbsApp.post({ type: 'beings:sbs-request' }));
  const requestFreshRead = async () => {
    const before = reads.length;
    // A request can share an in-flight startup/focus read of the previous value.
    // Once it settles, require a new GET before asserting the changed fixture.
    await until(async () => { await request(); return reads.length > before; });
  };
  await page.goto(origin);
  // Hosted Windows runners can take longer to mount the generated chat frame
  // after navigation; wait for its initial config request before checking SBS.
  try { await until(() => reads.length > 0, 30000); }
  catch (error) {
    const frameState = await page.evaluate(() => {
      const doc = document.querySelector('#chat-frame')?.contentDocument;
      return { inputReady: Boolean(doc?.querySelector('#input')), alert: doc?.querySelector('[role="alert"]')?.textContent };
    }).catch(() => undefined);
    throw new Error(`Initial Loom config request missing: ${JSON.stringify({ frames: page.frames().map(frame => frame.url()), frameState, errors, external })}`, { cause: error });
  }
  assert.equal(await button.isDisabled(), true);
  assert.equal(await button.getAttribute('aria-pressed'), null, 'Initial default is not confirmed state');
  assert.equal(await page.evaluate(() => window.sbsStates.length), 0);
  holdReads = false; release(pendingReads);
  await confirmed(false);

  // The upper-left scene indicator owns the persistent scene panel and details dialog.
  const sceneButton = page.locator('#chat-scene-indicator');
  const scenePanel = page.getByRole('complementary', { name: '场景列表' });
  const contextToggle = page.getByRole('checkbox', { name: '显示全部场景上下文', exact: true });
  const currentSceneButton = page.getByRole('button', { name: '切换到场景：桌面·测试电脑', exact: true });
  const chat = page.frameLocator('#chat-frame');
  await scenePanel.waitFor();
  await chat.getByText('当前桌面的对话', { exact: true }).waitFor();
  assert.equal(await chat.locator('.chat-history-scope').count(), 0, 'Embedded chat has no duplicate scope toolbar');
  assert.equal(await chat.getByText('这是来自 Loom 网页的对话', { exact: true }).count(), 0);
  await chat.locator('#input .cm-content').fill('切换时保留的草稿');
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/chat-scene-panel-light.png' });
  const beforeAll = historyReads.length;
  history.push({ seq: 4, role: 'being', content: '切换后从服务器取回的网页对话', scene_id: 'loom-fixture', at: '2026-09-15T08:00:03Z' });
  await contextToggle.check();
  await chat.getByText('这是来自 Loom 网页的对话', { exact: true }).waitFor();
  await chat.getByText('切换后从服务器取回的网页对话', { exact: true }).waitFor();
  assert.ok(historyReads.length > beforeAll, 'Switching to all scenes fetches the latest history');
  await page.waitForFunction(() => document.querySelector('#chat-scene-indicator .chat-scene-label').textContent === '桌面·测试电脑');
  assert.equal(await chat.locator('#input .cm-content').textContent(), '切换时保留的草稿');
  assert.equal(await chat.locator('#input .cm-content').isDisabled(), false, '全部场景上下文仍向当前场景发送');
  await sceneButton.click();
  assert.equal(await scenePanel.count(), 0);
  assert.equal(await sceneButton.evaluate(el => el === document.activeElement), true);
  await sceneButton.click();
  assert.equal(await contextToggle.isChecked(), true);
  assert.equal(await currentSceneButton.getAttribute('aria-current'), 'true');
  await page.getByRole('button', { name: '场景详情', exact: true }).click();
  await page.locator('#chat-scene-dialog[open]').waitFor();
  await page.getByRole('button', { name: '复制场景 ID', exact: true }).click();
  assert.equal(await page.evaluate(() => window.copiedScene), 'desktop-fixture');
  await page.getByRole('button', { name: '关闭场景详情', exact: true }).click();
  const beforeCurrent = historyReads.length;
  history.push({ seq: 5, role: 'being', content: '返回时从服务器取回的桌面对话', scene_id: 'desktop-fixture', at: '2026-09-15T08:00:04Z' });
  await contextToggle.uncheck();
  await chat.getByText('这是来自 Loom 网页的对话', { exact: true }).waitFor({ state: 'hidden' });
  await chat.getByText('返回时从服务器取回的桌面对话', { exact: true }).waitFor();
  assert.ok(historyReads.length > beforeCurrent, 'Returning to the current scene also refreshes history');
  assert.equal(await chat.getByText('切换后从服务器取回的网页对话', { exact: true }).count(), 0);
  assert.equal(await chat.locator('#input .cm-content').textContent(), '切换时保留的草稿');
  await page.waitForFunction(() => document.querySelector('#chat-scene-indicator .chat-scene-label').textContent === '桌面·测试电脑');
  // An out-of-date frame command cannot switch the current chat.
  const scopeReplies = await page.evaluate(() => {
    const count = window.scopeStates.length;
    window.sbsApp.post({ type: 'beings:history-scope', scope: 'all', revision: 'stale' });
    window.sbsApp.post({ type: 'beings:history-scope-request', revision: new URL(window.sbsApp.chatSource).searchParams.get('revision') });
    return count;
  });
  await page.waitForFunction(count => window.scopeStates.length > count, scopeReplies);
  assert.equal(await page.evaluate(() => window.scopeStates.at(-1)), 'current');
  assert.equal(await chat.getByText('这是来自 Loom 网页的对话', { exact: true }).count(), 0);
  await page.setViewportSize({ width: 420, height: 820 });
  await page.evaluate(async () => { await window.sbsApp.toggleTheme(); document.documentElement.dataset.theme = window.sbsApp.theme; });
  assert.equal(await scenePanel.evaluate(el => { const box = el.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth; }), true);
  await page.screenshot({ path: 'test-results/chat-scene-panel-dark-narrow.png' });
  await chat.locator('#input .cm-content').focus();
  assert.equal(await scenePanel.isVisible(), true, 'Typing keeps scene navigation open');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(async () => { await window.sbsApp.toggleTheme(); document.documentElement.dataset.theme = window.sbsApp.theme; });

  // Refresh preserves either explicitly selected history view in the real frame.
  for (const scope of ['all', 'current']) {
    await (scope === 'all' ? contextToggle.check() : contextToggle.uncheck());
    await page.waitForFunction(scope => window.sbsApp.chatHistoryScopeKnown && window.sbsApp.chatHistoryScope === scope, scope);
    const source = await page.locator('#chat-frame').getAttribute('src');
    await page.getByRole('button', { name: '刷新 Being 对话', exact: true }).click();
    await page.waitForFunction(source => document.querySelector('#chat-frame').getAttribute('src') !== source && window.sbsApp.chatHistoryScopeKnown && !window.sbsApp.chatLoading, source);
    assert.equal(await page.evaluate(() => window.sbsApp.chatHistoryScope), scope);
    await chat.getByText('当前桌面的对话', { exact: true }).waitFor();
    if (scope === 'all') await chat.getByText('这是来自 Loom 网页的对话', { exact: true }).waitFor();
    else assert.equal(await chat.getByText('这是来自 Loom 网页的对话', { exact: true }).count(), 0);
    assert.equal(await contextToggle.isChecked(), scope === 'all');
    assert.equal(await currentSceneButton.getAttribute('aria-current'), 'true');
    await confirmed(false);
  }

  // External SBS change + real refresh button reloads the frame and issues a new GET.
  enabled = true; holdReads = true;
  const beforeRefresh = reads.length;
  await page.getByRole('button', { name: '刷新 Being 对话', exact: true }).click();
  await until(() => reads.length > beforeRefresh);
  assert.equal(await button.getAttribute('aria-pressed'), null);
  holdReads = false; release(pendingReads);
  await confirmed(true);
  assert.equal(await page.evaluate(() => window.sbsApp.chatHistoryScope), 'current');
  // Keep a read of the previous value in flight while the server changes.
  holdReads = true;
  await until(async () => { await request(); return pendingReads.length > 0; });
  enabled = false;
  const beforeRequest = reads.length;
  setTimeout(() => { holdReads = false; release(pendingReads); }, 100);
  await requestFreshRead(); await confirmed(false);
  assert.ok(reads.length > beforeRequest, 'SBS request reads the server instead of the memory snapshot');

  // Ordinary Loom config reads and focus refreshes also notify the shell.
  enabled = true;
  await page.evaluate(() => window.sbsApp.post({ type: 'beings:chat-action', action: 'model' }));
  await confirmed(true);
  enabled = false;
  await frame().evaluate(() => window.dispatchEvent(new Event('focus')));
  await confirmed(false);

  // A rejected toggle must not optimistically flip the header.
  holdPatch = true; rejectPatch = true;
  await button.click(); await until(() => pendingPatches.length === 1);
  assert.equal(await page.evaluate(() => window.sbsApp.sbsEnabled), false);
  assert.equal(await button.isDisabled(), true);
  holdPatch = false; release(pendingPatches);
  await confirmed(false);
  rejectPatch = false;
  await button.click(); await confirmed(true);

  // An older pending GET cannot undo a subsequently confirmed successful toggle.
  holdReads = true;
  // A focus/config read from the previous step may still be shared by the
  // runtime. Request again once it settles until this fixture holds a new GET.
  await until(async () => { await request(); return pendingReads.length > 0; });
  await button.click();
  await confirmed(false);
  const beforeLateRead = await page.evaluate(() => window.sbsStates.length);
  holdReads = false; release(pendingReads);
  await request();
  await confirmed(false);
  assert.equal(await page.evaluate(index => window.sbsStates.slice(index).some(state => state.enabled === true), beforeLateRead), false);

  // Failed or malformed responses leave the state unknown; refresh recovers it.
  status = 503;
  await page.getByRole('button', { name: '刷新 Being 对话', exact: true }).click();
  await page.waitForFunction(() => window.sbsStates.at(-1)?.known === false);
  assert.equal(await button.isDisabled(), true);
  assert.equal(await button.getAttribute('aria-pressed'), null);
  status = 200; malformed = true;
  await requestFreshRead();
  assert.equal(await button.getAttribute('aria-pressed'), null);
  malformed = false; enabled = true;
  await page.getByRole('button', { name: '刷新 Being 对话', exact: true }).click();
  await confirmed(true);
  await page.reload(); await confirmed(true);
  assert.equal(patches.length, 3, 'Only explicit test toggles write configuration');
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log('PASS: Persistent scene panel, collapse/focus behavior, scope synchronization, draft preservation, responsive themes; SBS refresh, stale-read isolation and failure recovery.');
} finally {
  release(pendingReads); release(pendingPatches);
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
