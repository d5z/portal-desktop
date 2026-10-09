// Exercise Chromium's actual redirect handling in an isolated, windowless Electron process.
import { build } from 'esbuild';
import electron from 'electron';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temporary = await mkdtemp(path.join(os.tmpdir(), 'plugin-download-test-'));
try {
  const file = path.join(temporary, 'main.cjs');
  await build({ stdin: { resolveDir: process.cwd(), contents: `
import { app, net, dialog } from 'electron';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { c as archive } from 'tar';
import { downloadFetch } from './desktop/main/kits/download-fetch';
import { downloadBundle } from './desktop/main/kits/install';
import { registerPluginsIpc } from './desktop/main/plugins/ipc';
import { PluginRegistry } from './desktop/main/plugins/registry';

mkdirSync(path.join(${JSON.stringify(temporary)}, 'profile'));
app.setPath('userData', path.join(${JSON.stringify(temporary)}, 'profile'));
app.whenReady().then(async () => {
  let server;
  try {
    let destinationHits = 0, cookie = '';
    server = createServer((req, res) => {
      if (req.url === '/redirect') { res.writeHead(302, { location: '/archive', 'set-cookie': 'secret=1' }); res.end(); }
      else if (req.url === '/slow') { res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' }); res.write(Buffer.alloc(4096, 1)); }
      else if (req.url === '/empty') { res.writeHead(204); res.end(); }
      else { destinationHits++; cookie = req.headers.cookie || ''; res.end('bundle'); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    // This is the exact failure recorded by the installed client.
    await assert.rejects(net.fetch(base + '/redirect', { redirect: 'manual' }), /Redirect was cancelled/);
    console.log('Reproduced Electron manual redirect failure');
    const redirect = await downloadFetch(base + '/redirect', { redirect: 'manual' });
    assert.equal(redirect.status, 302);
    assert.equal(destinationHits, 0, 'adapter must not follow unvalidated redirects');
    assert.equal(await (await downloadFetch(new URL(redirect.headers.get('location'), base), { redirect: 'manual' })).text(), 'bundle');
    assert.equal(cookie, '', 'download must omit session cookies');
    assert.equal((await downloadFetch(base + '/empty', { redirect: 'manual' })).status, 204);
    const controller = new AbortController();
    const response = await downloadFetch(base + '/slow', { redirect: 'manual', signal: controller.signal });
    const pending = response.text(); controller.abort();
    await assert.rejects(pending, /abort/i);
    await assert.rejects(downloadFetch(base, { redirect: 'manual', signal: AbortSignal.abort() }), /abort/i);
    let unsafeRequests = 0;
    await assert.rejects(downloadBundle('https://github.com/fixture/archive', async () => {
      unsafeRequests++; return downloadFetch(base + '/redirect', { redirect: 'manual' }).then(() => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }));
    }), /下载源/);
    assert.equal(unsafeRequests, 1);
    console.log('PASS: Chromium redirect and cancellation checks');

    const root = ${JSON.stringify(temporary)};
    const source = path.join(root, 'source'); await mkdir(source);
    const manifest = { schemaVersion: 1, apiVersion: 1, id: 'fixture.board', name: 'Fixture', version: '1.0.0', description: 'Board', author: 'Fixture', entry: 'index.html', capabilities: [], contributes: { views: [{ id: 'board', title: 'Board' }] } };
    await writeFile(path.join(source, 'desktop.plugin.json'), JSON.stringify(manifest));
    await writeFile(path.join(source, 'index.html'), '<h1>Board</h1>');
    const tarball = path.join(root, 'plugin.tar.gz');
    await archive({ gzip: true, cwd: source, file: tarball }, ['desktop.plugin.json', 'index.html']);
    const bytes = await readFile(tarball);
    const registry = new PluginRegistry(path.join(root, 'registry'));
    dialog.showMessageBox = async () => ({ response: 1 });
    for (const kind of ['app', 'plugin']) {
      const handlers = new Map();
      const urls = [];
      registerPluginsIpc({ handle: (name, fn) => handlers.set(name, fn), exclusive: fn => fn(), window: () => ({}), registry,
        fetcher: async (input) => {
          urls.push(String(input));
          if (String(input).includes('/releases/download/')) return new Response(bytes);
          return Response.json({ id: 'fixture', name: manifest.name, version: manifest.version, kind, tags: kind === 'app' ? ['plugin'] : [],
            repo_url: 'https://github.com/fixture/board', release_tag: 'v1.0.0', has_bundle: true });
        } });
      assert.equal(await handlers.get('beings:plugins-install')('fixture'), true);
      assert(urls[1].endsWith('/releases/download/v1.0.0/desktop-plugin.tar.gz'), 'prefer plugin asset to Grove app download');
      const installed = (await registry.list()).plugins;
      assert.equal(installed[0].enabled, true);
      assert.equal(installed[0].source.id, 'fixture');
      const session = await registry.open(manifest.id, 'board');
      assert((await registry.document(new URL(session.url)).text()).includes('<h1>Board</h1>'));
      await registry.remove(manifest.id);
    }
    if (process.argv.includes('--live-starmap')) {
      const handlers = new Map();
      registerPluginsIpc({ handle: (name, fn) => handlers.set(name, fn), exclusive: fn => fn(), window: () => ({}), registry, fetcher: downloadFetch });
      assert.equal(await handlers.get('beings:plugins-install')('9eCdzJlHNmVMrwujpxWgJ'), true);
      const installed = (await registry.list()).plugins[0];
      assert.equal(installed.manifest.id, 'community.pipeline');
      assert.equal(installed.enabled, true);
      const session = await registry.open(installed.manifest.id, 'board');
      assert.equal(registry.document(new URL(session.url)).status, 200);
      console.log(JSON.stringify({ livePlugin: installed.manifest.name, version: installed.manifest.version, enabled: installed.enabled, isolatedInstall: true }));
    }
    console.log('PASS: manual redirects, omitted cookies, abort, empty response, host validation, native/legacy plugin install');
    server.closeAllConnections(); server.close(); app.exit(0);
  } catch (error) { console.error(error); server?.closeAllConnections(); server?.close(); app.exit(1); }
});
` }, outfile: file, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], logLevel: 'silent' });
  await new Promise((resolve, reject) => {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [file, ...process.argv.slice(2)], { env, windowsHide: true, stdio: 'inherit' });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Plugin download test timed out')); }, 150000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Electron exited with ' + code)); });
  });
} finally { await rm(temporary, { recursive: true, force: true }); }
