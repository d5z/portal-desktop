// Render the real React menu in Chromium; no desktop services or Town requests.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const bundle = await build({
  stdin: {
    contents: `import { createRoot } from 'react-dom/client';
      import { Topbar } from './desktop/renderer/app/components/topbar';
      const model = {
        subscribe: () => () => {}, getVersion: () => 0,
        snapshot: { settings: { hasToken: true, being: 'fixture', portalName: '工作室 Mac Portal' }, portal: { phase: 'connected', message: 'ready', logs: [] } },
        town: { subscribe: () => () => {}, getVersion: () => 0, live: { display: 'Fixture Town' }, displayName: 'Fixture Town' },
        api: { platform: 'darwin' }, connection: 'online',
        chatLoading: false, sbsKnown: false, searchOpen: false,
        navigate(view) { window.navigated = view; },
        openClientSettings() { window.settingsOpened = (window.settingsOpened || 0) + 1; },
      };
      createRoot(document.getElementById('root')).render(<Topbar model={model} />);`,
    resolveDir: process.cwd(), loader: 'tsx',
  },
  bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const css = await readFile('desktop/renderer/app/styles.css');
const server = createServer((request, response) => {
  if (request.url === '/menu.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].contents); return; }
  if (request.url === '/app.css') { response.setHeader('Content-Type', 'text/css'); response.end(css); return; }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end('<!doctype html><link rel="stylesheet" href="/app.css"><div id="root"></div><button id="outside">Outside</button><script src="/menu.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser, page;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  page = await browser.newPage(); page.setDefaultTimeout(5000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + server.address().port);
  assert.equal(await page.locator('#local-portal-status').getAttribute('aria-label'), '本机 Portal：工作室 Mac Portal，已连接');
  assert.equal(await page.locator('#local-portal-status').getAttribute('title'), null);
  assert.equal(await page.locator('#local-portal-status .local-portal-name').textContent(), '工作室 Mac Portal');
  await page.locator('#local-portal-status').hover();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.local-portal-name')).opacity === '1');
  await page.locator('#local-portal-status').click();
  assert.equal(await page.evaluate(() => window.navigated), 'portal');
  await page.locator('#options-trigger').click();
  await page.waitForFunction(() => document.querySelector('.options-menu').getAnimations().length === 0);
  const blurred = await page.evaluate(async () => {
    const details = document.querySelector('#conversation-options');
    const menu = document.querySelector('.options-menu');
    window.dispatchEvent(new Event('blur'));
    while (document.querySelector('#options-trigger').getAttribute('aria-expanded') !== 'false')
      await new Promise(requestAnimationFrame);
    const closing = menu.getAnimations()[0];
    return new Promise(resolve => closing.addEventListener('finish', () => {
      // Sample after the menu's finish handler, before React hides <details>.
      // A completed fade must never reveal the opaque menu again.
      resolve({ open: details.open, opacity: getComputedStyle(menu).opacity });
    }, { once: true }));
  });
  assert.ok(!blurred.open || blurred.opacity === '0', `Menu reappeared after blur: ${JSON.stringify(blurred)}`);
  await page.waitForFunction(() => !document.querySelector('#conversation-options').open);
  for (const reducedMotion of ['no-preference', 'reduce']) {
    await page.emulateMedia({ reducedMotion });
    await page.locator('#options-trigger').click();
    await page.locator('#options-help').click();
    await page.locator('#options-secondary').waitFor();
    // Put focus in the submenu before Escape, as after its entry animation.
    // Without post-commit restoration this falls to body when the submenu hides.
    await page.locator('#options-back').focus();
    await page.keyboard.press('Escape');
    await page.locator('#options-home').waitFor();
    await page.waitForFunction(() => document.activeElement?.id === 'options-help');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#conversation-options').open);
    assert.equal(await page.locator('#options-trigger').evaluate(el => el === document.activeElement), true);

    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => document.activeElement?.id === 'toggle-chat-search');
    await page.locator('#options-help').click();
    await page.waitForFunction(() => document.activeElement?.id === 'options-back');
    await page.locator('#options-back').click();
    await page.waitForFunction(() => document.activeElement?.id === 'options-help');
    // Close and reopen before the animation completes, then return quickly
    // from the submenu to catch stale deferred focus work.
    await page.locator('#options-trigger').dispatchEvent('click');
    await page.locator('#options-trigger').dispatchEvent('click');
    await page.evaluate(() => {
      document.querySelector('#options-help').click();
    });
    await page.locator('#options-back').dispatchEvent('keydown', { key: 'Escape' });
    await page.waitForFunction(() => document.activeElement?.id === 'options-help');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#conversation-options').open);
    await page.locator('#options-trigger').click();
    await page.locator('#outside').click();
    await page.waitForFunction(() => !document.querySelector('#conversation-options').open);
    assert.equal(await page.locator('#outside').evaluate(el => el === document.activeElement), true);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: blur closes without flashing; submenu Escape and Back restore focus after rendering; double Escape, keyboard entry, interrupted motion and reduced motion close correctly.');
} catch (error) {
  console.error('Menu keyboard assertion failed:', error);
  if (page && !page.isClosed()) {
    // Capture focus before a screenshot can finish animations and change it.
    // Diagnostic failures must never replace the original test failure.
    try {
      const state = await page.evaluate(() => ({ active: document.activeElement?.id || document.activeElement?.tagName,
        open: document.querySelector('#conversation-options')?.open,
        homeHidden: document.querySelector('#options-home')?.hidden,
        secondaryHidden: document.querySelector('#options-secondary')?.hidden }));
      console.error('Menu keyboard failure state:', state);
      await mkdir('test-results', { recursive: true });
      await writeFile('test-results/menu-keyboard-failure.json', JSON.stringify(state, null, 2));
    } catch (diagnosticError) {
      console.error('Menu keyboard state capture failed:', diagnosticError);
    }
    try {
      await mkdir('test-results', { recursive: true });
      await page.screenshot({ path: 'test-results/menu-keyboard-failure.png', animations: 'disabled', timeout: 15000 });
    } catch (diagnosticError) {
      console.error('Menu keyboard screenshot failed:', diagnosticError);
    }
  }
  throw error;
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
