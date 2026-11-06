// Isolated real shell/preload/registry test; no remote plugin repository required.
import { build } from 'esbuild';
import { createServer } from 'vite';
import electron from 'electron';
import { desktopFixtureBanner } from './support/desktop.mjs';
import { launchDesktop } from './support/electron-lifecycle.mjs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

const root = path.resolve('.');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'plugin-icons-ui-'));
const source = path.join(temporary, 'plugin');
let app, server;
try {
  await mkdir(source);
  await writeFile(path.join(source, 'desktop.plugin.json'), JSON.stringify({ schemaVersion: 1, apiVersion: 1, id: 'example.icons', name: '图标测试', version: '1.0.0', description: '自定义插件导航图标', author: 'Test', entry: 'index.html', icon: 'icon.svg', capabilities: [], contributes: { views: [{ id: 'board', title: '图标看板' }] } }));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5" fill="#7961c9"/><path d="m7 12 3 3 7-7" stroke="white" stroke-width="2" fill="none"/></svg>';
  await writeFile(path.join(source, 'icon.svg'), svg);
  await writeFile(path.join(source, 'index.html'), '<h1>图标看板</h1>');
  server = await createServer({ configFile: path.join(root, 'vite.renderer.config.ts'), server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  const buildDirectory = path.join(temporary, 'build');
  await build({ entryPoints: ['desktop/main/main.ts'], outfile: path.join(buildDirectory, 'main.js'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'], loader: { '.py': 'text', '.ps1': 'text' }, banner: desktopFixtureBanner, define: {
    PORTAL_DESKTOP_DEV_ASSETS: JSON.stringify(path.resolve('desktop/generated')), MAIN_WINDOW_VITE_DEV_SERVER_URL: JSON.stringify(`http://127.0.0.1:${server.httpServer.address().port}/`), MAIN_WINDOW_VITE_NAME: '"main_window"',
    PORTAL_DESKTOP_BUILD: '"plugin-icons-test"', PORTAL_DESKTOP_UPDATE_REPOSITORY: '"fixture/repo"',
  } });
  await build({ entryPoints: ['desktop/preload/preload.ts'], outfile: path.join(buildDirectory, 'preload.js'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
  app = await launchDesktop({ executablePath: electron, args: [path.join(buildDirectory, 'main.js')], cwd: root,
    env: { ...process.env, PORTAL_DESKTOP_USER_DATA: path.join(temporary, 'profile'), PORTAL_DESKTOP_TEST_MOCK_KEYCHAIN: '1' } });
  const page = await app.firstWindow();
  await app.evaluate(({ dialog, protocol }, source) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    protocol.handle('https', () => Response.json({ services: {}, kits: [], count: 0 }));
  }, source);
  await page.locator('#client-main').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '更多功能', exact: true }).click();
  await page.getByRole('button', { name: '工具库', exact: true }).click();
  await page.getByRole('tab', { name: 'Plugin', exact: true }).click();
  await page.getByRole('button', { name: '导入插件目录' }).click();
  await page.locator('.plugin-card').waitFor();
  await page.getByText('显示位置与图标', { exact: true }).click();
  await page.getByLabel('图标看板显示位置').selectOption('navigation');
  await page.getByRole('button', { name: '更多功能', exact: true }).click();
  const destination = page.locator('.rail-more-destination[data-plugin-navigation]');
  await destination.locator('img').waitFor();
  assert(await destination.locator('img').evaluate(img => img.complete && img.naturalWidth > 0));
  await page.getByRole('button', { name: '固定到左侧：图标看板', exact: true }).click();
  await page.getByRole('button', { name: '收起更多功能', exact: true }).last().click();
  const rail = page.locator('.rail-button[data-plugin-navigation]');
  assert.equal(await rail.locator('img').count(), 1);
  const edit = page.getByRole('button', { name: '图标看板导航图标', exact: true });
  const dialog = page.getByRole('dialog', { name: '图标看板导航图标', exact: true });
  await edit.click();
  await dialog.getByLabel('Emoji 或短文字').fill('🚀');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await rail.innerText(), '🚀');
  await page.reload();
  await rail.waitFor();
  assert.equal(await rail.innerText(), '🚀');
  await page.getByRole('button', { name: '更多功能', exact: true }).click();
  await page.getByRole('button', { name: '工具库', exact: true }).click();
  await page.getByRole('tab', { name: 'Plugin', exact: true }).click();
  if (!await edit.isVisible()) await page.getByText('显示位置与图标', { exact: true }).click();
  await edit.click();
  await dialog.getByLabel('上传图标图片').setInputFiles({ name: 'invalid.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await dialog.getByRole('alert').filter({ hasText: '图片无法读取' }).waitFor();
  assert.equal(await dialog.getByLabel('Emoji 或短文字').inputValue(), '🚀');
  await dialog.getByLabel('上传图标图片').setInputFiles(path.join(source, 'icon.svg'));
  await dialog.locator('[data-slot="plugin-icon-preview"] img').waitFor();
  assert(await dialog.locator('[data-slot="plugin-icon-preview"] img').evaluate(img => img.complete && img.naturalWidth > 0));
  await mkdir(path.join(root, 'output/playwright/plugins'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'output/playwright/plugins/icon-editor.png') });
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await rail.locator('img').waitFor();
  await edit.click();
  await dialog.getByRole('button', { name: '恢复默认', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const installed = (await page.evaluate(() => window.beings.plugins.list())).plugins[0];
  assert.deepEqual(installed.iconOverrides, {});
  assert.equal(await rail.locator('img').getAttribute('src'), installed.manifest.icon);
  await page.screenshot({ path: path.join(root, 'output/playwright/plugins/icon-default.png') });
  console.log('Plugin icons: bundled SVG, rail and more menu, Emoji override, reload persistence, upload preview/save, reset passed.');
} finally {
  await app?.close(); await server?.close(); await rm(temporary, { recursive: true, force: true });
}
