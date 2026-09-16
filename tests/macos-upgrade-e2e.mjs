// Native installation test: one disposable profile, real Developer ID apps,
// the real installer/LaunchServices handoff, and a local Being/relay only.
// The baseline is a versioned fixture, not a downloaded historical release.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { WebSocketServer } from 'ws';
import { launchDesktop } from './support/electron-lifecycle.mjs';

if (process.platform !== 'darwin') throw new Error('Run this native installation test on macOS.');
const execute = promisify(execFile), require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(label, predicate, timeout = 45_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await pause(200); }
  throw new Error(`Timed out: ${label}`);
}
async function clients() {
  const { stdout } = await execute('/bin/ps', ['-axo', 'pid=,comm=']);
  return stdout.split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(.+\/Contents\/MacOS\/Portal Desktop)$/.exec(line);
    return match ? [{ pid: Number(match[1]), executable: match[2] }] : [];
  });
}
assert.equal((await clients()).length, 0, 'Quit the daily client first; the test never opens a parallel client.');

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const signing = JSON.parse(await readFile(new URL('../desktop/macos-signing.json', import.meta.url), 'utf8'));
const out = path.resolve(process.env.PORTAL_DESKTOP_PACKAGE_OUT || 'out');
const name = `${pkg.productName}-darwin-${process.arch}`;
const candidate = path.join(out, name, `${pkg.productName}.app`);
const archive = path.join(out, 'make/zip/darwin', process.arch, `${name}-${pkg.version}.zip`);
const dmg = path.join(out, 'make', `${pkg.productName}-${pkg.version}-${process.arch}.dmg`);
const expectedBundle = JSON.parse(await readFile(path.join(candidate, 'Contents/Resources/runtime-bundle.json'), 'utf8'));
const archiveBytes = await readFile(archive), asset = `portal-desktop-${pkg.version}-macos-${process.arch}.zip`;
const sums = `${sha(archiveBytes)}  ${asset}\n`;
const previousVersion = pkg.version.replace(/\d+$/, number => String(Number(number) - 1));
assert.notEqual(previousVersion, pkg.version);
const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "portal-upgrade 中文 ' ")));
const profile = path.join(root, 'profile'), workspace = path.join(root, 'workspace'), kits = path.join(root, 'kits');
const current = path.join(root, 'Applications/Portal Desktop.app'), executable = path.join(current, 'Contents/MacOS/Portal Desktop');
let app, upgradedPid, relay, nextId = 0, passed = false, mounted = false;
const mount = path.join(root, 'mounted');
const ownedPortalPids = new Set(), pending = new Map();
const token = 'local-upgrade-fixture';
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://fixture.invalid');
  const json = data => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data)); };
  if (url.searchParams.get('token') !== token) { response.writeHead(401); response.end(); return; }
  if (url.pathname.endsWith('/api/status')) return json({ being_name: 'upgrade-fixture' });
  if (url.pathname.endsWith('/api/history')) return json({ messages: [] });
  if (url.pathname.endsWith('/api/stream/active')) { response.writeHead(204); response.end(); return; }
  if (url.pathname.endsWith('/api/llm/config')) return json({ model: 'retained-fixture-model', provider: 'fixture' });
  json({ status: 'ok' });
});
const wss = new WebSocketServer({ server, path: '/_relay' });
wss.on('connection', socket => {
  let ready = false;
  socket.on('message', bytes => {
    const message = JSON.parse(bytes.toString());
    if (!ready) {
      assert.equal(message.loom_token, token); assert.equal(message.being_id, 'upgrade-fixture');
      ready = true; relay = socket;
      socket.send(JSON.stringify({ ok: true, relay_keepalive: 'text-v1' })); return;
    }
    if (message.type === 'keepalive') { socket.send(JSON.stringify({ type: 'keepalive_ack' })); return; }
    const waiter = pending.get(message.id);
    if (waiter) { pending.delete(message.id); clearTimeout(waiter.timer); message.error ? waiter.reject(new Error(JSON.stringify(message.error))) : waiter.resolve(message.result); }
  });
});
function rpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Fixture RPC timed out: ${method}`)); }, 8000);
    pending.set(id, { resolve, reject, timer }); relay.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  });
}
const readJSON = async file => JSON.parse(await readFile(file, 'utf8'));
try {
  await Promise.all([mkdir(workspace), mkdir(kits), mkdir(path.dirname(current))]);
  await mkdir(mount);
  await execute('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, dmg]);
  mounted = true;
  await execute('/usr/bin/ditto', [path.join(mount, `${pkg.productName}.app`), current]);
  await execute('/usr/bin/hdiutil', ['detach', mount]); mounted = false;
  await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', current]);
  assert.equal(sha(await readFile(path.join(current, 'Contents/Resources/app.asar'))), sha(await readFile(path.join(candidate, 'Contents/Resources/app.asar'))));
  const unpacked = path.join(root, 'asar');
  const appAsar = path.join(current, 'Contents/Resources/app.asar');
  asar.extractAll(appAsar, unpacked);
  const previousPackage = await readJSON(path.join(unpacked, 'package.json'));
  previousPackage.version = previousVersion;
  await writeFile(path.join(unpacked, 'package.json'), JSON.stringify(previousPackage));
  await asar.createPackage(unpacked, appAsar);
  const infoPath = path.join(current, 'Contents/Info.plist');
  const info = JSON.parse((await execute('/usr/bin/plutil', ['-convert', 'json', '-o', '-', infoPath])).stdout);
  info.CFBundleVersion = previousVersion; info.CFBundleShortVersionString = previousVersion;
  info.ElectronAsarIntegrity = { 'Resources/app.asar': { algorithm: 'SHA256', hash: sha(asar.getRawHeader(appAsar).headerString) } };
  await writeFile(infoPath, JSON.stringify(info));
  await execute('/usr/bin/plutil', ['-convert', 'xml1', infoPath]);
  await writeFile(path.join(current, 'Contents/Resources/runtime-bundle.json'), JSON.stringify({ ...expectedBundle, clientVersion: previousVersion, id: sha('previous-fixture:' + expectedBundle.id) }));
  const entitlement = path.join(root, 'entitlements.plist');
  await writeFile(entitlement, (await execute('/usr/bin/codesign', ['--display', '--entitlements', ':-', candidate])).stdout);
  await execute('/usr/bin/codesign', ['--force', '--sign', signing.identity, '--timestamp', '--options', 'runtime', '--entitlements', entitlement, current]);
  await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', current]);
  const configPath = path.join(root, 'custom portal.toml');
  const config = `# Existing user configuration must remain byte-for-byte intact.\nname = "upgrade-fixture"\nworkspace = ${JSON.stringify(workspace)}\nkits_dir = ${JSON.stringify(kits)}\nkits_enabled = true\nbind = "127.0.0.1:0"\n[tools]\nexec = true\nfile = true\nsearch = true\nweb_fetch = true\ncustom_tools_enabled = true\nscreenshot = false\n[security]\nexec_allowlist = []\nmax_file_size = 4321000\n`;
  await writeFile(configPath, config);
  await writeFile(path.join(kits, 'retained-note.txt'), 'Existing Kit files');
  await writeFile(path.join(workspace, 'retained.txt'), '原工作文件');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  app = await launchDesktop({ executablePath: executable, env: { ...process.env, PORTAL_DESKTOP_USER_DATA: profile } });
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.beings));
  assert.equal(await app.evaluate(({ app }) => app.getVersion()), previousVersion);
  assert.equal((await page.evaluate(() => window.beings.snapshot())).settings.hasToken, false);
  console.log('PASS: signed application copied from the DMG opens with an empty isolated profile.');
  const connectionLink = `http://127.0.0.1:${server.address().port}/upgrade-fixture/?token=${token}`;
  await page.evaluate(async input => {
    const { settings } = await window.beings.snapshot();
    await window.beings.save({ ...settings, ...input, backgroundEnabled: true, autoStart: false, allowExec: true, kitsEnabled: true });
    await window.beings.stopPortal();
    await window.beings.save({ ...(await window.beings.snapshot()).settings, backgroundEnabled: false });
  }, { connectionLink, portalName: 'upgrade-fixture', workspace, portalConfigPath: configPath, portalEnvironmentPath: `${path.join(root, 'custom bin')}:${process.env.PATH}` });
  await until('old Portal connects', async () => (await page.evaluate(() => window.beings.snapshot())).portal.phase === 'connected');
  const before = await page.evaluate(() => window.beings.snapshot()), oldPid = app.process().pid;
  ownedPortalPids.add(before.portal.pid);
  const oldTools = (await rpc('tools/list')).tools.map(tool => tool.name).sort();
  assert(oldTools.includes('portal_exec'));
  assert.equal(before.background.enabled, false);
  await writeFile(path.join(profile, 'user-file.txt'), 'Keep user data');
  await app.evaluate(({ session, dialog }, input) => {
    const fs = process.getBuiltinModule('fs');
    session.defaultSession.protocol.handle('https', request => {
      const base = `https://github.com/${input.repository}/releases/download/v${input.version}/`;
      fs.appendFileSync(input.requests, request.url + '\n');
      if (request.url === `https://api.github.com/repos/${input.repository}/releases/latest`) return Response.json({ tag_name: 'v' + input.version,
        assets: [{ name: input.asset }, { name: input.asset.replace(/\.zip$/, '.dmg') }, { name: 'SHA256SUMS.txt' }] });
      if (request.url === base + 'SHA256SUMS.txt') return new Response(input.sums);
      if (request.url === base + input.asset) return new Response(fs.readFileSync(input.archive));
      return new Response('Local fixture only', { status: 404 });
    });
    dialog.showMessageBox = async (_window, options) => {
      if (!['客户端更新', '安装包已就绪'].includes(options.title)) throw new Error('Unexpected installer dialog: ' + options.title + ': ' + options.message);
      return { response: 1, checkboxChecked: false };
    };
  }, { version: pkg.version, asset, sums, archive, requests: path.join(root, 'release-requests.log'), repository: process.env.PORTAL_DESKTOP_UPDATE_REPOSITORY || 'd5z/portal-desktop' });
  const exited = new Promise(resolve => app.process().once('exit', resolve));
  await page.evaluate(async () => {
    await window.beings.checkUpdates();
    await window.beings.downloadUpdate();
    await window.beings.installUpdate();
  });
  let exitTimeout;
  try { await Promise.race([exited, new Promise((_, reject) => { exitTimeout = setTimeout(() => reject(new Error('Installer did not quit the old client.')), 60_000); })]); }
  finally { clearTimeout(exitTimeout); }
  app = undefined;
  upgradedPid = await until('LaunchServices starts upgraded client', async () => (await clients()).find(p => p.executable === executable && p.pid !== oldPid)?.pid);
  await until('new Portal connects with retained credentials', async () => {
    const status = await readJSON(path.join(profile, '.portal-connection-status.json')).catch(() => null);
    if (status?.pid && status.pid !== before.portal.pid && status.state === 'connected') { ownedPortalPids.add(status.pid); return status; }
  });
  await until('installation commits', async () => !(await readdir(profile)).includes('client-install.json'));
  const after = await readJSON(path.join(profile, 'connection.json'));
  for (const key of ['endpoint', 'being', 'workspace', 'portalName', 'portalConfigPath', 'portalEnvironmentPath', 'backgroundEnabled', 'autoStart', 'allowExec', 'kitsEnabled']) assert.deepEqual(after.settings[key], before.settings[key], key);
  assert.equal(sha(await readFile(after.settings.portalBinary)), expectedBundle.sha256);
  assert.equal((await readJSON(path.join(profile, 'portal-service.json'))).bundleId, expectedBundle.id);
  assert.equal(await readFile(configPath, 'utf8'), config);
  assert.equal(await readFile(path.join(workspace, 'retained.txt'), 'utf8'), '原工作文件');
  assert.equal(await readFile(path.join(kits, 'retained-note.txt'), 'utf8'), 'Existing Kit files');
  assert.equal(await readFile(path.join(profile, 'user-file.txt'), 'utf8'), 'Keep user data');
  const status = await readJSON(path.join(profile, '.portal-connection-status.json'));
  assert.equal(Number((await execute('/bin/ps', ['-p', String(status.pid), '-o', 'ppid='])).stdout.trim()), upgradedPid);
  assert.throws(() => process.kill(before.portal.pid, 0));
  assert.deepEqual((await rpc('tools/list')).tools.map(tool => tool.name).sort(), oldTools);
  assert.notEqual((await rpc('tools/call', { name: 'portal_file_write', arguments: { path: 'after-upgrade.txt', content: '升级后调用成功' } })).isError, true);
  assert.equal(await readFile(path.join(workspace, 'after-upgrade.txt'), 'utf8'), '升级后调用成功');
  const execution = await rpc('tools/call', { name: 'portal_exec', arguments: { command: 'printf portal-upgrade-ok' } });
  assert.notEqual(execution.isError, true); assert(JSON.stringify(execution).includes('portal-upgrade-ok'));
  const service = await readJSON(path.join(profile, 'portal-service.json'));
  await assert.rejects(execute('/bin/launchctl', ['print', `gui/${process.getuid()}/${service.label}`]));
  const alive = await clients(); assert.deepEqual(alive.map(p => p.pid), [upgradedPid]);
  await pause(6000);
  assert.deepEqual((await clients()).map(p => p.pid), [upgradedPid]);
  assert.equal((await readJSON(path.join(profile, '.portal-connection-status.json'))).pid, status.pid);
  await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', current]);
  const requests = (await readFile(path.join(root, 'release-requests.log'), 'utf8')).trim().split('\n');
  assert.equal(requests.length, 3, 'One release check, one checksum download and one ZIP download; no retry loop.');
  assert(requests[2].endsWith('/' + asset));
  console.log(`PASS: DMG installation → ${previousVersion} → ${pkg.version}; GitHub Release check/ZIP download/check/replace/relaunch; original config and files retained; exact bundled Portal ${status.pid} belongs to new client ${upgradedPid}; old guardian disabled; file/exec/tool list verified; no duplicate or restart loop.`);
  passed = true;
} catch (error) {
  console.error('Native upgrade failed. Isolated artifacts:', root);
  throw error;
} finally {
  if (mounted) await execute('/usr/bin/hdiutil', ['detach', mount]);
  if (app) await app.close().catch(() => {});
  upgradedPid ??= (await clients()).find(p => p.executable === executable)?.pid;
  if (upgradedPid) { try { process.kill(upgradedPid, 'SIGTERM'); } catch { /* Already exited. */ } }
  // Only this test's engine PIDs and profile registration are eligible for cleanup.
  const service = await readJSON(path.join(profile, 'portal-service.json')).catch(() => null);
  const ready = await readJSON(path.join(profile, '.portal-ready.json')).catch(() => null);
  if (ready?.pid) ownedPortalPids.add(ready.pid);
  if (service?.label) {
    await execute('/bin/launchctl', ['bootout', `gui/${process.getuid()}/${service.label}`]).catch(() => {});
    if (service.file) await rm(service.file, { force: true });
  }
  for (const pid of ownedPortalPids) { try { process.kill(pid, 'SIGTERM'); } catch { /* Already exited. */ } }
  for (const waiter of pending.values()) clearTimeout(waiter.timer);
  for (const client of wss.clients) client.terminate();
  wss.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await pause(500);
  if (passed) await rm(root, { recursive: true, force: true });
}
