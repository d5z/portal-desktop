import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp, mkdir, writeFile, readFile, readdir, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {_electron as electron} from 'playwright';
const directory=await mkdtemp(path.join(os.tmpdir(),'town-attachments-'));
let application;
try {
  await build({stdin:{loader:'ts',resolveDir:process.cwd(),contents:`
    import {app, protocol, BrowserWindow, session, net} from 'electron';
    import {createServer} from 'node:http';
    import {AttachmentDownloads} from './desktop/main/chat/downloads';
    import {ChatProxy} from './desktop/main/chat/proxy';
    import {registerLocalProtocol} from './desktop/main/app/protocol';
    app.setPath('userData',${JSON.stringify(path.join(directory,'profile'))});
    protocol.registerSchemesAsPrivileged([{scheme:'beings',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
    app.whenReady().then(async()=>{
      const connection={endpoint:'https://echo.beings.town/alice',being:'alice',token:'fixture',relaySecret:'fixture',link:''};
      const scene={scene_id:'room',scene_meta:{client:'test',scene_label:'附件测试'}};
      const id='msg_'+'a'.repeat(64), files=[], sends=[], history=[], downloads=[];
      const objectServer=createServer(async(req,res)=>{
        const f=files.find(file=>req.url==='/'+file.id);
        if(!f){res.writeHead(404);res.end();return;}
        if(req.headers.authorization || req.headers.cookie){res.writeHead(403);res.end();return;}
        if(req.method==='PUT'){const chunks=[];for await(const chunk of req)chunks.push(chunk);f.bytes=Buffer.concat(chunks);res.end();return;}
        res.setHeader('Content-Type',f.mime);res.setHeader('Content-Length',f.bytes.length);for(let offset=0;offset<f.bytes.length;offset+=65536){res.write(f.bytes.subarray(offset,offset+65536));await new Promise(r=>setTimeout(r,3));}res.end();
      });
      await new Promise(resolve=>objectServer.listen(0,'127.0.0.1',resolve));objectServer.unref();
      const objectOrigin='http://127.0.0.1:'+objectServer.address().port;
      let delivery='pending', created=false, done=false, failed=false;
      globalThis.fixture={sends,history,files,downloads,fail:()=>failed=true,finish:()=>{failed=false;done=true;}};
      session.defaultSession.on('will-download', (_event, item) => { item.setSavePath(${JSON.stringify(directory)} + '/download-' + item.getFilename()); item.once('done', (_event, state) => downloads.push(state)); });
      const view=()=>({version:1,message_id:id,channel:'portal',scene_id:'room',created_at:Math.floor(Date.now()/1000),delivery_status:delivery,
        parts:[{type:'text',text:'请分析附件'},...files.map(f=>({type:'attachment',attachment_id:f.id,name:f.filename,mime:f.mime,size:f.size,parse_status:done?'ready':'parsing',job_id:'job_'+f.id,parse_result_id:done?'result_'+f.id:null,progress:{stage:done?'complete':'assembling',completed:1,total:1}}))]});
      const proxy=new ChatProxy(()=>connection,async(url,init={})=>{
        const u=new URL(url), p=u.pathname;
        if(u.hostname==='fixture.oss-cn-shanghai.aliyuncs.com'){
          // Exercise Electron's real network transport with the disk-backed Blob.
          return (init.body instanceof ReadableStream ? fetch(objectOrigin+p,init) : net.fetch(objectOrigin+p,init)).catch(error=>{require('node:fs').writeFileSync('/tmp/town-upload-error.log',error.message);throw error;});
        }
        if(p==='/api/attachments/uploads'){
          const metadata=JSON.parse(init.body), f={...metadata,id:'att_'+(files.length+1)};files.push(f);
          return Response.json({attachment:{attachment_id:f.id},upload:{url:'https://fixture.oss-cn-shanghai.aliyuncs.com/'+f.id,method:'PUT',headers:{'Content-Type':f.mime}}});
        }
        if(p.endsWith('/complete'))return Response.json({attachment_id:p.split('/')[3],status:'ready'});
        if(p.endsWith('/parse'))return Response.json({job_id:'job_'+p.split('/')[3],attachment_id:p.split('/')[3],status:'pending'});
        if(p.startsWith('/api/media-jobs/')){const job=p.split('/').at(-1),att=job.slice(4);return Response.json({job_id:job,attachment_id:att,status:failed?'failed':done?'succeeded':'running',error_code:failed?'FIXTURE_PARSE_FAILED':undefined,result_id:done?'result_'+att:null,progress:{stage:'assembling',completed:1,total:1}});}
        if(p.endsWith('/parsed')){const att=p.split('/')[3];return Response.json({attachment_id:att,parse_result_id:'result_'+att,complete:true,total_segments:1,segments:[{text:'合成测试解析内容',location:{page:1}}],next_cursor:null,artifacts:[]});}
        if(p.endsWith('/content')){const f=files.find(f=>f.id===p.split('/')[3]);return Response.json({filename:f.filename,mime:f.mime,size:f.size,checksum:f.sha256,download:{url:'https://fixture.oss-cn-shanghai.aliyuncs.com/'+f.id,method:'GET',headers:{}}});}
        if(p==='/api/attachment-messages'&&init.method!=='POST')return Response.json({messages:created&&delivery!=='accepted'?[view()]:[],next_cursor:null});
        if(p.startsWith('/api/attachment-messages')){created=true;if(init.method==='POST'){const b=JSON.parse(init.body);if(b.delivery_status)delivery=b.delivery_status;}return Response.json(view());}
        if(p.endsWith('/api/history'))return Response.json({messages:history});
        if(p.endsWith('/api/stream/active'))return new Response(null,{status:204});
        if(p.endsWith('/api/chat/stream')){const b=JSON.parse(init.body);sends.push(b);history.push({seq:1,role:'user',content:b.message,scene_id:'room',at:new Date().toISOString()});return Response.json({}, {status:202});}
        if(p.endsWith('/health'))return new Response('OK');
        return Response.json({name:'Alice',being_id:'alice',sbs_enabled:false});
      },scene);
      const localDownloads=new AttachmentDownloads(${JSON.stringify(path.join(directory,'profile'))},async()=>{downloads.push('choose');return ${JSON.stringify(directory)};},async file=>{downloads.push('open');return '';},file=>downloads.push('reveal'));
      registerLocalProtocol(${JSON.stringify(path.resolve('desktop/generated'))},proxy,undefined,localDownloads);
      const window=new BrowserWindow({width:1100,height:1000,show:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
      window.webContents.on('will-navigate', event => event.preventDefault());
      window.webContents.on('will-frame-navigate', event => event.preventDefault());
      await window.loadURL('beings://chat/?scene_id=room&scene_label='+encodeURIComponent('附件测试')+'&history_scope='+encodeURIComponent(connection.endpoint));
    });
  `},bundle:true,platform:'node',external:['electron'],outfile:path.join(directory,'main.cjs')});
  application=await electron.launch({args:[path.join(directory,'main.cjs')]});
  const page=await application.firstWindow(); page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.locator('#input').waitFor();
  await page.waitForFunction(()=>performance.getEntriesByName('loom:ready').length>0);
  // Select actual files, as the OS picker does. Transferring an 11 MiB base64
  // buffer through the automation protocol can time out on Intel CI runners.
  const sampleFile=path.join(directory,'sample.txt'), imageFile=path.join(directory,'pixel.png');
  await writeFile(sampleFile,Buffer.alloc(11 * 1024 * 1024, 'x'));
  await writeFile(imageFile,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6b0sAAAAASUVORK5CYII=','base64'));
  await page.getByRole('button',{name:'添加附件和工具'}).click();
  const choosing=page.waitForEvent('filechooser');
  await page.getByRole('menuitem',{name:/上传附件/}).click();
  await (await choosing).setFiles([sampleFile,imageFile]);
  await page.locator('#input').fill('请分析附件');await page.locator('#send-btn').click();
  const pending = page.getByRole('group',{name:/待发送消息/});
  await pending.getByRole('status').filter({hasText:'正在整理完整结果'}).waitFor();
  const pendingRow = pending.locator('.composer-queue-item').first();
  assert.equal(await pendingRow.getAttribute('data-queue-phase'),'preparing');
  assert.equal(await pendingRow.locator('.composer-queue-drag-handle').count(),0);
  assert.deepEqual(await pendingRow.locator('.composer-queue-row-actions button').evaluateAll(buttons =>
    buttons.map(button=>button.getAttribute('aria-label'))),['取消排队：请分析附件']);
  assert.equal(await page.locator('.message.user').count(),0,'Pending attachments belong to the queue');
  await pending.getByRole('button',{name:/预览待发消息/}).click();
  const preview = page.getByRole('dialog',{name:'待发消息预览'});
  await preview.getByRole('list',{name:'待发附件'}).getByText('sample.txt',{exact:true}).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await application.evaluate(()=>globalThis.fixture.sends.length),0);
  await page.reload();
  await pending.getByRole('button',{name:/预览待发消息/}).waitFor();
  assert.equal(await page.locator('.message.user').count(),0);
  assert.equal(await application.evaluate(()=>globalThis.fixture.files.length),2,'restart reuses uploaded files');
  await application.evaluate(()=>globalThis.fixture.fail());
  const retry = pendingRow.getByRole('button',{name:'重试附件处理',exact:true});
  await retry.waitFor();
  assert.equal(await pendingRow.getAttribute('data-queue-phase'),'failed');
  assert.equal(await pendingRow.locator('.composer-queue-drag-handle').count(),0);
  assert.deepEqual(await pendingRow.locator('.composer-queue-row-actions button').evaluateAll(buttons =>
    buttons.map(button=>button.getAttribute('aria-label'))),['重试附件处理','取消排队：请分析附件']);
  await application.evaluate(()=>globalThis.fixture.finish());
  await retry.click();
  await page.locator('.attachment-cancel').waitFor({state:'detached'});
  await page.locator('.attachment-file-main').first().waitFor();
  await pending.waitFor({state:'hidden'});
  const sentFile = page.locator('.attachment-file-card').first();
  const fileBox = await sentFile.boundingBox();
  assert.equal(fileBox.width,156);
  assert.equal(await sentFile.locator('.attachment-filename span').last().innerText(),'.txt');
  await application.evaluate(async () => {
    const deadline = Date.now() + 15000;
    while (!globalThis.fixture.sends.length) {
      if (Date.now() >= deadline) throw new Error('Parsed attachment message was not delivered');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  });
  assert.equal(await application.evaluate(()=>globalThis.fixture.sends.length),1);
  assert.equal(await application.evaluate(()=>globalThis.fixture.sends[0].attachments),undefined);
  await page.reload();
  await page.locator('.attachment-cancel').waitFor({state:'detached'});
  await page.locator('.attachment-file-main').first().waitFor();
  assert.equal(await page.locator('.message.user').count(),1);
  await page.locator('.attachment-card-host').nth(1).scrollIntoViewIfNeeded();
  await page.getByRole('button',{name:'预览 pixel.png',exact:true}).waitFor();
  const names=await page.locator('.attachment-card-host > section').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label')));
  assert.deepEqual(names,['sample.txt','pixel.png']);
  await page.waitForFunction(()=>document.querySelector('.attachment-image-thumbnail img')?.naturalWidth > 0);
  const fileMenuTrigger = page.getByRole('button',{name:'sample.txt 文件操作',exact:true});
  const fileMenu = page.getByRole('menu',{name:'sample.txt 文件操作',exact:true});
  async function openFileMenu() {
    await page.locator('.attachment-file-main').hover();
    await fileMenuTrigger.click();
    await fileMenu.waitFor();
  }
  await openFileMenu();
  await fileMenu.getByRole('menuitem',{name:'查看解析内容',exact:true}).click();
  await page.getByText('合成测试解析内容',{exact:true}).waitFor();
  await page.keyboard.press('Escape');
  await fileMenu.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'下载 sample.txt',exact:true}).click();
  await page.getByRole('progressbar',{name:'sample.txt 下载进度'}).waitFor();
  await page.getByRole('button',{name:'预览 sample.txt',exact:true}).waitFor();
  assert.deepEqual(await application.evaluate(()=>globalThis.fixture.downloads),['choose']);
  const filename=(await readdir(directory)).find(name=>/^sample-.*\.txt$/.test(name));
  const downloadedBytes = await readFile(path.join(directory,filename));
  assert.equal(downloadedBytes.length,11 * 1024 * 1024);
  assert.ok(downloadedBytes.equals(Buffer.alloc(downloadedBytes.length,'x')));
  await openFileMenu();
  await fileMenu.getByRole('menuitem',{name:'用系统应用打开',exact:true}).click();
  await fileMenu.getByRole('menuitem',{name:'打开所在位置',exact:true}).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'预览 pixel.png',exact:true}).click();
  const imageDialog=page.getByRole('dialog',{name:'图片预览：pixel.png'});
  await imageDialog.getByRole('button',{name:'下载原图',exact:true}).click();
  await imageDialog.getByRole('button',{name:'打开',exact:true}).waitFor();
  assert.deepEqual(await application.evaluate(()=>globalThis.fixture.downloads),['choose','open','reveal']);
  await page.reload();await page.getByRole('button',{name:'预览 pixel.png',exact:true}).click();
  await imageDialog.getByRole('button',{name:'打开',exact:true}).waitFor();
  await imageDialog.getByRole('button',{name:'关闭图片预览'}).click();
  await writeFile(path.join(directory,filename),'modified');
  await openFileMenu();
  await fileMenu.getByRole('menuitem',{name:'用系统应用打开',exact:true}).click();
  await page.getByRole('button',{name:'下载 sample.txt',exact:true}).waitFor();
  await page.locator('#messages').evaluate(el => {el.scrollTop = 0;});
  await mkdir('test-results/attachments',{recursive:true});
  await page.screenshot({path:'test-results/attachments/desktop-attachments.png',fullPage:true});
  assert.deepEqual(errors,[]); console.log('PASS Electron attachment upload, slow parse/reload recovery, ordered echo, image preview, parsed detail and accepted history');
} finally {await application?.close();await rm(directory,{recursive:true,force:true});}
