// Focused packaged-client test through its existing IPC API and a local relay.
// Uses a disposable profile/workspace; never contacts a real Being.
import { launchDesktop } from './support/electron-lifecycle.mjs';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { desktopExecutable } from './support/desktop.mjs';

const temporary = await mkdtemp(path.join(os.tmpdir(), 'portal-runtime-e2e-'));
const token = 'local-runtime-fixture';
const chatRequests = [];
const server = createServer(async (request, response) => {
  if (request.url.includes('/api/chat/stream') && request.method === 'POST') {
    let body = ''; for await (const chunk of request) body += chunk;
    chatRequests.push(JSON.parse(body));
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.end('event: content_block_delta\ndata: {"delta":{"text":"诊断日志已收到"}}\n\nevent: message_stop\ndata: {}\n\n');
    return;
  }
  if (request.url.includes('/api/stream/active')) { response.writeHead(204); response.end(); return; }
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ being_name: 'fixture', messages: [] }));
});
const wss = new WebSocketServer({ server, path: '/_relay' });
let relay, handshakes = 0, nextId = 0, app, acceptRelay = true;
const pending = new Map();
wss.on('connection', socket => {
  let ready = false;
  socket.on('message', bytes => {
    const message = JSON.parse(bytes.toString());
    if (!ready) {
      if (!acceptRelay) { socket.close(); return; }
      assert.equal(message.loom_token, token);
      assert.equal(message.being_id, 'fixture');
      ready = true; relay = socket; handshakes++;
      socket.send(JSON.stringify({ ok: true, relay_keepalive: 'text-v1' })); return;
    }
    if (message.type === 'keepalive') { socket.send(JSON.stringify({ type: 'keepalive_ack' })); return; }
    const request = pending.get(message.id);
    if (request) {
      clearTimeout(request.timer); pending.delete(message.id);
      message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
    }
  });
});
const rpc = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error('Local MCP request timed out')); }, 10_000);
  pending.set(id, { resolve, reject, timer });
  relay.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
});
const until = async predicate => {
  const deadline = Date.now() + 20_000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('Runtime state did not converge');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
};
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  // An explicit profile must not import a real Being's global Portal config.
  app = await launchDesktop({ executablePath: await desktopExecutable(), timeout: 30_000,
    env: { ...process.env, PORTAL_DESKTOP_USER_DATA: path.join(temporary, 'profile') } });
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.beings));
  const defaults = (await page.evaluate(() => window.beings.snapshot())).settings;
  assert.equal(defaults.allowExec, true); assert.equal(defaults.kitsEnabled, true);
  await page.evaluate(async input => {
    const { settings } = await window.beings.snapshot();
    await window.beings.save({ ...settings, ...input, portalName: 'runtime-fixture', allowExec: false, kitsEnabled: false, autoStart: false, backgroundEnabled: false });
    await window.beings.startPortal();
  }, { connectionLink: `http://127.0.0.1:${server.address().port}/fixture/?token=${token}`, workspace: path.join(temporary, '中文 workspace') });
  const state = async () => (await page.evaluate(() => window.beings.snapshot())).portal;
  await until(async () => (await state()).phase === 'connected');
  const connected = await state();
  const pid = connected.pid;
  const startupSettings = (await page.evaluate(() => window.beings.snapshot())).settings;
  assert.equal(startupSettings.portalConfigPath, undefined);
  assert.equal(startupSettings.workspace, path.join(temporary, '中文 workspace'));
  const missingConfig = path.join(temporary, 'missing-portal.toml');
  const conciseError = await page.evaluate(async portalConfigPath => {
    const { settings } = await window.beings.snapshot();
    return window.beings.save({ ...settings, portalConfigPath }).then(() => '', error => String(error));
  }, missingConfig);
  assert(conciseError.includes('所需文件不存在'));
  assert(!/ENOENT|CLIXML|missing-portal.toml/.test(conciseError));
  await until(async () => (await readFile(path.join(temporary, 'profile/logs/client-errors.log'), 'utf8').catch(() => '')).includes('missing-portal.toml'));
  assert(Number.isInteger(pid), `connected Portal must expose its PID: ${JSON.stringify(connected)}`);
  // Capture the OS browser handoff; never open a real browser or real Being.
  await app.evaluate(({ shell, session }) => {
    session.fromPartition('persist:beings-browser').protocol.handle('https', () => new Response('<title>Fixture</title>', { headers: { 'content-type': 'text/html' } }));
    session.defaultSession.protocol.handle('https', request => new URL(request.url).hostname === 'example.invalid'
      ? Response.json({ being_name: 'second_being', messages: [] })
      : new Response('fixture only', { status: 404 }));
    globalThis.loomTargets = [];
    shell.openExternal = async url => { globalThis.loomTargets.push(url); };
  });
  await page.locator('#options-trigger').click();
  await page.screenshot({ path: path.join(os.tmpdir(), 'beings-open-loom.png') });
  await page.locator('#options-help').click();
  await page.locator('#open-loom').click();
  assert.equal((await page.evaluate(() => window.beings.browserState())).open, true);
  await page.evaluate(() => window.beings.browserAction('external'));
  assert.deepEqual(await app.evaluate(() => globalThis.loomTargets), [`http://127.0.0.1:${server.address().port}/fixture/?token=${token}`]);
  assert.equal(await page.evaluate(value => document.documentElement.outerHTML.includes(value), token), false);
  const result = await rpc('tools/call', { name: 'portal_file_write', arguments: { path: 'result.txt', content: '本地运行成功' } });
  assert.notEqual(result.isError, true);
  assert.equal(await readFile(path.join(temporary, '中文 workspace/result.txt'), 'utf8'), '本地运行成功');
  assert.equal((await rpc('tools/call', { name: 'portal_exec', arguments: { command: 'echo must-not-run' } })).isError, true);
  assert.equal((await rpc('tools/call', { name: 'portal_file_read', arguments: { path: '../outside' } })).isError, true);
  // Closing the window hides it without dropping its managed Portal or drafts.
  await page.evaluate(() => { document.body.dataset.lifecycleDraft = '保留窗口状态'; });
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
  assert.equal((await state()).pid, pid);
  assert.notEqual((await rpc('tools/call', { name: 'portal_file_write', arguments: { path: 'after-close.txt', content: '窗口关闭后继续调用' } })).isError, true);
  assert.equal(await readFile(path.join(temporary, '中文 workspace/after-close.txt'), 'utf8'), '窗口关闭后继续调用');
  await app.evaluate(({ app }) => { app.emit('activate'); });
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
  assert.equal(await page.evaluate(() => document.body.dataset.lifecycleDraft), '保留窗口状态');
  relay.terminate();
  await until(() => handshakes >= 2);
  await until(async () => (await state()).phase === 'connected');
  assert.equal((await state()).pid, pid, 'network reconnect must not restart Portal');
  await rpc('ping');
  await page.evaluate(() => window.beings.browserAction('close'));
  const frame = page.frameLocator('#chat-frame');
  await frame.locator('#input .cm-content').fill('保留未发送草稿');
  await frame.locator('#file-input').setInputFiles({ name: 'draft.txt', mimeType: 'text/plain', buffer: Buffer.from('private draft attachment') });
  const openPortal = async () => {
    await page.locator('#options-trigger').click();
    await page.locator('#client-settings-button').click();
    await page.locator('#client-settings-dialog [data-view="portal"]').click();
    await page.locator('#portal-view').waitFor({ state: 'visible' });
  };
  await openPortal();
  // Recover a stalled relay through the visible control, preserving runtime mode.
  const beforeRestart = await state();
  acceptRelay = false;
  relay.terminate();
  await until(async () => (await state()).phase === 'reconnecting');
  assert.equal(await page.locator('#restart-portal').isEnabled(), true);
  acceptRelay = true;
  await page.locator('#restart-portal').click();
  await until(async () => { const current = await state(); return current.phase === 'connected' && current.pid !== beforeRestart.pid; });
  assert.throws(() => process.kill(beforeRestart.pid, 0), /ESRCH/);
  assert.equal((await page.evaluate(() => window.beings.snapshot())).settings.backgroundEnabled, false);
  assert.ok((await rpc('tools/list')).tools.length > 0);
  if (process.platform === 'win32') {
    await page.screenshot({ path: path.join(os.tmpdir(), 'portal-force-recovery.png') });
    const beforeForce = await state();
    await page.locator('#force-start-portal').click();
    await until(async () => { const current = await state(); return current.phase === 'connected' && current.pid !== beforeForce.pid; });
    assert.throws(() => process.kill(beforeForce.pid, 0), /ESRCH/);
    assert.equal((await page.evaluate(() => window.beings.snapshot())).settings.backgroundEnabled, false);
    assert.ok((await rpc('tools/list')).tools.length > 0);
  }
  await app.evaluate(({ shell }) => {
    globalThis.openedLogDirectory = '';
    shell.openPath = async directory => { globalThis.openedLogDirectory = directory; return ''; };
  });
  await page.getByRole('button', { name: '打开日志文件夹', exact: true }).click();
  await until(async () => Boolean(await app.evaluate(() => globalThis.openedLogDirectory)));
  const logDirectory = await app.evaluate(() => globalThis.openedLogDirectory);
  assert.equal(logDirectory, path.join(temporary, 'profile/logs'));
  for (const file of ['client-errors.log', 'portal-runtime.log', 'portal-status.json'])
    assert((await readFile(path.join(logDirectory, file), 'utf8')).length > 0);
  // Portal logs use the existing Together preview and draft flow. Only the
  // final, explicit chat send may reach the local Being fixture.
  await page.getByRole('button', { name: '一起看日志', exact: true }).click();
  await page.locator('#companion-panel').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#scene-object-title').textContent(), 'Portal 日志');
  assert((await page.locator('#scene-object-source').textContent()).includes('Portal 设置'));
  const preview = await page.locator('#scene-object-text').textContent();
  assert(preview.includes('missing-portal.toml'));
  assert(!preview.includes(token));
  assert.equal(chatRequests.length, 0);
  await page.locator('#scene-compose').click();
  await page.getByText('对话输入框已有草稿，请先处理原草稿，再放入引用。', { exact: true }).waitFor();
  assert.equal(await frame.locator('#input .cm-content').textContent(), '保留未发送草稿');
  assert.equal(await frame.locator('#pending-files.active').count(), 1);
  assert.equal(chatRequests.length, 0);
  await frame.locator('#input .cm-content').fill('');
  await frame.getByRole('button', { name: '移除 draft.txt', exact: true }).click();
  await page.locator('#scene-compose').click();
  await page.locator('#companion-panel').waitFor({ state: 'hidden' });
  const quote = await frame.locator('#input .cm-content').innerText();
  assert(quote.startsWith('一起看看Portal 设置'));
  assert(quote.includes(preview.split('\n').map(line => '> ' + line).join('\n')));
  assert.equal(chatRequests.length, 0);
  await frame.locator('#send-btn').click();
  await frame.getByText('诊断日志已收到', { exact: true }).waitFor();
  assert.equal(chatRequests.length, 1);
  assert.equal(chatRequests[0].message, quote);
  assert.equal(chatRequests[0].attachments, undefined);
  // Old TOMLs cannot disable the client's controls or silently override a save.
  const imported = path.join(temporary, 'imported.toml');
  const original = `workspace = ${JSON.stringify(startupSettings.workspace)}\nkits_dir = ${JSON.stringify(path.join(temporary, 'kits'))}\nkits_enabled = false\n[tools]\nexec = false\ncustom_tools_enabled = false\nscreenshot = true\n[security]\nexec_allowlist = []\n`;
  await writeFile(imported, original);
  await page.evaluate(async portalConfigPath => {
    const { settings } = await window.beings.snapshot();
    await window.beings.save({ ...settings, portalConfigPath });
  }, imported);
  await until(async () => (await state()).phase === 'connected');
  for (const enabled of [true, false]) {
    await openPortal();
    await page.locator('#portal-settings').click();
    assert.equal(await page.locator('#screenshot-input').count(), 0);
    assert.equal(await page.locator('#exec-input').isEnabled(), true);
    assert.equal(await page.locator('#kits-input').isEnabled(), true);
    await page.locator('#exec-input').setChecked(enabled);
    await page.locator('#kits-input').setChecked(enabled);
    await page.locator('#save-settings').click();
    await page.locator('#settings-dialog').waitFor({ state: 'hidden' });
    await until(async () => (await state()).phase === 'connected');
    const result = await rpc('tools/call', { name: 'portal_status', arguments: {} });
    const status = JSON.parse(result.content.find(item => item.type === 'text').text);
    assert.equal(status.tools.exec, enabled);
    assert.equal(status.kits.enabled, enabled);
    assert.equal(status.tools.custom_tools_enabled, enabled);
    assert.equal(status.tools.screenshot, true);
    const names = (await rpc('tools/list')).tools.map(tool => tool.name);
    assert.equal(names.includes('portal_exec'), enabled);
    assert.equal(names.includes('portal_kits_status'), enabled);
    const execution = await rpc('tools/call', { name: 'portal_exec', arguments: { command: 'echo switch-fixture' } });
    assert.equal(execution.isError === true, !enabled);
    assert.equal(await readFile(imported, 'utf8'), original);
  }
  await page.evaluate(() => window.beings.stopPortal());
  assert.equal((await state()).phase, 'stopped');
  await page.evaluate(async () => {
    const { settings } = await window.beings.snapshot();
    await window.beings.save({ ...settings, connectionLink: 'https://example.invalid/second_being/?token=second-fixture-token' });
    await window.beings.openLoom();
  });
  await page.evaluate(() => window.beings.browserAction('external'));
  assert.equal(await app.evaluate(() => globalThis.loomTargets.at(-1)), 'https://example.invalid/second_being/?token=second-fixture-token');
  await app.evaluate(({ shell }) => { shell.openExternal = async url => { throw new Error(url); }; });
  const openError = await page.evaluate(() => window.beings.browserAction('external').catch(error => String(error)));
  assert(openError.includes('无法打开系统浏览器'));
  assert(!openError.includes('second-fixture-token'));
  await page.evaluate(async connectionLink => {
    const { settings } = await window.beings.snapshot();
    await window.beings.save({ ...settings, connectionLink });
  }, `http://127.0.0.1:${server.address().port}/fixture/?token=${token}`);
  await page.evaluate(() => window.beings.startPortal());
  await until(async () => (await state()).phase === 'connected');
  const exitPid = (await state()).pid;
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await app.close(); app = null;
  assert.throws(() => process.kill(exitPid, 0), /ESRCH/);
  console.log('PASS: bundled Portal lifecycle and reconnect, imported config switches on/off, screenshot without extra setting, nonempty log export, Together log preview and quotation with explicit user send, existing draft/attachment protection, concise errors, current Being routing and scoped file access');
} finally {
  if (app) await app.close().catch(() => {});
  for (const request of pending.values()) clearTimeout(request.timer);
  for (const client of wss.clients) client.terminate();
  wss.close(); server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
  await rm(temporary, { recursive: true, force: true });
}
