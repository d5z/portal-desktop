import { randomUUID } from 'node:crypto';
import type { SaveSettings, Snapshot } from '../../shared/types';
import { SubagentProbeError } from './subagent-probe';
import { subagentModelRequest } from '../../shared/subagent-model';

/** Renderer-visible configuration requests reuse the validated settings transaction. */
export class SubagentModelNetwork {
  private pending = new Map<string, { input: SaveSettings; url: string; body: string; snapshot?: Snapshot; running?: boolean; timer: ReturnType<typeof setTimeout> }>();
  save?: (input: SaveSettings, modelRequest: typeof fetch) => Promise<Snapshot>;
  constructor(private shellURL: () => string, private report: (error: unknown) => string, private fetchUpstream: typeof fetch = fetch) {}

  prepare(input: SaveSettings, being: string) {
    const { url, body } = subagentModelRequest(input.subagentSetup || {
      provider: 'portal-custom', model: 'glm5.3flash', api: 'openai-completions',
      base_url: `https://101.132.86.87/llm/${being}/v1`,
    });
    const key = randomUUID();
    const timer = setTimeout(() => this.pending.delete(key), 5 * 60_000);
    this.pending.set(key, { input, url, body, timer });
    return { key, url: `beings://desktop${new URL(url).pathname}`, body };
  }

  result(key: string) {
    const pending = this.pending.get(key);
    const snapshot = pending?.snapshot;
    if (pending) clearTimeout(pending.timer);
    this.pending.delete(key);
    if (!snapshot) throw new Error('subagent 配置尚未成功应用。');
    return snapshot;
  }

  matches(pathname: string) {
    return /\/(?:chat\/completions|responses|messages|models\/[^/]+:generateContent)$/.test(pathname);
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.protocol !== 'beings:' || url.host !== 'desktop' || !this.matches(url.pathname)) return new Response(null, { status: 404 });
    const shell = new URL(this.shellURL());
    const origin = `${shell.protocol}//${shell.host}`;
    if (request.headers.has('Origin') && request.headers.get('Origin') !== origin) return new Response(null, { status: 403 });
    const headers = { 'Access-Control-Allow-Origin': origin, 'Cache-Control': 'no-store', Vary: 'Origin' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
      ...headers, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type, X-Subagent-Access',
    } });
    const key = request.headers.get('X-Subagent-Access') || '';
    const pending = this.pending.get(key);
    if (!pending) return new Response(null, { status: 403, headers });
    if (request.method !== 'POST') return new Response(null, { status: 405, headers });
    if (!this.save) return Response.json({ error: 'Subagent 配置服务尚未就绪。' }, { status: 503, headers });
    const body = await request.text();
    if (url.pathname !== new URL(pending.url).pathname || body !== pending.body)
      return Response.json({ error: '模型验证请求与待应用配置不一致。' }, { status: 400, headers });
    if (pending.running) return Response.json({ error: '此配置请求已执行。' }, { status: 409, headers });
    pending.running = true;
    try {
      let upstream: Response | undefined;
      pending.snapshot = await this.save(pending.input, async (target, init) => {
        if (String(target) !== pending.url || init?.body !== body) throw new Error('模型配置已变化，请重新验证。');
        const response = await this.fetchUpstream(target, { ...init, body,
          signal: AbortSignal.any([request.signal, ...(init?.signal ? [init.signal] : [])]),
        });
        upstream = response.clone();
        return response;
      });
      if (!upstream) throw new Error('未执行模型验证，配置请求未完成。');
      // Keep the short-lived ticket until preload retrieves the committed
      // snapshot. A renderer crash must not leave a successful ticket forever.
      return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText,
        headers: { ...headers, 'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
          'X-Upstream-URL': pending.url, 'Access-Control-Expose-Headers': 'X-Upstream-URL' },
      });
    } catch (error) {
      clearTimeout(pending.timer);
      this.pending.delete(key);
      if (error instanceof SubagentProbeError && error.upstream) {
        return new Response(error.upstream.body, { status: error.status, statusText: error.upstream.statusText, headers: {
          ...headers, 'Content-Type': error.upstream.contentType,
          'X-Upstream-URL': error.upstream.url,
          'X-Subagent-Error': encodeURIComponent(error.message),
          'Access-Control-Expose-Headers': 'X-Upstream-URL, X-Subagent-Error',
        } });
      }
      return Response.json({ error: this.report(error) }, { status: error instanceof SubagentProbeError ? error.status : 502, headers });
    }
  }
}
