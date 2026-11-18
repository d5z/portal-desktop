import { expect, it, vi } from 'vitest';
import { probeSubagentModel } from '../desktop/main/portal/subagent-probe';
const stream = (content = 'OK', end = true) => new Response('data: ' + JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] }) + '\n\n' + (end ? 'data: [DONE]\n\n' : ''), { headers: { 'content-type': 'text/event-stream' } });
const model = { provider: 'portal-custom', model: 'glm5.3flash', base_url: 'https://101.132.86.87/llm/test-being/v1', api: 'openai-completions', api_key: 'private-test-token' };
it('verifies real generation using Bearer auth and the complete gateway path', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(stream());
  await probeSubagentModel(model, request);
  const [url, init] = request.mock.calls[0];
  expect(url).toBe(model.base_url + '/chat/completions');
  expect(init?.headers).toMatchObject({ authorization: 'Bearer private-test-token' });
  expect(Buffer.byteLength(String(init?.body))).toBeLessThan(4096);
  expect(init?.redirect).toBe('error');
  expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'glm5.3flash', stream: true, tool_choice: 'none' });
});
it.each([401, 403, 429, 500, 502, 503, 504])('rejects HTTP %s without retries or leaking response credentials', async status => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('private-test-token', { status }));
  await expect(probeSubagentModel(model, request)).rejects.toThrow(`HTTP ${status}`);
  expect(request).toHaveBeenCalledTimes(1);
});
it('rejects incomplete streams and stream errors', async () => {
  for (const response of [stream('', true), stream('partial', false), new Response('data: {"error":{"message":"private-test-token"}}\n\n')]) {
    await expect(probeSubagentModel(model, vi.fn<typeof fetch>().mockResolvedValue(response))).rejects.toThrow('模型验证失败');
  }
});
it('redacts connection errors and rejects HTML responses', async () => {
  await expect(probeSubagentModel(model, vi.fn<typeof fetch>().mockRejectedValue(new Error('private-test-token')))).rejects.toThrow('连接失败');
  await expect(probeSubagentModel(model, vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>private-test-token</html>')))).rejects.toThrow('完整流式生成结果');
});
it.each([
  ['anthropic', undefined, '/v1/messages', { stop_reason: 'end_turn', content: [{ type: 'text', text: 'OK' }] }],
  ['google', undefined, '/v1beta/models/glm5.3flash:generateContent', { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'OK' }] } }] }],
  ['portal-custom', 'openai-responses', '/responses', { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }] }],
] as const)('verifies the retained %s custom protocol', async (provider, api, route, response) => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response));
  await probeSubagentModel({ ...model, provider, api }, request);
  expect(String(request.mock.calls[0][0])).toMatch(new RegExp(route + '$'));
});
it.each([
  ['anthropic-messages', { stop_reason: 'max_tokens', content: [{ type: 'text', text: 'Partial' }] }],
  ['anthropic-messages', { content: [{ type: 'text', text: 'Partial' }] }],
  ['google-generative-ai', { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'Partial' }] } }] }],
  ['google-generative-ai', { candidates: [{ content: { parts: [{ text: 'Partial' }] } }] }],
  ['openai-responses', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [{ type: 'message', content: [{ type: 'output_text', text: 'Partial' }] }] }],
  ['openai-responses', { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Partial' }] }] }],
] as const)('rejects incomplete %s results even when they contain text', async (api, response) => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response));
  await expect(probeSubagentModel({ ...model, api }, request)).rejects.toThrow('未收到完整生成结果');
});
