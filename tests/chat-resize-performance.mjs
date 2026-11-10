// Exercise continuous window resizing against the real shell and bundled chat.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const server = spawn(process.execPath, ['tests/workspace-layout.mjs'], {
  env: { ...process.env, PORTAL_LAYOUT_PREVIEW: '1', PORTAL_LAYOUT_PORT: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let browser;
try {
  const origin = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Preview startup timed out')), 30000);
    let output = '';
    server.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/Layout preview: (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
    server.stderr.on('data', chunk => process.stderr.write(chunk));
    server.once('exit', code => { clearTimeout(timeout); reject(new Error(`Preview exited: ${code}`)); });
  });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/history**', route => route.fulfill({ json: {
    messages: Array.from({ length: 120 }, (_, i) => ({
      seq: i + 1, role: i % 2 ? 'being' : 'user', scene_id: 'desktop-fixture',
      content: `历史消息 ${i}\n\n` + '连续调整窗体大小时，长对话应保持流畅并保留阅读位置。'.repeat(18),
      at: '2026-11-04T08:00:00Z',
    })),
  } }));
  await page.goto(origin);
  await page.frameLocator('#chat-frame').locator('.message').nth(9).waitFor();
  const chat = page.frames().find(frame => frame.url().includes('/loom.html'));
  await chat.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]));
  const measure = async reading => {
    const anchor = await chat.evaluate(reading => {
      const messages = document.querySelector('#messages');
      if (reading) {
        messages.dispatchEvent(new WheelEvent('wheel', { deltaY: -300, bubbles: true }));
        messages.scrollTop = messages.scrollHeight / 2;
        messages.dispatchEvent(new Event('scroll'));
      }
      const top = messages.getBoundingClientRect().top;
      window.resizeAnchor = [...messages.querySelectorAll('.message p')].find(node => node.getBoundingClientRect().bottom > top + 90);
      window.resizeStyleWrites = 0;
      window.resizeObserver = new MutationObserver(records => { window.resizeStyleWrites += records.length; });
      window.resizeObserver.observe(document.querySelector('.chat-root'), { attributes: true, attributeFilter: ['style'] });
      return window.resizeAnchor?.getBoundingClientRect().top - top;
    }, reading);
    await page.evaluate(() => {
      window.resizeDrawerNotifications = 0;
      window.countDrawerNotification = () => window.resizeDrawerNotifications++;
      window.addEventListener('beings:drawer-motion', window.countDrawerNotification);
    });
    const before = await metrics();
    for (let i = 0; i < 60; i++) {
      await page.setViewportSize({ width: 1600 + i * 2, height: 900 - i * 2 });
      await chat.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    const after = await metrics();
    const drawerNotifications = await page.evaluate(() => {
      window.removeEventListener('beings:drawer-motion', window.countDrawerNotification);
      return window.resizeDrawerNotifications;
    });
    assert.equal(drawerNotifications, 0, 'Resizing idle panes must not repeat drawer completion notifications');
    const geometry = await chat.evaluate(() => {
      window.resizeObserver.disconnect();
      const messages = document.querySelector('#messages');
      const input = document.querySelector('#input-area').getBoundingClientRect();
      return {
        styleWrites: window.resizeStyleWrites,
        height: document.querySelector('#app').getBoundingClientRect().height,
        viewportHeight: innerHeight,
        inputBottom: input.bottom,
        bottomGap: messages.scrollHeight - messages.scrollTop - messages.clientHeight,
        anchor: window.resizeAnchor?.getBoundingClientRect().top - messages.getBoundingClientRect().top,
      };
    });
    const result = { reading, ...geometry, drawerNotifications, taskMs: Math.round((after.TaskDuration - before.TaskDuration) * 1000), layoutMs: Math.round((after.LayoutDuration - before.LayoutDuration) * 1000) };
    console.log(JSON.stringify(result));
    if (!process.env.RESIZE_BASELINE) assert.equal(geometry.styleWrites, 0, 'Desktop resizing must use CSS without per-pixel root style updates');
    assert.ok(Math.abs(geometry.height - geometry.viewportHeight) < 2, 'Chat tracks the iframe height');
    assert.ok(geometry.inputBottom <= geometry.viewportHeight, 'Composer stays inside the viewport');
    if (reading) assert.ok(Math.abs(geometry.anchor - anchor) < 2, 'Resizing preserves the reading anchor');
    else assert.ok(geometry.bottomGap < 2, 'Resizing preserves bottom-follow');
  };
  await measure(false);
  await page.setViewportSize({ width: 1600, height: 900 });
  await chat.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await measure(true);
  // High polling-rate pointers can deliver several moves before the next paint.
  await page.getByRole('button', { name: '资料库', exact: true }).click();
  const divider = page.getByRole('separator', { name: '调整 Being 信息宽度', exact: true });
  await divider.evaluate(node => {
    node.addEventListener('pointerdown', event => { window.resizePointer = event.pointerId; }, { once: true });
    const setItem = Storage.prototype.setItem;
    window.panelWrites = 0;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('beings:panel:')) window.panelWrites++;
      return setItem.call(this, key, value);
    };
  });
  const handle = await divider.boundingBox();
  const startX = handle.x + handle.width / 2, y = handle.y + 100;
  const startWidth = await page.locator('#being-info').evaluate(node => node.getBoundingClientRect().width);
  await page.mouse.move(startX, y);
  await page.mouse.down();
  const immediateWrites = await divider.evaluate((node, { startX, y }) => {
    for (let i = 1; i <= 40; i++) node.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: window.resizePointer, clientX: startX - i * 2, clientY: y, bubbles: true,
    }));
    return window.panelWrites;
  }, { startX, y });
  await page.waitForFunction(width => document.querySelector('#being-info').getBoundingClientRect().width === width, startWidth + 80);
  const burstWrites = await page.evaluate(() => panelWrites);
  await divider.evaluate((node, { startX, y }) => {
    node.dispatchEvent(new PointerEvent('pointermove', { pointerId: window.resizePointer, clientX: startX - 100, clientY: y, bubbles: true }));
    node.dispatchEvent(new PointerEvent('pointerup', { pointerId: window.resizePointer, bubbles: true }));
  }, { startX, y });
  await page.mouse.up();
  await page.waitForFunction(width => document.querySelector('#being-info').getBoundingClientRect().width === width, startWidth + 100);
  console.log(JSON.stringify({ immediateWrites, burstWrites, finalWrites: await page.evaluate(() => panelWrites) }));
  if (!process.env.RESIZE_BASELINE) {
    assert.equal(immediateWrites, 0, 'Pointer bursts defer synchronous storage until paint');
    assert.equal(burstWrites, 1, 'One pointer burst commits only its latest width');
    assert.equal(await page.evaluate(() => panelWrites), 2, 'Pointer release flushes the last pending width once');
  }
  assert.equal(await divider.getAttribute('data-resizing'), null, 'Release clears the drag overlay');
  await page.reload();
  await page.getByRole('button', { name: '资料库', exact: true }).click();
  assert.equal(await page.locator('#being-info').evaluate(node => node.getBoundingClientRect().width), startWidth + 100, 'Final drag width is persisted');
  await divider.press('ArrowLeft');
  assert.equal(await page.locator('#being-info').evaluate(node => node.getBoundingClientRect().width), startWidth + 124, 'Keyboard resize stays immediate');
  await divider.dblclick();
  assert.equal(await page.locator('#being-info').evaluate(node => node.getBoundingClientRect().width), 320, 'Double click restores the default width');
  for (const end of ['pointercancel', 'blur']) {
    await divider.evaluate(node => node.addEventListener('pointerdown', event => { window.resizePointer = event.pointerId; }, { once: true }));
    const bounds = await divider.boundingBox(), x = bounds.x + bounds.width / 2;
    const before = await page.locator('#being-info').evaluate(node => node.getBoundingClientRect().width);
    await page.mouse.move(x, bounds.y + 100);
    await page.mouse.down();
    await divider.evaluate((node, { x, end }) => {
      node.dispatchEvent(new PointerEvent('pointermove', { pointerId: window.resizePointer, clientX: x - 20, bubbles: true }));
      if (end === 'blur') window.dispatchEvent(new Event('blur'));
      else node.dispatchEvent(new PointerEvent(end, { pointerId: window.resizePointer, bubbles: true }));
    }, { x, end });
    await page.mouse.up();
    await page.waitForFunction(width => document.querySelector('#being-info').getBoundingClientRect().width === width, before + 20);
    assert.equal(await divider.getAttribute('data-resizing'), null, `${end} clears pending work and the drag overlay`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  server.kill();
}
