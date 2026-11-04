import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { build } from 'esbuild';
import { launchDesktop } from './support/electron-lifecycle.mjs';
const directory = await mkdtemp(path.join(os.tmpdir(), 'html-preview-'));
const web = createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  if (request.url === '/style.css') { response.setHeader('Content-Type', 'text/css'); response.end('h1 { color: rgb(12, 90, 120); }'); }
  else if (request.url === '/script.js') { response.setHeader('Content-Type', 'text/javascript'); response.end('document.body.dataset.remote="loaded";'); }
  else response.end('network works');
});
await new Promise(resolve => web.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${web.address().port}`;
const html = `<!doctype html><html><head><link rel="stylesheet" href="${origin}/style.css"></head><body><h1>Interactive preview</h1>
<a href="https://example.test/plain">普通链接</a><a target="_blank" href="https://example.test/blank">新窗口链接</a><a target="_top" href="https://example.test/top">顶层链接</a>
<a href="#section">页内跳转</a><h2 id="section">目标段落</h2>
<button onclick="window.open('https://example.test/script')">脚本打开</button><button onclick="location.href='https://example.test/location'">页面跳转</button>
<form action="https://example.test/form" target="_blank"><button>提交表单</button></form><p id="isolation"></p><p id="network"></p>
<script src="${origin}/script.js"></script><script>isolation.textContent=typeof window.beings;try{parent.document.body.dataset.compromised='yes'}catch{isolation.textContent+=':isolated'};fetch('${origin}/data').then(r=>r.text()).then(t=>network.textContent=t);</script></body></html>`;
let application;
try {
  await writeFile(path.join(directory, 'sample.html'), html);
  const csp = (await readFile('desktop/renderer/index.html', 'utf8')).match(/<meta http-equiv="Content-Security-Policy"[^>]+>/)[0];
  await writeFile(path.join(directory, 'index.html'), `<!doctype html>${csp}<iframe title="preview" sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads" style="width:100%;height:600px"></iframe><script src="shell.js"></script>`);
  await writeFile(path.join(directory, 'shell.js'), `window.showPreview=(url,html)=>{const previous=document.querySelector('iframe'),frame=previous.cloneNode(false);frame.onload=()=>{if(html)frame.contentWindow.postMessage({type:'home:html-preview',html},'*')};frame.src=url;previous.replaceWith(frame);};`);
  await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { app, protocol } from 'electron';
    import { registerLocalProtocol, configureLocalSession } from './desktop/main/app/protocol';
    import { createMainWindow } from './desktop/main/app/window';
    import { LocalFilePreviews } from './desktop/main/app/local-file-preview';
    app.setPath('userData',${JSON.stringify(path.join(directory, 'profile'))});
    protocol.registerSchemesAsPrivileged([{scheme:'beings',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
    app.whenReady().then(async()=>{
      const files=new LocalFilePreviews(()=>${JSON.stringify(directory)});
      globalThis.localPreview=await files.preview('sample.html');globalThis.opened=[];
      registerLocalProtocol(${JSON.stringify(directory)},{handle:async()=>new Response('fixture')},undefined,undefined,files);configureLocalSession();
      createMainWindow({shellURL:()=> 'beings://desktop/',isQuitting:()=>true,isSessionEnding:()=>false,markSessionEnding:()=>{},openExternal:url=>globalThis.opened.push(url),onBrowser:()=>{},onClosed:()=>{}});
    });
  ` }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: path.join(directory, 'main.cjs') });
  application = await launchDesktop({ args: [path.join(directory, 'main.cjs')], env: { ...process.env, PORTAL_DESKTOP_USER_DATA: path.join(directory, 'profile'), PORTAL_DESKTOP_TEST_MOCK_KEYCHAIN: '1' } });
  const page = await application.firstWindow();
  await page.waitForFunction(() => typeof window.showPreview === 'function');
  const local = await application.evaluate(() => globalThis.localPreview.url);
  for (const url of ['beings://preview/runtime.html', local]) {
    await page.evaluate(({ url, html }) => window.showPreview(url, url.endsWith('/runtime.html') ? html : undefined), { url, html });
    const preview = page.frameLocator('iframe');
    await preview.getByRole('heading', { name: 'Interactive preview' }).waitFor();
    await preview.getByText('network works', { exact: true }).waitFor();
    assert.equal(await preview.locator('html').evaluate(el => el.ownerDocument.URL), url);
    assert.equal(await preview.locator('#isolation').innerText(), 'undefined:isolated');
    assert.equal(await preview.locator('body').getAttribute('data-remote'), 'loaded');
    assert.equal(await preview.locator('h1').evaluate(el => getComputedStyle(el).color), 'rgb(12, 90, 120)');
    for (const [name, suffix] of [['普通链接','plain'],['新窗口链接','blank'],['顶层链接','top'],['脚本打开','script'],['页面跳转','location'],['提交表单','form']]) {
      await application.evaluate(() => { globalThis.opened = []; });
      await preview.getByText(name, { exact: true }).click();
      await page.waitForTimeout(100);
      assert.deepEqual(await application.evaluate(() => globalThis.opened), ['https://example.test/' + suffix + (suffix === 'form' ? '?' : '')]);
      assert.equal(page.url(), 'beings://desktop/');
      assert.equal(await preview.getByRole('heading', { name: 'Interactive preview' }).count(), 1);
    }
    await application.evaluate(() => { globalThis.opened = []; });
    await preview.getByText('页内跳转', { exact: true }).click();
    assert.deepEqual(await application.evaluate(() => globalThis.opened), []);
    assert.equal(await page.locator('body').getAttribute('data-compromised'), null);
  }
  console.log('PASS: cloud/local HTML scripts, remote styles/scripts/fetch, normal/blank/top links, window.open, location, forms, fragments, shell and IPC isolation.');
} finally { await application?.close(); web.close(); await rm(directory, { recursive: true, force: true }); }
