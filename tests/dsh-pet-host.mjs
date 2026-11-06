// Integration test against the published, unmodified dsh-pet package.
// DSH_PET_SOURCE may point at the 0.4.1 npm tarball for an offline/cached run.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
// This HTTP-only test disables the fixture's own GUI launcher; desktop acceptance runs separately.
process.env.DSH_PET_IN_PROCESS = '1';
const temp = await mkdtemp(path.join(os.tmpdir(), 'town-pet-host-'));
await build({entryPoints:['desktop/main/plugins/dsh/manager.ts'],outfile:path.join(temp,'manager.cjs'),bundle:true,platform:'node',format:'cjs'});
await build({entryPoints:['desktop/main/plugins/dsh/worker.ts'],outfile:path.join(temp,'host.cjs'),bundle:true,platform:'node',format:'cjs',banner:{js:"const __townModuleURL = require('node:url').pathToFileURL(__filename).href;"},define:{'import.meta.url':'__townModuleURL'}});
const { DshPluginManager } = await import(pathToFileURL(path.join(temp,'manager.cjs')).href);
let manager = new DshPluginManager(temp, path.join(temp,'host.cjs'),path.resolve('node_modules/npm/bin/npm-cli.js'),'beings://desktop', path.resolve('resources/node-bin'));
await build({entryPoints:['desktop/main/plugins/dsh/subagent-model.ts'],outfile:path.join(temp,'subagent.cjs'),bundle:true,platform:'node',format:'cjs'});
const { resolveSubagentModel } = await import(pathToFileURL(path.join(temp,'subagent.cjs')).href);
const resolveModel = () => resolveSubagentModel(temp,{},{});
manager.resolveModel = resolveModel;
const legacy = Buffer.from('unused legacy plugin credentials');
await writeFile(path.join(temp,'services.enc'),legacy);
let requestBody, modelStatus = 200;
const model = createServer(async (req,res) => {
  const chunks=[]; for await (const chunk of req) chunks.push(chunk);
  assert.equal(req.headers.authorization,'Bearer fixture-key');
  if (req.url === '/v1/chat/completions') {
    requestBody=JSON.parse(Buffer.concat(chunks));
    if (modelStatus !== 200) { res.writeHead(modelStatus,{'content-type':'application/json'}); res.end(JSON.stringify({error:{message:'fixture failure'}})); return; }
    res.writeHead(200,{'content-type':'text/event-stream'});
    res.end('data: '+JSON.stringify({choices:[{delta:{content:'本地接口测试回复'}}]})+'\n\ndata: [DONE]\n\n');
  } else res.writeHead(404).end();
});
await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
const request = (route, method='GET', body) => manager.resource(new Request('beings://desktop'+route, {method,...(body === undefined ? {} : {headers:{'content-type':'application/json'},body:JSON.stringify(body)})}));
const json = async (route, method, body) => (await request(route,method,body)).json();
const rpc = (method,args=[]) => json('/@town-dsh/rpc','POST',{service:'commands',method,args});
try {
  await manager.initialize();
  const prepared = await manager.prepare(process.env.DSH_PET_SOURCE || 'dsh-pet@0.4.1');
  await manager.install(prepared.entry);
  assert.equal(manager.state().plugins[0].status,'active');
  assert.ok(manager.state().plugins[0].limitations.some(text=>text.includes('模型')));
  assert.ok(manager.state().clients.some(client=>client.id==='dsh-pet'));
  assert.deepEqual((await rpc('list')).value.map(c=>c.name).sort(),['balance','chat','pet']);
  const config = await json('/dsh-pet-7340/config');
  config.main.pets[0].name = 'Town 测试宠物';
  config.main.pets[0].display = 'web';
  config.main.pets[0].whisperEnabled = false;
  const saved = await json('/dsh-pet-7340/config','PUT',config.main);
  assert.equal(saved.main.pets[0].name,'Town 测试宠物');
  const selected = await rpc('execute',['','/pet Town 测试宠物',[]]);
  assert.equal(selected.value.kind,'success');
  assert.match(selected.value.text,/Town 测试宠物/);
  const models = await json('/dsh-pet-7340/models');
  assert.deepEqual(models.providers,[]);
  const memeName = '吃白饭的大肥鱼';
  const memeRoute = '/dsh-pet-7340/whisper?pet=main&surface=web&image='+encodeURIComponent(memeName);
  const beforeMissingModel = (await json('/dsh-pet-7340/state')).pets.main?.say;
  const missingModel = await json(memeRoute,'POST');
  assert.equal(missingModel.ok,false);
  assert.equal(missingModel.reason,'provider-missing');
  assert.deepEqual((await json('/dsh-pet-7340/state')).pets.main?.say,beforeMissingModel,'selecting a meme without a model must not publish a successful bubble');
  await writeFile(path.join(temp,'subagent-portal.toml'), `[subagent]
enabled = true
[subagent.model]
provider = "portal-custom"
model = "fixture-model"
api = "openai-completions"
base_url = "http://127.0.0.1:${model.address().port}/v1"
api_key = "fixture-key"
`);
  await manager.refreshModelCompatibility();
  assert.equal(manager.state().modelCompatibility.supported,true);
  assert.equal(JSON.stringify(manager.state()).includes('fixture-key'),false);
  const memeReply = await json(memeRoute,'POST');
  assert.equal(memeReply.ok,true,JSON.stringify(memeReply));
  assert.equal(memeReply.image,memeName);
  assert.equal(memeReply.text,'本地接口测试回复');
  assert.ok(requestBody.messages.some(message=>JSON.stringify(message.content).includes(memeName)),'selected meme must reach the model prompt');
  const memeState = (await json('/dsh-pet-7340/state')).pets.main.say;
  assert.equal(memeState.data.image,memeName);
  assert.equal(memeState.data.text,memeReply.text);
  const memeAsset = await request('/dsh-pet-7340/pic/memes/main/'+encodeURIComponent(memeName)+'.png');
  assert.equal(memeAsset.status,200);
  assert.equal(memeAsset.headers.get('content-type'),'image/png');
  assert.ok((await memeAsset.arrayBuffer()).byteLength > 0);
  modelStatus = 503;
  const failedMeme = await json(memeRoute,'POST');
  assert.equal(failedMeme.ok,false);
  assert.equal(failedMeme.reason,'generate-error');
  assert.match(failedMeme.message,/503/);
  assert.deepEqual((await json('/dsh-pet-7340/state')).pets.main.say,memeState,'failed meme generation must not overwrite the previous bubble');
  modelStatus = 200;
  const chatted = await json('/dsh-pet-7340/chat?pet=main&surface=web','POST',{text:'本地协议验证',attachment:{mediaType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9t8AAAAASUVORK5CYII='}});
  assert.equal(chatted.ok,true,JSON.stringify(chatted));
  assert.match(JSON.stringify(chatted),/本地接口测试回复/);
  assert.equal(requestBody.model,'fixture-model');
  assert.ok(requestBody.messages.some(message=>Array.isArray(message.content) && message.content.some(block=>block.type==='image_url' && block.image_url.url.startsWith('data:image/png;base64,'))));
  const history = await json('/dsh-pet-7340/chat?pet=main');
  assert.ok(history.messages.some(message=>message.content.includes('本地协议验证')));
  const image = history.messages.find(message=>message.image)?.image;
  assert.match(image.attachmentId,/^sha256:[a-f0-9]{64}$/);
  const imageRoute = '/dsh-pet-7340/attachment?id='+encodeURIComponent(image.attachmentId);
  const imageResponse = await request(imageRoute);
  assert.equal(imageResponse.status,200,'original plugin must accept the host attachment ID');
  assert.equal(imageResponse.headers.get('content-type'),'image/png');
  const imageBytes = Buffer.from(await imageResponse.arrayBuffer());
  assert.equal(imageBytes.toString('base64'),'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9t8AAAAASUVORK5CYII=');
  modelStatus = 503;
  const failed = await json('/dsh-pet-7340/chat?pet=main&surface=web','POST',{text:'模拟失败'});
  assert.equal(failed.ok,false);
  assert.match(JSON.stringify(failed),/503/);
  assert.deepEqual((await json('/dsh-pet-7340/chat?pet=main')).messages,history.messages,'failed requests must not add a successful conversation round');
  modelStatus = 200;
  assert.equal((await json('/dsh-pet-7340/chat?pet=main&surface=web','POST',{text:'失败后恢复'})).ok,true);
  const sleeping = await json('/dsh-pet-7340/sleep?pet=main&surface=web','POST',{});
  assert.equal(sleeping.sleeping,true);
  assert.equal((await json('/dsh-pet-7340/sleep?pet=main&surface=web','POST',{})).changed,false);
  assert.equal((await json('/dsh-pet-7340/wake?pet=main&surface=web','POST',{})).sleeping,false);
  for (const display of ['none','desktop','both','web']) {
    const changed = await json('/dsh-pet-7340/pet-display','POST',{id:'main',display});
    assert.equal(changed.main.pets[0].display,display);
    assert.equal((await json('/dsh-pet-7340/config')).main.pets[0].display,display);
  }
  const heard = await json('/dsh-pet-7340/voice/hear','POST',{audio:Buffer.from('fixture-audio').toString('base64')});
  assert.equal(heard.ok,false,'Being/subagent configuration does not provide transcription');
  await json('/dsh-pet-7340/work-status','POST',{state:'working',task:'执行中'});
  const state = await json('/dsh-pet-7340/state');
  assert.match(JSON.stringify(state),/执行中/);
  assert.match(JSON.stringify(state),/working/);
  await request('/dsh-pet-7340/work-status','DELETE');
  const created = await json('/dsh-pet-7340/todos','POST',{text:'验证客户端待办',dueAt:null});
  assert.equal(created.ok,true);
  const completed = await json('/dsh-pet-7340/todos/'+created.todo.id,'PATCH',{done:true});
  assert.equal(completed.todo.done,true);
  const asset = await request('/dsh-pet-7340/logo');
  assert.equal(asset.status,200);
  assert.equal(asset.headers.get('content-type'),'image/png');
  assert.ok((await asset.arrayBuffer()).byteLength > 0);
  await manager.enable('dsh-pet',false);
  assert.equal(manager.matches('/dsh-pet-7340/config'),false);
  assert.deepEqual((await rpc('list')).value,[]);
  await manager.enable('dsh-pet',true);
  assert.equal(manager.state().plugins[0].status,'active');
  assert.equal((await json('/dsh-pet-7340/config')).main.pets[0].name,'Town 测试宠物');
  assert.equal((await rpc('list')).value.length,3);
  assert.ok((await json('/dsh-pet-7340/todos')).todos.some(todo=>todo.id===created.todo.id && todo.done));
  assert.ok((await json('/dsh-pet-7340/chat?pet=main')).messages.some(message=>message.content.includes('失败后恢复')),'history must survive worker restart');
  await manager.stop();
  manager = new DshPluginManager(temp, path.join(temp,'host.cjs'),path.resolve('node_modules/npm/bin/npm-cli.js'),'beings://desktop', path.resolve('resources/node-bin'));
  manager.resolveModel = resolveModel;
  await manager.initialize();
  assert.equal(manager.state().plugins[0].status,'active');
  assert.equal(manager.state().modelCompatibility.supported,true);
  assert.equal((await json('/dsh-pet-7340/chat?pet=main&surface=web','POST',{text:'冷启动恢复验证'})).ok,true);
  const restoredImage = await request(imageRoute);
  assert.equal(restoredImage.status,200);
  assert.deepEqual(Buffer.from(await restoredImage.arrayBuffer()),imageBytes,'history image must remain readable after cold restart');
  assert.equal((await json('/dsh-pet-7340/config')).main.pets[0].display,'web');
  assert.ok((await json('/dsh-pet-7340/todos')).todos.some(todo=>todo.id===created.todo.id && todo.done));
  // Refresh the existing subagent model without restarting plugins or reading legacy credentials.
  await writeFile(path.join(temp,'subagent-portal.toml'), `[subagent]
enabled = true
[subagent.model]
provider = "portal-custom"
model = "subagent-current"
api = "openai-completions"
base_url = "http://127.0.0.1:${model.address().port}/v1"
api_key = "fixture-key"
`);
  await manager.refreshModelCompatibility();
  assert.equal(manager.state().modelCompatibility.supported,true);
  assert.equal(JSON.stringify(manager.state()).includes('fixture-key'),false);
  const subagentMeme = await json(memeRoute,'POST');
  assert.equal(subagentMeme.ok,true,JSON.stringify(subagentMeme));
  assert.equal(requestBody.model,'subagent-current');
  assert.equal((await json('/dsh-pet-7340/state')).pets.main.say.data.image,memeName);
  assert.deepEqual(await readFile(path.join(temp,'services.enc')),legacy);
  let notice;
  manager.onModelNotice = message => {notice=message;};
  modelStatus = 401;
  const unauthorized = await json(memeRoute,'POST');
  assert.equal(unauthorized.ok,false);
  await new Promise(resolve=>setTimeout(resolve,50));
  assert.match(notice,/HTTP 401.*subagent.*API Key/);
  assert.equal((await json('/dsh-pet-7340/state')).pets.main.say.data.text,subagentMeme.text);
  modelStatus = 200;
  notice = undefined;
  await new Promise(resolve=>setTimeout(resolve,2100));
  await writeFile(path.join(temp,'subagent-portal.toml'),'[subagent]\nenabled = false\n');
  await manager.refreshModelCompatibility();
  assert.equal(manager.state().modelCompatibility.supported,false);
  const unavailable=await json(memeRoute,'POST');
  assert.equal(unavailable.ok,false);
  await new Promise(resolve=>setTimeout(resolve,50));
  assert.match(notice,/已停用/);
  assert.equal((await json('/dsh-pet-7340/config')).main.pets[0].name,'Town 测试宠物');
  console.log('PASS original pet uses existing subagent model for selected meme; disabling updates live capabilities and emits visible notice without changing legacy credentials');
  console.log('PASS original dsh-pet: installation, client discovery, commands, config persistence, subagent model refresh, text/image generation, attachment retrieval before/after cold restart, failure/recovery, history, sleep/wake, four display modes, unsupported transcription, work state, disable/re-enable and cold restart');
} finally { await manager.stop(); model.closeAllConnections(); await new Promise(resolve=>model.close(resolve)); await rm(temp,{recursive:true,force:true}); }
