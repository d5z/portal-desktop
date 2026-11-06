import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:https';
import { X509Certificate } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'parse5';
import { desktopExecutable } from './support/desktop.mjs';
import { launchDesktop } from './support/electron-lifecycle.mjs';

const profile = await mkdtemp(path.join(os.tmpdir(), 'portal packaged resources '));
const options = { executablePath: await desktopExecutable(), cwd: profile, env: {
  ...process.env, PORTAL_DESKTOP_USER_DATA: profile, PORTAL_DESKTOP_TEST_MOCK_KEYCHAIN: '1',
} };
let app, server;
try {
  app = await launchDesktop(options);
  assert(await app.evaluate(({ app }) => app.isPackaged));
  // Follow each document's actual links through the packaged protocol, including
  // Vite's hashed bundle names and the chat origin's resource allowlist.
  const urls = new Set(['beings://desktop/', 'beings://chat/', 'beings://chat/iui-runtime.html',
    'beings://desktop/client-context-host.html', 'beings://desktop/pptx-preview.html',
    'beings://desktop/pdf.worker.min.js', 'beings://desktop/pdf-cmaps/Adobe-GB1-UCS2.bcmap',
    'beings://desktop/pdf-fonts/FoxitSerif.pfb']);
  for (const url of urls) {
    const html = await app.evaluate(async ({ net }, url) => {
      const response = await net.fetch(url);
      if (!response.ok) throw Error(url + ': HTTP ' + response.status);
      if (response.headers.get('content-type')?.startsWith('text/html')) return response.text();
      if (!(await response.arrayBuffer()).byteLength) throw Error('Empty packaged resource: ' + url);
    }, url);
    if (!html) continue;
    const nodes = [parse(html)];
    for (const node of nodes) {
      nodes.push(...(node.childNodes || []));
      const target = node.attrs?.find(attr => (node.tagName === 'link' && attr.name === 'href') ||
        (['script', 'iframe'].includes(node.tagName) && attr.name === 'src'))?.value;
      if (target && new URL(target, url).protocol === 'beings:') urls.add(new URL(target, url).href);
    }
  }
  console.log('PASS packaged desktop, chat and preview resource URLs:', urls.size);
  // Seed only this fixture's credentials, using the same key as the next launch.
  const [connection, home] = await app.evaluate(({ safeStorage }) => [
    { link: 'http://127.0.0.1:1/test/?token=fixture' },
    { version: 1, tokens: { access: 'fixture', refresh: 'fixture', expires: Date.now() + 3600000, subject: 'fixture' } },
  ].map(value => safeStorage.encryptString(JSON.stringify(value)).toString('base64')));
  const jpeg = Buffer.from(await app.evaluate(({ nativeImage }) => nativeImage.createFromBitmap(Buffer.alloc(4, 255), { width: 1, height: 1 }).toJPEG(90).toString('base64')), 'base64');
  await app.close(); app = undefined;
  await writeFile(path.join(profile, 'connection.json'), JSON.stringify({ version: 1, settings: { backgroundEnabled: false, autoStart: false, workspace: profile }, credential: connection }));
  await writeFile(path.join(profile, 'home-session.json'), JSON.stringify({ credential: home }));

  // Both the Node Home API and the Chromium viewer connect only to this fixture.
  const host = 'home.beings.town';
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'key.pem', '-out', 'cert.pem', '-days', '1', '-subj', '/CN=' + host], { cwd: profile, stdio: 'ignore' });
  const cert = await readFile(path.join(profile, 'cert.pem'), 'utf8');
  const computer = { id: 'computer', being_profile_id: 'p', generation: 1, status: 'running' };
  const api = {
    '/v1/me': { being: { id: 'p' }, storage: { status: 'ready' }, computer_enabled: true },
    '/v1/me/heart': { configured: true, heart_being_id: 'test', origin: 'http://127.0.0.1:1' },
    '/v1/me/computer': computer, '/v1/me/computer/browser': { ready: true },
    '/v1/me/computer/desktop-ticket': { ticket: 'fixture', connect_url: 'https://' + host + '/desktop/connect?ticket=fixture', expires_at: new Date(Date.now() + 120000).toISOString() },
    '/desktop/computer/browser/state': { ready: true, can_control: false },
  };
  server = createServer({ cert, key: await readFile(path.join(profile, 'key.pem')) }, (req, res) => {
    if (req.url === '/desktop/connect?ticket=fixture') res.writeHead(302, { Location: '/desktop/computer/', 'Set-Cookie': 'bh_desktop=fixture; HttpOnly; Secure; SameSite=Strict; Path=/desktop; Max-Age=120' }).end();
    else if (req.url === '/desktop/computer/browser/frame') res.writeHead(200, { 'Content-Type': 'image/jpeg' }).end(jpeg);
    else if (Object.hasOwn(api, req.url)) res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(api[req.url]));
    else res.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  app = await launchDesktop({ ...options, args: ['--no-proxy-server', '--host-resolver-rules=MAP ' + host + ' 127.0.0.1:' + port] });
  const page = await app.firstWindow();
  await app.evaluate(({ app }, { host, port, cert, fingerprint }) => {
    // Chromium's host mapping does not apply to the main process's Node fetch.
    const tls = process.getBuiltinModule('node:tls'), connect = tls.connect;
    const { X509Certificate } = process.getBuiltinModule('node:crypto');
    tls.connect = function (options, ...args) {
      if (options.host === host) options = { ...options, host: '127.0.0.1', port, servername: host, ca: cert };
      return connect.call(this, options, ...args);
    };
    app.on('session-created', jar => jar.setCertificateVerifyProc((request, done) => done(
      request.hostname === host && new X509Certificate(request.certificate.data).fingerprint256 === fingerprint ? 0 : -3
    )));
  }, { host, port, cert, fingerprint: new X509Certificate(cert).fingerprint256 });
  await page.frameLocator('#chat-frame').locator('#input').waitFor({ state: 'attached' });
  await page.evaluate(() => { window.viewerPhase = 'closed'; window.beings.home.subscribe(state => { window.viewerPhase = state.viewer; }); });
  const opened = await page.evaluate(() => window.beings.home.action('open'));
  assert(!opened.error, opened.error);
  await page.waitForFunction(() => ['page', 'error', 'expired'].includes(window.viewerPhase), null, { timeout: 20000 });
  assert.equal(await page.evaluate(() => window.viewerPhase), 'page', 'Packaged Home viewer must paint a frame');
  console.log('PASS packaged Home: production open action, local document, preload and first frame.');
} finally {
  if (app) await app.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await rm(profile, { recursive: true, force: true });
}
