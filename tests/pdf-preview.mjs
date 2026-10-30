import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';

// A valid single-page PDF with a solid blue rectangle, requiring no font assets.
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents 4 0 R >>',
];
const stream='0 0 1 rg 0 0 200 200 re f\n';
objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
let pdf='%PDF-1.4\n';
const offsets=[0];
objects.forEach((object,index)=>{offsets.push(pdf.length);pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;});
const xref=pdf.length;
pdf+=`xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
  import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
  import {PdfPreview} from './desktop/renderer/app/components/pdf-preview';
  function App(){const[blob,setBlob]=useState(null);return <>
    <button onClick={()=>setBlob(new Blob([${JSON.stringify(pdf)}]))}>Open PDF</button>
    <button onClick={()=>setBlob(new Blob(['invalid']))}>Broken PDF</button>
    <button onClick={()=>setBlob(null)}>Close PDF</button>
    {blob&&<PdfPreview blob={blob}/>}</>;}
  createRoot(document.getElementById('root')).render(<App/>);
`},bundle:true,write:false,outdir:path.resolve('test-results/pdf-fixture'),entryNames:'fixture',chunkNames:'[name]-[hash]',
  splitting:true,format:'esm',platform:'browser',jsx:'automatic',minify:true,define:{'process.env.NODE_ENV':'"production"'}});
const files=new Map(bundle.outputFiles.map(file=>['/'+path.basename(file.path),file.contents]));
const worker=await readFile('node_modules/pdfjs-dist/build/pdf.worker.min.mjs');
const requests=[];
const server=createServer((req,res)=>{
  requests.push(req.url);
  if(req.url==='/pdf.worker.min.js'){res.setHeader('Content-Type','text/javascript');return res.end(worker);}
  if(files.has(req.url)){res.setHeader('Content-Type','text/javascript');return res.end(files.get(req.url));}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><style>.pdf-pages{height:400px;overflow:auto}.pdf-page{width:300px}canvas{width:100%}</style><div id="root"></div><script type="module" src="/fixture.js"></script>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button',{name:'Open PDF',exact:true}).waitFor();
  assert.equal(requests.some(url=>url.startsWith('/pdf')),false,'Initial page must not request PDF engine or worker');
  const rendered=()=>page.waitForFunction(()=>{
    const canvas=document.querySelector('canvas');if(!canvas?.width)return false;
    const pixel=canvas.getContext('2d').getImageData(10,10,1,1).data;
    return pixel[2]===255 && pixel[0]===0 && pixel[3]===255;
  });
  await page.getByRole('button',{name:'Open PDF',exact:true}).click();
  await rendered();
  assert.ok(requests.some(url=>url.startsWith('/pdf-')),'First preview loads the engine chunk');
  assert.ok(requests.includes('/pdf.worker.min.js'));
  await page.getByRole('button',{name:'Broken PDF',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'PDF 无法预览'}).waitFor();
  await page.getByRole('button',{name:'Close PDF',exact:true}).click();
  assert.equal(await page.locator('canvas').count(),0);
  await page.getByRole('button',{name:'Open PDF',exact:true}).click();
  await rendered();
  assert.deepEqual(errors,[]);
  console.log('PASS: PDF engine and worker deferred until preview, rendered pixels, corrupt-file fallback, close and reopen.');
} finally {
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
