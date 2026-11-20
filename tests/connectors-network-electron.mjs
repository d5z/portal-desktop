import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { c as archive } from 'tar';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
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
  const source = path.join(directory, 'source'); await mkdir(source);
  const manifest = { name: 'network-kit', version: '1.0', command: [process.execPath, '{{KIT_HOME}}/server.mjs'], tools: [{name: 'ping', description: 'Published tool'}], provision: {env: [{name: 'OPTIONAL_KEY', required: false}]} };
  await writeFile(path.join(source, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(path.join(source, 'server.mjs'), 'throw Error("Preparation must never execute tools");');
  await archive({gzip:true,cwd:source,file:path.join(directory,'kit.tar.gz')}, ['manifest.json','server.mjs']);
  const bundle = await readFile(path.join(directory,'kit.tar.gz'));
  const releaseId = '20000000-0000-8000-8000-000000000001';
  const sha256 = createHash('sha256').update(bundle).digest('hex');
  const localApp = {kind:'local_kit',app:{release_id:releaseId,kit_id:'town/original-id',name:'Network Kit Display Name',version:'1.0',runtimes:['local'],availability:'listed',local_install:{kind:'town',source_id:'original-id',used_before:true}},local_kit:{source_id:'original-id',installer:'desktop_legacy',tools:[],install_manifest:manifest,bundle:{download_url:`v1/local-kit-bundles/${releaseId}/${sha256}`,sha256,size_bytes:bundle.length}}};
  const config = path.join(directory,'portal.toml');
  await writeFile(config, `kits_dir = ${JSON.stringify(path.join(directory,'kits'))}\nkits_enabled = true\n`);
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
    import { KitInstaller } from './desktop/main/kits/install';
    import { registerKitsIpc } from './desktop/main/kits/ipc';
    import { registerLocalProtocol } from './desktop/main/app/protocol';
    const directory = ${JSON.stringify(directory)};
    app.setPath('userData', directory);
    protocol.registerSchemesAsPrivileged([{ scheme: 'beings', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
    app.whenReady().then(async () => {
      await writeFile(path.join(directory, 'home-session.json'), JSON.stringify({credential:Buffer.from(JSON.stringify({version:1,tokens:{access:'private-access',refresh:'private-refresh',expires:Date.now()+3600000,subject:'one'}})).toString('base64')}));
      const requests = [];
      const localApp = ${JSON.stringify(localApp)};
      const bundle = Buffer.from(${JSON.stringify(bundle.toString('base64'))}, 'base64');
      let mode = '';
      const client = new HomeClient(directory, {isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()}, async()=>{}, async (url, init) => {
        const target = new URL(String(url));
        const pathname = target.pathname;
        requests.push({pathname, method:init.method || 'GET', body:init.body, authorization:new Headers(init.headers).get('Authorization')});
        if (pathname.startsWith('/v1/local-kit-bundles/')) {
          if (mode === 'download-404' || mode === 'download-503') return new Response('{"error":"local_kit_bundle_not_found"}', {status:Number(mode.slice(9)),headers:{'Content-Type':'application/json; charset=utf-8'}});
          const bytes = mode === 'tampered' ? Buffer.from(bundle).fill(0,0,1) : bundle;
          return new Response(bytes, {headers:{'Content-Type':'application/gzip','Content-Length':String(bytes.length)}});
        }
        if (pathname === '/v1/me/app-catalog/' + localApp.app.release_id) {
          const detail = structuredClone(localApp);
          if (mode === 'no-bundle') detail.local_kit.bundle = null;
          if (mode === 'wrong-source') detail.local_kit.source_id = 'different';
          return Response.json(detail);
        }
        if (pathname.endsWith('/offline')) throw Error('Fixture transport offline');
        if (pathname.endsWith('/empty')) return new Response(null, {status:502});
        if (pathname.startsWith('/v1/me/app-catalog/')) return Response.json({kind:'cloud_connector',app:{release_id:'gmail',name:'Gmail'},connector:{name:'Gmail',accounts:[],methods:[],skills:[]}});
        if (pathname.endsWith('/remove')) return new Response(null, {status:204});
        if (pathname.endsWith('/actions')) return Response.json({error:'kit_operation_changed'}, {status:409});
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
      const handle = (channel, callback) => ipcMain.handle(channel, (event, ...args) => {
        if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== shellURL) throw Error('Untrusted sender');
        return callback(...args);
      });
      const connectors = new HomeConnectors(client, async()=>{});
      registerHomeIpc(handle, {}, {}, {}, connectors, network);
      const kitInstaller = new KitInstaller(async () => {throw Error('Settings must never call Town');});
      registerKitsIpc({handle, exclusive: operation => operation(), window:()=>window, kitInstaller, homeConnectors:connectors,
        store:{connection:{},settings:{workspace:directory,kitsEnabled:true,portalConfigPath:${JSON.stringify(config)}}}});
      globalThis.fixture = {requests, setMode: value => {mode=value;}, navigate: async url => {shellURL = url; await window.loadURL(url);}};
      await window.loadURL(shellURL);
    });
    app.on('window-all-closed', () => app.quit());
  ` }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: main });
  app = await launchDesktop({ executablePath: electronPath, args: [main], env: { ...process.env, PORTAL_DESKTOP_USER_DATA: directory, PORTAL_DESKTOP_TEST_MOCK_KEYCHAIN: '1' } });
  const page = await app.firstWindow();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  const requests = [], responses = [];
  const catalogBodies = [], bundleBodies = [], bodyReads = [];
  cdp.on('Network.requestWillBeSent', event => { if (event.request.url.includes('/api/v1/')) requests.push(event); });
  cdp.on('Network.responseReceived', event => { if (event.response.url.includes('/api/v1/')) responses.push(event); });
  cdp.on('Network.loadingFinished', event => {
    const response = responses.find(item => item.requestId === event.requestId && /\/(app|kit)-catalog|local-kit-bundles/.test(item.response.url));
    if (!response) return;
    bodyReads.push(cdp.send('Network.getResponseBody', { requestId: event.requestId }).then(result => {
      (response.response.url.includes('/local-kit-bundles/') ? bundleBodies : catalogBodies).push({ ...response.response, body: result.base64Encoded ? Buffer.from(result.body, 'base64').toString() : result.body });
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
    await page.evaluate(() => window.beings.home.connectors.reportLocalKitHistory({source_id:'local-kit',version:'1.2.3'}));
    assert.equal((await page.evaluate(() => window.beings.home.connectors.lifecycle('install', 'uninstall', 2, 'request-id'))).accepted, false);
    await assert.rejects(page.evaluate(() => window.beings.home.connectors.detail('offline')), /网络连接失败/);
    await assert.rejects(page.evaluate(() => window.beings.home.connectors.detail('empty')), error => !String(error).includes('Unexpected end of JSON input'));
    assert.equal(await page.evaluate(async () => (await fetch('beings://desktop/api/v1/me/kit-catalog')).status), 403);
    const detail = await page.evaluate(id => window.beings.home.connectors.appDetail(id), releaseId);
    assert.equal(detail.kind, 'local_kit');
    for (const [mode, message] of [['no-bundle', /安装包/], ['wrong-source', /来源/], ['download-404', /不存在/], ['download-503', /不可用/], ['tampered', /SHA-256/]]) {
      await app.evaluate((_e, mode) => globalThis.fixture.setMode(mode), mode);
      await assert.rejects(page.evaluate(id => window.beings.prepareKit('original-id', id), releaseId), message);
      assert.equal((await page.evaluate(() => window.beings.localKits())).kits.length, 0);
    }
    await app.evaluate(() => globalThis.fixture.setMode(''));
    const plan = await page.evaluate(id => window.beings.prepareKit('original-id', id), releaseId);
    assert.equal(plan.name, 'network-kit');
    assert.equal((await page.evaluate(() => window.beings.localKits())).kits.length, 0, 'Preparing does not activate the Kit');
    await page.evaluate(ticket => window.beings.installKit({ticket,environment:{}}), plan.ticket);
    const installed = (await page.evaluate(() => window.beings.localKits())).kits[0];
    assert.equal(installed.name, 'network-kit');
    assert.equal(installed.installSource.releaseId, releaseId);
    assert.equal(installed.command[1], path.join(directory,'kits','network-kit','server.mjs'));
    await page.evaluate(() => window.beings.home.connectors.reportLocalKitHistory({source_id:'original-id',version:'1.0'}));
    await page.evaluate(() => window.beings.deleteKit('network-kit'));
    assert.equal((await page.evaluate(() => window.beings.localKits())).kits.length, 0);
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
  const historyRequests = requests.filter(event => event.request.method === 'POST' && event.request.url.endsWith('/local-kit-history'));
  const historyUpstream = upstream.filter(request => request.pathname.endsWith('/local-kit-history'));
  assert.equal(historyRequests.length, historyUpstream.length);
  for (let index = 0; index < historyRequests.length; index++) {
    assert.equal(historyRequests[index].request.postData, historyUpstream[index].body);
  }
  assert.deepEqual(historyRequests.map(event => JSON.parse(event.request.postData)), [
    {source_id:'local-kit',version:'1.2.3'},
    {source_id:'original-id',version:'1.0'},
    {source_id:'local-kit',version:'1.2.3'},
    {source_id:'original-id',version:'1.0'},
  ]);
  assert(upstream.filter(request => !request.pathname.startsWith('/v1/local-kit-bundles/')).every(request => request.authorization === 'Bearer private-access'));
  assert(upstream.filter(request => request.pathname.startsWith('/v1/local-kit-bundles/')).every(request => request.authorization === null));
  assert(!upstream.some(request => request.pathname.includes('/api/grove/') || request.pathname.endsWith('/connector')), 'Settings details and delivery never use old Kit APIs');
  for (const status of [404,503]) assert(bundleBodies.some(item => item.status === status && item.body === '{"error":"local_kit_bundle_not_found"}' && new Headers(item.headers).get('Content-Type') === 'application/json; charset=utf-8'));
  assert(bundleBodies.some(item => item.status === 200 && new Headers(item.headers).get('Content-Type') === 'application/gzip'));
  assert.equal(requests.filter(event => event.request.url.includes('/local-kit-bundles/') && event.request.method === 'GET').length, 8);
  assert(requests.filter(event => event.request.url.includes('/app-catalog/') || event.request.url.includes('/local-kit-bundles/')).every(event => !new URL(event.request.url).search), 'Detail and bundle requests contain no client-only query arguments');
  assert(!JSON.stringify({requests,responses}).includes('private-access'));
  assert(!JSON.stringify({requests,responses}).includes('private-refresh'));
  console.log('Connector Network passed: real preload/protocol/installer in packaged and dev origins; Home unified detail, anonymous binary download, hash rejection, install/receipt/history/delete; original error bodies and HTTP statuses; no old Kit API requests or Home tokens in renderer.');
} finally {
  if (app) await app.close();
  await new Promise(resolve => server.close(resolve));
  await rm(directory, {recursive:true,force:true});
}
