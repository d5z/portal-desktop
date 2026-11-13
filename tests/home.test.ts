import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { HomeClient, type PendingOperation } from '../desktop/main/home/client';
import { HomeService } from '../desktop/main/home/service';
import { HOME_CALLBACK, HOME_CLIENT, HOME_ORIGIN, HomeError, ticketURL, verifyIdentityToken, viewerNavigation } from '../desktop/main/home/protocol';
import { parseConnection } from '../desktop/main/chat/connection';
import type { HomeComputer } from '../desktop/shared/home';
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
const storage = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() };
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'fixture' };
function identity(nonce: string, extra = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fixture' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ iss: HOME_ORIGIN + '/oidc/', sub: 'subject', aud: HOME_CLIENT, nonce, exp: Date.now() / 1000 + 600, iat: Date.now() / 1000, ...extra })).toString('base64url');
  return `${header}.${body}.${sign('RSA-SHA256', Buffer.from(header + '.' + body), privateKey).toString('base64url')}`;
}
const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const registeredScope = 'openid profile email offline_access being:read being:write account:write files:read files:write computer:read computer:write computer:exec computer:connect';
async function loggedIn(scope = registeredScope) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'home-unit-')); directories.push(dir);
  let auth = new URL(HOME_ORIGIN), counter = 0;
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const pathname = new URL(String(input)).pathname;
    if (pathname.endsWith('/being-desktop')) return jsonResponse({ client_id: HOME_CLIENT, redirect_uris: [HOME_CALLBACK], authorization_endpoint: HOME_ORIGIN + '/oidc/oauth2/auth', audience: 'urn:being:home', scope });
    if (pathname.endsWith('/openid-configuration')) return jsonResponse({ issuer: HOME_ORIGIN + '/oidc/', jwks_uri: HOME_ORIGIN + '/oidc/keys' });
    if (pathname.endsWith('/keys')) return jsonResponse({ keys: [jwk] });
    if (pathname.endsWith('/token')) {
      const body = new URLSearchParams(String(init?.body));
      if (body.get('grant_type') === 'authorization_code') expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(auth.searchParams.get('code_challenge'));
      counter++;
      return jsonResponse({ access_token: `access-${counter}`, refresh_token: `refresh-${counter}`, expires_in: 3600, token_type: 'Bearer', id_token: identity(auth.searchParams.get('nonce')!) });
    }
    if (pathname.endsWith('/revoke')) return new Response(null, { status: 200 });
    return jsonResponse({ ok: true });
  });
  const client = new HomeClient(dir, storage, async value => {
    auth = new URL(value);
    // Exercise the real loopback HTTP listener and the CSRF check.
    const rejected = await fetch(HOME_CALLBACK + '?state=wrong&code=ignored'); expect(rejected.status).toBe(400);
    await fetch(HOME_CALLBACK + '?' + new URLSearchParams({ state: auth.searchParams.get('state')!, code: 'code-fixture' }));
  }, fetcher);
  await client.login(() => {});
  return { client, fetcher, dir, auth };
}
describe('Home OAuth and credential boundary', () => {
  it.each(['/being-desktop', '/token', '/openid-configuration', '/keys'])('cancels login during %s and immediately permits a fresh login', async stage => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'home-cancel-')); directories.push(dir);
    let blocked = true, stalledSignal: AbortSignal | undefined, auth = new URL(HOME_ORIGIN);
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const pathname = new URL(String(input)).pathname;
      if (blocked && pathname.endsWith(stage)) return new Promise<Response>((_, reject) => {
        stalledSignal = init!.signal!;
        stalledSignal.addEventListener('abort', () => reject(stalledSignal!.reason), { once: true });
      });
      if (pathname.endsWith('/being-desktop')) return jsonResponse({ client_id: HOME_CLIENT, redirect_uris: [HOME_CALLBACK], authorization_endpoint: HOME_ORIGIN + '/oidc/oauth2/auth', audience: 'urn:being:home', scope: registeredScope });
      if (pathname.endsWith('/token')) return jsonResponse({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, token_type: 'Bearer', id_token: identity(auth.searchParams.get('nonce')!) });
      if (pathname.endsWith('/openid-configuration')) return jsonResponse({ issuer: HOME_ORIGIN + '/oidc/', jwks_uri: HOME_ORIGIN + '/oidc/keys' });
      return jsonResponse({ keys: [jwk] });
    });
    const client = new HomeClient(dir, storage, async url => {
      auth = new URL(url);
      await fetch(HOME_CALLBACK + '?' + new URLSearchParams({ state: auth.searchParams.get('state')!, code: 'fixture' }));
    }, fetcher);
    const pending = client.login(() => {});
    const cancelled = expect(pending).rejects.toThrow('登录已取消');
    await vi.waitFor(() => expect(stalledSignal).toBeDefined());
    client.cancelLogin();
    expect(stalledSignal!.aborted).toBe(true);
    await cancelled;
    expect(client.authenticating).toBe(false);
    expect(client.authenticated).toBe(false);
    await expect(readFile(path.join(dir, 'home-session.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    blocked = false;
    await client.login(() => {});
    expect(client.authenticated).toBe(true);
  });
  it('requests every registered permission, including file access and newly advertised scopes', async () => {
    const scope = registeredScope + ' fixture:additional';
    const { auth } = await loggedIn(scope);
    expect(auth.searchParams.get('scope')).toBe(scope);
  });
  it('rejects registration without file read permission', async () => {
    await expect(loggedIn(registeredScope.replace('files:read ', ''))).rejects.toThrow('注册配置不匹配');
  });
  it('explains how to renew an old grant without refreshing the same insufficient permissions', async () => {
    const { client, fetcher } = await loggedIn(); fetcher.mockReset();
    fetcher.mockResolvedValue(jsonResponse({ error: 'insufficient_scope' }, 403));
    await expect(client.request('/v1/me/files/content?path=artifacts/intro.pptx')).rejects.toThrow('退出 Home 后重新登录');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(client.authenticated).toBe(true);
  });
  it('validates PKCE and OIDC, persists encrypted credentials, and keeps native token calls free of browser headers', async () => {
    const { client, fetcher, dir } = await loggedIn();
    expect(client.authenticated).toBe(true);
    expect(await readFile(path.join(dir, 'home-session.json'), 'utf8')).not.toContain('access-1');
    for (const [url, init] of fetcher.mock.calls.filter(([url]) => String(url).includes('/token'))) {
      expect(String(url)).toBe(HOME_ORIGIN + '/native/oauth/token');
      expect(new Headers(init?.headers).has('Origin')).toBe(false);
      expect(new Headers(init?.headers).has('Cookie')).toBe(false);
      expect(new Headers(init?.headers).has('Authorization')).toBe(false);
    }
    const restored = new HomeClient(dir, storage, async () => {}, fetcher); await restored.load(); expect(restored.authenticated).toBe(true);
    await client.logout(); expect(client.authenticated).toBe(false);
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/revoke'))).toHaveLength(2);
    await expect(readFile(path.join(dir, 'home-session.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('coordinates concurrent 401 refreshes and atomically saves the rotated refresh token', async () => {
    const { client, fetcher, dir } = await loggedIn();
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url, init) => {
      if (new URL(String(url)).pathname === '/v1/me') return new Headers(init?.headers).get('Authorization') === 'Bearer access-1'
        ? jsonResponse({ error: 'expired' }, 401) : jsonResponse({ ok: true });
      return original(url, init);
    });
    await Promise.all([client.request('/v1/me'), client.request('/v1/me'), client.request('/v1/me')]);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/token'))).toHaveLength(2);
    const saved = JSON.parse(storage.decryptString(Buffer.from(JSON.parse(await readFile(path.join(dir, 'home-session.json'), 'utf8')).credential, 'base64')));
    expect(saved.tokens.refresh).toBe('refresh-2');
  });
  it('does not replay a write after a network failure, and sanitizes remote errors', async () => {
    const { client, fetcher } = await loggedIn(); fetcher.mockReset();
    fetcher.mockRejectedValue(new Error('ticket=secret provider-internal-host'));
    await expect(client.request('/v1/me/computer/ensure', { method: 'POST' })).rejects.toThrow('连接失败');
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValue(jsonResponse({ error: 'ticket=secret' }, 500));
    await expect(client.request('/v1/me')).rejects.not.toThrow('secret');
  });
  it('rejects refresh responses without an expiry and reports revocation failure after clearing local credentials', async () => {
    const { client, fetcher } = await loggedIn();
    fetcher.mockImplementation(async url => String(url).endsWith('/token')
      ? jsonResponse({ access_token: 'unknown-expiry', refresh_token: 'rotation', token_type: 'Bearer' }) : jsonResponse({}, 401));
    await expect(client.request('/v1/me')).rejects.toThrow('有效期');
    await expect(client.logout()).rejects.toThrow('已退出本机');
    expect(client.authenticated).toBe(false);
  });
  it('prevents a late refresh from restoring a logged-out session', async () => {
    const { client, fetcher } = await loggedIn();
    let resolve!: (response: Response) => void;
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url, init) => {
      if (String(url).endsWith('/v1/me')) return jsonResponse({}, 401);
      if (String(url).endsWith('/token')) return new Promise(done => { resolve = done; });
      return original(url, init);
    });
    const pending = client.request('/v1/me'); const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    await client.logout(); resolve(jsonResponse({ access_token: 'late', refresh_token: 'late', token_type: 'Bearer', expires_in: 3600 }));
    await rejected; expect(client.authenticated).toBe(false);
  });
  it('rejects invalid nonce, audience, signature and expiration', () => {
    const keys = { keys: [jwk] };
    expect(verifyIdentityToken(identity('nonce'), keys, 'nonce')).toBe('subject');
    for (const token of [identity('other'), identity('nonce', { aud: 'other' }), identity('nonce', { exp: 1 }), identity('nonce').replace(/\.[^.]+$/, '.broken-signature')])
      expect(() => verifyIdentityToken(token, keys, 'nonce')).toThrow();
  });
});
describe('Home viewer capability validation', () => {
  const ticket = { ticket: 'secret', expires_at: new Date(Date.now() + 30_000).toISOString(), connect_url: '/desktop/connect?ticket=secret' };
  it('accepts only a fresh Home ticket with exactly one matching query parameter', () => {
    expect(ticketURL(ticket)).toBe(HOME_ORIGIN + ticket.connect_url);
    for (const connect_url of ['https://attacker.invalid/desktop/connect?ticket=secret', '/desktop/connect?ticket=wrong', '/desktop/connect?ticket=secret&ticket=secret', '/desktop/connect?ticket=secret#x', '/desktop/connect?ticket=secret&next=/'])
      expect(() => ticketURL({ ...ticket, connect_url })).toThrow();
    expect(() => ticketURL({ ...ticket, expires_at: '2000-01-01' })).toThrow();
  });
  it('limits top-level navigation to this machine and blocks files and arbitrary Home pages', () => {
    expect(viewerNavigation(HOME_ORIGIN + '/desktop/one/', 'one')).toBe(true);
    for (const url of ['file:///etc/passwd', 'https://example.com', HOME_ORIGIN + '/', HOME_ORIGIN + '/desktop/two/', HOME_ORIGIN + '/desktop/one/?next=x']) expect(viewerNavigation(url, 'one')).toBe(false);
  });
});
function serviceFixture() {
  let pending: PendingOperation | undefined;
  let connection = parseConnection('https://loom.example/willow/?token=fixture');
  let computer: HomeComputer = { id: 'computer', being_profile_id: 'profile', status: 'stopped', desired_state: 'stopped', generation: 1 };
  let heart = { configured: true, origin: 'https://loom.example', heart_being_id: 'willow' };
  const request = vi.fn(async (url: string) => {
    if (url === '/v1/me') return { user: { id: 'user' }, username: 'willow-human', being: { id: 'profile', being_id: 'not-heart-id', display_name: 'Willow' }, computer_enabled: true, storage: { status: 'ready' } };
    if (url === '/v1/me/heart') return heart;
    if (url === '/v1/me/computer') return computer;
    if (url === '/v1/me/computer/browser') return { ready: true };
    if (url.endsWith('/desktop-ticket')) return { ticket: 'secret', expires_at: new Date(Date.now() + 30_000).toISOString(), connect_url: '/desktop/connect?ticket=secret' };
    if (url.includes('/operations/')) return { id: 'operation', status: 'succeeded' };
    computer = { ...computer, status: 'starting', desired_state: 'running' };
    return { computer, operation: { id: 'operation', status: 'pending' } };
  });
  const client = { authenticated: true, authenticating: false, get pending() { return pending; },
    request, cancelRequests: vi.fn(), setPending: vi.fn(async value => { pending = value; }), cancelLogin: vi.fn() };
  const viewer = { open: vi.fn(), close: vi.fn() };
  const publish = vi.fn();
  const service = new HomeService(client as unknown as HomeClient, viewer, () => connection, publish);
  return { service, request, client, viewer, setComputer: (next: Partial<HomeComputer>) => { computer = { ...computer, ...next }; },
    setConnection: () => { connection = parseConnection('https://other.example/other/?token=fixture'); },
    mismatch: () => { heart = { ...heart, heart_being_id: 'other' }; } };
}
describe('Home operation and account lifecycle', () => {
  it('never wakes on read and preserves the idempotency key after an unknown result', async () => {
    const f = serviceFixture(); await f.service.refresh(); expect(f.request.mock.calls.some(([p]) => p.endsWith('/ensure'))).toBe(false);
    const original = f.request.getMockImplementation()!; let first = true;
    f.request.mockImplementation(async url => { if (url.endsWith('/ensure') && first) { first = false; throw new HomeError(0, 'network'); } return original(url); });
    await f.service.action('wake'); const key = f.client.pending!.key;
    expect(f.service.state.error).toBeTruthy();
    await f.service.action('wake'); expect(f.client.pending!.key).toBe(key);
    expect(f.client.pending?.operation?.id).toBe('operation');
    f.setComputer({ status: 'running' }); await f.service.refresh(); expect(f.client.pending).toBeUndefined();
    await f.service.action('open'); expect(f.viewer.open).toHaveBeenCalledWith(HOME_ORIGIN + '/desktop/connect?ticket=secret', 'computer');
    expect(JSON.stringify(f.service.state)).not.toContain('secret');
  });
  it('rejects mismatched Heart origins/identities before computer writes or ticket issuance', async () => {
    const f = serviceFixture(); f.mismatch(); await f.service.action('wake');
    expect(f.service.state.binding).toBe('mismatch');
    expect(f.request.mock.calls.some(([p]) => p.includes('/computer'))).toBe(false);
  });
  it('cancels an in-flight viewer ticket on close and never stops or globally revokes on collapse', async () => {
    const f = serviceFixture(); f.setComputer({ status: 'running' });
    let finish!: (value: any) => void;
    const original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async url => url.endsWith('/desktop-ticket') ? new Promise(resolve => { finish = resolve; }) : original(url));
    const opening = f.service.action('open'); await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await f.service.action('close'); finish({ ticket: 'secret', expires_at: new Date(Date.now() + 30000).toISOString(), connect_url: '/desktop/connect?ticket=secret' });
    await opening; expect(f.viewer.open).not.toHaveBeenCalled();
    expect(f.request.mock.calls.some(([p]) => /stop|revoke/.test(p))).toBe(false);
  });
  it('discards stale account responses and closes the old view on generation changes', async () => {
    const f = serviceFixture(); f.setComputer({ status: 'running' }); await f.service.refresh();
    f.viewer.close.mockClear(); f.setComputer({ generation: 2 }); await f.service.refresh(); expect(f.viewer.close).toHaveBeenCalled();
    f.setConnection(); f.service.contextChanged(); expect(f.service.state.computer).toBeUndefined();
    await f.service.action('open'); expect(f.viewer.open).not.toHaveBeenCalled();
  });
  it('waits for browser readiness instead of treating a running machine as a live browser', async () => {
    const f = serviceFixture(); f.setComputer({ status: 'running' });
    const original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async url => url.endsWith('/browser') ? { ready: false } : original(url));
    await f.service.action('open'); expect(f.service.state.browserReady).toBe(false);
    expect(f.viewer.open).not.toHaveBeenCalled();
    expect(f.request.mock.calls.some(([p]) => p.endsWith('/desktop-ticket'))).toBe(false);
  });
  it('clears a rejected intent on conflict so an unrelated operation can settle', async () => {
    const f = serviceFixture(); const original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async url => { if (url.endsWith('/ensure')) throw new HomeError(409, 'operation_in_progress'); return original(url); });
    await f.service.action('wake'); expect(f.client.pending).toBeUndefined(); expect(f.service.state.pending).toBeUndefined();
  });
});
