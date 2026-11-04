import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { build } from '../scripts/renderer-build.mjs';
const runtimeBundle = await build({ entryPoints: ['desktop/main/app/html-preview.ts'], bundle: true, write: false, format: 'esm' });
const { HTML_PREVIEW_RUNTIME, htmlPreviewPolicy } = await import('data:text/javascript;base64,' + Buffer.from(runtimeBundle.outputFiles[0].contents).toString('base64'));
const shellHTML = await readFile('desktop/renderer/index.html', 'utf8');
const csp = shellHTML.match(/<meta http-equiv="Content-Security-Policy"[^>]+>/)[0];
const bundle = await build({
  // Browser fixtures use HTTP for Electron's isolated preview protocol.
  plugins: [{ name: 'preview-protocol-fixture', setup(builder) {
    builder.onLoad({ filter: /home-file-preview\.tsx$/ }, async args => ({ loader: 'tsx', contents: (await readFile(args.path, 'utf8')).replace('beings://preview/runtime.html', '/runtime.html') }));
  } }], stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
  import { createRoot } from 'react-dom/client';
  import { useState } from 'react';
  import { BeingLibrary } from './desktop/renderer/app/components/home-library';
  import './desktop/renderer/app/styles.scss';
  const listeners = new Set(); window.calls = []; window.downloads = []; window.blocked = false;
  let home = { authenticated:true,authenticating:false,username:'fixture',binding:'matched',viewer:'closed' };
  window.setHome = patch => {home={...home,...patch};listeners.forEach(fn=>fn(home));};
  const entries = {
    '': [
      {name:'项目资料',path:'项目资料',type:'directory',size:0},
      {name:'空文件夹',path:'空文件夹',type:'directory',size:0},
      {name:'欢迎来到工作区.html',path:'欢迎来到工作区.html',type:'file',size:2048},
      {name:'非常长的文件名—云端工作区资料页交互设计与验收记录（最终版本）.md',path:'非常长的文件名—云端工作区资料页交互设计与验收记录（最终版本）.md',type:'file',size:18240},
      {name:'notes.txt',path:'notes.txt',type:'file',size:5},
    ],
    '项目资料':[{name:'报告 #%.txt',path:'项目资料/报告 #%.txt',type:'file',size:1500}],
    '空文件夹':[],
  };
  const api = {
    state:async()=>home,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
    files:{
      list:async path=>{window.calls.push(path); if(!home.authenticated)throw new Error('请先在电脑栏连接 Being Home。');if(window.blocked)throw new Error('工作区读取失败，请重试。');return {entries:entries[path]||[]};},
      preview:async path=>{
        if(window.delayPreview) await new Promise(resolve=>window.finishPreview=resolve);
        return {name:path.split('/').pop(),path,bytes:new TextEncoder().encode(path.endsWith('.html')?
          '<html><body style="font-family:system-ui;padding:40px"><h1>Workspace preview fixture</h1><p>这是一份隔离的 HTML 预览测试文件。</p><button onclick="this.textContent=123">运行脚本</button><script>try{parent.window.unsafeExecuted=true}catch{}</script><img src="https://example.invalid/secret"></body></html>':'云端工作区测试内容')};
      },
      download:async path=>{window.downloads.push(path);return true;},
    }
  };
  function Fixture(){
    const [context,setContext]=useState('one'),[visible,setVisible]=useState(true);
    return <><div style={{position:'fixed',left:80,top:10,zIndex:30}}><button id="switch" onClick={()=>setContext('two')}>切换 Being（测试）</button><button id="toggle" onClick={()=>setVisible(v=>!v)}>切换资料栏（测试）</button></div>
      <main id="client-main"><div className="workspace-body" style={{height:'100vh'}}>
        <nav className="workspace-rail"/><div className="workspace-stage" style={{padding:80}}><h2>资料库交互测试</h2><p>此页面使用合成文件，不连接生产账号。</p></div>
        <aside id="being-info" className="being-info" style={{width:320,flexBasis:320}}>
          <div className="being-overview"><div className="being-profile"><div className="being-avatar">W</div><h2>Willow</h2></div>
          <div className="being-tabs"><button>详情</button><button>动态</button><button aria-selected="true">资料库</button><button>电脑</button></div>
          <div className="being-info-content">{visible && <BeingLibrary key={context} api={api} onConnect={()=>window.connected=true}/>}</div></div>
        </aside>
      </div></main></>;
  }
  createRoot(document.querySelector('#root')).render(<Fixture/>);
` }, bundle: true, format: 'esm', write: false, outdir: '/fixture', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
const server = createServer((request, response) => {
  if (request.url === '/runtime.html') {
    response.setHeader('Content-Type', 'text/html');
    response.setHeader('Content-Security-Policy', htmlPreviewPolicy());
    return response.end(HTML_PREVIEW_RUNTIME);
  }
  const file = bundle.outputFiles.find(f => f.path.endsWith(request.url));
  response.setHeader('Content-Type', file ? request.url.endsWith('.css') ? 'text/css' : 'text/javascript' : 'text/html; charset=utf-8');
  response.end(file ? file.contents : `<!doctype html><head>${csp}<link rel="stylesheet" href="/stdin.css"></head><div id="root"></div><script type="module" src="/stdin.js"></script>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
if (process.argv.includes('--serve')) { console.log(url); await new Promise(() => {}); }
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let external = 0; page.on('request', request => { if (request.url().includes('example.invalid')) external++; });
  await page.route('https://example.invalid/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' }));
  await page.goto(url);
  const files = page.getByRole('list', { name: '工作区文件' });
  await files.getByRole('button', { name: '项目资料' }).waitFor();
  await mkdir('output/playwright', { recursive: true });
  await page.screenshot({ animations: 'disabled', path: 'output/playwright/home-library-desktop.png' });
  await page.getByRole('searchbox').fill('notes');
  assert.equal(await files.locator('li').count(), 1);
  await page.getByRole('searchbox').fill('不存在');
  await page.getByText('没有匹配的文件', { exact: true }).waitFor();
  await page.getByRole('button', { name: '清除搜索' }).click();
  await files.getByRole('button', { name: '项目资料' }).click();
  await files.getByRole('button', { name: '报告 #%.txt 1.5 KiB' }).waitFor();
  await page.getByRole('button', { name: '下载 报告 #%.txt', exact: true }).click();
  await page.getByText('文件已保存', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.downloads), ['项目资料/报告 #%.txt']);
  await page.getByRole('button', { name: '工作区', exact: true }).click();
  await files.getByRole('button', { name: '空文件夹' }).click();
  await page.getByText('这个文件夹还是空的', { exact: true }).waitFor();
  await page.getByRole('button', { name: '工作区', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: /上传文件|新建文件夹/ }).count(), 0);
  await page.getByRole('searchbox').fill('欢迎');
  await files.getByRole('button', { name: '欢迎来到工作区.html 2 KiB', exact: true }).click();
  const dialog = page.getByRole('complementary', { name: '文件预览：欢迎来到工作区.html' });
  const html = page.frameLocator('iframe[title="云端 HTML 预览"]');
  await html.getByRole('heading', { name: 'Workspace preview fixture' }).waitFor();
  assert.equal(await page.evaluate(() => window.unsafeExecuted), undefined);
  assert.equal(external, 1, 'HTML can load external resources');
  await html.getByRole('button', { name: '运行脚本' }).click();
  await html.getByRole('button', { name: '123' }).waitFor();
  assert.equal(await page.locator('iframe[title="云端 HTML 预览"]').getAttribute('sandbox'), 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads');
  await page.screenshot({ animations: 'disabled', path: 'output/playwright/home-library-preview.png' });
  await dialog.getByRole('button', { name: '源码', exact: true }).click();
  await dialog.locator('pre').waitFor();
  assert((await dialog.locator('pre').innerText()).includes('<script>'));
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('title') === '欢迎来到工作区.html');
  assert.equal(await page.getByRole('searchbox').inputValue(), '欢迎');
  await page.getByRole('searchbox').fill('');
  await page.evaluate(() => { window.delayPreview = true; });
  await files.getByRole('button', { name: 'notes.txt 5 B', exact: true }).click();
  await page.getByText('正在读取文件…', { exact: true }).waitFor();
  await page.screenshot({ animations: 'disabled', path: 'output/playwright/home-loading-light.png' });
  await page.setViewportSize({ width: 800, height: 700 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.screenshot({ animations: 'disabled', path: 'output/playwright/home-loading-dark.png' });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: '关闭文件预览' }).click();
  await page.evaluate(() => { window.finishPreview(); window.delayPreview = false; });
  assert.equal(await page.locator('.client-file-viewer').count(), 0);
  await page.evaluate(() => { window.blocked = true; });
  await page.getByRole('button', { name: '刷新资料库' }).click();
  await page.getByText('工作区读取失败，请重试。', { exact: true }).waitFor();
  assert.equal(await files.locator('li').count(), 0);
  await page.evaluate(() => { window.blocked = false; });
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await files.getByRole('button', { name: 'notes.txt 5 B' }).waitFor();
  await page.evaluate(() => window.setHome({ authenticated: false, username: undefined, binding: undefined }));
  await page.getByText('请先在电脑栏连接 Being Home。', { exact: true }).waitFor();
  assert.equal(await files.locator('li').count(), 0);
  await page.getByRole('button', { name: '前往电脑栏' }).click();
  assert.equal(await page.evaluate(() => window.connected), true);
  await page.evaluate(() => window.setHome({ authenticated: true, username: 'other', binding: 'matched' }));
  await files.getByRole('button', { name: 'notes.txt 5 B' }).waitFor();
  await page.setViewportSize({ width: 800, height: 700 });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.screenshot({ animations: 'disabled', path: 'output/playwright/home-library-narrow-dark.png' });
  const overflows = await page.locator('#being-info').evaluate(el => el.scrollWidth > el.clientWidth);
  assert.equal(overflows, false, 'narrow library must not overflow');
  assert.deepEqual(errors, []);
  console.log('Home library UI passed: directory/search, read-only list/download, interactive isolated HTML/source, focus/Escape, delayed preview, retry, account change, narrow/dark.');
} finally { await browser.close(); server.close(); }
