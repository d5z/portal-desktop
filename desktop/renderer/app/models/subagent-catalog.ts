import type { LlmConfig, Preset } from '../../chat/models/chat';
const endpoints: Record<string, [string, string]> = {
  anthropic: ['https://api.anthropic.com', 'anthropic-messages'],
  openai: ['https://api.openai.com/v1', 'openai-responses'],
  'openai-responses': ['https://api.openai.com/v1', 'openai-responses'],
  openrouter: ['https://openrouter.ai/api/v1', 'openai-completions'],
  google: ['https://generativelanguage.googleapis.com/v1beta', 'google-generative-ai'],
  gemini: ['https://generativelanguage.googleapis.com/v1beta', 'google-generative-ai'],
  deepseek: ['https://api.deepseek.com', 'openai-completions'],
  kimi: ['https://api.moonshot.cn/v1', 'openai-completions'],
  glm: ['https://open.bigmodel.cn/api/paas/v4', 'openai-completions'],
};
export function subagentCatalog(config: LlmConfig): { presets: Preset[]; current?: Preset; copyBlockedReason?: string } {
  const convert = (preset: Preset): Preset | undefined => {
    if (preset.provider === 'self-hosted') return;
    const defaults = endpoints[preset.provider];
    const base_url = preset.base_url || defaults?.[0];
    const api = preset.api || defaults?.[1] || (base_url ? 'openai-completions' : undefined);
    if (!base_url || !api || !preset.model) return;
    // Remote saved keys are not local credentials. Only copy public connection fields.
    return { id: preset.id, label: preset.label, model: preset.model, provider: preset.provider, base_url, api };
  };
  const presets = (config.presets || []).flatMap(p => { const item = convert(p); return item ? [item] : []; });
  const selected = (config.presets || []).find(p => p.model === config.model && (!config.provider || p.provider === config.provider));
  const current = config.model ? convert({
    id: 'being-current', label: selected?.label || config.model, model: config.model,
    provider: config.provider || selected?.provider || 'custom',
    base_url: config.base_url || selected?.base_url, api: config.api || selected?.api,
  }) : undefined;
  const selfHosted = (config.provider || selected?.provider) === 'self-hosted';
  return { presets, current, ...(selfHosted ? { copyBlockedReason: 'Being 当前使用自部署模型，不能直接应用到 subagent。请为 subagent 单独选择并配置模型。' } : {}) };
}
