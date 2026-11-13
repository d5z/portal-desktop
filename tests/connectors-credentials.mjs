// QQ Mail credentials, saved accounts and tool updates in the real settings UI.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const server = spawn(process.execPath, ['tests/workspace-layout.mjs'], { env: { ...process.env, PORTAL_LAYOUT_PREVIEW: '1', PORTAL_LAYOUT_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
let browser, page;
try {
  const origin = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Preview startup timed out')), 20000);
    let output = '';
    server.stdout.on('data', data => { output += data; const match = output.match(/Layout preview: (http:\/\/127\.0\.0\.1:\d+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
    server.once('exit', code => { clearTimeout(timeout); reject(new Error(`Preview exited: ${code}`)); });
  });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(10000);
  await page.goto(origin);
  await page.evaluate(() => {
    const f = window.mailFixture = { accounts: [], installed: [], updates: [], previews: 0, details: 0, toolReads: 0 };
    const kit = { release_id: 'qq-mail', kit_id: 'qq-mail', name: 'QQ Mail', version: '1.0.0', category: '邮件', availability: 'listed', installation_ids: [] };
    const method = { method: 'custom_credential', fields: [
      { name: 'email', label: 'Email Address', required: true, placeholder: 'user@qq.com', description: '要连接的 QQ 邮箱地址。' },
      { name: 'authorization_code', label: 'Authorization Code', required: true, secret: true, placeholder: '16-character code', description: '在 QQ 邮箱设置中获取授权码。' },
    ] };
    f.rows = [['list_messages', true, true], ['send_mail', false, false]].map(([name, read_only, enabled]) => ({ component_id: 'mail', connection_id: 'qq-account', export: name, action: name, description: read_only ? '读取邮件列表' : '发送邮件', read_only, enabled, available: enabled, account_authorized: true, revision: 0, contract_digest: 'mail-contract' }));
    const connectors = {
      catalog: async () => ({ enabled: true, items: [{ ...kit, installation_ids: f.installed.map(item => item.id) }], next_after: null }),
      installations: async () => {
        if (f.holdInstallations) await new Promise(resolve => { f.releaseInstallations = resolve; });
        return { items: structuredClone(f.installed), next_after: null };
      },
      detail: async () => {
        f.details++;
        const accounts = f.staleDetail ? [] : structuredClone(f.accounts);
        f.lastDetailAccountCount = accounts.length;
        return { name: 'QQ Mail', accounts, methods: [method] };
      },
      preview: async (release, input) => { f.previews++; f.previewInput = input; return { id: 'mail-intent', expires_at: new Date(Date.now() + 60000).toISOString(), requires_adoption: false, read_actions: ['list_messages'], write_actions: ['send_mail'], scopes: [], permission_notes: ['仅使用你授权的邮箱。'] }; },
      confirm: async (id, input) => {
        f.confirmInput = input;
        f.accounts = [{ id: 'qq-account', display_name: input.values.email, auth_type: 'custom_credential', status: 'active', usable: true, grant_revoked: false, requires_adoption: false, installation_ids: ['mail-install'] }];
        f.installed = [{ id: 'mail-install', root_release_id: 'qq-mail', desired_state: 'enabled', status: 'ready', revision: 1 }];
        return { id, release_id: 'qq-mail', status: 'ready', connection_id: 'qq-account', installation_id: 'mail-install' };
      },
      beingAccess: async () => ({ enabled: true, revision: 1, being_profile_id: 'fixture-being' }),
      tools: async id => { f.toolReads++; f.lastToolsInstallation = id; return f.rows.map(row => ({ ...row, available: row.enabled && f.installed.find(item => item.id === id)?.status === 'ready' })); },
      setTool: async (id, input) => {
        f.updates.push({ id, ...input });
        if (f.holdUpdate) await new Promise(resolve => { f.releaseUpdate = resolve; });
        const row = f.rows.find(item => item.export === input.export);
        if (row.revision !== input.expected_revision) throw new Error('工具设置已变化，请刷新后重试。');
        if (input.enabled && !row.read_only && !input.confirm_write) throw new Error('需要确认写操作');
        Object.assign(row, { enabled: input.enabled, available: input.enabled, revision: row.revision + 1 });
        return structuredClone(row);
      },
      state: async () => ({ id: 'background-intent', release_id: 'qq-mail', connection_id: 'qq-account', installation_id: 'mail-install', status: f.pendingReady ? 'ready' : 'preparing' }),
    };
    window.fixtureApp.api.home = { state: async () => ({ authenticated: true }), bounds: async () => {}, subscribe: () => () => {}, connectors };
    window.fixtureApp.openClientSettings();
  });
  const settings = page.locator('#client-settings-dialog');
  await settings.getByRole('tab', { name: '应用', exact: true }).click();
  const card = () => settings.getByRole('button', { name: '查看 QQ Mail 详情', exact: true });
  const back = () => settings.getByRole('button', { name: '返回应用', exact: true }).click();
  await card().click();
  await settings.getByLabel(/^Email Address/).waitFor();
  assert(await settings.getByText('初始只读工具：list_messages', { exact: true }).isVisible(), 'Authorization scope is visible without expanding it');
  assert(await settings.getByText('需要明确开启的写工具：send_mail', { exact: true }).isVisible());
  assert.equal(await page.evaluate(() => mailFixture.previews), 1);
  await settings.screenshot({ path: 'output/playwright/connectors-mail-form.png' });
  await settings.getByLabel(/^Email Address/).fill('fixture@qq.com');
  await settings.getByLabel(/^Authorization Code/).fill('fixture-code-only');
  await settings.getByRole('button', { name: '连接并启用', exact: true }).click();
  await settings.locator('.connector-tools-toggle[aria-expanded=false]').click();
  await settings.getByRole('switch', { name: 'list_messages', exact: true }).waitFor();
  assert(await settings.getByRole('button', { name: 'fixture@qq.com 已连接', exact: true }).getAttribute('aria-pressed') === 'true');
  assert.equal(await settings.locator('.connector-preview').count(), 0, 'Saved accounts show their tools instead of another empty form');
  // A catalog prefetch may still reflect the snapshot from before authorization.
  await page.evaluate(() => { mailFixture.staleDetail = true; });
  await back();
  await card().hover();
  await page.waitForFunction(() => mailFixture.lastDetailAccountCount === 0);
  await page.evaluate(() => { mailFixture.staleDetail = false; });
  await card().click();
  await settings.locator('.connector-tools-toggle[aria-expanded=false]').click();
  await settings.getByRole('switch', { name: 'list_messages', exact: true }).waitFor();
  assert.equal(await settings.locator('.connector-preview').count(), 0, 'A stale preauthorization snapshot must not bring back the empty credential form');
  assert.equal(await page.evaluate(() => mailFixture.previews), 1, 'Opening an already authorized account must not create another authorization intent');
  await back();
  await page.evaluate(() => mailFixture.accounts.unshift({ id: 'old-account', display_name: 'old@qq.com', auth_type: 'custom_credential', status: 'active', usable: true, grant_revoked: false, installation_ids: [] }));
  // Remount to discard in-memory preferences and exercise initial account selection.
  await settings.getByRole('tab', { name: '通用', exact: true }).click();
  await settings.getByRole('tab', { name: '应用', exact: true }).click();
  await card().click();
  await settings.locator('.connector-tools-toggle[aria-expanded=false]').click();
  await settings.getByRole('switch', { name: 'list_messages', exact: true }).waitFor();
  assert.equal(await settings.getByRole('button', { name: 'fixture@qq.com 已连接', exact: true }).getAttribute('aria-pressed'), 'true', 'Prefer the installed account to an older uninstalled account');
  assert.equal(await page.evaluate(() => mailFixture.previews), 1, 'Reopening a saved account never starts another authorization');
  await settings.getByRole('switch', { name: 'list_messages', exact: true }).uncheck();
  await page.waitForFunction(() => !mailFixture.rows[0].enabled);
  page.once('dialog', dialog => dialog.accept());
  await settings.getByRole('switch', { name: 'send_mail', exact: true }).check();
  await page.waitForFunction(() => mailFixture.rows[1].enabled);
  assert.equal(await page.evaluate(() => mailFixture.updates.at(-1).confirm_write), true);
  await back();
  await card().click();
  await settings.locator('.connector-tools-toggle[aria-expanded=false]').click();
  await settings.getByRole('switch', { name: 'send_mail', exact: true }).waitFor();
  assert(await settings.getByRole('switch', { name: 'send_mail', exact: true }).isChecked(), 'Tool changes persist after reopening');
  assert(!await settings.getByRole('switch', { name: 'list_messages', exact: true }).isChecked());
  // An external tool change must recover the latest revision before a retry.
  await page.evaluate(() => mailFixture.rows[0].revision++);
  await settings.getByRole('switch', { name: 'list_messages', exact: true }).click();
  await settings.getByRole('alert').filter({ hasText: '工具设置已变化' }).waitFor();
  await settings.getByRole('switch', { name: 'list_messages', exact: true }).check();
  await page.waitForFunction(() => mailFixture.rows[0].enabled);
  await settings.screenshot({ path: 'output/playwright/connectors-mail-connected.png' });
  // Restore a preparing installation, then finish it while a tool save is in flight.
  await back();
  await settings.getByRole('tab', { name: '通用', exact: true }).click();
  await page.evaluate(() => { localStorage.setItem('portal.home.connector.intent.qq-mail', 'background-intent'); mailFixture.holdUpdate = true; });
  await settings.getByRole('tab', { name: '应用', exact: true }).click();
  await card().click();
  await settings.locator('.connector-tools-toggle[aria-expanded=false]').click();
  await settings.getByRole('switch', { name: 'list_messages', exact: true }).uncheck();
  await page.waitForFunction(() => mailFixture.releaseUpdate);
  const reads = await page.evaluate(() => { mailFixture.pendingReady = true; window.dispatchEvent(new Event('focus')); return mailFixture.toolReads; });
  await page.waitForFunction(reads => mailFixture.toolReads > reads, reads);
  await page.evaluate(() => { mailFixture.holdUpdate = false; mailFixture.releaseUpdate(); });
  await settings.locator('.connector-account-add:not(:disabled)').waitFor();
  assert(!await settings.getByRole('switch', { name: 'list_messages', exact: true }).isChecked(), 'Refresh during a save preserves the saved tool state and releases busy state');
  // Detail can arrive before the refreshed installation list.
  await back();
  await page.evaluate(() => { mailFixture.holdInstallations = true; mailFixture.installed[0].id = 'new-install'; mailFixture.accounts.find(item => item.id === 'qq-account').installation_ids = ['new-install']; });
  await settings.getByRole('button', { name: '刷新', exact: true }).click();
  await page.waitForFunction(() => mailFixture.releaseInstallations);
  await card().click();
  await settings.getByRole('button', { name: 'fixture@qq.com 待启用', exact: true }).waitFor();
  await page.evaluate(() => { mailFixture.holdInstallations = false; mailFixture.releaseInstallations(); });
  await settings.locator('.connector-tools-toggle[aria-expanded=false]').click();
  await settings.getByRole('switch', { name: 'list_messages', exact: true }).waitFor();
  assert(await settings.getByRole('button', { name: 'fixture@qq.com 已连接', exact: true }).isVisible(), 'Late installation data loads tools without another account click');
  // Different orderings must not select an old degraded installation for the tools.
  await page.evaluate(() => {
    mailFixture.installed.unshift({ id: 'old-install', root_release_id: 'qq-mail', desired_state: 'enabled', status: 'degraded', revision: 1 });
    mailFixture.accounts.find(item => item.id === 'qq-account').installation_ids.unshift('old-install');
  });
  await settings.getByRole('button', { name: '刷新连接状态', exact: true }).click();
  await settings.getByRole('button', { name: '已启用 1/2 个', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => mailFixture.lastToolsInstallation), 'new-install');
  // If all installations are unhealthy, keep enabled preferences and show the actual status.
  await page.evaluate(() => { mailFixture.installed.find(item => item.id === 'new-install').status = 'degraded'; });
  await settings.getByRole('button', { name: '刷新连接状态', exact: true }).click();
  await settings.getByRole('button', { name: '已启用 1/2 个', exact: true }).waitFor();
  await settings.getByRole('alert').filter({ hasText: '部分工具运行异常' }).waitFor();
  assert(await settings.getByRole('switch', { name: 'send_mail', exact: true }).isChecked());
  await settings.getByRole('button', { name: 'fixture@qq.com 部分工具运行异常', exact: true }).waitFor();
  await page.setViewportSize({ width: 720, height: 720 });
  await settings.screenshot({ path: 'output/playwright/connectors-mail-narrow.png' });
  assert(await settings.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  assert.deepEqual(errors, []);
  console.log('PASS: QQ Mail direct authorization form, visible scope, saved account selection, persistent tool changes, revision recovery and refresh/save races.');
} catch (error) {
  if (page) {
    console.error(await page.evaluate(() => ({ text: document.querySelector('#client-settings-dialog')?.innerText, updates: mailFixture.updates, rows: mailFixture.rows, toolReads: mailFixture.toolReads })));
    await page.screenshot({ path: 'output/playwright/connectors-mail-failure.png' });
  }
  throw error;
} finally { await browser?.close(); server.kill(); }
