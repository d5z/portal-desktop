import { connectorResourceMethods } from '../../shared/connector-resources';
import type { HomeClient } from './client';
import type { HomeService } from './service';
import { HomeError } from './protocol';

export class HomeConnectorResources {
  private activeQR = new Map<string, number>();
  private loggingOut = false;
  constructor(private client: HomeClient, private home: HomeService, private endpoint: () => string) {}
  context() {
    return { session: this.client.sessionVersion, endpoint: this.endpoint(), account: this.client.accountId,
      canWriteFiles: this.client.scopes.includes('files:write') };
  }
  async cancelBeforeLogout() {
    if (!this.activeQR.size) return;
    this.loggingOut = true;
    const session = this.client.sessionVersion;
    const paths = [...this.activeQR].flatMap(([path, owner]) => owner === session ? [path] : []);
    this.activeQR.clear();
    try {
      await Promise.allSettled(paths.map(path => this.client.request(path, { method: 'DELETE', signal: AbortSignal.timeout(2500) }, undefined, 2500)));
    } finally { this.loggingOut = false; }
  }
  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const methods = connectorResourceMethods(url.pathname);
    if (!methods?.includes(request.method) || url.search) return new Response(null, { status: 405 });
    const current = () => {
      if (this.loggingOut || this.client.authenticating || !this.client.authenticated || request.headers.get('X-Home-Session') !== String(this.client.sessionVersion) || request.headers.get('X-Home-Endpoint') !== this.endpoint())
        throw new HomeError(409, 'home_session_changed');
    };
    current();
    if ((url.pathname.startsWith('/v1/me/connector-imports/') && request.method !== 'GET') && !this.client.scopes.includes('files:write')) return Response.json({ error: 'insufficient_scope' }, { status: 403 });
    const file = url.pathname.startsWith('/v1/me/connector-imports/') || url.pathname === '/v1/me/files/download-reference';
    try {
      const check = file ? await this.home.fileAccess() : current;
      current();
      const body = await request.text();
      if (body) {
        let value: any;
        try { value = JSON.parse(body); } catch { return Response.json({ error: 'invalid_request' }, { status: 400 }); }
        if (!value || typeof value !== 'object' || Array.isArray(value)) return Response.json({ error: 'invalid_request' }, { status: 400 });
        if (url.pathname.endsWith('/weixin-qr/verify') && (typeof value.code !== 'string' || !value.code.trim() || value.code.length > 128)) return Response.json({ error: 'invalid_pairing_code' }, { status: 400 });
      }
      const init: RequestInit = { method: request.method, signal: request.signal,
        ...(body ? { body, headers: { 'Content-Type': 'application/json' } } : {}) };
      current();
      const qrMatch = /^(.*\/weixin-qr)(?:\/(advance|verify))?$/.exec(url.pathname);
      const qrPath = qrMatch?.[1];
      if (qrPath && !qrMatch?.[2] && request.method === 'POST') this.activeQR.set(qrPath, this.client.sessionVersion);
      const response = await this.client.request<Response>(url.pathname, init, async upstream => new Response(await upstream.arrayBuffer(), {
        status: upstream.status, headers: upstream.headers.has('Content-Type') ? { 'Content-Type': upstream.headers.get('Content-Type')! } : {},
      }), url.pathname.endsWith('/weixin-qr/advance') ? 60_000 : 20_000);
      current(); check();
      if (qrPath && response) {
        if (request.method === 'DELETE') this.activeQR.delete(qrPath);
        else {
          const state = await response.clone().json().catch(() => undefined);
          if (state?.enable?.status === 'ready' || ['expired', 'cancelled', 'failed'].includes(state?.state))
            this.activeQR.delete(qrPath);
        }
      }
      current();
      return response ?? new Response(null, { status: 204 });
    } catch (error) {
      current();
      if (error instanceof HomeError && error.response) {
        const contentType = error.response.headers.get('Content-Type');
        return new Response(error.response.body, { status: error.status, headers: contentType ? { 'Content-Type': contentType } : {} });
      }
      throw error;
    }
  }
}
