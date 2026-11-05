import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const assets = new Map(await Promise.all(['loom.html','chat.js','chat.css','highlight.css','iui-runtime.html'].map(async f=>['/'+f,await readFile('desktop/generated/'+f)])));
const ui = records => '```intelligent-ui\n'+records.map(r=>JSON.stringify(r)).join('\n')+'\n```';
const history = [{seq:1,role:'being',scene_id:'surface-test',content:ui([
  {op:'begin',version:2,surfaceId:'wardrobe',title:'一周衣橱'},
  {op:'state',key:'temp',initial:20},
  {op:'node',node:{id:'root',type:'section',label:'本周搭配'}},
  {op:'node',parent:'root',node:{id:'temp',type:'slider',label:'温度',bind:'temp',min:18,max:34}},
  {op:'node',parent:'root',node:{id:'advice',type:'text',value:'初始建议'}},
  {op:'commit'},
])}];
const sends=[];
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
  if(assets.has(url.pathname)){res.setHeader('Content-Type',url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':'text/html; charset=utf-8');return res.end(assets.get(url.pathname));}
  if(url.pathname==='/health')return res.end('OK fixture');
  if(url.pathname==='/api/history')return json({messages:history.filter(m=>m.seq>Number(url.searchParams.get('after')||0))});
  if(url.pathname==='/api/stream/active'){res.writeHead(204);return res.end();}
  if(url.pathname==='/api/chat/stream'){
    let body='';for await(const chunk of req)body+=chunk;
    const send=JSON.parse(body);sends.push(send);
    if (send.message.includes('请修正未成功保存的界面「wonton-2026-10-27」')) {
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      return res.end('event: content_block_delta\ndata: {"delta":{"text":"已接收修正请求"}}\n\nevent: message_stop\ndata: {}\n\n');
    }
    const match=send.message.match(/\[客户端当前界面选择\]\n(.*?)\n\[\/客户端当前界面选择\]/s);
    assert.ok(match, 'Missing UI context for fixture send ' + sends.length + ': ' + send.message.slice(0,100));
    const action=JSON.parse(match[1]);
    history.push({seq:history.length+1,role:'user',scene_id:'surface-test',content:send.message});
    const content=ui([
      {op:'begin',version:2,surfaceId:action.surfaceId,title:action.title,mode:'patch',baseRevision:action.revision},
      {op:'node',node:{id:'advice',type:'text',value:'按当前选择调整后的建议'}},
      {op:'commit'},
    ]);
    history.push({seq:history.length+1,role:'being',scene_id:'surface-test',content});
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.end(`event: content_block_delta\ndata: ${JSON.stringify({delta:{text:content}})}\n\nevent: message_stop\ndata: {}\n\n`);return;
  }
  json({sbs_enabled:false,being_name:'Fixture',presets:[]});
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage();page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const url=`http://127.0.0.1:${server.address().port}/loom.html?scene_id=surface-test&scene_strict=1`;
  await page.goto(url);
  await page.getByRole('slider',{name:'温度'}).fill('28');
  assert.equal(await page.getByRole('button',{name:'用当前选择继续',exact:true}).count(),1);
  await page.getByRole('textbox',{name:'message input'}).fill('按当前选择调整');
  await page.getByRole('button',{name:'用当前选择继续',exact:true}).click();
  assert.equal(sends.length,0,'Edit must not send automatically');
  assert.equal(await page.locator('.iui-action-status, .iui-continue p').count(),0);
  const bringSelection = page.getByRole('button',{name:'用当前选择继续',exact:true});
  await bringSelection.hover();
  const colors = await bringSelection.evaluate(el => ({fg:getComputedStyle(el).color,bg:getComputedStyle(el).backgroundColor}));
  assert.notEqual(colors.fg, colors.bg);
  assert.equal(colors.bg, await bringSelection.evaluate(el => {const probe=document.createElement('span');probe.style.color='var(--text)';el.append(probe);const color=getComputedStyle(probe).color;probe.remove();return color;}));
  assert.equal(await page.getByRole('textbox',{name:'message input'}).evaluate(el=>el.value??el.editor.getMarkdown()),'按当前选择调整');
  await page.waitForFunction(()=>document.activeElement?.matches('#input, #input [contenteditable], [role=textbox][contenteditable]'));
  await page.locator('.iui-context-target').getByText('将携带原界面和当前选择').waitFor();
  assert.equal(await page.getByRole('button',{name:'添加附件和工具',exact:true}).getAttribute('data-active'),'true');
  await page.getByRole('button',{name:'取消本条界面修改',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'添加附件和工具',exact:true}).getAttribute('data-active'),'false');
  await page.getByRole('button',{name:'用当前选择继续',exact:true}).click();
  await page.locator('#send-btn').click();
  await page.getByText('按当前选择调整后的建议',{exact:true}).waitFor();
  assert.equal(await page.locator('.intelligent-ui').count(),1,'Update must reuse the original UI');
  assert.equal(await page.getByRole('slider',{name:'温度'}).inputValue(),'28');
  assert.equal(await page.getByRole('textbox',{name:'message input'}).evaluate(el=>el.value??el.editor.getMarkdown()),'');
  assert.equal(sends.length,1);
  assert.ok(sends[0].message.includes('"surfaceId":"wardrobe"'));
  assert.ok(sends[0].message.includes('"temp":28'));
  const original=JSON.parse(sends[0].message.match(/\[客户端当前界面选择\]\n(.*?)\n\[\/客户端当前界面选择\]/s)[1]);
  assert.equal(original.revision,1);
  assert.ok(original.document.body[0].children.some(node=>node.type==='slider' && node.bind==='temp'),'Edit includes original component structure');
  assert.equal(await page.locator('.iui-context-target').count(),0,'Context clears after this send');
  assert.equal(await page.getByRole('button',{name:'添加附件和工具',exact:true}).getAttribute('data-active'),'false');

  assert.equal(await page.locator('.message.user').filter({hasText:'客户端当前界面选择'}).count(),0);
  await page.getByLabel('界面版本').selectOption('1');
  await page.getByText('初始建议',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'修改',exact:true}).count(),0,'Historical preview cannot become edit target');
  assert.equal(await page.getByRole('button',{name:'用当前选择继续',exact:true}).isDisabled(),true);
  await page.getByRole('slider',{name:'温度'}).fill('19');
  await page.getByLabel('界面版本').selectOption('latest');
  await page.waitForFunction(()=>document.querySelector('input[type=range]')?.value==='28');
  await page.reload();
  await page.getByText('按当前选择调整后的建议',{exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('input[type=range]')?.value==='28');
  assert.equal(await page.locator('.intelligent-ui').count(),1);
  await page.getByLabel('界面版本').selectOption('1');
  await page.getByText('初始建议',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'修改',exact:true}).count(),0,'Historical preview cannot become edit target');
  await page.getByLabel('界面版本').selectOption('latest');
  await page.setViewportSize({width:375,height:800});
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/intelligent-ui-surfaces.png',fullPage:true});
  // An isolated app and outer inputs submit together through an explicitly opted-in chat message.
  const appCode = `let choice=1,ticks=0;function render(){ui.render({version:1,title:'模拟',state:{choice,ticks},body:[{id:'tick',type:'metric',label:'后台帧',value:ticks},{id:'choice',type:'number',label:'模拟人数',bind:'choice',min:1,max:10}]});}ui.onEvent(e=>{choice=Number(e.value);ui.save({choice});render();});ui.onTick(()=>{ticks++;render();});render();`;
  history.push({seq:history.length+1,role:'being',scene_id:'surface-test',content:ui([
    {op:'begin',version:2,surfaceId:'app-demo',title:'带模拟的计划'},
    {op:'state',key:'budget',initial:10},
    {op:'node',node:{id:'budget',type:'number',label:'预算',bind:'budget',min:0,max:100}},
    {op:'node',node:{id:'simulation',type:'app',code:appCode}}, {op:'commit'},
  ])});
  await page.reload();
  const appSurface=page.locator('.iui-surface').filter({has:page.getByRole('heading',{name:'带模拟的计划',exact:true})});
  await appSurface.getByRole('spinbutton',{name:'预算',exact:true}).fill('12');
  await appSurface.getByRole('spinbutton',{name:'模拟人数',exact:true}).fill('4');
  await page.waitForFunction(()=>document.querySelector('.iui-app input[type=number]')?.value==='4');
  assert.equal(await appSurface.getByRole('button',{name:'用当前选择继续',exact:true}).count(),1);
  await page.getByRole('textbox',{name:'message input'}).fill('调整模拟计划');
  await page.getByRole('button',{name:'添加附件和工具'}).click();
  await page.getByRole('menuitem',{name:/智能 UI/}).click();
  await page.locator('#send-btn').click();
  await appSurface.getByText('按当前选择调整后的建议',{exact:true}).waitFor();
  const appAction=JSON.parse(sends.at(-1).message.match(/\[客户端当前界面选择\]\n(.*?)\n\[\/客户端当前界面选择\]/s)[1]);
  assert.equal(appAction.values.budget,12);
  assert.equal(appAction.apps.simulation.values.choice,4);
  // A passive Worker render must not steal the artifact selected by the user.
  await page.getByRole('slider',{name:'温度'}).fill('29');
  await appSurface.scrollIntoViewIfNeeded();
  const ticks = Number(await appSurface.locator('.iui-metric output').textContent());
  await page.waitForFunction(ticks=>Number(document.querySelector('.iui-app .iui-metric output')?.textContent)>ticks,ticks);
  await page.getByRole('textbox',{name:'message input'}).fill('调整衣橱而不是模拟');
  await page.locator('.iui-surface').filter({has:page.getByRole('slider',{name:'温度'})}).getByRole('button',{name:'修改',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'添加附件和工具',exact:true}).getAttribute('data-active'),'true','Edit must arm next message for existing artifact');
  await page.waitForFunction(()=>document.activeElement?.matches('#input, #input [contenteditable], [role=textbox][contenteditable]'));
  await page.locator('#send-btn').click();
  await page.waitForFunction(()=>document.querySelector('select[aria-label="界面版本"] option')?.textContent.includes('第 3 版'));
  const selected=JSON.parse(sends.at(-1).message.match(/\[客户端当前界面选择\]\n(.*?)\n\[\/客户端当前界面选择\]/s)[1]);
  assert.equal(selected.surfaceId,'wardrobe');assert.equal(selected.values.temp,29);
  // Generated continue buttons, including those inside apps, select their source and preserve the draft.
  const continueApp = `let choice=1;function render(){ui.render({version:1,title:'继续模拟',state:{choice},body:[{id:'choice',type:'number',label:'继续模拟人数',bind:'choice',min:1,max:10},{id:'next',type:'button',label:'继续模拟计划',action:'continue',value:'细化模拟'}]});}ui.onEvent(e=>{choice=Number(e.value);render();});render();`;
  history.push({seq:history.length+1,role:'being',scene_id:'surface-test',content:ui([
    {op:'begin',version:2,surfaceId:'continue-demo',title:'继续操作计划'},
    {op:'state',key:'budget',initial:10},
    {op:'node',node:{id:'budget',type:'number',label:'继续预算',bind:'budget',min:0,max:100}},
    {op:'node',node:{id:'simulation',type:'app',code:continueApp}},
    {op:'node',node:{id:'next',type:'button',label:'继续外层计划',action:'continue',value:'细化外层'}},
    {op:'commit'},
  ])});
  await page.reload();
  const continueSurface=page.locator('.iui-surface').filter({has:page.getByRole('heading',{name:'继续操作计划',exact:true})});
  const composer=page.getByRole('textbox',{name:'message input'});
  await continueSurface.getByRole('spinbutton',{name:'继续预算',exact:true}).fill('23');
  await continueSurface.getByRole('spinbutton',{name:'继续模拟人数',exact:true}).fill('6');
  await page.waitForFunction(()=>[...document.querySelectorAll('.iui-app input[type=number]')].some(el=>el.value==='6'));
  for (const [index, [button, description]] of [['继续外层计划','细化外层'],['继续模拟计划','细化模拟']].entries()) {
    // Deliberately select another artifact first to catch stale context reuse.
    await page.locator('.iui-surface').filter({has:page.getByRole('slider',{name:'温度'})}).getByRole('button',{name:'修改',exact:true}).click();
    await page.getByRole('button',{name:'取消本条界面修改',exact:true}).click();
    await composer.fill('保留已有要求');
    const before=sends.length;
    await continueSurface.getByRole('button',{name:'展开界面',exact:true}).click();
    await continueSurface.getByRole('button',{name:button,exact:true}).click();
    assert.equal(sends.length,before,'Continue must wait for user submission');
    assert.equal(await page.getByRole('dialog',{name:'继续操作计划',exact:true}).count(),0);
    await page.waitForFunction(()=>document.activeElement?.matches('#input, #input [contenteditable], [role=textbox][contenteditable]'));
    const draft=await composer.evaluate(el=>el.value??el.editor.getMarkdown());
    assert.ok(draft.startsWith('保留已有要求\n\n'+description),draft);
    assert.equal(await page.getByRole('button',{name:'添加附件和工具',exact:true}).getAttribute('data-active'),'true');
    await page.locator('.iui-context-target').getByText('修改「继续操作计划」').waitFor();
    await page.locator('#send-btn').click();
    await page.waitForFunction(revision=>[...document.querySelectorAll('select[aria-label="界面版本"]')].some(el=>el.closest('.iui-surface')?.textContent.includes('继续操作计划') && el.options[0].textContent.includes(`第 ${revision} 版`)),index+2);
    const action=JSON.parse(sends.at(-1).message.match(/\[客户端当前界面选择\]\n(.*?)\n\[\/客户端当前界面选择\]/s)[1]);
    assert.equal(action.surfaceId,'continue-demo');
    assert.equal(action.revision,index+1);
    assert.equal(action.values.budget,23);
    assert.equal(action.apps.simulation.values.choice,6);
  }
  await continueSurface.getByRole('combobox',{name:'界面版本'}).selectOption('1');
  assert.equal(await continueSurface.getByRole('button',{name:'继续外层计划',exact:true}).isDisabled(),true);
  assert.equal(await continueSurface.getByRole('button',{name:'继续模拟计划',exact:true}).isDisabled(),true);
  // A failed first commit has no saved revision, but its repair action must still work.
  const wonton = await readFile(new URL('./fixtures/intelligent-ui-wonton-invalid.jsonl', import.meta.url), 'utf8');
  history.push({seq:history.length+1,role:'being',scene_id:'surface-test',content:'```intelligent-ui\n'+wonton+'\n```'});
  await page.reload();
  const failedSurface = page.locator('.iui-surface').filter({has:page.getByRole('heading',{name:'馄饨：从和馅到出锅',exact:true})});
  await failedSurface.getByRole('button',{name:'让 Being 修正',exact:true}).waitFor();
  assert.equal(await failedSurface.getByRole('button',{name:'按这份流程生成采购清单',exact:true}).isDisabled(),true);
  const beforeRepair = sends.length;
  await composer.fill('保留已有要求');
  await failedSurface.getByRole('button',{name:'展开界面',exact:true}).click();
  await failedSurface.getByRole('button',{name:'让 Being 修正',exact:true}).click();
  await page.waitForFunction(()=>document.activeElement?.matches('#input, #input [contenteditable], [role=textbox][contenteditable]'));
  assert.equal(await page.getByRole('dialog').count(),0,'Repair closes the expanded artifact so the draft is visible');
  const repairDraft = (await composer.evaluate(el=>el.value??el.editor.getMarkdown())).replace(/\\([\[\]])/g,'$1');
  assert.ok(repairDraft.startsWith('保留已有要求\n\n请修正未成功保存的界面「wonton-2026-10-27」'),repairDraft);
  for (const detail of ['fold-map','parts[0]','description','新的唯一 surfaceId','省略 baseRevision']) assert.ok(repairDraft.includes(detail),detail);
  assert.equal(sends.length,beforeRepair,'Repair prepares a draft rather than silently sending');
  await page.locator('#send-btn').click();
  await page.getByText('已接收修正请求',{exact:true}).waitFor();
  assert.equal(sends.length,beforeRepair+1);
  assert.ok(sends.at(-1).message.includes(repairDraft));
  assert.deepEqual(errors,[]);
  console.log('PASS: per-message UI context, in-place patch, input preservation, version preview, and history reload.');
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
