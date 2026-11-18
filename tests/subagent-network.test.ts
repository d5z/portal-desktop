import { expect, it, vi } from 'vitest';
import type { SaveSettings, Snapshot } from '../desktop/shared/types';
import { SubagentModelNetwork } from '../desktop/main/portal/subagent-network';
import { probeSubagentModel } from '../desktop/main/portal/subagent-probe';

const endpoint = 'beings://desktop/llm/alice/v1/chat/completions';
const model = { provider: 'portal-custom', model: 'glm5.3flash', api: 'openai-completions', base_url: 'https://101.132.86.87/llm/alice/v1', api_key: 'private-token' };
const sse = 'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
const input: SaveSettings = { workspace: '/workspace', portalBinary: '/portal', portalName: 'desktop', autoStart: false, allowExec: true, kitsEnabled: true, subagentInherit: true };
const snapshot: Snapshot = { settings: { ...input, endpoint: 'https://example.org/alice', being: 'alice', hasToken: true }, portal: { phase: 'connected', message: '已连接', logs: [] } };
function fixture(shell = 'beings://desktop/') {
  const report = vi.fn(() => '安全错误信息');
  const upstream = vi.fn<typeof fetch>().mockImplementation(async () => new Response(sse, { headers: { 'Content-Type': 'text/event-stream' } }));
  const network = new SubagentModelNetwork(() => shell, report, upstream);
  const save = vi.fn(async (_input: SaveSettings, request: typeof fetch) => { await probeSubagentModel(model, request); return snapshot; });
  network.save = save;
  const prepared = network.prepare(input, 'alice');
  const request = (options: RequestInit = {}, url = endpoint) => new Request(url, {
    method: 'POST', body: prepared.body, ...options,
    headers: { 'Content-Type': 'application/json', Origin: new URL(shell).protocol + '//' + new URL(shell).host, 'X-Subagent-Access': prepared.key, ...options.headers },
  });
  return { network, report, upstream, save, request, prepared };
}

it.each(['beings://desktop/', 'http://localhost:5173/'])('relays the actual model body and response from %s', async shell => {
  const { network, upstream, save, request, prepared } = fixture(shell);
  expect(prepared.url).toBe(endpoint);
  expect(JSON.parse(prepared.body)).toMatchObject({ model: 'glm5.3flash', stream: true, tool_choice: 'none' });
  expect(prepared.body).not.toMatch(/workspace|allowExec|portalBinary|private-token/);
  const response = await network.handle(request());
  expect(response.status).toBe(200);
  expect(await response.text()).toBe(sse);
  expect(save).toHaveBeenCalledExactlyOnceWith(input, expect.any(Function));
  expect(upstream).toHaveBeenCalledExactlyOnceWith(model.base_url + '/chat/completions', expect.objectContaining({ body: prepared.body, headers: expect.objectContaining({ authorization: 'Bearer private-token' }) }));
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe(shell.slice(0, -1));
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.get('X-Upstream-URL')).toBe(model.base_url + '/chat/completions');
  expect(response.headers.get('Access-Control-Expose-Headers')).toBe('X-Upstream-URL');
  expect((await network.handle(request())).status).toBe(409);
  expect(network.result(prepared.key)).toEqual(snapshot);
  expect(() => network.result(prepared.key)).toThrow('尚未成功');
});

it.each([
  [500, 'text/html', '<html><body>500 Internal Server Error — openresty</body></html>'],
  [401, 'application/json', '{"error":{"message":"Invalid Loom token","code":"LOOM_AUTH_REQUIRED"}}'],
  [429, 'application/json', '{"error":{"code":"rate_limit"}}'],
] as const)('preserves upstream %s error bytes and content type', async (status, contentType, body) => {
  const { network, report, upstream, request, prepared } = fixture();
  upstream.mockResolvedValueOnce(new Response(body, { status, headers: { 'Content-Type': contentType } }));
  const response = await network.handle(request());
  expect(response.status).toBe(status);
  expect(response.headers.get('Content-Type')).toBe(contentType);
  expect(response.headers.get('X-Upstream-URL')).toBe(model.base_url + '/chat/completions');
  expect(decodeURIComponent(response.headers.get('X-Subagent-Error')!)).toContain(`HTTP ${status}`);
  expect(await response.text()).toBe(body);
  expect(report).not.toHaveBeenCalled();
  expect(() => network.result(prepared.key)).toThrow('尚未成功');
});

it('rejects an incomplete response instead of publishing an applied snapshot', async () => {
  const { network, upstream, request, prepared } = fixture();
  upstream.mockResolvedValueOnce(new Response('data: {"choices":[]}\n\n'));
  expect((await network.handle(request())).status).toBe(502);
  expect(() => network.result(prepared.key)).toThrow('尚未成功');
});

it('reports transaction errors as 502 without returning their original message', async () => {
  const { network, report, save, request } = fixture();
  const error = new Error('secret-token');
  save.mockRejectedValue(error);
  const response = await network.handle(request());
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: '安全错误信息' });
  expect(report).toHaveBeenCalledWith(error);
});

it('rejects absent or invalid access keys and foreign origins before saving', async () => {
  const { network, save, request } = fixture();
  const missing = request();
  missing.headers.delete('X-Subagent-Access');
  for (const candidate of [missing, request({ headers: { 'X-Subagent-Access': 'wrong' } }), request({ headers: { Origin: 'https://foreign.example' } })]) {
    expect((await network.handle(candidate)).status).toBe(403);
  }
  expect(save).not.toHaveBeenCalled();
});

it('rejects other routes, methods and changed model bodies before saving', async () => {
  const { network, save, request } = fixture();
  expect((await network.handle(request({ method: 'GET', body: undefined }))).status).toBe(405);
  for (const url of ['beings://desktop/api/other', 'beings://foreign/v1/chat/completions', 'https://desktop/v1/chat/completions']) {
    expect((await network.handle(request({}, url))).status).toBe(404);
  }
  expect((await network.handle(request({}, 'beings://desktop/llm/bob/v1/chat/completions'))).status).toBe(400);
  expect((await network.handle(request({ body: '{"model":"different"}' }))).status).toBe(400);
  expect(save).not.toHaveBeenCalled();
});

it('allows trusted CORS preflight without an access key or ready handler', async () => {
  const { network, save, request } = fixture('http://localhost:5173/');
  network.save = undefined;
  const preflight = request({ method: 'OPTIONS', body: undefined });
  preflight.headers.delete('X-Subagent-Access');
  const response = await network.handle(preflight);
  expect(response.status).toBe(204);
  expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST');
  expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, X-Subagent-Access');
  expect(save).not.toHaveBeenCalled();
});

it('rejects malformed bodies and returns 503 until the transaction is bound', async () => {
  const { network, save, request } = fixture();
  expect((await network.handle(request({ body: '{broken' }))).status).toBe(400);
  expect(save).not.toHaveBeenCalled();
  network.save = undefined;
  expect((await network.handle(request())).status).toBe(503);
});
