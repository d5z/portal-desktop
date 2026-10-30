// The actual chat UI must keep background SBS separate from its selected room.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const assets = new Map(await Promise.all(['loom.html', 'chat.js', 'chat.css', 'highlight.css'].map(async file => ['/' + file, await readFile('desktop/generated/' + file)])));
const events = [
  {seq:1,event:'reasoning',data:{scene_id:null,text:'Background SBS work'}},
];
let finished = false;
const sends = [], stops = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = (data, status = 200) => {res.writeHead(status, {'Content-Type':'application/json'}); res.end(JSON.stringify(data));};
  if (assets.has(url.pathname)) {
    res.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
    return res.end(assets.get(url.pathname));
  }
  if (url.pathname === '/health') return res.end('OK fixture');
  if (url.pathname === '/api/history') return json({messages:[]});
  if (url.pathname === '/api/stream/active') return json({stream_id:'sbs-fixture',origin:'callback',scene_id:null,finished,next_seq:events.length+1,
    events:events.filter(event => event.seq > Number(url.searchParams.get('after') || 0))});
  if (url.pathname === '/api/chat/stream') {
    let body = ''; for await (const chunk of req) body += chunk;
    sends.push(JSON.parse(body)); return json({queued:true}, 202);
  }
  if (url.pathname === '/api/stop') {stops.push(true); return json({ok:true});}
  return json({sbs_enabled:true,being_name:'Fixture',presets:[]});
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || 'chrome'});
  const page = await browser.newPage();
  await page.addInitScript(() => localStorage.setItem('beings:show-reasoning','true'));

  page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/loom.html?scene_id=room&scene_label=Room&scene_strict=1`);
  await page.locator('.sbs-control-active').filter({hasText:'正在思考'}).waitFor();
  assert.equal(await page.locator('#input-area .composer-background-status').count(),0);
  assert.equal(await page.locator('#send-btn').getAttribute('aria-label'), '发送消息');
  await page.locator('#send-btn').click();
  assert.equal(stops.length, 0, 'Empty composer must never stop SBS');
  await page.getByLabel('SBS 状态与显示设置',{exact:true}).click();
  const sbs = page.getByRole('switch', {name:'显示 SBS 消息正文'});
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/sbs-header-menu.png'});
  await sbs.check();
  assert.equal(await page.locator('.run-activity[data-autonomous-origin="callback"]').count(),0);
  assert.equal(await page.getByRole('checkbox', {name:'显示全部场景'}).isChecked(), false);
  assert.equal(await page.locator('#send-btn').getAttribute('aria-label'), '发送消息');
  await sbs.uncheck();
  await page.locator('.run-activity[data-autonomous-origin="callback"]').waitFor({state:'detached'});
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.sbs-control-active').isVisible(),true);
  assert.equal(await page.locator('.sbs-control-trigger .sbs-control-dot').evaluate(el=>getComputedStyle(el).animationName),'sbs-control-pulse');
  await page.setViewportSize({width:375,height:640});
  await page.getByLabel('SBS 状态与显示设置',{exact:true}).click();
  const bounds = await page.locator('.sbs-control-panel').boundingBox();
  assert.ok(bounds.x>=0 && bounds.x+bounds.width<=375 && bounds.y+bounds.height<=640);
  await page.screenshot({path:'test-results/sbs-header-narrow.png'});
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:1280,height:720});
  await page.getByRole('checkbox', {name:'显示全部场景'}).check();
  assert.equal(await page.locator('.run-activity[data-autonomous-origin="callback"]').count(),0);
  assert.equal(await page.locator('#send-btn').getAttribute('aria-label'), '发送消息');
  events.push({seq:2,event:'message_stop',data:{scene_id:null}});
  await page.waitForFunction(() => !document.querySelector('.run-activity.running'));
  events.push({seq:3,event:'tool_use',data:{scene_id:null,name:'callback-continuation'}});
  await page.locator('.sbs-control-active').filter({hasText:'正在执行工具'}).waitFor();
  assert.equal(await page.locator('.run-activity[data-autonomous-origin="callback"]').count(), 0,
    'Callback details stay out of the transcript');
  const input = page.locator('#input');
  await input.fill('当前场景问题');
  const sent = page.waitForResponse(response => response.url().endsWith('/api/chat/stream'));
  await input.press('Enter');
  await sent;
  await page.getByText('SBS 自主回调进行中；消息已接收，正在切换到当前对话…', {exact:true}).waitFor();
  assert.equal(sends.length, 1);
  assert.equal(sends[0].scene_id, 'room');
  events.push({seq:4,event:'content_block_delta',data:{scene_id:'room',delta:{text:'当前场景回复'}}});
  await page.getByRole('button', {name:'停止处理',exact:true}).waitFor();
  await page.locator('.sbs-control-active').waitFor({state:'detached'});
  assert.equal(await page.locator('.run-activity.running').count(), 1);
  assert.equal(await page.locator('.composer-background-status').count(), 0);
  events.push({seq:5,event:'message_stop',data:{scene_id:'room'}});
  finished = true;
  await page.getByRole('button', {name:'发送消息',exact:true}).waitFor();
  await page.waitForFunction(() => !document.querySelector('.run-activity.running'));
  assert.equal(stops.length, 0);
  assert.deepEqual(errors, []);
  console.log('PASS: SBS status, all-scenes view, composer send/stop isolation and scene handoff.');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
