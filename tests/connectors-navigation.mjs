// Exercise navigation with deliberately unresolved connector requests.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
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
  const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error(error.message)});
  await page.goto(origin);
  await page.evaluate(()=>{
    const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
    const f=window.connectorFixture={details:{},catalog:deferred(),home:deferred(),tools:deferred(),oauth:deferred(),preview:deferred(),calls:{},opened:[]};
    const kits=['GitHub','Slack','API Only','Slow','Failure'].map(name=>({release_id:name,name,description:'Test app',availability:'listed',installation_ids:name==='GitHub'?['installed']:[]}));
    f.kits=kits;
    f.installed=[{id:'installed',root_release_id:'GitHub',status:'ready',desired_state:'enabled'}];
    const connectors={
      catalog:query=>query?.after ? Promise.resolve({enabled:true,items:f.kits.slice(4),next_after:null}) : f.catalog.promise.then(page=>({...page,items:f.kits.slice(0,4)})),
      installations:async after=>after ? {items:f.installed,next_after:null} : {items:[],next_after:'installed-page'},
      detail:id=>{f.calls[id]=(f.calls[id]||0)+1;return (f.details[id]??=deferred()).promise},
      tools:()=>f.tools.promise,
      setTool:async(_id,input)=>{f.updatedTool=input;return {...input,revision:2,read_only:true,available:true,account_authorized:true}},
      preview:()=>f.preview.promise,
      confirm:async()=>{f.confirmCalls=(f.confirmCalls||0)+1;f.kits=f.kits.map(kit=>kit.name==='API Only'?{...kit,installation_ids:['api-install']}:kit);f.installed.push({id:'api-install',root_release_id:'API Only',status:'ready',desired_state:'enabled'});return {id:'enable',status:'ready',installation_id:'api-install'}},
      syncOAuth:async(_id,revision)=>{f.syncedRevision=revision;return {id:'flow',revision:1,status:'ready',authorization_url:'https://example.com/oauth'}},
      startOAuth:()=>{f.oauthCalls=(f.oauthCalls||0)+1;return f.oauth.promise},
      openAuthorization:async url=>{f.opened.push(url)},
    };
    window.fixtureApp.api.home={state:()=>f.home.promise,bounds:async()=>{},subscribe:()=>()=>{},connectors};
    window.fixtureApp.openClientSettings();
  });
  const settings=page.locator('#client-settings-dialog');
  await settings.getByRole('tab',{name:'应用',exact:true}).click();
  await settings.getByRole('status',{name:'正在加载应用…',exact:true}).waitFor();
  assert.equal(await settings.getByText('连接 Home 后管理应用',{exact:true}).count(),0,'Do not flash logged-out state while checking the session');
  await page.evaluate(()=>connectorFixture.home.resolve({authenticated:true}));
  await settings.locator('.connector-toolbar').waitFor();
  assert.equal(await settings.getByText('暂无可用应用。',{exact:true}).count(),0,'Do not flash empty state while catalog is loading');
  assert.equal(await settings.getByRole('status',{name:'正在加载应用…',exact:true}).count(),1);
  await page.evaluate(()=>connectorFixture.catalog.resolve({enabled:true,items:connectorFixture.kits.slice(0,4),next_after:'catalog-page'}));
  await settings.getByText('Failure',{exact:true}).waitFor();
  const card=name=>settings.locator('.connector-card').filter({hasText:name});
  const resolveDetail=async(name,method='oauth2')=>page.evaluate(({name,method})=>connectorFixture.details[name].resolve({name,accounts:[],methods:[{method,fields:[]}]}),{name,method});
  await card('GitHub').click();
  await settings.getByRole('heading',{name:'GitHub',exact:true}).waitFor();
  assert.equal(await card('Slack').count(),0,'Enter detail before the request completes');
  assert.equal(await settings.getByRole('status',{name:'正在加载…',exact:true}).count(),1);
  await resolveDetail('GitHub');
  await settings.getByRole('button',{name:'暂停',exact:true}).waitFor();
  assert(await settings.getByRole('button',{name:'暂停',exact:true}).isEnabled(),'Slow tools must not block detail actions');
  await page.evaluate(()=>connectorFixture.tools.reject(new Error('工具加载失败')));
  await settings.getByRole('alert').filter({hasText:'工具加载失败'}).waitFor();
  await settings.getByRole('button',{name:'← 返回应用',exact:true}).click();
  await card('GitHub').click();
  await settings.getByRole('button',{name:'暂停',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>connectorFixture.calls.GitHub),1,'Reuse detail on re-entry');
  await page.evaluate(()=>connectorFixture.tools.promise=Promise.resolve(['read_repo','read_issues'].map(name=>({component_id:'shared',connection_id:'account',export:name,enabled:false,read_only:true,available:true,account_authorized:true,revision:1,contract_digest:'digest'}))));
  await settings.getByRole('button',{name:'刷新工具',exact:true}).click();
  await settings.getByRole('checkbox',{name:'read_repo',exact:true}).waitFor();
  await settings.getByRole('checkbox',{name:'read_repo',exact:true}).check();
  await page.waitForFunction(()=>connectorFixture.updatedTool);
  assert(await settings.getByRole('checkbox',{name:'read_repo',exact:true}).isChecked());
  assert.equal(await settings.getByRole('checkbox',{name:'read_issues',exact:true}).isChecked(),false,'Toggling one export must not overwrite another export in the same component');
  assert.equal(await settings.locator('.connector-tool').count(),2);
  await settings.getByRole('button',{name:'← 返回应用',exact:true}).click();
  await card('Slow').click();
  await settings.getByRole('heading',{name:'Slow',exact:true}).waitFor();
  await settings.getByRole('button',{name:'← 返回应用',exact:true}).click();
  await card('API Only').getByRole('button',{name:'连接',exact:true}).click();
  await card('API Only').getByRole('button',{name:'连接中…',exact:true}).waitFor();
  assert(await card('API Only').getByRole('button').isDisabled(),'Disable duplicate connections while resolving the auth method');
  assert.equal(await settings.getByRole('heading',{name:'API Only',exact:true}).count(),0,'Keep the catalog visible during connection preparation');
  await resolveDetail('Slow');
  assert.equal(await settings.getByRole('heading',{name:'Slow',exact:true}).count(),0,'Late response must not replace the selected page');
  await resolveDetail('API Only','api_key');
  await settings.getByRole('button',{name:/API Key/}).waitFor();
  assert.equal(await page.evaluate(()=>connectorFixture.oauthCalls||0),0,'Fallback must not attempt OAuth');
  await settings.getByRole('button',{name:/API Key/}).click();
  await settings.getByRole('button',{name:'← 返回应用',exact:true}).click();
  await page.evaluate(()=>connectorFixture.preview.resolve({id:'late-preview',requires_adoption:false}));
  await card('Slack').hover();
  await page.waitForFunction(()=>connectorFixture.details.Slack);
  await resolveDetail('Slack');
  assert.equal(await page.evaluate(()=>connectorFixture.confirmCalls||0),0,'Leaving the fallback page must not auto-confirm its late preview');
  const connect=card('Slack').getByRole('button',{name:'连接',exact:true});
  await connect.focus();
  await page.keyboard.press('Enter');
  await card('Slack').getByRole('button',{name:'连接中…',exact:true}).waitFor();
  assert.equal(await card('Slack').getByRole('button').getAttribute('aria-busy'),'true');
  assert.equal(await page.evaluate(()=>connectorFixture.calls.Slack),1,'Connect reuses the prefetched detail');
  assert.equal(await page.evaluate(()=>connectorFixture.oauthCalls),1,'Keyboard connect must not bubble into detail navigation');
  await page.evaluate(()=>connectorFixture.oauth.resolve({id:'flow',revision:0,status:'pending',authorization_url:'https://example.com/oauth'}));
  await settings.getByRole('button',{name:'已完成连接，继续',exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>connectorFixture.opened),['https://example.com/oauth']);
  await settings.getByRole('button',{name:'已完成连接，继续',exact:true}).click();
  await settings.getByText('应用已连接。',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>connectorFixture.syncedRevision),0,'Revision zero still identifies an OAuth flow');
  assert.deepEqual(await page.evaluate(()=>connectorFixture.opened),['https://example.com/oauth'],'Ready flows must not reopen the authorization URL');
  await settings.getByRole('button',{name:'← 返回应用',exact:true}).click();
  await card('Failure').getByRole('button',{name:'连接',exact:true}).click();
  await card('Failure').getByRole('button',{name:'连接中…',exact:true}).waitFor();
  await page.evaluate(()=>connectorFixture.details.Failure.reject(new Error('无法连接应用')));
  await settings.getByRole('alert').filter({hasText:'无法连接应用'}).waitFor();
  assert(await card('Failure').getByRole('button',{name:'连接',exact:true}).isEnabled(),'Failed connect restores the button for retry');
  await card('Failure').click();
  await page.evaluate(()=>connectorFixture.details.Failure.reject(new Error('连接请求超时')));
  await settings.getByRole('button',{name:'重试',exact:true}).waitFor();
  assert.equal(await settings.locator('.connector-loading-spinner').count(),0,'Stop spinning after a failed request');
  await settings.getByRole('button',{name:'← 返回应用',exact:true}).click();
  await card('API Only').click();
  await settings.getByRole('button',{name:/API Key/}).click();
  await settings.getByRole('button',{name:'暂停',exact:true}).waitFor();
  await settings.getByRole('checkbox',{name:'read_repo',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>connectorFixture.confirmCalls),1,'A successful fallback connection refreshes the current installation and its tools');
  await settings.getByRole('button',{name:'← 返回应用',exact:true}).click();
  await page.evaluate(()=>{
    let resolve,reject;
    const promise=new Promise((a,b)=>{resolve=a;reject=b});
    connectorFixture.catalog={promise,resolve,reject};
  });
  await settings.getByRole('button',{name:'刷新',exact:true}).click();
  await settings.getByRole('status',{name:'正在加载应用…',exact:true}).waitFor();
  assert.equal(await card('Slack').count(),1,'Retain existing cards during catalog refresh');
  await page.evaluate(()=>connectorFixture.catalog.reject(new Error('目录加载失败')));
  await settings.getByRole('alert').filter({hasText:'目录加载失败'}).waitFor();
  assert(await settings.getByRole('button',{name:'刷新',exact:true}).isEnabled(),'Catalog failure permits retry');
  assert.equal(await settings.getByRole('status',{name:'正在加载应用…',exact:true}).count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: paginated catalog/installations, independent tool exports, late fallback preview, OAuth revision zero and ready-state handling; session/catalog loading, inline connect loading and error recovery, immediate detail navigation, independent tool errors, cached detail reads, stale navigation protection, OAuth priority/fallback and keyboard connect.');
} finally {await browser?.close();server.kill();}
