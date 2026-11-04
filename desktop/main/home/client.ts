import { randomBytes, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { SecretStorage } from '../app/settings';
import type { HomeOperation } from '../../shared/home';
import { HOME_CALLBACK, HOME_CLIENT, HOME_ORIGIN, HOME_SCOPE, HomeError, homeURL, verifyIdentityToken } from './protocol';
interface Tokens { access: string; refresh: string; expires: number; subject: string }
export interface PendingOperation { kind: 'ensure' | 'stop' | 'recreate'; key: string; operation?: HomeOperation }
interface Saved { version: 1; tokens: Tokens; pending?: PendingOperation }
interface OAuthTokens { access_token: string; refresh_token?: string; expires_in?: number; token_type: string; id_token?: string }
/** Node fetch deliberately has no browser cookie jar or Origin header. */
export class HomeClient {
  private saved?: Saved;
  private generation = 0;
  private refreshFlight?: Promise<void>;
  private writes: Promise<unknown> = Promise.resolve();
  private cancelAuth?: () => void;
  private requests = new Set<AbortController>();
  private requestGeneration = 0;
  cancelRequests() { this.requestGeneration++; for (const request of this.requests) request.abort(); this.requests.clear(); }
  constructor(private directory: string, private storage: SecretStorage,
    private openExternal: (url: string) => Promise<void>, private fetcher: typeof fetch = fetch) {}
  get authenticated() { return !!this.saved; }
  get sessionVersion() { return this.generation; }
  get pending() { return this.saved?.pending; }
  get authenticating() { return !!this.cancelAuth; }
  private get file() { return path.join(this.directory, 'home-session.json'); }
  async load() {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8'));
      const saved = JSON.parse(this.storage.decryptString(Buffer.from(raw.credential, 'base64')));
      if (saved.version !== 1 || !saved.tokens?.access || !saved.tokens?.refresh || !Number.isFinite(saved.tokens.expires)) throw new Error();
      this.saved = saved;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('无法读取 Home 登录信息，请重新连接。');
    }
  }
  private persist() {
    const value = this.saved;
    const write = async () => {
      if (!value) { await rm(this.file, { force: true }); return; }
      if (!this.storage.isEncryptionAvailable()) throw new Error('系统密钥库不可用，无法安全保存 Home 登录。');
      await mkdir(this.directory, { recursive: true });
      const credential = this.storage.encryptString(JSON.stringify(value)).toString('base64');
      await writeFile(this.file + '.tmp', JSON.stringify({ credential }), { mode: 0o600 });
      await rename(this.file + '.tmp', this.file);
    };
    const next = this.writes.then(write, write); this.writes = next.catch(() => {}); return next;
  }
  async setPending(pending?: PendingOperation) {
    if (!this.saved) throw new HomeError(401, '');
    this.saved = { ...this.saved, pending }; await this.persist();
  }
  async raw<T>(pathname: string, init: RequestInit = {}, read?: (response: Response, progress: () => void) => Promise<T>): Promise<T> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new Error('Being Home 请求超时，请重试。')), 20_000);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout.signal]) : timeout.signal;
    try {
      let response: Response;
      try { response = await this.fetcher(homeURL(pathname), { ...init, redirect: 'error', signal }); }
      catch { throw new HomeError(0, 'network'); }
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new HomeError(response.status, typeof error.error === 'string' ? error.error : '');
      }
      if (response.status === 204) return undefined as T;
      if (read) {
        timer.refresh(); // File transfers time out on inactivity, not total duration.
        return await read(response, () => timer.refresh());
      }
      try { return await response.json() as T; } catch { throw new HomeError(502, 'invalid_response'); }
    } finally { clearTimeout(timer); }
  }
  private tokenRequest(body: Record<string, string>) {
    return this.raw<OAuthTokens>('/native/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: HOME_CLIENT, ...body }).toString() });
  }
  private tokens(response: OAuthTokens, subject: string, previousRefresh = ''): Tokens {
    if (!response.access_token || response.token_type?.toLowerCase() !== 'bearer' ||
        !Number.isFinite(response.expires_in) || response.expires_in! <= 0 || !(response.refresh_token || previousRefresh))
      throw new Error('Home 返回的登录有效期或凭据不完整，请重新连接。');
    return { access: response.access_token, refresh: response.refresh_token || previousRefresh,
      expires: Date.now() + response.expires_in! * 1000, subject };
  }
  private async refreshToken(observed?: string) {
    if (observed && this.saved?.tokens.access !== observed) return;
    if (this.refreshFlight) return this.refreshFlight;
    const saved = this.saved, generation = this.generation;
    if (!saved) throw new HomeError(401, '');
    const flight = (async () => {
      try {
        const result = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: saved.tokens.refresh });
        if (generation !== this.generation) throw new HomeError(401, '');
        this.saved = { ...this.saved!, tokens: this.tokens(result, saved.tokens.subject, saved.tokens.refresh) };
        await this.persist();
      } catch (error) {
        if (generation === this.generation && error instanceof HomeError && (error.code === 'invalid_grant' || error.status === 401)) {
          this.saved = undefined; this.generation++; await this.persist();
        }
        throw error;
      }
    })();
    this.refreshFlight = flight;
    try { await flight; } finally { if (this.refreshFlight === flight) this.refreshFlight = undefined; }
  }
  async request<T>(pathname: string, init: RequestInit = {}, read?: (response: Response, progress: () => void) => Promise<T>): Promise<T> {
    const generation = this.generation, requestGeneration = this.requestGeneration;
    if (!this.saved) throw new HomeError(401, '');
    if (this.saved.tokens.expires <= Date.now() + 60_000) await this.refreshToken();
    const access = this.saved?.tokens.access;
    if (!access || generation !== this.generation || requestGeneration !== this.requestGeneration) throw new HomeError(401, '');
    const request = new AbortController(); this.requests.add(request);
    const current = () => { if (generation !== this.generation || requestGeneration !== this.requestGeneration) throw new Error('请求已取消，请重试。'); };
    const send = (token: string) => { current(); return this.raw<T>(pathname, { ...init, signal: request.signal, headers: { ...init.headers, Authorization: `Bearer ${token}` } }, read); };
    try {
      const result = await send(access);
      current();
      return result;
    } catch (error) {
      if (!(error instanceof HomeError) || error.status !== 401 || generation !== this.generation || requestGeneration !== this.requestGeneration) throw error;
      await this.refreshToken(access);
      current();
      // A rejected authentication is safe to retry; ambiguous transport failures never replay writes.
      const result = await send(this.saved!.tokens.access);
      current();
      return result;
    } finally { this.requests.delete(request); }
  }
  cancelLogin() { this.cancelAuth?.(); }
  async login(changed: () => void) {
    if (this.cancelAuth) return;
    if (!this.storage.isEncryptionAvailable()) throw new Error('请先解锁系统密钥库，再连接 Being Home。');
    const generation = ++this.generation;
    const state = randomBytes(32).toString('base64url'), nonce = randomBytes(32).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    let finish!: (code: string) => void, fail!: (error: Error) => void;
    const callback = new Promise<string>((resolve, reject) => { finish = resolve; fail = reject; });
    void callback.catch(() => {});
    const server = createServer((req, res) => {
      const url = new URL(req.url || '/', HOME_CALLBACK);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
      if (req.method !== 'GET' || req.headers.host !== '127.0.0.1:47831' || url.pathname !== '/oauth/callback' ||
          url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== state) {
        res.writeHead(400); res.end('无效的登录回调。'); return;
      }
      const code = url.searchParams.get('code');
      res.end(code ? '授权已收到，请返回客户端。' : '登录未完成，请返回客户端重试。');
      if (code && url.searchParams.getAll('code').length === 1 && !url.searchParams.has('error')) finish(code);
      else fail(new Error('登录已取消或未获授权。'));
    });
    const timer = setTimeout(() => fail(new Error('登录等待超时，请重新连接。')), 5 * 60_000);
    const cancel = () => { this.generation++; fail(new Error('登录已取消。')); };
    this.cancelAuth = cancel; changed();
    try {
      await new Promise<void>((resolve, reject) => { server.once('error', () => reject(new Error('登录回调端口 47831 被占用，请关闭其他登录窗口后重试。'))); server.listen(47831, '127.0.0.1', resolve); });
      const config = await this.raw<{ client_id: string; redirect_uris: string[]; authorization_endpoint: string; audience: string; scope: string }>('/native/client-config/' + HOME_CLIENT);
      if (config.client_id !== HOME_CLIENT || !Array.isArray(config.redirect_uris) || !config.redirect_uris.includes(HOME_CALLBACK) || !config.audience || typeof config.scope !== 'string' ||
          HOME_SCOPE.split(' ').some(scope => !config.scope.split(' ').includes(scope))) throw new Error('Home 桌面客户端注册配置不匹配。');
      const url = homeURL(config.authorization_endpoint);
      if (url.pathname !== '/oidc/oauth2/auth') throw new Error('Home 登录入口无效。');
      url.search = new URLSearchParams({ client_id: HOME_CLIENT, response_type: 'code', redirect_uri: HOME_CALLBACK,
        scope: HOME_SCOPE, audience: config.audience, state, nonce, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
      if (generation !== this.generation) throw new Error('登录已取消。');
      await this.openExternal(url.href);
      const code = await callback;
      const result = await this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: HOME_CALLBACK, code_verifier: verifier });
      const discovery = await this.raw<{ issuer: string; jwks_uri: string }>('/oidc/.well-known/openid-configuration');
      if (discovery.issuer !== `${HOME_ORIGIN}/oidc/`) throw new Error('Home 登录签发方不匹配。');
      const keys = await this.raw<{ keys: JsonWebKey[] }>(homeURL(discovery.jwks_uri).href);
      const subject = verifyIdentityToken(result.id_token || '', keys, nonce);
      if (generation !== this.generation) throw new Error('登录已取消。');
      this.saved = { version: 1, tokens: this.tokens(result, subject) }; await this.persist();
    } finally {
      clearTimeout(timer); server.close(); server.closeAllConnections();
      if (this.cancelAuth === cancel) this.cancelAuth = undefined; changed();
    }
  }
  async logout() {
    this.cancelLogin(); this.cancelRequests(); this.generation++;
    const tokens = this.saved?.tokens; this.saved = undefined;
    await this.persist();
    if (!tokens) return;
    const results = await Promise.allSettled([['access_token', tokens.access], ['refresh_token', tokens.refresh]].map(async ([hint, token]) => {
      // Revoke may return either an empty 200 or 204.
      let response: Response;
      try { response = await this.fetcher(HOME_ORIGIN + '/native/oauth/revoke', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: HOME_CLIENT, token_type_hint: hint, token }).toString() }); }
      catch { throw new Error(); }
      if (!response.ok) throw new Error();
    }));
    if (results.some(result => result.status === 'rejected')) throw new Error('已退出本机登录，但云端凭据撤销未完成。请在 Home 账号中检查授权。');
  }
}
