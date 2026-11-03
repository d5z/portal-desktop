import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DshPluginManager } from '../desktop/main/plugins/dsh/manager';
import { containedFile, readDshPackage } from '../desktop/main/plugins/dsh/package';
import { externalizePluginScripts } from '../desktop/main/plugins/dsh/html';
const roots: string[] = [], managers: DshPluginManager[] = [];
let workerDirectory: string, worker: string;
beforeAll(async () => {
  workerDirectory = await mkdtemp(path.join(os.tmpdir(), 'town-dsh-worker-'));
  worker = path.join(workerDirectory, 'host.cjs');
  await build({ entryPoints: ['desktop/main/plugins/dsh/worker.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node24', outfile: worker,
    banner: { js: "const __townModuleURL = require('node:url').pathToFileURL(__filename).href;" }, define: { 'import.meta.url': '__townModuleURL' } });
});
afterAll(async () => { if (workerDirectory) await rm(workerDirectory, { recursive: true, force: true }); });
afterEach(async () => { for (const m of managers.splice(0)) await m.stop(); for (const root of roots.splice(0)) await rm(root, {recursive:true,force:true}); });
async function fixture() {
  const home = await mkdtemp(path.join(os.tmpdir(), 'town-dsh-contract-')); roots.push(home);
  const manager = new DshPluginManager(home, worker, path.resolve('node_modules/npm/bin/npm-cli.js'), 'beings://desktop'); managers.push(manager);
  await manager.initialize();
  const make = async (name: string, source: string, extra = {}) => {
    const root = path.join(home, 'packages', name); await mkdir(root, {recursive:true});
    await writeFile(path.join(root,'package.json'),JSON.stringify({name,version:'1.0.0',type:'module',main:'host.js',dsh:{},...extra}));
    await writeFile(path.join(root,'host.js'),source);
    return {root,plugin:{id:name,version:'1.0.0',description:name,source:root,enabled:true,installedAt:new Date().toISOString(),status:'disabled' as const}};
  };
  return {home,manager,make};
}
describe('Town DSH compatibility host (real Cordis process)',()=>{
 it('forwards decoded compressed assets without stale encoding or length headers',async()=>{
   const {manager,make}=await fixture();
   await manager.install(await make('compressed-assets',`import {gzipSync} from 'node:zlib';export const inject=['webServer'];export function apply(ctx){ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/compressed.js',handler(req,res){const body=gzipSync('window.greeting = "你好🌱";');res.writeHead(200,{'content-type':'text/javascript','content-encoding':'gzip','content-length':body.length});res.end(body)}}))}`));
   const response=await manager.resource(new Request('beings://desktop/compressed.js'));
   expect(await response.text()).toBe('window.greeting = "你好🌱";');
   expect(response.headers.has('content-encoding')).toBe(false);
   expect(response.headers.has('content-length')).toBe(false);
 });
 it('preserves peers through queued enable, disable, remove and reinstall operations',async()=>{
   const {manager,make}=await fixture();
   const a=await make('lifecycle-a',`export const inject=['webServer'];export function apply(ctx){ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/a',handler(req,res){res.end('a')}}))}`);
   const b=await make('lifecycle-b',`export const inject=['webServer'];export function apply(ctx){ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/b',handler(req,res){res.end('b')}}))}`);
   await manager.install(a);await manager.install(b);
   await Promise.all([manager.enable('lifecycle-b',false),manager.enable('lifecycle-b',true),manager.enable('lifecycle-b',false)]);
   expect(manager.state().plugins.find(p=>p.id==='lifecycle-b')?.enabled).toBe(false);
   expect(await (await manager.resource(new Request('beings://desktop/a'))).text()).toBe('a');
   expect(manager.matches('/b')).toBe(false);
   await manager.remove('lifecycle-b');await manager.install({...b,plugin:{...b.plugin,enabled:true}});
   expect(await (await manager.resource(new Request('beings://desktop/b'))).text()).toBe('b');
   expect(manager.state().plugins.every(p=>p.status==='active')).toBe(true);
 },15000);
 it('contains a Fetch body error without exiting the host or losing other routes',async()=>{
   const {manager,make}=await fixture();
   await manager.install(await make('body-error',`export const inject=['connection','webServer'];export function apply(ctx){ctx.effect(()=>ctx.connection.fetch.register({path:'/broken-body',fetch:()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('start'));setTimeout(()=>c.error(new Error('body failed')),30)}}))}));ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/healthy',handler(req,res){res.end('healthy')}}))}`));
   const response=await manager.resource(new Request('beings://desktop/broken-body'));
   await expect(response.text()).rejects.toThrow();
   expect(await (await manager.resource(new Request('beings://desktop/healthy'))).text()).toBe('healthy');
   expect(manager.state().plugins[0].status).toBe('active');
 });
 it('does not resolve missing packages under disabled rows or groups',async()=>{
   const {manager,make}=await fixture();
   const bundle=await make('disabled-missing','',{main:undefined,dsh:{bundle:{patch:'patch.yml'}}});
   await writeFile(path.join(bundle.root,'patch.yml'),'- insert:\n    - id: absent\n      name: absent-package\n      disabled: true\n    - id: group\n      name: cordis:group\n      group: true\n      disabled: true\n      config:\n        - id: child\n          name: missing-child\n');
   await manager.install(bundle);
   expect(manager.state().plugins[0]).toMatchObject({status:'active'});
 });
 it('activates string exports entrypoints rather than reporting a silent no-op',async()=>{
   const {manager,make}=await fixture();
   await manager.install(await make('string-exports',`export const inject=['webServer'];export function apply(ctx){ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/exports',handler(req,res){res.end('loaded')}}))}`,{main:undefined,exports:'./host.js'}));
   expect(await (await manager.resource(new Request('beings://desktop/exports'))).text()).toBe('loaded');
 });
 it('does not launch a late plugin host when Town quits during initialization',async()=>{
   const home=await mkdtemp(path.join(os.tmpdir(),'town-dsh-quit-'));roots.push(home);
   const manager=new DshPluginManager(home,worker,path.resolve('node_modules/npm/bin/npm-cli.js'),'beings://desktop');managers.push(manager);
   const starting=manager.initialize();
   await manager.shutdown();await starting;
   expect((await manager.resource(new Request('beings://desktop/@town-dsh/rpc'))).status).toBe(503);
   // Initialization is cached and cannot restart the host after shutdown.
   await manager.initialize();
   expect((await manager.resource(new Request('beings://desktop/@town-dsh/rpc'))).status).toBe(503);
 });
 it('externalizes executable document scripts without rewriting JSON or external scripts',()=>{
   const scripts=new Map<string,string>();
   const html=externalizePluginScripts('<!doctype html><html><head></head><body><script data-example="a>b">window.ready = true;</script><script type="application/json">{"keep":true}</script><script src="/original.js"></script></body></html>',scripts);
   expect(html).toContain('/@town-dsh/document-scripts/');
   expect([...scripts.values()]).toEqual(['window.ready = true;']);
   expect(html).toContain('<script type="application/json">{"keep":true}</script>');
   expect(html).toContain('<script src="/original.js"></script>');
 });
 it('serves authenticated routes, preserves config and removes routes on disable/restart',async()=>{
   const {home,manager,make}=await fixture();
   const entry=await make('route-plugin',`export const inject=['webServer']; export function apply(ctx,config){ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/fixture',handler(req,res){res.setHeader('content-type','application/json');res.end(JSON.stringify({value:config.value||'first'}));}}));}`);
   await manager.install(entry);
   expect(manager.state().plugins[0].status).toBe('active');
   expect(await (await manager.resource(new Request('beings://desktop/fixture'))).json()).toEqual({value:'first'});
   expect((await manager.resource(new Request('beings://desktop/fixture',{method:'POST',headers:{origin:'https://attacker.invalid'}}))).status).toBe(403);
   await manager.configure('route-plugin',{value:'saved'});
   expect(await (await manager.resource(new Request('beings://desktop/fixture'))).json()).toEqual({value:'saved'});
   await manager.stop();
   const second=new DshPluginManager(home,manager.worker,manager.npmCLI,manager.shellOrigin);managers.push(second);await second.initialize();
   expect(await (await second.resource(new Request('beings://desktop/fixture'))).json()).toEqual({value:'saved'});
   await second.enable('route-plugin',false);
   expect(second.matches('/fixture')).toBe(false);expect(second.state().plugins[0].status).toBe('disabled');
   await second.enable('route-plugin',true);expect(second.matches('/fixture')).toBe(true);
   await second.remove('route-plugin');expect(second.state().plugins).toHaveLength(0);
 },20000);
 it('reports missing services and never executes a dependent plugin',async()=>{
   const {manager,make}=await fixture();
   await manager.install(await make('agent-plugin',`export const inject=['agents','sessions'];export function apply(){throw new Error('must not run')}`));
   expect(manager.state().plugins[0]).toMatchObject({status:'blocked'});
   expect(manager.state().plugins[0].error).toContain('agents');
 },10000);
 it('runs plugin disposers and rolls back a broken update while preserving configuration',async()=>{
   const {home,manager,make}=await fixture();
   const marker=path.join(home,'disposed');
   const entry=await make('upgrade-plugin',`import {writeFileSync} from 'node:fs';export const inject=['webServer'];export function apply(ctx,config){ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/version',handler(req,res){res.end(config.value||'initial')}}));ctx.effect(()=>()=>writeFileSync(${JSON.stringify(marker)},'disposed'))}`);
   await manager.install(entry);await manager.configure('upgrade-plugin',{value:'persisted'});
   expect(await readFile(marker,'utf8')).toBe('disposed');
   const bad=await make('upgrade-broken',`export const inject=['missing'];export function apply(){}`);
   await writeFile(path.join(bad.root,'package.json'),JSON.stringify({name:'upgrade-plugin',version:'2.0.0',type:'module',main:'host.js',dsh:{}}));
   bad.plugin={...bad.plugin,id:'upgrade-plugin',version:'2.0.0'};
   await expect(manager.install(bad)).rejects.toThrow('已恢复旧版');
   expect(manager.state().plugins[0]).toMatchObject({version:'1.0.0',status:'active'});
   expect(await (await manager.resource(new Request('beings://desktop/version'))).text()).toBe('persisted');
   await manager.remove('upgrade-plugin');await manager.install(entry);
   expect(await (await manager.resource(new Request('beings://desktop/version'))).text()).toBe('persisted');
 },15000);
 it('resolves providers regardless of installation order and detects provider removal',async()=>{
   const {manager,make}=await fixture();
   await manager.install(await make('consumer',`export const inject=['fixture','webServer'];export function apply(ctx){ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/dep',handler(req,res){res.end(ctx.fixture)}}))}`));
   await manager.install(await make('provider',`export function apply(ctx){ctx.provide('fixture','available')}`));
   expect(manager.state().plugins,JSON.stringify(manager.state().plugins)).toEqual(expect.arrayContaining([expect.objectContaining({id:'consumer',status:'active'}),expect.objectContaining({id:'provider',status:'active'})]));
   expect(await (await manager.resource(new Request('beings://desktop/dep'))).text()).toBe('available');
   await manager.enable('provider',false);expect(manager.state().plugins.find(p=>p.id==='consumer')?.status).toBe('blocked');expect(manager.matches('/dep')).toBe(false);
 },15000);
 it('contains crashing plugins and retains a usable recovery state',async()=>{
   const {manager,make}=await fixture();
   await manager.install(await make('crash-plugin',`export function apply(){process.exit(7)}`));
   expect(manager.state().plugins[0].status).toBe('error');
   await manager.disableAll();expect(manager.state().plugins[0]).toMatchObject({enabled:false,status:'disabled'});
 },10000);
 it('installs an unmodified local npm package without executing lifecycle scripts',async()=>{
   const {home,manager,make}=await fixture();
   const marker=path.join(home,'should-not-exist');
   const entry=await make('local-plugin',`export function apply(){}`,{scripts:{postinstall:`node -e "require('fs').writeFileSync(${JSON.stringify(marker)},'bad')"`}});
   const prepared=await manager.prepare(entry.root);
   expect(prepared.entry.plugin.id).toBe('local-plugin');
   await expect(readFile(marker)).rejects.toThrow();
   await manager.install(prepared.entry);expect(manager.state().plugins[0].status).toBe('active');
 },20000);
 it('rejects unsupported bundle operations, engine ranges and path escapes before execution',async()=>{
   const {home,make}=await fixture();
   const {root}=await make('invalid-plugin','',{dsh:{bundle:{patch:'patch.yml'}}});
   await writeFile(path.join(root,'patch.yml'),'- remove: core\n');
   await expect(readDshPackage(root)).rejects.toThrow('insert');
   await writeFile(path.join(root,'package.json'),JSON.stringify({name:'invalid-plugin',version:'1.0.0',dsh:{},engines:{dsh:'>=99.0.0'}}));
   await expect(readDshPackage(root)).rejects.toThrow('99.0.0');
   await writeFile(path.join(home,'outside.js'),'');await symlink(path.join(home,'outside.js'),path.join(root,'escape.js'));
   await expect(containedFile(root,'escape.js')).rejects.toThrow('越过');
 });
 it('uses exact routes before the longest prefix regardless of registration order',async()=>{
   const {manager,make}=await fixture();
   await manager.install(await make('routing',`export const inject=['webServer'];export function apply(ctx){for(const [kind,path,value] of [['prefix','/a','broad'],['prefix','/a/b','nested'],['exact','/a/b/c','exact']])ctx.effect(()=>ctx.webServer.register({kind,path,handler(req,res){res.end(value)}}));}`));
   expect(await (await manager.resource(new Request('beings://desktop/a/b/c'))).text()).toBe('exact');
   expect(await (await manager.resource(new Request('beings://desktop/a/b/d'))).text()).toBe('nested');
 });
 it('discovers bundle child clients and preserves independent row configurations through id patches',async()=>{
   const {manager,make}=await fixture();
   const bundle=await make('bundle','',{main:undefined,dsh:{bundle:{patch:'patch.yml'}}});
   const child=path.join(bundle.root,'node_modules','child');await mkdir(child,{recursive:true});
   await writeFile(path.join(child,'package.json'),JSON.stringify({name:'child',version:'1.0.0',type:'module',exports:{'.':'./host.js','./client':'./client.js'},dsh:{client:{platform:'web'}}}));
   await writeFile(path.join(child,'client.js'),'window.__ModuleLoader__.load({id:"child",factory:()=>({apply(){}})});');
   await writeFile(path.join(child,'host.js'),`export const inject=['webServer'];export function apply(ctx,config){ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/child',handler(req,res){res.end(config.value)}}));}`);
   await writeFile(path.join(bundle.root,'patch.yml'),'- insert:\n    - id: child-row\n      name: child\n      config: { value: before }\n- id: child-row\n  config: { value: patched }\n');
   await manager.install(bundle);
   expect(manager.state().plugins[0]).toMatchObject({status:'active'});
   expect(manager.state().clients).toEqual([expect.objectContaining({id:'child',owner:'bundle'})]);
   expect(await (await manager.resource(new Request('beings://desktop/child'))).text()).toBe('patched');
 });
 it('combines legacy and modern injections while preserving plugin deduplication guards',async()=>{
   const {manager,make}=await fixture();
   await manager.install(await make('legacy',`export const inject=['webServer'];export function apply(ctx){ctx.webServer.tapIndex(html=>html.replace('</body>','<div id="legacy-marker"></div></body>'));}`));
   await manager.install(await make('modern',`export const inject=['webServer'];export function apply(ctx){ctx.on('webserver/index-inject',rows=>rows.push({kind:'style',text:'.modern{}'},{kind:'html',placement:'body',html:'<div id="modern-marker"></div>'}));ctx.webServer.tapIndex(html=>html.includes('modern-marker')?html:html.replace('</body>','<div id="duplicate"></div></body>'));}`));
   const html=manager.state().injections.map(row=>row.html||'').join('');
   expect(html).toContain('legacy-marker');expect(html).toContain('modern-marker');expect(html).not.toContain('duplicate');expect(html).toContain('.modern{}');
 });
 it('rebases module imports, dynamic imports and import.meta.url against the plugin document',()=>{
   const scripts=new Map<string,string>();
   externalizePluginScripts('<script type="module">import "./helper.js"; export {x} from "../shared.js"; import("./lazy.js"); console.log(import.meta.url)</script>',scripts,'https://town.test/editor/index.html');
   const source=[...scripts.values()][0];
   expect(source).toContain('https://town.test/editor/helper.js');expect(source).toContain('https://town.test/shared.js');expect(source).toContain('https://town.test/editor/lazy.js');expect(source).toContain('"https://town.test/editor/index.html"');
 });
 it('keeps an active stream alive beyond the response-header timeout and propagates cancellation',async()=>{
   const {manager,make}=await fixture();
   await manager.install(await make('stream',`export const inject=['webServer'];export function apply(ctx){ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/stream',handler(req,res){res.writeHead(200,{'content-type':'text/event-stream'});res.write('start\\n');const timer=setInterval(()=>res.write('tick\\n'),1000);res.on('close',()=>clearInterval(timer));}}));}`));
   const controller=new AbortController();const response=await manager.resource(new Request('beings://desktop/stream',{signal:controller.signal}));const reader=response.body!.getReader();
   const started=Date.now();while(Date.now()-started<31000){const chunk=await reader.read();expect(chunk.done).toBe(false);}
   controller.abort();let aborted=false;for(let i=0;i<5;i++){try{const next=await reader.read();if(next.done){aborted=true;break;}}catch{aborted=true;break;}}expect(aborted).toBe(true);
 },40000);
 it('persists settings mutations, refuses stale revisions, and restores values after restart',async()=>{
   const {manager,make}=await fixture();
   await manager.install(await make('configurable',`export function apply(){}`));
   const rpc=async(method:string,args:unknown[]=[])=> (await manager.resource(new Request('beings://desktop/@town-dsh/rpc',{method:'POST',body:JSON.stringify({service:'settings',method,args})}))).json();
   const before=await rpc('describe');expect(before.value.namespaces[0].revision).toBe(0);
   const saved=await rpc('mutate',['configurable',[{op:'set',path:['color'],value:'blue'}],0]);expect(saved).toMatchObject({ok:true,value:{value:{color:'blue'},revision:1}});
   expect(await rpc('mutate',['configurable',[{op:'set',path:['color'],value:'red'}],0])).toMatchObject({ok:false});
   await manager.enable('configurable',false);await manager.enable('configurable',true);
   expect((await rpc('describe')).value.namespaces[0].value).toEqual({color:'blue'});
 });

 it('executes build scripts only through the explicit prepared build operation',async()=>{
   const {manager,make}=await fixture();
   const entry=await make('buildable',`export function apply(){}`,{scripts:{postinstall:'node build.cjs'}});
   await writeFile(path.join(entry.root,'build.cjs'),`require('fs').writeFileSync('built.txt','ready')`);
   const prepared=await manager.prepare(entry.root);
   await expect(readFile(path.join(prepared.entry.root,'built.txt'))).rejects.toThrow();
   await prepared.build();
   expect(await readFile(path.join(prepared.entry.root,'built.txt'),'utf8')).toBe('ready');
 },20000);
 it('executes nested HTML scripts and preserves module type and inert JSON',async()=>{
   const {manager,make}=await fixture();
   await manager.install(await make('nested-script',`export function apply(ctx){ctx.on('webserver/index-inject',rows=>rows.push({kind:'html',placement:'body',html:'<div id="mount"><script type="module">import \"/helper.js\";</script><script type="application/json" id="data">{"x":1}</script></div>'}));}`));
   const rows=manager.state().injections;
   expect(rows.some(row=>row.type==='module'&&row.kind==='script-src')).toBe(true);
   expect(rows.map(row=>row.html||'').join('')).toContain('application/json');
   expect(rows.map(row=>row.html||'').join('')).not.toContain('type="module"');
 });
 it('uses declared Remote methods for unary and streamed calls and rejects private members',async()=>{
   const {manager,make}=await fixture();
   const entry=await make('remote-fixture',`import {TypertRemoteService,Remote} from '@deepseek-ai/dsh-typert-protocol';
     const initializers=[];
     class Example extends TypertRemoteService {
       constructor(ctx){super(ctx,'fixtureRemote');for(const fn of initializers)fn.call(this)}
       echo(value){return {echo:value}} privateMethod(){return 'private'}
       async *items(){yield 1;yield 2;}
     }
     for(const name of ['echo','items']){const context={kind:'method',name,static:false,private:false,addInitializer:fn=>initializers.push(fn)};if(name==='items')Remote({mode:'stream'})(Example.prototype[name],context);else Remote(Example.prototype[name],context)}
     export function apply(ctx){new Example(ctx)}`);
   await symlink(path.resolve('node_modules'),path.join(entry.root,'node_modules'),'dir');
   await manager.install(entry);expect(manager.state().plugins[0].status).toBe('active');
   const call=(method:string,args:unknown[]=[])=>manager.resource(new Request('beings://desktop/@town-dsh/rpc',{method:'POST',body:JSON.stringify({service:'fixtureRemote',method,args})}));
   expect(await (await call('echo',['test'])).json()).toEqual({ok:true,value:{echo:'test'}});
   expect(await (await call('items')).text()).toBe('{"ok":true,"value":1}\n{"ok":true,"value":2}\n');
   expect(await (await call('privateMethod')).json()).toMatchObject({ok:false});
 });
 it('redacts secrets in every settings layer and keeps nested inherited configuration',async()=>{
   const {manager,make}=await fixture();
   const entry=await make('secret-fixture',`import z from '@deepseek-ai/schemastery'; export const Config=z.object({password:z.string().role('secret').default('default-secret'),nested:z.object({left:z.number().default(1),right:z.number().default(2)})});export function apply(){}`);
   await symlink(path.resolve('node_modules'),path.join(entry.root,'node_modules'),'dir');
   await manager.install(entry);await manager.configure('secret-fixture',{password:'base-secret',nested:{left:4,right:5}});
   const call=async(method:string,args:unknown[]=[])=> (await manager.resource(new Request('beings://desktop/@town-dsh/rpc',{method:'POST',body:JSON.stringify({service:'settings',method,args})}))).json();
   const changed=await call('mutate',['secret-fixture',[{op:'set',path:['nested','right'],value:8},{op:'set',path:['password'],value:'user-secret'}],0]);
   expect(changed.ok).toBe(true);expect(changed.value.value.nested).toEqual({left:4,right:8});
   const wire=JSON.stringify(await call('describe'));for(const secret of ['default-secret','base-secret','user-secret'])expect(wire).not.toContain(secret);
   expect(changed.value.secrets).toEqual(expect.arrayContaining([expect.objectContaining({path:['password'],set:true})]));
 });

 it('retains native group isolation and YAML expressions without loading disabled descendants',async()=>{
   const {manager,make}=await fixture();
   const bundle=await make('group-bundle','',{main:undefined,dsh:{bundle:{patch:'patch.yml'}}});
   for(const [name,source] of Object.entries({
     'group-provider':`export function apply(ctx,config){ctx.provide('groupValue',config.value)}`,
     'group-consumer':`export const inject=['groupValue','webServer'];export function apply(ctx){ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/isolated',handler(req,res){res.end(String(ctx.groupValue))}}))}`,
     'group-disabled':`export function apply(){throw new Error('disabled child must not run')}`
   })) { const dir=path.join(bundle.root,'node_modules',name);await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'package.json'),JSON.stringify({name,version:'1.0.0',type:'module',main:'index.js'}));await writeFile(path.join(dir,'index.js'),source); }
   await writeFile(path.join(bundle.root,'patch.yml'),`- insert:
  - id: scope
    name: cordis:group
    group: true
    config:
      - id: provider-a
        name: group-provider
        isolate: {groupValue: a}
        config: {value: !!js '1 + 2'}
      - id: provider-b
        name: group-provider
        isolate: {groupValue: b}
        config: {value: 9}
      - id: consumer
        name: group-consumer
        isolate: {groupValue: a}
        disabled: !!js 'false'
  - id: disabled-group
    name: cordis:group
    group: true
    disabled: !!js 'true'
    config:
      - id: ignored
        name: group-disabled
`);
   await manager.install(bundle);expect(manager.state().plugins[0],JSON.stringify(manager.state())).toMatchObject({status:'active'});
   expect(await (await manager.resource(new Request('beings://desktop/isolated'))).text()).toBe('3');
 });

});
