import { parseComposerCommands } from '../models/composer-commands';
import { stripSceneTransition } from '../models/scenes';
import { withIntelligentUIContext } from '../../shared/intelligent-ui/context';

const start = '\n\n[客户端斜杠功能上下文]\n';
const end = '\n[/客户端斜杠功能上下文]';
export function stripComposerCommandContext(text: string): string {
  return text.replace(/\n\n\[客户端斜杠功能上下文\]\n[\s\S]*?\n\[\/客户端斜杠功能上下文\]/g, '');
}
export function usesIntelligentUICommand(text: string): boolean {
  return parseComposerCommands(stripSceneTransition(text)).commands.includes('ui');
}

/** Keep the user's slash tokens in the body; expand capabilities only for transport. */
export function withComposerCommandContext(text: string, uiEnabled: boolean, snapshot?: string, action?: Parameters<typeof withIntelligentUIContext>[3]): string {
  const clean = stripComposerCommandContext(text);
  const { commands } = parseComposerCommands(stripSceneTransition(clean));
  const context: string[] = [];
  if (commands.includes('computer')) context.push('用户通过 /computer 请求使用云电脑。请先读取 https://beings.town/seeds/8U2i97peLWZSSLJf-QqDg，作为本次任务的参考上下文。');
  if (commands.includes('doc')) context.push('用户通过 /doc 请求生成 HTML 或 Markdown（.md）文档。请先读取 https://beings.town/seeds/izFYd7gqLYeHwKFXQVSX3 中的文档生成说明，作为本次生成文档的参考上下文。结合本条需求、相关对话和已附资料，按用户要求的格式生成文档。');
  if (commands.includes('image')) context.push('用户通过 /image 请求出图。请先读取 https://beings.town/seeds/x9rHgeiSThLjQXCduZ5oY 中的出图说明，作为本次出图的参考上下文。请使用当前可用的图片生成或编辑工具，根据本条描述、已附图片及相关对话上下文执行；保留用户指定的风格、尺寸和数量。返回工具实际生成的图片或生成任务回执，不要编造图片地址、任务 ID 或成功结果。工具不可用时明确说明。');
  if (commands.includes('subagent')) context.push('用户通过 /subagent 请求委派子代理。请使用当前可用的 subagent 能力处理本条任务；适合独立开展的子任务可并行。向子代理提供必要的目标、约束、相关对话和附件引用，完成后汇总结果。不要因为委派扩大用户授权范围，不要编造子代理执行结果；能力未配置或未启用时明确说明。');
  const message = withIntelligentUIContext(clean, uiEnabled || commands.includes('ui'), snapshot, action);
  return message + (context.length ? start + context.join('\n') + end : '');
}
