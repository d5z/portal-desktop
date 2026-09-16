// Exercise the styled menu through the real chat iframe, shell bridge and Electron clipboard.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchDesktop } from './support/electron-lifecycle.mjs';

const require = createRequire(import.meta.url);
const dir = await mkdtemp(path.join(tmpdir(), 'town-chat-menu-'));
async function bundle(name, contents, platform = 'node') {
  const result = await build({ stdin: { contents, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, platform, format: platform === 'node' ? 'cjs' : 'iife',
    external: platform === 'node' ? ['electron'] : [], jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' } });
  await writeFile(path.join(dir, name), result.outputFiles[0].contents);
}
await bundle('preload.cjs', "import './desktop/preload/preload';");
await bundle('shell.js', `
  import { createRoot } from 'react-dom/client';
  import { useRef } from 'react';
  import { useChatBridge } from './desktop/renderer/app/hooks/use-chat-bridge';
  import { AppModel } from './desktop/renderer/app/models/app';
  const model = new AppModel(window.beings);
  window.fixtureModel = model;
  function Shell() {
    const frame = useRef(null);
    useChatBridge(model, frame);
    return <iframe ref={frame} id="chat" src="beings://chat/?revision=fixture&scene_id=desktop-fixture&theme=light" />;
  }
  createRoot(document.getElementById('root')).render(<Shell />);
`, 'browser');
await bundle('main.cjs', `
  import { app, BrowserWindow, ipcMain, protocol } from 'electron';
  import { readFile } from 'node:fs/promises';
  import path from 'node:path';
  import { editChat } from './desktop/main/app/context-menu';
  import { configureLocalSession } from './desktop/main/app/protocol';
  app.setPath('userData', process.env.PORTAL_DESKTOP_USER_DATA);
  protocol.registerSchemesAsPrivileged([{ scheme: 'beings', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
  app.whenReady().then(async () => {
    configureLocalSession();
    protocol.handle('beings', async request => {
      const url = new URL(request.url);
      if (url.hostname === 'desktop') {
        if (url.pathname === '/shell.js') return new Response(await readFile(path.join(__dirname, 'shell.js')), { headers: { 'Content-Type': 'text/javascript' } });
        return new Response('<!doctype html><meta charset="utf-8"><style>html,body,#root{margin:0;height:100%;overflow:hidden}iframe{display:block;border:0;width:100%;height:100%}</style><div id="root"></div><script src="/shell.js"></script>', { headers: { 'Content-Type': 'text/html' } });
      }
      if (url.pathname === '/api/history') return Response.json({ messages: [{ seq: 1, role: 'being', content: '右键选择文字，复制到剪贴板。', at: new Date().toISOString() }] });
      if (url.pathname === '/api/status') return Response.json({ being_name: '菜单测试' });
      if (url.pathname === '/api/stream/active') return new Response(null, { status: 204 });
      if (url.pathname === '/api/llm/config') return Response.json({ sbs_enabled: false });
      const file = url.pathname === '/' ? 'loom.html' : url.pathname.slice(1);
      if (!['loom.html', 'chat.js', 'chat.css', 'highlight.css'].includes(file)) return new Response(null, { status: 404 });
      const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
      return new Response(await readFile(path.join(${JSON.stringify(path.resolve('desktop/generated'))}, file)), { headers: { 'Content-Type': type } });
    });
    const win = new BrowserWindow({ width: 1000, height: 780, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true } });
    globalThis.fixtureEdit = command => editChat(win, command);
    ipcMain.handle('beings:chat-edit', (event, command) => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== 'beings://desktop/') throw new Error('Untrusted sender');
      return editChat(win, command);
    });
    await win.loadURL('beings://desktop/');
  });
`);

const env = { ...process.env, PORTAL_DESKTOP_USER_DATA: path.join(dir, 'profile') };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await launchDesktop({ executablePath: require('electron'), args: [path.join(dir, 'main.cjs')], env, timeout: 20000 });
  const page = await app.firstWindow();
  page.setDefaultTimeout(5000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const frame = page.frameLocator('#chat'), input = frame.locator('#input');
  await input.waitFor();
  const child = page.frames().find(frame => frame.url().startsWith('beings://chat/'));
  await child.waitForFunction(() => performance.getEntriesByName('loom:ready').length > 0);
  await app.evaluate(async ({ clipboard, ClipboardItem }) => {
    globalThis.savedClipboard = await Promise.all((await clipboard.read()).map(async item => new ClipboardItem(
      Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)]))))));
  });
  const menu = frame.getByRole('menu', { name: '编辑菜单' });
  async function open(target = input) { await target.click({ button: 'right' }); await menu.waitFor(); }
  async function choose(label) { await menu.getByRole('menuitem', { name: new RegExp('^' + label) }).click(); await menu.waitFor({ state: 'hidden' }); }
  async function textIs(text) { await child.waitForFunction(text => document.querySelector('#input').value === text, text); }
  await input.fill('保留草稿与选区');
  await open();
  assert.equal(await menu.getByRole('menuitem').count(), 4);
  assert.equal(await menu.getByText(/撤销|重做/).count(), 0);
  assert.equal(await menu.getByRole('menuitem', { name: /^复制/ }).isDisabled(), true);
  assert.equal(await menu.evaluate(el => el === document.activeElement && getComputedStyle(el).outlineStyle === 'none'), true);
  await page.keyboard.press('ArrowDown');
  assert.equal(await menu.getByRole('menuitem', { name: /^粘贴/ }).evaluate(el => el === document.activeElement && el.matches(':focus-visible')), true);
  await page.keyboard.press('Escape');
  await open(); await page.keyboard.press('ArrowUp');
  assert.equal(await menu.getByRole('menuitem', { name: /^全选/ }).evaluate(el => el === document.activeElement), true);
  await choose('全选');
  assert.equal(await input.evaluate(el => el.selectionEnd - el.selectionStart), '保留草稿与选区'.length);
  await open(); await choose('复制');
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), '保留草稿与选区');
  await open(); await choose('剪切'); await textIs('');
  await open(); await choose('粘贴'); await textIs('保留草稿与选区');
  await input.evaluate(el => el.setSelectionRange(2, 4));
  await input.evaluate(el => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 500 })));
  await choose('粘贴'); await textIs('保留保留草稿与选区与选区');

  await app.evaluate(({ clipboard, ClipboardItem }) => clipboard.write([new ClipboardItem({ 'image/png': new Blob([
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  ], { type: 'image/png' }) })]));
  await open(); await choose('粘贴'); await frame.locator('#pending-files.active').waitFor();
  const message = frame.locator('.message.being .content').first();
  await message.evaluate(el => { const range = document.createRange(); range.selectNodeContents(el); getSelection().removeAllRanges(); getSelection().addRange(range); });
  await open(message);
  assert.equal(await menu.getByRole('menuitem').count(), 2);
  await choose('复制');
  assert.match(await app.evaluate(({ clipboard }) => clipboard.readText()), /右键选择文字/);

  await open(); await page.keyboard.press('Escape'); await menu.waitFor({ state: 'hidden' });
  assert.equal(await input.evaluate(el => el === document.activeElement), true);
  await open(); await page.keyboard.press('End'); await page.keyboard.press('Enter'); await menu.waitFor({ state: 'hidden' });
  await open(); await message.click(); await menu.waitFor({ state: 'hidden' });
  await open(); await child.evaluate(() => window.dispatchEvent(new Event('resize'))); await menu.waitFor({ state: 'hidden' });

  await mkdir('test-results', { recursive: true });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => window.fixtureModel.post({ type: 'beings:appearance', theme }), theme);
    await open();
    await page.screenshot({ path: 'test-results/chat-context-menu-' + theme + '.png' });
    const bounds = await menu.boundingBox(), viewport = await child.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height);
    await page.keyboard.press('Escape');
  }
  assert.equal(await app.evaluate(() => globalThis.fixtureEdit('undo')), false);
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.evaluate(() => { const el = document.createElement('input'); document.body.append(el); el.focus(); });
  assert.equal(await app.evaluate(() => globalThis.fixtureEdit('paste')), false);
  assert.deepEqual(errors, []);
  console.log('PASS: themed context menu, iframe copy/cut/text and image paste, selection replacement, keyboard/dismissal, bounds and command/frame restrictions.');
} catch (error) {
  if (app) {
    const page = await app.firstWindow();
    console.error(await page.frames().find(frame => frame.url().startsWith('beings://chat/'))?.evaluate(() => ({
      viewport: [innerWidth, innerHeight], menu: document.querySelector('.chat-context-menu')?.outerHTML,
      bounds: document.querySelector('.chat-context-menu')?.getBoundingClientRect().toJSON(),
    })));
    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/chat-context-menu-failure.png' });
  }
  throw error;
} finally {
  if (app) {
    await app.evaluate(async ({ clipboard }) => { if (globalThis.savedClipboard) await clipboard.write(globalThis.savedClipboard); });
    await app.close();
  }
}
