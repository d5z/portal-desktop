import { parseComposerCommands } from '../models/composer-commands';
import { stripSceneTransition } from '../models/scenes';
import { withIntelligentUIContext } from '../../shared/intelligent-ui/context';
import { workDispatchReply } from '../../../shared/work';
import type { ChatSendOptions } from '../models/chat';

const start = '\n\n[客户端斜杠功能上下文]\n';
const end = '\n[/客户端斜杠功能上下文]';
const workLaunchInstructions = `${workDispatchReply}收到 starting 就回复「正在启动」。派发超时先用 @work status <work_id> 查原派发；未确认时报告当前状态，确认未接收后可以重试。重试沿用原任务和派发请求（有 dispatch_id 就复用），避免重复派发。`;
const workResultInstructions = '在同一 Being 对话按标题或派发记录定位任务，用 @work results <work_id> [<work_id> ...] 读取最新状态和回执。未指定任务时用 @work results。逐项给出状态、已验证结果和可点击的任务标题；分别从各自回执读取目标版本 goalRevision、任务要求版本 planVersion、交付版本 deliveryVersion 和归档路径 files[].path（Markdown 路径含空格时用尖括号）。续聊进行中时，报告当前进度，历史回执只作参考。';
const workCloseInstructions = '执行成功进入待审核。派发和执行均结束后才可结案。用户确认结案后，用 @work artifact {item_id,value} 登记交付物（填 files 中的 source 或项目原路径）。通过 @work <work_id> 读回任务字段，用 @work update 提交原字段和 item_id，只将 stage 改为 done（已完成），expectedVersion 取最新要求版本。';
export function stripComposerCommandContext(text: string): string {
  return text.replace(/\n\n\[客户端斜杠功能上下文\]\n[\s\S]*?\n\[\/客户端斜杠功能上下文\]/g, '');
}
export function usesIntelligentUICommand(text: string): boolean {
  return parseComposerCommands(stripSceneTransition(text)).commands.includes('ui');
}

