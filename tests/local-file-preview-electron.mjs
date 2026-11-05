import assert from 'node:assert/strict';
import { build } from '../scripts/renderer-build.mjs';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { launchDesktop } from './support/electron-lifecycle.mjs';
import { readShellStyles } from './support/shell-styles.mjs';
const dir = await mkdtemp(path.join(os.tmpdir(), 'being-local-preview-'));
let application;
async function bundle(name, contents, platform = 'browser') {
  await build({ stdin: { contents, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, platform,
    format: platform === 'node' ? 'cjs' : 'iife', external: platform === 'node' ? ['electron'] : [],
    jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, outfile: path.join(dir, name), logLevel: 'error' });
}
try {
  const workspace = path.join(dir, 'portal-desktop Workspace', 'qimen-study'); await mkdir(workspace,{recursive:true});
  const file = path.join(workspace, '八字排盘工具.html');
  const pdfFile = path.join(workspace, '本机 PDF 预览.pdf');
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents 4 0 R >>'];
  const stream = '0 0 1 rg 0 0 200 200 re f\n';
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  await writeFile(pdfFile, pdf);
  await writeFile(path.join(dir, 'pdf.worker.min.js'), await readFile('node_modules/pdfjs-dist/build/pdf.worker.min.mjs'));
  const document = heading => `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="style.css"><h1>${heading}</h1><button id="counter">0</button><p id="isolation"></p><script src="script.js"></script>`;
  await writeFile(file, document('当前对话生成的页面'));
  await mkdir(path.join(workspace,'Example.app'));
  await writeFile(path.join(workspace,'.portal-connection.url'),'unsupported fixture');
  await writeFile(path.join(workspace, 'style.css'), 'h1 { color: rgb(12, 90, 120); }');
  await writeFile(path.join(workspace, 'script.js'), `counter.onclick=()=>counter.textContent=Number(counter.textContent)+1; isolation.textContent=typeof window.beings; try { parent.document.body.dataset.compromised='yes'; } catch { isolation.textContent += ':isolated'; }`);
  await writeFile(path.join(dir, 'shell.css'), await readShellStyles());
  const shellHTML = (await readFile('desktop/renderer/index.html', 'utf8')).replace('<link rel="icon" type="image/png" href="../../resources/branding/app.png">', '<link rel="stylesheet" href="shell.css">').replace('<script type="module" src="/main.tsx"></script>', '<script src="shell.js"></script>');
  await writeFile(path.join(dir, 'index.html'), shellHTML);
  await writeFile(path.join(dir, 'loom.html'), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="chat.css"><div id="root"></div><script src="chat.js"></script>');
  await bundle('preload.js', process.env.LOCAL_PREVIEW_LEGACY==='1'
    ? (await readFile('desktop/preload/preload.ts','utf8')).replace(/^  checkLocalFiles:.*\n/m,'')
    : `import './desktop/preload/preload';`, 'node');
  await bundle('shell.js', `
    import './desktop/renderer/app/styles.scss';
    import {createRoot} from 'react-dom/client'; import {useRef} from 'react';
    import {AttachmentFileViewer} from './desktop/renderer/app/components/attachment-file-viewer';
    function Shell(){const frame=useRef(null);return <div className="workspace-body" style={{height:'100vh'}}><div className="workspace-stage"><iframe ref={frame} title="当前对话" src="beings://chat/?revision=test" style={{width:'100%',height:'100%',border:0}}/></div><AttachmentFileViewer frame={frame}/></div>;}
    createRoot(document.getElementById('root')).render(<Shell/>);
  `);
  await bundle('chat.js', `
    import './desktop/renderer/chat/document.scss';
    import {createRoot} from 'react-dom/client'; import {Markdown} from './desktop/renderer/shared/components/markdown';
    import {LocalFileAction, requestLocalFilePreview} from './desktop/renderer/shared/components/local-file-link';
    import {EditContextMenu} from './desktop/renderer/shared/components/context-menu';
    import {ChatActivity} from './desktop/renderer/chat/components/messages';
    import {newToolActivity, completeToolActivity} from './desktop/renderer/chat/models/tool-activity';
    const entries = [newToolActivity([], {call_id:'file-write',name:'portal_file_write'}, 'entry', Date.now())];
    completeToolActivity(entries, {call_id:'file-write',path:${JSON.stringify(file)},is_error:false,summary:'文件已保存'});
    const toolRun = {kind:'run',id:'run',entries,start:Date.now(),end:Date.now(),label:'已完成',hint:'',arg:'',outcome:'done'};
    createRoot(document.getElementById('root')).render(<LocalFileAction.Provider value={requestLocalFilePreview}><div className="chat-root" style={{padding:24}}><div className="message being"><div className="content">{${process.env.LOCAL_PREVIEW_TOOL_ACTIVITY === '1'} ? <ChatActivity run={toolRun}/> : <Markdown chat content={${JSON.stringify(`页面已生成，点击下面的文件即可在当前对话中预览。\n\n[预览页面](<${file}>)\n\n你可以继续告诉我需要修改的地方。`)}}/>}</div></div><Markdown chat content={${JSON.stringify(`[预览 PDF](<${pdfFile}>)`)}}/><Markdown chat content={${JSON.stringify(`[不存在](<${path.join(workspace, 'missing.html')}>)\n\n` + '`' + path.join(workspace, 'Example.app') + '` ' + '`' + path.join(workspace, '.portal-connection.url') + '`')}}/><textarea aria-label="继续修改" defaultValue="把标题改成蓝色"/><EditContextMenu appearance="chat" edit={async()=>true}/></div></LocalFileAction.Provider>);
  `);
  await bundle('main.cjs', `
    import {app,protocol,ipcMain} from 'electron';
    import {createMainWindow} from './desktop/main/app/window';
    import {registerLocalProtocol,configureLocalSession} from './desktop/main/app/protocol';
    import {LocalFilePreviews} from './desktop/main/app/local-file-preview';
    app.setPath('userData',process.env.PORTAL_DESKTOP_USER_DATA);
    protocol.registerSchemesAsPrivileged([{scheme:'beings',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
    app.whenReady().then(()=>{
      const files=new LocalFilePreviews(()=>${JSON.stringify(workspace)});
      registerLocalProtocol(${JSON.stringify(dir)},{handle:async()=>new Response('fixture')},undefined,undefined,files);configureLocalSession();
      const {window}=createMainWindow({shellURL:()=> 'beings://desktop/',isQuitting:()=>true,isSessionEnding:()=>false,markSessionEnding:()=>{},openExternal:()=>{},onBrowser:()=>{},onClosed:()=>{}});
      globalThis.revealFile=p=>files.reveal(p,file=>{globalThis.revealedFile=file;});
      for(const [channel,run] of [['beings:local-file-preview',p=>files.preview(p)],['beings:local-file-release',id=>files.release(id)],['beings:local-files-check',paths=>files.available(paths)],['beings:local-file-reveal',globalThis.revealFile]])ipcMain.handle(channel,(event,value)=>{if(event.senderFrame!==window.webContents.mainFrame)throw new Error('Untrusted');return run(value);});
    });
  `, 'node');
  application = await launchDesktop({ args: [path.join(dir, 'main.cjs')], env: { ...process.env, PORTAL_DESKTOP_USER_DATA: path.join(dir, 'profile') } });
  const page = await application.firstWindow();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const chat = page.frameLocator('iframe[title="当前对话"]');
  const card = chat.getByRole('button', {name:'预览文件：八字排盘工具.html', exact:true});
  await card.waitFor();
  if (process.env.LOCAL_PREVIEW_TOOL_ACTIVITY === '1') {
    assert.equal(await chat.locator('.run-artifacts .chat-local-file-card').count(),1,'Tool completion produces a file card without an assistant link');
    assert.equal(await chat.locator('.run-activity').count(),0,'Artifact stays visible when the reasoning chain is hidden');
  }
  if (process.env.LOCAL_FILE_CARD_SCREENSHOT) {
    await chat.locator('.message.being .content').screenshot({path:process.env.LOCAL_FILE_CARD_SCREENSHOT});
  }
  await card.click();
  const preview = page.frameLocator('iframe[title="HTML 文件预览"]');
  await preview.getByRole('heading', {name:'当前对话生成的页面'}).waitFor();
  await page.getByRole('button',{name:'打开所在文件夹',exact:true}).click();
  assert.equal(await application.evaluate(()=>globalThis.revealedFile), await import('node:fs/promises').then(fs=>fs.realpath(file)));
  // A hot-reloaded shell can expose a new button before the old main has its IPC handler.
  await application.evaluate(({ipcMain})=>ipcMain.removeHandler('beings:local-file-reveal'));
  await page.getByRole('button',{name:'打开所在文件夹',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'完全退出并重新启动客户端'}).waitFor();
  assert.equal(await preview.getByRole('heading',{name:'当前对话生成的页面'}).count(),1);
  await application.evaluate(({ipcMain})=>ipcMain.handle('beings:local-file-reveal',(event,p)=>{
    if(event.senderFrame!==event.sender.mainFrame)throw new Error('Untrusted');
    return globalThis.revealFile(p);
  }));
  await page.getByRole('button',{name:'打开所在文件夹',exact:true}).click();
  await page.getByRole('alert').waitFor({state:'detached'});
  assert.equal(await preview.locator('h1').evaluate(node=>getComputedStyle(node).color), 'rgb(12, 90, 120)');
  await preview.getByRole('button', {name:'0',exact:true}).click();
  assert.equal(await preview.locator('#counter').innerText(),'1');
  assert.equal(await preview.locator('#isolation').innerText(),'undefined:isolated');
  assert.equal(await page.locator('body').getAttribute('data-compromised'),null);
  assert.equal(await chat.getByRole('textbox', {name:'继续修改'}).inputValue(),'把标题改成蓝色');
  await page.getByRole('button', {name:'源码',exact:true}).click();
  assert.match(await page.locator('.client-file-body').innerText(), /<h1>当前对话生成的页面<\/h1>/);
  await writeFile(file, document('同一文件修改完成'));
  await page.getByRole('button', {name:'刷新',exact:true}).click();
  await preview.getByRole('heading', {name:'同一文件修改完成'}).waitFor();
  await page.getByRole('button', {name:'展开全部',exact:true}).click();
  assert.equal(await page.locator('.client-file-viewer.maximized').count(),1);
  await page.getByRole('button', {name:'恢复对话',exact:true}).click();
  await page.getByRole('button', {name:'关闭文件预览',exact:true}).click();
  await card.click({button:'right'});
  await chat.getByRole('menuitem', {name:'预览文件'}).click();
  await preview.getByRole('heading', {name:'同一文件修改完成'}).waitFor();
  assert.equal(await chat.getByRole('button', {name:'预览文件：missing.html',exact:true}).count(),0);
  assert.equal(await chat.locator('[data-local-file]').count(),2);
  await chat.getByText('missing.html',{exact:true}).click({button:'right'});
  assert.equal(await chat.getByRole('menuitem',{name:'预览文件'}).count(),0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name:'关闭文件预览',exact:true}).click();
  await rm(file);
  // Activate the already-rendered card without a focus check replacing it
  // between native pointer-down/up; normal pointer activation is tested above.
  await card.dispatchEvent('click');
  await card.waitFor({state:'detached'});
  assert.equal(await page.locator('iframe[title="HTML 文件预览"]').count(),0);
  await writeFile(path.join(workspace,'missing.html'),document('稍后生成的文件'));
  await chat.getByText('missing.html',{exact:true}).hover();
  await chat.getByRole('button',{name:'预览文件：missing.html',exact:true}).click();
  await preview.getByRole('heading',{name:'稍后生成的文件'}).waitFor();
  await page.getByRole('button', {name:'关闭文件预览',exact:true}).click();
  // Refocusing the chat while the click's async file check is pending must not cancel it.
  await chat.getByRole('button',{name:'预览文件：missing.html',exact:true}).evaluate(node=>{node.click();window.dispatchEvent(new Event('focus'));});
  await preview.getByRole('heading',{name:'稍后生成的文件'}).waitFor({timeout:3000});
  await rm(path.join(workspace,'missing.html'));
  await page.getByRole('button',{name:'打开所在文件夹',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'文件已移动或删除'}).waitFor();
  await page.getByRole('button', { name: '关闭文件预览', exact: true }).click();
  const pdfCard = chat.getByRole('button', { name: '预览文件：本机 PDF 预览.pdf', exact: true });
  const renderedPdf = () => page.waitForFunction(() => {
    const canvas = document.querySelector('canvas[aria-label="PDF 第 1 页"]');
    if (!canvas?.width) return false;
    const pixel = canvas.getContext('2d').getImageData(10, 10, 1, 1).data;
    return pixel[2] === 255 && pixel[0] === 0 && pixel[3] === 255;
  });
  await pdfCard.click(); await renderedPdf();
  await page.getByRole('button', { name: '关闭文件预览', exact: true }).click();
  await page.reload();
  await pdfCard.click(); await renderedPdf();
  const history = await page.evaluate(() => JSON.parse(localStorage.getItem('beings:recent-local-files')).entries);
  assert.equal(history.filter(entry => entry.path.endsWith('本机 PDF 预览.pdf')).length, 1);
  assert.equal(history[0].source, 'local');
  await page.getByRole('button', { name: '关闭文件预览', exact: true }).click();
  await pdfCard.hover();
  await mkdir('output/playwright', { recursive: true });
  await pdfCard.locator('..').screenshot({ path: 'output/playwright/local-pdf-card.png' });
  assert.deepEqual(errors,[]);
  console.log('PASS: local HTML availability, click, context menu, reveal folder, CSS/JS, isolation, refresh, same chat draft, missing/deleted files, native PDF card and preview after reload.');
} finally {
  await application?.close();
  await rm(dir,{recursive:true,force:true});
}
