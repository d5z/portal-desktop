import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const assets = new Map(await Promise.all(['loom.html', 'chat.js', 'chat.css', 'highlight.css', 'iui-runtime.html'].map(async file => ['/' + file, await readFile('desktop/generated/' + file)])));
const sends = [], history = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
  if (url.pathname === '/api/history') return json({ messages: history });
  if (url.pathname === '/health') return res.end('OK fixture');
  if (url.pathname === '/api/stream/active') { res.writeHead(204); return res.end(); }
  if (url.pathname === '/api/chat/stream') {
    let body = ''; for await (const part of req) body += part;
    const request = JSON.parse(body); sends.push(request);
    history.push({ seq: history.length + 1, role: 'user', scene_id: 'commands', content: request.message });
    history.push({ seq: history.length + 1, role: 'assistant', scene_id: 'commands', content: '已收到' });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    return res.end('event: content_block_delta\ndata: {"delta":{"text":"已收到"}}\n\nevent: message_stop\ndata: {}\n\n');
  }
  if (assets.has(url.pathname)) { res.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html'); return res.end(assets.get(url.pathname)); }
  return json({ sbs_enabled: false, being_name: 'Fixture', presets: [] });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/loom.html?scene_id=commands`);
  const input = page.getByRole('textbox', { name: 'message input' });
  const picker = page.getByRole('listbox', { name: '斜杠功能' });
  await input.fill('/');
  await picker.waitFor();
  assert.equal(await picker.getByRole('option').count(), 6);
  await input.press('ArrowDown');
  assert.equal(await picker.getByRole('option', { selected: true }).locator('strong').textContent(), '智能 UI');
  await input.press('Enter');
  assert.equal(await input.locator('[data-command=ui]').textContent(), '智能 UI');
  assert.equal(sends.length, 0, 'Selecting a command must not submit a message');
  await input.pressSequentially('交互预算');
  await input.press('Enter');
  await page.waitForFunction(() => document.querySelector('.message.user .content')?.textContent === '智能 UI 交互预算', null, {timeout: 5000}).catch(async error => {console.log({sends, input:await input.textContent(), bubbles:await page.locator('.message.user .content').allTextContents()}); throw error;});
  assert.ok(sends[0].message.startsWith('/ui 交互预算'));
  assert.equal(await page.locator('.message.user [data-command=ui]').count(), 1);
  assert.ok(sends[0].message.includes('[客户端 Intelligent UI Beta 上下文]'));
  await input.fill('/出图');
  assert.equal(await picker.getByRole('option').count(), 1);
  await input.press('Tab');
  assert.equal(await input.locator('[data-command=image]').textContent(), '出图');
  await input.pressSequentially('一只猫');
  await page.getByRole('button', { name: '添加附件和工具' }).click();
  await page.getByRole('menuitem', { name: /Subagent/ }).click();
  assert.equal(await input.locator('.composer-command-token').count(), 2);
  assert.ok((await input.textContent()).endsWith('一只猫'));
  await input.press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('.message.user .content')].some(el => el.textContent === '出图 Subagent 一只猫'));
  assert.ok(sends[1].message.includes('用户通过 /image'));
  assert.ok(sends[1].message.includes('用户通过 /subagent'));
  assert.equal(sends[1].message.includes('Intelligent UI Beta'), false, 'Commands must not carry over to the next turn');
  await input.fill('生成 HTML 报告');
  await page.getByRole('button', { name: '添加附件和工具' }).click();
  await page.getByRole('menuitem', { name: /生成文档/ }).click();
  assert.equal(await input.locator('[data-command=doc]').textContent(), '生成文档');
  assert.ok((await input.textContent()).endsWith('生成 HTML 报告'));
  await input.fill('/md');
  assert.equal(await picker.getByRole('option').count(), 1);
  await input.press('Tab');
  await input.pressSequentially('生成 Markdown 报告');
  await input.press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('.message.user .content')].some(el => el.textContent === '生成文档 生成 Markdown 报告'));
  assert.ok(sends[2].message.includes('https://beings.town/seeds/izFYd7gqLYeHwKFXQVSX3'));
  assert.equal(sends[2].message.includes('Intelligent UI Beta'), false);
  await input.fill('生成表格');
  await page.getByRole('button', { name: '添加附件和工具' }).click();
  await page.getByRole('menuitem', { name: /使用云电脑/ }).click();
  assert.equal(await input.locator('[data-command=computer]').textContent(), '使用云电脑');
  assert.ok((await input.textContent()).endsWith('生成表格'));
  await input.press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('.message.user .content')].some(el => el.textContent === '使用云电脑 生成表格'));
  assert.ok(sends[3].message.startsWith('/computer 生成表格'));
  assert.ok(sends[3].message.includes('https://beings.town/seeds/8U2i97peLWZSSLJf-QqDg'));
  await input.fill('/云电脑');
  assert.equal(await picker.getByRole('option').count(), 1);
  await input.press('Tab');
  assert.equal(await input.locator('[data-command=computer]').textContent(), '使用云电脑');
  // Labels remain part of the editable document and serialize as slash commands.
  await input.fill('/ui ');
  await input.locator('[data-command=ui]').waitFor();
  await input.pressSequentially('保留正文');
  await browser.contexts()[0].grantPermissions(['clipboard-read', 'clipboard-write']);
  await input.press('ControlOrMeta+a');
  await input.press('ControlOrMeta+c');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '/ui 保留正文');
  await input.click();
  await input.press('ControlOrMeta+a');
  await input.press('ArrowLeft');
  await input.press('Delete');
  await input.locator('.composer-command-token').waitFor({state:'detached'});
  assert.equal(await input.locator('.composer-command-token').count(), 0);
  assert.ok((await input.textContent()).includes('保留正文'));
  await input.press('ControlOrMeta+z');
  await input.locator('[data-command=ui]').waitFor();
  await input.fill('/ui ');
  await input.press('End');
  await input.press('Backspace');
  await input.press('Backspace');
  assert.equal(await input.locator('.composer-command-token').count(), 0);
  assert.equal(await input.textContent(), '');
  await input.evaluate(el => {
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', '/image /ui 粘贴正文');
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
  });
  assert.equal(await input.locator('.composer-command-token').count(), 2);
  assert.ok((await input.textContent()).endsWith('粘贴正文'));
  await input.fill('正文 /ui 不是功能');
  assert.equal(await input.locator('.composer-command-token').count(), 0);
  await input.fill('/');
  await input.press('Escape');
  assert.equal(await picker.count(), 0);
  await input.fill('/unknown');
  assert.equal(await picker.count(), 0);
  await input.fill('文档路径 /image/file.png');
  assert.equal(await picker.count(), 0);
  // An IME confirmation must not select or send a slash command.
  await input.fill('/');
  await input.dispatchEvent('compositionstart');
  await input.press('Enter');
  assert.equal(sends.length, 4);
  await input.dispatchEvent('compositionend');
  await input.fill('');
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.message.user .content').length === 4);
  assert.deepEqual(await page.locator('.message.user .content').allTextContents(), ['智能 UI 交互预算', '出图 Subagent 一只猫', '生成文档 生成 Markdown 报告', '使用云电脑 生成表格']);
  assert.equal((await page.locator('#messages').textContent()).includes('客户端斜杠功能上下文'), false);
  assert.equal(await page.locator('.message.user .message-command-token').count(), 5);
  await page.locator('.message.user').first().getByRole('button', {name:'复制正文', exact:true}).press('Enter');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '/ui 交互预算');
  for (const width of [1100, 375, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await input.fill('/ui 设计一个旅行计划');
    await input.locator('[data-command=ui]').waitFor();
    if (width !== 320) {
      await page.screenshot({ animations: 'disabled', path: `test-results/composer-token-${width}.png` });
      await page.locator('html').evaluate(el => el.dataset.theme = 'dark');
      await page.screenshot({ animations: 'disabled', path: `test-results/composer-token-dark-${width}.png` });
      await page.locator('html').evaluate(el => el.dataset.theme = 'light');
    }
    await input.fill('/');
    await picker.waitFor();
    const bounds = await picker.boundingBox(), composer = await page.locator('#input-area').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0);
    if (bounds.y + bounds.height > composer.y) { console.log({width,bounds,composer}); await page.screenshot({path:'test-results/composer-slash-layout-failure.png'}); }
    assert.ok(bounds.y + bounds.height <= composer.y, 'Picker stays above the composer');
    if (width !== 320) {
      await page.screenshot({ animations: 'disabled', path: `test-results/composer-slash-${width}.png` });
      await page.locator('html').evaluate(el => el.dataset.theme = 'dark');
      await page.screenshot({ animations: 'disabled', path: `test-results/composer-slash-dark-${width}.png` });
      await page.locator('html').evaluate(el => el.dataset.theme = 'light');
    }
    await page.getByRole('button', { name: '添加附件和工具' }).click();
    assert.equal(await picker.count(), 0, 'The + menu closes the slash picker');
    const menu = page.getByRole('menu', { name: '添加附件和工具' });
    await menu.waitFor();
    const menuBounds = await menu.boundingBox();
    assert.ok(menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= width && menuBounds.y >= 0);
    if (width !== 320) {
      await page.screenshot({ animations: 'disabled', path: `test-results/composer-add-${width}.png` });
      await page.locator('html').evaluate(el => el.dataset.theme = 'dark');
      await page.screenshot({ animations: 'disabled', path: `test-results/composer-add-dark-${width}.png` });
      await page.locator('html').evaluate(el => el.dataset.theme = 'light');
    }
    await page.keyboard.press('Escape');
  }
  // A mobile keyboard changes the visual viewport while layout/dvh stay tall.
  await page.setViewportSize({ width: 375, height: 800 });
  await input.fill('/');
  await picker.waitFor();
  try {
    for (const [height, offsetTop, event] of [[350, 0, 'resize'], [350, 70, 'scroll'], [300, 70, 'resize']]) {
      await page.evaluate(({ height, offsetTop, event }) => {
        Object.defineProperties(visualViewport, {
          height: { configurable: true, value: height },
          offsetTop: { configurable: true, value: offsetTop },
        });
        visualViewport.dispatchEvent(new Event(event));
      }, { height, offsetTop, event });
      await page.waitForFunction(() => {
        const menu = document.querySelector('.composer-slash-menu').getBoundingClientRect();
        const composer = document.querySelector('#input-area').getBoundingClientRect();
        return menu.top >= visualViewport.offsetTop + 7 && menu.bottom <= composer.top
          && menu.bottom <= visualViewport.offsetTop + visualViewport.height;
      });
      // Both ends of the list remain reachable in the smaller scroll container.
      for (const key of ['ArrowUp', 'ArrowDown']) {
        await input.press(key);
        const menu = await picker.boundingBox(), option = await picker.getByRole('option', { selected: true }).boundingBox();
        assert.ok(option.y >= menu.y - 1 && option.y + option.height <= menu.y + menu.height + 1);
      }
    }
    await picker.getByRole('option', { selected: true }).click();
    assert.equal((await input.evaluate(el => el.editor.getMarkdown())).trim(), '/image');
    assert.equal(sends.length, 4, 'Selecting a visible option must not send');
  } finally {
    await page.evaluate(() => {
      delete visualViewport.height; delete visualViewport.offsetTop;
      visualViewport.dispatchEvent(new Event('resize'));
    });
  }
  assert.deepEqual(errors, []);
  console.log('PASS: slash keyboard/pointer selection, Chinese filtering, IME, + menu, transport context, clean restored bubbles and responsive layout.');
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
