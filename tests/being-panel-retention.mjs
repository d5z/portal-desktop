// Real desktop shell, isolated browser storage and synthetic services.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const server = spawn(process.execPath, ['tests/workspace-layout.mjs'], {
  env: { ...process.env, PORTAL_LAYOUT_PREVIEW: '1', PORTAL_LAYOUT_PORT: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let browser;
try {
  const origin = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Preview startup timed out')), 20000);
    let output = '';
    server.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/Layout preview: (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
    server.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Preview exited: ${code}`));
    });
  });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);

  await page.evaluate(() => {
    window.libraryCalls = []; window.historyCalls = 0;
    const listeners = new Set();
    let home = {authenticated:true,authenticating:false,username:'fixture',binding:'matched',viewer:'closed'};
    window.setLibraryHome = patch => { home={...home,...patch}; for(const receive of listeners) receive(home); };
    window.fixtureApp.api.recentChatHistory = async () => {window.historyCalls++; return [];};
    window.fixtureApp.api.home = {
      state:async()=>home,subscribe:receive=>{listeners.add(receive);return()=>listeners.delete(receive);},bounds:async()=>{},
      files:{
        list:async path=>{
          window.libraryCalls.push(path);
          if(!home.authenticated) throw new Error('请先连接');
          if(window.libraryCalls.length===1) await new Promise(resolve=>window.finishFirstListing=resolve);
          return {entries: path ? Array.from({length:40},(_,i)=>({name:`报告 ${i}.txt`,path:`项目/报告 ${i}.txt`,type:'file',size:24})) : [{name:'项目',path:'项目',type:'directory',size:0}]};
        },
        preview:async path=>({path,name:path.split('/').pop(),bytes:new TextEncoder().encode('preview')}),download:async()=>true,
      },
    };
    window.fixtureApp.changed();
  });
  const toggle=page.getByRole('button',{name:'Being 信息',exact:true});
  const library=page.getByRole('tab',{name:'资料库',exact:true});
  const details=page.getByRole('tab',{name:'详情',exact:true});
  const files=page.getByRole('list',{name:'工作区文件'});
  await toggle.click();
  assert.deepEqual(await page.evaluate(()=>window.libraryCalls),[], 'Library is lazy until first visit');
  await library.click();
  await page.getByRole('tab',{name:'工作区',exact:true}).click();
  await page.getByText('正在读取工作区…',{exact:true}).waitFor();
  await details.click(); await library.click();
  assert.deepEqual(await page.evaluate(()=>window.libraryCalls),[''], 'Switches reuse the in-flight listing');
  await page.evaluate(()=>window.finishFirstListing());
  await files.getByRole('button',{name:'项目',exact:true}).click();
  await files.locator('li').nth(39).waitFor();
  await page.getByRole('searchbox',{name:'搜索当前文件夹'}).fill('报告');
  await page.locator('.being-info-content').evaluate(e=>e.scrollTop=200);
  await page.waitForFunction(()=>document.querySelector('.being-info-content').scrollTop===200);
  await details.click(); await library.click();
  assert.equal(await page.getByRole('searchbox').inputValue(),'报告');
  assert.equal(await page.locator('.being-info-content').evaluate(e=>e.scrollTop),200);
  assert.deepEqual(await page.evaluate(()=>window.libraryCalls),['','项目']);
  await page.getByRole('button',{name:'关闭 Being 信息',exact:true}).click();
  await toggle.click();
  assert.equal(await page.getByRole('searchbox').inputValue(),'报告');
  assert.equal(await files.locator('li').count(),40);
  assert.equal(await page.locator('.being-info-content').evaluate(e=>e.scrollTop),200);
  assert.deepEqual(await page.evaluate(()=>window.libraryCalls),['','项目']);
  await page.getByRole('button',{name:'刷新资料库',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.libraryCalls),['','项目','项目']);
  // Portaled previews cannot remain over another tab or a closed info panel.
  await files.getByRole('button',{name:'报告 0.txt 24 B',exact:true}).click();
  const preview = page.getByRole('complementary',{name:'文件预览：报告 0.txt'});
  await preview.waitFor();
  await page.evaluate(()=>window.fixtureApp.toggleBeingInfo());
  await preview.waitFor({state:'hidden'});
  await toggle.click();
  assert.equal(await preview.count(),0);
  await details.click();
  await page.evaluate(()=>window.setLibraryHome({authenticated:false,username:undefined,binding:undefined}));
  await library.click();
  await page.getByText('请先连接',{exact:true}).waitFor();
  assert.equal(await files.locator('li').count(),0,'Auth changes clear retained private entries');
  await page.evaluate(()=>window.setLibraryHome({authenticated:true,username:'next',binding:'matched'}));
  await files.getByRole('button',{name:'项目',exact:true}).waitFor();
  assert.equal(await page.getByRole('searchbox').inputValue(),'');
  await details.click();
  await page.evaluate(()=>{window.fixtureApp.snapshot.settings.being='another-being';window.fixtureApp.changed();});
  const before = await page.evaluate(()=>window.libraryCalls.length);
  await library.click();
  await page.getByRole('tab',{name:'工作区',exact:true}).click();
  await files.getByRole('button',{name:'项目',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.libraryCalls.length),before+1,'Different Being gets a new library');
  const activity=page.getByRole('tab',{name:'动态',exact:true});
  await activity.click();
  await page.waitForFunction(()=>window.historyCalls===1);
  await details.click(); await activity.click();
  assert.equal(await page.evaluate(()=>window.historyCalls),1,'Activity is also retained across tabs');
  assert.deepEqual(errors,[]);
  console.log('Being tabs: lazy load, in-flight deduplication, retained path/search/scroll, close/reopen, explicit refresh, preview dismissal and identity invalidation passed.');
} finally {
  await browser?.close();
  server.kill();
}
