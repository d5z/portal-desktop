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
  import { useRef, useState } from 'react';
  import { useChatBridge } from './desktop/renderer/app/hooks/use-chat-bridge';
  import { AppModel } from './desktop/renderer/app/models/app';
  import { EditContextMenu } from './desktop/renderer/shared/components/context-menu';
  import { Dialog } from './desktop/renderer/shared/components/dialog';
  import { TownFeed } from './desktop/renderer/town/components/feed';
  const model = new AppModel(window.beings);
  window.fixtureModel = model;
  function Shell() {
    const frame = useRef(null);
    const [place, setPlace] = useState('');
    useChatBridge(model, frame);
    model.town.view = place;
    return <><iframe ref={frame} id="chat" src="beings://chat/?revision=fixture&scene_id=desktop-fixture&theme=light" />
      <div style={{ position: 'fixed', top: 0, left: 0 }}>
        <button onClick={() => setPlace('bonfire')}>打开篝火</button><button onClick={() => setPlace('firesides')}>打开围炉</button>
      </div>
      <Dialog id="place-sheet" open={!!place} onClose={() => setPlace('')}>
        <h2>{place === 'bonfire' ? '篝火' : '围炉'}</h2>
        <TownFeed key={place} town={model.town} filterKey={place} data={{ messages: [{ seq: 1, being: 'Willow', message: '**弹窗正文** 可以复制。', at: new Date().toISOString() }] }} />
        <textarea aria-label="弹窗草稿" defaultValue="弹窗输入测试" />
      </Dialog>
      <EditContextMenu edit={command => window.fixtureEditFailure ? Promise.resolve(false) : window.beings.editSelection(command)} rootSelector="dialog[open]" selectionSelector=".reading-text, .dialog-body, #town-body" />
    </>;
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
        if (url.pathname === '/shell.css') return new Response(await readFile(${JSON.stringify(path.resolve('desktop/renderer/app/styles.css'))}), { headers: { 'Content-Type': 'text/css' } });
        if (url.pathname === '/shell.js') return new Response(await readFile(path.join(__dirname, 'shell.js')), { headers: { 'Content-Type': 'text/javascript' } });
        return new Response('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/shell.css"><style>html,body,#root{margin:0;height:100%;width:100%;overflow:hidden}iframe{display:block;border:0;width:100%;height:100%}</style><div id="root"></div><script src="/shell.js"></script>', { headers: { 'Content-Type': 'text/html' } });
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
    globalThis.fixtureEdit = (command, scope) => editChat(win, command, scope);
    ipcMain.handle('beings:chat-edit', (event, command) => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== 'beings://desktop/') throw new Error('Untrusted sender');
      return editChat(win, command);
    });
    ipcMain.handle('beings:selection-edit', (event, command) => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== 'beings://desktop/') throw new Error('Untrusted sender');
      return editChat(win, command, 'shell');
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
    // Electron can return an item with no formats for an empty native clipboard.
    // Such items carry no data and cannot be passed to the ClipboardItem constructor.
    globalThis.snapshotClipboard = async () => Promise.all((await clipboard.read()).filter(item => item.types.length > 0).map(async item => new ClipboardItem(
      Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)]))))));
    globalThis.savedClipboard = await globalThis.snapshotClipboard();
  });
  // A fresh Windows runner can expose an empty item, rather than an empty array.
  assert.deepEqual(await app.evaluate(async ({ clipboard }) => {
    await clipboard.clear();
    const empty = await globalThis.snapshotClipboard();
    await clipboard.write(empty);
    return empty.map(item => item.types);
  }), []);
  assert.deepEqual(await app.evaluate(async ({ clipboard, ClipboardItem }) => {
    await clipboard.write([new ClipboardItem({
      'text/plain': new Blob(['剪贴板备份测试'], { type: 'text/plain' }),
      'text/html': new Blob(['<b>剪贴板备份测试</b>'], { type: 'text/html' }),
    })]);
    const saved = await globalThis.snapshotClipboard();
    await clipboard.clear();
    await clipboard.write(saved);
    const restored = (await clipboard.read()).find(item => item.types.includes('text/html'));
    return { text: await clipboard.readText(), hasHtml: (await (await restored.getType('text/html')).text()).includes('<b>剪贴板备份测试</b>') };
  }), { text: '剪贴板备份测试', hasHtml: true });
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
  await app.evaluate(async ({ clipboard }) => {
    const image = await globalThis.snapshotClipboard();
    await clipboard.clear();
    await clipboard.write(image);
  });
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
  assert.equal(await app.evaluate(() => globalThis.fixtureEdit('copy', 'shell')), false);
  for (const [place, theme] of [['篝火', 'light'], ['围炉', 'dark']]) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.getByRole('button', { name: '打开' + place }).click();
    const dialog = page.locator('#place-sheet'), body = dialog.locator('.reading-text');
    const popup = page.getByRole('menu', { name: '编辑菜单' });
    await body.click({ button: 'right' });
    await popup.waitFor();
    assert.equal(await popup.getByRole('menuitem').count(), 2);
    assert.equal(await popup.evaluate(el => el === document.activeElement && el.matches(':popover-open') && getComputedStyle(el).outlineStyle === 'none'), true);
    await popup.getByRole('menuitem', { name: /^全选/ }).click();
    assert.equal(await page.evaluate(() => getSelection().toString().trim()), '弹窗正文 可以复制。');
    await body.click({ button: 'right' });
    await page.screenshot({ path: 'test-results/dialog-context-menu-' + theme + '.png', animations: 'disabled' });
    await popup.getByRole('menuitem', { name: /^复制/ }).click();
    assert.equal((await app.evaluate(({ clipboard }) => clipboard.readText())).trim(), '弹窗正文 可以复制。');
    const draft = dialog.getByRole('textbox', { name: '弹窗草稿' });
    await draft.click({ button: 'right' });
    await popup.getByRole('menuitem', { name: /^全选/ }).click();
    await draft.click({ button: 'right' });
    await popup.getByRole('menuitem', { name: /^粘贴/ }).click();
    await page.waitForFunction(() => document.querySelector('textarea').value.trim() === '弹窗正文 可以复制。');
    await draft.click({ button: 'right' });
    await page.keyboard.press('Escape');
    await popup.waitFor({ state: 'hidden' });
    assert.equal(await dialog.evaluate(el => el.open), true);
    assert.equal(await draft.evaluate(el => el === document.activeElement), true);
    await page.evaluate(() => { window.fixtureEditFailure = true; });
    await draft.click({ button: 'right' });
    await popup.getByRole('menuitem', { name: /^粘贴/ }).click();
    const notice = dialog.getByRole('status').filter({ hasText: '操作未完成' });
    await notice.waitFor();
    assert.equal(await notice.evaluate(el => el.matches(':popover-open')), true);
    await page.evaluate(() => { window.fixtureEditFailure = false; });
    await draft.click({ button: 'right' });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
  }
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.evaluate(() => { const el = document.createElement('input'); document.body.append(el); el.focus(); });
  assert.equal(await app.evaluate(() => globalThis.fixtureEdit('paste')), false);
  assert.deepEqual(errors, []);
  console.log('PASS: empty/text/HTML/image clipboard backup, themed context menu, iframe editing, bonfire/fireside modal copy/select-all/paste, modal stacking and Escape, keyboard/dismissal, bounds and command/frame restrictions.');
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
    try {
      await app.evaluate(async ({ clipboard }) => { if (globalThis.savedClipboard) await clipboard.write(globalThis.savedClipboard); });
    } finally { await app.close(); }
  }
}
