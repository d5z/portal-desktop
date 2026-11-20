// Real Portal cancellation, disposable ACLs, no production service or runtime copy.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { mkdtemp, mkdir, writeFile, copyFile, access, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';

if (process.platform !== 'win32') { console.log('Sandbox cancellation: Windows required'); process.exit(0); }
const temporary = await mkdtemp(path.join(os.tmpdir(), 'portal-sandbox-cancel-'));
const workspace = path.join(temporary, 'workspace');
await mkdir(path.join(workspace, '.git'), { recursive: true });
await writeFile(path.join(workspace, '.git', 'config'), 'protected');
const binary = path.resolve(process.env.PORTAL_SANDBOX_BINARY || 'resources/heart-portal.exe');
const config = path.join(temporary, 'portal.toml'), registration = path.join(temporary, 'client.json');
const runtime = path.join(temporary, 'runtime');
const pending = new Map(); let relay, child, sequence = 0, diagnostics = '';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const exists = file => access(file).then(() => true, () => false);
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const server = createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/command') {
    assert.equal(request.headers.authorization, 'Bearer sandbox-cancel-fixture');
    let body = ''; for await (const data of request) body += data;
    assert.equal(JSON.parse(body).verb, 'security-approve');
    response.end(JSON.stringify({ text: 'allow-once' }));
  } else response.end('{}');
});
const sockets = new WebSocketServer({ server, path: '/_relay' });
sockets.on('connection', socket => {
  let authenticated = false;
  socket.on('message', data => {
    const value = JSON.parse(data);
    if (!authenticated) {
      assert.equal(value.loom_token, 'cancel-test'); authenticated = true; relay = socket;
      socket.send(JSON.stringify({ ok: true, relay_keepalive: 'text-v1' })); return;
    }
    if (value.type === 'keepalive') { socket.send(JSON.stringify({ type: 'keepalive_ack' })); return; }
    const entry = pending.get(value.id);
    if (entry) { clearTimeout(entry.timer); pending.delete(value.id); entry.resolve(value); }
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
function call(name, args, started) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${name} timed out\n${diagnostics}`)); }, 30000);
    pending.set(id, { resolve, timer });
    relay.send(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args, _meta: { scene_id: 'cancel-scene' } } }));
    started?.(id);
  });
}
function ok(reply) { assert(!reply.error && !reply.result?.isError, JSON.stringify(reply)); }
const aclPaths = [workspace, path.join(workspace, '.git'), path.join(workspace, '.git', 'config')];
function acls() {
  const script = `$env:PSModulePath="$PSHOME\\Modules"; $ErrorActionPreference='Stop'; @(${aclPaths.map(quote).join(',')}) | ForEach-Object { (Get-Acl -LiteralPath $_).Sddl }`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); return result.stdout;
}
async function marker(name) {
  const until = Date.now() + 10000;
  while (!await exists(path.join(workspace, name))) {
    assert(Date.now() < until, `Missing ${name}\n${diagnostics}`); await delay(25);
  }
}
function longCommand(label) {
  const late = `[Threading.Thread]::Sleep(7000); [IO.File]::WriteAllText(${quote(path.join(workspace, `${label}-leaked.txt`))}, 'leaked')`;
  const encoded = Buffer.from(late, 'utf16le').toString('base64');
  return `$ErrorActionPreference='Stop'; $info=New-Object Diagnostics.ProcessStartInfo; $info.FileName=$PSHOME+'\\powershell.exe'; $info.Arguments='-NoProfile -NonInteractive -EncodedCommand ${encoded}'; $info.UseShellExecute=$false; $descendant=[Diagnostics.Process]::Start($info); [IO.File]::WriteAllText(${quote(path.join(workspace, `${label}-started.txt`))}, 'started'); [Threading.Thread]::Sleep(20000)`;
}
try {
  // Only PowerShell runs here. A small disposable sidecar exercises runtime ACL
  // cleanup too, without touching an installed/shared Python or Node tree.
  await mkdir(runtime);
  await copyFile(path.join(process.env.SystemRoot, 'System32', 'cmd.exe'), path.join(runtime, 'interpreter.exe'));
  await writeFile(path.join(runtime, 'runtime.json'), JSON.stringify({ schema: 1, platform: 'win32', arch: process.arch,
    python: { version: 'fixture', path: 'interpreter.exe' }, node: { version: 'fixture', path: 'interpreter.exe' } }));
  aclPaths.push(runtime, path.join(runtime, 'interpreter.exe'));
  await writeFile(registration, JSON.stringify({ port, token: 'sandbox-cancel-fixture' }));
  await writeFile(config, `name="sandbox-cancel-fixture"\nworkspace=${JSON.stringify(workspace)}\nkits_enabled=false\n[subagent]\nenabled=false\n[security]\npermission_mode="supervised"\n`);
  child = spawn(binary, ['--config', config, '--connect', `http://127.0.0.1:${port}/fixture/?token=cancel-test`, '--permission-mode', 'supervised'], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, USERPROFILE: temporary, HOME: temporary,
      HEART_PORTAL_CLIENT_FILE: registration, HEART_PORTAL_SUPERVISED: '1', HEART_PORTAL_CLIENT_MANAGED: '1', HEART_PORTAL_RUNTIME_DIR: runtime },
  });
  for (const pipe of [child.stdout, child.stderr]) pipe.on('data', data => { diagnostics = (diagnostics + data).slice(-12000); });
  const until = Date.now() + 15000;
  while (!relay) { assert(child.exitCode === null && Date.now() < until, diagnostics); await delay(25); }
  const original = acls();
  const timed = await call('portal_exec', { command: longCommand('timeout'), shell: 'powershell', timeout_secs: 3 });
  assert.equal(timed.result?.failure_code, 'command_timeout', JSON.stringify(timed));
  await marker('timeout-started.txt');
  // A timeout during the first preparation must restore the captured ACLs;
  // only a successfully materialized standing grant is retained.
  assert.equal(acls(), original, 'portal_exec timeout must restore exact ACLs');
  const background = await call('portal_exec', { command: longCommand('kill'), shell: 'powershell', background: true }); ok(background);
  const session = JSON.parse(background.result.content[0].text).session_id;
  await marker('kill-started.txt');
  // A standing grant no longer holds a mutex for the command lifetime, so a
  // short command can run while the long background task is still active.
  const queued = await call('portal_exec', { command: "'must not run' | Set-Content queued-ran.txt", shell: 'powershell', timeout_secs: 1 });
  ok(queued);
  assert.equal(await exists(path.join(workspace, 'queued-ran.txt')), true);
  ok(await call('portal_process', { action: 'kill', session_id: session }));
  assert.equal(acls(), original, 'portal_process kill must restore exact ACLs');
  let cancelId;
  const cancelled = call('portal_exec', { command: longCommand('notification'), shell: 'powershell', timeout_secs: 25 }, id => { cancelId = id; });
  await marker('notification-started.txt');
  relay.send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: cancelId } }));
  // Cancellation has no JSON-RPC response. Release only this harness waiter.
  const entry = pending.get(cancelId); clearTimeout(entry.timer); pending.delete(cancelId); entry.resolve(); await cancelled;
  const restoredBy = Date.now() + 12000;
  while (acls() !== original) { assert(Date.now() < restoredBy, 'MCP cancellation must restore exact ACLs'); await delay(50); }
  await delay(7500);
  assert.equal(await exists(path.join(workspace, 'timeout-leaked.txt')), false, 'Timed-out descendants must not survive');
  assert.equal(await exists(path.join(workspace, 'kill-leaked.txt')), false, 'Cancelled descendants must not survive');
  assert.equal(await exists(path.join(workspace, 'notification-leaked.txt')), false, 'MCP-cancelled descendants must not survive');
  assert.doesNotMatch(diagnostics, /Sandbox ACL cleanup failed/);
  console.log('Windows sandbox cancellation: exec timeout, process kill, MCP cancellation and mutex-wait cancellation restore exact ACLs; descendants do not survive.');
} finally {
  for (const entry of pending.values()) clearTimeout(entry.timer);
  if (child && child.exitCode === null) { const ended = once(child, 'exit'); child.kill(); await ended; }
  for (const socket of sockets.clients) socket.terminate();
  sockets.close(); await new Promise(resolve => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
