import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'smol-toml';
import type { Settings } from '../../../shared/types';
import type { DshModelCompatibility, DshServiceConfig } from '../../../shared/dsh-plugins';

/** Read the existing Portal model at the host boundary. Never return its key to the renderer. */
export async function resolveSubagentModel(directory: string, settings: Settings, env = process.env): Promise<{ compatibility: DshModelCompatibility; services?: DshServiceConfig }> {
  const unavailable = (message: string) => ({ compatibility: { supported: false, message } });
  let document;
  try { document = parse(await readFile(settings.portalConfigPath || path.join(directory, 'subagent-portal.toml'), 'utf8')); }
  catch (error) {
    return unavailable((error as NodeJS.ErrnoException).code === 'ENOENT' ? '尚未配置 subagent 模型。' : '无法读取 subagent 配置，请检查本机 Portal 配置文件。');
  }
  const sub = document.subagent as { enabled?: boolean; model?: Record<string, unknown> } | undefined;
  if (sub?.enabled === false) return unavailable('subagent 已停用；插件不会使用其模型。');
  const model = sub?.model || {};
  const value = (key: string) => typeof model[key] === 'string' ? (model[key] as string).trim() : '';
  const provider = value('provider'), modelId = value('model');
  if (!provider || !modelId) return unavailable('尚未配置 subagent 模型。');
  const providers: Record<string, [string, string]> = {
    openai: ['https://api.openai.com/v1', 'OPENAI_API_KEY'],
    openrouter: ['https://openrouter.ai/api/v1', 'OPENROUTER_API_KEY'],
    groq: ['https://api.groq.com/openai/v1', 'GROQ_API_KEY'],
    xai: ['https://api.x.ai/v1', 'XAI_API_KEY'],
  };
  if (provider === 'portal-custom' ? value('api') !== 'openai-completions' : !providers[provider]) {
    return unavailable(`subagent 当前模型为 ${modelId}，其协议 ${value('api') || provider} 尚未适配插件生成。当前支持 OpenAI Chat Completions 兼容协议。`);
  }
  const baseUrl = provider === 'portal-custom' ? value('base_url').replace(/\/+$/, '') : providers[provider][0];
  let url: URL;
  try { url = new URL(baseUrl); } catch { return unavailable('subagent 模型接口地址无效。'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return unavailable('subagent 模型接口地址无效。');
  const apiKey = value('api_key') || env[provider === 'portal-custom' ? 'OPENAI_API_KEY' : providers[provider][1]] || '';
  if (/[\r\n\0]/.test(apiKey)) return unavailable('subagent 模型凭证格式无效。');
  if (!apiKey && provider !== 'portal-custom') return unavailable('subagent 未配置 API 密钥；插件暂不支持复用 OAuth 登录。');
  return {
    compatibility: { model: modelId, supported: true, message: `使用 subagent 当前模型 ${modelId}。插件生成会调用该模型 API；图片能力取决于模型本身，工具调用和语音转写尚未适配。` },
    services: { provider: 'openai-compatible', model: modelId, baseUrl, apiKey },
  };
}
