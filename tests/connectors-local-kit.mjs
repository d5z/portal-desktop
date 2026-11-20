// Exercise local Kit availability and recovery alongside legacy dual-runtime connectors.
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
  page.setDefaultTimeout(10000);
  await page.goto(origin);
  await page.evaluate(() => {
    window.localKitFixture = { detailReads: 0, prepared: [], failLocal: false };
    fixtureApp.api.localKits = async () => {
      if (localKitFixture.failLocal) throw new Error('EACCES');
      return { directory: '/fixture', enabled: true, kits: [] };
    };
    fixtureApp.api.home = { state: async () => ({ authenticated: true }), subscribe: () => () => {}, bounds: async () => {}, connectors: {
      catalog: async () => ({ enabled: true, items: [{ release_id: 'mixed', kit_id: 'mixed-kit', name: 'Mixed Runtime', version: '1.0', runtimes: ['local', 'cloud'], local_install: null, availability: 'listed', installation_ids: [] }], next_after: null }),
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
  await settings.getByRole('tab', { name: '云端', exact: true }).click();
  await settings.getByRole('button', { name: '查看 Mixed Runtime 详情', exact: true }).click();
  assert(await settings.getByRole('button', { name: '连接', exact: true }).isVisible(), 'Dual-runtime kits keep their cloud connector details');
  assert((await page.evaluate(() => localKitFixture.detailReads)) > 0);
  assert.equal(await settings.getByRole('button', { name: '安装', exact: true }).count(), 0, 'A cloud connector cannot be sent to the local installer');
  assert.deepEqual(await page.evaluate(() => localKitFixture.prepared), []);
  await settings.getByRole('button', { name: '返回应用', exact: true }).click();
  await settings.getByRole('tab', { name: '本地', exact: true }).click();
  assert.equal(await settings.getByRole('button', { name: '查看 Mixed Runtime 详情', exact: true }).count(), 0);
  console.log('PASS: cloud connector runtime labels do not route it through the local installer.');
  await page.close();

  const localPage = await browser.newPage();
  localPage.setDefaultTimeout(10000);
  const errors = [];
  localPage.on('pageerror', error => errors.push(error.message));
  await localPage.goto(origin);
  await localPage.evaluate(() => {
    window.localKitFixture = { appDetailReads: [], detailReads: 0, catalogReads: 0, localReads: 0, failLocal: false, installed: false, tools: [], townCalls: [], enabled: true, usedAvailability: 'listed', noBundle: false, prepared: [] };
    fixtureApp.api.localKits = async () => {
      localKitFixture.localReads++;
      if (localKitFixture.failLocal) throw new Error('EACCES: fixture local Kit directory');
      return { directory: '/fixture/kits', enabled: true, kits: localKitFixture.installed ? [{ name: 'local-kit', installSource: { sourceId: 'local-kit', releaseId: 'Local Kit', sha256: 'a'.repeat(64) }, version: '1.0', description: 'Fixture', directory: '/fixture/kits/local-kit', command: [], tools: localKitFixture.tools, compatible: true, eager: false }] : [] };
    };
    fixtureApp.api.home = {
      state: async () => ({ authenticated: true }), subscribe: () => () => {}, bounds: async () => {},
      connectors: {
        catalog: async () => {
          const revision = ++localKitFixture.catalogReads;
          const result = { enabled: localKitFixture.enabled, items: [
            { name: 'Local Kit', availability: 'listed', used_before: false },
            { name: 'Blocked Kit', availability: 'blocked', used_before: true },
            { name: 'Unavailable Kit', availability: 'unavailable', used_before: true },
            { name: 'Used Kit', availability: localKitFixture.usedAvailability, used_before: true },
          ].map(({ name, availability, used_before }) => ({
            release_id: name, kit_id: name, name, version: '1.0', description: `Catalog revision ${revision}`,
            runtimes: ['local'], availability, unavailable_reason: availability === 'listed' ? null : '当前不可安装。',
            installation_ids: [], local_install: { kind: 'town', source_id: name.toLowerCase().replaceAll(' ', '-'), used_before },
          })), next_after: null };
          localKitFixture.items = result.items; return result;
        },
        installations: async () => ({ items: [], next_after: null }),
        detail: async () => { localKitFixture.detailReads++; throw new Error('Local Kits have no Home connector detail'); },
        appDetail: async id => {
          localKitFixture.appDetailReads.push(id);
          const app = localKitFixture.items.find(item => item.release_id === id);
          return { kind: 'local_kit', app, local_kit: { source_id: app.local_install.source_id, installer: 'desktop_legacy', tools: [{name: 'declared_search', description: 'Declared by Home', input_schema: {type: 'object'}}], install_manifest: {name: app.local_install.source_id, version: '1.0'}, bundle: localKitFixture.noBundle ? null : { download_url: 'v1/local-kit-bundles/' + id + '/' + 'a'.repeat(64), sha256: 'a'.repeat(64), size_bytes: 100 } } };
        },
      },
    };
    fixtureApp.api.town = async query => {
      localKitFixture.townCalls.push(query);
      const kit = { id: 'remote-kit', name: 'Remote Kit', kind: 'kit', description: 'Remote catalog fixture' };
      return { ok: true, data: query.kind === 'kit' ? kit : { kits: [kit] }, fetchedAt: '' };
    };
    fixtureApp.api.deleteKit = async name => { localKitFixture.installed = false; return { deleted: true, name }; };
    fixtureApp.api.prepareKit = async (id, releaseId) => {
      localKitFixture.prepared.push({id, releaseId});
      return { ticket: 'fixture', name: 'local-kit', version: '1.0', tools: 0, environment: [] };
    };
    fixtureApp.api.discardKit = async () => {};
    fixtureApp.openClientSettings();
  });
  const localSettings = localPage.locator('#client-settings-dialog');
  await localSettings.getByRole('tab', { name: '应用', exact: true }).click();
  await localSettings.getByRole('button', { name: '查看 Local Kit 详情', exact: true }).click();
  assert.equal(await localPage.evaluate(() => localKitFixture.detailReads), 0, 'Opening local Kit details never fetches a Home connector');
  assert.deepEqual(await localPage.evaluate(() => localKitFixture.appDetailReads), ['Local Kit']);
  await localSettings.getByRole('button', { name: '1 个工具', exact: true }).click();
  await localSettings.getByText('declared_search', { exact: true }).waitFor();
  const beforeFocus = await localPage.evaluate(() => localKitFixture.catalogReads);
  await localPage.evaluate(() => window.dispatchEvent(new Event('focus')));
  await localSettings.getByText(`Catalog revision ${beforeFocus + 1}`, { exact: true }).waitFor();
  assert.equal(await localPage.evaluate(() => localKitFixture.detailReads), 0, 'Focusing local Kit details must not fetch a Home connector');
  assert.equal(await localSettings.getByRole('alert').count(), 0);

  await localPage.evaluate(() => { localKitFixture.failLocal = true; window.dispatchEvent(new Event('focus')); });
  await localSettings.getByRole('alert').filter({ hasText: '无法读取本机 Kit' }).waitFor();
  assert(await localSettings.getByRole('button', { name: '安装', exact: true }).isDisabled(), 'Failed local inventory cannot be treated as an empty directory');
  assert.equal(await localSettings.getByText('正在读取本机状态…', { exact: true }).count(), 0, 'A failed read must not be presented as still loading');
  const beforeRetry = await localPage.evaluate(() => localKitFixture.localReads);
  await localPage.evaluate(() => { localKitFixture.failLocal = false; });
  await localSettings.getByRole('button', { name: '重试', exact: true }).click();
  await localSettings.getByRole('alert').filter({ hasText: '无法读取本机 Kit' }).waitFor({ state: 'hidden' });
  await localPage.waitForFunction(() => document.querySelector('.connector-local-detail .connector-detail-actions button')?.disabled === false);
  assert((await localPage.evaluate(() => localKitFixture.localReads)) > beforeRetry, 'Retry reads local inventory again');
  assert(await localSettings.getByRole('button', { name: '安装', exact: true }).isEnabled(), 'Successful retry restores installation without leaving details');
  await localPage.evaluate(() => { localKitFixture.noBundle = true; window.dispatchEvent(new Event('focus')); });
  await localSettings.getByText('此 Kit 暂无可用的安装包。', { exact: true }).waitFor();
  assert(await localSettings.getByRole('button', { name: '安装', exact: true }).isDisabled());
  await localPage.evaluate(() => { localKitFixture.noBundle = false; window.dispatchEvent(new Event('focus')); });
  await localPage.waitForFunction(() => document.querySelector('.connector-local-detail .connector-detail-actions button')?.disabled === false);
  await localSettings.getByRole('button', { name: '安装', exact: true }).click();
  await localPage.getByRole('dialog', { name: '安装 local-kit', exact: true }).waitFor();
  assert.deepEqual(await localPage.evaluate(() => localKitFixture.prepared), [{ id: 'local-kit', releaseId: 'Local Kit' }]);
  await localPage.getByRole('button', { name: '取消 Kit 安装', exact: true }).click();
  await localSettings.getByRole('button', { name: '返回应用', exact: true }).click();

  for (const name of ['Blocked Kit', 'Unavailable Kit']) {
    const card = localSettings.locator('.connector-card').filter({ has: localPage.getByText(name, { exact: true }) });
    await card.waitFor();
    assert.equal(await card.locator('button:not(:disabled)').count(), 0, `${name} history must not enable installation`);
  }
  await localSettings.getByRole('button', { name: '查看 Used Kit 详情', exact: true }).click();
  assert(await localSettings.getByRole('button', { name: '安装', exact: true }).isEnabled());
  const beforeDisable = await localPage.evaluate(() => localKitFixture.catalogReads);
  await localPage.evaluate(() => { localKitFixture.enabled = false; window.dispatchEvent(new Event('focus')); });
  await localSettings.getByText(`Catalog revision ${beforeDisable + 1}`, { exact: true }).waitFor();
  assert(await localSettings.getByRole('button', { name: '安装', exact: true }).isDisabled(), 'A disabled catalog also blocks installation in an already-open used Kit detail');
  const beforeBlocked = await localPage.evaluate(() => localKitFixture.catalogReads);
  await localPage.evaluate(() => { localKitFixture.enabled = true; localKitFixture.usedAvailability = 'blocked'; window.dispatchEvent(new Event('focus')); });
  await localSettings.getByText(`Catalog revision ${beforeBlocked + 1}`, { exact: true }).waitFor();
  assert(await localSettings.getByRole('button', { name: '安装', exact: true }).isDisabled(), 'A newly blocked Kit cannot be installed through a detail opened while it was listed');
  await localPage.evaluate(() => { localKitFixture.enabled = false; });
  await localSettings.getByRole('button', { name: '返回应用', exact: true }).click();
  await localSettings.getByRole('button', { name: '刷新', exact: true }).waitFor();
  assert.equal(await localSettings.locator('button:not(:disabled)').filter({ hasText: /^安装$/ }).count(), 0, 'Disabled catalog has no active install buttons, including used history');
  assert.deepEqual(await localPage.evaluate(() => localKitFixture.prepared), [{ id: 'local-kit', releaseId: 'Local Kit' }], 'Blocked and disabled entries never reach install preparation');
  assert.equal(await localPage.evaluate(() => localKitFixture.detailReads), 0, 'Local recovery and catalog changes stay outside Home connector detail APIs');
  const previousView = await localPage.evaluate(() => fixtureApp.view);
  await localPage.evaluate(() => { localKitFixture.enabled = true; localKitFixture.installed = true; window.dispatchEvent(new Event('focus')); });
  await localSettings.getByRole('button', { name: '查看 Local Kit 详情', exact: true }).click();
  await localSettings.getByText('此 Kit 未声明工具。', { exact: true }).waitFor();
  assert.equal(await localSettings.getByRole('button', { name: '0 个工具', exact: true }).count(), 0);
  assert.equal(await localSettings.getByRole('button', { name: '查看本机 Kit', exact: true }).count(), 0, 'Local details do not redirect into the old tool library');
  assert.equal(await localPage.evaluate(() => fixtureApp.view), previousView);
  await localSettings.getByText('已安装到本机', { exact: true }).waitFor();
  await localPage.evaluate(() => { localKitFixture.tools = [{name: 'local_search', description: 'Installed tool'}]; window.dispatchEvent(new Event('focus')); });
  await localSettings.getByRole('button', { name: '1 个工具', exact: true }).click();
  await localSettings.getByText('local_search', { exact: true }).waitFor();
  assert.equal(await localSettings.getByText('declared_search', { exact: true }).count(), 0, 'Installed details show the actual local tools');
  await localPage.setViewportSize({width:1280,height:860});
  await localSettings.screenshot({path:'output/playwright/connectors-local-inline.png'});
  await localPage.setViewportSize({width:720,height:720});
  assert(await localSettings.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  await localSettings.screenshot({path:'output/playwright/connectors-local-inline-narrow.png'});
  await localSettings.getByRole('button', { name: '卸载本机 Kit', exact: true }).click();
  await localPage.getByRole('dialog', { name: '删除本机 Kit', exact: true }).getByRole('button', { name: '删除本机 Kit', exact: true }).click();
  await localSettings.getByRole('button', { name: '安装', exact: true }).waitFor();
  assert.equal(await localPage.evaluate(() => localKitFixture.installed), false);
  assert.deepEqual(await localPage.evaluate(() => localKitFixture.townCalls), [], 'Deleting a local Kit does not reload Grove');
  assert(await localSettings.isVisible(), 'Uninstall remains inside settings');
  assert.equal(await localPage.evaluate(() => fixtureApp.view), previousView);
  assert.deepEqual(errors, []);
  console.log('PASS: local focus isolation, local inventory failure/retry, blocked history and disabled catalog installation guards.');
} finally {
  await browser?.close();
  server.kill();
}
