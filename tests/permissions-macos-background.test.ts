import {expect,it,vi} from 'vitest';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {BackgroundPortal} from '../desktop/main/portal/background';
import {parseConnection} from '../desktop/main/chat/connection';
const {WebSocketServer}=createRequire(import.meta.url)('ws');
it.skipIf(process.platform !== 'darwin' || process.env.PORTAL_DESKTOP_NATIVE_PERMISSION_TESTS !== '1')('macOS native background downgrade enforces supervised after restart', async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'permission-review-launchd-'));
  const workspace=path.join(root,'workspace'); await mkdir(workspace);
  const server=new WebSocketServer({host:'127.0.0.1',port:0});
  let relay:any,generation=0,id=0;
  const pending=new Map<number,(value:any)=>void>();
  server.on('connection',(socket:any)=>{
    let ready=false;
    socket.on('message',(bytes:Buffer)=>{
      const msg=JSON.parse(bytes.toString());
      if(!ready){ready=true;relay=socket;generation++;socket.send(JSON.stringify({ok:true,relay_keepalive:'text-v1'}));return;}
      if(msg.type==='keepalive'){socket.send(JSON.stringify({type:'keepalive_ack'}));return;}
      pending.get(msg.id)?.(msg);pending.delete(msg.id);
    });
  });
  await new Promise<void>(r=>server.once('listening',r));
  async function call(name:string,args:object){
    return new Promise<any>((resolve,reject)=>{
      const requestId=++id;
      const timer=setTimeout(()=>reject(new Error('Tool timeout')),10000);
      pending.set(requestId,value=>{clearTimeout(timer);resolve(value);});
      relay.send(JSON.stringify({jsonrpc:'2.0',id:requestId,method:'tools/call',params:{name,arguments:args}}));
    });
  }
  const background=new BackgroundPortal(path.join(root,'profile'),undefined,'darwin',root);
  const settings:any={endpoint:'',being:'',hasToken:true,workspace,portalName:'permission-review',portalBinary:path.resolve('resources/heart-portal'),autoStart:false,backgroundEnabled:true,allowExec:true,kitsEnabled:false,permissionMode:'full-access'};
  const connection=parseConnection(`http://127.0.0.1:${server.address().port}/native-permission-review/?token=local-fixture`);
  try{
    await background.enable(settings,connection);
    await vi.waitFor(()=>expect(generation).toBe(1),{timeout:20000});
    expect((await call('portal_file_write',{path:'initial.txt',content:'full'})).result?.isError).not.toBe(true);
    expect(await readFile(path.join(workspace,'initial.txt'),'utf8')).toBe('full');
    const oldRoot=background.installedService!.root;
    await background.disable();
    await background.enable({...settings,permissionMode:'supervised'},connection);
    await vi.waitFor(()=>expect(generation).toBe(2),{timeout:20000});
    const runner=await readFile(path.join(background.installedService!.root,'run.sh'),'utf8');
    const result=await call('portal_file_write',{path:'after-downgrade.txt',content:'still writable'});
    expect(background.installedService!.root).not.toBe(oldRoot);
    expect(runner).toContain("'--permission-mode' 'supervised'");
    await expect(readFile(path.join(workspace,'after-downgrade.txt'))).rejects.toMatchObject({code:'ENOENT'});
    expect(result.result?.isError).toBe(true);
  }finally{
    await background.disable();
    if(background.installedService)await rm(background.installedService.file,{force:true});
    for(const socket of server.clients)socket.terminate();
    await new Promise<void>(r=>server.close(()=>r()));
    await rm(root,{recursive:true,force:true});
  }
},60000);
