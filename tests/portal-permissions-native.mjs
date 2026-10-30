// Real Portal, real OS sandbox, disposable workspace and a local approval transport.
// No model, account, production service or user files are involved.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { mkdtemp, mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';

if (!['win32', 'darwin'].includes(process.platform)) {
  console.log('Portal native permissions: Windows/macOS required'); process.exit(0);
}
const temporary = await mkdtemp(path.join(os.tmpdir(), 'portal-permission-native-'));
const workspace = path.join(temporary, 'workspace'); await mkdir(workspace);
// Exercise the engine Desktop actually launches, unless a caller explicitly selects another build.
const binary = path.resolve(process.env.PORTAL_SANDBOX_BINARY || `resources/heart-portal${process.platform === 'win32' ? '.exe' : ''}`);
const registration = path.join(temporary, 'client.json');
const config = path.join(temporary, 'portal.toml');
const approvals = [], pending = new Map();
let allow = false, child, relay, sequence = 0, generation = 0, diagnostics = '';
const server = createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/command') {
    assert.equal(request.headers.authorization, 'Bearer isolated-permission-fixture');
    let text = ''; for await (const chunk of request) text += chunk;
    const value = JSON.parse(text);
    assert.equal(value.verb, 'security-approve');
    assert.equal(value.sceneId, 'native-scene');
    approvals.push(JSON.parse(value.args));
    response.end(JSON.stringify({text:allow ? 'allow-once' : 'deny'}));
  } else response.end('{}');
});
const sockets = new WebSocketServer({server, path:'/_relay'});
sockets.on('connection', socket => {
  let ready = false;
  socket.on('message', data => {
    const message = JSON.parse(data.toString());
    if (!ready) {
      assert.equal(message.loom_token, 'native-test');
      ready = true; relay = socket; generation++;
      socket.send(JSON.stringify({ok:true,relay_keepalive:'text-v1'})); return;
    }
    if (message.type === 'keepalive') { socket.send(JSON.stringify({type:'keepalive_ack'})); return; }
    const entry = pending.get(message.id);
    if (entry) { clearTimeout(entry.timer); pending.delete(message.id); entry.resolve(message); }
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await writeFile(registration, JSON.stringify({port,token:'isolated-permission-fixture'}));
const exists = file => access(file).then(()=>true,()=>false);
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, 'exit'); child.kill(); await exited; child = undefined;
}
async function start(mode) {
  await stop();
  const previous = generation;
  await writeFile(config, `name = "permissions-fixture"\nworkspace = ${JSON.stringify(workspace)}\nkits_enabled = false\n[subagent]\nenabled = false\n[tools]\ncustom_tools_enabled = ${mode !== 'full-access'}\n`);
  child = spawn(binary, ['--config', config, '--connect', `http://127.0.0.1:${port}/fixture/?token=native-test`, '--permission-mode', mode],
    {windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,USERPROFILE:temporary,HOME:temporary,HEART_PORTAL_CLIENT_MANAGED:'1',HEART_PORTAL_SUPERVISED:'1',HEART_PORTAL_CLIENT_FILE:registration}});
  child.stdout.on('data', bytes => {diagnostics=(diagnostics+bytes).slice(-12000);});
  child.stderr.on('data', bytes => {diagnostics=(diagnostics+bytes).slice(-12000);});
  const deadline = Date.now()+15000;
  while (generation === previous) {
    if (child.exitCode !== null || Date.now()>deadline) throw new Error('Portal did not connect: '+diagnostics);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}
function call(name, args) {
  return new Promise((resolve,reject) => {
    const id = ++sequence;
    const timer = setTimeout(()=>{pending.delete(id);reject(new Error('Portal call timed out: '+diagnostics));},20000);
    pending.set(id,{resolve,timer});
    relay.send(JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args,_meta:{scene_id:'native-scene'}}}));
  });
}
const ok = reply => assert(!reply.error && reply.result?.isError !== true, JSON.stringify(reply));
const failed = reply => assert(reply.error || reply.result?.isError === true, JSON.stringify(reply));
const shellArgs = source => ({command:source,shell:process.platform === 'win32' ? 'powershell' : 'default'});
const quote = value => "'"+value.replaceAll("'",process.platform === 'win32' ? "''" : "'\\''")+"'";
const writeCommand = (file, text) => process.platform === 'win32'
  ? `$ErrorActionPreference='Stop'; [IO.File]::WriteAllText(${quote(file)}, ${quote(text)})`
  : `printf %s ${quote(text)} > ${quote(file)}`;
