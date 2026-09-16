// Real NSIS Setup and client update handoff, with an isolated installation,
// profile and local Being. The older version is a fixture, not a past release.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import * as asar from '@electron/asar';
import { buildWindowsInstaller } from '../scripts/build-windows-installer.mjs';
import { WebSocketServer } from 'ws';
import { desktopExecutable } from './support/desktop.mjs';
import { launchDesktop } from './support/electron-lifecycle.mjs';
import { isolateWindowsInstallation, powershell, psQuote } from './support/windows-installation.mjs';

if (process.platform !== 'win32') throw new Error('Run this test on Windows.');
const execute = promisify(execFile), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function runProcess(file, args, env, timeout = 150_000) {
  await new Promise((resolve, reject) => {
    // Explorer/NSIS descendants may retain pipes after the installer exits.
    const child = spawn(file, args, { env, windowsHide: false, stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${path.basename(file)} ${args.join(' ')} timed out after ${timeout} ms.`)); }, timeout);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`${path.basename(file)} exited ${code}`)); });
  });
}
const json = async file => JSON.parse(await readFile(file, 'utf8'));
async function until(label, predicate, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await pause(250); }
  throw new Error(`Timed out: ${label}`);
}
const root = await mkdtemp(path.join(os.tmpdir(), 'portal-win-upgrade-'));
const profile = path.join(root, 'profile'), workspace = path.join(root, '工作目录'), kits = path.join(root, 'kits');
const pkg = await json(new URL('../package.json', import.meta.url));
const previous = pkg.version.replace(/\d+$/, value => String(Number(value) - 1));
assert.match(previous, /^\d+\.\d+\.\d+$/);
const packaged = path.dirname(await desktopExecutable());
const bundle = await json(path.join(packaged, 'resources/runtime-bundle.json'));
const make = path.resolve(process.env.PORTAL_DESKTOP_PACKAGE_OUT || 'out', 'make/nsis');
const setups = (await readdir(make)).filter(name => /setup\.exe$/i.test(name));
assert.equal(setups.length, 1, 'Build the current Setup with npm run make first.');
const setup = path.join(make, setups[0]), asset = `portal-desktop-${pkg.version}-windows-x64-Setup.exe`;
const sums = `${sha(await readFile(setup))}  ${asset}\n`;
const installation = await isolateWindowsInstallation(root);
const env = { ...installation.environment, PORTAL_DESKTOP_USER_DATA: profile };
const installed = () => path.join(installation.installedRoot, 'portal-desktop.exe');
const ownedPids = new Set(), pending = new Map();
let app, upgradedPid, relay, nextId = 0, passed = false;
const token = 'local-windows-upgrade-fixture';
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://fixture.invalid');
  const reply = data => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data)); };
  if (url.searchParams.get('token') !== token) { response.writeHead(401); response.end(); return; }
  if (url.pathname.endsWith('/api/status')) return reply({ being_name: 'upgrade-fixture' });
  if (url.pathname.endsWith('/api/history')) return reply({ messages: [] });
  if (url.pathname.endsWith('/api/stream/active')) { response.writeHead(204); response.end(); return; }
  if (url.pathname.endsWith('/api/llm/config')) return reply({ model: 'retained-model', provider: 'fixture' });
  reply({ status: 'ok' });
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
    const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC timed out: ${method}`)); }, 10_000);
    pending.set(id, { resolve, reject, timer }); relay.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  });
}
async function clients() {
  return JSON.parse(await powershell(`
    $root=${psQuote(installation.installedRoot + path.sep)};
    $items=@(Get-CimInstance Win32_Process -Filter "Name='portal-desktop.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root,[StringComparison]::OrdinalIgnoreCase) -and $_.CommandLine -notmatch '--type=' } | Select-Object ProcessId,ExecutablePath,@{Name='MainWindowHandle';Expression={$p=Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if ($p) { $p.MainWindowHandle.ToInt64() } else { 0 }}});
    ConvertTo-Json -InputObject $items -Compress
  `));
}
async function assertSingleClientWindow(pid) {
  // A single Electron main process can still own two visible BrowserWindows.
  // Count native windows as well as processes after each automatic launch.
  const count = await powershell(`
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class PortalTestWindows {
  delegate bool Visitor(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(Visitor visitor, IntPtr data);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder name, int length);
  public static int Count(uint process) {
    int count = 0;
    EnumWindows((window, data) => {
      uint owner; GetWindowThreadProcessId(window, out owner);
      var name = new StringBuilder(256); GetClassName(window, name, name.Capacity);
      if (owner == process && IsWindowVisible(window) && name.ToString() == "Chrome_WidgetWin_1") count++;
      return true;
    }, IntPtr.Zero);
    return count;
  }
}
'@
[PortalTestWindows]::Count(${pid})
  `);
  assert.equal(Number(count), 1, `Client ${pid} must own exactly one visible window.`);
}
try {
  await Promise.all([mkdir(workspace), mkdir(kits)]);
  const baseline = path.join(root, 'baseline'), unpacked = path.join(root, 'asar');
  await cp(packaged, baseline, { recursive: true });
  const appAsar = path.join(baseline, 'resources/app.asar');
  asar.extractAll(appAsar, unpacked);
  const oldPackage = await json(path.join(unpacked, 'package.json'));
  await writeFile(path.join(unpacked, 'package.json'), JSON.stringify({ ...oldPackage, version: previous }));
  await asar.createPackage(unpacked, appAsar);
  asar.uncache(appAsar);
  await writeFile(path.join(baseline, 'resources/runtime-bundle.json'), JSON.stringify({ ...bundle, clientVersion: previous, id: sha('baseline:' + bundle.id) }));
  const baselineOutput = path.join(root, 'baseline-setup');
  await buildWindowsInstaller(baseline, baselineOutput, previous, false);
  await runProcess(path.join(baselineOutput, `portal-desktop-${previous}-windows-x64-Setup.exe`), [`/D=${installation.installedRoot}`], env);
  console.log('NSIS installation completed; checking automatic startup.');
  const firstClient = await until('NSIS automatically opens the installed client window', async () => {
    const opened = await clients();
    return opened.length === 1 && opened[0].MainWindowHandle !== 0 ? opened[0] : false;
  });
  await until('automatic startup retains the isolated profile', () => access(profile).then(() => true, () => false));
  await assertSingleClientWindow(firstClient.ProcessId);
  await runProcess(installed(), ['--quit-for-update'], env, 30_000);
  await until('baseline client closes before controlled test launch', async () => (await clients()).length === 0);
  assert.equal(JSON.parse(asar.extractFile(path.join(path.dirname(installed(previous)), 'resources/app.asar'), 'package.json').toString()).version, previous);
  assert.equal(sha(await readFile(path.join(path.dirname(installed(previous)), 'resources/heart-portal.exe'))), bundle.sha256);
  console.log(`PASS: real Setup installs ${previous} under the isolated installation root with its bundled Portal.`);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const configPath = path.join(root, 'custom portal.toml');
  const config = `# Preserve exact user configuration.\nworkspace = ${JSON.stringify(workspace)}\nkits_dir = ${JSON.stringify(kits)}\nkits_enabled = true\n[tools]\nexec = true\nscreenshot = false\n`;
  await writeFile(configPath, config);
  await writeFile(path.join(workspace, 'retained.txt'), '原工作文件');
  await writeFile(path.join(kits, 'retained.txt'), 'Existing Kit files');
  app = await launchDesktop({ executablePath: installed(previous), env });
  app.process().stderr.on('data', bytes => { void writeFile(path.join(root, 'client-stderr.log'), bytes, { flag: 'a' }); });
  const page = await app.firstWindow();
  await page.getByRole('button', { name: '连接我的 Being' }).waitFor();
  assert.equal(await app.evaluate(({ app }) => app.getVersion()), previous);
  await page.evaluate(async input => {
    const { settings } = await window.beings.snapshot();
    await window.beings.save({ ...settings, ...input, backgroundEnabled: true, autoStart: false, allowExec: true, kitsEnabled: true });
  }, { connectionLink: `http://127.0.0.1:${server.address().port}/upgrade-fixture/?token=${token}`, portalName: 'upgrade-fixture', workspace, portalConfigPath: configPath });
  await until('old client Portal connects', async () => (await page.evaluate(() => window.beings.snapshot())).portal.phase === 'connected');
  const before = await page.evaluate(() => window.beings.snapshot());
  const oldClientPid = await app.evaluate(() => process.pid);
  ownedPids.add(before.portal.pid);
  const oldTools = (await rpc('tools/list')).tools.map(tool => tool.name).sort();
  assert(oldTools.includes('portal_exec'));
  await writeFile(path.join(profile, 'retained.txt'), 'Keep user profile');
  await app.evaluate(({ session, dialog }, input) => {
    const fs = process.getBuiltinModule('fs');
    session.defaultSession.protocol.handle('https', request => {
      fs.appendFileSync(input.requests, request.url + '\n');
      const base = `https://github.com/${input.repository}/releases/download/v${input.version}/`;
      if (request.url === `https://api.github.com/repos/${input.repository}/releases/latest`) return Response.json({ tag_name: 'v' + input.version, assets: [{ name: input.asset }, { name: 'SHA256SUMS.txt' }] });
      if (request.url === base + 'SHA256SUMS.txt') return new Response(input.sums);
      if (request.url === base + input.asset) return new Response(fs.readFileSync(input.setup));
      return new Response('Fixture only', { status: 404 });
    });
    dialog.showMessageBox = async (_window, options) => {
      if (!['客户端更新', '安装包已就绪'].includes(options.title)) throw new Error('Unexpected dialog: ' + options.title);
      return { response: 1, checkboxChecked: false };
    };
  }, { version: pkg.version, asset, sums, setup, requests: path.join(root, 'requests.log'), repository: process.env.PORTAL_DESKTOP_UPDATE_REPOSITORY || 'd5z/portal-desktop' });
  const exited = new Promise(resolve => app.process().once('exit', resolve));
  await page.evaluate(async () => {
    await window.beings.checkUpdates();
    await window.beings.downloadUpdate();
    await window.beings.installUpdate();
  });
  let timer;
  try { await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Old client did not exit for installation.')), 90_000); })]); }
  finally { clearTimeout(timer); }
  app = undefined;
  console.log('Old client exited; waiting for the independent installer and new client.');
  upgradedPid = await until('NSIS launches new client', async () => (await clients()).find(p => p.ExecutablePath === installed(pkg.version) && p.ProcessId !== oldClientPid)?.ProcessId);
  const state = await until('new bundled Portal connects', async () => {
    const service = await json(path.join(profile, 'portal-service.json')).catch(() => null);
    if (service?.bundleId !== bundle.id) return false;
    const sample = await json(path.join(service.root, '.portal-connection-status.json')).catch(() => null);
    if (sample?.state === 'connected' && sample.pid !== before.portal.pid) { ownedPids.add(sample.pid); return sample; }
  });
  await until('installation transaction commits', async () => !(await readdir(profile)).includes('client-install.json'));
  const after = await json(path.join(profile, 'connection.json')), service = await json(path.join(profile, 'portal-service.json'));
  for (const key of ['endpoint', 'being', 'workspace', 'portalName', 'portalConfigPath', 'backgroundEnabled', 'autoStart', 'allowExec', 'kitsEnabled']) assert.deepEqual(after.settings[key], before.settings[key], key);
  assert.equal(sha(await readFile(path.join(service.root, 'heart-portal.exe'))), bundle.sha256);
  const actualBinary = await powershell(`(Get-CimInstance Win32_Process -Filter 'ProcessId=${state.pid}').ExecutablePath`);
  assert.equal(actualBinary.toLowerCase(), path.join(service.root, 'heart-portal.exe').toLowerCase());
  assert.throws(() => process.kill(before.portal.pid, 0));
  assert.equal(await readFile(configPath, 'utf8'), config);
  assert.equal(await readFile(path.join(workspace, 'retained.txt'), 'utf8'), '原工作文件');
  assert.equal(await readFile(path.join(kits, 'retained.txt'), 'utf8'), 'Existing Kit files');
  assert.equal(await readFile(path.join(profile, 'retained.txt'), 'utf8'), 'Keep user profile');
  assert.deepEqual((await rpc('tools/list')).tools.map(tool => tool.name).sort(), oldTools);
  assert.notEqual((await rpc('tools/call', { name: 'portal_file_write', arguments: { path: 'after-upgrade.txt', content: '升级后调用成功' } })).isError, true);
  assert.equal(await readFile(path.join(workspace, 'after-upgrade.txt'), 'utf8'), '升级后调用成功');
  const execution = await rpc('tools/call', { name: 'portal_exec', arguments: { command: 'echo portal-upgrade-ok' } });
  assert.notEqual(execution.isError, true); assert(JSON.stringify(execution).includes('portal-upgrade-ok'));
  await pause(6000);
  assert.deepEqual((await clients()).map(p => p.ProcessId), [upgradedPid]);
  await assertSingleClientWindow(upgradedPid);
  assert.equal((await json(path.join(service.root, '.portal-connection-status.json'))).pid, state.pid);
  const requests = (await readFile(path.join(root, 'requests.log'), 'utf8')).trim().split('\n');
  assert.equal(requests.length, 3);
  assert(requests[2].endsWith('/' + asset));
  console.log(`PASS: ${previous} → ${pkg.version}, Release/checksum/Setup download, old Portal stop, actual installer handoff and automatic relaunch; config/credentials/files/tools preserved, running Portal hash matches client bundle, one stable client and engine.`);
  // A user can also open Setup while the client is still running. Exercise
  // NSIS's graceful prepare hook, not just the already-stopped update path.
  const priorClient = upgradedPid, priorPortal = state.pid;
  await runProcess(setup, [], env);
  upgradedPid = await until('manual reinstall starts a new client', async () => (await clients()).find(p => p.ProcessId !== priorClient)?.ProcessId);
  await until('manual reinstall resumes Portal', async () => {
    const current = await json(path.join(service.root, '.portal-connection-status.json')).catch(() => null);
    if (current?.state === 'connected' && current.pid !== priorPortal) { ownedPids.add(current.pid); return current; }
  });
  await until('manual reinstall commits recovery', async () => !(await readdir(profile)).includes('client-install.json'));
  assert.throws(() => process.kill(priorClient, 0));
  assert.throws(() => process.kill(priorPortal, 0));
  assert.equal(await readFile(configPath, 'utf8'), config);
  assert.equal(await readFile(path.join(profile, 'retained.txt'), 'utf8'), 'Keep user profile');
  await assertSingleClientWindow(upgradedPid);
  console.log('PASS: manually opening NSIS while the client and Portal run gracefully stops both, reinstalls, and automatically restores the same profile and Portal.');
  passed = true;
} catch (error) {
  console.error('Windows upgrade failed. Isolated artifacts:', root);
  const diagnostics = path.resolve('test-results/windows-installer');
  await mkdir(diagnostics, { recursive: true });
  await writeFile(path.join(diagnostics, 'failure.json'), JSON.stringify({
    root, profile, error: { message: error.message, stack: error.stack, code: error.code, signal: error.signal, killed: error.killed },
    clients: await clients().catch(failure => ({ error: String(failure) })),
    profileCreated: await access(profile).then(() => true, () => false),
  }, null, 2));
  throw error;
} finally {
  if (app) await app.close().catch(() => {});
  const service = await json(path.join(profile, 'portal-service.json')).catch(() => null);
  if (service?.label) await powershell(`$t=Get-ScheduledTask -TaskName ${psQuote(service.label)} -ErrorAction SilentlyContinue; if ($t) { $t | Disable-ScheduledTask | Out-Null; $t | Stop-ScheduledTask; $t | Unregister-ScheduledTask -Confirm:$false }`);
  for (const client of await clients()) await execute('taskkill', ['/PID', String(client.ProcessId), '/T', '/F'], { windowsHide: true }).catch(() => {});
  if (service?.root && service.root.startsWith(profile + path.sep)) {
    const status = await json(path.join(service.root, '.portal-connection-status.json')).catch(() => null);
    if (status?.pid) ownedPids.add(status.pid);
  }
  for (const pid of ownedPids) await execute('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
  for (const waiter of pending.values()) clearTimeout(waiter.timer);
  for (const socket of wss.clients) socket.terminate();
  wss.close(); server.closeAllConnections(); if (server.listening) await new Promise(resolve => server.close(resolve));
  await installation.restore();
  if (passed) {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
}
