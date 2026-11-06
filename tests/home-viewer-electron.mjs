import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { build } from 'esbuild';
import electronPath from 'electron';
import { launchDesktop } from './support/electron-lifecycle.mjs';
import { desktopExecutable } from './support/desktop.mjs';
const packaged = process.argv.includes('--packaged');
let assets = path.resolve('desktop/generated');
if (packaged) {
  const executable = await desktopExecutable();
  const resources = process.platform === 'darwin' ? path.resolve(path.dirname(executable), '../Resources') : path.join(path.dirname(executable), 'resources');
  assets = path.join(resources, 'app.asar/.vite/renderer/main_window');
}
const directory = await mkdtemp(path.join(os.tmpdir(), 'home-stream-'));
let app, server, wss;
let exchanges = 0, htmlLoads = 0, sockets = 0, actions = [], controls = [], expired = false, canControl = false;
const state = () => ({ ready: true, can_control: canControl, controller: canControl ? 'human' : 'being', lease_remaining_seconds: canControl ? 60 : 0,
  view_mode: 'native', frame_width: 320, frame_height: 180, live_view: { available: true, protocol: 'rfb' } });
const origins = [], cookies = [];
try {
  if (!packaged) execFileSync(process.execPath, ['scripts/build-home-viewer.mjs'], { stdio: 'pipe' });
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(directory, 'key.pem'), '-out', path.join(directory, 'cert.pem'), '-days', '1', '-subj', '/CN=home.beings.town'], { stdio: 'ignore' });
  const key = await readFile(path.join(directory, 'key.pem')), cert = await readFile(path.join(directory, 'cert.pem'));
  const fingerprint = new X509Certificate(cert).fingerprint256;
  server = createServer({ key, cert }, async (request, response) => {
    if (request.url.startsWith('/desktop/connect')) {
      exchanges++; response.writeHead(302, { Location: '/desktop/computer/', 'Set-Cookie': 'bh_desktop=fixture-session; HttpOnly; Secure; SameSite=Strict; Path=/desktop; Max-Age=900' }); response.end(); return;
    }
    if (request.url === '/desktop/computer/') { htmlLoads++; response.end('Must never load remote HTML'); return; }
    origins.push(request.headers.origin); cookies.push(request.headers.cookie);
    if (expired || request.headers.cookie !== 'bh_desktop=fixture-session') { response.writeHead(401); response.end('{}'); return; }
    let body = ''; for await (const chunk of request) body += chunk;
    if (request.url.endsWith('/control')) { const { action } = JSON.parse(body); controls.push(action); canControl = action !== 'release'; }
    if (request.url.endsWith('/action')) { assert(canControl); actions.push(JSON.parse(body)); }
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(state()));
  });
  wss = new WebSocketServer({ server, maxPayload: 65536 });
  wss.on('connection', (socket, request) => {
    sockets++; assert.equal(request.headers.cookie, 'bh_desktop=fixture-session'); assert.equal(request.headers.origin, 'https://home.beings.town');
    let phase = 0, pending = Buffer.alloc(0), frames = 0;
    socket.send(Buffer.from('RFB 003.008\n'));
    socket.on('message', data => {
      pending = Buffer.concat([pending, data]);
      while (pending.length) {
        if (phase === 0) { if (pending.length < 12) return; pending = pending.subarray(12); phase++; socket.send(Buffer.from([1, 1])); }
        else if (phase === 1) { pending = pending.subarray(1); phase++; socket.send(Buffer.alloc(4)); }
        else if (phase === 2) {
          pending = pending.subarray(1); phase++;
          const init = Buffer.alloc(24); init.writeUInt16BE(320, 0); init.writeUInt16BE(180, 2);
          init[4] = 32; init[5] = 24; init[7] = 1; init.writeUInt16BE(255, 8); init.writeUInt16BE(255, 10); init.writeUInt16BE(255, 12); init[14] = 16; init[15] = 8;
          socket.send(init);
        } else {
          const type = pending[0];
          const length = type === 0 ? 20 : type === 2 ? (pending.length < 4 ? Infinity : 4 + pending.readUInt16BE(2) * 4) : type === 3 ? 10 : -1;
          assert(length > 0, 'RFB channel must not send keyboard, mouse or clipboard writes');
          if (pending.length < length) return;
          pending = pending.subarray(length);
          if (type === 3 && frames++ < 4) {
            const frame = Buffer.alloc(16 + 320 * 180 * 4); frame.writeUInt16BE(1, 2); frame.writeUInt16BE(320, 8); frame.writeUInt16BE(180, 10);
            for (let i = 16; i < frame.length; i += 4) { frame[i] = 100; frame[i + 1] = 170; frame[i + 2] = frames * 40; }
            socket.send(frame);
          }
        }
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const entry = path.join(directory, 'main.cjs'), port = server.address().port;
  await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { app, BrowserWindow } from 'electron'; import { X509Certificate } from 'node:crypto';
    import { HomeViewer } from './desktop/main/home/viewer';
    app.setPath('userData', ${JSON.stringify(directory)});
    app.commandLine.appendSwitch('host-resolver-rules', 'MAP home.beings.town 127.0.0.1:${port}'); app.commandLine.appendSwitch('no-proxy-server');
    app.on('session-created', jar => jar.setCertificateVerifyProc((r, cb) => cb(r.hostname === 'home.beings.town' && new X509Certificate(r.certificate.data).fingerprint256 === ${JSON.stringify(fingerprint)} ? 0 : -2)));
    const logs = []; app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_e, _level, message) => logs.push(message)); wc.on('did-fail-load', (_e, code, message) => logs.push({code,message})); });
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ width: 900, height: 650, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      await window.loadURL('data:text/html,<title>Home stream test</title>');
      const phases = []; const viewer = new HomeViewer(() => window, phase => phases.push(phase), ${JSON.stringify(assets)});
      globalThis.fixture = { viewer, window, phases, logs };
      viewer.setBounds({ x: 200, y: 100, width: 600, height: 400, visible: true, presentation: 'preview' });
      viewer.open('https://home.beings.town/desktop/connect?ticket=fixture-one', 'computer');
    }); app.on('window-all-closed', () => app.quit());
  ` }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: entry,
    plugins: [{ name: 'fixture-ws-loopback-tls', setup(build) {
      build.onResolve({ filter: /^ws$/ }, args => args.namespace === 'fixture-ws' ? { path: path.resolve('node_modules/ws/index.js') } : { path: 'ws', namespace: 'fixture-ws' });
      build.onLoad({ filter: /.*/, namespace: 'fixture-ws' }, () => ({ loader: 'js', resolveDir: process.cwd(), contents: `import WS from 'ws'; export default class extends WS { constructor(url, options) { const target = new URL(url); target.hostname = '127.0.0.1'; target.port = '${port}'; super(target, { ...options, servername: 'home.beings.town', ca: ${JSON.stringify(cert.toString())} }); } }` }));
    } }] });
  app = await launchDesktop({ executablePath: electronPath, args: [entry], cwd: directory, env: { ...process.env, PORTAL_DESKTOP_USER_DATA: directory } });
  await app.firstWindow();
  const wait = async predicate => { for (let i = 0; i < 100; i++) { if (await predicate()) return; await new Promise(r => setTimeout(r, 100)); } throw Error('fixture timeout'); };
  const native = code => app.evaluate(({}, code) => globalThis.fixture.viewer.view.webContents.executeJavaScript(code), code);
  await wait(() => app.evaluate(() => globalThis.fixture?.phases.includes('page'))).catch(async error => { console.log(await app.evaluate(() => ({ phases: globalThis.fixture.phases, logs: globalThis.fixture.logs, url: globalThis.fixture.viewer.view?.webContents.getURL() })), {exchanges,htmlLoads,sockets}); throw error; });
  assert.equal(exchanges, 1); assert.equal(htmlLoads, 0); assert.equal(sockets, 1);
  assert.equal(await native('typeof require + ":" + typeof window.beings'), 'undefined:undefined');
  assert.equal(await native('document.cookie'), '');
  assert.equal(await native('document.querySelector("canvas").width'), 320);
  await wait(async () => (await native('document.querySelector("canvas").getContext("2d").getImageData(10,10,1,1).data[2]')) === 160);
  assert.equal(await native('document.body.classList.contains("preview")'), true);
  await assert.rejects(native('window.homeViewer.request("control","claim")'), /未完成/);
  await app.evaluate(() => globalThis.fixture.viewer.setBounds({ x: 200, y: 100, width: 600, height: 400, visible: true, presentation: 'browser', dark: true }));
  await wait(async () => !(await native('document.body.classList.contains("preview")')));
  assert.equal(await native('document.documentElement.dataset.theme'), 'dark');
  const fitted = () => native(`(() => { const v = document.querySelector('#viewport').getBoundingClientRect(), c = document.querySelector('canvas').getBoundingClientRect(); return Math.abs(c.width - Math.min(v.width, v.height * 320 / 180)) < 2 && Math.abs(c.height / c.width - 180 / 320) < .01; })()`);
  await wait(fitted);
  for (const presentation of ['preview', 'browser', 'preview', 'browser']) {
    await app.evaluate(({}, presentation) => { const {viewer} = globalThis.fixture; viewer.setBounds({x:200,y:60,width:presentation === 'preview' ? 320 : 680,height:presentation === 'preview' ? 225 : 500,visible:true,presentation}); }, presentation);
    await wait(fitted);
  }
  await app.evaluate(() => { const {viewer,window} = globalThis.fixture; viewer.setBounds({x:200,y:60,width:680,height:500,visible:false,presentation:'browser'}); window.webContents.setZoomFactor(1.25); viewer.setBounds({x:100,y:60,width:600,height:400,visible:true,presentation:'browser'}); });
  await wait(fitted);
  await app.evaluate(() => { const {viewer,window} = globalThis.fixture; window.webContents.setZoomFactor(1); viewer.setBounds({x:200,y:100,width:600,height:400,visible:true,presentation:'browser'}); });
  await wait(fitted);

  await native('document.querySelector("#control").click()');
  await wait(async () => (await native('document.querySelector("#control").textContent')) === '交还 Being');
  const center = await native(`(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  assert.equal(await native(`getComputedStyle(document.querySelector('canvas')).pointerEvents`), 'none');
  await app.evaluate(({}, p) => { const wc = globalThis.fixture.viewer.view.webContents; wc.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p}); wc.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...p}); }, {x: Math.round(center.x), y: Math.round(center.y)});
  await wait(() => actions.length === 1);
  assert.equal(actions[0].action, 'native_click');
  assert(Math.abs(actions[0].x - 160) <= 1 && Math.abs(actions[0].y - 90) <= 1, 'native pointer must map to framebuffer coordinates');
  await native('window.homeViewer.request("input",{action:"native_type",text:"中文输入测试"})');
  await native('window.homeViewer.request("input",{action:"native_scroll",x:100,y:60,delta_y:240})');
  await native('window.homeViewer.request("control","renew")');
  assert.equal(actions.length, 3); assert(controls.includes('renew'));
  await assert.rejects(native('window.homeViewer.request("input",{action:"native_click",x:999,y:999})'));
  await assert.rejects(native('window.homeViewer.request("input",{action:"shell",command:"bad"})'));
  assert.equal(actions.length, 3);
  await native(`(() => {
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', '文'.repeat(4001));
    document.querySelector('#keyboard').dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  })()`);
  assert.equal(await native('document.querySelector("#notice").hidden'), false);
  assert.match(await native('document.querySelector("#notice").textContent'), /4000/);
  assert.equal(actions.length, 3, 'Oversized paste must not send a truncated prefix');
  await app.evaluate(() => globalThis.fixture.viewer.setBounds({ x: 200, y: 100, width: 600, height: 400, visible: false, presentation: 'preview' }));
  await wait(() => controls.includes('release'));
  await assert.rejects(native('window.homeViewer.request("input",{action:"native_key",key:"Enter",modifiers:0})'));
  await app.evaluate(() => globalThis.fixture.viewer.setBounds({ x: 200, y: 100, width: 600, height: 400, visible: true, presentation: 'preview' }));
  assert.equal(exchanges, 1); assert.equal(sockets, 1, 'layout changes must retain the live stream');
  assert(origins.every(origin => origin === 'https://home.beings.town')); assert(cookies.every(cookie => cookie === 'bh_desktop=fixture-session'));
  for (const socket of wss.clients) socket.terminate();
  await wait(() => sockets === 2);
  await wait(async () => await native('document.querySelector("#loading").hidden'));
  assert.equal(actions.length, 3, 'network recovery must never replay an input');
  assert.equal(controls.filter(value => value === 'claim').length, 1, 'network recovery must not reclaim control');
  expired = true;
  await app.evaluate(() => globalThis.fixture.viewer.transport.read().catch(() => {}));
  await wait(() => app.evaluate(() => globalThis.fixture.phases.includes('expired')));
  assert.equal(await app.evaluate(() => !!globalThis.fixture.viewer.view), false);
  assert.equal(await app.evaluate(() => globalThis.fixture.window.contentView.children.length), 0);
  console.log('PASS Home stream: isolated ticket/cookie, no remote HTML, real RFB frames, native IPC boundary, input validation, claim/renew/release, retained layout session, expiry cleanup.');
} finally {
  if (app) await app.close().catch(() => {});
  if (wss) { for (const socket of wss.clients) socket.terminate(); wss.close(); }
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await rm(directory, { recursive: true, force: true });
}
