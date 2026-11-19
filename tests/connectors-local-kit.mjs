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
  await page.evaluate(() => { localKitFixture.failLocal = true; window.dispatchEvent(new Event('focus')); });
  await settings.getByRole('alert').filter({ hasText: '无法读取本机 Kit' }).waitFor();
  assert(await settings.getByRole('button', { name: '安装', exact: true }).isDisabled());
  assert(await settings.getByRole('button', { name: '连接', exact: true }).isEnabled(), 'Local inventory failure does not block cloud authorization');
  await page.evaluate(() => { localKitFixture.failLocal = false; });
  await settings.getByRole('button', { name: '重试', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.connector-detail-actions button')].some(button => button.textContent === '安装' && !button.disabled));

  await settings.getByRole('button', { name: '安装', exact: true }).click();
  await page.getByRole('dialog', { name: '安装 Mixed Runtime', exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => localKitFixture.prepared), ['mixed-kit']);
  await page.getByRole('button', { name: '取消 Kit 安装', exact: true }).click();
  await settings.getByRole('button', { name: '返回应用', exact: true }).click();
  await settings.getByRole('tab', { name: '云端', exact: true }).click();
  assert.equal(await settings.getByRole('button', { name: '查看 Mixed Runtime 详情', exact: true }).count(), 1);
  console.log('PASS: legacy dual-runtime Kit appears in both filters, preserves cloud connector details and prepares local installation.');
  await page.close();

  const localPage = await browser.newPage();
  localPage.setDefaultTimeout(10000);
  const errors = [];
  localPage.on('pageerror', error => errors.push(error.message));
  await localPage.goto(origin);
  await localPage.evaluate(() => {
    window.localKitFixture = { detailReads: 0, catalogReads: 0, localReads: 0, failLocal: false, installed: false, townCalls: [], enabled: true, usedAvailability: 'listed', prepared: [] };
    fixtureApp.api.localKits = async () => {
      localKitFixture.localReads++;
      if (localKitFixture.failLocal) throw new Error('EACCES: fixture local Kit directory');
      return { directory: '/fixture/kits', enabled: true, kits: localKitFixture.installed ? [{ name: 'Local Kit', version: '1.0', description: 'Fixture', directory: '/fixture/kits/local-kit', command: [], tools: [], compatible: true, eager: false }] : [] };
    };
    fixtureApp.api.home = {
      state: async () => ({ authenticated: true }), subscribe: () => () => {}, bounds: async () => {},
      connectors: {
        catalog: async () => {
          const revision = ++localKitFixture.catalogReads;
          return { enabled: localKitFixture.enabled, items: [
            { name: 'Local Kit', availability: 'listed', used_before: false },
            { name: 'Blocked Kit', availability: 'blocked', used_before: true },
            { name: 'Unavailable Kit', availability: 'unavailable', used_before: true },
            { name: 'Used Kit', availability: localKitFixture.usedAvailability, used_before: true },
          ].map(({ name, availability, used_before }) => ({
            release_id: name, kit_id: name, name, version: '1.0', description: `Catalog revision ${revision}`,
            runtimes: ['local'], availability, unavailable_reason: availability === 'listed' ? null : '当前不可安装。',
            installation_ids: [], local_install: { kind: 'town', source_id: name.toLowerCase().replaceAll(' ', '-'), used_before },
          })), next_after: null };
        },
        installations: async () => ({ items: [], next_after: null }),
        detail: async () => { localKitFixture.detailReads++; throw new Error('Local Kits have no Home connector detail'); },
      },
    };
    fixtureApp.api.town = async query => {
      localKitFixture.townCalls.push(query);
      const kit = { id: 'remote-kit', name: 'Remote Kit', kind: 'kit', description: 'Remote catalog fixture' };
      return { ok: true, data: query.kind === 'kit' ? kit : { kits: [kit] }, fetchedAt: '' };
    };
    fixtureApp.api.deleteKit = async name => { localKitFixture.installed = false; return { deleted: true, name }; };
    fixtureApp.api.prepareKit = async id => {
      localKitFixture.prepared.push(id);
      return { ticket: 'fixture', name: 'Local Kit', version: '1.0', tools: 0, environment: [] };
    };
    fixtureApp.api.discardKit = async () => {};
    fixtureApp.openClientSettings();
  });
  const localSettings = localPage.locator('#client-settings-dialog');
  await localSettings.getByRole('tab', { name: '应用', exact: true }).click();
  await localSettings.getByRole('button', { name: '查看 Local Kit 详情', exact: true }).click();
  assert.equal(await localPage.evaluate(() => localKitFixture.detailReads), 0, 'Opening local Kit details never fetches a Home connector');
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
  await localSettings.getByRole('button', { name: '安装', exact: true }).click();
  await localPage.getByRole('dialog', { name: '安装 Local Kit', exact: true }).waitFor();
  assert.deepEqual(await localPage.evaluate(() => localKitFixture.prepared), ['local-kit']);
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
  assert.deepEqual(await localPage.evaluate(() => localKitFixture.prepared), ['local-kit'], 'Blocked and disabled entries never reach install preparation');
  assert.equal(await localPage.evaluate(() => localKitFixture.detailReads), 0, 'Local recovery and catalog changes stay outside Home connector detail APIs');
  await localPage.evaluate(() => { localKitFixture.enabled = true; localKitFixture.installed = true; window.dispatchEvent(new Event('focus')); });
  await localSettings.getByRole('button', { name: '查看 Local Kit 详情', exact: true }).click();
  await localSettings.getByRole('button', { name: '查看本机 Kit', exact: true }).click();
  await localPage.waitForFunction(() => fixtureApp.view === 'kits' && fixtureApp.town.localKit?.name === 'Local Kit');
  assert.deepEqual(await localPage.evaluate(() => localKitFixture.townCalls), [], 'Viewing an installed Kit only reads local inventory');
  await localPage.evaluate(() => fixtureApp.openClientSettings());
  await localSettings.getByRole('tab', { name: '应用', exact: true }).click();
  await localSettings.getByRole('button', { name: '查看 Local Kit 详情', exact: true }).click();
  await localSettings.getByRole('button', { name: '卸载本机 Kit', exact: true }).click();
  await localPage.getByRole('dialog', { name: '删除本机 Kit', exact: true }).getByRole('button', { name: '删除本机 Kit', exact: true }).click();
  await localSettings.getByRole('button', { name: '安装', exact: true }).waitFor();
  assert.equal(await localPage.evaluate(() => localKitFixture.installed), false);
  assert.deepEqual(await localPage.evaluate(() => localKitFixture.townCalls), [], 'Deleting a local Kit does not reload Grove');
  await localPage.evaluate(() => fixtureApp.closeClientSettings());
  await localPage.getByRole('checkbox', { name: '仅本机存在', exact: true }).uncheck();
  await localPage.locator('.catalog-item').filter({ hasText: 'Remote Kit' }).waitFor();
  assert((await localPage.evaluate(() => localKitFixture.townCalls)).some(query => query.kind === 'grove'), 'Leaving the local filter restores the remote catalog');
  assert.deepEqual(errors, []);
  console.log('PASS: local focus isolation, local inventory failure/retry, blocked history and disabled catalog installation guards.');
} finally {
  await browser?.close();
  server.kill();
}
