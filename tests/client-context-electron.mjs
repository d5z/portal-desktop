// Real sandboxed Electron IDB + authenticated Desktop bridge; no visible chat needed.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';

const directory = await mkdtemp(path.join(os.tmpdir(), 'portal-client-context-'));
let application, portal;
const relayServer = createServer((request, response) => {
  if (request.url === '/client-context-host.html') {
    response.writeHead(200, {'content-type':'text/html'});
    response.end('<!doctype html><iframe src="beings://chat/client-context.html"></iframe>');
  } else { response.writeHead(404); response.end(); }
});
const sockets = new WebSocketServer({ server: relayServer, path: '/_relay' });
let connected;
const ready = new Promise(resolve => { connected = resolve; });
const pending = new Map();
let nextId = 0, relay;
sockets.on('connection', socket => {
  let handshaken = false;
  socket.on('message', bytes => {
    const message = JSON.parse(bytes.toString());
    if (!handshaken) {
      assert.equal(message.loom_token, 'client-context-fixture');
      handshaken = true; relay = socket;
      socket.send(JSON.stringify({ ok: true, relay_keepalive: 'text-v1' })); connected(); return;
    }
    if (message.type === 'keepalive') { socket.send(JSON.stringify({ type: 'keepalive_ack' })); return; }
    const request = pending.get(message.id);
    if (request) { pending.delete(message.id); clearTimeout(request.timer); request.resolve(message); }
  });
});
await new Promise(resolve => relayServer.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${relayServer.address().port}/client-context-fixture`;
const rpc = (command, sceneId) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error('Rust client command timed out')); }, 15000);
  pending.set(id, { resolve, timer });
  relay.send(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: {
    name: 'portal_exec', arguments: { command }, _meta: { scene_id: sceneId },
  } }));
});
try {
  const entry = path.join(directory, 'fixture.cjs');
  await build({ stdin: { contents: `
    import { app, protocol, BrowserWindow } from 'electron';
    import { registerLocalProtocol, configureLocalSession } from './desktop/main/app/protocol';
    import { ClientContextReader } from './desktop/main/chat/client-context';
    import { ClientCommandServer } from './desktop/main/chat/client-server';
    import { readFile } from 'node:fs/promises';
    const disabled = app.commandLine.getSwitchValue('disable-features').split(',').filter(name => name !== 'ThirdPartyStoragePartitioning');
    app.commandLine.removeSwitch('disable-features');
    app.commandLine.appendSwitch('disable-features', disabled.join(','));
    app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
    protocol.registerSchemesAsPrivileged([{ scheme: 'beings', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
    app.on('window-all-closed', () => {});
    app.whenReady().then(async () => {
      registerLocalProtocol(${JSON.stringify(path.resolve('desktop/generated'))}, { handle: async () => new Response('', {status:404}) });
      configureLocalSession();
      const reader = new ClientContextReader(${JSON.stringify(new URL('/', endpoint).href)});
      const server = new ClientCommandServer(${JSON.stringify(path.join(directory, 'client.json'))}, () => ${JSON.stringify(endpoint)}, request => reader.execute({...request, scenes: [{scene_id:"desktop-empty",scene_meta:{client:"test",scene_label:"新会话"}}]}));
      await server.start();
      globalThis.fixture = { reader, server, registration: JSON.parse(await readFile(${JSON.stringify(path.join(directory, 'client.json'))}, 'utf8')) };
      const seed = new BrowserWindow({show:false, webPreferences:{sandbox:true, contextIsolation:true, nodeIntegration:false}});
      await seed.loadURL(${JSON.stringify(new URL('/client-context-host.html', endpoint).href)});
      const frame = seed.webContents.mainFrame.frames.find(frame => frame.url === 'beings://chat/client-context.html');
      if (!frame) throw new Error('Missing embedded cache frame');
      await frame.executeJavaScript('window.clientCommand(' + JSON.stringify(${JSON.stringify(endpoint)}) + ', "scenes", "")');
      await frame.executeJavaScript(
        '(' + (async () => {
          const db = await new Promise((resolve, reject) => { const req = indexedDB.open('loom-history-' + encodeURIComponent(${JSON.stringify(endpoint)})); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
          const tx = db.transaction('messages', 'readwrite');
          tx.objectStore('messages').put({ seq: 1, role: 'user', content: '跨场景 Electron 历史', scene_id: 'scene-b', at: '2026-09-21T00:00:00Z' });
          await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; }); db.close();
        }).toString() + ')()');
      seed.destroy();
      globalThis.fixture.ready = true;
    });
  `, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: entry });
  application = await electron.launch({ args: [entry], env: { ...process.env } });
  for (let i = 0; i < 100 && !await application.evaluate(() => globalThis.fixture?.ready); i++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await application.evaluate(() => globalThis.fixture?.ready), true);
  const registration = await application.evaluate(() => globalThis.fixture.registration);
  const invoke = async (verb, args = '', sceneId) => {
    const response = await fetch(`http://127.0.0.1:${registration.port}/command`, { method: 'POST', headers: { authorization: `Bearer ${registration.token}` }, body: JSON.stringify({ endpoint, verb, args, sceneId }) });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.error, undefined);
    return data.text;
  };
  assert.match(await invoke('context', 'scene-b'), /跨场景 Electron 历史/);
  assert.equal(await invoke('context', '', 'scene-b'), await invoke('context', 'scene-b'));
  assert.match(await invoke('scenes'), /scene-b.*messages: 1/);
  await application.evaluate(() => globalThis.fixture.reader.close());
  assert.match(await invoke('context', 'scene-b'), /跨场景 Electron 历史/);
  await writeFile(path.join(directory, 'portal.toml'), `name = "client-context-fixture"\nworkspace = ${JSON.stringify(directory)}\nkits_enabled = false\n[tools]\nexec = true\ncustom_tools_enabled = false\n`);
  portal = spawn(path.resolve('resources', process.platform === 'win32' ? 'heart-portal.exe' : 'heart-portal'), ['--config', path.join(directory, 'portal.toml')], {
    cwd: directory, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
      PORTAL_CONNECT_LINK: endpoint + '/?token=client-context-fixture',
      HEART_PORTAL_CLIENT_FILE: path.join(directory, 'client.json'),
      HEART_PORTAL_CLIENT_MANAGED: '1', HEART_PORTAL_SUPERVISED: '1',
    },
  });
  let diagnostics = '';
  portal.stderr.on('data', data => { diagnostics += data; });
  let readyTimer;
  try { await Promise.race([ready, new Promise((_, reject) => { readyTimer = setTimeout(() => reject(new Error('Relay did not connect: ' + diagnostics)), 15000); })]); }
  finally { clearTimeout(readyTimer); }
  const contextResult = await rpc('@context', 'scene-b');
  assert.equal(contextResult.error, undefined);
  assert.match(contextResult.result.content[0].text, /跨场景 Electron 历史/);
  const scenesResult = await rpc('@scenes');
  assert.match(scenesResult.result.content[0].text, /scene-b.*messages: 1/);
  assert.match(scenesResult.result.content[0].text, /desktop-empty — 新会话.*messages: 0/);
  const unknown = await rpc('@not-a-shell ; echo forbidden');
  assert.ok(unknown.error || unknown.result?.isError);
  await application.evaluate(async () => { globalThis.fixture.reader.close(); await globalThis.fixture.server.close(); });
  console.log('PASS: Rust MCP relay → authenticated Desktop bridge → sandboxed Electron IDB, with scene metadata and no visible chat.');
} finally {
  if (portal && portal.exitCode === null) {
    portal.kill('SIGTERM');
    await new Promise(resolve => portal.once('exit', resolve));
  }
  sockets.clients.forEach(socket => socket.terminate());
  await new Promise(resolve => sockets.close(resolve));
  await new Promise(resolve => relayServer.close(resolve));
  await application?.close();
  await rm(directory, { recursive: true, force: true });
}
