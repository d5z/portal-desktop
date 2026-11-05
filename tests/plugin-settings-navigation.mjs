// Real shared settings frame with isolated plugin/config-service fixtures.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';

const server=spawn(process.execPath,['tests/workspace-layout.mjs'],{env:{...process.env,PORTAL_LAYOUT_PREVIEW:'1',PORTAL_LAYOUT_PORT:'0'},stdio:['ignore','pipe','pipe']});
let browser;
try {
  const origin=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Preview startup timed out')),20000);
    let output='';
    server.stdout.on('data',data=>{output+=data;const match=output.match(/Layout preview: (http:\/\/127\.0\.0\.1:\d+)/);if(match){clearTimeout(timeout);resolve(match[1]);}});
    server.once('exit',code=>{clearTimeout(timeout);reject(new Error(`Preview exited: ${code}`));});
  });
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:860}});
  page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin);
  await page.evaluate(()=>{
    const runtime=window.fixtureDsh,app=window.fixtureApp;
    runtime.phase='ready';
    runtime.state={plugins:Array.from({length:14},(_,i)=>({id:`plugin-${i+1}`,version:'1.0.0',description:'插件配置与日常工具。',enabled:true,status:'active',source:'fixture',installedAt:'2026-11-05'})),clients:[],routes:[],injections:[]};
    const api={state:async()=>runtime.state};
    app.api.dshPlugins=api;window.beings={dshPlugins:api};
    const forms={};
    runtime.configurationViews=runtime.state.plugins.flatMap(plugin=>[plugin.id,plugin.id+'.advanced'].map(ns=>({ns,owner:plugin.id,autoGenerate:true,schema:{dict:{label:{type:'string',meta:{description:'显示名称'}},items:{type:'array',meta:{description:'条目'}}}}})));
    runtime.configForm=ns=>forms[ns]??=(function(){
      let snapshot={base:{},value:{label:ns,items:['original']},status:'ready',writable:true,revision:1};
      const listeners=new Set();
      return {subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener)},getSnapshot:()=>snapshot,mutate:async edits=>{snapshot={...snapshot,value:{...snapshot.value,...Object.fromEntries(edits.map(edit=>[edit.path[0],edit.value]))},revision:snapshot.revision+1};listeners.forEach(fn=>fn());return true}};
    })();
    runtime.refreshForms=async()=>{};
    app.plugins.library={plugins:[{manifest:{id:'official',name:'官方示例',version:'1.0.0',description:'管理官方插件的显示位置与权限。',author:'Town',capabilities:[],contributes:{views:[{id:'main',title:'打开官方页面'}],slots:[{id:'side',view:'main',location:'right-sidebar',title:'打开官方侧栏'}]}},enabled:true,source:{kind:'local',path:'/fixture'}}],problems:[]};
    app.plugins.changed();runtime.changed();app.changed();
  });
  const settings=page.locator('#client-settings-dialog');
  await page.evaluate(()=>fixtureApp.openClientSettings());
  await settings.getByRole('tab',{name:'插件',exact:true}).click();
  await page.locator('#settings-plugin-dsh').click();
  await settings.getByRole('button',{name:'配置 plugin-1',exact:true}).waitFor();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert(await page.locator('#client-main').evaluate(el=>el.inert));
  const bounds=await settings.boundingBox();
  // Unmodified community editors/previews mount alongside the application root.
  await page.evaluate(()=>{
    const overlay=document.createElement('div');overlay.id='plugin-preview-fixture';
    overlay.style.cssText='position:fixed;inset:0;z-index:10000;background:white';
    const button=document.createElement('button');button.textContent='关闭插件预览';
    button.onclick=()=>overlay.remove();overlay.append(button);document.body.append(overlay);
  });
  const previewClose=page.getByRole('button',{name:'关闭插件预览',exact:true});
  await previewClose.focus();
  assert(await previewClose.evaluate(el=>document.activeElement===el),'Plugin preview outside settings must receive focus');
  await previewClose.click();
  await settings.getByRole('button',{name:'关闭客户端设置',exact:true}).focus();
  await page.keyboard.press('Shift+Tab');
  assert(await page.evaluate(()=>document.activeElement.closest('#client-settings-dialog')),'Settings retain keyboard focus after preview closes');
  await page.evaluate(()=>{
    window.modalChanges=[];window.settingsNode=document.getElementById('client-settings-dialog');window.managerNode=document.getElementById('third-party-plugins');
    const observer=new MutationObserver(rows=>modalChanges.push(...rows.map(row=>row.attributeName)));
    observer.observe(settingsNode,{attributes:true,attributeFilter:['open']});
    window.settingsObserver=observer;
  });
  for(let i=0;i<3;i++){
    if(await settings.getByRole('button',{name:'返回插件列表',exact:true}).isVisible()) await settings.getByRole('button',{name:'返回插件列表',exact:true}).click();
    await page.locator('#settings-plugin-town').click();
    assert(await page.locator('#client-main').evaluate(el=>el.inert));
    await page.locator('#settings-plugin-dsh').click();
    assert(await page.evaluate(()=>managerNode===document.getElementById('third-party-plugins')),'Category changes retain the plugin manager');
  }
  assert.deepEqual(await page.evaluate(()=>modalChanges),[],'Changing plugin tabs must not close and reopen the modal');
  await settings.getByRole('tab',{name:'外观与阅读',exact:true}).click();
  await settings.getByRole('tab',{name:'插件',exact:true}).click();
  assert.deepEqual(await settings.boundingBox(),bounds);
  await page.getByRole('searchbox',{name:'搜索已安装插件'}).fill('plugin-1');
  await page.getByRole('button',{name:'配置 plugin-12',exact:true}).scrollIntoViewIfNeeded();
  const scroll=await page.locator('.settings-home-body').evaluate(el=>el.scrollTop);
  await page.getByRole('button',{name:'配置 plugin-12',exact:true}).click();
  await settings.locator('.settings-page-title').filter({hasText:'plugin-12'}).waitFor();
  await page.getByRole('textbox',{name:'显示名称'}).waitFor();
  await page.getByRole('button',{name:'plugin-12.advanced',exact:true}).click();
  assert.equal(await page.getByRole('textbox',{name:'显示名称'}).inputValue(),'plugin-12.advanced');
  await page.getByRole('button',{name:'plugin-12',exact:true}).click();
  assert.equal(await page.getByRole('textbox',{name:'显示名称'}).inputValue(),'plugin-12');
  assert.equal(await page.locator('.dsh-plugin-list').count(),0,'Details replace the list, not expand under it');
  assert.equal(await page.locator('.settings-home-body').evaluate(el=>el.scrollTop),0);
  assert.deepEqual(await settings.boundingBox(),bounds);
  await mkdir('output/playwright',{recursive:true});
  await page.screenshot({path:'output/playwright/plugin-subpage.png'});
  await page.getByRole('textbox',{name:'显示名称'}).fill('未保存的修改');
  await page.getByRole('button',{name:'返回插件列表',exact:true}).click();
  await page.getByRole('button',{name:'继续编辑',exact:true}).waitFor();
  assert.equal(await settings.locator('.settings-page-title').innerText(),'plugin-12');
  await page.getByRole('button',{name:'继续编辑',exact:true}).click();
  assert.equal(await page.getByRole('textbox',{name:'显示名称'}).inputValue(),'未保存的修改');
  await page.getByRole('button',{name:'返回插件列表',exact:true}).click();
  await page.getByRole('button',{name:'放弃更改',exact:true}).click();
  await page.getByRole('searchbox',{name:'搜索已安装插件'}).waitFor();
  assert.equal(await page.getByRole('searchbox',{name:'搜索已安装插件'}).inputValue(),'plugin-1');
  assert.equal(await page.locator('.settings-home-body').evaluate(el=>el.scrollTop),scroll,'Back restores list scroll');
  await page.getByRole('button',{name:'配置 plugin-1',exact:true}).click();
  assert.equal(await page.getByRole('textbox',{name:'显示名称'}).inputValue(),'plugin-1');
  await page.getByRole('textbox',{name:'显示名称'}).fill('已保存名称');
  await page.getByRole('button',{name:'保存配置',exact:true}).click();
  await page.getByRole('button',{name:'返回插件列表',exact:true}).click();
  await page.getByRole('button',{name:'配置 plugin-1',exact:true}).click();
  assert.equal(await page.getByRole('textbox',{name:'显示名称'}).inputValue(),'已保存名称');
  await page.getByRole('button',{name:'返回插件列表',exact:true}).click();
  await page.locator('#settings-plugin-town').click();
  await page.getByRole('button',{name:/官方示例/}).click();
  assert.equal(await settings.locator('.settings-page-title').innerText(),'官方示例');
  await page.getByRole('button',{name:'返回插件列表',exact:true}).click();
  await page.evaluate(()=>fixtureDsh.openPlugin('plugin-2'));
  await page.getByRole('textbox',{name:'显示名称'}).waitFor();
  assert.equal(await settings.locator('.settings-page-title').innerText(),'plugin-2');
  assert.equal(await page.getByRole('textbox',{name:'显示名称'}).inputValue(),'plugin-2');
  await page.getByRole('textbox',{name:'显示名称'}).fill('切换分类前的草稿');
  await page.getByRole('textbox',{name:'条目',exact:true}).fill('[invalid');
  await settings.getByRole('tab',{name:'通用',exact:true}).click();
  await page.getByRole('button',{name:'继续编辑',exact:true}).click();
  assert.equal(await page.getByRole('textbox',{name:'显示名称'}).inputValue(),'切换分类前的草稿');
  await settings.getByRole('tab',{name:'通用',exact:true}).click();
  await page.getByRole('button',{name:'放弃更改',exact:true}).click();
  await settings.getByRole('tab',{name:'插件',exact:true}).click();
  assert.equal(await page.getByRole('textbox',{name:'显示名称'}).inputValue(),'plugin-2','Discard must reset the retained form');
  assert.deepEqual(JSON.parse(await page.getByRole('textbox',{name:'条目',exact:true}).inputValue()),['original']);
  assert.equal(await page.getByRole('button',{name:'保存配置',exact:true}).isDisabled(),true);
  assert.equal(await page.locator('.dsh-config-form [role="alert"]').count(),0,'Discard clears invalid JSON and errors');
  await page.getByRole('textbox',{name:'显示名称'}).fill('重新编辑');
  await page.getByRole('button',{name:'关闭客户端设置',exact:true}).click();
  await page.getByRole('button',{name:'继续编辑',exact:true}).click();
  assert.equal(await page.getByRole('textbox',{name:'显示名称'}).inputValue(),'重新编辑','New edits must still trigger the dirty guard');
  await settings.getByRole('tab',{name:'通用',exact:true}).click();
  await page.getByRole('button',{name:'放弃更改',exact:true}).click();
  await settings.getByRole('tab',{name:'插件',exact:true}).click();
  for(const width of [760,435]){
    await page.setViewportSize({width,height:746});
    assert.equal(await settings.evaluate(el=>el.scrollWidth>el.clientWidth),false);
    const back=await page.getByRole('button',{name:'返回插件列表',exact:true}).boundingBox();
    assert(back.y>=0&&back.y+back.height<=746);
    await page.screenshot({path:`output/playwright/plugin-subpage-${width}.png`});
  }
  assert.deepEqual(await page.evaluate(()=>modalChanges),[]);
  assert(await page.evaluate(()=>settingsNode===document.getElementById('client-settings-dialog')));
  await page.setViewportSize({width:1280,height:860});
  await page.getByRole('button',{name:'返回插件列表',exact:true}).click();
  await page.evaluate(()=>{
    const runtime=fixtureDsh;
    runtime.sidebarTabs=[{id:'fixture-pane',kind:'fixture-pane',title:()=> '测试侧栏'}];
    runtime.openSidebarTab=()=>{runtime.activeSidebarTab='fixture-pane';runtime.rightbar={open:true,track:true,fullscreen:false};runtime.changed();};
    runtime.selectPanel=key=>{runtime.mainPanel=key;runtime.changed();};
    runtime.openRightbar=()=>{runtime.activeSidebarTab=undefined;runtime.rightbar={open:true,track:true,fullscreen:false};runtime.changed();};
    Object.defineProperty(runtime,'slots',{get:()=>[
      {name:'main',key:'fixture-main',owner:'plugin-1',label:'测试主面板'},
      {name:'rightbar',owner:'plugin-1',label:'测试普通侧栏'},
    ]});
    runtime.changed();
  });
  for(const name of ['测试侧栏','测试主面板','测试普通侧栏']){
    await page.evaluate(()=>fixtureDsh.openManager('commands'));
    await settings.getByRole('button',{name,exact:true}).click();
    await settings.waitFor({state:'hidden'});
    const control=name==='测试主面板'
      ? page.locator('.dsh-main-panel').getByRole('button',{name:'返回 Town',exact:true})
      : page.locator('.dsh-rightbar').getByRole('button',{name:'关闭插件侧栏',exact:true});
    await control.focus();
    assert(await control.evaluate(el=>document.activeElement===el),'Opened panel must receive focus outside the closed modal');
    assert.equal(await settings.evaluate(el=>el.matches(':modal')),false);
    await page.evaluate(()=>{fixtureDsh.mainPanel=null;fixtureDsh.rightbar.open=false;fixtureDsh.changed();});
  }
  for(const name of ['打开官方页面','打开官方侧栏']){
    await page.evaluate(()=>fixtureApp.openClientSettings());
    await settings.getByRole('tab',{name:'插件',exact:true}).click();
    if(await settings.getByRole('button',{name:'返回插件列表',exact:true}).isVisible()) await settings.getByRole('button',{name:'返回插件列表',exact:true}).click();
    await page.locator('#settings-plugin-town').click();
    if(await page.getByRole('button',{name:/官方示例/}).isVisible()) await page.getByRole('button',{name:/官方示例/}).click();
    if(name==='打开官方侧栏') await settings.getByText('显示位置与图标',{exact:true}).click();
    await settings.getByRole('button',{name,exact:true}).click();
    await settings.waitFor({state:'hidden'});
    assert.equal(await page.locator('#client-main').evaluate(el=>el.inert),false);
    assert.equal(await page.evaluate(()=>fixtureApp.plugins.selected?.placement),name==='打开官方页面'?'page':'sidebar');
    await page.evaluate(()=>{fixtureApp.plugins.selected=undefined;fixtureApp.plugins.changed();});
  }
  // Opening a plugin panel must retain the existing connection-draft guard.
  await page.evaluate(()=>{fixtureApp.openConnectionSettings();fixtureApp.editForm('portalName','unsaved-name');fixtureDsh.openManager('commands');});
  await settings.getByRole('button',{name:'测试侧栏',exact:true}).click();
  await settings.getByText('配置尚未保存。关闭会放弃本次修改。',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>fixtureDsh.rightbar.open),false);
  await settings.getByRole('button',{name:'放弃并关闭',exact:true}).click();
  await settings.waitFor({state:'hidden'});
  assert.deepEqual(errors,[]);
  console.log('PASS: stable settings frame, body-mounted plugin previews, official page/sidebar launch, plugin navigation, cross-tab discard resets text/JSON/errors, dirty guard, panel launch closes modal and preserves connection-draft guard, saved config and responsive layout.');
} finally {await browser?.close();server.kill();}
