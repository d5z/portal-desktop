// Regression checks for shared modal feedback and workbook tab behavior.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {readShellStyles} from './support/shell-styles.mjs';
const bundle=await build({stdin:{contents:`
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Dialog} from './desktop/renderer/shared/components/dialog';
import {XlsxPreview} from './desktop/renderer/app/components/xlsx-preview';
window.Worker=class {
  postMessage(buffer){const second=new Uint8Array(buffer)[0]===2;queueMicrotask(()=>this.onmessage?.({data:{sheets:(second?['新工作表']:['一月','二月']).map(name=>({name,widths:[100],rows:[[{text:name}]],truncated:false}))}}));}
  terminate(){}
};
function Fixture(){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[blob,setBlob]=useState(()=>new Blob([new Uint8Array([1])]));
 window.setBusy=setBusy;
 return <><button id="open" onClick={()=>setOpen(true)}>打开</button>
 <button id="replace" onClick={()=>setBlob(new Blob([new Uint8Array([2])]))}>另一文件</button>
 <XlsxPreview blob={blob}/>
 <Dialog id="fixture-dialog" open={open} busy={busy} onClose={()=>setOpen(false)} aria-label="登记设置">
  <form className="dialog-form"><div className="dialog-heading"><h2>登记设置</h2><button type="button" aria-label="关闭" disabled={busy} onClick={()=>setOpen(false)}>关闭</button></div>
  <div className="dialog-body"><label htmlFor="name">姓名</label><input id="name"/><div style={{height:900}}>长内容</div></div>
  <div className="dialog-footer"><button type="button" disabled={busy}>保存</button></div></form>
 </Dialog></>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'esm',jsx:'automatic'});
const css=await readShellStyles();
const server=createServer((req,res)=>{
 if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');return res.end(bundle.outputFiles[0].text);}
 if(req.url==='/app.css'){res.setHeader('Content-Type','text/css');return res.end(css);}
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<link rel="stylesheet" href="/app.css"><div id="root" style="width:100%;height:100%"></div><script type="module" src="/app.js"></script>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:760,height:500}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 const tabs=page.getByRole('tab');
 await tabs.first().focus();await page.keyboard.press('ArrowRight');
 assert.equal(await tabs.nth(1).getAttribute('aria-selected'),'true');
 assert.equal(await tabs.first().getAttribute('tabindex'),'-1');
 assert.equal(await page.getByRole('tabpanel').getAttribute('aria-labelledby'),await tabs.nth(1).getAttribute('id'));
 await page.locator('#replace').click();await page.getByRole('tab',{name:'新工作表'}).waitFor();
 assert.equal(await page.getByRole('tab',{name:'新工作表'}).getAttribute('aria-selected'),'true','New workbook resets the old active index');
 const dialog=page.locator('#fixture-dialog');
 for(const reducedMotion of ['no-preference','reduce']){
  await page.emulateMedia({reducedMotion});
  await page.locator('#open').click();await dialog.waitFor({state:'visible'});
  const duration=await dialog.evaluate(n=>getComputedStyle(n).transitionDuration);
  assert.equal(duration.includes('0.14s'),reducedMotion==='no-preference');
  await page.waitForFunction(()=>document.querySelector('#fixture-dialog').getAnimations().length===0);
  const body=dialog.locator('.dialog-body');
  assert.ok(await body.evaluate(n=>n.scrollHeight>n.clientHeight),'Form body scrolls while its actions remain visible');
  const save=await dialog.getByRole('button',{name:'保存'}).boundingBox();assert.ok(save.y+save.height<500);
  await page.evaluate(()=>setBusy(true));await page.waitForFunction(()=>document.querySelector('#fixture-dialog').getAttribute('aria-busy')==='true');await page.keyboard.press('Escape');
  assert.equal(await dialog.getAttribute('open'),'');assert.equal(await dialog.getAttribute('aria-busy'),'true');
  await page.evaluate(()=>setBusy(false));await page.waitForFunction(()=>!document.querySelector('#fixture-dialog').hasAttribute('aria-busy'));await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  assert.equal(await page.locator('#open').evaluate(n=>n===document.activeElement),true);
  assert.equal(await dialog.evaluate(n=>n.getAnimations({subtree:true}).length),0,'A closed modal must not retain top-layer exit animations');
  await page.locator('#open').click();await dialog.waitFor({state:'visible'});
  await dialog.getByRole('button',{name:'关闭',exact:true}).click();
  assert.equal(await dialog.evaluate(n=>getComputedStyle(n).display),'none','Closing immediately removes the modal surface');
  await page.locator('#replace').click();
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: shared modal busy/Escape/focus/motion, reachable actions, workbook keyboard tabs and reset across files.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
