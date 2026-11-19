import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { build } from 'esbuild';
import electronPath from 'electron';
import { launchDesktop } from './support/electron-lifecycle.mjs';

const directory = await mkdtemp(path.join(os.tmpdir(), 'connector-network-'));
const policy = (await readFile('desktop/renderer/index.html', 'utf8')).match(/<meta http-equiv="Content-Security-Policy"[^>]*>/)[0];
const html = `<!doctype html><head>${policy}<title>Connector Network fixture</title></head><body>Connector Network</body>`;
const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(html); });
let app;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const devURL = `http://127.0.0.1:${server.address().port}/`;
  await writeFile(path.join(directory, 'index.html'), html);
  const preload = path.join(directory, 'preload.cjs'), main = path.join(directory, 'main.cjs');
  await build({ entryPoints: ['desktop/preload/preload.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: preload });
  await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { app, BrowserWindow, ipcMain, protocol } from 'electron';
    import { writeFile } from 'node:fs/promises';
    import path from 'node:path';
    import { HomeClient } from './desktop/main/home/client';
    import { HomeConnectors } from './desktop/main/home/connectors';
    import { ConnectorNetwork } from './desktop/main/home/network';
    import { registerHomeIpc } from './desktop/main/home/ipc';
    import { registerLocalProtocol } from './desktop/main/app/protocol';
    const directory = ${JSON.stringify(directory)};
    app.setPath('userData', directory);
    protocol.registerSchemesAsPrivileged([{ scheme: 'beings', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
    app.whenReady().then(async () => {
      await writeFile(path.join(directory, 'home-session.json'), JSON.stringify({credential:Buffer.from(JSON.stringify({version:1,tokens:{access:'private-access',refresh:'private-refresh',expires:Date.now()+3600000,subject:'one'}})).toString('base64')}));
      const requests = [];
      const client = new HomeClient(directory, {isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()}, async()=>{}, async (url, init) => {
        const target = new URL(String(url));
        const pathname = target.pathname;
        requests.push({pathname, search: new URL(String(url)).search, method:init.method || 'GET', body: init.body, authorization:new Headers(init.headers).get('Authorization')});
        if (pathname.endsWith('/remove')) return new Response(null, {status:204});
        if (pathname.endsWith('/actions')) return init.body && JSON.parse(init.body).expected_revision === 2 ? Response.json({error:'kit_operation_changed'}, {status:409}) : Response.json({installation_id:'install',operation_id:'operation',revision:4,status:'preparing'}, {status:202});
        if (pathname.includes('/offline/')) throw new Error('Fixture transport offline');
        if (pathname.includes('/app-catalog') && target.searchParams.get('q')?.startsWith('legacy-')) {
          const status = Number(target.searchParams.get('q').slice(7));
          return new Response('<html>Catalog route unavailable</html>', {status, headers:{'Content-Type':'text/html; charset=utf-8'}});
        }
        if (pathname.includes('/app-catalog') || pathname.includes('/kit-catalog')) return new Response('{ "enabled": true, "items": [{"release_id":"gmail","name":"Gmail","icon_url":"/assets/icon.svg"}] }', {headers:{'Content-Type':'application/json; charset=utf-8'}});
        if (pathname.includes('/empty/')) return new Response(null, {status:502});
        return Response.json({name:'Gmail',accounts:[],methods:[]});
      });
      await client.load();
      let shellURL = 'beings://desktop/';
      const network = new ConnectorNetwork(() => shellURL);
      registerLocalProtocol(directory, {}, undefined, {}, undefined, undefined, network);
      const window = new BrowserWindow({width:800,height:600,show:false,webPreferences:{preload:${JSON.stringify(preload)},sandbox:true,contextIsolation:true,nodeIntegration:false}});
      registerHomeIpc((channel, callback) => ipcMain.handle(channel, (event, ...args) => {
        if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== shellURL) throw Error('Untrusted sender');
        return callback(...args);
      }), {contextChanged(){},state:{authenticated:true,sessionVersion:0}}, {}, {}, new HomeConnectors(client, async()=>{}), network);
      globalThis.fixture = {requests, navigate: async url => {shellURL = url; await window.loadURL(url);}};
      await window.loadURL(shellURL);
    });
    app.on('window-all-closed', () => app.quit());
  ` }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: main });
  app = await launchDesktop({ executablePath: electronPath, args: [main], env: { ...process.env, PORTAL_DESKTOP_USER_DATA: directory, PORTAL_DESKTOP_TEST_MOCK_KEYCHAIN: '1' } });
  const page = await app.firstWindow();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  const requests = [], responses = [];
  const catalogBodies = [], bodyReads = [];
  cdp.on('Network.requestWillBeSent', event => { if (event.request.url.includes('/api/v1/me/')) requests.push(event); });
  cdp.on('Network.responseReceived', event => { if (event.response.url.includes('/api/v1/me/')) responses.push(event); });
  cdp.on('Network.loadingFinished', event => {
    const response = responses.find(item => item.requestId === event.requestId && /\/(app|kit)-catalog/.test(item.response.url));
    if (!response) return;
    bodyReads.push(cdp.send('Network.getResponseBody', { requestId: event.requestId }).then(result => {
      catalogBodies.push({ ...response.response, body: result.base64Encoded ? Buffer.from(result.body, 'base64').toString() : result.body });
    }));
  });
  for (const url of ['beings://desktop/', devURL]) {
    if (url !== page.url()) await app.evaluate(async (_electron, url) => globalThis.fixture.navigate(url), url);
    assert.equal(await page.evaluate(() => typeof require), 'undefined');
    assert.equal((await page.evaluate(() => window.beings.home.connectors.catalog({q:'gmail'}))).items[0].name, 'Gmail');
    for (const status of [404, 405]) {
      const catalog = await page.evaluate(status => window.beings.home.connectors.catalog({q:'legacy-' + status}), status);
      assert.equal(catalog.items[0].icon_url, 'https://home.beings.town/assets/icon.svg');
    }
    await Promise.all(bodyReads);
    assert.equal((await page.evaluate(() => window.beings.home.connectors.detail('gmail'))).name, 'Gmail');
    await page.evaluate(() => window.beings.home.connectors.removeAccount('gmail', 'account'));
    assert.equal((await page.evaluate(() => window.beings.home.connectors.lifecycle('install', 'uninstall', 2, 'request-id'))).accepted, false);
    await assert.rejects(page.evaluate(() => window.beings.home.connectors.detail('offline')), /网络连接失败/);
    await assert.rejects(page.evaluate(() => window.beings.home.connectors.detail('empty')), error => !String(error).includes('Unexpected end of JSON input'));
    assert.equal(await page.evaluate(async () => (await fetch('beings://desktop/api/v1/me/kit-catalog')).status), 403);
  }
  assert.equal(requests.filter(event => event.request.method === 'POST' && event.request.url.endsWith('/remove')).length, 2);
  assert.equal(requests.filter(event => event.request.method === 'POST' && event.request.url.endsWith('/actions')).length, 2);
  assert(responses.some(event => event.response.status === 204));
  assert(responses.some(event => event.response.status === 409));
  assert(responses.some(event => event.response.status === 502));
  await Promise.all(bodyReads);
  for (const status of [404, 405]) {
    const failed = catalogBodies.filter(item => item.status === status);
    assert.equal(failed.length, 2);
    assert(failed.every(item => item.url.includes('/app-catalog?') && item.body === '<html>Catalog route unavailable</html>' && new Headers(item.headers).get('Content-Type') === 'text/html; charset=utf-8'));
  }
  const legacy = catalogBodies.filter(item => item.url.includes('/kit-catalog?'));
  assert.equal(legacy.length, 4);
  assert(legacy.every(item => item.status === 200 && new Headers(item.headers).get('Content-Type') === 'application/json; charset=utf-8' && item.body === '{ "enabled": true, "items": [{"release_id":"gmail","name":"Gmail","icon_url":"/assets/icon.svg"}] }'));
  assert.equal(JSON.parse(catalogBodies[0].body).items[0].name, 'Gmail');
  const upstream = await app.evaluate(() => globalThis.fixture.requests);
  assert.equal(upstream.length, 20, 'Unauthenticated local requests never reach Home; writes are not duplicated');
  assert(upstream.every(request => request.authorization === 'Bearer private-access'));
  assert(upstream.filter(request => request.pathname.endsWith('/app-catalog')).every(request => new URLSearchParams(request.search).has('q') && !request.search.includes('args=')));
  assert(upstream.filter(request => request.pathname.endsWith('/actions')).every(request => JSON.parse(request.body).action === 'uninstall' && !Array.isArray(JSON.parse(request.body))));
  await page.evaluate(() => window.beings.home.connectors.lifecycle('install', 'uninstall', 3, 'accepted-operation'));
  assert(responses.some(event => event.response.status === 202), 'Accepted lifecycle status remains visible in Network');
  assert(!JSON.stringify({requests,responses}).includes('private-access'));
  assert(!JSON.stringify({requests,responses}).includes('private-refresh'));
  console.log('Connector Network passed: real preload and protocol, packaged/dev origins, visible request payloads, original catalog bodies/Content-Type, separate 404/405 fallback requests, and 204/409/502 statuses, no Home tokens in renderer, no duplicate writes.');
} finally {
  if (app) await app.close();
  await new Promise(resolve => server.close(resolve));
  await rm(directory, {recursive:true,force:true});
}
