import type { SubagentSetup } from './types';

/** The probe and its renderer-visible relay share the exact upstream request. */
export function subagentModelRequest(model: Pick<SubagentSetup, 'provider' | 'model' | 'base_url' | 'api'>) {
  const providers: Record<string, [string, string]> = {
    openai: ['https://api.openai.com/v1', 'openai-completions'],
    openrouter: ['https://openrouter.ai/api/v1', 'openai-completions'],
    anthropic: ['https://api.anthropic.com', 'anthropic-messages'],
    groq: ['https://api.groq.com/openai/v1', 'openai-completions'],
    xai: ['https://api.x.ai/v1', 'openai-completions'],
    google: ['https://generativelanguage.googleapis.com', 'google-generative-ai'],
    gemini: ['https://generativelanguage.googleapis.com', 'google-generative-ai'],
  };
  const [base, api] = model.provider === 'portal-custom' ? [model.base_url!, model.api!] : providers[model.provider];
  const route = api === 'anthropic-messages' ? '/v1/messages'
    : api === 'google-generative-ai' ? `/v1beta/models/${encodeURIComponent(model.model)}:generateContent`
    : api === 'openai-responses' ? '/responses' : '/chat/completions';
  const prompt = 'Reply with exactly OK.';
  let body: unknown;
  switch (api) {
    case 'anthropic-messages':
      body = { model: model.model, max_tokens: 2048, messages: [{ role: 'user', content: prompt }] };
      break;
    case 'google-generative-ai':
      body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 2048 } };
      break;
    case 'openai-responses':
      body = { model: model.model, input: prompt, max_output_tokens: 2048, store: false };
      break;
    default:
      // Validation checks connectivity, authentication and one complete
      // generation. It must not add an artificial large context that rejects
      // otherwise usable gateways before the configuration can be applied.
      body = { model: model.model, messages: [{ role: 'user', content: prompt }],
        tools: [{ type: 'function', function: { name: 'connection_check', description: 'Return a test marker; no side effects.', parameters: { type: 'object', properties: { marker: { type: 'string' } }, required: ['marker'] } } }],
        tool_choice: 'none', max_tokens: 64, stream: true, stream_options: { include_usage: true } };
  }
  return { api, url: base.replace(/\/+$/, '') + route, body: JSON.stringify(body) };
}
