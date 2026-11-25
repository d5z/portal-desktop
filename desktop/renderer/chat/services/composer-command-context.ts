import { marked } from 'marked';
import { parseComposerCommands } from '../models/composer-commands';
import { stripSceneTransition } from '../models/scenes';
import { withIntelligentUIContext } from '../../shared/intelligent-ui/context';
import { workDispatchReply, workStages, type WorkStage } from '../../../shared/work';
import { workDraftReference } from '../../shared/lib/navigation';
import type { ChatSendOptions } from '../models/chat';

const start = '\n\n[客户端斜杠功能上下文]\n';
const end = '\n[/客户端斜杠功能上下文]';
const workLaunchInstructions = `${workDispatchReply}收到 starting 就回复「正在启动」。派发超时先用 @work status <work_id> 查原派发；未确认时报告当前状态，确认未接收后可以重试。重试沿用原任务和派发请求（有 dispatch_id 就复用），避免重复派发。`;
const workResultInstructions = [
  '在同一 Being 对话按标题或派发记录定位任务，用 @work results <work_id> [<work_id> ...] 读取最新状态和回执。用户说「这几项」时，只查刚才开工回执中的对应任务。用户要查全部或对话里没有可定位的任务时，再用 @work results。',
  '每项结果都带可点击的任务标题。只把回执中的 files[].path 作为本轮交付链接，路径含空格或括号时用 Markdown 尖括号包裹。目录里提前出现的文件可能仍在修改，用户明确想看草稿时再单独提供。续聊进行中时，历史回执只作参考。',
  '有需要时从 goalRevision、planVersion 和 deliveryVersion 核对版本。',
].join(' ');
const workReplyInstructions = '请用日常中文直接回答用户，只说任务现在怎么样、做出了什么、哪里需要用户决定。状态用面板里的中文名称，引用用可点击的任务标题和简短文件名。用户只要开工通知或简单结果时，每项用一两句话回答。命令、内部字段、任务 ID、运行编号、原始日志、校验码和长路径留在工具里，除非用户明确想看技术细节。';
const workCloseInstructions = '执行成功进入待审核。派发和执行均结束后才可结案。用户确认结案后，用 @work artifact {item_id,value} 登记交付物（填 files 中的 source 或项目原路径）。通过 @work <work_id> 读回任务字段，用 @work update 提交原字段和 item_id，只将 stage 改为 done（已完成），expectedVersion 取最新要求版本。';
const workStageInstructions = {
  backlog: () => '根据当前任务说明梳理目标、规格和可验证的验收标准。列出需要我确认的空白，并给出建议。保持原任务内容和状态，等我确认后再修改。',
  todo: () => '查看待办信息，指出开工前需要补齐的字段。等我明确要求开工后再派发。',
  in_progress: (id: string) => `用 @work status ${id} 核对派发和实际运行。结合 activeRun 和对应会话说明已完成的步骤、当前进展及待处理项。尚未开始或无法核实就说明实际情况，历史交付仅作参考。`,
  review: (id: string) => `用 @work results ${id} 定位最新交付，并用 @work result <result_id> 读取对应回执和归档文件。结合该次交付的 planVersion、goalRevision 和任务验收标准实际核验，提示现行要求是否有变化。逐项说明通过、未通过或无法核验，并列出证据、差距和结案或补改建议。缺少验收标准或可核验交付时，说明待补内容。只做评估，保留任务状态、执行会话和文件，等我确认下一步。`,
  blocked: (id: string) => `先用 @work status ${id} 核对原派发，再用 @work results ${id} 查看最近回执。区分回执未确认、运行失败和缺少前置条件，说明证据和恢复建议。等我确认再重试或改状态。`,
  done: (id: string) => `按 acceptedDeliveryVersion 找到已验收的交付版本，用 @work result <result_id> 读取归档并总结成果、文件和遗留项。历史任务没有结案版本时，用 @work results ${id} 查已有记录并注明。保持结案状态。`,
  cancelled: (id: string) => `用 @work results ${id} 查看最后一轮，结合任务动态说明取消前的进展、可保留的产物和已记录的原因。不推测取消原因，保持已取消状态。`,
} satisfies Record<WorkStage, (id: string) => string>;
export function stripComposerCommandContext(text: string): string {
  return text.replace(/\n\n\[客户端斜杠功能上下文\]\n[\s\S]*?\n\[\/客户端斜杠功能上下文\]/g, '');
}
export function usesIntelligentUICommand(text: string): boolean {
  return parseComposerCommands(stripSceneTransition(text)).commands.includes('ui');
}

