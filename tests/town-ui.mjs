// Exercise the packaged application's real IPC and net.fetch with intercepted HTTPS fixtures.
import { launchDesktop } from './support/electron-lifecycle.mjs';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { c as archive } from 'tar';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { desktopExecutable, waitForChatReady, clickChatControl } from './support/desktop.mjs';
const executablePath = await desktopExecutable();
const dir = await mkdtemp(path.join(os.tmpdir(), 'beings-town-ui-'));
let app;
try {
  const remote = path.join(dir, 'remote-kit'); await mkdir(remote);
  await writeFile(path.join(remote, 'manifest.json'), JSON.stringify({ name: 'downloaded-kit', version: '1.0', command: [process.execPath, 'server.mjs'], tools: [{ name: 'downloaded_ping', description: 'Downloaded tool' }], provision: { env: [{ name: 'FIXTURE_API_KEY', required: true }] } }));
  await writeFile(path.join(remote, 'package.json'), JSON.stringify({ name: 'downloaded-kit', version: '1.0.0', private: true }));
  await writeFile(path.join(remote, 'server.mjs'), `import readline from 'node:readline';
if(process.env.FIXTURE_API_KEY!=='fixture-value')throw Error('missing config');
readline.createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.id==null)return;const result=r.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}:{tools:[{name:'downloaded_ping',description:'Downloaded tool',inputSchema:{type:'object'}}]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');});`);
  const bundle = path.join(dir, 'kit.tar.gz'); await archive({ gzip: true, cwd: remote, file: bundle }, ['manifest.json', 'package.json', 'server.mjs']);
  app = await launchDesktop({ executablePath, env: { ...process.env, PORTAL_DESKTOP_USER_DATA: path.join(dir, 'profile') } });
  const page = await app.firstWindow();
  await app.context().tracing.start({ screenshots: true, snapshots: true });
  await app.evaluate(({ protocol }) => {
    protocol.handle('http', request => {
      const url = new URL(request.url);
      if (url.host !== '127.0.0.1:1') return new Response('fixture only', { status: 404 });
      if (url.pathname.endsWith('/api/stream/active')) return new Response(null, { status: 204 });
      return Response.json({ being_name: 'willow', messages: [] });
    });
  });
  const config = path.join(dir, 'portal.toml');
  await writeFile(config, `workspace = ${JSON.stringify(dir)}\nkits_dir = ${JSON.stringify(path.join(dir, 'kits'))}\nkits_enabled = true\n`);
  await page.evaluate(async ({ dir, config }) => {
    const { settings } = await window.beings.snapshot();
    await window.beings.save({ ...settings, connectionLink: 'http://127.0.0.1:1/willow/?token=local-ui-test', workspace: dir, portalConfigPath: config, backgroundEnabled: false, autoStart: false });
  }, { dir, config });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ protocol }, bundle) => {
    globalThis.townRequests = [];
    protocol.handle('https', async request => {
      const url = new URL(request.url);
      globalThis.townRequests.push({ path: url.pathname, query: url.search, authorization: request.headers.get('authorization') });
      const json = (data, status = 200) => Response.json(data, { status });
      if (url.pathname === '/api/grove/kit0/download') return new Response(Uint8Array.from(atob(bundle), c => c.charCodeAt(0)), { headers: { 'Content-Type': 'application/gzip' } });
      const privateRoute = ['/api/bonfire/hear', '/api/messages', '/api/scrolls', '/api/fireside/list', '/api/fireside/hear', '/api/fireside/members'].includes(url.pathname);
      if (privateRoute && request.headers.get('authorization') !== 'Bearer town-fixture-token') return json({ error: 'missing credentials' }, 401);
      if (url.pathname === '/api') return json({ version: '0.3.0', services: {
        '◎ beings': { what: '居民目录', help: 'GET /api/beings/help' },
        '🌳 grove': { what: 'Discover tools for your Being', help: 'GET /api/grove/help' }, '🔥 bonfire': { what: 'Gather around the fire', help: 'GET /api/bonfire/help' },
        '📬 messages': { what: 'Private letters', help: 'GET /api/messages/help' }, '📚 ember': { what: 'Stories from the town', help: 'GET /api/embers/help' },
      }, whats_new: [{ service: 'Kit', change: 'New tools', date: '2026-09-07' }] });
      if (url.pathname === '/api/bonfire/hear') return json({ messages: [
        { seq: 1, being: { display_name: 'Willow' }, message: '**篝火测试** <img src=x onerror="window.pwned=true">', at: '2026-09-07T12:00:00Z' },
        { seq: 2, being: { display_name: 'River' }, message: '收到', reply_to: 1, reply_to_preview: '篝火测试', at: '2026-09-07T12:01:00Z' },
      ] });
      if (url.pathname === '/api/messages') return json({ count: 1, messages: [{ id: '1', sender: url.searchParams.get('with') === 'sent' ? 'Willow' : 'River', recipient: url.searchParams.get('with') === 'sent' ? 'River' : 'Willow', content: url.searchParams.get('with') === 'sent' ? '已发送的测试信件' : '一封测试来信', delivery_status: 'delivered', created_at: '2026-09-07T12:00:00Z' }] });
      if (url.pathname === '/api/fireside/list') {
        if (globalThis.townRequests.filter(item => item.path === '/api/fireside/list').length > 1) await new Promise(resolve => setTimeout(resolve, 120));
        return json({ owned: [{ id: 10, name: '测试围炉', owner_town_id: 't_Willow', member_count: 3 }], joined: [{ id: 11, name: '第二围炉', member_count: 1 }] });
      }
      if (url.pathname === '/api/fireside/members') return json(url.searchParams.get('fireside_id') === '11'
        ? [{ town_id: 't_River', display_name: 'River', display: 'River (t_River)', joined_at: '2026-09-06T12:00:00+08:00' }]
        : [
            { town_id: 't_Willow', display_name: 'Willow', display: 'Willow (t_Willow)', joined_at: '2026-09-01T12:00:00+08:00' },
            { town_id: 't_River', display_name: 'River', display: 'River (t_River)', joined_at: '2026-09-02T12:00:00+08:00' },
            { town_id: 't_Bird', display_name: '山雀', display: '山雀 (t_Bird)', joined_at: '2026-09-03T12:00:00+08:00' },
          ]);
      if (url.pathname === '/api/fireside/hear') {
        if (url.searchParams.get('fireside_id') === '11') await new Promise(resolve => setTimeout(resolve, 120));
        const title = url.searchParams.get('fireside_id') === '11' ? '第二围炉消息' : '围炉消息';
        return json({ messages: Array.from({ length: 30 }, (_, index) => ({
          seq: index + 1,
          speaker_name: 'River',
          message: index === 0 ? title : `${title} ${index + 1}`,
          at: `2026-09-07T12:${String(index).padStart(2, '0')}:00Z`,
        })) });
      }
      if (url.pathname === '/api/grove') {
        const offset = Number(url.searchParams.get('offset'));
        return json({ count: 25, kits: Array.from({ length: offset ? 1 : 24 }, (_, i) => ({ id: 'kit' + (offset + i), name: offset + i === 0 ? 'downloaded-kit' : 'Tool ' + (offset + i), description: 'A useful kit', display_name: 'Willow', version: '1.0', status: 'grown' })) });
      }
      if (url.pathname.startsWith('/api/grove/')) return json({ id: 'kit0', name: 'downloaded-kit', description: 'A useful kit', version: '1.0', has_bundle: true, manifest: { command: ['node', 'server.mjs'], tools: [{ name: 'test_tool', description: 'Test tool parameters', params: { type: 'object', properties: { query: { type: 'string' } } } }] } });
      if (url.pathname === '/api/seeds') return json({ count: 0, seeds: [] });
      if (url.pathname === '/api/embers' || url.pathname === '/api/scrolls') return json({ total: 1, scrolls: [{ id: 'story1', title: '测试书架故事', display_name: 'Willow', kind: 'ember', updated_at: '2026-09-07T12:00:00Z' }] });
      if (url.pathname.startsWith('/api/embers/') || url.pathname.startsWith('/api/scrolls/')) return json({ id: 'story1', title: '测试书架故事', display_name: 'Willow', content: '这是一段 **完整内容**。<script>window.pwned=true</script>', has_more: false });
      return json({ error: 'not found' }, 404);
    });
  }, (await readFile(bundle)).toString('base64'));
  // Wait for the chat document to finish initial focus before opening shell menus.
  await waitForChatReady(page);
  const nav = async name => {
    if (await page.locator('#place-sheet').evaluate(element => element.open)) {
      await page.locator('#back-to-chat').click();
      await page.waitForFunction(() => document.body.dataset.view === 'chat' && !document.querySelector('#place-sheet').open);
    }
    if (['town', 'kits', 'portal'].includes(name)) {
      const options = page.locator('#conversation-options');
      const trigger = options.locator('#options-trigger');
      if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
      await page.waitForFunction(() => document.querySelector('#options-trigger')?.getAttribute('aria-expanded') === 'true');
      if (name === 'portal') { await options.locator('#client-settings-button').click(); await page.locator('#client-settings-dialog [data-view="portal"]').click(); }
      else await options.locator(`[data-view="${name}"]`).click();
    } else {
      const frame = page.frameLocator('#chat-frame');
      if (await frame.locator('#chat-places-trigger').getAttribute('aria-expanded') !== 'true') await clickChatControl(page, '#chat-places-trigger');
      await clickChatControl(page, `[data-place="${name}"]`);
    }
    await page.waitForFunction(view => document.body.dataset.view === view && document.querySelector('#place-sheet')?.open, name);
    await page.waitForFunction(() => !document.querySelector('#town-body').hasAttribute('aria-busy'));
  };
  // Settings destinations retain a single, explicit route back to the settings hub.
  await page.locator('#options-trigger').click();
  await page.locator('#client-settings-button').click();
  const settingsTitleInset = await page.locator('#client-settings-title').evaluate(el => el.getBoundingClientRect().left - el.closest('dialog').getBoundingClientRect().left);
  await page.locator('#settings-button').click();
  assert.equal(await page.locator('#settings-dialog .dialog-heading h2').evaluate((el, inset) => Math.abs(el.getBoundingClientRect().left - el.closest('dialog').getBoundingClientRect().left - inset) < 1, settingsTitleInset), true);
  assert.equal(await page.locator('#settings-dialog .dialog-heading').evaluate(el => {
    const title = el.querySelector('h2').getBoundingClientRect(), navigation = el.querySelector('.navigation-controls').getBoundingClientRect(), close = el.querySelector('.close').getBoundingClientRect();
    return navigation.left >= title.right && navigation.left - title.right <= 12 && close.left > navigation.right;
  }), true);
  await page.getByRole('button', { name: '回退', exact: true }).click();
  await page.locator('#client-settings-dialog[open]').waitFor();
  assert.equal(await page.getByRole('button', { name: '前进', exact: true }).isEnabled(), true);
  await page.locator('#close-client-settings').click();
  await page.locator('#options-trigger').click();
  await page.locator('#client-settings-button').click();
  assert.equal(await page.getByRole('button', { name: '前进', exact: true }).isDisabled(), true);
  await page.locator('#close-client-settings').click();
  await nav('town'); await page.getByText('4 项服务').waitFor();
  assert.deepEqual(await page.getByRole('tab').allTextContents(), ['服务目录', '最近更新']);
  assert.equal(await page.locator('#town-body').getByText(/居民/).count(), 0);
  await page.getByRole('tab', { name: '最近更新' }).click(); await page.getByText('New tools').waitFor();
  await nav('mail'); await page.getByRole('heading', { name: '连接 Town，继续阅读' }).waitFor();
  await page.getByRole('button', { name: '配置 Town 连接' }).click();
  await page.locator('.town-advanced-auth summary').click();
  await page.locator('#town-token').fill('town-fixture-token'); await page.getByRole('button', { name: '保存已有凭据' }).click();
  await page.getByText('一封测试来信').waitFor();
  assert.equal(await page.getByRole('button', { name: '关于我', exact: true }).count(), 0);
  await page.getByRole('tab', { name: '已发送', exact: true }).click(); await page.getByText('已发送的测试信件').waitFor();
  await nav('bonfire'); await page.locator('#town-message-0 .social-body strong').getByText('篝火测试', { exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.pwned), undefined);
  await page.getByRole('button', { name: '在右侧展示', exact: true }).click();
  await page.locator('#place-panel').waitFor();
  assert.equal(await page.locator('#place-sheet').evaluate(element => element.open), false);
  assert.deepEqual(await page.locator('.workspace-body').evaluate(element => {
    const chat = element.querySelector('.workspace-stage').getBoundingClientRect();
    const panel = element.querySelector('#place-panel').getBoundingClientRect();
    const frame = element.querySelector('#chat-frame').getBoundingClientRect();
    return { sideBySide: chat.right <= panel.left + 1, chatVisible: frame.width > 0 && frame.height > 0 };
  }), { sideBySide: true, chatVisible: true });
  assert.equal(await page.locator('#place-panel #town-message-0 .social-body strong').getByText('篝火测试', { exact: true }).count(), 1);
  await page.locator('#chat-session-panel').waitFor();
  const resizeHandle = page.locator('#place-resize-handle');
  const handleBox = await resizeHandle.boundingBox();
  const panelWidth = (await page.locator('#place-panel').boundingBox()).width;
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x - 60, handleBox.y + handleBox.height / 2, { steps: 4 });
  await page.mouse.up();
  assert.equal((await page.locator('#place-panel').boundingBox()).width > panelWidth + 40, true);
  assert.equal(await page.evaluate(() => Number(localStorage.getItem('beings:place-panel-width')) > 620), true);
  await page.getByRole('button', { name: '以弹窗显示', exact: true }).click();
  await page.locator('#place-sheet[open]').waitFor();
  assert.equal(await page.locator('#place-panel').count(), 0);
  const reply = page.locator('.feed-reply-preview');
  await reply.locator('summary').click();
  assert.equal(await reply.locator('.feed-reply-copy > span').evaluate(element => getComputedStyle(element).display), 'none');
  await reply.getByRole('button', { name: '跳转原文', exact: true }).click();
  assert.equal(await page.locator('.social-message:focus').getAttribute('id'), 'town-message-0');
  assert.deepEqual(await page.locator('.social-message:focus').evaluate(element => {
    const style = getComputedStyle(element);
    return { outline: style.outlineStyle, insetSelection: style.boxShadow.includes('inset'), radius: style.borderRadius };
  }), { outline: 'none', insetSelection: true, radius: '10px' });
  await nav('firesides'); await page.locator('.fireside-room strong').getByText('测试围炉', { exact: true }).waitFor();
  assert.deepEqual(await page.locator('#town-search').evaluate(search => {
    const toolbar = search.closest('.town-toolbar').getBoundingClientRect(), box = search.getBoundingClientRect();
    return { leftGap: Math.round(box.left - toolbar.left), fillsRow: box.width > toolbar.width * .45 };
  }), { leftGap: 0, fillsRow: true });
  await page.locator('.fireside-room[data-id="10"]').getByText('我创建的 · 3 位成员', { exact: true }).waitFor();
  const memberTrigger = page.locator('.fireside-members-trigger');
  await memberTrigger.click();
  await page.locator('.fireside-member-panel').getByText('成员名单', { exact: true }).waitFor();
  assert.deepEqual(await memberTrigger.evaluate(element => {
    const style = getComputedStyle(element);
    return { outline: style.outlineStyle, shadow: style.boxShadow };
  }), { outline: 'none', shadow: 'none' });
  assert.deepEqual(await page.locator('.fireside-member-list .fireside-member strong').allTextContents(), ['Willow', 'River', '山雀']);
  assert.deepEqual(await page.locator('.fireside-member-list .fireside-member > div:first-child > span').allTextContents(), ['t_Willow', 't_River', 't_Bird']);
  assert.equal(await page.locator('.fireside-member-meta').filter({ hasText: '炉主' }).count(), 1);
  await page.locator('.fireside-thread-heading h2').click();
  await page.locator('.fireside-member-panel').waitFor({ state: 'detached' });
  assert.equal(await memberTrigger.getAttribute('aria-expanded'), 'false');
  await memberTrigger.click();
  await page.keyboard.press('Escape');
  await page.locator('.fireside-member-panel').waitFor({ state: 'detached' });
  assert.equal(await memberTrigger.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('.fireside-room[data-id="11"] .fireside-member-names').count(), 0);
  assert.equal(await page.locator('.fireside-room[data-id="11"] .fireside-unread-dot').evaluate(element => getComputedStyle(element).display), 'none');
  await page.locator('.fireside-room[data-id="10"]').click(); await page.getByText('围炉消息', { exact: true }).waitFor();
  assert.equal(await page.locator('.fireside-thread-heading button').count(), 1);
  assert.equal(await page.locator('.fireside-thread-heading .fireside-members-trigger').count(), 1);
  const headingHeight = await page.locator('.fireside-thread-heading').evaluate(element => element.getBoundingClientRect().height);
  await page.locator('.fireside-room[data-id="11"]').click();
  await page.locator('.fireside-thread[aria-busy="true"] .fireside-loading-controls').waitFor();
  assert.equal(await page.locator('.fireside-thread-heading').evaluate(element => element.getBoundingClientRect().height), headingHeight);
  await page.getByText('第二围炉消息', { exact: true }).waitFor();
  assert.equal(await page.locator('.fireside-thread-heading').evaluate(element => element.getBoundingClientRect().height), headingHeight);
  const roomGeometry = async () => page.locator('.fireside-room[data-id="10"]').evaluate(element => ({
    top: element.getBoundingClientRect().top,
    height: element.getBoundingClientRect().height,
    scrollTop: element.parentElement.scrollTop,
    directoryTop: element.closest('.fireside-rooms').getBoundingClientRect().top,
    headingTop: element.closest('.fireside-rooms').querySelector('h2').getBoundingClientRect().top,
    liveHeight: document.querySelector('.town-live-row').getBoundingClientRect().height,
    statusHeight: document.querySelector('.list-status').getBoundingClientRect().height,
    bodyScrollTop: document.querySelector('#town-body').scrollTop,
    threadScrollTop: document.querySelector('.fireside-thread').scrollTop,
  }));
  await page.locator('.fireside-thread').evaluate(element => { element.scrollTop = 120; });
  const beforeRoomRefresh = await roomGeometry();
  await page.locator('#town-refresh').click();
  await page.locator('#town-body[aria-busy="true"]').waitFor();
  assert.deepEqual(await roomGeometry(), beforeRoomRefresh);
  await page.waitForFunction(() => !document.querySelector('#town-body').hasAttribute('aria-busy'));
  assert.deepEqual(await roomGeometry(), beforeRoomRefresh);
  await nav('kits'); await page.locator('.catalog-item').first().click(); await page.getByText('test_tool', { exact: true }).waitFor();
  await page.locator('.tool-item summary').click(); await page.getByText('"query":', { exact: false }).waitFor();
  await page.getByRole('button', { name: '查看经验墙', exact: true }).click();
  await page.waitForFunction(() => document.body.dataset.view === 'seeds' && !document.querySelector('#town-body').hasAttribute('aria-busy'));
  // Horizontal history gestures are enabled only on macOS.
  if (process.platform === 'darwin') {
    await page.locator('#place-sheet').dispatchEvent('wheel', { deltaX: -80, deltaY: 0, deltaMode: 0 });
  } else {
    await page.getByRole('button', { name: '回退', exact: true }).click();
  }
  await page.waitForFunction(() => document.body.dataset.view === 'kits' && !document.querySelector('#town-body').hasAttribute('aria-busy'));
  await page.getByRole('button', { name: '前进', exact: true }).click();
  await page.waitForFunction(() => document.body.dataset.view === 'seeds' && !document.querySelector('#town-body').hasAttribute('aria-busy'));
  await page.getByRole('button', { name: '回退', exact: true }).click();
  await page.waitForFunction(() => document.body.dataset.view === 'kits' && !document.querySelector('#town-body').hasAttribute('aria-busy'));
  await page.getByRole('button', { name: '下一页 →' }).click(); await page.getByText('第 2 页 · 共 25 项').waitFor(); assert.equal(await page.locator('.catalog-item').count(), 1);
  await page.locator('#town-search').fill('does-not-exist'); await page.getByText('当前页没有符合条件的内容。').waitFor();
  await page.getByRole('tab', { name: '本机 Kits', exact: true }).click(); await page.getByText('给 Being 添一件工具').waitFor();
  await nav('embers'); await page.locator('.catalog-item').first().click(); await page.getByText('完整内容', { exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.pwned), undefined);
  // Exercise consecutive modal closes and iframe navigation without sleeps
  // between places. Each pointer click must open the requested place once.
  for (let round = 0; round < 3; round++) {
    await nav('bonfire'); await page.locator('#town-message-0 .social-body strong').getByText('篝火测试', { exact: true }).waitFor();
    await nav('embers'); await page.locator('.catalog-item').first().waitFor();
  }
  await nav('kits'); await page.getByRole('tab', { name: 'Grove 市集', exact: true }).click();
  await page.locator('.catalog-item').first().click(); await page.getByRole('button', { name: '安装到本机', exact: true }).click();
  await page.getByRole('heading', { name: '安装 downloaded-kit', exact: true }).waitFor();
  await page.locator('#kit-env-FIXTURE_API_KEY').fill('fixture-value');
  await mkdir('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/kit-install.png' });
  await page.locator('.kit-install-form').getByRole('button', { name: '安装到本机', exact: true }).click();
  await page.locator('.kit-detail').getByRole('button', { name: '已安装', exact: true }).waitFor({ timeout: 60000 });
  assert.equal(await page.getByRole('tab', { name: 'Grove 市集', exact: true }).getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('.catalog-item').filter({ hasText: 'downloaded-kit' }).count(), 1);
  assert.equal(await page.locator('.kit-detail').getByRole('button', { name: '已安装', exact: true }).isDisabled(), true);
  const downloaded = JSON.parse(await readFile(path.join(dir, 'kits/downloaded-kit/manifest.json'), 'utf8'));
  assert.equal(downloaded.tools[0].name, 'downloaded_ping');
  assert(!JSON.stringify(downloaded).includes('fixture-value'));
  assert((await readFile(path.join(dir, 'kits/downloaded-kit/.env'), 'utf8')).includes('FIXTURE_API_KEY="fixture-value"'));
  assert.equal(await page.locator('#kit-env-FIXTURE_API_KEY').count(), 0);
  // Real importer: native chooser and confirmation are mocked only inside the test process.
  const source = path.join(dir, 'test-kit'); await mkdir(source);
  await writeFile(path.join(source, 'manifest.json'), JSON.stringify({ name: 'desktop-test-kit', version: '1.0', command: ['node', 'server.mjs'], tools: [{ name: 'fixture_tool', description: 'Fixture tool', params: { type: 'object' } }] }));
  await writeFile(path.join(source, 'server.mjs'), 'throw new Error("must not execute on import");');
  await app.evaluate(({ dialog }, source) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] }); dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); }, source);
  await nav('kits'); await page.getByRole('tab', { name: '本机 Kits', exact: true }).click();
  await page.getByRole('button', { name: '导入本地 Kit', exact: true }).click(); await page.locator('.catalog-item').filter({ hasText: 'desktop-test-kit' }).click(); await page.getByText('fixture_tool', { exact: true }).waitFor();
  await mkdir('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/kits.png' });
  const requests = await app.evaluate(() => globalThis.townRequests);
  assert(requests.filter(r => ['/api', '/api/grove', '/api/embers'].includes(r.path)).every(r => r.authorization === null));
  assert(requests.some(r => r.path === '/api/messages' && r.authorization === 'Bearer town-fixture-token'));
  const bodyBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.match(bodyBackground, /^rgb\(\d+, \d+, \d+\)$/, 'Renderer uses the configured opaque app background');
  assert.deepEqual(errors, []); console.log('Town UI passed: native material, real IPC, auth, mail folders, markdown, pagination, Kit import and tool schemas.');
} catch (error) {
  await mkdir('test-results', { recursive: true });
  await app?.windows()[0]?.screenshot({ path: 'test-results/town-failure.png' }).catch(() => {});
  throw error;
} finally {
  try {
    if (app) {
      await mkdir('test-results', { recursive: true });
      await app.context().tracing.stop({ path: 'test-results/town-trace.zip' }).catch(() => {});
      await app.close();
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
}
