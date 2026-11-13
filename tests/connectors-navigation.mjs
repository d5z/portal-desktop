// Exercise the real React UI against Home's current-account lifecycle contract.
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
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.evaluate(() => {
    const f = window.connectorFixture = { accounts: {}, installed: [], enables: {}, previews: [], opened: [], removed: [], lifecycleCalls: [], receipts: {}, accesses: {}, toolCalls: [], calls: {}, authorized: false, authenticated: false, authenticating: false, listeners: [] };
    const kits = ['GitHub', 'Slack', 'API Only', 'Slow', 'Failure'].map(name => ({ release_id: name, kit_id: name, name, version: '1.0.0', category: '生产力', requires_accounts: true, account_providers: [name], description: '连接你的应用，使用账户中的工具。', availability: 'listed' }));
    f.addAccount = (release, id, name, installed = true) => {
      const account = { id, auth_type: 'oauth2', display_name: name, status: 'active', usable: true, grant_revoked: false, requires_adoption: false, installation_ids: installed ? [id + '-install'] : [], enable_id: null };
      (f.accounts[release] ??= []).push(account);
      if (installed) f.installed.push({ id: id + '-install', root_release_id: release, status: 'ready', desired_state: 'enabled', revision: 1 });
      return account;
    };
    f.addAccount('GitHub', 'github-account', 'baiye0');
    const row = (id, read_only) => ({ component_id: 'shared', export: id, action: id, description: read_only ? '只读测试工具' : '写入测试工具', read_only, enabled: read_only, account_authorized: true, revision: 1, contract_digest: 'digest' });
    f.toolRows = [row('read_repo', true), row('read_issues', true), row('create_issue', false)];
    const currentAccounts = release => (f.accounts[release] || []).filter(account => !account.removed && (!account.installation_ids.length || account.installation_ids.some(id => f.installed.find(item => item.id === id)?.desired_state !== 'removed')));
    const connectors = {
      catalog: async query => {
        const items = kits.map(kit => ({ ...kit, installation_ids: f.installed.filter(item => item.root_release_id === kit.release_id && item.desired_state !== 'removed').map(item => item.id) }));
        return { enabled: true, items: query?.after ? items.slice(3) : items.slice(0, 3), next_after: query?.after ? null : 'page' };
      },
      installations: async after => ({ items: after ? structuredClone(f.installed) : [], next_after: after ? null : 'page' }),
      installation: async id => structuredClone(f.installed.find(item => item.id === id)),
      detail: async release => {
        f.calls[release] = (f.calls[release] || 0) + 1;
        if (f.holdDetail === release) await new Promise(resolve => { f.releaseDetail = resolve; });
        if (f.failDetail === release) throw new Error('无法读取应用连接选项。');
        return { name: release, skills: release === 'GitHub' ? [{ export: 'search', name: 'Search repositories', description: 'Find repositories by name and topic.' }, { export: 'issues', name: 'Manage issues', description: 'Read and update issues with natural language.' }] : [], accounts: structuredClone(currentAccounts(release)), methods: f.methods?.[release] || [{ method: release === 'API Only' ? 'api_key' : 'oauth2', fields: release === 'API Only' ? [{ name: 'api_key', label: 'API Key', required: true, secret: true }] : [] }] };
      },
      tools: async id => {
        f.toolCalls.push(id);
        if (f.failTools) throw new Error('工具加载失败');
        const installation = f.installed.find(item => item.id === id);
        const account = Object.values(f.accounts).flat().find(item => item.installation_ids.includes(id));
        return f.toolRows.map(tool => ({ ...tool, account_authorized: account.usable, connection_id: account.id, available: tool.enabled && account.usable && f.accesses[id]?.enabled !== false && installation.desired_state === 'enabled' && installation.status === 'ready' }));
      },
      beingAccess: async id => structuredClone(f.accesses[id] ??= { enabled: true, revision: 1, being_profile_id: 'fixture-being' }),
      setBeingAccess: async (id, enabled, revision) => {
        const access = f.accesses[id];
        if (f.conflictAccess) { f.conflictAccess = false; access.revision++; }
        if (access.revision !== revision) throw new Error('Being 工具授权已变化，请刷新后重试。');
        Object.assign(access, { enabled, revision: revision + 1 });
        return structuredClone(access);
      },
      setTool: async (id, input) => {
        f.updatedTool = { id, ...input };
        const tool = f.toolRows.find(item => item.export === input.export);
        Object.assign(tool, { enabled: input.enabled, revision: tool.revision + 1 });
        return { ...tool, connection_id: input.connection_id, available: input.enabled };
      },
      preview: async (release, input) => {
        f.previews.push({ release, input });
        if (f.holdPreview) await new Promise(resolve => { f.releasePreview = resolve; });
        const id = 'intent-' + f.previews.length;
        f.enables[id] = { id, release_id: release, connection_id: input.connection_id || id + '-account', installation_id: null, status: 'awaiting_account', authorization_url: 'https://example.com/oauth/' + id };
        f.enables[id].reuse = Boolean(input.connection_id);
        f.enables[id].method = input.method;
        return { id, expires_at: new Date(Date.now() + 60000).toISOString(), requires_adoption: Boolean(currentAccounts(release).find(item => item.id === input.connection_id)?.requires_adoption), read_actions: ['read_repo'], write_actions: ['create_issue'], scopes: ['repo'], permission_notes: [] };
      },
      confirm: async (id, input) => {
        f.confirmCalls = (f.confirmCalls || 0) + 1;
        f.confirmInput = input;
        const state = f.enables[id];
        const repeated = state.confirmed;
        if (!state.confirmed && !state.reuse) (f.accounts[state.release_id] ??= []).push({ id: state.connection_id, enable_id: id, display_name: 'default', auth_type: state.release_id === 'API Only' ? 'api_key' : 'oauth2', status: 'unknown', usable: false, grant_revoked: false, requires_adoption: false, installation_ids: [] });
        state.confirmed = true;
        if (state.method !== 'oauth2') state.authorization_url = null;
        if (state.release_id === 'API Only' || state.reuse) { f.authorized = true; state.authorization_url = null; }
        if (f.failDetailAfterConfirm) { f.failDetail = state.release_id; f.failDetailAfterConfirm = false; }
        if (f.loseConfirm) { f.loseConfirm = false; throw new Error('授权响应丢失，请重试。'); }
        return { ...state, authorization_url: repeated ? null : state.authorization_url };
      },
      cancel: async id => {
        const state = f.enables[id];
        (f.cancelled ??= []).push(id);
        if (state.status === 'cancelled') throw new Error('授权状态已变化');
        state.status = 'cancelled';
        // Home hides a retired attempt, preserving previously installed identities.
        if (!state.reuse) { const account = currentAccounts(state.release_id).find(item => item.id === state.connection_id); if (account && !account.installation_ids.length) account.removed = true; }
        if (f.loseCancel) { f.loseCancel = false; throw new Error('取消响应丢失，请重试。'); }
        return { ...state, authorization_url: null };
      },
      state: async id => {
        if (f.failState === id) throw new Error('网络连接失败');
        const state = f.enables[id];
        if (state.status === 'preparing' && !f.holdReady) {
          state.status = 'ready';
          f.installed.find(item => item.id === state.installation_id).status = 'ready';
        }
        return { ...state, authorization_url: null };
      },
      advance: async id => {
        f.advanceCalls = (f.advanceCalls || 0) + 1;
        (f.advanced ??= []).push(id);
        if (f.failAdvance === id) throw new Error('无法更新连接状态');
        const state = f.enables[id];
        if (state.status !== 'awaiting_account' || !f.authorized) return { ...state, authorization_url: null };
        const accounts = f.accounts[state.release_id];
        let account = accounts.find(item => item.id === state.connection_id);
        // Model Home's identity consolidation after a fresh OAuth callback.
        const existing = accounts.find(item => item.id === f.identityAccount && !item.removed);
        if (existing) { account.removed = true; account = existing; state.connection_id = existing.id; }
        Object.assign(account, { status: 'active', usable: true, grant_revoked: false, enable_id: null });
        if (account.display_name === 'default') account.display_name = 'Second account';
        if (!account.installation_ids.length) {
          account.installation_ids = [account.id + '-install'];
          f.installed.push({ id: account.id + '-install', root_release_id: state.release_id, status: 'preparing', desired_state: 'enabled', revision: 1 });
        }
        Object.assign(state, { installation_id: account.installation_ids[0], status: 'preparing' });
        return { ...state, authorization_url: null };
      },
      removeAccount: async (release, id) => {
        const account = f.accounts[release].find(item => item.id === id);
        if (account.installation_ids.some(id => f.installed.find(item => item.id === id)?.desired_state !== 'removed')) throw new Error('仍有活动安装');
        if (f.failRemove === id) throw new Error('账号移除未确认，请重试。');
        f.removed.push({ release, id });
        for (const item of f.accounts[release]) if (item.id === id || account.status === 'unknown' && item.status === 'unknown') {
          item.removed = true;
          if (item.enable_id) f.enables[item.enable_id].status = 'cancelled';
        }
      },
      lifecycle: async (id, action, revision, requestId) => {
        const input = { id, action, revision, requestId };
        f.lifecycleCalls.push(input);
        if (f.receipts[requestId]) { if (JSON.stringify(f.receipts[requestId]) !== JSON.stringify(input)) throw new Error('request_id_conflict'); return { accepted: true }; }
        const installation = f.installed.find(item => item.id === id);
        if (f.busyInstallation === id) return { accepted: false, message: '此应用有尚未完成的安装或变更任务，本次操作未提交。' };
        if (installation.revision !== revision) return { accepted: false, message: '应用状态已变化，本次操作未提交。' };
        f.receipts[requestId] = input;
        if (action === 'enable') { installation.desired_state = 'enabled'; installation.status = 'ready'; installation.revision++; }
        if (action === 'uninstall') { installation.desired_state = 'removed'; installation.revision++; }
        if (f.loseResponse === id) { f.loseResponse = null; throw new Error('模拟响应丢失，请重试。'); }
        return { accepted: true };
      },
      openAuthorization: async url => { if (f.failOpen) throw new Error('无法打开账号授权，请重试。'); f.opened.push(url); },
    };
    const homeState = () => ({ authenticated: f.authenticated, authenticating: f.authenticating, error: f.loginError });
    f.publishHome = () => f.listeners.forEach(listener => listener(homeState()));
    window.fixtureApp.api.home = { state: async () => homeState(), action: async action => {
      if (action === 'cancel-login') { f.authenticating = false; f.loginError = '登录已取消。'; f.publishHome(); f.releaseLogin(homeState()); return homeState(); }
      f.loginError = undefined;
      if (f.holdLogin) { f.authenticating = true; f.publishHome(); return new Promise(resolve => { f.releaseLogin = resolve; }); }
      f.authenticated = true; f.authenticating = false; f.publishHome(); return homeState();
    }, bounds: async () => {}, subscribe: listener => { f.listeners.push(listener); return () => { f.listeners = f.listeners.filter(item => item !== listener); }; }, connectors };
    window.fixtureApp.openClientSettings();
  });
  const settings = page.locator('#client-settings-dialog');
  const button = name => settings.getByRole('button', { name, exact: true });
  const card = name => settings.getByRole('button', { name: `查看 ${name} 详情`, exact: true });
  const back = () => button('返回应用').click();
  const refresh = () => button('刷新连接状态').click();
  const remove = async name => { page.once('dialog', dialog => dialog.accept()); await button(name).click(); };
  const accountRow = name => settings.locator('.connector-account-entry').filter({ hasText: name });
  await settings.getByRole('tab', { name: '应用', exact: true }).click();
  await page.evaluate(() => { connectorFixture.holdLogin = true; });
  await button('登录 Home').click();
  await button('取消登录').waitFor();
  await settings.getByRole('tab', { name: '通用', exact: true }).click();
  await settings.getByRole('tab', { name: '应用', exact: true }).click();
  await button('取消登录').click();
  await settings.getByRole('alert').filter({ hasText: '登录已取消' }).waitFor();
  await page.evaluate(() => { connectorFixture.holdLogin = false; });
  await button('登录 Home').click();
  await card('Failure').waitFor(); // Catalog and installation pagination.
  await settings.screenshot({ path: 'output/playwright/connectors-catalog.png' });
  await card('GitHub').click();
  await button('baiye0 已连接').waitFor();
  assert.equal(await settings.getByRole('button', {name: /暂停工具|恢复工具/}).count(), 0);
  await settings.locator('.connector-skills-section').waitFor();
  assert.equal(await settings.locator('.connector-skill-row').count(), 2);
  const toolsToggle = settings.locator('.connector-tools-toggle');
  assert.equal(await toolsToggle.getAttribute('aria-expanded'), 'false');
  await settings.screenshot({path: 'output/playwright/connectors-grok-collapsed.png'});
  await toolsToggle.click();
  await settings.getByRole('switch', { name: 'read_repo', exact: true }).uncheck();
  await page.waitForFunction(() => connectorFixture.updatedTool?.export === 'read_repo');
  page.once('dialog', dialog => dialog.accept());
  await settings.getByRole('switch', { name: 'create_issue', exact: true }).check();
  assert.equal(await page.evaluate(() => connectorFixture.updatedTool.confirm_write), true);
  await page.evaluate(() => { connectorFixture.failTools = true; });
  await button('刷新工具').click();
  await settings.getByRole('alert').filter({ hasText: '工具加载失败' }).waitFor();
  assert(await button('添加其他账户').isEnabled());
  await page.evaluate(() => { connectorFixture.failTools = false; });
  await button('刷新工具').click();
  await back();
  await page.evaluate(() => { connectorFixture.holdDetail = 'Slow'; });
  await card('Slow').click();
  await settings.getByRole('heading', { name: 'Slow', exact: true }).waitFor();
  await page.waitForFunction(() => connectorFixture.releaseDetail);
  await back();
  await page.evaluate(() => { connectorFixture.holdDetail = null; connectorFixture.releaseDetail(); });
  await card('Slack').click();
  await button('连接').click();
  await button('default 未连接').waitFor();
  assert.deepEqual(await page.evaluate(() => connectorFixture.previews.at(-1).input), { method: 'oauth2' });
  assert(await button('取消授权').isVisible(), 'Awaiting OAuth has an explicit cancellation entry');
  assert(await button('继续授权').isVisible());
  const firstIntent = await page.evaluate(() => Object.keys(connectorFixture.enables).at(-1));
  await button('重新连接').click();
  await page.waitForFunction(() => connectorFixture.opened.length === 2);
  assert.equal(await page.evaluate(id => connectorFixture.enables[id].status, firstIntent), 'cancelled', 'Reconnect retires the old attempt before fresh authorization');
  assert.equal(await settings.locator('.connector-account-row').count(), 1, 'Old default is removed');
  await settings.screenshot({ path: 'output/playwright/connectors-reconnect.png' });
  await page.setViewportSize({ width: 720, height: 720 });
  await settings.screenshot({ path: 'output/playwright/connectors-reconnect-narrow.png' });
  assert(await settings.locator('.connector-account-entry').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  await page.setViewportSize({ width: 1280, height: 860 });
  // Remount with no local intent: enable_id alone must resume the flow.
  await settings.getByRole('tab', { name: '通用', exact: true }).click();
  await page.evaluate(() => { localStorage.clear(); });
  await settings.getByRole('tab', { name: '应用', exact: true }).click();
  assert.equal(await settings.locator('.settings-page-title').innerText(), '应用', 'Remounting clears the previous detail navigation');
  await card('Slack').click();
  await button('default 未连接').waitFor();
  await page.evaluate(() => { connectorFixture.authorized = true; window.dispatchEvent(new Event('focus')); });
  await button('Second account 已连接').waitFor();
  assert.equal(await page.evaluate(() => connectorFixture.opened.length), 2, 'Polling never opens a browser');
  await settings.screenshot({ path: 'output/playwright/connectors-detail-tools.png' });
  // Fresh auth of an installed, expired/revoked identity preserves its installation.
  await back();
  await page.evaluate(() => { const a = connectorFixture.accounts.GitHub[0]; Object.assign(a, { usable: false, status: 'reauth_required', grant_revoked: true }); connectorFixture.identityAccount = a.id; });
  await card('GitHub').click();
  await button('baiye0 未连接').waitFor();
  assert.equal(await settings.locator('.connector-tools-section').count(), 1);
  await button('已启用 2/3 个').click();
  assert(await settings.getByRole('switch', { name: 'read_repo', exact: true }).isDisabled(), 'Expired accounts preserve preferences but cannot enable tools');
  await button('重新连接').click();
  await button('baiye0 已连接').waitFor();
  assert.deepEqual(await page.evaluate(() => connectorFixture.previews.at(-1).input), { method: 'oauth2' });
  assert.equal(await page.evaluate(() => connectorFixture.lifecycleCalls.length), 0, 'Reauthorization does not uninstall an installed account');
  assert.equal(await settings.locator('.connector-account-row').count(), 1, 'Home identity consolidation does not duplicate an account');
  await page.evaluate(() => { connectorFixture.identityAccount = null; });
  await button('添加其他账户').click();
  await button('Second account 已连接').waitFor();
  await page.waitForFunction(() => connectorFixture.toolCalls.at(-1) !== 'github-account-install');
  await button('baiye0 已连接').click();
  await page.waitForFunction(() => connectorFixture.toolCalls.at(-1) === 'github-account-install');
  await remove('移除 Second account');
  await button('Second account 已连接').waitFor({ state: 'hidden' });
  assert(await button('baiye0 已连接').isVisible(), 'Single-account removal leaves the other account');
  assert.equal(await page.evaluate(() => connectorFixture.accounts.Slack.filter(a => !a.removed).length), 1, 'Other applications are unaffected');
  // A paused installation must not be presented as ready; tool preference is retained.
  await page.evaluate(() => { connectorFixture.installed.find(i => i.id === 'github-account-install').desired_state = 'disabled'; });
  await refresh();
  await button('baiye0 待连接').waitFor();
  await settings.getByText('连接已停用，请在账号旁重新连接。', { exact: true }).waitFor();
  await button('已启用 2/3 个').waitFor();
  assert(await settings.getByRole('switch', { name: 'create_issue', exact: true }).isChecked());
  await button('连接账号').click();
  await button('baiye0 已连接').waitFor();
  await button('已启用 2/3 个').waitFor();
  assert.equal(await page.evaluate(() => connectorFixture.lifecycleCalls.at(-1).action), 'enable');
  const previewCount = await page.evaluate(() => connectorFixture.previews.length);
  await page.evaluate(() => { connectorFixture.accesses['github-account-install'].enabled = false; });
  await refresh();
  await button('已启用 2/3 个').waitFor();
  await button('连接账号').waitFor();
  await page.evaluate(() => { connectorFixture.conflictAccess = true; });
  await button('连接账号').click();
  await settings.getByRole('alert').filter({ hasText: 'Being 工具授权已变化' }).waitFor();
  await button('连接账号').click();
  await button('已启用 2/3 个').waitFor();
  assert.equal(await page.evaluate(() => connectorFixture.previews.length), previewCount, 'Restoring a previous disabled connection does not restart account authorization');
  // Partial failure reconciles completed removals; retries use the same uncertain request.
  await page.evaluate(() => {
    connectorFixture.installed.find(i => i.id === 'github-account-install').desired_state = 'enabled';
    connectorFixture.addAccount('GitHub', 'third-account', 'Third account');
    connectorFixture.busyInstallation = 'third-account-install';
    connectorFixture.lifecycleCalls = [];
  });
  await refresh();
  await remove('断开');
  await settings.getByRole('alert').filter({ hasText: '尚未完成的安装' }).waitFor();
  await button('baiye0 已连接').waitFor({ state: 'hidden' });
  assert(await button('Third account 已连接').isVisible());
  await page.evaluate(() => { connectorFixture.busyInstallation = null; connectorFixture.loseResponse = 'third-account-install'; });
  await remove('断开');
  await settings.getByRole('alert').filter({ hasText: '模拟响应丢失' }).waitFor();
  await remove('断开');
  await button('连接').waitFor();
  const calls = await page.evaluate(() => connectorFixture.lifecycleCalls);
  assert.deepEqual(calls.map(call => call.id), ['github-account-install', 'third-account-install', 'third-account-install', 'third-account-install']);
  assert.deepEqual(calls[2], calls[3], 'Uncertain response retains the original revision and request id');
  assert.notEqual(calls[1].requestId, calls[2].requestId, 'Rejected operation can use a new request');
  assert.equal(await settings.locator('.connector-account-row').count(), 0, 'Removed history is not shown');
  // Removing only a default works with no installation and cancels its intent.
  await page.evaluate(() => { connectorFixture.authorized = false; });
  await button('连接').click();
  await button('default 未连接').waitFor();
  const pendingId = await page.evaluate(() => Object.keys(connectorFixture.enables).at(-1));
  await remove('断开');
  await button('连接').waitFor();
  assert.equal(await page.evaluate(id => connectorFixture.enables[id].status, pendingId), 'cancelled');
  assert.equal(await page.evaluate(id => localStorage.getItem('portal.home.connector.intent.' + id), pendingId), null);
  // Credentials follow the same preview/confirm/advance flow.
  await back();
  await card('API Only').click();
  await settings.getByLabel('API Key *', { exact: true }).fill('test-fixture-key');
  await button('连接并启用').click();
  await button('Second account 已连接').waitFor();
  assert.deepEqual(await page.evaluate(() => connectorFixture.confirmInput.values), { api_key: 'test-fixture-key' });
  // A failed intent must not starve another application's authorization.
  await back();
  await page.evaluate(() => { connectorFixture.authorized = false; });
  await card('Failure').click();
  await button('连接').click();
  await button('default 未连接').waitFor();
  await page.evaluate(() => { connectorFixture.failAdvance = Object.keys(connectorFixture.enables).at(-1); });
  await back();
  await card('Slow').click();
  await button('连接').click();
  await button('default 未连接').waitFor();
  await page.evaluate(() => { connectorFixture.authorized = true; window.dispatchEvent(new Event('focus')); });
  await button('Second account 已连接').waitFor();
  // Home can still expose enable_id on a confirmed intent after it expires.
  await back();
  await page.evaluate(() => {
    connectorFixture.failAdvance = null;
    const account = connectorFixture.accounts.Failure.find(item => !item.removed);
    connectorFixture.enables[account.enable_id].status = 'expired';
  });
  await card('Failure').click();
  await refresh();
  await settings.getByText('连接已过期', { exact: true }).waitFor();
  const expiredCalls = await page.evaluate(() => connectorFixture.advanced.length);
  await refresh();
  await refresh();
  assert.equal(await page.evaluate(() => connectorFixture.advanced.length), expiredCalls, 'Terminal enable_id is not added back to the poll loop after every detail refresh');
  await page.evaluate(() => {
    const account = connectorFixture.accounts.Failure.find(item => !item.removed);
    const id = account.enable_id;
    connectorFixture.enables[id].status = 'awaiting_account';
    connectorFixture.failAdvance = id;
    localStorage.setItem('portal.home.connector.intent.' + id, id);
  });
  // Slow detail and preview responses must not navigate or confirm after leaving.
  await back();
  await settings.getByRole('tab', { name: '通用', exact: true }).click();
  await page.evaluate(() => { connectorFixture.failState = connectorFixture.failAdvance; });
  await settings.getByRole('tab', { name: '应用', exact: true }).click();
  await card('Slow').waitFor();
  assert(await page.evaluate(() => localStorage.getItem('portal.home.connector.intent.' + connectorFixture.failState)), 'A transient restore error keeps its recovery record without blocking the catalog');
  await page.evaluate(() => { connectorFixture.holdPreview = true; });
  await card('Slow').click();
  await button('添加其他账户').click();
  await page.waitForFunction(() => connectorFixture.releasePreview);
  const confirmed = await page.evaluate(() => connectorFixture.confirmCalls);
  await back();
  await page.evaluate(() => { connectorFixture.holdPreview = false; connectorFixture.releasePreview(); });
  await card('Slow').waitFor();
  assert.equal(await page.evaluate(() => connectorFixture.confirmCalls), confirmed);
  // Confirm retries keep the same intent; cancel leaves an installed identity intact.
  await page.evaluate(() => { connectorFixture.authorized = false; connectorFixture.loseConfirm = true; });
  await card('Slow').click();
  await button('添加其他账户').click();
  await settings.getByRole('alert').filter({ hasText: '授权响应丢失' }).waitFor();
  const retryPreviews = await page.evaluate(() => connectorFixture.previews.length);
  await button('连接并启用').click();
  await button('取消授权').waitFor();
  assert.equal(await page.evaluate(() => connectorFixture.previews.length), retryPreviews);
  assert.equal(await settings.locator('.connector-account-row').count(), 2, 'Retrying confirm does not create another default account');
  await button('取消授权').click();
  await settings.getByText('连接已取消', { exact: true }).waitFor();
  assert(await button('Second account 已连接').isVisible(), 'Cancel preserves the previously connected account');
  assert.equal(await settings.locator('.connector-account-row').count(), 1);
  assert.equal(await page.evaluate(() => localStorage.getItem('portal.home.connector.intent.intent-' + connectorFixture.previews.length)), null);
  // An independent read failure cannot swallow a successful OAuth URL.
  const openedBefore = await page.evaluate(() => { connectorFixture.failDetailAfterConfirm = true; return connectorFixture.opened.length; });
  await button('添加其他账户').click();
  await settings.getByRole('alert').filter({ hasText: '无法读取应用连接选项' }).waitFor();
  assert.equal(await page.evaluate(() => connectorFixture.opened.length), openedBefore + 1);
  await page.evaluate(() => { connectorFixture.failDetail = null; });
  await button('取消授权').click();
  await settings.getByText('连接已取消', { exact: true }).waitFor();
  await page.evaluate(() => { connectorFixture.failOpen = true; });
  await button('添加其他账户').click();
  await settings.getByRole('alert').filter({ hasText: '无法打开账号授权' }).waitFor();
  await page.evaluate(() => { connectorFixture.failOpen = false; });
  await button('继续授权').click();
  assert.equal(await page.evaluate(() => connectorFixture.opened.length), openedBefore + 2);
  await button('取消授权').click();
  await settings.getByText('连接已取消', { exact: true }).waitFor();
  // Existing valid accounts can be adopted without a new provider login or method.
  await page.evaluate(() => {
    const account = connectorFixture.addAccount('Slow', 'reusable-account', 'Reusable', false);
    account.requires_adoption = true;
    connectorFixture.methods = { Slow: [] };
  });
  await refresh();
  await button('连接账号').click();
  await settings.getByLabel('接管并启用', { exact: true }).waitFor();
  assert(await button('连接并启用').isDisabled());
  await settings.getByLabel('接管并启用', { exact: true }).check();
  await button('连接并启用').click();
  await button('Reusable 已连接').waitFor();
  assert.deepEqual(await page.evaluate(() => connectorFixture.previews.at(-1).input), { connection_id: 'reusable-account' });
  assert.equal(await page.evaluate(() => connectorFixture.confirmInput.adopt), true);
  assert.equal(await page.evaluate(() => connectorFixture.opened.length), openedBefore + 2);
  // OAuth retains the original one-click flow; fallback methods are ordered only when OAuth is absent.
  await page.evaluate(() => { connectorFixture.methods.Slow = [{ method: 'oauth2', fields: [] }, { method: 'api_key', fields: [{ name: 'api_key', label: 'API Key', required: true, secret: true }] }]; });
  await refresh();
  assert.equal(await settings.locator('.connector-connect-panel').count(), 0);
  await page.evaluate(() => { connectorFixture.authorized = false; });
  await button('添加其他账户').click();
  await button('取消授权').waitFor();
  assert.deepEqual(await page.evaluate(() => connectorFixture.previews.at(-1).input), { method: 'oauth2' });
  await button('取消授权').click();
  await settings.getByText('连接已取消', { exact: true }).waitFor();
  await page.evaluate(() => { connectorFixture.methods.Slow = [{ method: 'custom_credential', fields: [] }, { method: 'api_key', fields: [{ name: 'api_key', label: 'API Key', required: true, secret: true }] }]; });
  await refresh();
  await button('添加其他账户').click();
  assert.deepEqual(await settings.locator('.connector-connect-panel button').allTextContents(), ['API Key', '自定义凭据']);
  await button('API Key').click();
  await settings.getByLabel('API Key *', { exact: true }).fill('discard-this-secret');
  await button('取消授权').click();
  await settings.getByText('连接已取消', { exact: true }).waitFor();
  await button('添加其他账户').click();
  await button('API Key').click();
  assert.equal(await settings.getByLabel('API Key *', { exact: true }).inputValue(), '');
  // Cancel is reconciled by GET when its successful response is lost (POST itself is not idempotent).
  const cancellations = await page.evaluate(() => { connectorFixture.loseCancel = true; return connectorFixture.cancelled.length; });
  await button('取消授权').click();
  await settings.getByRole('alert').filter({ hasText: '取消响应丢失' }).waitFor();
  await button('取消授权').click();
  await settings.getByText('连接已取消', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => connectorFixture.cancelled.length), cancellations + 1);
  // A reopened preparing installation continues without a local enable record.
  await back();
  await settings.getByRole('tab', { name: '通用', exact: true }).click();
  await page.evaluate(() => {
    localStorage.clear(); connectorFixture.failState = null; connectorFixture.failAdvance = null;
    connectorFixture.installed.find(item => item.id === 'reusable-account-install').status = 'preparing';
  });
  await settings.getByRole('tab', { name: '应用', exact: true }).click();
  await card('Slow').click();
  await button('Reusable 正在准备工具').waitFor();
  await button('Reusable 正在准备工具').click();
  await page.evaluate(() => { connectorFixture.installed.find(item => item.id === 'reusable-account-install').status = 'ready'; });
  await button('Reusable 已连接').waitFor();
  // Focus reconciles revocation performed outside this window.
  await page.evaluate(() => { connectorFixture.accounts.Slow.find(item => item.id === 'reusable-account').usable = false; window.dispatchEvent(new Event('focus')); });
  await button('Reusable 未连接').waitFor();
  await button('已启用 2/3 个').waitFor();
  assert.equal(await settings.getByRole('button', {name: /暂停工具|恢复工具/}).count(), 0);
  await button('重新连接').waitFor();
  await page.setViewportSize({ width: 720, height: 720 });
  await settings.locator('.connector-tools-section').scrollIntoViewIfNeeded();
  await settings.screenshot({ path: 'output/playwright/connectors-auth-review-narrow.png' });
  assert(await settings.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  assert.deepEqual(errors, []);
  console.log('PASS: Home login cancellation, OAuth cancellation/retry, valid-account adoption, multiple auth methods, collapsed enabled-tool count and account reconnection, revision recovery, external revocation, current-account lifecycle, identity consolidation, scoped removal, partial failures, independent polling and navigation.');
} catch (error) {
  if (page) {
    console.error(await page.evaluate(() => ({ text: document.querySelector('#client-settings-dialog')?.innerText, previews: connectorFixture.previews, removed: connectorFixture.removed, calls: connectorFixture.lifecycleCalls })));
    await page.screenshot({ path: 'output/playwright/connectors-failure.png' });
  }
  throw error;
} finally { await browser?.close(); server.kill(); }
