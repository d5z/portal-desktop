import type { Settings } from '../../../shared/types';
import { resolveSubagentModel } from './subagent-model';
import type { DshModelCompatibility } from '../../../shared/dsh-plugins';

/** The current Being contract exposes configuration and conversational turns,
 * but no stateless generation endpoint accepting a plugin's system/messages. */
export async function inspectBeingModel(connected: boolean, request: (request: Request) => Promise<Response>): Promise<DshModelCompatibility> {
  if (!connected) return { supported: false, message: '尚未连接 Being，无法使用其当前模型。' };
  try {
    const response = await request(new Request('beings://chat/api/llm/config', { signal: AbortSignal.timeout(10000) }));
    if (!response.ok) return { supported: false, message: `无法读取 Being 当前模型（HTTP ${response.status}）；无法使用 Being 模型生成。` };
    const config = await response.json();
    if (typeof config.model !== 'string' || !config.model.trim()) return { supported: false, message: 'Being 尚未配置当前模型。' };
    return { model: config.model, supported: false, message: `Being 当前模型为 ${config.model}。现有接口仅支持主对话，尚不支持插件独立生成。` };
  } catch {
    return { supported: false, message: '暂时无法检查 Being 当前模型；请确认 Being 连接后重新打开插件设置。' };
  }
}

/** Priority is Being, then subagent. The current Being contract cannot generate
 * independently, so its checked result always explains why fallback is needed. */
export async function resolvePluginModel(directory: string, settings: Settings, connected: boolean, request: (request: Request) => Promise<Response>) {
  const being = await inspectBeingModel(connected, request);
  const fallback = await resolveSubagentModel(directory, settings);
  return { ...fallback, compatibility: { ...fallback.compatibility,
    message: being.message + (fallback.compatibility.supported ? ' 已回退到 subagent。' : ' ') + fallback.compatibility.message,
  } };
}