try {
  const mcpMarker = path.join(temporary,'mcp-started.txt');
  await mkdir(path.join(workspace,'tools'));
  await writeFile(path.join(workspace,'tools','mcp.toml'), `[[servers]]\nname="fixture"\ncommand=${JSON.stringify([process.execPath,'fixture.cjs'])}\n`);
  await writeFile(path.join(workspace,'tools','fixture.cjs'), `require('node:fs').writeFileSync(${JSON.stringify(mcpMarker)},'started'); process.exit(0);`);
  await start('supervised');
  const status = await call('portal_status', {}); ok(status);
  assert.equal(await exists(mcpMarker), false, 'Restricted startup must not run workspace MCP');
  const outside = path.join(temporary,'outside.txt');
  await writeFile(outside,'ordinary external file');
  ok(await call('portal_file_read',{path:outside}));
  ok(await call('portal_file_write',{path:'inside.txt',content:'workspace write'}));
  const ordinary = process.platform === 'win32' ? "Set-Content shell.txt 'sandbox'; Get-Content shell.txt" : "printf sandbox > shell.txt; cat shell.txt";
  ok(await call('portal_exec',shellArgs(ordinary)));
  assert.equal(approvals.length,0,'Ordinary reads, workspace writes and sandbox commands must not ask');
  const secretPaths = ['.aws/credentials','.azure/accessTokens.json','.gnupg/private.key','auth.json'];
  for (const secret of secretPaths) {
    const target = path.join(workspace,secret);
    await mkdir(path.dirname(target),{recursive:true}); await writeFile(target,'DUMMY_CREDENTIAL');
    failed(await call('portal_file_read',{path:secret}));
    failed(await call('portal_file_edit',{path:secret,old_text:'DUMMY_',new_text:'DUMMY_'}));
    failed(await call('portal_file_write',{path:secret,content:'changed'}));
    assert.equal(await readFile(target,'utf8'),'DUMMY_CREDENTIAL');
  }
  const beforeSecretShell = approvals.length;
  const secretRead = process.platform === 'win32'
    ? "$ErrorActionPreference='Stop'; Get-Content .aws/credentials"
    : 'cat .aws/credentials';
  const blockedSecret = await call('portal_exec',shellArgs(secretRead)); failed(blockedSecret);
  assert(!JSON.stringify(blockedSecret).includes('DUMMY_CREDENTIAL'));
  failed(await call('portal_exec',shellArgs(process.platform === 'win32'
    ? "$ErrorActionPreference='Stop'; Set-Content .aws/credentials changed"
    : 'echo changed > .aws/credentials')));
  assert.equal(approvals.length,beforeSecretShell,'Default sandbox must enforce secrets without host execution');
  assert.equal(await readFile(path.join(workspace,'.aws/credentials'),'utf8'),'DUMMY_CREDENTIAL');
  const denied = await call('portal_file_write',{path:outside,content:'denied',approved:true}); failed(denied);
  assert.equal(await readFile(outside,'utf8'),'ordinary external file');
  allow = true;
  ok(await call('portal_file_edit',{path:outside,old_text:'ordinary external file',new_text:'approved edit'}));
  assert.equal(approvals.at(-1).isolation,'file-scope');
  assert.equal(await readFile(outside,'utf8'),'approved edit');
  const externalCommand = shellArgs(writeCommand(outside,'host write'));
  const beforeSandbox = approvals.length;
  failed(await call('portal_exec',externalCommand));
  assert.equal(approvals.length,beforeSandbox,'A sandbox failure must not silently retry on the host');
  assert.equal(await readFile(outside,'utf8'),'approved edit');
  allow = false;
  const escalated = {...externalCommand,sandbox_permissions:'require_escalated',justification:'Write the isolated external fixture'};
  failed(await call('portal_exec',escalated));
  assert.equal(await readFile(outside,'utf8'),'approved edit');
  allow = true; ok(await call('portal_exec',escalated));
  assert.equal(approvals.at(-1).isolation,'host-tool');
  assert.equal(await readFile(outside,'utf8'),'host write');
  allow = false; failed(await call('portal_exec',escalated));
  failed(await call('portal_tools_reload',{}));
  assert.equal(await exists(mcpMarker),false);
  allow = true; ok(await call('portal_tools_reload',{}));
  assert.equal(await readFile(mcpMarker,'utf8'),'started');
  // Auto-review still routes external grants to the desktop reviewer; no engine-side bypass.
  await start('auto-review'); allow = false;
  failed(await call('portal_file_write',{path:outside,content:'no automatic write'}));
  await start('full-access');
  const beforeFull = approvals.length;
  ok(await call('portal_file_write',{path:outside,content:'full file write'}));
  ok(await call('portal_exec',shellArgs(writeCommand(outside,'full shell write'))));
  assert.equal(await readFile(outside,'utf8'),'full shell write');
  assert.equal(approvals.length,beforeFull,'Full access must not ask through any file/shell path');
  assert.doesNotMatch(diagnostics,/Sandbox ACL cleanup failed/);
  console.log('Portal native permissions: sandbox autonomy, exact external file grants, explicit host execution, denial, no grant reuse, MCP startup gate and full access passed.');
} finally {
  await stop(); for (const entry of pending.values()) clearTimeout(entry.timer);
  for (const socket of sockets.clients) socket.terminate();
  await new Promise(resolve=>sockets.close(resolve)); await new Promise(resolve=>server.close(resolve));
  const resolved = path.resolve(temporary), prefix = path.resolve(os.tmpdir()) + path.sep;
  assert(resolved.startsWith(prefix) && path.basename(resolved).startsWith('portal-permission-native-'));
  await rm(resolved,{recursive:true,force:true});
}
