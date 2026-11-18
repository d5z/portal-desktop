import { subagentModelRequest } from '../../shared/subagent-model';

export class SubagentProbeError extends Error {
  constructor(message: string, readonly status: number, readonly upstream?: { url: string; body: ArrayBuffer; contentType: string; statusText: string }) { super(message); }
}

/** A real, side-effect-free generation must succeed before a model is applied. */
export async function probeSubagentModel(model: { provider: string; model: string; api?: string; base_url?: string; api_key?: string }, request: typeof fetch = fetch) {
  const { api, url, body } = subagentModelRequest(model);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (api === 'anthropic-messages') {
    headers['x-api-key'] = model.api_key || '';
    headers['anthropic-version'] = '2023-06-01';
  } else if (api === 'google-generative-ai') headers['x-goog-api-key'] = model.api_key || '';
  else if (model.api_key) headers.authorization = `Bearer ${model.api_key}`;
  let response: Response;
  try {
    response = await request(url, {
      method: 'POST', redirect: 'error', headers, body, signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new Error('模型验证失败：连接失败或请求超时。原 subagent 配置未更改。');
  }
  if (!response.ok) {
    const body = await response.arrayBuffer();
    const detail = response.status === 401 || response.status === 403 ? '鉴权失败，请检查当前 Being 连接或自定义密钥' : '请检查模型名称、接口与服务状态';
    throw new SubagentProbeError(`模型验证失败（HTTP ${response.status}）：${detail}。原 subagent 配置未更改。`, response.status, { url, body, contentType: response.headers.get('content-type') || 'application/octet-stream', statusText: response.statusText });
  }
  if (api === 'openai-completions') {
    let content = '', finished = false, done = false;
    try {
      const stream = await response.text();
      for (const event of stream.split(/\r?\n\r?\n/)) {
        const payload = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
        if (!payload) continue;
        if (payload === '[DONE]') { done = true; continue; }
        const data = JSON.parse(payload);
        if (data.error) throw new Error('stream error');
        const choice = data.choices?.[0];
        if (typeof choice?.delta?.content === 'string') content += choice.delta.content;
        if (choice?.finish_reason === 'stop') finished = true;
      }
    } catch { throw new Error('模型验证失败：流式响应出错或中断。原 subagent 配置未更改。'); }
    if (!done || !finished || !content.trim()) throw new Error('模型验证失败：未收到完整流式生成结果。原 subagent 配置未更改。');
    return;
  }
  let data;
  try { data = await response.json(); }
  catch { throw new Error('模型验证失败：接口未返回有效 JSON。原 subagent 配置未更改。'); }
  const text = api === 'anthropic-messages' ? data.content?.find((part: { type: string }) => part.type === 'text')?.text
    : api === 'google-generative-ai' ? data.candidates?.[0]?.content?.parts?.find((part: { text?: string }) => part.text)?.text
    : api === 'openai-responses' ? data.output?.find((item: { type: string }) => item.type === 'message')?.content?.find((part: { type: string }) => part.type === 'output_text')?.text
    : data.choices?.[0]?.message?.content;
  const completed = api === 'anthropic-messages' ? data.stop_reason === 'end_turn'
    : api === 'google-generative-ai' ? data.candidates?.[0]?.finishReason === 'STOP'
    : data.status === 'completed';
  if (data.error || !completed || typeof text !== 'string' || !text.trim()) throw new Error('模型验证失败：未收到完整生成结果。原 subagent 配置未更改。');
}
