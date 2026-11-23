// Real Portal + pinned Pi + bundled interpreters; deterministic local model service.
// Never sends fixtures or credentials to a production model.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {WebSocketServer} from 'ws';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {portalSource} from '../scripts/portal-source.mjs';
import {once} from 'node:events';
import {cp,mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parse,stringify} from 'smol-toml';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const root=await mkdtemp(path.join(os.tmpdir(),'subagent-native-'));
const modelModule=path.join(root,'model-settings.cjs');
await build({entryPoints:['desktop/main/portal/subagent-setup.ts'],bundle:true,platform:'node',format:'cjs',outfile:modelModule});
const {saveSubagentPreferences,syncSubagentModel}=createRequire(import.meta.url)(modelModule);
const workspace=path.join(root,'中文 workspace');await mkdir(workspace);
const configFile=path.join(root,'portal.toml');
const windows=process.platform==='win32';
const budgetOnly=process.argv.includes('--budget-only');
const binary=path.resolve(process.env.PORTAL_SUBAGENT_BINARY|| (windows ? 'resources/heart-portal.exe' : 'resources/heart-portal'));
const sourceRuntime=process.env.PORTAL_SUBAGENT_RUNTIME||path.join(path.dirname(binary),'portal-runtime');
const runtimeManifest=JSON.parse(await readFile(path.join(sourceRuntime,'runtime.json'),'utf8'));
const sharedRuntime=path.join(root,'portal-runtimes',runtimeManifest.id);
await mkdir(path.dirname(sharedRuntime),{recursive:true});
await cp(sourceRuntime,sharedRuntime,{recursive:true,verbatimSymlinks:true});
let child,relay,seq=0,diagnostics='',generation=0;
const pending=new Map(), requests=[],callbacks=[],approvals=[],held=[];
const report={kind:'real Portal/Pi with local model fixture',cases:[],requests};
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const python=`import json,pathlib,sys,sqlite3,zipfile; assert 'portal-runtime' in sys.executable; p=pathlib.Path('python-结果.json'); p.write_text(json.dumps({'sum':12,'text':'你好','python':sys.executable},ensure_ascii=False),encoding='utf-8'); db=sqlite3.connect('task.sqlite'); db.execute('create table t(v integer)'); db.execute('insert into t values(12)'); db.commit(); z=zipfile.ZipFile('task.zip','w'); z.write(p); z.close(); print('PYTHON_TASK_OK')`;
const node=`const fs=require('node:fs');if(!process.execPath.includes('portal-runtime'))throw Error('HOST_NODE');const d=JSON.parse(fs.readFileSync('python-结果.json','utf8'));if(d.sum!==12||d.text!=='你好')throw Error('BAD_DATA');d.node=process.execPath;fs.writeFileSync('node-result.json',JSON.stringify(d));console.log('NODE_TASK_OK')`;
const steps={
 python:[['portal_exec',{command:`python3 -c ${quote(python)}`}]],
 node:[['portal_exec',{command:`node -e ${quote(node)}`}]],
 files:[['portal_file_write',{path:'edit.txt',content:'before 你好'}],['portal_file_edit',{path:'edit.txt',edits:[{old_text:'before',new_text:'after'}]}],['portal_file_read',{path:'edit.txt'}]],
 denied:[['portal_file_write',{path:'denied.txt',content:'must not be written'}]],
 allowed:[['portal_file_write',{path:'allowed.txt',content:'approved'}]],
 budget:[['portal_file_write',{path:'budget.txt',content:'first turn'}],['portal_file_edit',{path:'budget.txt',edits:[{old_text:'first turn',new_text:'second turn'}]}]],
 parallelA:[['portal_file_write',{path:'a.txt',content:'A'}]],
 parallelB:[['portal_file_write',{path:'b.txt',content:'B'}]],
 custom:[['portal_exec',{command:`python3 -c ${quote("import pathlib,sys,json; assert 'portal-runtime' in sys.executable; pathlib.Path('custom-result.json').write_text(json.dumps({'ok':True,'text':'自定义子任务'},ensure_ascii=False),encoding='utf-8')")} && node -e ${quote("const fs=require('node:fs'); if(!process.execPath.includes('portal-runtime'))throw Error('HOST_NODE'); const d=JSON.parse(fs.readFileSync('custom-result.json','utf8')); if(!d.ok)throw Error('BAD_DATA'); console.log('CUSTOM_RUNTIME_OK', d.text)")}`}]],
};
const server=createServer(async(req,res)=>{
 if(req.url==='/command'){
  assert.equal(req.headers.authorization,'Bearer test-approval');let t='';for await(const b of req)t+=b;const d=JSON.parse(t);approvals.push(d);const denied=d.args.includes('denied.txt');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({text:denied?'deny':'allow-once'}));return;
 }
 if(req.url?.includes('/v1/chat/completions')){
  let raw='';for await(const b of req)raw+=b;const d=JSON.parse(raw);if(d.stream===false){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'OK'},finish_reason:'stop'}]}));return;}const text=JSON.stringify(d.messages);const name=text.match(/CASE:([A-Za-z]+)/)?.[1]||'unknown';
  if(name==='unknown'){res.setHeader('Content-Type','text/event-stream');res.end('data: '+JSON.stringify({choices:[{delta:{content:'OK'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');return;}
  requests.push({case:name,model:d.model,tools:d.tools?.map(t=>t.function.name),authorized:req.headers.authorization==='Bearer fixture-model-key'});
  if(name==='auth'){res.writeHead(401,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'401 fixture authorization failure',type:'authentication_error'}}));return;}
  if(name==='cancel'||name==='timeout'){held.push(res);return;}
  const index=d.messages.filter(m=>m.role==='tool').length;const step=steps[name]?.[index];
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const chunk=(delta,finish=null)=>res.write('data: '+JSON.stringify({id:'fixture-'+requests.length,object:'chat.completion.chunk',created:1,model:d.model,choices:[{index:0,delta,finish_reason:finish}],...(finish&&name==='budget'?{usage:{prompt_tokens:450000,completion_tokens:100,total_tokens:450100,prompt_tokens_details:{cached_tokens:400000}}}:{})})+'\n\n');
  if(step){chunk({role:'assistant',tool_calls:[{index:0,id:'call_'+name+'_'+index,type:'function',function:{name:step[0],arguments:JSON.stringify(step[1])}}]});chunk({},'tool_calls');}
  else {chunk({role:'assistant',content:'CASE_DONE:'+name});chunk({},'stop');}
  res.end('data: [DONE]\n\n');return;
 }
 if(new URL(req.url,'http://127.0.0.1').pathname.endsWith('/api/callback')){
  let body='';for await(const chunk of req)body+=chunk;
  callbacks.push(JSON.parse(body));
 }
 res.setHeader('Content-Type','application/json');res.end('{}');
});
const wss=new WebSocketServer({server,path:'/_relay'});
wss.on('connection',socket=>{let ready=false;socket.on('message',b=>{const d=JSON.parse(b);if(!ready){ready=true;relay=socket;generation++;socket.send(JSON.stringify({ok:true,relay_keepalive:'text-v1'}));return;}if(d.type==='keepalive'){socket.send(JSON.stringify({type:'keepalive_ack'}));return;}const q=pending.get(d.id);if(q){clearTimeout(q.timer);pending.delete(d.id);d.error?q.reject(Error(JSON.stringify(d.error))):q.resolve(d.result);}});});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
await writeFile(path.join(root,'client.json'),JSON.stringify({port,token:'test-approval'}));
const until=async(fn,ms=30000)=>{const end=Date.now()+ms;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+diagnostics.slice(-5000));};
const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(Error('RPC timed out '+method));},20000);pending.set(id,{resolve,reject,timer});relay.send(JSON.stringify({jsonrpc:'2.0',id,method,params}));});
const call=async(name,args={})=>{const r=await rpc('tools/call',{name,arguments:args,_meta:{scene_id:'subagent-test-scene'}});assert.notEqual(r.isError,true,JSON.stringify(r));return JSON.parse(r.content[0].text);};
async function start(mode='full-access'){
 if(child){const done=once(child,'exit');child.kill();await done;}
 const previous=generation;
 const cfg=parse(await readFile(configFile,'utf8')); cfg.security.permission_mode=mode; await writeFile(configFile,stringify(cfg));
 child=spawn(binary,['--config',configFile,'--connect',`http://127.0.0.1:${port}/fixture/?token=local-subagent-test`],{env:{...process.env,...(windows?{}:{PATH:'/usr/bin:/bin'}),HEART_PORTAL_CLIENT_MANAGED:'1',HEART_PORTAL_RUNTIME_DIR:sharedRuntime,HEART_PORTAL_SUPERVISED:'1',HEART_PORTAL_CLIENT_FILE:path.join(root,'client.json')},stdio:['ignore','pipe','pipe']});
 for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{diagnostics=(diagnostics+b).slice(-15000);});
 await until(()=>generation>previous);
}
const spawnCase=async(name,budget={})=>call('portal_subagent_spawn',{brief:`CASE:${name} synthetic native test`,session:name,scene_id:'subagent-test-scene',model:'must-be-ignored',budget:{max_turns:10,max_tokens:10000,timeout_secs:60,...budget}});
const finish=async(task,ms=40000)=>until(async()=>{const s=await call('portal_subagent_status',{task_id:task.task_id});return s.status==='running'?false:s;},ms);
async function run(name,status='done',budget){const task=await spawnCase(name,budget);const result=await finish(task);assert.equal(result.status,status,JSON.stringify(result));const log=await call('portal_subagent_log',{task_id:task.task_id});report.cases.push({name,status:result.status,turns:result.turns,log:JSON.stringify(log).slice(-3000)});console.log('PASS',name,result.status);return result;}
async function runBudgetCases() {
 await run('auth','failed');
 const uncapped=await run('budget','done',{max_turns:1,max_tokens:1});
 assert.equal(uncapped.budget.max_turns,0);assert.equal(uncapped.budget.max_tokens,0);
 assert.ok(uncapped.turns>1);assert.ok(uncapped.tokens.total>400000);
 assert.ok(uncapped.tokens.cache_read>=400000);
 assert.equal(await readFile(path.join(workspace,'budget.txt'),'utf8'),'second turn');
 const delivered=await until(()=>callbacks.find(item=>item.task_id===uncapped.task_id));
 assert.equal(delivered.result.status,'done');
 assert.deepEqual(delivered.result.tokens,uncapped.tokens);
 assert.equal(delivered.result.budget_limit_reached,null);
 report.budget=uncapped;
 const cancelled=await spawnCase('cancel');await until(()=>requests.some(r=>r.case==='cancel'));await call('portal_subagent_control',{action:'cancel',task_id:cancelled.task_id});assert.equal((await finish(cancelled)).status,'cancelled');report.cases.push({name:'cancel',status:'cancelled'});console.log('PASS cancel');
 await run('timeout','timeout',{timeout_secs:30});
 assert.equal(callbacks.some(item=>item.task_id===cancelled.task_id),false);
 if(budgetOnly){
  await start();
  const restored=await call('portal_subagent_status',{task_id:uncapped.task_id});
  assert.equal(restored.status,'done');assert.equal(restored.turns,uncapped.turns);
  assert.equal(restored.tokens.total,uncapped.tokens.total);
  report.cases.push({name:'restart-ledger',status:'done'});
  console.log('PASS restart-ledger');
 }
}
try{
 // Install Portal's pinned Pi into this fixture; a clean CI host has no user-level Pi.
 const piSource=await readFile(path.join(portalSource,'portal/src/subagent/pi_daemon.rs'),'utf8');
 const piPackage=piSource.match(/PI_NPM_PACKAGE: &str = "([^"]+)"/)[1];
 const piVersion=piSource.match(/PI_PINNED_VERSION: &str = "([^"]+)"/)[1];
 const runtimeNode=path.join(sharedRuntime,runtimeManifest.node.path);
 const npm=path.join(sharedRuntime,'node',windows?'bin':'lib','node_modules/npm/bin/npm-cli.js');
 const piRoot=path.join(root,'pi');
 await promisify(execFile)(runtimeNode,[npm,'install','--prefix',piRoot,'--no-audit','--no-fund',`${piPackage}@${piVersion}`],{timeout:120000,env:{...process.env,PATH:path.dirname(runtimeNode)+path.delimiter+(windows?process.env.PATH:'/usr/bin:/bin')}});
 await writeFile(configFile,stringify({name:'subagent-native',workspace,bind:'127.0.0.1:0',kits_enabled:false,tools:{exec:true,file:true},security:{permission_mode:'full-access'},subagent:{enabled:true,inherit_model:true,auto_install:false,command:[runtimeNode,path.join(piRoot,'node_modules',piPackage,'dist/cli.js')],state_dir:path.join(root,'state'),model:{provider:'portal-custom',model:'inherited-one',base_url:`http://127.0.0.1:${port}/v1`,api:'openai-completions',thinking:'off',api_key:'fixture-model-key'}}}));
 await start();
 const tools=await rpc('tools/list',{});assert(tools.tools.some(t=>t.name==='portal_subagent_spawn'));
 const status=await call('portal_subagent_status');assert(status.command_resolved);assert(!JSON.stringify(status).includes('fixture-model-key'));
 if (budgetOnly) {
 await runBudgetCases();
 } else {
 await run('python');await run('node');await run('files');
 assert.equal(await readFile(path.join(workspace,'edit.txt'),'utf8'),'after 你好');
 const result=JSON.parse(await readFile(path.join(workspace,'node-result.json'),'utf8'));assert(result.python.includes('portal-runtime'));assert(result.node.includes('portal-runtime'));
 const config=parse(await readFile(configFile,'utf8'));config.subagent.model.model='inherited-two';await writeFile(configFile,stringify(config));
 await run('switched');assert.equal(requests.at(-1).model,'inherited-two');assert.equal(generation,1);
 const desktopSettings={endpoint:'https://fixture.invalid/being',workspace,portalConfigPath:configFile,portalName:'fixture',allowExec:true,kitsEnabled:false};
 await saveSubagentPreferences(root,desktopSettings,{provider:'portal-custom',model:'custom-fixture',base_url:`http://127.0.0.1:${port}/v1`,api:'openai-completions',thinking:'off',api_key:'fixture-model-key'});
 assert.equal(await syncSubagentModel(root,desktopSettings,{endpoint:desktopSettings.endpoint,being:'fixture',token:'loom-fixture'}),false);
 await run('custom');assert.equal(requests.at(-1).model,'custom-fixture');assert.equal(JSON.parse(await readFile(path.join(workspace,'custom-result.json'),'utf8')).text,'自定义子任务');
 await saveSubagentPreferences(root,desktopSettings,undefined,{endpoint:desktopSettings.endpoint,being:'fixture',token:'loom-fixture'},async()=>new Response('data: '+JSON.stringify({choices:[{delta:{content:'OK'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'));
 const gateway=parse(await readFile(configFile,'utf8'));assert.equal(gateway.subagent.model.base_url,'https://101.132.86.87/llm/fixture/v1');
 // Continue protocol tests against the local service; never send fixture credentials to the gateway.
 await saveSubagentPreferences(root,desktopSettings,{provider:'portal-custom',model:'inherited-two',base_url:`http://127.0.0.1:${port}/v1`,api:'openai-completions',thinking:'off',api_key:'fixture-model-key'});
 const tasks=await Promise.all([spawnCase('parallelA'),spawnCase('parallelB')]);const results=await Promise.all(tasks.map(t=>finish(t)));assert(results.every(r=>r.status==='done'));report.cases.push({name:'parallel',status:'done'});console.log('PASS parallel');
 await runBudgetCases();
 await start('supervised');await run('denied');await run('allowed');
 await assert.rejects(readFile(path.join(workspace,'denied.txt')), {code:'ENOENT'});assert.equal(await readFile(path.join(workspace,'allowed.txt'),'utf8'),'approved');assert.equal(approvals.length,2);assert(approvals.every(a=>a.sceneId==='subagent-test-scene'));
 report.cases.push({name:'approval-policy',status:'passed'});
 }
 assert(requests.every(r=>r.authorized));assert(requests.every(r=>r.model!=='must-be-ignored'));
 assert(requests.every(r=>!r.tools?.includes('bash')),'All tasks must use Portal tools, including full access');
 const ledger=JSON.parse(await readFile(path.join(root,'state/ledger.json'),'utf8'));assert(ledger.tasks.every(t=>t.scene_id==='subagent-test-scene'));report.ledger=ledger.tasks.map(({task_id,status,scene_id,brief_head,turns})=>({task_id,status,scene_id,brief_head,turns}));
 report.status='passed';
} catch(error){report.status='failed';report.error=String(error);report.diagnostics=diagnostics;throw error;}
finally{
 await mkdir('test-results/subagent',{recursive:true});await writeFile('test-results/subagent/native-results.json',JSON.stringify(report,null,2));
 if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done;}
 for(const response of held)response.destroy();for(const s of wss.clients)s.terminate();wss.close();server.closeAllConnections();server.close();await rm(root,{recursive:true,force:true});
}
