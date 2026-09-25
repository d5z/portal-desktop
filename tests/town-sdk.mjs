// SDK contract fixtures only: no real Town pairing, messages or credentials.
import { launchDesktop } from './support/electron-lifecycle.mjs';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { desktopExecutable, waitForChatReady } from './support/desktop.mjs';

const dir = await mkdtemp(path.join(os.tmpdir(), 'town-sdk-284bef4-'));
let app, page, failure;
try {
  app = await launchDesktop({ executablePath: await desktopExecutable(), env: { ...process.env, PORTAL_DESKTOP_USER_DATA: dir } });
  page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: '连接我的 Being' }).waitFor();
  await app.evaluate(({ protocol }) => {
    const token = 'sdk-fixture-client-token';
    globalThis.sdkWrites = [];
    globalThis.sdkPairConfirms = [];
    const base = { town_id: 't_WillowFull', speaker_name: '服务端展示名', at: '2026-09-11T10:00:00Z' };
    const messages = [
      { ...base, seq: 1, message: 'Being 本体消息', via: 'being' },
      { ...base, seq: 2, message: '伙伴代发消息', via: 'client:my-phone' },
      { ...base, seq: 3, message: '旧消息缺少来源', via: null },
      { ...base, seq: 4, message: '来源按纯文本展示', via: 'client:<img src=x onerror=alert(1)>' },
    ];
    protocol.handle('https', async request => {
      const url = new URL(request.url);
      if (url.origin !== 'https://beings.town') return Response.json({ error: 'fixture only' }, { status: 404 });
      if (url.pathname === '/api/client/pair/confirm') {
        const body = await request.json();
        globalThis.sdkPairConfirms.push(body);
        if (body.being_id !== 'willow' || body.code !== 'AB3XY9' || request.headers.has('authorization')) return Response.json({ error: 'bad fixture pairing' }, { status: 400 });
        return Response.json({ ok: true, token, town_id: 't_WillowFull', display: '柳树' });
      }
      if (url.pathname === '/api/client/stream') {
        if (url.searchParams.get('token') !== token) return new Response('', { status: 401 });
        return new Response(new ReadableStream({ start(controller) {
          globalThis.sdkStream = controller;
          controller.enqueue(new TextEncoder().encode('event: hello\ndata: {"town_id":"t_WillowFull","token_kind":"client","anonymous":false}\n\n'));
        } }), { headers: { 'Content-Type': 'text/event-stream' } });
      }
      if (url.pathname === '/api') return Response.json({ version: 'fixture', community: [], services: { bonfire: { what: '篝火说明' }, messages: { what: '私信说明' }, fireside: { what: '围炉说明' } } });
      if (url.pathname !== '/api/bonfire/hear' && request.headers.get('authorization') !== `Bearer ${token}`) return Response.json({ error: 'unauthorized' }, { status: 401 });
      if (request.method === 'POST') {
        globalThis.sdkWrites.push({ path: url.pathname, body: await request.json() });
        return Response.json({ ok: true, via: 'client:desktop', seq: 5, message_id: 'sent-1' });
      }
      if (url.pathname === '/api/bonfire/hear') return Response.json({ ok: true, town_id: 't_WillowFull', messages });
      if (url.pathname === '/api/fireside/list') return Response.json({ owned: [{ id: 10, name: '测试围炉' }], joined: [] });
      if (url.pathname === '/api/fireside/members') return Response.json([
        { town_id: 't_WillowFull', display_name: '柳树', display: '柳树 (t_Willow)', joined_at: '2026-09-01T12:00:00+08:00' },
        { town_id: 't_RiverFull', display_name: '河流', display: '河流 (t_River)', joined_at: '2026-09-02T12:00:00+08:00' },
      ]);
      if (url.pathname === '/api/fireside/hear') return Response.json({ ok: true, messages: [messages[1]] });
      if (url.pathname === '/api/messages') return Response.json({ messages: [{ id: 'dm-1', sender_town_id: 't_RiverFull', sender_display: 'Seam Walker', recipient_town_id: 't_WillowFull', content: '来自伙伴的私信', created_at: base.at, via: 'client:tablet' }] });
      return Response.json({ error: 'fixture only' }, { status: 404 });
    });
  });
  await app.evaluate(({ protocol }) => {
    globalThis.sdkPairChats = [];
    globalThis.sdkPairMode = 'waiting';
    protocol.handle('http', async request => {
      const url = new URL(request.url);
      const path = url.pathname;
      if (path.endsWith('/api/chat/stream') && request.method === 'POST') {
        const body = await request.json();
        globalThis.sdkPairChats.push({ body, token: url.searchParams.get('token') });
        if (globalThis.sdkPairMode === 'unauthorized' || url.searchParams.get('token') !== 'local-ui-fixture') return Response.json({ error: 'authentication required' }, { status: 403 });
        return new Response(new ReadableStream({ start(controller) {
          if (globalThis.sdkPairMode === 'waiting') return;
          controller.enqueue(new TextEncoder().encode('event: text\ndata: {"text":"正在获取配对码。"}\n\nevent: message_stop\ndata: {}\n\n'));
          controller.enqueue(new TextEncoder().encode('event: tool_result\ndata: {"text":"BAD123"}\n\nevent: text\ndata: {"text":"AB3"}\n\n'));
          controller.enqueue(new TextEncoder().encode('event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"XY9"}}\n\nevent: message_stop\ndata: {}\n\n'));
          controller.close();
        } }), { headers: { 'Content-Type': 'text/event-stream' } });
      }
      if (path.endsWith('/api/stream/active')) return new Response(null, { status: 204 });
      return Response.json({ being_name: 'willow', messages: [], status: 'ok' });
    });
  });
  await page.evaluate(async dir => {
    const { settings } = await window.beings.snapshot();
    await window.beings.save({ ...settings, connectionLink: 'http://127.0.0.1:1/willow/?token=local-ui-fixture', workspace: dir, backgroundEnabled: false, autoStart: false });
  }, dir);
  await waitForChatReady(page);
  const chatInput = page.frameLocator('#chat-frame').locator('#input .cm-content');
  const home = async () => {
    if (await page.locator('#place-sheet').evaluate(el => el.open)) await page.locator('#back-to-chat').click();
    const trigger = page.locator('#options-trigger');
    if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
    await page.waitForFunction(() => document.querySelector('#options-trigger')?.getAttribute('aria-expanded') === 'true');
    await page.locator('[data-view="town"]').click();
    await page.locator('.service-card').first().waitFor();
  };
  const open = async title => {
    await home();
    await page.locator('.service-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).getByRole('button', { name: '打开', exact: true }).click();
  };
  // Compact menu: nested navigation, interrupted motion, keyboard and merged settings.
  await page.locator('#options-trigger').click();
  assert.equal(await page.locator('#options-home > button').count(), 8);
  await page.locator('#options-help').click();
  assert.equal(await page.locator('#conversation-options').getAttribute('open'), '');
  await page.keyboard.press('Escape');
  await page.locator('#options-home').waitFor();
  await page.waitForFunction(() => document.activeElement?.id === 'options-help');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#conversation-options').open);
  assert.equal(await page.locator('#options-trigger').evaluate(el => el === document.activeElement), true);
  await page.locator('#options-trigger').dispatchEvent('click');
  await page.locator('#options-trigger').dispatchEvent('click');
  await page.locator('#options-trigger').dispatchEvent('click');
  // Rapid clicks can batch into a closed state; select the target from the settled menu.
  if (await page.locator('#options-trigger').getAttribute('aria-expanded') !== 'true') await page.locator('#options-trigger').click();
  await page.waitForFunction(() => document.querySelector('#options-trigger')?.getAttribute('aria-expanded') === 'true');
  await page.locator('#client-settings-button').click();
  await page.locator('#client-settings-dialog[open]').waitFor();
  await page.locator('#settings-tab-appearance').click();
  assert.equal(await page.locator('#theme-toggle').isVisible(), true);
  await page.locator('#settings-tab-connections').click();
  assert.equal(await page.locator('#settings-button').isVisible(), true);
  await page.screenshot({ path: path.join(os.tmpdir(), 'town-settings-review.png') });
  await page.locator('#settings-button').click();
  assert.equal(await page.locator('#client-settings-dialog').evaluate(el => el.open), false);
  await page.locator('#settings-dialog[open]').waitFor();
  await page.locator('#close-settings').click();
  await page.locator('#options-trigger').click();
  await page.waitForFunction(() => document.querySelector('.options-menu').getAnimations().length === 0);
  await page.screenshot({ path: path.join(os.tmpdir(), 'town-menu-review.png') });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#conversation-options').open);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#options-trigger').focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('#toggle-chat-search').evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#conversation-options').open);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await home();
  await page.frameLocator('#chat-frame').locator('#input .cm-content').fill('配对期间保留草稿');
  await page.locator('#town-auth-button').click();
  await page.getByRole('button', { name: '自动连接 Town', exact: true }).waitFor();
  assert.equal(await page.locator('#town-pair-code').isVisible(), false);
  await page.screenshot({ path: path.join(os.tmpdir(), 'town-auto-pair-review.png') });
  await page.locator('#town-auth-form button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#cancel-town-pair') !== null);
  await app.evaluate(async () => {
    const deadline = Date.now() + 5000;
    while (!globalThis.sdkPairChats.length) {
      if (Date.now() >= deadline) throw new Error('Pairing request did not reach the fixture');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  });
  await page.locator('#close-town-auth').click();
  await page.waitForFunction(() => !document.querySelector('#town-auth-dialog').open);
  assert.equal(await page.evaluate(async () => (await window.beings.townAuth()).configured), false);
  assert.equal(await app.evaluate(() => globalThis.sdkPairConfirms.length), 0);
  await page.locator('#town-auth-button').click();
  await app.evaluate(() => { globalThis.sdkPairMode = 'unauthorized'; });
  await page.locator('#town-auth-form button[type="submit"]').click();
  await page.locator('#town-pair-code').waitFor({ state: 'visible' });
  assert.match(await page.locator('#town-auth-error').textContent(), /手动配对/);
  await page.screenshot({ path: path.join(os.tmpdir(), 'town-auto-pair-manual-review.png') });
  assert.equal(await app.evaluate(() => globalThis.sdkPairConfirms.length), 0);
  await page.locator('#town-pair-mode').click();
  await app.evaluate(() => { globalThis.sdkPairMode = 'normal'; });
  await page.locator('#town-auth-form button[type="submit"]').click();
  await page.waitForFunction(() => !document.querySelector('#town-auth-dialog').open);
  await page.waitForFunction(async () => (await window.beings.townLive()).phase === 'connected');
  assert.equal(await page.frameLocator('#chat-frame').locator('#input .cm-content').textContent(), '配对期间保留草稿');
  await page.frameLocator('#chat-frame').locator('#input .cm-content').fill('');
  const pairs = await app.evaluate(() => ({ chats: globalThis.sdkPairChats, confirms: globalThis.sdkPairConfirms }));
  assert.equal(pairs.chats.length, 3);
  assert.deepEqual(pairs.confirms, [{ being_id: 'willow', code: 'AB3XY9' }]);
  for (const { body, token } of pairs.chats) {
    assert.equal(token, 'local-ui-fixture');
    assert.match(body.session_id, /^town-pair-/);
    assert.equal(body.scene_id, body.session_id);
    assert.equal(body.scene_meta.scene_label, 'Town 配对');
    assert.equal(body.chat_id, undefined);
  }
  await open('篝火');
  await page.locator('.social-message').getByText('伙伴代发消息', { exact: true }).waitFor();
  const partner = page.locator('.social-message').filter({ hasText: '伙伴代发消息' });
  assert.equal(await partner.locator('.via-tag').textContent(), '客户端发送');
  assert.equal(await partner.locator('.social-author').textContent(), '服务端展示名');
  for (const body of ['Being 本体消息', '旧消息缺少来源']) assert.equal(await page.locator('.social-message').filter({ hasText: body }).locator('.via-tag').count(), 0);
  assert.equal(await page.locator('.via-tag img').count(), 0);
  assert((await page.locator('.via-tag').allTextContents()).every(text => text === '客户端发送'));
  await page.screenshot({ path: path.join(os.tmpdir(), 'town-sdk-via.png') });
  assert.equal(await page.locator('.social-message').getByRole('button', { name: '回复', exact: true }).count(), 4);
  assert.equal(await page.locator('.social-message').getByRole('button', { name: '让 Being 回复', exact: true }).count(), 0);
  // The header prefers the connected identity over names from feed messages.
  assert.equal(await page.locator('#conversation-name').textContent(), '柳树');
  assert.doesNotMatch(await page.locator('#conversation-name').textContent(), /t_[a-zA-Z0-9_-]+/);
  await chatInput.fill('保留手写草稿');
  await partner.getByRole('button', { name: '回复', exact: true }).click();
  await page.locator('#town-send-content').fill('语气温和一些');
  assert.equal(await page.locator('#town-send-dialog').getByRole('button', { name: '让 Being 回复', exact: true }).count(), 1);
  await page.locator('#town-ask-being').click();
  await page.waitForFunction(() => document.body.dataset.view === 'chat');
  await app.evaluate(async () => {
    const deadline = Date.now() + 5000;
    while (globalThis.sdkPairChats.length < 4) {
      if (Date.now() >= deadline) throw new Error('Being reply request did not reach the chat fixture');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  });
  const beingReplyRequest = await app.evaluate(() => globalThis.sdkPairChats.at(-1).body.message);
  assert.match(beingReplyRequest, /位置：篝火/);
  assert.match(beingReplyRequest, /回复对象：服务端展示名/);
  assert.match(beingReplyRequest, /伙伴代发消息/);
  assert.match(beingReplyRequest, /语气温和一些/);
  assert.equal(await chatInput.innerText(), '保留手写草稿');
  await chatInput.fill('');
  await open('篝火');
  await partner.getByRole('button', { name: '回复', exact: true }).click();
  await page.locator('#town-reply-preview').getByText('服务端展示名：伙伴代发消息', { exact: true }).waitFor();
  await page.locator('#town-send-close').click();
  assert.equal(await app.evaluate(() => globalThis.sdkWrites.length), 0);
  await partner.getByRole('button', { name: '回复', exact: true }).click();
  await page.locator('#town-send-content').fill('SDK 篝火回复');
  await page.locator('#town-send-submit').click();
  await page.waitForFunction(() => !document.querySelector('#town-send-dialog').open);
  assert.deepEqual(await app.evaluate(() => globalThis.sdkWrites), [{ path: '/api/bonfire/speak', body: { message: 'SDK 篝火回复', reply_to: 2 } }]);
  await partner.getByRole('button', { name: '一起看', exact: true }).click();
  await page.locator('#scene-compose').click();
  await page.waitForFunction(() => document.querySelector('#companion-panel').hidden);
  assert.equal(await chatInput.innerText(), '一起看看篝火里的这段（t_WillowFull）：\n\n> 伙伴代发消息');
  // An existing draft is preserved, and inserting a quote never sends it.
  await chatInput.fill('保留我的草稿');
  await open('篝火');
  await page.locator('.social-message').filter({ hasText: '伙伴代发消息' }).getByRole('button', { name: '一起看', exact: true }).click();
  await page.locator('#scene-compose').click();
  await page.getByText('对话输入框已有草稿，请先处理原草稿，再放入引用。', { exact: true }).waitFor();
  assert.equal(await chatInput.innerText(), '保留我的草稿');
  await page.locator('#close-companion').click();
  await chatInput.fill('');
  await open('篝火');
  assert.equal(await page.locator('#town-write').getAttribute('class'), 'town-write-button');
  await page.locator('#town-write').click();
  assert((await page.locator('#town-send-context').textContent()).includes('以「柳树」的身份代发'));
  assert.equal(await page.getByRole('button', { name: '让 Being 发送', exact: true }).isDisabled(), true);
  await page.locator('#town-send-content').fill('邀请大家分享今天最开心的一件事，语气自然');
  assert.equal(await page.getByRole('button', { name: '让 Being 发送', exact: true }).isEnabled(), true);
  await page.getByRole('button', { name: '让 Being 发送', exact: true }).click();
  await page.waitForFunction(() => document.body.dataset.view === 'chat');
  await app.evaluate(async () => {
    const deadline = Date.now() + 5000;
    while (globalThis.sdkPairChats.length < 5) {
      if (Date.now() >= deadline) throw new Error('Being send request did not reach the chat fixture');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  });
  const beingSendRequest = await app.evaluate(() => globalThis.sdkPairChats.at(-1).body.message);
  assert.match(beingSendRequest, /场景位置：篝火/);
  assert.match(beingSendRequest, /邀请大家分享今天最开心的一件事/);
  await open('篝火');
  await page.locator('#town-write').click();
  await page.locator('#town-send-content').fill('SDK 测试消息');
  await page.locator('#town-send-submit').click();
  await page.waitForFunction(() => !document.querySelector('#town-send-dialog').open);
  assert.deepEqual(await app.evaluate(() => globalThis.sdkWrites), [
    { path: '/api/bonfire/speak', body: { message: 'SDK 篝火回复', reply_to: 2 } },
    { path: '/api/bonfire/speak', body: { message: 'SDK 测试消息' } },
  ]);
  await open('私信');
  await page.getByText('来自伙伴的私信', { exact: true }).waitFor();
  assert.equal(await page.locator('.via-tag').textContent(), '客户端发送');
  await page.locator('.social-message').getByRole('button', { name: '一起看', exact: true }).click();
  await page.locator('#scene-compose').click();
  await page.waitForFunction(() => document.querySelector('#companion-panel').hidden);
  assert.match(await chatInput.innerText(), /来自伙伴的私信/);
  assert.equal(await app.evaluate(() => globalThis.sdkWrites.length), 2);
  await chatInput.fill('');
  await open('私信');
  await page.locator('.social-message').getByRole('button', { name: '回复', exact: true }).click();
  assert.equal(await page.locator('#town-recipient').inputValue(), 'Seam Walker');
  assert.equal(await page.locator('#town-recipient').evaluate(el => el.readOnly), true);
  assert.match(await page.locator('#town-reply-preview').textContent(), /来自伙伴的私信/);
  await page.locator('#town-send-close').click();
  assert.equal(await app.evaluate(() => globalThis.sdkWrites.length), 2);
  await page.locator('.social-message').getByRole('button', { name: '回复', exact: true }).click();
  await page.locator('#town-send-content').fill('SDK 私信回复');
  await page.locator('#town-send-submit').click();
  await page.waitForFunction(() => !document.querySelector('#town-send-dialog').open);
  assert.deepEqual(await app.evaluate(() => globalThis.sdkWrites.at(-1)), { path: '/api/messages', body: { recipient: 't_RiverFull', content: 'SDK 私信回复', reply_to: 'dm-1' } });
  await page.locator('#town-write').click();
  await page.locator('#town-recipient').fill('t_WillowFull');
  await page.locator('#town-send-content').fill('不能发给自己');
  await page.locator('#town-send-submit').click();
  await page.locator('#town-send-error').getByText(/不能给当前 Being 自己/).waitFor();
  assert.equal(await app.evaluate(() => globalThis.sdkWrites.length), 3);
  await page.locator('#town-send-close').click();
  await open('围炉');
  await page.locator('.social-message').getByText('伙伴代发消息', { exact: true }).waitFor();
  assert.equal(await page.locator('.via-tag').textContent(), '客户端发送');
  await page.locator('.social-message').getByRole('button', { name: '一起看', exact: true }).click();
  await page.locator('#scene-compose').click();
  await page.waitForFunction(() => document.querySelector('#companion-panel').hidden);
  assert.match(await chatInput.innerText(), /伙伴代发消息/);
  await chatInput.fill('');
  await open('围炉');
  await page.locator('.social-message').getByRole('button', { name: '回复', exact: true }).click();
  await page.locator('#town-send-content').fill('SDK 围炉回复');
  await page.locator('#town-send-submit').click();
  await page.waitForFunction(() => !document.querySelector('#town-send-dialog').open);
  assert.deepEqual(await app.evaluate(() => globalThis.sdkWrites.at(-1)), { path: '/api/fireside/speak', body: { fireside_id: 10, message: 'SDK 围炉回复', reply_to: 2 } });
  assert.deepEqual(errors, []);
  // Explicit quotations also work with imported tokens, without pairing again.
  await page.evaluate(() => window.beings.saveTownToken('sdk-fixture-client-token'));
  await page.waitForFunction(async () => (await window.beings.townLive()).phase === 'connected');
  await open('私信');
  await page.locator('.social-message').getByRole('button', { name: '一起看', exact: true }).click();
  await page.locator('#scene-compose').click();
  await page.waitForFunction(() => document.querySelector('#companion-panel').hidden);
  assert.match(await chatInput.innerText(), /来自伙伴的私信/);
  assert.equal(await app.evaluate(() => globalThis.sdkWrites.length), 4);
  assert.equal(await app.evaluate(() => globalThis.sdkPairConfirms.length), 1);
  assert.equal(await app.evaluate(() => globalThis.sdkPairChats.length), 5);
  await chatInput.fill('');
  // Manual pairing remains available after an automatic connection.
  await home(); await page.locator('#town-auth-button').click();
  await page.locator('#town-pair-mode').click();
  await page.locator('#town-being').fill('willow');
  await page.locator('#town-pair-code').fill('AB3XY9');
  await page.locator('#town-auth-form button[type="submit"]').click();
  await page.waitForFunction(() => !document.querySelector('#town-auth-dialog').open);
  assert.equal(await app.evaluate(() => globalThis.sdkPairConfirms.length), 2);
  assert.equal(await app.evaluate(() => globalThis.sdkPairChats.length), 5);
  console.log('PASS: authenticated automatic pairing, stream cancellation, auth-error fallback, preserved chat drafts and manual pairing; explicit private quotations work with canonical Town IDs and imported credentials without re-pairing or sending.');
  console.log('PASS: compact menu, interrupted motion, keyboard/reduced motion, grouped settings, clean quote draft and existing-draft preservation; SDK pairing + SSE hello, server display names, via badges in all three feeds, inert via text, explicit author context, fixture-only send, self-DM blocked before network');
} catch (error) {
  failure = error;
  console.error('Town SDK assertion failed:', error);
  if (page && !page.isClosed()) {
    try {
      await mkdir('test-results', { recursive: true });
      await page.screenshot({ path: 'test-results/town-sdk-failure.png' });
      const state = await page.evaluate(() => ({
        active: document.activeElement?.id || document.activeElement?.tagName,
        menuOpen: document.querySelector('#conversation-options')?.open,
        expanded: document.querySelector('#options-trigger')?.getAttribute('aria-expanded'),
        homeHidden: document.querySelector('#options-home')?.hidden,
        secondaryHidden: document.querySelector('#options-secondary')?.hidden,
      }));
      await writeFile('test-results/town-sdk-failure.json', JSON.stringify(state, null, 2));
    } catch (diagnosticError) { console.error('Town SDK diagnostics failed:', diagnosticError); }
  }
  throw error;
} finally {
  if (app) {
    try { await app.close(); }
    catch (error) { if (!failure) throw error; console.error('Town SDK cleanup also failed:', error); }
  }
  await rm(dir, { recursive: true, force: true });
}
