import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const bundle=await build({plugins: [{ name: 'attachment-protocol-fixture', setup(builder) {
  // Plain Chromium serves the Electron attachment request over the fixture's HTTP origin.
  builder.onLoad({ filter: /attachment-view\.ts$/ }, async args => ({
    loader: 'ts', contents: (await readFile(args.path, 'utf8')).replaceAll("'beings://chat'", 'location.origin'),
  }));
} }], stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{useNearViewport}from'./desktop/renderer/shared/hooks/use-near-viewport';
import{AttachmentAudio}from'./desktop/renderer/chat/components/attachment-audio';
function Deferred({immediate}){const{ref,ready}=useNearViewport();return <div ref={ref} id="deferred">{ready?<span id="loaded">Loaded once</span>:'Deferred'}</div>;}
function UploadTransition({immediate}){const{ref,ready}=useNearViewport(immediate);return <div ref={ref} id="upload-transition">{ready?<span id="retained">Live preview</span>:'Pending'}</div>;}
function App(){const[immediate,setImmediate]=useState(false);window.activate=()=>setImmediate(true);window.finish=()=>setImmediate(false);return <>
<AttachmentAudio part={{type:'attachment', attachment_id:'audio_fixture', name:'fixture.wav', mime:'audio/wav', size:8044, parse_status:'none'}} endpoint="https://fixture.test"/>
<div id="messages" style={{height:240,overflow:'auto'}}><div style={{height:1800}}>spacer</div><Deferred/><UploadTransition immediate={immediate}/></div></>;}
createRoot(document.getElementById('root')).render(<App/>);
`},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.scss':'empty'},define:{'process.env.NODE_ENV':'"production"'}});
const wav=Buffer.alloc(44+8000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(8000,40);
let audioReads=0;
const server = createServer((request, response) => {
  const { pathname } = new URL(request.url, 'http://localhost');
  if (pathname === '/fixture.js') {
    response.setHeader('Content-Type', 'text/javascript');
    return response.end(bundle.outputFiles[0].text);
  }
  if (pathname === '/api/attachments/audio_fixture/content') {
    audioReads++;
    response.setHeader('Content-Type', 'audio/wav');
    return response.end(wav);
  }
  if (pathname.startsWith('/api/')) {
    response.setHeader('Content-Type', 'application/json');
    return response.end('{}');
  }
  response.setHeader('Content-Type', 'text/html');
  response.end('<!doctype html><div id="root"></div><script src="/fixture.js"></script>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
  browser=await chromium.launch({headless:true,channel:'chrome'});const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await page.getByText('Deferred',{exact:true}).waitFor();await page.waitForTimeout(150);
  assert.equal(audioReads,0,'Mounted audio neither downloads nor decodes before playback');
  assert.equal(await page.locator('#loaded').count(),0);
  await page.evaluate(()=>window.activate());await page.locator('#retained').waitFor();
  await page.locator('#retained').evaluate(el=>el.dataset.retained='yes');await page.evaluate(()=>window.finish());
  assert.equal(await page.locator('#retained').getAttribute('data-retained'),'yes','Upload completion never unmounts an already activated preview');
  await page.locator('#deferred').scrollIntoViewIfNeeded();await page.locator('#loaded').waitFor();await page.locator('#loaded').evaluate(el=>el.dataset.retained='yes');
  await page.locator('#messages').evaluate(el=>el.scrollTop=0);await page.waitForTimeout(100);
  assert.equal(await page.locator('#loaded').getAttribute('data-retained'),'yes','Scrolling away retains activated content');
  await page.getByRole('button',{name:'播放 fixture.wav',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('audio').readyState>=2);assert.ok(audioReads>0);
  assert.deepEqual(errors,[]);console.log('PASS: no audio fetch before play; deferred content activates near viewport and retains DOM through scrolling and upload transition.');
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
