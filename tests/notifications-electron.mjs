// Run the real packaged client with an isolated profile and local SSE fixtures.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, unlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { launchDesktop } from './support/electron-lifecycle.mjs';
import { desktopExecutable } from './support/desktop.mjs';

const directory = await mkdtemp(path.join(os.tmpdir(), 'town-notifications-electron-'));
let app;
try {
  app = await launchDesktop({ executablePath: await desktopExecutable(), env: { ...process.env, PORTAL_DESKTOP_USER_DATA: directory } });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('#options-trigger').click();
  const version = await app.evaluate(({ app }) => app.getVersion());
  await page.getByText(`v${version}`, { exact: true }).waitFor();
  assert.equal(await page.locator('#client-version').textContent().then(text => text.trim()), `v${version}`);
  await mkdir('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/client-version-menu.png' });
  await page.locator('#client-settings-button').click();
  await page.locator('#settings-tab-general').click();
  assert.equal(await page.locator('#notification-test').count(), 0);
  await assert.rejects(page.evaluate(() => window.beings.testNotification()), /No handler registered/);
  assert.equal(await page.locator('#notification-enabled').isChecked(), false);
  assert.equal(await page.locator('#notification-mail').isChecked(), false);
  assert.equal(await page.locator('#notification-firesides').isChecked(), false);
  assert.equal(await page.locator('#notification-bonfire').isChecked(), false);
  assert.equal(await page.locator('#notification-mail').isDisabled(), true);
  // Keep real persistence, but expose the pending-save state even on fast disks.
  await app.evaluate(() => {
    const fs = process.getBuiltinModule('node:fs/promises');
    const writeFile = fs.writeFile;
    globalThis.notificationDelayedWrites = 0;
    globalThis.restoreNotificationWrites = () => { fs.writeFile = writeFile; };
    fs.writeFile = async function (file, ...args) {
      if (String(file).endsWith('notifications.json.tmp')) {
        globalThis.notificationDelayedWrites++;
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      return writeFile.call(this, file, ...args);
    };
  });
  await page.locator('#notification-enabled').check();
  await page.locator('#notification-mail').check();
  await page.locator('#notification-bonfire').check();
  await page.waitForFunction(async () => (await window.beings.notifications()).preferences.bonfire);
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'notifications.json'), 'utf8')), { enabled: true, mail: true, firesides: false, bonfire: true });
  assert.equal(await app.evaluate(() => {
    globalThis.restoreNotificationWrites();
    return globalThis.notificationDelayedWrites;
  }), 3);
  await app.evaluate(({ Notification, protocol }) => {
    globalThis.notificationEvents = [];
    globalThis.notificationObjects = [];
    const show = Notification.prototype.show;
    Notification.prototype.show = function () {
      globalThis.notificationObjects.push(this);
      globalThis.notificationEvents.push({ event: 'requested', title: this.title });
      for (const event of ['show', 'failed', 'click']) this.on(event, () => globalThis.notificationEvents.push({ event, title: this.title }));
      return show.call(this);
    };
    protocol.handle('https', request => {
      const url = new URL(request.url);
      if (url.pathname === '/api/client/stream') return new Response(new ReadableStream({ start(controller) {
        globalThis.notificationStream = controller;
        controller.enqueue(new TextEncoder().encode('event: hello\ndata: {"town_id":"t_NotificationFixture","anonymous":false,"token_kind":"client"}\n\n'));
      } }), { headers: { 'Content-Type': 'text/event-stream' } });
      if (url.pathname === '/api/messages') return Response.json({ messages: [{ id: 'dm-fixture', sender_town_id: 't_River', recipient_town_id: 't_NotificationFixture', content: '通知测试私信' }] });
      if (url.pathname === '/api/fireside/list') return Response.json({ owned: [{ id: 11, name: '另一个围炉', member_count: 1 }], joined: [{ id: 10, name: '通知目标围炉', member_count: 2 }] });
      if (url.pathname === '/api/fireside/hear') return Response.json({ messages: [{ seq: 1, town_id: 't_River', message: '通知测试围炉' }] });
      if (url.pathname === '/api/fireside/members') return Response.json([]);
      return Response.json({});
    });
  });
  await page.evaluate(() => window.beings.saveTownToken('notification-fixture-token'));
  await page.waitForFunction(async () => (await window.beings.townLive()).phase === 'connected');
  const emit = async (type, data, hidden = true) => app.evaluate(({ BrowserWindow }, input) => {
    if (input.hidden) BrowserWindow.getAllWindows()[0].hide();
    globalThis.notificationStream.enqueue(new TextEncoder().encode('event: ' + input.type + '\ndata: ' + JSON.stringify(input.data) + '\n\n'));
  }, { type, data, hidden });
  await emit('dm', { id: 'incoming', sender_town_id: 't_River', recipient_town_id: 't_NotificationFixture', content: '不能显示在通知中的私密正文' });
  await page.waitForFunction(async () => (await window.beings.townLive()).versions.mail === 1);
  assert.equal(await app.evaluate(() => globalThis.notificationObjects.length), 1);
  // Simulate the OS click event to verify the real main/preload/renderer route.
  await app.evaluate(() => globalThis.notificationObjects[0].emit('click'));
  await page.getByText('通知测试私信', { exact: true }).waitFor();
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
  await emit('dm', { id: 'self', sender_town_id: 't_NotificationFixture', recipient_town_id: 't_River' });
  await emit('fireside', { seq: 2, fireside_id: 10, town_id: 't_River' });
  await page.waitForFunction(async () => (await window.beings.townLive()).versions.firesides === 1);
  assert.equal(await app.evaluate(() => globalThis.notificationObjects.length), 1);
  await page.evaluate(() => window.beings.notifications({ firesides: true }));
  await emit('fireside', { seq: 3, fireside_id: 10, town_id: 't_River' });
  await page.waitForFunction(async () => (await window.beings.townLive()).versions.firesides === 2);
  assert.equal(await app.evaluate(() => globalThis.notificationObjects.length), 2);
  await app.evaluate(() => globalThis.notificationObjects[1].emit('click'));
  await page.getByText('通知测试围炉', { exact: true }).waitFor();
  await page.locator('.fireside-room.selected[data-id="10"]').waitFor();
  assert.equal(await page.locator('.fireside-room').count(), 2);
  assert.equal(await page.locator('.fireside-thread-heading h2').textContent(), '通知目标围炉');
  assert.equal(await page.getByText('来自对话中的内容链接', { exact: true }).count(), 0);
  console.log('Native notification events:', await app.evaluate(() => globalThis.notificationEvents));
  await page.locator('#back-to-chat').click();
  await page.locator('#options-trigger').click();
  await page.locator('#client-settings-button').click();
  await page.locator('#settings-tab-general').click();
  await mkdir('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/notifications-electron.png' });
  assert.deepEqual(errors, []);
  await app.close(); app = undefined;
  // Reopen only local preferences, without sending the fixture token to Town.
  await unlink(path.join(directory, 'town-credential.json'));
  app = await launchDesktop({ executablePath: await desktopExecutable(), env: { ...process.env, PORTAL_DESKTOP_USER_DATA: directory } });
  const reopened = await app.firstWindow();
  const settings = await reopened.evaluate(() => window.beings.notifications());
  assert.deepEqual(settings.preferences, { enabled: true, mail: true, firesides: true, bonfire: true });
  console.log('PASS: actual Electron settings, persistence across restart, native notification requests, SSE category/self filtering and click-to-inbox/fireside navigation. Profile:', directory);
} finally {
  await app?.close();
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('town-notifications-electron-'))
    await rm(resolved, { recursive: true, force: true });
}
