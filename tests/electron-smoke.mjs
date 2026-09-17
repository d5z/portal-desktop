// Runs the packaged Electron app against a local HTTP + WSS fixture and the real Rust engine.
// Never sends a chat or executes a tool against a real Being.
import { launchDesktop } from './support/electron-lifecycle.mjs';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { desktopExecutable, backgroundCoverage, waitForChatReady, clickChatControl, clickWhenPointerReady } from './support/desktop.mjs';
import { c as archive } from 'tar';

const executablePath = await desktopExecutable();
const background = backgroundCoverage();
if (!background.enabled) console.log('SKIP: ' + background.reason);

const dir = await mkdtemp(path.join(tmpdir(), 'beings-e2e-'));
const token = 'local-fixture-token';
const messages = [{ seq: 1, role: 'being', content: '你好，我在这里。我们可以从一个想法开始。', at: new Date().toISOString() }];
let seq = 2, rpcID = 0, relay = null, chatBody = null, stopCount = 0, handshakeCount = 0;
let llmConfig = {
  model: 'test-model',
  provider: 'test',
  presets: [
    { id: 'test', label: 'Test Model', provider: 'test', model: 'test-model', has_key: true },
    { id: 'alternate', label: 'Alternate Model', provider: 'anthropic', model: 'alternate-model', has_key: true },
  ],
};
const llmPatches = [];
const pending = new Map();
const rpc = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++rpcID;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC timed out: ${method}`)); }, 8000);
  pending.set(id, { resolve, reject, timer });
  relay.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
});
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const json = (data, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data)); };
  if (url.searchParams.get('token') !== token) return json({ error: 'unauthorized' }, 401);
  if (url.pathname.endsWith('/api/status')) return json({ being_name: 'Willow', description: '在这里，陪你把想法变成现实。' });
  if (url.pathname.endsWith('/health')) return json({ status: 'ok', commit: 'test' });
  if (url.pathname.endsWith('/api/history')) return json({ messages });
  if (url.pathname.endsWith('/api/stream/active')) { response.writeHead(204); response.end(); return; }
  if (url.pathname.endsWith('/api/stop')) { stopCount++; return json({ ok: true }); }
  if (url.pathname.endsWith('/api/llm/config')) {
    assert.equal(request.headers['x-relay-secret'], token);
    if (request.method !== 'PATCH') return json(llmConfig);
    let body = ''; for await (const chunk of request) body += chunk;
    const patch = JSON.parse(body); llmPatches.push(patch);
    llmConfig = { ...llmConfig, ...patch };
    return json({ ok: true, config: llmConfig });
  }
  if (url.pathname.endsWith('/api/chat/stream')) {
    let body = ''; for await (const chunk of request) body += chunk;
    chatBody = JSON.parse(body);
    messages.push({ seq: seq++, role: 'user', content: chatBody.message, at: new Date().toISOString() });
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const event = (name, data) => response.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    event('meta', { stream_id: 'fixture-stream' });
    event('content_block_delta', { delta: { text: '正在整理你的想法。' } });
    await new Promise(resolve => setTimeout(resolve, 350));
    if (chatBody.message === 'test-stop') {
      event('thinking', { text: '测试停止中的任务' });
      const timer = setTimeout(() => { event('message_stop', {}); response.end(); }, 8000);
      response.on('close', () => clearTimeout(timer)); return;
    }
    event('tool_use', { name: 'portal_file_write', input: { path: 'hello.txt', content: '来自 Being 的问候' } });
    const result = await rpc('tools/call', { name: 'portal_file_write', arguments: { path: 'hello.txt', content: '来自 Being 的问候' } });
    event('tool_result', { name: 'portal_file_write', content: result, is_error: false });
    event('content_block_delta', { delta: { text: '\n\n已在工作目录创建 **hello.txt**，本机 Portal 已完成操作。' } });
    messages.push({ seq: seq++, role: 'being', content: '正在整理你的想法。\n\n已在工作目录创建 **hello.txt**，本机 Portal 已完成操作。', at: new Date().toISOString() });
    event('message_stop', { session_id: 'fixture-session' }); response.end(); return;
  }
  json({ error: 'not found' }, 404);
});
const wss = new WebSocketServer({ server, path: '/_relay' });
wss.on('connection', socket => {
  let ready = false;
  socket.on('message', data => {
    const msg = JSON.parse(data.toString());
    if (!ready) {
      assert.equal(msg.loom_token, token); assert.equal(msg.being_id, 'willow');
      socket.send(JSON.stringify({ ok: true, being_id: 'willow', relay_keepalive: 'text-v1' }));
      relay = socket; ready = true; handshakeCount++; return;
    }
    if (msg.type === 'keepalive') { socket.send(JSON.stringify({ type: 'keepalive_ack' })); return; }
    const entry = pending.get(msg.id);
    if (entry) { pending.delete(msg.id); clearTimeout(entry.timer); msg.error ? entry.reject(new Error(JSON.stringify(msg.error))) : entry.resolve(msg.result); }
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
let app;
let pid;
let backgroundTest = false;
let cleanupPromise;
let traceContext;
async function saveTrace() {
  if (!traceContext) return;
  const context = traceContext; traceContext = null;
  await mkdir('test-results', { recursive: true });
  await context.tracing.stop({ path: 'test-results/desktop-trace.zip' });
}
async function openOptions(page) {
  const options = page.locator('#conversation-options');
  if (await page.locator('#options-trigger').getAttribute('aria-expanded') !== 'true') await clickWhenPointerReady(page, options.locator('summary'));
  await page.waitForFunction(() => document.querySelector('#options-trigger').getAttribute('aria-expanded') === 'true');
  await options.locator('.options-menu').evaluate(async element => {
    await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {})));
  });
  return options;
}
async function openClientSettings(page) {
  const options = await openOptions(page);
  await clickWhenPointerReady(page, options.locator('#client-settings-button'));
  await page.locator('#client-settings-dialog').waitFor({ state: 'visible' });
}
async function openChatSearch(page) {
  const toggle = page.locator('#toggle-chat-search');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await (await openOptions(page)).locator('#toggle-chat-search').click();
}
async function openPlace(page, view) {
  if (view === 'chat') { await page.locator('#back-to-chat').click(); return; }
  if (view === 'portal') { await openClientSettings(page); await page.locator('#client-settings-dialog [data-view="portal"]').click(); }
  else await (await openOptions(page)).locator(`[data-view="${view}"]`).click();
}
function cleanup() {
  return cleanupPromise ??= (async () => {
    await saveTrace().catch(() => {});
    if (app) await app.close().catch(() => {});
    if (backgroundTest) {
      const label = 'town.beings.portal-desktop.portal.' + createHash('sha256').update(path.join(dir, 'profile')).digest('hex').slice(0, 16);
      const run = promisify(execFile);
      await run('/bin/launchctl', ['bootout', `gui/${process.getuid()}/${label}`]).catch(() => {});
      await rm(path.join(homedir(), 'Library/LaunchAgents', label + '.plist'), { force: true });
      await run('/bin/launchctl', ['enable', `gui/${process.getuid()}/${label}`]).catch(() => {});
    }
    for (const client of wss.clients) client.terminate();
    wss.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  })();
}
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, () => { void cleanup().finally(() => process.exit(code)); });
}
try {
  app = await launchDesktop({ executablePath, env: { ...process.env, PORTAL_DESKTOP_USER_DATA: path.join(dir, 'profile') } });
  const page = await app.firstWindow();
  traceContext = app.context();
  await traceContext.tracing.start({ screenshots: true, snapshots: true });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: '连接我的 Being' }).click();
  await page.locator('#connection-link').fill(`http://127.0.0.1:${port}/willow/?token=${token}`);
  await page.locator('#portal-name-input').fill('react-smoke');
  await page.locator('#workspace-input').fill(path.join(dir, '工作目录'));
  await page.locator('#background-input').uncheck();
  await page.getByRole('button', { name: '保存、连接并启动' }).click();
  await page.waitForFunction(() => !document.querySelector('#settings-dialog').open, { timeout: 15000 });
  const frame = page.frameLocator('#chat-frame');
  await frame.getByText('你好，我在这里。我们可以从一个想法开始。').waitFor();
  const childFrame = page.frames().find(frame => frame.url().startsWith('beings://chat'));
  assert.equal(await childFrame.evaluate(() => typeof window.beings), 'undefined');
  assert.equal(await childFrame.evaluate(() => typeof require), 'undefined');
  assert.equal(await childFrame.evaluate(() => document.documentElement.outerHTML.includes('local-fixture-token')), false);
  assert.equal(await childFrame.evaluate(async () => (await fetch('/api/exec')).status), 404);
  // Load a real local stdio Kit through the same Portal configuration the client imports.
  const kitDir = path.join(dir, 'kits/desktop-fixture'); await mkdir(kitDir, { recursive: true });
  await writeFile(path.join(kitDir, 'manifest.json'), JSON.stringify({ name: 'desktop-fixture', version: '1.0.0', command: [process.execPath, 'server.mjs'], tools: [{ name: 'ping', description: 'Fixture ping', params: { type: 'object', properties: { value: { type: 'string' } } } }] }));
  await writeFile(path.join(kitDir, 'server.mjs'), `import readline from 'node:readline';
readline.createInterface({ input: process.stdin }).on('line', line => {
 const request = JSON.parse(line); if (request.id == null) return;
 const result = request.method === 'initialize' ? { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } : request.method === 'tools/list' ? { tools: [{ name: 'ping', description: 'Fixture ping', inputSchema: { type: 'object' } }] } : { content: [{ type: 'text', text: 'Kit reply: ' + request.params.arguments.value }] };
 process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + String.fromCharCode(10));
});`);
  const importedConfig = path.join(dir, 'portal.toml');
  await writeFile(importedConfig, `workspace = ${JSON.stringify(path.join(dir, '工作目录'))}\nkits_dir = ${JSON.stringify(path.join(dir, 'kits'))}\nkits_enabled = true\n[tools]\nexec = false\nscreenshot = false\n`);
  await page.evaluate(async config => { const { settings } = await window.beings.snapshot(); await window.beings.save({ ...settings, portalConfigPath: config, kitsEnabled: true }); }, importedConfig);
  await openPlace(page, 'portal');
  await page.waitForFunction(() => document.querySelector('#portal-phase').textContent === '已连接', { timeout: 20000 });
  pid = (await page.evaluate(() => window.beings.snapshot())).portal.pid;
  const list = await rpc('tools/list');
  assert(list.tools.some(tool => tool.name === 'portal_file_write'));
  assert(list.tools.some(tool => tool.name === 'desktop_fixture_ping'));
  const kitReply = await rpc('tools/call', { name: 'desktop_fixture_ping', arguments: { value: 'connected' } });
  assert(JSON.stringify(kitReply).includes('Kit reply: connected'));
  // Install a second real Kit through the client's Grove download IPC. Portal
  // owns discovery and hot reload, so the connection must remain uninterrupted.
  const downloadedSource = path.join(dir, 'download-source'); await mkdir(downloadedSource);
  await writeFile(path.join(downloadedSource, 'manifest.json'), JSON.stringify({ name: 'client-download', version: '1.0', command: [process.execPath, 'server.mjs'], tools: [{ name: 'ping', description: 'Downloaded fixture ping' }] }));
  await writeFile(path.join(downloadedSource, 'server.mjs'), await readFile(path.join(kitDir, 'server.mjs')));
  const downloadedArchive = path.join(dir, 'download.tar.gz'); await archive({ gzip: true, cwd: downloadedSource, file: downloadedArchive }, ['manifest.json', 'server.mjs']);
  await app.evaluate(({ protocol }, bundle) => {
    protocol.handle('https', request => new URL(request.url).pathname === '/api/grove/download-fixture/download'
      ? new Response(Uint8Array.from(atob(bundle), c => c.charCodeAt(0)), { headers: { 'Content-Type': 'application/gzip' } }) : new URL(request.url).pathname === '/api/grove/download-fixture' ? Response.json({ name: 'client-download', version: '1.0', manifest: {} }) : new Response('fixture only', { status: 404 }));
  }, (await readFile(downloadedArchive)).toString('base64'));
  const installed = await page.evaluate(async () => {
    const plan = await window.beings.prepareKit('download-fixture');
    return window.beings.installKit({ ticket: plan.ticket, environment: {} });
  });
  assert.equal(installed.name, 'client-download');
  const beforeKitReload = handshakeCount, kitDeadline = Date.now() + 15000;
  let reloadedTools;
  while (Date.now() < kitDeadline) {
    reloadedTools = await rpc('tools/list');
    if (reloadedTools.tools.some(tool => tool.name === 'client_download_ping')) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert(reloadedTools.tools.some(tool => tool.name === 'client_download_ping'));
  assert.equal(handshakeCount, beforeKitReload, 'Kit hot reload must not reconnect Portal');
  const downloadReply = await rpc('tools/call', { name: 'client_download_ping', arguments: { value: 'installed via client' } });
  assert(JSON.stringify(downloadReply).includes('Kit reply: installed via client'));
  console.log('PASS: client download, atomic installation, Portal hot reload and real downloaded Kit tool call without reconnecting.');
  const rejected = await rpc('tools/call', { name: 'portal_file_write', arguments: { path: '../outside.txt', content: 'no' } });
  assert(rejected.isError || JSON.stringify(rejected).includes('outside workspace'));
  await openPlace(page, 'chat');
  await frame.locator('#file-input').setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('attachment fixture') });
  await frame.locator('#pending-files.active').waitFor();
  await frame.locator('#input').fill('请帮我写一份问候。');
  await frame.locator('#send-btn').dispatchEvent('click');
  await frame.getByText('本机 Portal 已完成操作。', { exact: false }).waitFor();
  assert.equal(chatBody.attachments[0].data, Buffer.from('attachment fixture').toString('base64'));
  assert.equal(await readFile(path.join(dir, '工作目录/hello.txt'), 'utf8'), '来自 Being 的问候');
  // Tick navigation previews and jumps within the frame; sidebar search shares the same targets.
  await frame.locator('.chat-index-tick').first().waitFor();
  const appendHistory = (role, content) => messages.push({ indexOnly: true, seq: seq++, role, content, at: new Date().toISOString() });
  for (let i = 0; i < 10; i++) {
    appendHistory('user', `历史提问 ${i + 1}：讨论客户端的界面和工具`);
    appendHistory('being', '这是一条用于验证快速索引的历史回复。');
  }
  appendHistory('user', '第一项：核对客户端界面');
  appendHistory('being', Array.from({ length: 35 }, (_, i) => `段落 ${i + 1}：这是一段用于验证定位的长回复。`).join('\n\n'));
  appendHistory('user', '第二项：核对 Portal 配置');
  appendHistory('being', '配置检查完成。');
  // Feed real history through the API instead of calling retired DOM globals.
  await childFrame.goto(childFrame.url());
  await childFrame.waitForFunction(() => document.querySelectorAll('.chat-index-tick').length === 13);
  await frame.locator('#input').fill('索引跳转保留的草稿');
  const firstTick = frame.getByRole('button', { name: /跳转到提问.*第一项/ });
  await firstTick.hover();
  await frame.locator('#chat-index-preview').waitFor();
  assert((await frame.locator('#chat-index-preview').textContent()).includes('段落 1'));
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/chat-index-preview.png' });
  await firstTick.click();
  await childFrame.waitForFunction(() => {
    const el = document.querySelector('.index-target');
    return el && Math.abs(el.getBoundingClientRect().top - document.querySelector('#messages').getBoundingClientRect().top - 24) < 2;
  });
  assert.equal(await frame.locator('#input').inputValue(), '索引跳转保留的草稿');
  const readingPosition = await childFrame.evaluate(() => document.querySelector('#messages').scrollTop);
  appendHistory('being', '索引浏览时收到新回复。');
  await page.waitForTimeout(1600); // Pass the attention-refresh debounce.
  await childFrame.evaluate(() => window.dispatchEvent(new Event('focus')));
  await frame.getByText('索引浏览时收到新回复。', { exact: true }).waitFor();
  await page.waitForTimeout(100);
  assert.equal(await childFrame.evaluate(() => document.querySelector('#messages').scrollTop), readingPosition);
  assert.match(await page.locator('#local-portal-status').getAttribute('aria-label'), /^本机 Portal：/);
  await childFrame.evaluate(() => {
    document.querySelector('#input').addEventListener('keydown', event => event.stopPropagation(), { once: true });
  });
  await frame.locator('#input').focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
  await page.locator('#chat-search-panel[open]').waitFor();
  await page.locator('#chat-search-input').fill('第一项');
  await page.locator('.chat-search-result').waitFor();
  assert.equal(await page.locator('.chat-search-result').count(), 1);
  await page.locator('#chat-search-panel').evaluate(async el => { await Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))); });
  await page.screenshot({ path: 'test-results/chat-search.png' });
  await page.locator('.chat-search-result').click();
  assert.equal(await frame.locator('#input').inputValue(), '索引跳转保留的草稿');
  await openChatSearch(page);
  await page.locator('#chat-search-input').fill('不存在的提问');
  assert.equal(await page.locator('#chat-search-status').textContent(), '没有匹配的提问');
  await page.locator('#chat-search-input').fill('第一项');
  await page.evaluate(() => window.postMessage({ type: 'beings:search-index', entries: [{ id: 'turn-1', text: '伪造目录' }] }, '*'));
  assert.equal(await page.locator('.chat-search-result').count(), 1);
  await page.locator('#chat-search-input').press('Escape');
  assert.equal(await page.locator('#toggle-chat-search').getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('#chat-search-panel').evaluate(el => el.open), false);
  await clickChatControl(page, '#chat-index-latest');
  await childFrame.waitForFunction(() => {
    const messages = document.querySelector('#messages');
    return messages.scrollHeight - messages.scrollTop - messages.clientHeight < 2;
  });
  await childFrame.waitForFunction(() => document.querySelector('.chat-index-tick[aria-current="location"]')?.getAttribute('aria-label').includes('第二项'));
  await frame.locator('#input').fill('');
  console.log('PASS: tick previews/jump, sidebar search, scroll tracking, draft preservation and streaming scroll lock.');
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/chat.png' });
  // Model settings and the compact options menu preserve the draft.
  await openClientSettings(page);
  await page.locator('[data-chat-action="model"]').click();
  await frame.locator('#settings-panel.active').waitFor();
  await frame.getByRole('button', { name: /^Alternate Model/ }).click();
  await frame.getByRole('button', { name: '保存并使用' }).click();
  await frame.locator('#llm-current').getByText('Alternate Model', { exact: true }).waitFor();
  assert.deepEqual(llmPatches.at(-1), {
    model: 'alternate-model',
    provider: 'anthropic',
    base_url: 'https://api.anthropic.com',
  });
  await frame.locator('#settings-panel .btn-close').dispatchEvent('click');
  await frame.locator('#settings-panel.active').waitFor({ state: 'hidden' });
  await frame.locator('#input').fill('unsent draft');
  const options = await openOptions(page);
  assert.equal(await options.getAttribute('open'), '');
  assert.equal(await frame.locator('#input').inputValue(), 'unsent draft');
  await options.locator('summary').click();
  assert.equal(await frame.locator('#input').inputValue(), 'unsent draft');
  // Repeat the native dialog/menu transition that used to drop Intel CI input.
  for (let round = 0; round < 3; round++) {
    await openClientSettings(page);
    await page.locator('#close-client-settings').click();
    await page.locator('#client-settings-dialog').waitFor({ state: 'hidden' });
  }
  await openClientSettings(page);
  await page.locator('#settings-tab-appearance').click();
  await page.locator('#theme-toggle').click();
  await page.locator('#close-client-settings').click();
  await childFrame.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  assert.equal(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource), 'dark');
  await page.screenshot({ path: 'test-results/chat-dark.png' });
  await firstTick.hover();
  await page.screenshot({ path: 'test-results/chat-index-dark.png' });

  // Stream cancellation goes all the way from the local Loom frame to /api/stop.
  await frame.locator('#input').fill('test-stop'); await frame.locator('#send-btn').dispatchEvent('click');
  await frame.locator('.run-activity.running .run-stop').waitFor();
  await frame.locator('.run-activity.running .run-stop').click();
  await page.waitForTimeout(300); assert.equal(stopCount, 1);
  await openPlace(page, 'portal');
  const beforeRestart = handshakeCount;
  await rpc('tools/call', { name: 'portal_restart', arguments: {} });
  await page.waitForTimeout(5500);
  await page.waitForFunction(() => document.querySelector('#portal-phase').textContent === '已连接', { timeout: 15000 });
  assert(handshakeCount > beforeRestart);
  pid = (await page.evaluate(() => window.beings.snapshot())).portal.pid;
  await page.screenshot({ path: 'test-results/portal.png' });
  const saved = await readFile(path.join(dir, 'profile/connection.json'), 'utf8'); assert(!saved.includes(token));
  assert.equal(errors.length, 0, errors.join('\n'));
  await saveTrace();
  await app.close(); app = null;
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
  // Retire the index fixture from the server; synchronized local history should
  // remain available after restart even when absent from the latest response.
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].indexOnly) messages.splice(i, 1);
  // Reload encrypted settings from disk, without asking for the token again.
  app = await launchDesktop({ executablePath, env: { ...process.env, PORTAL_DESKTOP_USER_DATA: path.join(dir, 'profile') } });
  const restored = await app.firstWindow();
  await waitForChatReady(restored);
  await restored.frameLocator('#chat-frame').getByText('本机 Portal 已完成操作。', { exact: false }).waitFor();
  await restored.frameLocator('#chat-frame').getByRole('button', { name: /跳转到提问.*请帮我写一份问候/ }).waitFor();
  assert.equal(await restored.frameLocator('#chat-frame').getByRole('button', { name: /跳转到提问.*第一项/ }).count(), 1, 'Restart preserves cached history absent from the latest server response');
  assert.equal((await restored.evaluate(() => window.beings.snapshot())).settings.hasToken, true);
  assert.equal(await restored.evaluate(() => window.beings.appearance()), 'dark');
  if (background.enabled) {
    backgroundTest = true;
    const beforeBackground = handshakeCount;
    await restored.evaluate(async () => { const { settings } = await window.beings.snapshot(); await window.beings.save({ ...settings, backgroundEnabled: true }); });
    await restored.waitForFunction(() => document.querySelector('#portal-phase').textContent === '已连接', { timeout: 25000 });
    const backgroundSnapshot = await restored.evaluate(() => window.beings.snapshot());
    assert.equal(backgroundSnapshot.background.enabled, true);
    pid = backgroundSnapshot.portal.pid;
    assert(handshakeCount > beforeBackground);
    await app.close(); app = null;
    process.kill(pid, 0);
    // The client is gone: the same Rust engine still accepts real tool calls.
    const afterQuit = await rpc('tools/call', { name: 'portal_file_write', arguments: { path: 'after-quit.txt', content: 'background still connected' } });
    assert(!afterQuit.isError);
    assert.equal(await readFile(path.join(dir, '工作目录/after-quit.txt'), 'utf8'), 'background still connected');
    const beforeCrash = handshakeCount;
    process.kill(pid, 'SIGKILL');
    const deadline = Date.now() + 25000;
    while (handshakeCount === beforeCrash && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 250));
    assert(handshakeCount > beforeCrash, 'launchd must restart the crashed Portal while the client is closed');
    assert((await rpc('tools/list')).tools.some(tool => tool.name === 'portal_file_write'));
    // Reload the login registration with no Electron process, as launchd does at login.
    const serviceRecord = JSON.parse(await readFile(path.join(dir, 'profile/portal-service.json'), 'utf8'));
    const runSystem = promisify(execFile);
    const definition = JSON.parse((await runSystem('/usr/bin/plutil', ['-convert', 'json', '-o', '-', serviceRecord.file])).stdout);
    assert.equal(definition.RunAtLoad, true);
    assert.deepEqual(definition.KeepAlive, { PathState: { [path.join(serviceRecord.root, '.portal-start-failure')]: false } });
    assert(!JSON.stringify(definition).includes(token));
    await runSystem('/bin/launchctl', ['bootout', `gui/${process.getuid()}/${serviceRecord.label}`]);
    const beforeLogin = handshakeCount;
    for (let attempt = 0; ; attempt++) {
      try { await runSystem('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, serviceRecord.file]); break; }
      catch (error) { if (attempt >= 19 || error.code !== 5) throw error; await new Promise(resolve => setTimeout(resolve, 500)); }
    }
    const loginDeadline = Date.now() + 20000;
    while (handshakeCount === beforeLogin && Date.now() < loginDeadline) await new Promise(resolve => setTimeout(resolve, 250));
    assert(handshakeCount > beforeLogin, 'loading the saved login registration must connect without launching the client');
    app = await launchDesktop({ executablePath, env: { ...process.env, PORTAL_DESKTOP_USER_DATA: path.join(dir, 'profile') } });
    const reopened = await app.firstWindow();
    await waitForChatReady(reopened);
    await reopened.waitForFunction(() => document.querySelector('#portal-phase').textContent === '已连接', { timeout: 15000 });
    const reattached = await reopened.evaluate(() => window.beings.snapshot());
    assert.notEqual(reattached.portal.pid, pid);
    pid = reattached.portal.pid;
    await openPlace(reopened, 'portal');
    await reopened.screenshot({ path: 'test-results/background-portal.png' });
    await reopened.locator('#portal-settings').click();
    assert.equal(await reopened.locator('#background-input').isChecked(), true);
    assert.equal(await reopened.locator('#autostart-input').isDisabled(), true);
    await reopened.screenshot({ path: 'test-results/background-settings.png' });
    await reopened.locator('#close-settings').click();
    const stableHandshakes = handshakeCount;
    await reopened.waitForTimeout(1000); assert.equal(handshakeCount, stableHandshakes, 'reopening must not restart the existing background service');
    pid = (await reopened.evaluate(() => window.beings.snapshot())).portal.pid;
    assert((await rpc('tools/list')).tools.some(tool => tool.name === 'client_download_ping'));
    await reopened.evaluate(() => window.beings.stopPortal());
    const stopped = await reopened.evaluate(() => window.beings.snapshot());
    assert.equal(stopped.background.enabled, false); assert.equal(stopped.settings.backgroundEnabled, false);
    await reopened.waitForTimeout(1000); assert.throws(() => process.kill(pid, 0), /ESRCH/);
    await app.close(); app = null;
    app = await launchDesktop({ executablePath, env: { ...process.env, PORTAL_DESKTOP_USER_DATA: path.join(dir, 'profile') } });
    const disabledWindow = await app.firstWindow();
    await waitForChatReady(disabledWindow);
    await disabledWindow.locator('#conversation-name').getByText('willow', { exact: true }).waitFor();
    assert.equal((await disabledWindow.evaluate(() => window.beings.snapshot())).background.enabled, false);
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
    console.log('PASS: real LaunchAgent install, tool call after client quit, SIGKILL recovery, login registration reload without client, reattach without restart, stop disables login startup across client restarts.');
  }
  console.log('PASS: packaged app, encrypted persistence, local chat, attachment + SSE, real Rust Relay/tool call + stdio Kit, workspace boundary, stop, restart, process cleanup.');
} catch (error) {
  if (app) {
    const page = app.windows()[0];
    if (page) {
      await mkdir('test-results', { recursive: true });
      await page.screenshot({ path: 'test-results/failure.png' }).catch(() => {});
      console.error((await page.locator('body').innerText().catch(() => '')).slice(-3000));
    }
  }
  throw error;
} finally { await cleanup(); }