/** Keep the user's slash tokens in the body; expand capabilities only for transport. */
export function withComposerCommandContext(text: string, uiEnabled: boolean, snapshot?: string, action?: Parameters<typeof withIntelligentUIContext>[3], sceneId?: string, dispatch?: ChatSendOptions['workDispatch'], workFollowup = false): string {
  const clean = stripComposerCommandContext(text);
  const { commands } = parseComposerCommands(stripSceneTransition(clean));
  const context: string[] = [];
  if (dispatch) context.push(
    `这是用户在 Work 看板发起的接管请求。通过 portal_exec 调用 @work ${dispatch.itemId} 读取任务，再调用 @work agents 查询当前可执行的执行器。`,
    `保留任务已指定的执行器；否则用 @work project <项目 ID> 查看项目默认执行器，适合且可用时优先选用，其余情况自行选择。调用 @work run ${JSON.stringify({ item_id: dispatch.itemId, dispatch_id: dispatch.id, scene_id: sceneId, executor: '<选定的执行器 ID>' })} 启动这个现有任务。`,
    `只有确认执行器拒绝派发时，才通过 @work decline ${JSON.stringify({ item_id: dispatch.itemId, dispatch_id: dispatch.id, scene_id: sceneId, error: '<简短原因>' })} 报告给看板。收到 starting 就报告正在启动。派发超时可用 @work status ${dispatch.itemId} 查询一次原派发，重发须使用原 dispatch_id。${workDispatchReply}`,
  );
  if (commands.includes('work')) context.push(
    '通过本机 Portal 的 portal_exec 调用 @work。直接在命令名后放 JSON 对象。只发 /work 时，简短说明用法并给出自然语言示例。',
    '用户想直接在项目开工时，选择或添加项目即可，goal_id 可省略。用户要按目标管理时，用 @work goals 查找已有目标，或用 @work create-goal {"title":"标题","outcome":"预期结果","acceptanceCriteria":["目标验收条件"],"status":"active"} 新建。用 @work link-project {"project_id":"项目 ID","goal_id":"目标 ID"} 关联已有项目，或添加目录时传入 goal_id。项目内执行自动继承目标。',
    '1. 建待办。用 @work projects 找项目，用 @work project <project_id> 找已有任务。新建用 @work create {"title":"标题","description":"背景","specification":"规格","acceptanceCriteria":["本次交付的验收条件"],"projectId":"项目 ID"}。新任务默认待办，省略未指定的属性。用户指定执行器时加 executor，子任务用 parentId 指向同项目父任务。只在用户要求开工时派发。',
    '2. 选执行器。三个通道是内置 Subagent（internal）、Codex（codex）、DeepSeek（deepseek）。保留已指定执行器；未指定时，从 @work agents 中选择 available 且 canExecute 的执行器，优先项目默认。',
    `3. 派发。用 @work run {"item_id":"work_…","executor":"执行器 ID"} 启动原任务，独立任务可并行。${workLaunchInstructions}`,
    `4. 查结果和结案。${workResultInstructions}${workCloseInstructions}需要详情时用 @work <work_id> 或 @work <task_id>，按 next 翻页并按 offset 拼接。`,
    '用普通语言回复。目标入口写成 [目标标题](beings://work/<goal_id>)，任务入口写成 [任务标题](beings://work/<work_id>)。用 @work goal <goal_id> 汇总所属项目和任务，再查交付。修改目标用 @work update-goal，提交目标字段、goal_id 和 expectedVersion，确认满足目标验收条件后再将其 status 改为 done。',
    '按需用 @work add-project {"directory":"绝对路径"} 让用户确认目录；用 @work send、@work steer、@work cancel、@work retry 续聊、追加、停止和重试。交接或唤醒用 @work automate（item_id 加 handoff 或 wakeup；填 executor、instruction，唤醒 kind 为 at、task_done 或 children_done）。',
  );
  if (!commands.includes('work') && !dispatch && workFollowup) context.push(
    '通过 portal_exec 处理本对话已链接的 Work 任务。',
    '涉及长期目标时，用 @work goal <goal_id> 查询它的项目与任务，再按任务收集交付。',
    workResultInstructions,
    workCloseInstructions,
    `用户要求开工时，用 @work run 派发原任务。${workLaunchInstructions}`,
  );
  if ((commands.includes('work') || workFollowup) && sceneId) context.push(`启动、派发、自动规则和续聊使用当前场景 "scene_id":${JSON.stringify(sceneId)}。`);
  if (commands.includes('computer')) context.push('用户通过 /computer 请求使用云电脑。请先读取 https://beings.town/seeds/8U2i97peLWZSSLJf-QqDg，作为本次任务的参考上下文。');
  if (commands.includes('doc')) context.push('用户通过 /doc 请求生成 HTML 或 Markdown（.md）文档。请先读取 https://beings.town/seeds/izFYd7gqLYeHwKFXQVSX3 中的文档生成说明，作为本次生成文档的参考上下文。结合本条需求、相关对话和已附资料，按用户要求的格式生成文档。');
  if (commands.includes('image')) context.push('用户通过 /image 请求出图。请先读取 https://beings.town/seeds/x9rHgeiSThLjQXCduZ5oY 中的出图说明，作为本次出图的参考上下文。请使用当前可用的图片生成或编辑工具，根据本条描述、已附图片及相关对话上下文执行；保留用户指定的风格、尺寸和数量。返回工具实际生成的图片或生成任务回执，不要编造图片地址、任务 ID 或成功结果。工具不可用时明确说明。');
  if (commands.includes('subagent')) context.push('用户通过 /subagent 请求委派子代理。请使用当前可用的 subagent 能力处理本条任务；适合独立开展的子任务可并行。向子代理提供必要的目标、约束、相关对话和附件引用，完成后汇总结果。不要因为委派扩大用户授权范围，不要编造子代理执行结果；能力未配置或未启用时明确说明。');
  const message = withIntelligentUIContext(clean, uiEnabled || commands.includes('ui'), snapshot, action);
  return message + (context.length ? start + context.join('\n') + end : '');
}
