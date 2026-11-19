// A legacy catalog can offer the same Kit for both local and cloud runtimes.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const server = spawn(process.execPath, ['tests/workspace-layout.mjs'], {
  env: { ...process.env, PORTAL_LAYOUT_PREVIEW: '1', PORTAL_LAYOUT_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let browser;
try {
  const origin = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Preview startup timed out')), 20000);
    server.stdout.on('data', data => {
      output += data;
      const match = output.match(/Layout preview: (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Preview exited: ${code}`)); });
  });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.goto(origin);
  await page.evaluate(() => {
    window.localKitFixture = { detailReads: 0, prepared: [] };
    fixtureApp.api.home = { state: async () => ({ authenticated: true }), subscribe: () => () => {}, bounds: async () => {}, connectors: {
      catalog: async () => ({ enabled: true, items: [{ release_id: 'mixed', kit_id: 'mixed-kit', name: 'Mixed Runtime', version: '1.0', runtimes: ['local', 'cloud'], availability: 'listed', installation_ids: [] }], next_after: null }),
      installations: async () => ({ items: [], next_after: null }),
      detail: async () => { localKitFixture.detailReads++; return { name: 'Mixed Runtime', accounts: [], skills: [], methods: [{ method: 'oauth2', fields: [] }] }; },
    } };
    fixtureApp.api.prepareKit = async id => {
      localKitFixture.prepared.push(id);
      return { ticket: 'fixture', name: 'Mixed Runtime', version: '1.0', tools: 1, environment: [] };
    };
    fixtureApp.api.discardKit = async () => {};
    fixtureApp.openClientSettings();
  });
  const settings = page.locator('#client-settings-dialog');
  await settings.getByRole('tab', { name: '应用', exact: true }).click();
  await settings.getByRole('tab', { name: '本地', exact: true }).click();
  await settings.getByRole('button', { name: '查看 Mixed Runtime 详情', exact: true }).click();
  assert(await settings.getByRole('button', { name: '连接', exact: true }).isVisible(), 'Dual-runtime kits keep their cloud connector details');
  assert((await page.evaluate(() => localKitFixture.detailReads)) > 0);
  await settings.getByRole('button', { name: '安装', exact: true }).click();
  await page.getByRole('dialog', { name: '安装 Mixed Runtime', exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => localKitFixture.prepared), ['mixed-kit']);
  await page.getByRole('button', { name: '取消 Kit 安装', exact: true }).click();
  await settings.getByRole('button', { name: '返回应用', exact: true }).click();
  await settings.getByRole('tab', { name: '云端', exact: true }).click();
  assert.equal(await settings.getByRole('button', { name: '查看 Mixed Runtime 详情', exact: true }).count(), 1);
  console.log('PASS: legacy dual-runtime Kit appears in both filters, preserves cloud connector details and prepares local installation.');
} finally {
  await browser?.close();
  server.kill();
}
