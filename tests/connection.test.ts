import { describe, expect, it } from 'vitest';
import { parseConnection, redact } from '../desktop/main/chat/connection';
import { upstreamRequest, ChatProxy } from '../desktop/main/chat/proxy';

const connection = parseConnection('https://echo.example/alice/?token=fixture-token&relay_secret=relay-key');
describe('connection and credential boundary', () => {
  it('normalizes endpoint without exposing credentials', () => {
    expect(connection.endpoint).toBe('https://echo.example/alice');
    expect(connection.link).toBe('https://echo.example/alice/?token=fixture-token');
    expect(connection.relaySecret).toBe('relay-key');
  });
  it.each(['file:///etc/passwd', 'https://user:pass@echo.example/alice/?token=t', 'https://echo.example/?token=t', 'https://echo.example/alice/extra/?token=t', 'http://echo.example/alice/?token=t', 'https://echo.example/alice/', 'https://echo.example/alice/?token=a%26b'])(
    'rejects unsupported links: %s', value => expect(() => parseConnection(value)).toThrow());
  it('allows explicit local mock server', () => expect(parseConnection('http://127.0.0.1:9876/alice/?token=test').endpoint).toBe('http://127.0.0.1:9876/alice'));
  it('redacts credentials and terminal control colors', () => {
    expect(redact('\x1b[31mhttps://host/a?token=abc secret=xyz fixture-token\x1b[0m', ['fixture-token'])).toBe('https://host/a?token=[redacted] secret=[redacted] [redacted]');
  });
  it('restricts proxy paths, methods and renderer-supplied headers', () => {
    const req = new Request('beings://chat/api/llm/config?token=attacker&redirect=https://evil', { headers: { 'X-Relay-Secret': 'evil', Cookie: 'secret', Authorization: 'evil' } });
    const upstream = upstreamRequest(req, connection);
    expect(upstream.url).toBe('https://echo.example/alice/api/llm/config?token=fixture-token');
    expect(upstream.headers.get('X-Relay-Secret')).toBe('relay-key');
    expect(upstream.headers.has('cookie')).toBe(false);
    expect(upstream.headers.has('authorization')).toBe(false);
    for (const path of ['beings://chat/api/exec', 'beings://desktop/api/status', 'https://chat/api/status']) expect(() => upstreamRequest(new Request(path), connection)).toThrow();
    expect(() => upstreamRequest(new Request('beings://chat/api/history', { method: 'POST' }), connection)).toThrow();
    for (const [route, method] of [['start', 'POST'], ['poll', 'GET'], ['', 'DELETE']]) {
      expect(() => upstreamRequest(new Request('beings://chat/api/llm/oauth' + (route ? '/' + route : ''), { method }), connection)).toThrow();
    }
  });
  it('allows model catalog and key endpoints while isolating route queries and credentials', () => {
    const request = new Request('beings://chat/api/llm/models?route=openai-responses&token=evil&base_url=https://evil');
    const upstream = upstreamRequest(request, connection);
    expect(upstream.url).toBe('https://echo.example/alice/api/llm/models?route=openai-responses&token=fixture-token');
    expect(upstream.headers.get('X-Relay-Secret')).toBe('relay-key');
    expect(upstreamRequest(new Request('beings://chat/api/llm/routes'), connection).url).toContain('/api/llm/routes?token=');
    expect(upstreamRequest(new Request('beings://chat/api/llm/keys', { method: 'POST' }), connection).url).toContain('/api/llm/keys?token=');
    for (const [path, method] of [['routes', 'POST'], ['models', 'PATCH'], ['keys', 'GET']])
      expect(() => upstreamRequest(new Request('beings://chat/api/llm/' + path, { method }), connection)).toThrow();
  });
  it('forwards request bodies and preserves streamed chunks without buffering', async () => {
    let push!: ReadableStreamDefaultController<Uint8Array>;
    let captured: RequestInit | undefined;
    const scene = { scene_id: 'desktop-fixture', scene_meta: { client: 'portal-desktop/0.1.2', scene_label: '桌面·PC' } };
    const proxy = new ChatProxy(() => connection, async (_url, options) => {
      captured = options;
      return new Response(new ReadableStream({ start(controller) { push = controller; } }), { headers: { 'Content-Type': 'text/event-stream', 'Set-Cookie': 'private=1' } });
    }, scene);
    const body = { message: '你好\n这是一条普通消息。', session_id: 'session-fixture', attachments: [{ data: 'YWJj', media_type: 'text/plain' }] };
    const response = await proxy.handle(new Request('beings://chat/api/chat/stream', { method: 'POST', body: JSON.stringify({ ...body, scene_id: 'stale-room', scene_meta: { client: 'stale-client' } }) }));
    expect(await new Request('https://fixture.test', captured).json()).toEqual({ ...body, ...scene });
    expect(captured!.redirect).toBe('error');
    expect(response.headers.has('set-cookie')).toBe(false);
    const reader = response.body!.getReader();
    const meta = 'event: meta\ndata: {"scene_id":"desktop-fixture","trace_id":"trace-fixture"}\n\n';
    push.enqueue(new TextEncoder().encode(meta));
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(meta);
    push.enqueue(new TextEncoder().encode('event: done\ndata: {}\n\n')); push.close();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: done');
    expect((await reader.read()).done).toBe(true);
  });
  it('bypasses upstream caching when refreshing SBS configuration', async () => {
    let enabled = false;
    const proxy = new ChatProxy(() => connection, async (_url, options) => {
      expect(options?.cache).toBe('no-store');
      return Response.json({ sbs_enabled: enabled });
    });
    const read = async () => (await proxy.handle(new Request('beings://chat/api/llm/config'))).json();
    expect(await read()).toEqual({ sbs_enabled: false });
    enabled = true;
    expect(await read()).toEqual({ sbs_enabled: true });
  });
  it('cancels upstream requests when switching connections', async () => {
    let signal: AbortSignal | undefined;
    const proxy = new ChatProxy(() => connection, async (_url, options) => {
      signal = options?.signal as AbortSignal;
      return new Response(new ReadableStream({ start() {} }));
    });
    const response = await proxy.handle(new Request('beings://chat/api/stream/active'));
    proxy.abortAll(); expect(signal!.aborted).toBe(true);
    await response.body!.cancel();
  });
  it('does not leak credential-bearing upstream errors', async () => {
    const proxy = new ChatProxy(() => connection, async () => { throw new Error(connection.link); });
    const response = await proxy.handle(new Request('beings://chat/api/status'));
    expect(response.status).toBe(502); expect(await response.text()).not.toContain(connection.token);
  });
});