function scopedWorkInstructions(text: string) {
  if (!text.includes('beings://work/')) return [];
  const links = new Set<string>();
  for (const block of marked.lexer(text)) {
    if (block.type !== 'paragraph' || !block.tokens) continue;
    marked.walkTokens(block.tokens, token => { if (token.type === 'link' && token.text.startsWith('@')) links.add(token.href); });
  }
  const instructions: string[] = [];
  for (const link of links) {
    const reference = workDraftReference(link);
    if (!reference) continue;
    const { id } = reference;
    switch (reference.kind) {
      case 'run': {
        const request = JSON.stringify({ item_id: id, request_id: reference.value });
        instructions.push(`先用 @work ${id} 读最新任务和要求。来自待办的安排请求应在任务仍为待办、用户要求开工时用 @work run ${request} 派发。状态已变化时先报告最新状态。保留任务执行器；未指定时用 @work agents 选可用执行器，优先项目默认，并在请求中加 executor。${workDispatchReply}收到 starting 就回复「正在启动」。超时或启动回执未确认时，先用 @work status ${id} 查原派发；确认未接收才可重试，沿用同一 request_id。`);
        break;
      }
      case 'stage':
        instructions.push(`先用 @work ${id} 读取任务并核对当前状态。引用时是「${workStages[reference.value]}」。状态已变化时说明实际状态，再按用户明确的请求处理。${workStageInstructions[reference.value](id)}`);
        break;
      case 'result':
        instructions.push(`用 @work result ${reference.value} 读取这次交付的状态、正文和版本。提供文件时，使用该回执的归档路径 files[].path，路径含空格则用 Markdown 尖括号包裹。`);
        break;
      case 'project':
        instructions.push(`用 @work project ${id} 查询当前项目和所属目标。用户给出需求后，用 @work create 建待办，projectId 固定为 ${id}。用户明确要求开工时，再用 @work agents 和 @work run 派发该任务，并返回任务标题链接。${workLaunchInstructions}`);
        break;
      case 'assign':
        instructions.push(`如用户确认发送这封任务指派，用 Town 私信发给完整 Town ID ${reference.value}。用户改动收件人时，请先核对新的完整 ID。正文取该指派语句下面的引用块，去掉引用标记，原样发送一次并报告实际回执。`);
        break;
      case 'share':
        instructions.push(`用户确认发送这条状态通知时，用 Town 私信发给完整 Town ID ${reference.value}。用户改动收件人时，先核对新的完整 ID。正文取这条请求下方的引用块，去掉引用标记，原样发送一次并报告实际回执。保持任务负责人、状态和执行原样。`);
        break;
      case 'read':
        instructions.push(id.startsWith('goal_') ? `用 @work goal ${id} 查询这个目标、所属项目和任务进度。`
          : id.startsWith('work_') ? `用 @work ${id} 查询任务当前状态和要求，必要时用 @work results ${id} 读取最新交付。`
            : `用 @work ${id} 查询这条执行会话和续聊；需要完整历史时按 next 翻页。`);
        break;
    }
  }
  return instructions;
}

