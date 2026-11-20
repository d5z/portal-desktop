// Real packaged Electron UI; replace only the OS login registration API so this
// test never enables startup for a temporary build or changes the user's login items.
import { launchDesktop } from './support/electron-lifecycle.mjs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { desktopExecutable } from './support/desktop.mjs';

const temporary = await mkdtemp(path.join(os.tmpdir(), 'beings-client-lifecycle-'));
let app;
try {
  let savedRuntime;
  if (process.platform === 'win32') {
    // An older installation can leave this metadata after Windows removes its
    // task. The real packaged client must still open its UI and keep the record.
    const label = 'town.beings.portal-desktop.portal.' + createHash('sha256').update(path.resolve(temporary)).digest('hex').slice(0, 16);
    savedRuntime = JSON.stringify({ label, root: path.join(temporary, 'old-runtime'), file: '', existing: false });
    await writeFile(path.join(temporary, 'portal-service.json'), savedRuntime);
  }
  app = await launchDesktop({ executablePath: await desktopExecutable(), env: { ...process.env, PORTAL_DESKTOP_USER_DATA: temporary } });
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    // Chromium warns about the initial about:blank iframe. Loaded chat uses a
    // distinct beings://chat origin, navigation guards and no desktop IPC.
    const initialFrameWarning = 'An iframe which has both allow-scripts and allow-same-origin for its sandbox attribute can escape its sandboxing.';
    if (['error', 'warning'].includes(message.type()) && message.text() !== initialFrameWarning) errors.push(message.text());
  });
  await page.getByRole('button', { name: '连接我的 Being' }).waitFor();
  if (savedRuntime) {
    const state = (await page.evaluate(() => window.beings.snapshot())).background;
    assert.equal(state.enabled, false); assert.equal(state.running, false);
    assert.equal(await readFile(path.join(temporary, 'portal-service.json'), 'utf8'), savedRuntime);
    console.log('PASS: packaged Windows client opens with saved Portal metadata and a missing scheduled task, retaining configuration without enabling background startup.');
  }
  const nativeChrome = await app.evaluate(({ BrowserWindow, Menu }) => {
    const window = BrowserWindow.getAllWindows()[0];
    return { menu: Menu.getApplicationMenu() !== null, menuBarVisible: window.isMenuBarVisible(), menuBarAutoHide: window.isMenuBarAutoHide() };
  });
  if (process.platform === 'win32') assert.deepEqual(nativeChrome, { menu: false, menuBarVisible: false, menuBarAutoHide: true });
  else assert.equal(nativeChrome.menu, true);
  assert.equal(await page.locator('#open-loom').count(), 0);
  await assert.rejects(page.evaluate(() => window.beings.openLoom()), /请先配置 Being/);
  assert.match(page.url(), /^beings:\/\/desktop\//);
  assert(await page.title());
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  await app.evaluate(({ shell, session }) => {
    session.fromPartition('persist:beings-browser').protocol.handle('https', () => new Response('<title>Town</title>Town guide', { headers: { 'content-type': 'text/html' } }));
    globalThis.townGuideTargets = [];
    shell.openExternal = async url => { globalThis.townGuideTargets.push(url); };
  });
  await page.locator('#options-trigger').click();
  await page.screenshot({ path: path.join(os.tmpdir(), 'beings-town-guide.png') });
  await page.locator('#options-help').click();
  await page.locator('#open-town-guide').click();
  await page.waitForFunction(() => !document.querySelector('#conversation-options').open);
  assert.equal((await page.evaluate(() => window.beings.browserState())).address, 'https://beings.town/');
  assert.deepEqual(await app.evaluate(() => globalThis.townGuideTargets), []);
  await page.evaluate(() => window.beings.browserAction('close'));
  await app.evaluate(({ app }) => {
    let enabled = false;
    app.getLoginItemSettings = () => ({ openAtLogin: enabled, executableWillLaunchAtLogin: enabled });
    app.setLoginItemSettings = input => { enabled = input.openAtLogin; };
  });
  await page.locator('#options-trigger').click();
  await page.locator('#client-settings-button').click();
  await page.locator('#settings-tab-general').click();
  const toggle = page.locator('#client-startup-input');
  if (process.platform === 'darwin' || process.platform === 'win32') {
    await toggle.check();
    await page.waitForFunction(() => !document.querySelector('#client-startup-input').disabled);
    assert.equal((await page.evaluate(() => window.beings.clientStartup())).enabled, true);
    await page.locator('#close-client-settings').click();
    await page.locator('#options-trigger').click();
    await page.locator('#client-settings-button').click();
  await page.locator('#settings-tab-general').click();
    await page.waitForFunction(() => !document.querySelector('#client-startup-input').disabled);
    assert.equal(await toggle.isChecked(), true);
    await page.screenshot({ path: path.join(os.tmpdir(), 'beings-client-settings.png') });
    await toggle.uncheck();
    await page.waitForFunction(() => !document.querySelector('#client-startup-input').disabled);
    assert.equal((await page.evaluate(() => window.beings.clientStartup())).enabled, false);
  } else {
    await page.getByText('安装后的 macOS 和 Windows 客户端支持开机自启。').waitFor();
    assert.equal(await toggle.isDisabled(), true);
  }
  await page.locator('#close-client-settings').click();
  const windowId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
  // Windows deliberately has no native menu; a second launch uses the same
  // showWindow callback as the tray and restores the existing window.
  if (process.platform === 'win32') await app.evaluate(({ app }) => app.emit('second-instance'));
  else await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(item => item.label === '客户端').submenu.items[0].click());
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id), windowId);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await app.evaluate(({ app }) => app.emit('second-instance'));
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
  assert.deepEqual(errors, []);
  const closed = app.waitForEvent('close');
  await page.locator('#options-trigger').click();
  await page.locator('#quit-client').click();
  await closed;
  app = null;
  console.log('PASS: client settings without Being connection, native chrome, login toggle/readback (OS API fixture), close hides, menu/second launch restores same window, explicit exit');
} finally {
  if (app) await app.close();
  await rm(temporary, { recursive: true, force: true });
}
