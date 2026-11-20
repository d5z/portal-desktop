// Real Portal, real OS sandbox, disposable workspace and a local approval transport.
// No model, account, production service or user files are involved.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, access, rm } from 'node:fs/promises';
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
async function start(mode, executable = binary, runtimeDirectory) {
  await stop();
  const previous = generation;
  // The standalone config defaults to full access; Desktop's CLI mode must override it.
  await writeFile(config, `name = "permissions-fixture"\nworkspace = ${JSON.stringify(workspace)}\nkits_enabled = false\n[subagent]\nenabled = false\n[tools]\ncustom_tools_enabled = ${mode !== 'full-access'}\n[security]\npermission_mode = "full-access"\n`);
  child = spawn(executable, ['--config', config, '--connect', `http://127.0.0.1:${port}/fixture/?token=native-test`, '--permission-mode', mode],
    {windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PATH:process.platform === 'win32' ? path.join(process.env.SystemRoot,'System32') : '/usr/bin:/bin',USERPROFILE:temporary,HOME:temporary,HEART_PORTAL_CLIENT_MANAGED:'1',HEART_PORTAL_SUPERVISED:'1',HEART_PORTAL_CLIENT_FILE:registration,
      HEART_PORTAL_RUNTIME_DIR:runtimeDirectory}});
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
    if (process.env.PORTAL_NATIVE_TRACE) console.log(`Call ${id}: ${name} ${JSON.stringify(args)}`);
    // Allow the engine's default 30-second command timeout to return diagnostics.
    const timer = setTimeout(()=>{pending.delete(id);reject(new Error(`Portal call timed out: ${name} ${JSON.stringify(args)}\n${diagnostics}`));},45000);
    pending.set(id,{resolve,timer});
    relay.send(JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args,_meta:{scene_id:'native-scene'}}}));
  });
}
const ok = reply => assert(!reply.error && reply.result?.isError !== true, JSON.stringify(reply));
const failed = reply => assert(reply.error || reply.result?.isError === true, JSON.stringify(reply));
const shellArgs = source => ({command:source,shell:process.platform === 'win32' ? 'powershell' : 'default'});
const chain = (...commands) => commands.join(process.platform === 'win32' ? '; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; ' : ' && ');
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
  assert.equal(approvals.length,0,'Ordinary reads do not ask');
  failed(await call('portal_file_write',{path:'inside.txt',content:'workspace write'}));
  assert.equal(await exists(path.join(workspace,'inside.txt')),false);
  allow = true;
  ok(await call('portal_file_write',{path:'inside.txt',content:'workspace write'}));
  const ordinary = process.platform === 'win32' ? "Set-Content shell.txt 'sandbox'; Get-Content shell.txt" : "printf sandbox > shell.txt; cat shell.txt";
  ok(await call('portal_exec',shellArgs(ordinary)));
  assert.equal(approvals.length,3,'Each write and command needs its own consent');
  const environment = JSON.parse(status.result.content[0].text).authorization.task_environment;
  // The same commands work without a host Python/Node installation or model-written launcher.
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const pythonCheck = `${python} -c "import sys, os, tempfile, pathlib; assert 'portal-runtime' in sys.executable; assert pathlib.Path(tempfile.gettempdir()).is_relative_to(pathlib.Path.cwd()); print('BUNDLED_PYTHON_OK'); print(sys.version.split()[0])"`;
  const pythonResult = await call('portal_exec',shellArgs(pythonCheck));ok(pythonResult);
  assert.match(JSON.stringify(pythonResult),/BUNDLED_PYTHON_OK/);
  const nodeResult = await call('portal_exec',shellArgs(`node -e "if(!process.execPath.includes('portal-runtime'))process.exit(1);console.log('BUNDLED_NODE_OK',process.versions.node)"`));ok(nodeResult);
  assert.match(JSON.stringify(nodeResult),/BUNDLED_NODE_OK/);
  const npmResult = await call('portal_exec',shellArgs(chain('npm --version','npx --version')));ok(npmResult);
  assert.match(npmResult.result.content[0].text,/\d+\.\d+\.\d+/);
  await mkdir(path.join(workspace,'project'));
  await writeFile(path.join(workspace,'project/package.json'),JSON.stringify({scripts:{check:'node -e "console.log(1234567)"'}}));
  const projectResult = await call('portal_exec',{...shellArgs('npm run check'),workdir:'project'});ok(projectResult);
  assert.match(JSON.stringify(projectResult),/1234567/);
  // Real task fixtures: standard-library data processing, local dependencies and project tooling.
  const taskDirectory = path.join(workspace, '任务 with spaces');
  await mkdir(taskDirectory);
  await writeFile(path.join(taskDirectory, 'data.py'), `import csv, hashlib, io, json, pathlib, sqlite3, zipfile\nrows=list(csv.DictReader(io.StringIO('name,value\\n你好,7\\nPortal,5\\n')))\ndb=sqlite3.connect('task.sqlite'); db.execute('create table records (name text, value integer)'); db.executemany('insert into records values (?,?)', [(r['name'],int(r['value'])) for r in rows]); db.commit()\nassert db.execute('select sum(value) from records').fetchone()[0] == 12\np=pathlib.Path('结果.json'); p.write_text(json.dumps(rows,ensure_ascii=False),encoding='utf-8')\nwith zipfile.ZipFile('result.zip','w') as z: z.write(p)\nwith zipfile.ZipFile('result.zip') as z: assert z.read(str(p)).decode('utf-8') == p.read_text(encoding='utf-8')\nprint('DATA_TASK_OK',hashlib.sha256(p.read_bytes()).hexdigest())\n`);
  const dataResult = await call('portal_exec', {...shellArgs(`${python} data.py`),workdir:'任务 with spaces'});ok(dataResult);
  assert.match(JSON.stringify(dataResult),/DATA_TASK_OK/);
  ok(await call('portal_exec',shellArgs(`${python} -m pip --version`)));
  const venvResult = await call('portal_exec', {...shellArgs(`${python} -m venv .venv`),workdir:'project'});ok(venvResult);
  const venvPython = process.platform === 'win32' ? '.venv\\Scripts\\python.exe' : '.venv/bin/python';
  const venvCheck = await call('portal_exec',{...shellArgs(`${venvPython} -c "import sys; assert sys.prefix != sys.base_prefix; print('VENV_OK')"`),workdir:'project'});ok(venvCheck);
  assert.match(JSON.stringify(venvCheck),/VENV_OK/);
  const defaultVenv = await call('portal_exec',{...shellArgs(`python -c "import sys; assert sys.prefix != sys.base_prefix; print('DEFAULT_VENV_OK')"`),workdir:'project'});ok(defaultVenv);
  assert.match(JSON.stringify(defaultVenv),/DEFAULT_VENV_OK/);
  await writeFile(path.join(workspace,'project/wheel.py'), `import pathlib,zipfile\np=pathlib.Path('fixture_pkg-1.0-py3-none-any.whl')\nfiles={'fixture_pkg.py': 'VALUE = "LOCAL_WHEEL_OK"\\n', 'fixture_pkg-1.0.dist-info/METADATA': 'Metadata-Version: 2.1\\nName: fixture-pkg\\nVersion: 1.0\\n', 'fixture_pkg-1.0.dist-info/WHEEL': 'Wheel-Version: 1.0\\nGenerator: portal-test\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n'}\nfiles['fixture_pkg-1.0.dist-info/RECORD']=''.join(k+',,\\n' for k in [*files,'fixture_pkg-1.0.dist-info/RECORD'])\nwith zipfile.ZipFile(p,'w') as z:\n for name,value in files.items(): z.writestr(name,value)\n`);
  const pipResult = await call('portal_exec',{...shellArgs(chain(`${python} wheel.py`,`${venvPython} -m pip install --no-index fixture_pkg-1.0-py3-none-any.whl`,`${venvPython} -c "import fixture_pkg; print(fixture_pkg.VALUE)"`)),workdir:'project'});ok(pipResult);
  assert.match(JSON.stringify(pipResult),/LOCAL_WHEEL_OK/);
  await mkdir(path.join(workspace,'local-package'));
  await writeFile(path.join(workspace,'local-package/package.json'),JSON.stringify({name:'portal-local-fixture',version:'1.0.0',main:'index.js',bin:{'portal-fixture':'cli.js'}}));
  await writeFile(path.join(workspace,'local-package/index.js'),'module.exports = "LOCAL_NPM_OK";');
  await writeFile(path.join(workspace,'local-package/cli.js'),'#!/usr/bin/env node\nconsole.log("LOCAL_NPX_OK");');
  const npmLocal = await call('portal_exec',{...shellArgs(chain('npm install --offline --no-audit --no-fund ../local-package','node -e "console.log(require(\'portal-local-fixture\'))"','npx --offline portal-fixture')),workdir:'project'});ok(npmLocal);
  assert.match(JSON.stringify(npmLocal),/LOCAL_NPM_OK/);
  assert.match(JSON.stringify(npmLocal),/LOCAL_NPX_OK/);
  ok(await call('portal_exec',{...shellArgs('portal-fixture'),workdir:'project'}));
  await writeFile(path.join(workspace,'project/test_fixture.py'), `import concurrent.futures,ssl,unittest,fixture_pkg,tempfile,pathlib,socket\nclass Fixture(unittest.TestCase):\n def test_runtime(self):\n  self.assertEqual(fixture_pkg.VALUE,'LOCAL_WHEEL_OK')\n  self.assertTrue(ssl.create_default_context())\n  with concurrent.futures.ThreadPoolExecutor(2) as pool: self.assertEqual(list(pool.map(abs,[-1,-2])),[1,2])\n  with tempfile.TemporaryDirectory() as directory:\n   target=pathlib.Path(directory)/'private.txt'; target.write_text('private'); self.assertEqual(target.read_text(),'private')\n  with self.assertRaises(PermissionError): pathlib.Path(${JSON.stringify(outside)}).read_text()\n  with self.assertRaises(OSError): socket.create_connection(('127.0.0.1',${port}),timeout=2)\n`);
  const pythonTests=await call('portal_exec',{...shellArgs(process.platform === 'win32' ? `${venvPython} -I -m unittest discover -v` : '. .venv/bin/activate && python -I -m unittest discover -v'),workdir:'project'});ok(pythonTests);
  assert.match(JSON.stringify(pythonTests),/test_runtime/);
  await writeFile(path.join(workspace,'project/runtime.test.cjs'), `const {test}=require('node:test');const assert=require('node:assert/strict');const {Worker}=require('node:worker_threads');\ntest('bundled Node worker and dependency',async()=>{assert.equal(require('portal-local-fixture'),'LOCAL_NPM_OK');const worker=new Worker('require("node:worker_threads").parentPort.postMessage(42)',{eval:true});const [value]=await require('node:events').once(worker,'message');assert.equal(value,42);assert.throws(()=>require('node:fs').readFileSync(${JSON.stringify(outside)}),e=>['EPERM','EACCES'].includes(e.code));await assert.rejects(new Promise((resolve,reject)=>{const socket=require('node:net').connect(${port},'127.0.0.1');socket.on('connect',()=>{socket.destroy();resolve()});socket.on('error',reject);socket.setTimeout(2000,()=>{socket.destroy();reject(new Error('blocked timeout'))})}));});`);
  await writeFile(path.join(workspace,'project/ipc-child.cjs'), `process.on('message',value=>{process.send(value+1);process.disconnect()});`);
  await writeFile(path.join(workspace,'project/process.test.cjs'), `const {test}=require('node:test');const assert=require('node:assert/strict');const {once}=require('node:events');test('fork IPC and piped child output',async()=>{const child=require('node:child_process').fork('ipc-child.cjs',[],{silent:true});const message=once(child,'message');const closed=once(child,'close');child.send(41);assert.equal((await message)[0],42);assert.equal((await closed)[0],0)});`);
  const nodeTests=await call('portal_exec',{...shellArgs('node --test runtime.test.cjs process.test.cjs'),workdir:'project'});ok(nodeTests);
  assert.match(JSON.stringify(nodeTests),/bundled Node worker and dependency/);
  assert.match(JSON.stringify(nodeTests),/fork IPC and piped child output/);
  console.log('Task fixtures: CSV/SQLite/ZIP/UTF-8, venv, offline pip wheel and npm/npx local dependency passed.');
  const started = await call('portal_exec',{...shellArgs(`node -e "console.log('BUNDLED_BACKGROUND_OK')"`),background:true});ok(started);
  const session = JSON.parse(started.result.content[0].text).session_id;
  let log;
  for(let i=0;i<10;i++){
    log=await call('portal_process',{action:'poll',session_id:session,timeout_ms:3000});ok(log);
    if(JSON.stringify(log).includes('BUNDLED_BACKGROUND_OK'))break;
  }
  assert.match(JSON.stringify(log),/BUNDLED_BACKGROUND_OK/);
  // Output/error states, interactive input, process-tree cleanup and repeated execution.
  const nonzero = await call('portal_exec',shellArgs('node -e "console.log(\'BEFORE_ERROR\');console.error(\'EXPECTED_STDERR\');process.exit(7)"'+(process.platform === 'win32' ? '; exit $LASTEXITCODE' : '')));failed(nonzero);
  assert.equal(nonzero.result.exit_code,7);
  assert.match(JSON.stringify(nonzero),/BEFORE_ERROR/);assert.match(JSON.stringify(nonzero),/EXPECTED_STDERR/);
  const bounded = await call('portal_exec',{...shellArgs('node -e "process.stdout.write(\'界\'.repeat(10000))"'),max_output_bytes:257});ok(bounded);
  assert.equal(bounded.result.truncated,true);assert.equal(bounded.result.total_output_bytes,30000);
  assert(!bounded.result.content[0].text.includes('\ufffd'),'Truncation must retain complete UTF-8 characters');
  // Include native ACL setup in the deadline and leave the write beyond it.
  const timed = await call('portal_exec',{...shellArgs('node -e "console.log(\'TIMEOUT_STDOUT\');console.error(\'TIMEOUT_STDERR\');setTimeout(()=>require(\'fs\').writeFileSync(\'outputs/timeout-leak.txt\',\'leaked\'),15000)"'),timeout_secs:10});failed(timed);
  assert.equal(timed.result.failure_code,'command_timeout');assert.match(JSON.stringify(timed),/TIMEOUT_STDOUT/);assert.match(JSON.stringify(timed),/TIMEOUT_STDERR/);
  const interactive = await call('portal_exec',{...shellArgs('node -e "process.stdin.once(\'data\',d=>{console.log(\'STDIN_OK\',d.toString().trim());process.exit(0)})"'),background:true});ok(interactive);
  const interactiveId = JSON.parse(interactive.result.content[0].text).session_id;
  allow=false;failed(await call('portal_process',{action:'write',session_id:interactiveId,data:'must not arrive\n'}));
  allow=true;ok(await call('portal_process',{action:'write',session_id:interactiveId,data:'你好 Portal\n'}));
  const interactiveLog = await call('portal_process',{action:'poll',session_id:interactiveId,timeout_ms:10000});ok(interactiveLog);
  assert.match(JSON.parse(interactiveLog.result.content[0].text).output,/STDIN_OK 你好 Portal/);
  const cancellable = await call('portal_exec',{...shellArgs('node -e "console.log(\'CANCEL_READY\');setTimeout(()=>require(\'fs\').writeFileSync(\'outputs/cancel-leak.txt\',\'leaked\'),2500)"'),background:true});ok(cancellable);
  const cancelId = JSON.parse(cancellable.result.content[0].text).session_id;
  const cancelReady = await call('portal_process',{action:'poll',session_id:cancelId,timeout_ms:10000});ok(cancelReady);
  assert.match(JSON.parse(cancelReady.result.content[0].text).output,/CANCEL_READY/);
  ok(await call('portal_process',{action:'kill',session_id:cancelId}));
  const parallel = await Promise.all([0,1,2].map(i=>call('portal_exec',shellArgs(`node -e "const cp=require('child_process'); const v=cp.execFileSync('${python}',['-c','import sys; print(sys.version.split()[0])'],{encoding:'utf8'}).trim(); console.log('PARALLEL_${i}',v,process.versions.node)"`))));
  parallel.forEach((reply,i)=>{ok(reply);assert.match(JSON.stringify(reply),new RegExp(`PARALLEL_${i} 3\\.12\\.`));});
  await new Promise(resolve=>setTimeout(resolve,2600));
  assert.equal(await exists(path.join(workspace,'outputs/timeout-leak.txt')),false,'Timed-out descendants must not survive');
  assert.equal(await exists(path.join(workspace,'outputs/cancel-leak.txt')),false,'Killed descendants must not survive');
  const killedLog=await call('portal_process',{action:'log',session_id:cancelId});ok(killedLog);
  assert.equal(JSON.parse(killedLog.result.content[0].text).status.kind,'exited');
  const snapshotCommand = `${python} -c "import sys,os,json; print(json.dumps({'python':sys.executable,'tmp':os.environ['TMPDIR'],'cache':os.environ['PIP_CACHE_DIR']}))"`;
  const snapshot = await call('portal_exec',shellArgs(snapshotCommand));ok(snapshot);
  await start('supervised');
  const restarted = await call('portal_exec',shellArgs(snapshotCommand));ok(restarted);
  assert.equal(restarted.result.content[0].text,snapshot.result.content[0].text,'A new Portal process must prepare the same interpreter and cache paths');
  const restartDependency=await call('portal_exec',{...shellArgs(chain(`${venvPython} -c "import fixture_pkg; print(fixture_pkg.VALUE)"`,'node -e "console.log(require(\'portal-local-fixture\'))"')),workdir:'project'});ok(restartDependency);
  assert.match(JSON.stringify(restartDependency),/LOCAL_WHEEL_OK/);assert.match(JSON.stringify(restartDependency),/LOCAL_NPM_OK/);
  console.log('Execution states: nonzero/stderr, bounded UTF-8, timeout cleanup, stdin allow/deny, cancellation, concurrent Node→Python and restart persistence passed.');
  const runtimeFile = path.join(path.dirname(binary),'portal-runtime/runtime.json');
  const beforeRuntime = await readFile(runtimeFile,'utf8');
  failed(await call('portal_exec',shellArgs(writeCommand(runtimeFile,'must stay read-only'))));
  assert.equal(await readFile(runtimeFile,'utf8'),beforeRuntime);
  assert.equal(environment.preparation,'automatic-before-exec');
  assert.match(environment.python.version,/^3\.12\./);
  assert.match(environment.node.version,/^24\./);
  allow = false;
  const secretPaths = ['.aws/credentials','.azure/accessTokens.json','.gnupg/private.key','auth.json'];
  for (const secret of secretPaths) {
    const target = path.join(workspace,secret);
    await mkdir(path.dirname(target),{recursive:true}); await writeFile(target,'DUMMY_CREDENTIAL');
    failed(await call('portal_file_read',{path:secret}));
    failed(await call('portal_file_edit',{path:secret,old_text:'DUMMY_',new_text:'DUMMY_'}));
    failed(await call('portal_file_write',{path:secret,content:'changed'}));
    assert.equal(await readFile(target,'utf8'),'DUMMY_CREDENTIAL');
  }
  allow = true;
  const beforeSecretShell = approvals.length;
  const secretRead = process.platform === 'win32'
    ? "$ErrorActionPreference='Stop'; Get-Content .aws/credentials"
    : 'cat .aws/credentials';
  const blockedSecret = await call('portal_exec',shellArgs(secretRead)); failed(blockedSecret);
  assert(!JSON.stringify(blockedSecret).includes('DUMMY_CREDENTIAL'));
  failed(await call('portal_exec',shellArgs(process.platform === 'win32'
    ? "$ErrorActionPreference='Stop'; Set-Content .aws/credentials changed"
    : 'echo changed > .aws/credentials')));
  assert.equal(approvals.length,beforeSecretShell+2,'Each command asks and still runs inside the sandbox');
  allow = false;
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
  assert.equal(approvals.length,beforeSandbox+1,'One sandbox approval; failure must not silently retry on the host');
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
  // Old automatic-review arguments migrate to explicit per-call consent.
  await start('auto-review'); allow = false;
  failed(await call('portal_file_write',{path:outside,content:'no automatic write'}));
  await start('full-access');
  const beforeFull = approvals.length;
  ok(await call('portal_exec',shellArgs(chain(`${python} --version`,'node --version','npm --version'))));
  if (process.platform === 'win32') {
    ok(await call('portal_exec',shellArgs(`$env:HEART_PORTAL_SANDBOX='1'; ${python} -I -c "import inspect,os; assert inspect.isbuiltin(os.mkdir)"`)));
  }
  ok(await call('portal_file_write',{path:outside,content:'full file write'}));
  ok(await call('portal_exec',shellArgs(writeCommand(outside,'full shell write'))));
  assert.equal(await readFile(outside,'utf8'),'full shell write');
  assert.equal(approvals.length,beforeFull,'Full access must not ask through any file/shell path');
  assert.doesNotMatch(diagnostics,/Sandbox ACL cleanup failed/);
  // Desktop's background engine has no sidecar; the runtime lives elsewhere.
  // In particular, the Windows sandbox launcher must retain this explicit path.
  const serviceDirectory=path.join(temporary,'portal-service');await mkdir(serviceDirectory);
  const serviceBinary=path.join(serviceDirectory,path.basename(binary));await copyFile(binary,serviceBinary);
  await start('supervised',serviceBinary,path.dirname(runtimeFile));allow=true;
  const serviceRuntime=await call('portal_exec',shellArgs(chain(`${python} --version`,'node --version')));ok(serviceRuntime);
  assert.match(JSON.stringify(serviceRuntime),new RegExp(JSON.parse(beforeRuntime).python.version.replaceAll('.','\\.')));
  assert.match(JSON.stringify(serviceRuntime),new RegExp(JSON.parse(beforeRuntime).node.version.replaceAll('.','\\.')));
  // A damaged managed install must explain the repair, never silently use host Python.
  const damagedDirectory=path.join(temporary,'damaged-install');await mkdir(damagedDirectory);
  const damagedBinary=path.join(damagedDirectory,path.basename(binary));await copyFile(binary,damagedBinary);
  await start('supervised',damagedBinary);allow=true;
  const missingRuntime=await call('portal_exec',shellArgs(`${python} --version`));failed(missingRuntime);
  assert.match(JSON.stringify(missingRuntime),/repair or reinstall/);
  await mkdir(path.join(damagedDirectory,'portal-runtime'));
  const damagedManifest=JSON.parse(beforeRuntime);
  await writeFile(path.join(damagedDirectory,'portal-runtime/runtime.json'),JSON.stringify({...damagedManifest,platform:'wrong-platform'}));
  const wrongPlatform=await call('portal_exec',shellArgs('node --version'));failed(wrongPlatform);
  assert.match(JSON.stringify(wrongPlatform),/does not match this platform/);
  await writeFile(path.join(damagedDirectory,'portal-runtime/runtime.json'),beforeRuntime);
  const missingInterpreter=await call('portal_exec',shellArgs('node --version'));failed(missingInterpreter);
  assert.match(JSON.stringify(missingInterpreter),/Bundled interpreter is missing/);
  console.log('Install states: missing sidecar, wrong platform and missing interpreter report repair without host fallback.');
  console.log('Portal native permissions: bundled Python/Node, automatic foreground/background environment, immutable runtime, per-call sandbox consent, exact external file grants, explicit host execution, denial, no grant reuse, MCP startup gate and full access passed.');
} finally {
  await stop(); for (const entry of pending.values()) clearTimeout(entry.timer);
  for (const socket of sockets.clients) socket.terminate();
  await new Promise(resolve=>sockets.close(resolve)); await new Promise(resolve=>server.close(resolve));
  const resolved = path.resolve(temporary), prefix = path.resolve(os.tmpdir()) + path.sep;
  assert(resolved.startsWith(prefix) && path.basename(resolved).startsWith('portal-permission-native-'));
  await rm(resolved,{recursive:true,force:true});
}