/** Keep the user's slash tokens in the body; expand capabilities only for transport. */
export function withComposerCommandContext(text: string, uiEnabled: boolean, snapshot?: string, action?: Parameters<typeof withIntelligentUIContext>[3], sceneId?: string, dispatch?: ChatSendOptions['workDispatch'], workFollowup = false): string {
  const clean = stripComposerCommandContext(text);
  const { commands } = parseComposerCommands(stripSceneTransition(clean));
  const context: string[] = [];
  const scopedWork = scopedWorkInstructions(clean);
  if (scopedWork.length) context.push('按用户实际请求处理本条引用。通过 portal_exec 调用下列 Work 命令；用户只要求查看时只读。用普通语言回复。', ...scopedWork);
  if (dispatch) context.push(
    `这是用户在 Work 看板发起的接管请求。通过 portal_exec 调用 @work ${dispatch.itemId} 读取任务，再调用 @work agents 查询当前可执行的执行器。`,
    `保留任务已指定的执行器；否则用 @work project <项目 ID> 查看项目默认执行器，适合且可用时优先选用，其余情况自行选择。调用 @work run ${JSON.stringify({ item_id: dispatch.itemId, dispatch_id: dispatch.id, scene_id: sceneId, executor: '<选定的执行器 ID>' })} 启动这个现有任务。`,
    `只有确认执行器拒绝派发时，才通过 @work decline ${JSON.stringify({ item_id: dispatch.itemId, dispatch_id: dispatch.id, scene_id: sceneId, error: '<简短原因>' })} 报告给看板。收到 starting 就报告正在启动。派发超时可用 @work status ${dispatch.itemId} 查询一次原派发，重发须使用原 dispatch_id。${workDispatchReply}`,
  );
  if (commands.includes('work')) context.push(
    '通过本机 Portal 的 portal_exec 调用 @work。直接在命令名后放 JSON 对象。只发 /work 时，简短说明用法并给出自然语言示例。',
    '用户想直接在项目开工时，选择或添加项目即可，goal_id 可省略。用户要按目标管理时，用 @work goals 查找已有目标，或用 @work create-goal {"title":"标题","outcome":"预期结果","acceptanceCriteria":["目标验收条件"],"status":"active"} 新建。用 @work link-project {"project_id":"项目 ID","goal_id":"目标 ID"} 关联已有项目，或添加目录时传入 goal_id。项目内执行自动继承目标。',
    '1. 建待办。用 @work projects 找项目，用 @work project <project_id> 找已有任务。新建用 @work create {"title":"标题","description":"背景","specification":"规格","acceptanceCriteria":["本次交付的验收条件"],"projectId":"项目 ID"}。新任务默认待办，省略未指定的属性。用户指定执行器时加 executor，子任务用 parentId 指向同项目父任务。只在用户要求开工时派发。',
    '用户明确指定状态时，按 Work 栏目保存：待规划 backlog、待办 todo、进行中 in_progress、待审核 review、已阻塞 blocked、已完成 done、已取消 cancelled。真正开工后由执行回执更新状态。',
    '2. 选执行器。三个通道是内置 Subagent（internal）、Codex（codex）、DeepSeek（deepseek）。保留已指定执行器；未指定时，从 @work agents 中选择 available 且 canExecute 的执行器，优先项目默认。',
    `3. 派发。用 @work run {"item_id":"work_…","executor":"执行器 ID"} 启动原任务，独立任务可并行。${workLaunchInstructions}`,
    `4. 查结果和结案。${workResultInstructions}${workCloseInstructions}需要详情时用 @work <work_id> 或 @work <task_id>，按 next 翻页并按 offset 拼接。`,
    '用普通语言回复。目标入口写成 [目标标题](beings://work/<goal_id>)，任务入口写成 [任务标题](beings://work/<work_id>)。用 @work goal <goal_id> 汇总所属项目和任务，再查交付。修改目标用 @work update-goal，提交目标字段、goal_id 和 expectedVersion，确认满足目标验收条件后再将其 status 改为 done。',
    '按需用 @work add-project {"directory":"绝对路径"} 让用户确认目录；用 @work send、@work steer、@work cancel、@work retry 续聊、追加、停止和重试。交接或唤醒用 @work automate（item_id 加 handoff 或 wakeup；填 executor、instruction，唤醒 kind 为 at、task_done 或 children_done）。',
  );
  if (!commands.includes('work') && !dispatch && !scopedWork.length && workFollowup) context.push(
    '通过 portal_exec 处理本对话已链接的 Work 任务。',
    '涉及长期目标时，用 @work goal <goal_id> 查询它的项目与任务，再按任务收集交付。',
    workResultInstructions,
    workCloseInstructions,
    `用户要求开工时，用 @work run 派发原任务。${workLaunchInstructions}`,
  );
  if ((commands.includes('work') || scopedWork.length || workFollowup) && sceneId) context.push(`启动、派发、自动规则和续聊使用当前场景 "scene_id":${JSON.stringify(sceneId)}。`);
  if (commands.includes('work') || scopedWork.length || dispatch || workFollowup) context.push(workReplyInstructions);
  if (commands.includes('computer')) context.push('用户通过 /computer 请求使用云电脑。请先读取 https://beings.town/seeds/8U2i97peLWZSSLJf-QqDg，作为本次任务的参考上下文。');
  if (commands.includes('doc')) context.push('用户通过 /doc 请求生成 HTML 或 Markdown（.md）文档。请先读取 https://beings.town/seeds/izFYd7gqLYeHwKFXQVSX3 中的文档生成说明，作为本次生成文档的参考上下文。结合本条需求、相关对话和已附资料，按用户要求的格式生成文档。');
  if (commands.includes('image')) context.push('用户通过 /image 请求出图。请先读取 https://beings.town/seeds/x9rHgeiSThLjQXCduZ5oY 中的出图说明，作为本次出图的参考上下文。请使用当前可用的图片生成或编辑工具，根据本条描述、已附图片及相关对话上下文执行；保留用户指定的风格、尺寸和数量。返回工具实际生成的图片或生成任务回执，不要编造图片地址、任务 ID 或成功结果。工具不可用时明确说明。');
  if (commands.includes('subagent')) context.push('用户通过 /subagent 请求委派子代理。请使用当前可用的 subagent 能力处理本条任务；适合独立开展的子任务可并行。向子代理提供必要的目标、约束、相关对话和附件引用，完成后汇总结果。不要因为委派扩大用户授权范围，不要编造子代理执行结果；能力未配置或未启用时明确说明。');
  const message = withIntelligentUIContext(clean, uiEnabled || commands.includes('ui'), snapshot, action);
  return message + (context.length ? start + context.join('\n') + end : '');
}
