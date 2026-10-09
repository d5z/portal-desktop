// Real shell/preload/protocol + sandboxed plugin. Isolated profile, no real Being calls.
import { build } from 'esbuild';
import { createServer, build as buildRenderer } from 'vite';
import electron from 'electron';
import { launchDesktop } from './support/electron-lifecycle.mjs';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { c as archive } from 'tar';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

const root = path.resolve('.');
if (!process.env.STARMAP_PLUGIN_DIR) {
  throw new Error('请先在 https://github.com/chunqing-liu/starmap 独立仓库执行 npm ci && npm run check，再将 STARMAP_PLUGIN_DIR 设置为其 dist 绝对路径。');
}
const plugin = path.resolve(process.env.STARMAP_PLUGIN_DIR);
await readFile(path.join(plugin, 'desktop.plugin.json'));
await readFile(path.join(plugin, 'index.html'));
const activePluginFrame = async page => (await page.locator('.plugin-frame:visible').elementHandle()).contentFrame();
const temporary = await mkdtemp(path.join(os.tmpdir(), 'grove-plugin-electron-'));
const profile = path.join(temporary, 'profile');
const screenshots = path.join(root, 'output/playwright/plugins');
let app, server;
try {
  await readFile(path.join(plugin, 'index.html'));
  const packaged = process.argv.includes('--packaged') || process.env.PLUGIN_TEST_PACKAGED === '1';
  const rendererAssets = path.join(temporary, 'renderer');
  let url = '';
  if (packaged) await buildRenderer({ configFile: path.join(root, 'vite.renderer.config.ts'), build: { outDir: rendererAssets } });
  else {
    server = await createServer({ configFile: path.join(root, 'vite.renderer.config.ts'), server: { host: '127.0.0.1', port: 0 } });
    await server.listen(); url = `http://127.0.0.1:${server.httpServer.address().port}/`;
  }
  const buildDirectory = path.join(temporary, 'build');
  await build({ entryPoints: ['desktop/main/main.ts'], outfile: path.join(buildDirectory, 'main.js'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'], loader: { '.py': 'text', '.ps1': 'text' }, plugins: [{ name: 'offline-fixture-store', setup(build) {
    build.onLoad({ filter: /desktop[\\/]main[\\/]main\.ts$/ }, async args => {
      let source = await readFile(args.path, 'utf8');
      if (packaged) source = source.replace("path.resolve('desktop/generated')", JSON.stringify(rendererAssets));
      const anchor = 'store = new SettingsStore(directory, secretStorage, binary);';
      assert(source.includes(anchor));
      return { contents: source.replace(anchor, `${anchor}\n(globalThis as any).pluginFixtureStore = store;`), loader: 'ts' };
    });
  } }], define: {
    MAIN_WINDOW_VITE_DEV_SERVER_URL: JSON.stringify(url), MAIN_WINDOW_VITE_NAME: '"main_window"',
    PORTAL_DESKTOP_BUILD: '"plugins-test"', PORTAL_DESKTOP_UPDATE_REPOSITORY: '"fixture/repo"',
  } });
  await build({ entryPoints: ['desktop/preload/preload.ts'], outfile: path.join(buildDirectory, 'preload.js'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
  app = await launchDesktop({ executablePath: electron, args: [path.join(buildDirectory, 'main.js')], cwd: root,
    env: { ...process.env, PORTAL_DESKTOP_USER_DATA: profile } });
  const page = await app.firstWindow();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') console.log('renderer:', message.text().slice(0, 250)); });
  await app.evaluate(({ dialog, protocol }, plugin) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [plugin] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    protocol.handle('https', () => Response.json({ services: {}, kits: [], count: 0 }));
  }, plugin);
  await page.locator('#client-main').waitFor({ state: 'visible' });
  await page.locator('#options-trigger').click();
  await page.locator('button[data-view="kits"]').click();
  await page.locator('#place-sheet').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '在右侧展示', exact: true }).click();
  await page.locator('#place-panel').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '以弹窗显示', exact: true }).click();
  await page.locator('#place-sheet').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => typeof window.beings.panelWindow), 'undefined');
  await page.getByRole('tab', { name: 'Plugin', exact: true }).click();
  await page.getByRole('button', { name: '导入插件目录' }).click();
  await page.locator('.plugin-card').waitFor();
  const importedPlugins = (await page.evaluate(() => window.beings.plugins.list())).plugins;
  assert.equal(importedPlugins.length, 1);
  const importedDigest = importedPlugins[0].sha256;
  await page.locator('.plugin-card').getByRole('button', { name: '流程看板', exact: true }).click();
  const frameLocator = page.frameLocator('.plugin-frame:visible');
  await frameLocator.locator('.react-flow__node').first().waitFor();
  const pluginFrame = await activePluginFrame(page);
  assert(pluginFrame, 'plugin has its own frame');
  const canvasBounds = await frameLocator.locator('.react-flow').boundingBox();
  assert(canvasBounds.height > 300 && canvasBounds.width > 400, 'canvas must have usable geometry');
  const visibleNodes = await pluginFrame.evaluate(() => {
    const pane = document.querySelector('.react-flow').getBoundingClientRect();
    return [...document.querySelectorAll('.react-flow__node')].filter(node => {
      const rect = node.getBoundingClientRect();
      return rect.width > 50 && rect.height > 20 && rect.left < pane.right && rect.right > pane.left && rect.top < pane.bottom && rect.bottom > pane.top;
    }).length;
  });
  assert(visibleNodes > 3, 'multiple graph nodes must be visible inside the canvas');
  const security = await pluginFrame.evaluate(async () => {
    let parentBlocked = false, storageBlocked = false, networkBlocked = false;
    try { void parent.document.body; } catch { parentBlocked = true; }
    try { void localStorage.length; } catch { storageBlocked = true; }
    try { await fetch('https://beings.town/api'); } catch { networkBlocked = true; }
    return { parentBlocked, storageBlocked, networkBlocked, node: typeof window.require, preload: typeof window.beings, sdk: window.grove.apiVersion };
  });
  assert.deepEqual(security, { parentBlocked: true, storageBlocked: true, networkBlocked: true, node: 'undefined', preload: 'undefined', sdk: 1 });
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: path.join(screenshots, 'pipeline-loaded.png') });
  await frameLocator.getByRole('button', { name: '专注', exact: true }).click();
  assert(await frameLocator.locator('#pipeline-view').evaluate(el => el.classList.contains('pipeline-focus-mode')));
  await pluginFrame.locator('body').press('Escape');
  assert(!await frameLocator.locator('#pipeline-view').evaluate(el => el.classList.contains('pipeline-focus-mode')));
  await frameLocator.getByRole('button', { name: '+ 新建星轨', exact: true }).click();
  await frameLocator.getByRole('textbox', { name: '任务名称' }).fill('插件持久化验收');
  await frameLocator.getByRole('textbox', { name: '任务名称' }).press('Tab');
  await frameLocator.getByRole('button', { name: '+ 节点', exact: true }).click();
  await frameLocator.getByRole('textbox', { name: '名称', exact: true }).fill('插件中的任务');
  await frameLocator.locator('.pipeline-comments summary').click();
  await frameLocator.getByRole('textbox', { name: '留言建议' }).fill('评论也通过插件存储保存');
  await frameLocator.getByRole('button', { name: '发送评论', exact: true }).click();
  const node = frameLocator.locator('.react-flow__node-item').first();
  const before = await node.boundingBox();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down(); await page.mouse.move(before.x + before.width / 2 + 45, before.y + before.height / 2 + 40, { steps: 8 }); await page.mouse.up();
  const after = await node.boundingBox();
  assert(Math.abs(after.x - before.x) > 20, 'pointer drag moves a graph node');
  await pluginFrame.waitForFunction(() => document.getElementById('plugin-status').textContent === '已保存到本机');
  // Placement is configured per view; pinned entries survive a renderer restart.
  await page.getByRole('button', { name: '管理插件', exact: true }).click();
  await page.getByLabel('流程看板显示位置', { exact: true }).selectOption('navigation');
  await page.locator('.place-switcher').getByRole('button', { name: '流程看板', exact: true }).waitFor();
  await page.reload();
  await page.locator('#client-main').waitFor({ state: 'visible' });
  await page.locator('#options-trigger').click(); await page.locator('button[data-view="kits"]').click();
  await page.locator('.place-switcher').getByRole('button', { name: '流程看板', exact: true }).click();
  await page.frameLocator('.plugin-frame:visible').getByRole('button', { name: /插件持久化验收/ }).waitFor();
  assert.equal(await page.locator('.place-switcher [aria-current="page"]').innerText(), '流程看板');
  const functionRow = page.locator('.place-switcher');
  const libraryEntry = await functionRow.getByRole('button', { name: '工具库', exact: true }).boundingBox();
  const pluginEntry = await functionRow.getByRole('button', { name: '流程看板', exact: true }).boundingBox();
  assert(Math.abs(libraryEntry.y - pluginEntry.y) < 2, 'plugin is in the same function row as the tool library');
  assert.equal(await page.locator('.plugin-pinned-tabs').count(), 0);
  await page.screenshot({ path: path.join(screenshots, 'plugin-function-row.png') });
  await page.getByRole('button', { name: '管理插件', exact: true }).click();
  await page.getByLabel('流程看板显示位置', { exact: true }).selectOption('window');
  await page.getByLabel('流程看板显示位置', { exact: true }).waitFor({ state: 'visible' });
  const opened = app.waitForEvent('window');
  await page.locator('.plugin-card').getByRole('button', { name: '流程看板', exact: true }).click();
  let floating = await opened;
  floating.on('pageerror', error => errors.push(error.message));
  await floating.frameLocator('.plugin-frame').getByRole('button', { name: /插件持久化验收/ }).waitFor();
  assert.equal(await floating.evaluate(() => typeof window.beings), 'undefined', 'independent host has no full client API');
  let floatingFrame = await activePluginFrame(floating);
  assert(await floatingFrame.evaluate(async () => Boolean(await grove.loadData())));
  let floatingToken = new URL(floatingFrame.url()).pathname.slice(1, -5);
  // Tokens from another host cannot be used by this window.
  const otherSession = await page.evaluate(() => window.beings.plugins.open('community.pipeline', 'board'));
  assert.match(await floating.evaluate(async token => { try { await window.beingsPluginWindow.call(token, 'storage.load'); return ''; } catch (e) { return e.message; } }, otherSession.token), /不属于/);
  await page.evaluate(token => window.beings.plugins.close(token), otherSession.token);
  await page.evaluate(() => window.beings.plugins.openWindow('community.pipeline', 'board'));
  assert.equal(app.windows().length, 2, 'reopening focuses the existing view window');
  // A new Town generation must close the stale host, not leave a dead window to reuse.
  const reconnectClosed = floating.waitForEvent('close');
  await page.evaluate(() => window.beings.reconnectTown());
  await reconnectClosed;
  assert.match(await page.evaluate(async token => { try { await window.beings.plugins.call(token, 'storage.load'); return ''; } catch (e) { return e.message; } }, floatingToken), /关闭/);
  const reopened = app.waitForEvent('window');
  await page.evaluate(() => window.beings.plugins.openWindow('community.pipeline', 'board'));
  floating = await reopened;
  floating.on('pageerror', error => errors.push(error.message));
  await floating.frameLocator('.plugin-frame').getByRole('button', { name: /插件持久化验收/ }).waitFor();
  floatingFrame = await activePluginFrame(floating);
  assert(await floatingFrame.evaluate(async () => Boolean(await grove.loadData())));
  const previousToken = floatingToken;
  floatingToken = new URL(floatingFrame.url()).pathname.slice(1, -5);
  assert.notEqual(floatingToken, previousToken);
  await floating.screenshot({ path: path.join(screenshots, 'plugin-independent-window.png') });
  const closedFloating = floating.waitForEvent('close');
  await floating.getByRole('button', { name: '回到主窗口', exact: true }).click();
  await page.frameLocator('.plugin-frame:visible').getByRole('button', { name: /插件持久化验收/ }).waitFor();
  await closedFloating;
  assert.match(await page.evaluate(async token => { try { await window.beings.plugins.call(token, 'storage.load'); return ''; } catch (e) { return e.message; } }, floatingToken), /关闭/);
  await page.getByRole('button', { name: '管理插件', exact: true }).click();
  await page.getByLabel('流程看板显示位置', { exact: true }).selectOption('page');
  await page.locator('.plugin-card').getByRole('button', { name: '流程看板', exact: true }).click();
  await page.frameLocator('.plugin-frame:visible').getByRole('button', { name: /插件持久化验收/ }).waitFor();

  await page.getByRole('button', { name: '管理插件', exact: true }).click();
  await page.getByRole('button', { name: '停用', exact: true }).click();
  await page.getByRole('button', { name: '启用', exact: true }).waitFor();
  assert(await page.locator('.plugin-card').getByRole('button', { name: '流程看板', exact: true }).isDisabled());
  assert.equal(await page.locator('.plugin-frame:visible').count(), 0);
  await page.getByRole('button', { name: '启用', exact: true }).click();
  await page.locator('.plugin-card').getByRole('button', { name: '流程看板', exact: true }).click();
  await page.frameLocator('.plugin-frame:visible').getByRole('button', { name: /插件持久化验收/ }).waitFor();
  await page.frameLocator('.plugin-frame:visible').locator('.react-flow__node-item').filter({ hasText: '插件中的任务' }).click();
  if (!await page.frameLocator('.plugin-frame:visible').locator('.pipeline-comments').evaluate(element => element.open))
    await page.frameLocator('.plugin-frame:visible').locator('.pipeline-comments summary').click();
  await page.frameLocator('.plugin-frame:visible').getByText('评论也通过插件存储保存', { exact: true }).waitFor();
  await page.getByRole('button', { name: '管理插件', exact: true }).click();
  await page.getByRole('button', { name: '卸载', exact: true }).click();
  await page.getByText('尚未安装插件。', { exact: true }).waitFor();
  // Use the original Release archive when supplied; exercise download IPC offline.
  const bundleFile = process.env.STARMAP_PLUGIN_ARCHIVE
    ? path.resolve(process.env.STARMAP_PLUGIN_ARCHIVE) : path.join(temporary, 'desktop-plugin.tar.gz');
  if (!process.env.STARMAP_PLUGIN_ARCHIVE) await archive({ cwd: plugin, gzip: true, file: bundleFile }, ['desktop.plugin.json', 'index.html']);
  const manifest = JSON.parse(await readFile(path.join(plugin, 'desktop.plugin.json'), 'utf8'));
  await app.evaluate(({ protocol }, { manifest, bundle }) => {
    protocol.unhandle('https');
    globalThis.pluginDownloadAuth = [];
    protocol.handle('https', request => {
      globalThis.pluginDownloadAuth.push(request.headers.get('authorization'));
      return request.url.includes('/download')
        ? new Response(Uint8Array.from(atob(bundle), c => c.charCodeAt(0)), { headers: { 'Content-Type': 'application/gzip' } })
        : Response.json({ id: 'pipeline', name: manifest.name, version: manifest.version,
          ...(globalThis.pluginAppRelease ? { kind: 'app', tags: ['plugin'], repo_url: 'https://github.com/fixture/pipeline', release_tag: 'v1.0.0' } : { kind: 'plugin', tags: [], has_bundle: true }) });
    });
  }, { manifest, bundle: (await readFile(bundleFile)).toString('base64') });
  assert.equal(await page.evaluate(() => window.beings.plugins.installGrove('pipeline')), true);
  assert.equal((await page.evaluate(() => window.beings.plugins.list())).plugins[0].source.kind, 'grove');
  assert.equal((await page.evaluate(() => window.beings.plugins.list())).plugins[0].sha256, importedDigest, 'Grove bundle must match the directory import');
  assert.equal(await page.evaluate(() => window.beings.plugins.remove('community.pipeline')), true);
  await app.evaluate(() => { globalThis.pluginAppRelease = true; });
  assert.equal(await page.evaluate(() => window.beings.plugins.installGrove('pipeline')), true);
  assert.equal((await page.evaluate(() => window.beings.plugins.list())).plugins[0].sha256, importedDigest, 'Release asset must match the directory import');
  assert((await app.evaluate(() => globalThis.pluginDownloadAuth)).every(value => value === null));
  await page.getByRole('button', { name: '刷新内容', exact: true }).click();
  await page.locator('.plugin-card').getByRole('button', { name: '流程看板', exact: true }).click();
  await page.frameLocator('.plugin-frame:visible').getByRole('button', { name: /插件持久化验收/ }).waitFor();
  await page.evaluate(() => window.beings.appearance('dark'));
  await page.reload();
  await page.locator('#client-main').waitFor({ state: 'visible' });
  await page.locator('#options-trigger').click();
  await page.locator('button[data-view="kits"]').click();
  await page.locator('.plugin-card').getByRole('button', { name: '流程看板', exact: true }).click();
  await page.frameLocator('.plugin-frame:visible').getByRole('button', { name: /插件持久化验收/ }).waitFor();
  const darkFrame = await activePluginFrame(page);
  await darkFrame.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.screenshot({ path: path.join(screenshots, 'pipeline-dark.png') });
  // Swap only this temporary process's in-memory connection. No Portal startup or real credentials.
  const scene = (await page.evaluate(() => window.beings.snapshot())).chatScene.scene_id;
  const taskDirectory = path.join(temporary, 'subagent'); await mkdir(taskDirectory);
  const configFile = path.join(temporary, 'portal.toml');
  await writeFile(configFile, `[subagent]\nstate_dir = ${JSON.stringify(taskDirectory.replaceAll('\\', '/'))}\nenabled = true\n`);
  const ledgerFile = path.join(taskDirectory, 'ledger.json');
  const taskLedger = status => ({ tasks: [{ task_id: 'sdk-task-1', scene_id: scene, status, created_ms: 1, error: 'must-not-leak' }, { task_id: 'other-task', scene_id: 'other', status: 'running', created_ms: 1 }] });
  await writeFile(ledgerFile, JSON.stringify(taskLedger('running')));
  await app.evaluate((_electron, file) => { globalThis.pluginFixtureStore.settings.portalConfigPath = file; }, configFile);
  await app.evaluate(({ protocol, dialog }, sceneId) => {
    const store = globalThis.pluginFixtureStore;
    store.connection = { endpoint: 'https://sdk-fixture.test/test', being: 'test', token: 'fixture-only-token', relaySecret: 'fixture-only-secret', link: '' };
    store.settings = { ...store.settings, endpoint: store.connection.endpoint, being: 'test', hasToken: true };
    globalThis.pluginSent = []; globalThis.pluginConfirm = true;
    dialog.showMessageBox = async (_window, options) => ({ response: options.title === '插件发起 Being 对话' && !globalThis.pluginConfirm ? 0 : 1 });
    protocol.unhandle('https');
    protocol.handle('https', async request => {
      const url = new URL(request.url);
      if (url.pathname === '/api/seeds/seed-sdk') return Response.json({ id: 'seed-sdk', name: globalThis.seedRevision ? '更新后的种子' : 'SDK 测试种子', brief: globalThis.seedRevision ? '刷新内容' : '这是工作区资源摘要', revision: globalThis.seedRevision || 1 });
      if (url.hostname !== 'sdk-fixture.test') return Response.json({ seeds: [{ id: 'seed-sdk', name: 'SDK 测试种子' }], count: 1 });
      if (url.pathname.endsWith('/api/history')) return Response.json({ messages: [
        { seq: 1, scene_id: 'other', role: 'user', content: 'other scene' },
        { seq: 2, scene_id: sceneId, role: 'being', content: '本场景历史', at: new Date().toISOString(), internal: 'hidden' },
      ] });
      if (url.pathname.endsWith('/api/stream/active')) return new Response(null, { status: 204 });
      if (url.pathname.endsWith('/api/chat/stream')) {
        const body = await request.json(); globalThis.pluginSent.push(body);
        return new Response('event: content_block_delta\ndata: {"delta":{"text":"SDK 建议"}}\n\nevent: message_stop\ndata: {}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
      }
      return Response.json({ sbs_enabled: false, being_name: 'Test Being', services: {} });
    });
  }, scene);
  await page.reload();
  await page.locator('#client-main').waitFor({ state: 'visible' });
  await page.frameLocator('#chat-frame').locator('#input').waitFor();
  for (const modifier of ['Control', 'Meta']) {
    await page.frameLocator('#chat-frame').locator('#input').press(`${modifier}+Shift+P`);
    await page.getByRole('searchbox', { name: '搜索插件命令' }).waitFor();
    await page.locator('#plugin-commands').getByRole('button', { name: '关闭', exact: true }).click();
    await page.locator('#plugin-commands').waitFor({ state: 'hidden' });
  }
  await page.locator('#options-trigger').click(); await page.locator('button[data-view="kits"]').click();
  await page.locator('.plugin-card').getByRole('button', { name: '流程看板', exact: true }).click();
  await page.frameLocator('.plugin-frame:visible').locator('.react-flow__node').first().waitFor();
  let sdkFrame = await activePluginFrame(page);
  const sdkResult = await sdkFrame.evaluate(async () => {
    const context = await grove.being.context(), history = await grove.being.history();
    const town = await grove.town.query({ kind: 'seeds' });
    let denied = false; try { await grove.town.query({ kind: 'inbox' }); } catch { denied = true; }
    return { context, history, town, denied, sdkVersion: grove.sdkVersion };
  });
  assert.equal(sdkResult.sdkVersion, '1.3.0'); assert.equal(sdkResult.context.sceneId, scene);
  assert.equal(sdkResult.history.messages.length, 1); assert.equal(sdkResult.history.messages[0].content, '本场景历史');
  assert(!JSON.stringify(sdkResult).includes('fixture-only')); assert(sdkResult.denied);
  assert.equal(sdkResult.town.data.seeds[0].id, 'seed-sdk');
  const sdkWindowOpened = app.waitForEvent('window');
  await page.evaluate(() => window.beings.plugins.openWindow('community.pipeline', 'board'));
  const sdkWindow = await sdkWindowOpened;
  sdkWindow.on('pageerror', error => errors.push(error.message));
  await sdkWindow.frameLocator('.plugin-frame').locator('.react-flow__node').first().waitFor();
  const independentSDK = await activePluginFrame(sdkWindow);
  const windowData = await independentSDK.evaluate(async () => ({
    context: await grove.being.context(), history: await grove.being.history(), tasks: await grove.being.tasks.list(), town: await grove.town.query({ kind: 'seeds' }),
  }));
  assert.equal(windowData.context.sceneId, scene);
  assert.equal(windowData.history.messages.length, 1);
  assert.equal(windowData.tasks.tasks.length, 1);
  assert.equal(windowData.town.data.seeds[0].id, 'seed-sdk');
  assert.deepEqual(await independentSDK.evaluate(() => grove.being.compose('SDK 草稿')), { inserted: true });
  await page.evaluate(() => window.beings.appearance('light'));
  await independentSDK.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await page.evaluate(() => window.beings.appearance('dark'));
  await independentSDK.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  const independentStream = await independentSDK.evaluate(async () => {
    let text = ''; const dispose = grove.being.onDelta(data => { text += data.text; });
    await grove.being.chat('独立窗口 SDK 消息'); dispose(); return text;
  });
  assert.equal(independentStream, 'SDK 建议');
  await app.evaluate(() => { globalThis.pluginSent = []; });
  const revokedWindowToken = new URL(independentSDK.url()).pathname.slice(1, -5);
  const sdkClosed = sdkWindow.waitForEvent('close');
  await page.evaluate(() => window.beings.plugins.setEnabled('community.pipeline', false));
  await sdkClosed;
  assert.match(await page.evaluate(async token => { try { await window.beings.plugins.call(token, 'storage.load'); return ''; } catch (e) { return e.message; } }, revokedWindowToken), /关闭/);
  await page.evaluate(() => window.beings.plugins.setEnabled('community.pipeline', true));
  await page.getByRole('button', { name: '管理插件', exact: true }).click();
  await page.locator('.plugin-card').getByRole('button', { name: '流程看板', exact: true }).click();
  await page.frameLocator('.plugin-frame:visible').locator('.react-flow__node').first().waitFor();
  sdkFrame = await activePluginFrame(page);
  assert.equal(await page.frameLocator('#chat-frame').locator('#input').inputValue(), 'SDK 草稿');
  assert.deepEqual(await sdkFrame.evaluate(() => grove.being.compose('不能覆盖')), { inserted: false });
  assert.equal((await app.evaluate(() => globalThis.pluginSent)).length, 0);
  await app.evaluate(() => { globalThis.pluginConfirm = false; });
  assert.match(await sdkFrame.evaluate(async () => { try { await grove.being.chat('取消的消息'); return ''; } catch (error) { return error.message; } }), /取消/);
  await app.evaluate(() => { globalThis.pluginConfirm = true; });
  const streamed = await sdkFrame.evaluate(async () => {
    let text = ''; const dispose = grove.being.onDelta(data => { text += data.text; });
    const reply = await grove.being.chat('SDK 测试消息'); dispose(); return { reply, text };
  });
  assert.equal(streamed.text, 'SDK 建议'); assert.equal(streamed.reply.status, 'completed');
  const sent = await app.evaluate(() => globalThis.pluginSent); assert.equal(sent.length, 1); assert.equal(sent[0].scene_id, scene);
  await sdkFrame.getByRole('button', { name: 'Town / Being 协作', exact: true }).press('Control+Shift+P');
  await page.getByRole('searchbox', { name: '搜索插件命令' }).fill('Being');
  await page.getByRole('button', { name: '星图流程看板 · 打开 Being 协作', exact: true }).click();
  await page.frameLocator('.plugin-frame:visible').getByRole('region', { name: 'Town 与 Being 协作' }).waitFor();
  await page.frameLocator('.plugin-frame:visible').getByRole('button', { name: '查找种子', exact: true }).click();
  await page.frameLocator('.plugin-frame:visible').getByRole('button', { name: 'SDK 测试种子', exact: true }).waitFor();
  await page.screenshot({ path: path.join(screenshots, 'pipeline-sdk.png') });
  // A resource and its plugin sidebar share the original reading surface.
  sdkFrame = await activePluginFrame(page);
  await sdkFrame.evaluate(() => grove.ui.navigate('seeds', 'seed-sdk'));
  await page.locator('.plugin-resource-menu summary').click();
  await page.getByRole('button', { name: '星图流程看板 · 分析当前资源', exact: true }).click();
  let sidebar = page.frameLocator('.plugin-frame:visible');
  await sidebar.getByRole('heading', { name: 'SDK 测试种子', exact: true }).waitFor();
  let sideFrame = await activePluginFrame(page);
  const tasks = await sideFrame.evaluate(() => grove.being.tasks.list());
  assert.equal(tasks.tasks.length, 1); assert(!JSON.stringify(tasks).includes('must-not-leak'));
  await sideFrame.evaluate(async () => { globalThis.workspaceEvents = []; globalThis.stopWorkspace = await grove.events.subscribe('workspace.changed', event => workspaceEvents.push(event)); });
  await app.evaluate(() => { globalThis.seedRevision = 2; });
  await page.locator('#town-refresh').click();
  await page.locator('.seed-detail .reading-title').getByText('更新后的种子', { exact: true }).waitFor();
  await sidebar.getByRole('heading', { name: '更新后的种子', exact: true }).waitFor();
  assert.equal((await sideFrame.evaluate(() => workspaceEvents)).at(-1).topic, 'workspace.changed');
  await sideFrame.evaluate(() => stopWorkspace());
  await writeFile(ledgerFile, JSON.stringify(taskLedger('done')));
  await sidebar.locator('[data-task-status="done"]').waitFor();
  await page.screenshot({ path: path.join(screenshots, 'pipeline-workspace.png') });
  const sideToken = new URL((await activePluginFrame(page)).url()).pathname.slice(1, -5);
  await page.getByRole('button', { name: '关闭插件侧栏', exact: true }).click();
  assert.equal(await page.locator('.plugin-sidebar').count(), 0);
  assert.match(await page.evaluate(async token => { try { await window.beings.plugins.call(token, 'workspace.context'); return ''; } catch (error) { return error.message; } }, sideToken), /关闭/);
  await page.locator('.place-switcher').getByRole('button', { name: '工具库', exact: true }).click();
  await page.getByRole('tab', { name: 'Plugin', exact: true }).click();
  await page.getByLabel('仅本机存在', { exact: true }).check();
  await page.locator('.plugin-card:visible').waitFor();
  assert.equal(await page.getByRole('tab', { name: '本机 Kits', exact: true }).count(), 0);
  assert.equal(await page.getByRole('tablist', { name: '工作区标签', exact: true }).count(), 0);
  await page.screenshot({ path: path.join(screenshots, 'tools-library.png') });
  await page.locator('.plugin-card').getByRole('button', { name: '流程看板', exact: true }).click();
  await page.frameLocator('.plugin-frame:visible').locator('.react-flow__node-item').filter({ hasText: '插件中的任务' }).click();
  await page.frameLocator('.plugin-frame:visible').getByRole('combobox', { name: '当前场景任务', exact: true }).selectOption('sdk-task-1');
  await page.frameLocator('.plugin-frame:visible').getByRole('textbox', { name: '描述', exact: true }).fill('有验收描述的任务');
  await page.frameLocator('.plugin-frame:visible').getByRole('button', { name: '应用任务状态到节点', exact: true }).click();
  assert.equal(await page.frameLocator('.plugin-frame:visible').getByRole('combobox', { name: '状态', exact: true }).inputValue(), 'done');
  await writeFile(ledgerFile, JSON.stringify(taskLedger('failed')));
  await page.frameLocator('.plugin-frame:visible').locator('[data-task-status="failed"]').waitFor();
  // Stop syncing when the plugin is removed from the active surface.
  await page.getByRole('button', { name: '管理插件', exact: true }).click();
  await page.getByRole('button', { name: '插件设置', exact: true }).click();
  await page.frameLocator('.plugin-frame:visible').getByRole('textbox', { name: '协作提示' }).fill('先检查验收标准');
  await page.frameLocator('.plugin-frame:visible').getByRole('button', { name: '保存设置' }).click();
  await page.frameLocator('.plugin-frame:visible').getByText('已保存到本机', { exact: true }).waitFor();
  sdkFrame = await activePluginFrame(page);
  const staleToken = new URL(sdkFrame.url()).pathname.slice(1, -5);
  await page.evaluate(async () => { const snapshot = await window.beings.snapshot(); await window.beings.changeChatSession('create', 'SDK 场景 B', snapshot.settings.endpoint); });
  assert.match(await page.evaluate(async token => { try { await window.beings.plugins.call(token, 'being.history'); return ''; } catch (error) { return error.message; } }, staleToken), /关闭/);
  assert.deepEqual(errors, []);
  console.log('PASS: persistent plugin placement; pinned navigation; isolated native windows/docking/reuse/revocation/theme/SDK; tool library and sidebar lifecycle; sandbox/SDK/storage; Town/Being; live workspace and task events/binding; scene revocation.');
} catch (error) {
  if (app) {
    const page = await app.firstWindow();
    await mkdir(screenshots, { recursive: true });
    await page.screenshot({ path: path.join(screenshots, 'failure.png') }).catch(() => {});
    console.error((await page.locator('body').innerText()).slice(0, 4000));
  }
  throw error;
} finally {
  if (app) await app.close();
  if (server) await server.close();
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
