export const workDispatchReply = '收到各项启动回执后立即结束本轮，回复派发状态和可点击的任务标题。任务在后台继续执行，用户可以在同一主对话另发一条消息查询。派发轮只确认启动，不读取执行结果、不等待回执通知。';

export const workStages = {
  backlog: '待规划',
  todo: '待办',
  in_progress: '进行中',
  review: '待审核',
  blocked: '已阻塞',
  done: '已完成',
  cancelled: '已取消',
} as const;
export type WorkStage = keyof typeof workStages;
export const workPriorities = { none: '无', low: '低', medium: '中', high: '高', urgent: '紧急' } as const;

export type WorkModelSelection = { model: string; provider?: string };

export interface WorkGoalFields {
  title: string;
  outcome: string;
  acceptanceCriteria: string[];
  status: 'active' | 'done';
}

export interface WorkGoal extends WorkGoalFields {
  id: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  history: (Omit<WorkGoalFields, 'status'> & { version: number; at: number })[];
}

export interface WorkGoalRevision { goalId: string; version: number }
export function workGoalRevision(goal?: WorkGoal): WorkGoalRevision | undefined {
  return goal && { goalId: goal.id, version: goal.version };
}

export interface WorkPlanFields {
  goal?: string;
  specification?: string;
  acceptanceCriteria?: string[];
}

export interface WorkPlanVersion extends WorkPlanFields {
  version: number;
  title: string;
  description: string;
  at: number;
  source: 'user' | 'being';
}

export interface WorkDeliveryFile { source: string; path: string; name: string; sha256: string; bytes: number }
export interface WorkExecutionVersion {
  resultId: string;
  taskId: string;
  executor: string;
  at: number;
  status: WorkResult['status'];
  planVersion?: number;
  goalRevision?: WorkGoalRevision;
  deliveryVersion?: number;
  files?: WorkDeliveryFile[];
}

export interface WorkItemFields extends WorkPlanFields {
  title: string;
  description: string;
  projectId: string;
  executor: string;
  modelSelection?: WorkModelSelection | null;
  stage: WorkStage;
  priority: keyof typeof workPriorities;
  labels: string[];
  dueDate: string;
  parentId: string;
}

export interface WorkAssignee {
  townId: string;
  display?: string;
}

export interface WorkItem extends WorkItemFields {
  id: string;
  createdAt: number;
  updatedAt: number;
  runIds: string[];
  artifacts: string[];
  notes: { text: string; at: number }[];
  assignee?: WorkAssignee;
  stageHistory?: { from: WorkStage; to: WorkStage; at: number }[];
  planHistory?: WorkPlanVersion[];
  runPlans?: Record<string, number>;
  runGoals?: Record<string, WorkGoalRevision>;
  executions?: WorkExecutionVersion[];
  acceptedDeliveryVersion?: number;
  dispatch?: { id: string; sceneId: string; before: string; expiresAt: number; queued?: boolean; error?: string };
  launches?: WorkLaunch[];
  activeRun?: { taskId: string; submittedAt?: number };
  handoff?: WorkRule & { kind: 'review' };
  projectHandoffDisabled?: boolean;
  wakeup?: WorkRule & WorkWakeupTrigger;
}

export interface WorkLaunch {
  id: string;
  sceneId: string;
  status: 'starting' | 'started' | 'failed' | 'unconfirmed';
  taskId?: string;
  error?: string;
  recovery?: { key: string; executor: string; submittedAt: number; planVersion: number; goalRevision?: WorkGoalRevision; promptHash: string; nativeId?: string; portalAdmission?: string };
}

export type WorkWakeupTrigger = { kind: 'children_done' } | { kind: 'task_done'; itemId: string } | { kind: 'at'; at: number };
export type WorkRuleInput = { executor: string; instruction: string };
export interface WorkProjectRules { executor: string; handoff?: WorkRuleInput }
export interface WorkRule extends WorkRuleInput {
  id: string;
  sceneId: string;
  status: 'armed' | 'starting' | 'started' | 'failed';
  runId?: string;
  error?: string;
}

export interface WorkResult {
  id: string;
  taskId: string;
  sceneId: string;
  executor: string;
  status: 'done' | 'failed' | 'cancelled' | 'interrupted' | 'timeout' | 'budget_exhausted';
  title: string;
  summary: string;
  at: number;
  read?: boolean;
  delivered?: boolean;
  delivery?: { error: string; retryAt?: number };
  workItemId?: string;
  planVersion?: number;
  goalRevision?: WorkGoalRevision;
  deliveryVersion?: number;
  files?: WorkDeliveryFile[];
}

export function workPlanPrompt(item: WorkPlanFields, goal?: WorkGoal) {
  const sections = [goal && [`所属长期目标（v${goal.version}）：${goal.title}`, goal.outcome,
    goal.acceptanceCriteria.length && `长期目标的验收条件：\n${goal.acceptanceCriteria.map(value => `- ${value}`).join('\n')}`].filter(Boolean).join('\n'),
    item.goal && `任务目标：${item.goal}`, item.specification && `规格：${item.specification}`,
    item.acceptanceCriteria?.length && `验收标准：\n${item.acceptanceCriteria.map(value => `- ${value}`).join('\n')}`].filter(Boolean);
  if (!sections.length) return '';
  return [...sections, '有实际交付文件时，请在本轮最终回复中用 Markdown 文件链接列出本轮交付（建议使用文件绝对路径）。'].join('\n\n');
}

export function workContinuationPrompt(message: string, item: WorkPlanFields, goal?: WorkGoal) {
  const plan = workPlanPrompt(item, goal);
  return plan ? `${message}\n\n当前任务要求（仅作本轮工作背景）\n${plan}` : message;
}

export const workPlanVersionHeader = 'X-Work-Plan-Version';
export function workPlanVersionToken(version: number, goal?: WorkGoal) {
  return goal ? `${version}:${goal.id}:${goal.version}` : String(version);
}

export interface WorkResultPage {
  entries: WorkResult[];
  next: string;
  unread: number;
}
