import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { SceneTask, SceneTaskSnapshot, SubagentStep, SubagentTaskDetail, WorkSnapshot } from '../../shared/types';
import { localFileReference } from '../../shared/local-file';
import { normalizeTownDisplay, validTownIdentity } from '../../shared/town-identity';
import { workDispatchReply, workGoalRevision, workPlanVersionHeader, workPlanVersionToken, workStages, workTaskRequirements, type WorkGoal, type WorkGoalRevision, type WorkItem, type WorkLaunch, type WorkProjectRules, type WorkResult, type WorkResultPage, type WorkRule, type WorkStage, type WorkWakeupTrigger } from '../../shared/work';
import { WorkProjects, directoryProject } from './work-projects';
import { WorkImports } from './work-imports';
import { managedNativeSessions, nativeSourceScenes, WorkItems, workItemFields, workModelSelection, workPlanVersion, type PendingWorkResult } from './work-items';
import { archiveWorkDeliveries, archiveWorkDelivery } from './work-deliveries';
import { AgentBridge, mergeProjects } from '../agent-bridge/registry';
import { AgentError, agentTaskId, type AgentTurn } from '../agent-bridge/types';

function setWorkStage(item: WorkItem, stage: WorkStage) {
  item.updatedAt = Date.now();
  if (item.stage === stage) return;
  if (stage === 'done') item.acceptedDeliveryVersion = item.executions?.filter(run => run.deliveryVersion).at(-1)?.deliveryVersion;
  else if (stage === 'in_progress') delete item.acceptedDeliveryVersion;
  (item.stageHistory ??= []).push({ from: item.stage, to: stage, at: item.updatedAt });
  item.stage = stage;
}

function recordWorkExecution(item: WorkItem, result: WorkResult) {
  const executions = item.executions ??= [];
  let run = executions.find(row => row.resultId === result.id);
  if (!run) {
    run = { resultId: result.id, taskId: result.taskId, status: result.status, executor: result.executor, at: result.at, planVersion: result.planVersion, goalRevision: result.goalRevision };
    executions.push(run);
  } else {
    run.planVersion ??= result.planVersion;
    run.goalRevision ??= result.goalRevision;
  }
  if (result.status === 'done') {
    run.deliveryVersion ??= Math.max(0, ...executions.map(row => row.deliveryVersion || 0)) + 1;
    if (result.files?.length) run.files = result.files;
    result.deliveryVersion = run.deliveryVersion;
  }
  result.workItemId = item.id;
}

function stageForResult(result?: WorkResult): WorkStage {
  return !result ? 'in_progress' : result.status === 'done' ? 'review' : result.status === 'cancelled' ? 'cancelled' : 'blocked';
}

function rootTaskId(taskId: string, tasks: Map<string, SceneTask>) {
  let task = tasks.get(taskId);
  while (task?.parentTaskId && tasks.has(task.parentTaskId)) task = tasks.get(task.parentTaskId);
  return task?.id || taskId;
}

const workSessionPath = /^\/api\/work\/sessions\/((?:sub_|agent_)[a-zA-Z0-9_-]{1,160})$/;
const workGoalPath = /^\/api\/work\/goals(?:\/(goal_[0-9a-f-]{36}))?$/;
const workProjectPath = /^\/api\/subagent\/projects(?:\/[a-zA-Z0-9_-]{1,160})?$/;

function workCommandPayload(raw: string) {
  const json = raw.trim();
  const value = JSON.parse(json.startsWith("'") && json.endsWith("'") ? json.slice(1, -1) : json);
  const payload = typeof value === 'string' ? JSON.parse(value) : value;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new AgentError('请在 Work 命令后传入 JSON 对象。', 400);
  return payload;
}

type RunVersions = Pick<WorkResult, 'planVersion' | 'goalRevision'>;
type LaunchTransport = RunVersions & { key?: string; onCreated?: (nativeId: string) => Promise<void>; onPortalSend?: (admission?: string) => Promise<void> };

/** Work reads the existing ledger; writes go to the selected Portal's bounded HTTP API. */
export class WorkNetwork {
  bridge?: AgentBridge;
  readTasks!: () => Promise<SceneTaskSnapshot>;
  readDetails!: (endpoint: string, ids: string[]) => Promise<SubagentTaskDetail[]>;
  chooseProject!: (suggestedDirectory?: string) => Promise<string | null>;
  sceneIds: () => string[] = () => [];
  private projects: WorkProjects;
  private imports: WorkImports;
  private items: WorkItems;
  private startingItems = new Map<string, string | undefined>();
  private collecting?: Promise<void>;
  private processingResults?: Promise<void>;
  private contexts = new Map<string, { endpoint: string; taskId: string; text: string; expires: number }>();
  private contextPage(snapshot: string, offset: number, endpoint: string) {
    const saved = this.contexts.get(snapshot);
    if (!saved || saved.endpoint !== endpoint || saved.expires < Date.now()) throw new Error('上下文快照已过期，请重新读取任务。');
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= saved.text.length) throw new Error('上下文页码无效。');
    const content = saved.text.slice(offset, offset + 12000);
    const nextOffset = offset + content.length;
    return JSON.stringify({ task_id: saved.taskId, snapshot, format: 'json', offset, totalCharacters: saved.text.length, content, next: nextOffset < saved.text.length ? `@work context ${JSON.stringify({ snapshot, offset: nextOffset })}` : null, note: '按 offset 顺序拼接 content 得到完整 JSON；继续读取 next，直到 next 为 null。快照保留 10 分钟。' });
  }
  private resultPage(results: WorkResult[], before?: string | null): WorkResultPage {
    const ordered = [...results].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
    const offset = before ? ordered.findIndex(row => row.id === before) + 1 : 0;
    const entries = ordered.slice(offset, offset + 50);
    return { entries, next: offset + entries.length < ordered.length ? entries.at(-1)!.id : '',
      unread: results.filter(row => !row.read).length };
  }
  private launchStatus(endpoint: string, item: WorkItem, lookup?: string) {
    const launch = lookup ? item.launches?.find(row => row.id === lookup) : item.launches?.at(-1);
    const active = this.startingItems.get(endpoint + ':' + item.id);
    const existing = (!launch && !lookup) || (lookup === 'initial' && (!launch || launch.status === 'failed')) ? item.runIds.at(-1) : undefined;
    const taskId = launch?.taskId || existing;
    const status = launch?.status === 'starting' && active !== launch.id ? 'unconfirmed'
      : existing ? 'started' : launch?.status || 'not_started';
    return { work_id: item.id, request_id: launch?.id, status, stage: item.stage, task_id: taskId, error: launch?.error };
  }
  constructor(private shellURL: () => string, private runtime: () => { directory: string; pid?: number; endpoint: string }, private fetcher: typeof fetch = fetch, private projectDirectory = path.join(runtime().directory, 'work-projects')) {
    this.projects = new WorkProjects(projectDirectory);
    this.imports = new WorkImports(path.join(projectDirectory, 'imports'));
    this.items = new WorkItems(path.join(projectDirectory, 'items'));
  }
  matches(pathname: string) { return pathname === '/api/work/imports' || pathname === '/api/work/agents' || workSessionPath.test(pathname) || workGoalPath.test(pathname) || workProjectPath.test(pathname) || /^\/api\/work\/agents\/[a-z][a-z0-9-]*\/connect$/.test(pathname) || /^\/api\/work\/(?:items(?:\/(?:batch|order)|\/work_[0-9a-f-]+(?:\/(?:dispatch|runs|notes|artifacts|automation|assignee))?)?|results(?:\/read)?)$/.test(pathname) || /^\/api\/subagent\/tasks(?:\/(?:sub_|agent_)[a-zA-Z0-9_-]{1,160}(?:\/(?:messages|cancel|steer|retry))?)?$/.test(pathname); }
  async snapshot(): Promise<WorkSnapshot> {
    const snapshot = await this.readTasks();
    const [selection, data] = await Promise.all([this.imports.read(snapshot.endpoint), this.items.read(snapshot.endpoint)]);
    const taskIds = managedNativeSessions(data);
    for (const id of selection.taskIds) taskIds.add(id);
    const external = await this.bridge?.snapshot([...taskIds]);
    const projectIds = new Set(selection.projectIds);
    const tasks = external?.tasks.filter(task => taskIds.has(task.id)) || [];
    for (const task of tasks) if (task.projectId) projectIds.add(task.projectId);
    const projects = mergeProjects(await this.projects.list(snapshot.endpoint), external?.projects.filter(project => projectIds.has(project.id)) || []);
    const associated = nativeSourceScenes(data);
    const items = data.items.map(item => {
      const launch = item.launches?.at(-1);
      return launch?.status === 'starting' && this.startingItems.get(snapshot.endpoint + ':' + item.id) !== launch.id
        ? { ...item, launches: [...item.launches!.slice(0, -1), { ...launch, status: 'unconfirmed' as const }] } : item;
    });
    const internalReady = !!snapshot.subagentReady;
    const runtime = this.runtime();
    const workCapability = internalReady && snapshot.endpoint === runtime.endpoint ? await this.portalCapability(runtime).catch(() => undefined) : undefined;
    return { ...snapshot, items, goals: data.goals || [], removedItemRunIds: data.removedItemRunIds, hiddenProjectSessionIds: data.hiddenProjectSessionIds, results: this.resultPage(data.results),
      agents: [{ id: 'internal', name: '内置 Subagent', available: internalReady, canExecute: internalReady,
        ...(workCapability?.images === true ? { capabilities: { attachments: 'image' as const } } : {}) }, ...(external?.agents || [])], projects,
      tasks: [...snapshot.tasks, ...tasks].map(task => ({ ...task, sceneId: task.sceneId || associated.get(task.id) || '',
        projectId: projects.find(project => project.directory === external?.projects.find(native => native.id === task.projectId)?.directory)?.id || (task.workdir ? directoryProject(projects, task.workdir)?.id : undefined) })) };
  }
  collectResults() {
    const runtime = this.runtime();
    if (!runtime.endpoint) return Promise.resolve();
    return this.refreshResults(runtime).then(() => {
      return this.processingResults ??= this.publishResults(runtime).finally(() => { this.processingResults = undefined; });
    });
  }
  private refreshResults(runtime: ReturnType<WorkNetwork['runtime']>) {
    if (this.collecting) return this.collecting;
    this.collecting = this.collect(runtime).finally(() => { this.collecting = undefined; });
    return this.collecting;
  }
  private async collect(runtime: ReturnType<WorkNetwork['runtime']>) {
    const { endpoint } = runtime;
    const internal = await this.readTasks();
    if (internal.endpoint !== endpoint) return;
    // Match a newly completed run against ownership saved before its dispatch.
    const data = await this.items.read(endpoint);
    const visibleNative = data.pending.length ? (await this.bridge?.snapshot(data.pending.map(row => row.taskId)))?.tasks || [] : [];
    const results: WorkResult[] = [];
    const known = new Set(data.results.map(row => row.id));
    const uncollected = internal.tasks.filter(task => task.endedAt && task.endedAt >= data.since && !known.has(task.id));
    const completed = uncollected.filter(task => task.status === 'done').slice(0, 200);
    const details = completed.length ? await this.readDetails(endpoint, completed.map(task => task.id)).catch(() => []) : [];
    const byTask = new Map(details.map(detail => [detail.taskId, detail]));
    for (const task of uncollected) {
      const detail = byTask.get(task.id);
      if (!this.resultStatus(task.status) || (task.status === 'done' && !detail)) continue;
      const summary = task.error || detail?.steps.filter(step => step.kind === 'message').at(-1)?.output || '';
      results.push({ id: task.id, taskId: task.id, sceneId: task.sceneId, executor: 'internal', status: task.status, title: task.brief || '内置 Subagent', summary, at: task.endedAt! });
    }
    const finished = new Set<string>();
    const nativeSubmissions = new Map<string, number>();
    for (const pending of data.pending) {
      const task = visibleNative.find(row => row.id === pending.taskId);
      // The running turn may be newer than the receipt we need to collect.
      if (!task || (!this.resultStatus(task.status) && (!pending.expectedTurn || task.activeTurnId === pending.expectedTurn))) continue;
      const detail = await this.detail(task, endpoint).catch(() => undefined);
      const turn = detail?.turns?.slice().reverse().find(({ task: run, steps }) => pending.expectedTurn
        ? run.id === pending.expectedTurn
        : steps.some(step => step.kind === 'started' && (pending.requestId
          ? step.requestId === pending.requestId
          : step.at >= pending.submittedAt - 1000 && step.input === pending.message)));
      if (!turn || !this.resultStatus(turn.task.status)) continue;
      finished.add(pending.taskId + ':' + pending.submittedAt);
      if (known.has(turn.task.id)) continue;
      known.add(turn.task.id);
      nativeSubmissions.set(turn.task.id, pending.submittedAt);
      results.push({ id: turn.task.id, taskId: task.id, sceneId: pending.sceneId, executor: task.executor!, planVersion: pending.planVersion, goalRevision: pending.goalRevision,
        status: turn.task.status, title: task.brief || task.executor!, at: turn.task.endedAt || Date.now(),
        summary: turn.task.error || turn.steps.filter(step => step.kind === 'message').at(-1)?.output || '' });
    }
    const runs = new Map([...internal.tasks, ...visibleNative].map(task => [task.id, task]));
    if (results.some(result => result.status === 'done')) {
      const projects = await this.projects.list(endpoint);
      await Promise.all(results.filter(result => result.status === 'done').map(async result => {
        const root = rootTaskId(result.taskId, runs);
        const session = runs.get(root)?.session;
        const item = data.items.find(row => row.runIds.includes(root) || row.launches?.some(launch => {
          const recovery = launch.recovery;
          return recovery && (recovery.executor === 'internal' ? session === `work-${recovery.key}`
            : recovery.nativeId && root === agentTaskId(recovery.executor, recovery.nativeId));
        }));
        const directory = projects.find(row => row.id === item?.projectId)?.directory || runs.get(result.taskId)?.workdir;
        if (!item || !directory) return;
        const files = await archiveWorkDeliveries(path.join(this.projectDirectory, 'deliveries'), directory, result.summary);
        if (files.length) result.files = files;
      }));
    }
    if (results.length || finished.size) await this.items.update(endpoint, current => {
      const recorded = new Set(current.results.map(row => row.id));
      for (const result of results) {
        if (recorded.has(result.id)) continue;
        const root = rootTaskId(result.taskId, runs);
        const owner = current.items.find(row => row.runIds.includes(root));
        if (owner) {
          result.planVersion ??= owner.runPlans?.[result.taskId];
          if (result.executor === 'internal') result.goalRevision ??= owner.runGoals?.[result.taskId];
          recordWorkExecution(owner, result);
        }
        current.results.push(result);
      }
      current.pending = current.pending.filter(row => !finished.has(row.taskId + ':' + row.submittedAt));
      for (const item of current.items) {
        if (item.stage !== 'in_progress') continue;
        const root = item.runIds.at(-1);
        const active = item.activeRun;
        const outcome = results.filter(result => active
          ? result.taskId === active.taskId && (active.submittedAt === undefined || nativeSubmissions.get(result.id) === active.submittedAt)
          : rootTaskId(result.taskId, runs) === root).sort((a, b) => b.at - a.at)[0];
        if (outcome) setWorkStage(item, stageForResult(outcome));
      }
    });
  }
  private async publishResults(runtime: ReturnType<WorkNetwork['runtime']>) {
    const { endpoint } = runtime;
    if (this.runtime().endpoint !== endpoint) return;
    await this.dispatchRules(endpoint);
    const { results } = await this.items.read(endpoint);
    const scheduled = results.filter(row => row.executor !== 'internal' && row.status !== 'cancelled' && !row.delivered &&
      (!row.delivery || (row.delivery.retryAt !== undefined && row.delivery.retryAt <= Date.now()))).slice(0, 10);
    const deliveries = await Promise.all(scheduled.map(async result => {
      const payload = { task_id: result.taskId, event_id: result.id, scene_id: result.sceneId, executor: result.executor,
        title: result.title.slice(0, 200), status: result.status, summary: result.summary.slice(-2000) };
      const response = await this.portalRequest(runtime, '/api/subagent/results', payload, AbortSignal.timeout(30_000), {}).catch(() => undefined);
      const status = response?.status;
      const retry = status === undefined || status >= 500 || status === 408 || status === 409 || status === 429;
      const error = status ? `回执送达失败（HTTP ${status}）` : '无法连接 Portal 回执接口';
      return { id: result.id, delivered: !!response?.ok, delivery: response?.ok ? undefined : { error, retryAt: retry ? Date.now() + 30_000 : undefined } };
    }));
    if (deliveries.length) await this.items.update(endpoint, current => {
      for (const { id, ...delivery } of deliveries) Object.assign(current.results.find(row => row.id === id)!, delivery);
    });
  }
  private resultStatus(status: SceneTask['status']): status is WorkResult['status'] {
    return status !== 'queued' && status !== 'running' && status !== 'unknown';
  }

  private async recordContinuation(endpoint: string, root: string, taskId: string, { planVersion, goalRevision }: RunVersions, pending?: PendingWorkResult) {
    await this.items.update(endpoint, data => {
      const item = data.items.find(row => row.runIds.includes(root));
      if (pending) data.pending.push({ ...pending, planVersion, goalRevision, sceneId: nativeSourceScenes(data).get(taskId) || pending.sceneId });
      if (!item) return;
      if (!pending && planVersion) (item.runPlans ??= {})[taskId] = planVersion;
      if (!pending && goalRevision) (item.runGoals ??= {})[taskId] = goalRevision;
      item.activeRun = { taskId, submittedAt: pending?.submittedAt };
      const outcome = pending ? undefined : data.results.find(result => result.taskId === taskId);
      if (outcome) {
        outcome.planVersion ??= planVersion;
        outcome.goalRevision ??= goalRevision;
        recordWorkExecution(item, outcome);
      }
      setWorkStage(item, stageForResult(outcome));
    });
  }

  private awaitingResult(item: WorkItem, data: Awaited<ReturnType<WorkItems['read']>>) {
    const active = item.activeRun;
    return active && (active.taskId.startsWith('agent_') ? data.pending.some(row => row.taskId === active.taskId
      && (active.submittedAt === undefined || row.submittedAt === active.submittedAt))
      : !data.results.some(row => row.taskId === active.taskId));
  }

  private checkClose(endpoint: string, item: WorkItem, stage: WorkStage, data: Awaited<ReturnType<WorkItems['read']>>) {
    if (stage !== 'done' || item.stage === stage) return;
    if (this.startingItems.has(endpoint + ':' + item.id) || ['starting', 'unconfirmed'].includes(item.launches?.at(-1)?.status || '') ||
        (item.dispatch && !item.dispatch.error && item.dispatch.expiresAt > Date.now()) || this.awaitingResult(item, data))
      throw new AgentError('请先确认派发并等待执行结束、收集交付后再结案。', 409);
  }

  private async requireCollectedRun(endpoint: string, root: string) {
    const data = await this.items.read(endpoint);
    const owner = data.items.find(item => item.runIds.includes(root));
    const activeTask = owner?.activeRun?.taskId;
    if (owner && (owner.goal || owner.specification || owner.acceptanceCriteria?.length ||
        (activeTask && (owner.runGoals?.[activeTask] || data.pending.some(row => row.taskId === activeTask && row.goalRevision)))) && this.awaitingResult(owner, data))
      throw new AgentError('请等待上一轮结束并收集交付，再开始下一轮。', 409);
    return owner;
  }

  private async withContinuation<T>(endpoint: string, root: string, submit: (owner?: WorkItem, goal?: WorkGoal) => Promise<T>) {
    const owner = await this.requireCollectedRun(endpoint, root);
    if (!owner) return submit();
    const key = endpoint + ':' + owner.id;
    if (this.startingItems.has(key)) throw new AgentError('工作正在启动，请稍后续聊。', 409);
    this.startingItems.set(key, undefined);
    try {
      const [projects, data] = await Promise.all([this.projects.list(endpoint), this.items.read(endpoint)]);
      const project = projects.find(row => row.id === owner.projectId);
      return await submit(owner, data.goals?.find(goal => goal.id === project?.goalId));
    }
    finally { this.startingItems.delete(key); }
  }

  private continuationVersions(owner: WorkItem | undefined, goal: WorkGoal | undefined, request: Request): RunVersions {
    const selected = request.headers.get(workPlanVersionHeader);
    const planVersion = owner ? owner.planHistory?.at(-1)?.version || 1 : undefined;
    if (selected !== null && (!planVersion || selected !== workPlanVersionToken(planVersion, goal))) throw new AgentError('目标或任务要求已更新，请同步后重试。', 409);
    return { planVersion, goalRevision: workGoalRevision(goal) };
  }

  private async continueNative(endpoint: string, task: SceneTask, sceneId: string, message: string, request: Request, retry = false) {
    await this.withContinuation(endpoint, task.id, async (owner, goal) => {
      const versions = retry ? owner?.executions?.filter(run => run.taskId === task.id).at(-1) || {} : this.continuationVersions(owner, goal, request);
      if (Buffer.byteLength(message) > 16000) throw new AgentError('续聊内容过长，请缩短后重试。', 400);
      const submittedAt = Date.now();
      const turn: AgentTurn | void = await this.bridge!.send(task, message);
      const pending = {
        taskId: task.id, sceneId, message, submittedAt,
        ...(turn && ('turnId' in turn ? { expectedTurn: task.id + ':' + turn.turnId } : { requestId: turn.requestId })),
      };
      await this.recordContinuation(endpoint, task.id, task.id, versions, pending);
    });
  }

  private async saveAutomation(endpoint: string, item: WorkItem, input: unknown, headers: Record<string, string>) {
    const body = input as { scene_id?: unknown; handoff?: unknown; wakeup?: unknown } | null;
    const sceneId = body?.scene_id;
    if (typeof sceneId !== 'string' || !this.sceneIds().includes(sceneId)) throw new AgentError('请选择当前客户端对话。', 400);
    if (!body || (!Object.hasOwn(body, 'handoff') && !Object.hasOwn(body, 'wakeup')))
      throw new AgentError('请指定要配置的交接或唤醒。', 400);
    const snapshot = await this.snapshot();
    const validate = (raw: unknown) => {
      const rule = raw as { executor?: unknown; instruction?: unknown };
      if (!rule || typeof rule.executor !== 'string' || !snapshot.agents?.some(agent => agent.id === rule.executor) ||
        typeof rule.instruction !== 'string' || !rule.instruction.trim() || rule.instruction.length > 1000)
        throw new AgentError('请选择执行器并填写本轮指令。', 400);
      return { id: randomUUID(), executor: rule.executor, instruction: rule.instruction.trim(), sceneId, status: 'armed' } satisfies WorkRule;
    };
    const handoff = body.handoff == null ? body.handoff : { ...validate(body.handoff), kind: 'review' as const };
    let wakeup: WorkItem['wakeup'];
    if (body.wakeup != null) {
      const trigger = body.wakeup as Partial<WorkWakeupTrigger>;
      const rule = validate(body.wakeup);
      if (trigger.kind === 'at' && typeof trigger.at === 'number' && Number.isFinite(trigger.at) && trigger.at > Date.now()) {
        wakeup = { ...rule, kind: 'at', at: trigger.at };
      } else if (trigger.kind === 'children_done') {
        wakeup = { ...rule, kind: 'children_done' };
      } else if (trigger.kind === 'task_done' && typeof trigger.itemId === 'string' && trigger.itemId !== item.id &&
        snapshot.items?.some(row => row.id === trigger.itemId && row.projectId === item.projectId)) {
        wakeup = { ...rule, kind: 'task_done', itemId: trigger.itemId };
      } else throw new AgentError('请选择未来时间、同项目的其他任务或全部子任务。', 400);
    }
    const saved = await this.items.update(endpoint, state => {
      const current = state.items.find(row => row.id === item.id)!;
      if (this.startingItems.has(endpoint + ':' + item.id)) throw new AgentError('任务正在启动，请稍后修改自动规则。', 409);
      if ((handoff || wakeup) && !snapshot.projects.some(project => project.id === current.projectId))
        throw new AgentError('请先选择任务项目。', 400);
      if (Object.hasOwn(body, 'handoff')) {
        current.handoff = handoff || undefined;
        current.projectHandoffDisabled = !handoff;
      }
      if (Object.hasOwn(body, 'wakeup')) current.wakeup = wakeup;
      current.updatedAt = Date.now();
      return current;
    });
    return Response.json(saved, { headers });
  }

  private eligibleRule(item: WorkItem, rows: WorkItem[], key: 'handoff' | 'wakeup') {
    if (key === 'handoff') return item.stage === 'review';
    if (!item.wakeup || (item.stage !== 'todo' && item.stage !== 'blocked')) return false;
    const rule = item.wakeup;
    if (rule.kind === 'at') return rule.at <= Date.now();
    if (rule.kind === 'task_done') return rows.some(row => row.id === rule.itemId && row.projectId === item.projectId && row.stage === 'done');
    const children = rows.filter(row => row.parentId === item.id);
    return children.length > 0 && children.every(row => row.stage === 'done');
  }

  private async dispatchRules(endpoint: string) {
    const state = await this.items.read(endpoint);
    for (const item of state.items) {
      if (this.startingItems.has(endpoint + ':' + item.id)) continue;
      for (const key of ['handoff', 'wakeup'] as const) {
        const rule = item[key];
        if (!rule || (rule.status !== 'starting' && (rule.status !== 'armed' || !this.eligibleRule(item, state.items, key)))) continue;
        let failure = '上次启动时客户端退出，请核对运行记录后重新启用。';
        if (rule.status === 'armed') {
          if (!this.sceneIds().includes(rule.sceneId)) failure = '来源对话已不可用，请从当前对话重新启用。';
          else {
            const dependency = item.wakeup?.kind === 'task_done' ? item.wakeup.itemId : '';
            const related = key === 'handoff' ? [item] : state.items.filter(row => dependency ? row.id === dependency : row.parentId === item.id);
            const context = JSON.stringify(related.slice(0, 4).map(row => {
              const taskId = row.runIds.at(-1);
              const outcome = state.results.filter(result => result.taskId === taskId).at(-1);
              return { work_id: row.id, title: row.title.slice(0, 100), stage: row.stage, task_id: taskId, result: outcome?.summary.slice(-300) };
            }));
            try {
              const response = await this.startItem(endpoint, item.id, rule.sceneId, AbortSignal.timeout(30_000), {}, { key, rule, context });
              if (response.ok) continue;
              const body = await response.text();
              failure = `启动失败（${response.status}）${body ? '：' + body.slice(0, 240) : ''}`;
            } catch (error) {
              if (error instanceof AgentError && error.status === 409) continue;
              failure = (error as Error).message;
            }
          }
        }
        await this.items.update(endpoint, current => {
          const saved = current.items.find(row => row.id === item.id)?.[key];
          if (saved?.id === rule.id && (saved.status === 'armed' || saved.status === 'starting')) {
            saved.status = 'failed';
            saved.error = failure;
          }
        });
      }
    }
  }
  private async portalCapability(runtime: ReturnType<WorkNetwork['runtime']>) {
    const [ready, capability] = await Promise.all(['.portal-ready.json', '.portal-work.json'].map(file => readFile(path.join(runtime.directory, file), 'utf8').then(JSON.parse)));
    if (!runtime.pid || ready.pid !== runtime.pid || capability.pid !== runtime.pid || !ready.nonce || capability.nonce !== ready.nonce ||
        !Number.isInteger(capability.port) || capability.port < 1 || capability.port > 65535 || typeof capability.token !== 'string') return;
    return capability;
  }
  private async portalRequest(runtime: ReturnType<WorkNetwork['runtime']>, pathname: string, input: object, signal: AbortSignal, headers: Record<string, string>, launch?: LaunchTransport) {
    const capability = await this.portalCapability(runtime);
    if (!capability) return Response.json({ error: '当前 Portal 未提供 Work 接口，请重启 Portal。' }, { status: 503, headers });
    const current = this.runtime();
    if (current.endpoint !== runtime.endpoint || current.pid !== runtime.pid) return Response.json({ error: 'Portal 已切换，请重试。' }, { status: 409, headers });
    if (launch?.onPortalSend) await launch.onPortalSend(typeof capability.launchAdmission === 'string' && capability.launchAdmission || undefined);
    const response = await this.fetcher(`http://127.0.0.1:${capability.port}${pathname}`, {
      method: 'POST', body: JSON.stringify(input), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${capability.token}`,
        ...(launch?.key ? { 'X-Work-Launch': launch.key } : {}) },
      signal, redirect: 'error',
    });
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: {
      ...headers, 'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream',
    } });
  }

  private async itemRequest(request: Request, pathname: string, endpoint: string, headers: Record<string, string>): Promise<Response> {
    const [, , , , id, action] = pathname.split('/');
    const data = await this.items.read(endpoint);
    if (id?.startsWith('work_') && !action && request.method === 'DELETE') {
      const item = data.items.find(row => row.id === id);
      if (!item) throw new AgentError('工作不存在。', 404);
      const tasks = item.runIds.some(run => run.startsWith('sub_')) ? (await this.readTasks()).tasks : [];
      const byId = new Map(tasks.map(task => [task.id, task]));
      await this.items.update(endpoint, current => {
        const saved = current.items.find(row => row.id === id);
        if (!saved) throw new AgentError('工作不存在。', 404);
        const runs = new Set(saved.runIds);
        const launch = saved.launches?.at(-1);
        const dispatch = saved.dispatch;
        if (this.startingItems.has(endpoint + ':' + id) || launch?.status === 'starting' || launch?.status === 'unconfirmed' ||
          (dispatch && !dispatch.error && dispatch.expiresAt > Date.now()) || current.pending.some(row => runs.has(row.taskId)) ||
          tasks.some(task => (task.status === 'running' || task.status === 'queued') && runs.has(rootTaskId(task.id, byId))))
          throw new AgentError('请等派发或执行结束后再删除任务。', 409);
        for (const row of current.items) {
          if (row.parentId === id) {
            row.parentId = saved.parentId;
            row.updatedAt = Date.now();
          }
          if (row.wakeup?.kind === 'task_done' && row.wakeup.itemId === id && row.wakeup.status === 'armed') {
            row.wakeup.status = 'failed';
            row.wakeup.error = '作为唤醒条件的任务已删除。';
          }
        }
        current.items.splice(current.items.indexOf(saved), 1);
        if (runs.size) current.removedItemRunIds = [...new Set([...(current.removedItemRunIds || []), ...runs])];
      });
      return Response.json({ id }, { headers });
    }
    if (id === 'order' && request.method === 'POST') {
      const input = await request.json();
      if (typeof input?.id !== 'string' || typeof input?.before !== 'string' || input.id === input.before ||
        typeof input.stage !== 'string' || !Object.hasOwn(workStages, input.stage)) throw new AgentError('请选择有效的任务位置。', 400);
      const updated = await this.items.update(endpoint, current => {
        const item = current.items.find(row => row.id === input.id);
        const before = current.items.find(row => row.id === input.before && row.stage === input.stage);
        if (!item || (input.before && !before)) throw new AgentError('任务或目标位置已变化。', 409);
        this.checkClose(endpoint, item, input.stage, current);
        current.items.splice(current.items.indexOf(item), 1);
        if (item.stage !== input.stage) delete item.dispatch;
        setWorkStage(item, input.stage);
        if (before) current.items.splice(current.items.indexOf(before), 0, item);
        else current.items.push(item);
        return item;
      });
      return Response.json(updated, { headers });
    }
    if (id === 'batch' && request.method === 'POST') {
      const { ids, stage } = await request.json();
      if (!Array.isArray(ids) || !ids.length || ids.length > 200 || !ids.every(id => typeof id === 'string') ||
        typeof stage !== 'string' || !Object.hasOwn(workStages, stage)) throw new AgentError('请选择工作与目标状态。', 400);
      const wanted = new Set(ids);
      const updated = await this.items.update(endpoint, current => {
        const items = current.items.filter(item => wanted.has(item.id));
        if (items.length !== wanted.size) throw new AgentError('部分工作已不存在。', 404);
        for (const item of items) {
          this.checkClose(endpoint, item, stage as WorkStage, current);
          if (item.stage !== stage) delete item.dispatch;
          setWorkStage(item, stage as WorkStage);
        }
        return items;
      });
      return Response.json(updated, { headers });
    }
    if (request.method === 'GET' && !action) {
      if (!id) return Response.json(data.items, { headers });
      const item = data.items.find(row => row.id === id);
      return item ? Response.json(item, { headers }) : Response.json({ error: '工作不存在。' }, { status: 404, headers });
    }
    if (request.method === 'GET' && action === 'dispatch') {
      const item = data.items.find(row => row.id === id);
      if (!item) throw new AgentError('工作不存在。', 404);
      return Response.json(await this.recoverLaunch(endpoint, item), { headers });
    }
    if (!action && (request.method === 'POST' && !id || request.method === 'PATCH' && id)) {
      const input = await request.json();
      const fields = workItemFields(request.method === 'POST' ? {
        description: '', projectId: '', executor: '', stage: 'todo', priority: 'none', labels: [], dueDate: '', parentId: '', ...input,
      } : input);
      const source = request.headers.has('X-Work-Scene') ? 'being' : 'user';
      const snapshot = await this.snapshot();
      if (fields.projectId && !snapshot.projects.some(project => project.id === fields.projectId))
        throw new AgentError('请选择可用的 Work 项目。', 400);
      if (fields.executor && !snapshot.agents?.some(agent => agent.id === fields.executor)) throw new AgentError('请选择执行器。', 400);
      if (!id) return Response.json(await this.items.create(endpoint, fields, source), { status: 201, headers });
      const updated = await this.items.update(endpoint, current => {
        const item = current.items.find(row => row.id === id);
        if (!item) throw new AgentError('工作不存在。', 404);
        if (input.expectedStage !== undefined && item.stage !== input.expectedStage)
          throw new AgentError('任务状态已变化，请关闭编辑后重新查看。', 409);
        if (this.startingItems.has(endpoint + ':' + id)) throw new AgentError('工作正在启动，请稍后修改。', 409);
        if (item.runIds.length && fields.projectId !== item.projectId) throw new AgentError('已有运行记录的工作不能更改项目目录。', 409);
        if (fields.projectId !== item.projectId && (item.handoff?.status === 'armed' || item.wakeup?.status === 'armed'))
          throw new AgentError('请先移除待触发的自动规则，再更改项目目录。', 409);
        if (fields.parentId) {
          let ancestor: (typeof current.items)[number] | undefined = current.items.find(row => row.id === fields.parentId && row.projectId === fields.projectId);
          if (!ancestor) throw new AgentError('请选择同项目中的父任务。', 400);
          while (ancestor) {
            if (ancestor.id === id) throw new AgentError('父任务不能指向自己或自己的子任务。', 409);
            const parentId: string = ancestor.parentId;
            ancestor = current.items.find(row => row.id === parentId);
          }
        }
        if (fields.projectId !== item.projectId && current.items.some(row => row.parentId === id))
          throw new AgentError('请先移除或移动子任务。', 409);
        this.checkClose(endpoint, item, fields.stage, current);
        if (item.stage !== fields.stage || item.projectId !== fields.projectId) delete item.dispatch;
        if (item.executor !== fields.executor) delete item.modelSelection;
        const version = item.planHistory?.at(-1)?.version || 1;
        if (input.expectedVersion !== undefined && input.expectedVersion !== version)
          throw new AgentError('任务要求已更新，请重新打开任务再编辑。', 409);
        const at = Date.now();
        const before = workPlanVersion(item, version, at, source);
        const after = workPlanVersion({ ...item, ...fields }, version, at, source);
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          (item.planHistory ??= [workPlanVersion(item, 1, item.createdAt, 'user')]).push({ ...after, version: version + 1 });
        }
        setWorkStage(item, fields.stage);
        Object.assign(item, fields);
        return item;
      });
      return Response.json(updated, { headers });
    }
    if (action === 'assignee') {
      if (request.method !== 'PATCH') return new Response(null, { status: 405, headers });
      const input = await request.json();
      const assignee = input?.assignee;
      if (assignee !== null && (!validTownIdentity(assignee?.townId) || !assignee.townId.startsWith('t_')))
        throw new AgentError('请选择其他 Being，或填写完整的 Town ID。', 400);
      const updated = await this.items.update(endpoint, current => {
        const item = current.items.find(row => row.id === id);
        if (!item) throw new AgentError('工作不存在。', 404);
        if (assignee === null) delete item.assignee;
        else item.assignee = { townId: assignee.townId, display: normalizeTownDisplay(assignee.display) || undefined };
        item.updatedAt = Date.now();
        return item;
      });
      return Response.json(updated, { headers });
    }
    if (!action || (request.method !== 'POST' && !(action === 'dispatch' && request.method === 'PATCH')))
      return new Response(null, { status: 405, headers });
    const item = data.items.find(row => row.id === id);
    if (!item) throw new AgentError('工作不存在。', 404);
    const input = await request.json();
    if (action === 'dispatch' && request.method === 'PATCH') {
      const declined = typeof input?.error === 'string' && input.error.trim() && input.error.length <= 240;
      if (typeof input?.dispatch_id !== 'string' || (typeof input.queued !== 'boolean' && !declined)) throw new AgentError('接管回执无效。', 400);
      await this.items.update(endpoint, state => {
        const dispatch = state.items.find(row => row.id === id)?.dispatch;
        const launch = state.items.find(row => row.id === id)?.launches?.find(row => row.id === input.dispatch_id);
        if (!dispatch || dispatch.id !== input.dispatch_id || (launch && launch.status !== 'failed')) return;
        if (declined) {
          if (dispatch.sceneId !== input.scene_id) throw new AgentError('请在任务来源对话报告派发结果。', 409);
          dispatch.error = input.error.trim();
        } else if (input.queued) {
          dispatch.queued = true;
          dispatch.expiresAt = Date.now() + 5 * 60_000;
        } else if (!dispatch.queued) dispatch.error = 'Being 对话未接收请求，可以重新派发。';
      });
      return Response.json({ id }, { headers });
    }
    if (action === 'notes' || action === 'artifacts') {
      let value = typeof input?.value === 'string' ? input.value.trim() : '';
      if (!value || value.length > (action === 'notes' ? 8000 : 2048)) throw new AgentError('请输入有效内容。', 400);
      let archive: Awaited<ReturnType<typeof archiveWorkDelivery>>;
      const lastResult = item.stage !== 'in_progress' ? item.executions?.at(-1) : undefined;
      if (action === 'artifacts' && input.result_id !== undefined && (!lastResult || input.result_id !== lastResult.resultId))
        throw new AgentError('只能给最新已结束的执行登记新交付。', 409);
      if (action === 'artifacts') {
        if (/^file:/i.test(value)) value = localFileReference(value) || value;
        const url = path.isAbsolute(value) ? null : URL.parse(value);
        if (url) {
          if (url.protocol !== 'https:' || url.username || url.password) throw new AgentError('请输入 HTTPS 链接或项目内的文件路径。', 400);
          value = url.href;
        } else {
          const project = (await this.snapshot()).projects.find(row => row.id === item.projectId);
          if (!project) throw new AgentError('请先选择项目目录。', 400);
          const file = await realpath(path.resolve(project.directory, value)).catch(() => '');
          if (!file || !directoryProject([project], file) || !(await stat(file)).isFile())
            throw new AgentError('请选择项目目录中的现有文件。', 400);
          value = file;
          if (lastResult?.status === 'done' && !lastResult.files?.some(saved => saved.source === file))
            archive = await archiveWorkDelivery(path.join(this.projectDirectory, 'deliveries'), project.directory, file);
        }
      }
      const updated = await this.items.update(endpoint, current => {
        const saved = current.items.find(row => row.id === id)!;
        if (action === 'notes') saved.notes.push({ text: value, at: Date.now() });
        else if (!saved.artifacts.includes(value)) saved.artifacts.push(value);
        if (archive && saved.stage !== 'in_progress' && saved.executions?.at(-1)?.resultId === lastResult?.resultId) {
          const result = current.results.find(row => row.id === lastResult?.resultId);
          if (result && !result.files?.some(file => file.source === archive!.source)) {
            result.files = [...(result.files || []), archive];
            recordWorkExecution(saved, result);
            if (saved.stage === 'done') saved.acceptedDeliveryVersion = result.deliveryVersion;
          }
        }
        saved.updatedAt = Date.now();
        return saved;
      });
      return Response.json(updated, { status: 201, headers });
    }
    if (action === 'automation') return await this.saveAutomation(endpoint, item, input, headers);
    if (typeof input?.scene_id !== 'string' || !this.sceneIds().includes(input.scene_id)) throw new AgentError('请选择当前客户端对话。', 400);
    if (action === 'dispatch') {
      if (typeof input.before !== 'string' || input.before === id) throw new AgentError('请选择有效的任务位置。', 400);
      const snapshot = await this.snapshot();
      const dispatch = await this.items.update(endpoint, state => {
        const saved = state.items.find(row => row.id === id)!;
        if (this.startingItems.has(endpoint + ':' + id) || (saved.dispatch && !saved.dispatch.error && saved.dispatch.expiresAt > Date.now()))
          throw new AgentError('任务已在安排或执行中。', 409);
        if (['starting', 'unconfirmed'].includes(saved.launches?.at(-1)?.status || ''))
          throw new AgentError('上次派发结果尚未确认，请先查询已有运行。', 409);
        if (!snapshot.projects.some(project => project.id === saved.projectId)) throw new AgentError('请先为任务选择项目目录。', 400);
        if (!snapshot.agents?.some(agent => agent.available && agent.canExecute !== false && (!saved.executor || agent.id === saved.executor)))
          throw new AgentError(saved.executor ? '指定的执行器当前不可用。' : '当前没有可用的执行器。', 409);
        const roots = new Set(saved.runIds);
        const byId = new Map(snapshot.tasks.map(task => [task.id, task]));
        if (state.pending.some(row => roots.has(row.taskId)) || snapshot.tasks.some(task =>
          (task.status === 'queued' || task.status === 'running') && roots.has(rootTaskId(task.id, byId))))
          throw new AgentError('已有运行尚未结束。', 409);
        saved.dispatch = { id: randomUUID(), sceneId: input.scene_id, before: input.before, expiresAt: Date.now() + 10_000 };
        return saved.dispatch;
      });
      return Response.json(dispatch, { status: 201, headers });
    }
    const { dispatch_id, executor, request_id, instruction } = input;
    if (dispatch_id !== undefined && (typeof dispatch_id !== 'string' || executor === undefined))
      throw new AgentError('请提供接管请求 ID 和执行器。', 400);
    if (executor !== undefined && (typeof executor !== 'string' || !executor))
      throw new AgentError('请选择有效的执行器。', 400);
    if (request_id !== undefined && (dispatch_id !== undefined || typeof request_id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(request_id)))
      throw new AgentError('运行请求 ID 无效。', 400);
    if (instruction !== undefined && typeof instruction !== 'string') throw new AgentError('补充指令必须是文本。', 400);
    return this.startItem(endpoint, id, input.scene_id, request.signal, headers, undefined,
      { dispatchId: dispatch_id, requestId: request_id, executor, instruction: instruction?.trim() });
  }

  private async startItem(endpoint: string, id: string, sceneId: string, signal: AbortSignal, headers: Record<string, string>, automatic?: { key: 'handoff' | 'wakeup'; rule: WorkRule; context: string }, selection?: { dispatchId?: string; requestId?: string; executor?: string; instruction?: string }) {
    const dispatchId = selection?.dispatchId;
    const key = endpoint + ':' + id;
    const launchId = automatic ? undefined : dispatchId || selection?.requestId || 'initial';
    const data = await this.items.read(endpoint);
    let current = data.items.find(row => row.id === id);
    if (!current) throw new AgentError('工作不存在。', 404);
    if (launchId) {
      const saved = current.launches?.find(row => row.id === launchId);
      if (saved && saved.sceneId !== sceneId) throw new AgentError('请在任务来源对话重试派发。', 409);
      const status = await this.recoverLaunch(endpoint, current, launchId);
      if (status.status === 'started' || status.status === 'starting' || status.status === 'unconfirmed')
        return Response.json(status, { status: status.status === 'started' ? 200 : 202, headers });
      if (this.startingItems.get(key) === launchId)
        return Response.json({ ...status, status: 'starting', request_id: launchId }, { status: 202, headers });
      if (status.status === 'failed') current = (await this.items.read(endpoint)).items.find(row => row.id === id);
    }
    if (!current) throw new AgentError('工作不存在。', 404);
    if (this.startingItems.has(key)) throw new AgentError('工作正在启动。', 409);
    if (['starting', 'unconfirmed'].includes(current.launches?.at(-1)?.status || ''))
      throw new AgentError('上次派发结果尚未确认，请先查询已有运行。', 409);
    const confirmedFailure = current.launches?.some(row => row.id === dispatchId && row.status === 'failed');
    if (dispatchId !== undefined && (current.dispatch?.id !== dispatchId || current.dispatch.sceneId !== sceneId ||
        (!confirmedFailure && (current.dispatch.error || current.dispatch.expiresAt <= Date.now()))))
      throw new AgentError('Being 接管请求已变化，请重新交给 Being。', 409);
    if (dispatchId === undefined && current.dispatch && !current.dispatch.error && current.dispatch.expiresAt > Date.now())
      throw new AgentError('任务已交给 Being，启动时请使用接管请求 ID。', 409);
    signal.throwIfAborted();
    this.startingItems.set(key, launchId);
    let launch: WorkLaunch | undefined;
    let submitted = false;
    try {
      if (launchId) launch = { id: launchId, sceneId, status: 'starting' };
      const snapshot = await this.snapshot();
      if (snapshot.endpoint !== endpoint || this.runtime().endpoint !== endpoint) throw new AgentError('Being 已切换，请重试。', 409);
      const previousRun = current.runIds.at(-1);
      if (previousRun) await this.requireCollectedRun(endpoint, previousRun);
      const roots = new Set(current.runIds);
      const byId = new Map(snapshot.tasks.map(task => [task.id, task]));
      const busy = snapshot.tasks.some(task => (task.status === 'queued' || task.status === 'running') && roots.has(rootTaskId(task.id, byId)));
      if (busy || (await this.items.read(endpoint)).pending.some(row => roots.has(row.taskId))) throw new AgentError('已有运行尚未结束。', 409);
      const project = snapshot.projects.find(row => row.id === current.projectId);
      if (!project) throw new AgentError('请先为工作选择项目目录。', 400);
      const executor = automatic?.rule.executor || current.executor || selection?.executor || project.rules?.executor;
      if (!executor) throw new AgentError('请先为任务选择执行器。', 400);
      if (selection?.executor && !snapshot.agents?.some(agent => agent.id === executor && agent.available && agent.canExecute !== false))
        throw new AgentError('所选执行器当前不可用。', 409);
      const planVersion = current.planHistory?.at(-1)?.version || 1;
      const goal = snapshot.goals?.find(row => row.id === project.goalId);
      const goalRevision = workGoalRevision(goal);
      const descriptionIncludesTitle = current.description === current.title || current.description.startsWith(current.title + '\n');
      const requirements = workTaskRequirements(current);
      let brief = [!descriptionIncludesTitle && current.title, current.description, requirements, selection?.instruction].filter(Boolean).join('\n\n');
      if (automatic) {
        await this.items.update(endpoint, state => {
          const item = state.items.find(row => row.id === id);
          if (!item) throw new AgentError('工作不存在。', 404);
          const rule = item[automatic.key];
          if (rule?.id !== automatic.rule.id || rule.status !== 'armed' || !this.eligibleRule(item, state.items, automatic.key))
            throw new AgentError('自动规则已变化。', 409);
          rule.status = 'starting';
        });
        brief = [
          current.title, automatic.rule.instruction,
          '以下原始任务和触发记录仅作背景。请按本轮指令执行。',
          current.description.slice(0, 1300),
          requirements,
          automatic.context,
        ].filter(Boolean).join('\n\n');
      }
      if (Buffer.byteLength(brief) > 16000) throw new AgentError('执行指令超过 16000 字节，请缩短后重新派发。', 400);
      const recovery = launch && { key: randomUUID(), executor, submittedAt: Date.now(), planVersion, goalRevision,
        promptHash: createHash('sha256').update(brief).digest('hex') };
      if (launch) {
        launch = { ...launch, recovery };
        await this.saveLaunch(endpoint, id, launch);
      }
      const response = await this.handle(new Request('beings://desktop/api/subagent/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Being-Endpoint': endpoint },
        body: JSON.stringify({ brief, workdir: project.directory, executor, scene_id: sceneId,
          modelSelection: !automatic && current.executor === executor ? current.modelSelection : undefined }),
        // A confirmed launch continues if the caller stops waiting for its receipt.
        signal: launch ? AbortSignal.timeout(60_000) : signal,
      }), recovery ? { key: recovery.key, planVersion, goalRevision,
        onCreated: async nativeId => {
          launch = { ...launch!, recovery: { ...recovery, nativeId } };
          await this.saveLaunch(endpoint, id, launch);
          submitted = true;
        },
        onPortalSend: async portalAdmission => {
          if (portalAdmission) {
            launch = { ...launch!, recovery: { ...recovery, portalAdmission } };
            await this.saveLaunch(endpoint, id, launch);
          }
          submitted = true;
        },
      } : { planVersion, goalRevision });
      if (!response.ok) {
        if (launch) {
          const status = submitted && (response.status === 408 || response.status >= 500) ? 'unconfirmed' : 'failed';
          await this.saveLaunch(endpoint, id, { ...launch, status, error: `执行器启动回执（HTTP ${response.status}）` });
        }
        return response;
      }
      const receipt = await response.clone().json();
      await this.finishLaunch(endpoint, id, receipt.task_id, { executor, sceneId, launch, planVersion, goalRevision, handoff: project.rules?.handoff, automatic: automatic?.key });
      return new Response(response.body, { status: response.status, headers: { ...headers, 'Content-Type': 'application/json' } });
    } catch (error) {
      if (launch) await this.saveLaunch(endpoint, id, { ...launch, status: submitted ? 'unconfirmed' : 'failed', error: (error as Error).message });
      throw error;
    } finally { this.startingItems.delete(key); }
  }

  private async finishLaunch(endpoint: string, id: string, taskId: string, options: {
    executor: string; sceneId: string; planVersion: number; goalRevision?: WorkGoalRevision; launch?: WorkLaunch; handoff?: WorkProjectRules['handoff'];
    automatic?: 'handoff' | 'wakeup'; pending?: PendingWorkResult;
  }) {
    return this.items.update(endpoint, state => {
      const saved = state.items.find(row => row.id === id)!;
      const recorded = saved.launches?.find(row => row.id === options.launch?.id);
      if (options.launch && (recorded?.recovery?.key !== options.launch.recovery?.key || recorded?.status === 'started')) return saved;
      if (!saved.runIds.includes(taskId)) saved.runIds.push(taskId);
      (saved.runPlans ??= {})[taskId] = options.planVersion;
      if (options.goalRevision) (saved.runGoals ??= {})[taskId] = options.goalRevision;
      saved.activeRun = { taskId };
      const outcome = state.results.filter(row => row.taskId === taskId).at(-1);
      if (options.pending && !outcome && !state.pending.some(row => row.taskId === taskId)) state.pending.push(options.pending);
      if (outcome) {
        outcome.planVersion ??= options.planVersion;
        outcome.goalRevision ??= options.goalRevision;
        recordWorkExecution(saved, outcome);
      }
      setWorkStage(saved, stageForResult(outcome));
      if (recorded) Object.assign(recorded, { status: 'started', taskId, error: undefined });
      if (!options.automatic) saved.executor = options.executor;
      if (saved.dispatch && saved.dispatch.id === options.launch?.id) {
        const before = state.items.find(row => row.id === saved.dispatch?.before && row.stage === saved.stage);
        state.items.splice(state.items.indexOf(saved), 1);
        state.items.splice(before ? state.items.indexOf(before) : state.items.length, 0, saved);
      }
      delete saved.dispatch;
      if (!saved.handoff && !saved.projectHandoffDisabled && options.handoff)
        saved.handoff = { ...options.handoff, id: randomUUID(), sceneId: options.sceneId, kind: 'review', status: 'armed' };
      if (options.automatic) Object.assign(saved[options.automatic]!, { status: 'started', runId: taskId });
      return saved;
    });
  }

  private async recoverLaunch(endpoint: string, item: WorkItem, lookup?: string) {
    const status = this.launchStatus(endpoint, item, lookup);
    const launch = item.launches?.find(row => row.id === status.request_id);
    const recovery = launch?.recovery;
    if (status.status !== 'unconfirmed' || !launch || !recovery) return status;
    let taskId: string | undefined;
    let pending: PendingWorkResult | undefined;
    let notAccepted = false;
    if (recovery.executor === 'internal') {
      const snapshot = await this.readTasks();
      if (snapshot.endpoint === endpoint) taskId = snapshot.tasks.find(task => task.session === `work-${recovery.key}` && task.sceneId === launch.sceneId && !task.parentTaskId)?.id;
      if (!taskId && recovery.portalAdmission) {
        const runtime = this.runtime();
        if (runtime.endpoint !== endpoint) return status;
        const reply = await this.portalRequest(runtime, `/api/subagent/dispatches/${recovery.key}/resolve`,
          { admission: recovery.portalAdmission }, AbortSignal.timeout(3000), {}).then(response => response.ok ? response.json() : undefined).catch(() => undefined);
        if (reply?.status === 'started') taskId = reply.task_id;
        notAccepted = reply?.status === 'not_accepted';
      }
    } else if (recovery.nativeId) {
      const detail = await this.bridge?.adapter(recovery.executor).read(recovery.nativeId).catch(() => undefined);
      const turn = detail?.turns?.find(({ steps }) => steps.some(step => step.kind === 'started' && step.input &&
        createHash('sha256').update(step.input).digest('hex') === recovery.promptHash));
      if (turn) {
        taskId = agentTaskId(recovery.executor, recovery.nativeId);
        pending = { taskId, sceneId: launch.sceneId, expectedTurn: turn.task.id, message: '', submittedAt: recovery.submittedAt, planVersion: recovery.planVersion, goalRevision: recovery.goalRevision };
      }
    } else notAccepted = true;
    if (notAccepted && this.runtime().endpoint === endpoint) {
      const updated = await this.items.update(endpoint, data => {
        const saved = data.items.find(row => row.id === item.id);
        const original = saved?.launches?.find(row => row.id === launch.id && row.recovery?.key === recovery.key);
        if (saved && original && original.status !== 'started') {
          Object.assign(original, { status: 'failed', error: '已确认原派发未被执行器接收，可以重试。' });
          if (saved.dispatch?.id === original.id) saved.dispatch.error = original.error;
        }
        return saved;
      });
      return updated ? this.launchStatus(endpoint, updated, launch.id) : status;
    }
    if (!taskId || this.runtime().endpoint !== endpoint) return status;
    const project = (await this.projects.list(endpoint)).find(row => row.id === item.projectId);
    const saved = await this.finishLaunch(endpoint, item.id, taskId, { launch, pending, executor: recovery.executor,
      sceneId: launch.sceneId, planVersion: recovery.planVersion, goalRevision: recovery.goalRevision, handoff: project?.rules?.handoff });
    return this.launchStatus(endpoint, saved, launch.id);
  }
  private async saveLaunch(endpoint: string, id: string, launch: WorkLaunch) {
    await this.items.update(endpoint, state => {
      const item = state.items.find(row => row.id === id);
      if (!item) throw new AgentError('工作不存在。', 404);
      item.launches = [...(item.launches || []).filter(row => row.id !== launch.id), launch];
      if (item.dispatch?.id === launch.id && launch.status === 'failed') item.dispatch.error = launch.error;
    });
  }
  private async projectGoal(endpoint: string, goalId: unknown) {
    if (goalId === '' || goalId === undefined) return undefined;
    const goal = (await this.items.read(endpoint)).goals?.find(row => row.id === goalId);
    if (!goal) throw new AgentError('请选择当前 Work 中的目标。', 400);
    return goal.id;
  }

  private async goalRequest(request: Request, endpoint: string, id: string | undefined, headers: Record<string, string>) {
    if (request.method === 'GET') {
      const data = await this.items.read(endpoint);
      if (!id) return Response.json(data.goals || [], { headers });
      const goal = data.goals?.find(row => row.id === id);
      if (!goal) throw new AgentError('目标不存在。', 404);
      const projects = (await this.projects.list(endpoint)).filter(project => project.goalId === id);
      return Response.json({ ...goal, work_url: `beings://work/${id}`, projects: projects.map(project => ({ ...project,
        tasks: data.items.filter(item => item.projectId === project.id).map(item => ({
          id: item.id, title: item.title, stage: item.stage, acceptedDeliveryVersion: item.acceptedDeliveryVersion, work_url: `beings://work/${item.id}`,
        })),
      })) }, { headers });
    }
    if (request.method !== (id ? 'PATCH' : 'POST')) return new Response(null, { status: 405, headers });
    const goal = await this.items.saveGoal(endpoint, id, await request.json());
    return Response.json({ ...goal, work_url: `beings://work/${goal.id}` }, { status: id ? 200 : 201, headers });
  }

  async detail(task: import('../../shared/types').SceneTask, endpoint: string) {
    return task.executor ? this.bridge!.read(task) : (await this.readDetails(endpoint, [task.id]))[0];
  }
  async context(id: string, signal?: AbortSignal, sceneId?: string) {
    const endpoint = this.runtime().endpoint;
    if (!endpoint) throw new Error('请先连接 Being。');
    if (id.startsWith('context ')) {
      const page = workCommandPayload(id.slice('context '.length));
      return this.contextPage(page.snapshot, page.offset, endpoint);
    }
    if (id.startsWith('status ')) {
      const item = (await this.items.read(endpoint)).items.find(row => row.id === id.slice('status '.length));
      if (!item) throw new Error('Work 任务不存在或不属于当前 Being。');
      return JSON.stringify(await this.recoverLaunch(endpoint, item));
    }
    const commands: Record<string, [method: string, pathname: string]> = {
      'create-goal': ['POST', '/api/work/goals'], 'update-goal': ['PATCH', '/api/work/goals'], 'link-project': ['PATCH', '/api/subagent/projects'],
      create: ['POST', '/api/work/items'], update: ['PATCH', '/api/work/items'],
      run: ['POST', '/api/work/items'], note: ['POST', '/api/work/items'],
      artifact: ['POST', '/api/work/items'], automate: ['POST', '/api/work/items'], steer: ['POST', '/api/subagent/tasks'],
      retry: ['POST', '/api/subagent/tasks'], decline: ['PATCH', '/api/work/items'],
    };
    const separator = id.indexOf(' ');
    const command = separator < 0 ? id : id.slice(0, separator);
    if (id === 'goals' || id.startsWith('goal ') || /^goal_[0-9a-f-]{36}$/.test(id)) {
      const goalId = command === 'goal' ? id.slice(separator + 1).trim() : id === 'goals' ? '' : id;
      const response = await this.handle(new Request(`beings://desktop/api/work/goals${goalId ? '/' + encodeURIComponent(goalId) : ''}`, {
        headers: { 'X-Being-Endpoint': endpoint }, signal,
      }));
      if (!response.ok) throw new Error(await response.text());
      return response.text();
    }
    if (Object.hasOwn(commands, command)) {
      const [method, resource] = commands[command];
      const input = workCommandPayload(id.slice(separator + 1));
      const sourceScene = sceneId || input.scene_id;
      const suffix = command === 'run' ? '/runs' : command === 'note' ? '/notes' : command === 'artifact' ? '/artifacts' : command === 'automate' ? '/automation' : command === 'decline' ? '/dispatch'
        : command === 'steer' || command === 'retry' ? '/' + command : '';
      const target = command === 'create' || command === 'create-goal' ? '' : '/' + encodeURIComponent(
        command === 'update-goal' ? input.goal_id : command === 'link-project' ? input.project_id : input.item_id || input.task_id);
      const operation = this.handle(new Request('beings://desktop' + resource + target + suffix, {
        method, headers: { 'Content-Type': 'application/json', 'X-Being-Endpoint': endpoint, ...(sceneId ? { 'X-Work-Scene': sceneId } : {}) },
        body: JSON.stringify(command === 'automate' || command === 'decline' ? { ...input, scene_id: sourceScene } : command === 'run'
          ? { scene_id: sourceScene, dispatch_id: input.dispatch_id, request_id: input.request_id, executor: input.executor, instruction: input.instruction } : command === 'steer' ? { message: input.message }
            : command === 'link-project' ? { goalId: input.goal_id, expectedGoalId: input.expectedGoalId } : input),
        signal,
      }));
      let timer: ReturnType<typeof setTimeout> | undefined;
      const response = command === 'run' ? await Promise.race([
        operation,
        new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 6000); }),
      ]).finally(() => clearTimeout(timer)) : await operation;
      const workLink = { work_id: input.item_id, work_url: `beings://work/${input.item_id}`, next_step: workDispatchReply };
      if (response) {
        if (!response.ok) throw new Error(await response.text());
        return command === 'run' ? JSON.stringify({ ...await response.json(), ...workLink }) : response.text();
      }
      const item = (await this.items.read(endpoint)).items.find(row => row.id === input.item_id);
      if (!item) throw new Error('Work 任务不存在或不属于当前 Being。');
      const launchId = input.dispatch_id || input.request_id || 'initial';
      const status = this.launchStatus(endpoint, item, launchId);
      const stillStarting = status.status === 'not_started' && this.startingItems.get(endpoint + ':' + item.id) === launchId;
      return JSON.stringify({ ...status, ...workLink, ...(stillStarting ? { status: 'starting', request_id: launchId } : {}) });
    }
    if (command === 'results' || command === 'result') {
      // Read the saved outcome even if another executor's history is slow.
      let tasks: SceneTask[] = [];
      const legacy = command === 'results' && separator >= 0 ? this.readTasks().then(snapshot => {
        if (snapshot.endpoint === endpoint) tasks = snapshot.tasks;
      }) : Promise.resolve();
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([Promise.allSettled([this.refreshResults(this.runtime()), legacy]),
        new Promise<void>(resolve => { timer = setTimeout(resolve, 1500); })]).finally(() => clearTimeout(timer));
      const data = await this.items.read(endpoint);
      const results = sceneId ? data.results.filter(result => result.sceneId === sceneId) : data.results;
      if (command === 'result') {
        const result = results.find(row => row.id === id.slice(separator + 1));
        if (!result) throw new Error('该结果不在当前 Being 对话中。');
        return JSON.stringify(result);
      }
      let entries: unknown[];
      if (separator < 0) entries = this.resultPage(results).entries;
      else {
        const ids = new Set(id.slice(separator + 1).trim().split(/\s+/));
        const items = data.items.filter(item => ids.has(item.id));
        if (items.length !== ids.size) throw new Error('Work 任务不存在或不属于当前 Being。');
        const runs = new Map(tasks.map(task => [task.id, task]));
        entries = items.map(item => ({
          work_id: item.id, work_url: `beings://work/${item.id}`, title: item.title, stage: item.stage,
          result: item.stage === 'in_progress' && item.activeRun ? null
            : this.resultPage(results.filter(row => row.workItemId === item.id || item.runIds.includes(rootTaskId(row.taskId, runs)))).entries[0] ?? null,
        }));
      }
      // The Being tool transport clips oversized lines. Keep each result on its own line.
      return `[\n${entries.map(entry => JSON.stringify(entry)).join(',\n')}\n]`;
    }
    if (id === 'add-project' || id.startsWith('add-project ')) {
      const input = id === 'add-project' ? {} : workCommandPayload(id.slice('add-project '.length));
      if (input.directory !== undefined && (typeof input.directory !== 'string' || !path.isAbsolute(input.directory))) throw new Error('请提供绝对项目目录。');
      const goalId = await this.projectGoal(endpoint, input.goal_id);
      const directory = await this.chooseProject(input.directory);
      if (signal?.aborted || this.runtime().endpoint !== endpoint) throw new Error('项目添加已取消或 Being 已切换。');
      if (!directory) return JSON.stringify({ cancelled: true });
      return JSON.stringify({ project: await this.projects.add(endpoint, { directory }, goalId), usage: 'Use @work create with the returned projectId, then @work run for each independent task.' });
    }
    if (id.startsWith('directory ')) {
      const directory: unknown = JSON.parse(id.slice('directory '.length));
      if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('项目目录无效。');
      const resolved = await realpath(directory);
      return JSON.stringify({ allowed: !!directoryProject(await this.projects.registered(endpoint), resolved) });
    }
    if (/^(start|send|cancel) /.test(id)) {
      const operation = id.slice(0, id.indexOf(' '));
      const input = workCommandPayload(id.slice(id.indexOf(' ') + 1));
      const sourceScene = sceneId || input.scene_id;
      const url = operation === 'start' ? '/api/subagent/tasks' : `/api/subagent/tasks/${input.task_id}/${operation === 'send' ? 'messages' : 'cancel'}`;
      const response = await this.handle(new Request(`beings://desktop${url}`, {
        method: 'POST', headers: { 'X-Being-Endpoint': endpoint, 'Content-Type': 'application/json', ...(typeof sourceScene === 'string' ? { 'X-Work-Scene': sourceScene } : {}) },
        body: JSON.stringify(operation === 'start' ? { ...input, scene_id: sourceScene } : operation === 'send' ? { message: input.message } : {}), signal,
      }));
      if (!response.ok) throw new Error(await response.text());
      return response.text();
    }
    const snapshot = await this.snapshot();
    if (id === 'agents') return JSON.stringify(snapshot.agents);
    const usage = `${workDispatchReply} ` + '@work agents lists executors and readiness. @work start {"executor":"codex|deepseek|internal","workdir":"absolute project directory","brief":"task"} starts an independent session for work without a goal. For a goal-linked project use @work create and @work run to link the execution to the goal in Work. Dispatch independent tasks in parallel. @work send {"task_id":"id","message":"follow-up"} continues the same native session; @work cancel {"task_id":"id"} stops it. Codex and DeepSeek are independent native gateways. When reporting a specific session, link its title as [task title](beings://work/<complete task_id>); use the actual returned ID. @work goals lists Work goals. @work goal <goal_id> reads the goal, projects, and progress. Use @work create-goal {title,outcome,acceptanceCriteria,status:"active"}, @work update-goal {goal_id,title,outcome,acceptanceCriteria,status,expectedVersion?}, and @work link-project {project_id,goal_id}. @work add-project {"directory":"absolute path","goal_id":"optional"} opens a folder chooser; projects can work without a goal. @work projects lists local projects; @work project <project_id> reads a project and its tasks. @work <task_id> reads the full session, including every follow-up, tool input/output, errors and native conversation records. In a later user message in the same Being chat, use @work results <work_id> [<work_id> ...] for the latest result and stage of each selected task, or @work results for recent outcomes. Use @work <work_id> for the plan and linked runs. Use @work <task_id> for the latest follow-up and artifacts. If a launch times out, use @work status <work_id> to recover the original dispatch. Reuse its request when repeating a command. Desktop-submitted native runs publish results through Portal callbacks. @work create accepts {title,description,specification,acceptanceCriteria,projectId,executor,stage,priority,labels,dueDate,parentId}; @work update accepts the same fields plus item_id and optional expectedVersion. @work run {item_id,executor?,instruction?} starts a task and returns a launch receipt immediately. Work sends the filled task fields. Include relevant goal context or delivery format in instruction when needed for this run. If the task has no executor, choose an available project default or an available suitable executor, and pass its ID to run. @work note or @work artifact accepts {item_id,value}; register the source project file for an artifact. @work <work_id> reads requirements history and linked executions. Each latest result can include goalRevision, planVersion, deliveryVersion and archived files[].path. @work steer {task_id,message} supplements supported running sessions; @work retry {task_id} retries the latest failed run. Verify internal Portal completion callbacks by task_id in the actual inbox; if a source filter only returns old items, recheck without that filter before declaring delivery failed. Ledger callback=sent alone is not proof of receipt. Large histories return an immutable JSON text page; follow next until null, concatenate content by offset to obtain the full context (do not treat the first page as the complete history); portal_subagent_control action=continue continues a finished task in its original directory.';
    if (!id || id === 'projects') return JSON.stringify({ agents: snapshot.agents, projects: snapshot.projects, items: id ? undefined : snapshot.items, tasks: id ? undefined : snapshot.tasks.map(({ userMessage: _message, ...task }) => task), usage });
    if (id.startsWith('project ')) {
      const project = snapshot.projects.find(project => project.id === id.slice('project '.length));
      if (!project) throw new Error('项目不存在或不属于当前 Being。');
      return JSON.stringify({ project, goal: snapshot.goals?.find(goal => goal.id === project.goalId), items: snapshot.items?.filter(item => item.projectId === project.id), tasks: snapshot.tasks.filter(task => task.projectId === project.id).map(({ userMessage: _message, ...task }) => task), usage });
    }
    const item = snapshot.items?.find(row => row.id === id);
    if (!item && !snapshot.tasks.some(task => task.id === id)) throw new Error('Work 任务不存在或不属于当前 Being。');
    const tasks = snapshot.tasks;
    const byId = new Map(tasks.map(task => [task.id, task]));
    const roots = new Set(item?.runIds || []);
    if (!item) {
      let root = byId.get(id)!;
      while (root.parentTaskId && byId.has(root.parentTaskId)) root = byId.get(root.parentTaskId)!;
      roots.add(root.id);
    }
    const chain = tasks.filter(task => {
      let ancestor = task;
      while (ancestor.parentTaskId && byId.has(ancestor.parentTaskId)) ancestor = byId.get(ancestor.parentTaskId)!;
      return roots.has(ancestor.id);
    }).sort((a, b) => a.createdAt - b.createdAt);
    const details = await Promise.all(chain.map(task => this.detail(task, snapshot.endpoint)));
    if (signal?.aborted || this.runtime().endpoint !== endpoint) throw new Error('上下文读取已取消或 Being 已切换。');
    const summarize = (steps: SubagentStep[]) => steps.map(({ attachments, ...step }) => attachments?.length
      ? { ...step, attachments: attachments.map(({ type, name }) => ({ type, name })) } : step);
    const conversation = details.map(({ taskId, steps, turns }, index) => ({
      taskId, steps: summarize(steps), turns: turns?.map(turn => ({ task: turn.task, steps: summarize(turn.steps) })),
      request: chain[index].userMessage || chain[index].brief,
    }));
    const text = JSON.stringify({ item, tasks: chain, conversation });
    if (text.length <= 12000) return text;
    for (const [key, saved] of this.contexts) if (saved.expires < Date.now() || saved.endpoint !== endpoint) this.contexts.delete(key);
    if (this.contexts.size >= 8) this.contexts.delete(this.contexts.keys().next().value!);
    const token = randomUUID();
    this.contexts.set(token, { endpoint, taskId: id, text, expires: Date.now() + 600000 });
    return this.contextPage(token, 0, endpoint);
  }

  nativeHost(host: string) { return this.bridge?.hasNative(host) || false; }
  async native(request: Request): Promise<Response> {
    const shell = new URL(this.shellURL());
    const origin = `${shell.protocol}//${shell.host}`;
    const headers = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Cache-Control': 'no-store' };
    if (request.headers.get('Origin') && request.headers.get('Origin') !== origin) return new Response(null, { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': `Content-Type, X-Being-Endpoint, X-Work-Scene, ${workPlanVersionHeader}` } });
    const endpoint = this.runtime().endpoint;
    if (!endpoint || request.headers.get('X-Being-Endpoint') !== endpoint) return new Response(null, { status: 409, headers });
    if (request.method !== 'POST') return new Response(null, { status: 405, headers });
    try {
      const url = new URL(request.url);
      const sceneId = request.headers.get('X-Work-Scene');
      const adapter = this.bridge!.adapter(url.hostname);
      const response = await adapter.native!(request, {
        created: async nativeId => { await this.items.rememberNative(endpoint, agentTaskId(adapter.id, nativeId)); },
        turn: async (nativeId, submit) => {
          if (!sceneId || !this.sceneIds().includes(sceneId)) return (await submit()).response;
          const root = agentTaskId(adapter.id, nativeId);
          return this.withContinuation(endpoint, root, async (owner, goal) => {
            const versions = request.headers.has(workPlanVersionHeader) ? this.continuationVersions(owner, goal, request) : {};
            const submittedAt = Date.now();
            const { response, receipt } = await submit();
            if (receipt && response.ok) {
              const turn = 'turnId' in receipt ? { expectedTurn: root + ':' + receipt.turnId } : receipt;
              await this.recordContinuation(endpoint, root, root, versions, { taskId: root, sceneId, submittedAt, message: '', ...turn });
            }
            return response;
          });
        },
      });
      this.bridge!.invalidate();
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers: { ...headers, 'Content-Type': response.headers.get('content-type') || 'application/json' } });
    } catch (error) {
      return error instanceof AgentError ? new Response(error.body, { status: error.status, headers: { ...headers, 'Content-Type': error.contentType } }) : Response.json({ error: (error as Error).message }, { status: 502, headers });
    }
  }
  async handle(request: Request, launch?: LaunchTransport): Promise<Response> {
    const shell = new URL(this.shellURL());
    const origin = `${shell.protocol}//${shell.host}`;
    const headers = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Cache-Control': 'no-store' };
    const source = request.headers.get('Origin');
    if (source && source !== origin) return new Response(null, { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers,
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE', 'Access-Control-Allow-Headers': `Cache-Control, Content-Type, X-Being-Endpoint, X-Work-Scene, ${workPlanVersionHeader}` } });
    const url = new URL(request.url);
    if (!this.matches(url.pathname)) return new Response(null, { status: 404, headers });
    const runtime = this.runtime();
    if (!runtime.endpoint || request.headers.get('X-Being-Endpoint') !== runtime.endpoint) return Response.json({ error: 'Being 连接已变化，请重新打开 Work。' }, { status: 409, headers });
    try {
      const goal = workGoalPath.exec(url.pathname);
      if (goal) return await this.goalRequest(request, runtime.endpoint, goal[1], headers);
      if (url.pathname.startsWith('/api/work/items')) return await this.itemRequest(request, url.pathname, runtime.endpoint, headers);
      const session = workSessionPath.exec(url.pathname);
      if (session) {
        if (request.method !== 'PATCH') return new Response(null, { status: 405, headers });
        const [, id] = session;
        const input = await request.json();
        if (typeof input?.projectVisible !== 'boolean') throw new AgentError('请选择会话是否在项目列表中显示。', 400);
        const { endpoint, tasks } = await this.snapshot();
        if (endpoint !== runtime.endpoint) throw new AgentError('Being 连接已变化，请重新打开 Work。', 409);
        const byId = new Map(tasks.map(task => [task.id, task]));
        if (!byId.has(id) || rootTaskId(id, byId) !== id) throw new AgentError('执行会话不存在。', 404);
        await this.items.update(endpoint, data => {
          const hidden = new Set(data.hiddenProjectSessionIds);
          if (input.projectVisible) hidden.delete(id);
          else hidden.add(id);
          data.hiddenProjectSessionIds = [...hidden];
        });
        return Response.json({ id, projectVisible: input.projectVisible }, { headers });
      }
      if (url.pathname.startsWith('/api/subagent/projects/')) {
        if (request.method !== 'PATCH') return new Response(null, { status: 405, headers });
        const id = url.pathname.split('/').at(-1)!;
        const rules = (await request.json()) as (WorkProjectRules & { goalId?: unknown; expectedGoalId?: unknown }) | null;
        if (rules && Object.hasOwn(rules, 'goalId')) {
          if (typeof rules.goalId !== 'string' || (rules.expectedGoalId !== undefined && typeof rules.expectedGoalId !== 'string'))
            throw new AgentError('请选择有效的所属目标。', 400);
          const goalId = await this.projectGoal(runtime.endpoint, rules.goalId);
          const project = (await this.projects.list(runtime.endpoint)).find(row => row.id === id)
            || (await this.snapshot()).projects.find(row => row.id === id);
          if (!project) throw new AgentError('此项目尚未同步到 Work。', 404);
          return Response.json(await this.projects.setGoal(runtime.endpoint, project, goalId || '', rules.expectedGoalId), { headers });
        }
        const { agents } = await this.snapshot();
        if (!rules || typeof rules.executor !== 'string' || (rules.executor && !agents?.some(agent => agent.id === rules.executor)) ||
          (rules.handoff !== undefined && (!rules.handoff || !agents?.some(agent => agent.id === rules.handoff?.executor) ||
            typeof rules.handoff.instruction !== 'string' || !rules.handoff.instruction.trim() || rules.handoff.instruction.length > 1000)))
          throw new AgentError('请选择可用的项目执行器，并填写审核指令。', 400);
        const saved = await this.projects.setRules(runtime.endpoint, id, {
          executor: rules.executor, handoff: rules.handoff && { executor: rules.handoff.executor, instruction: rules.handoff.instruction.trim() },
        });
        return Response.json(saved, { headers });
      }
      if (!['GET', 'POST'].includes(request.method)) return new Response(null, { status: 405, headers });
      if (url.pathname === '/api/work/results' && request.method === 'GET') {
        return Response.json(this.resultPage((await this.items.read(runtime.endpoint)).results, url.searchParams.get('before')), { headers });
      }
      if (url.pathname === '/api/work/results/read' && request.method === 'POST') {
        const { id } = await request.json();
        await this.items.update(runtime.endpoint, data => {
          const result = data.results.find(row => row.id === id);
          if (!result) throw new AgentError('工作结果不存在。', 404);
          result.read = true;
        });
        return Response.json({ id }, { headers });
      }
      if (url.pathname === '/api/work/imports') {
        if (request.method === 'POST') {
          const input = await request.json();
          try { const selection = await this.imports.save(runtime.endpoint, input); this.bridge?.invalidate(); return Response.json(selection, { headers }); }
          catch (error) { return Response.json({ error: (error as Error).message }, { status: 400, headers }); }
        }
        const [selection, data] = await Promise.all([this.imports.read(runtime.endpoint), this.items.read(runtime.endpoint)]);
        const managed = managedNativeSessions(data);
        const taskIds = selection.taskIds.filter(id => !managed.has(id));
        const external = await this.bridge?.snapshot(taskIds);
        return Response.json({ ...selection, taskIds, projects: external?.projects || [],
          tasks: external?.tasks.filter(task => !managed.has(task.id)) || [], agents: external?.agents || [] }, { headers });
      }
      if (url.pathname === '/api/work/agents' && request.method === 'GET') return Response.json((await this.snapshot()).agents, { headers });
      if (url.pathname.startsWith('/api/work/agents/') && request.method === 'POST') { await this.bridge!.connect(url.pathname.split('/')[4]); return Response.json({ restartRequired: true }, { headers }); }
      if (url.pathname === '/api/subagent/projects') {
        if (request.method === 'GET') return Response.json(await this.projects.registered(runtime.endpoint), { headers });
        const input = await request.json();
        const goalId = await this.projectGoal(runtime.endpoint, input?.goalId);
        try { return Response.json(await this.projects.add(runtime.endpoint, input, goalId), { status: 201, headers }); }
        catch (error) { if (error instanceof AgentError) throw error; return Response.json({ error: (error as Error).message }, { status: 400, headers }); }
      }
      const [, , , , id, action] = url.pathname.split('/');
      // History reads must not wait for every executor's project/session discovery.
      if (id && request.method === 'GET' && !action) {
        if (id.startsWith('agent_')) {
          const [selection, data] = await Promise.all([this.imports.read(runtime.endpoint), this.items.read(runtime.endpoint)]);
          if (!selection.taskIds.includes(id) && !managedNativeSessions(data).has(id))
            return Response.json({ error: '会话尚未导入。' }, { status: 404, headers });
          const [, executor, nativeId] = /^agent_([^_]+)_(.+)$/.exec(id)!;
          const detail = await this.bridge!.adapter(executor).read(nativeId);
          const { records: _records, ...conversation } = detail;
          return Response.json(conversation, { headers });
        }
        const internal = await this.readTasks();
        if (!internal.tasks.some(task => task.id === id)) return Response.json({ error: '任务不存在。' }, { status: 404, headers });
        return Response.json((await this.readDetails(runtime.endpoint, [id]))[0], { headers });
      }
      if (!id && request.method === 'GET' && request.headers.get('Cache-Control') === 'no-cache') this.bridge?.invalidate();
      const snapshot = await this.snapshot();
      if (!id && request.method === 'GET') return Response.json(snapshot, { headers });
      if (!id && request.method === 'POST') {
        const input = await request.clone().json();
        if (!input || typeof input.brief !== 'string' || !input.brief.trim() || input.brief.length > 16000 || typeof input.workdir !== 'string' || !path.isAbsolute(input.workdir) || typeof input.scene_id !== 'string' || !this.sceneIds().includes(input.scene_id) || Object.keys(input).some(key => !['brief', 'workdir', 'scene_id', 'executor', 'modelSelection', 'attachments'].includes(key))) return Response.json({ error: '请提供任务说明、项目目录和当前客户端对话。' }, { status: 400, headers });
        if (input.executor !== undefined && typeof input.executor !== 'string') return Response.json({ error: '执行器无效。' }, { status: 400, headers });
        const modelSelection = workModelSelection(input.modelSelection, input.executor);
        const workdir = await realpath(input.workdir);
        if (!directoryProject(snapshot.projects, workdir)) return Response.json({ error: '请先添加此项目目录。' }, { status: 403, headers });
        if (input.executor && input.executor !== 'internal') {
          if (input.attachments !== undefined) return Response.json({ error: '请使用该执行器的原生接口发送附件。' }, { status: 400, headers });
          const submittedAt = Date.now();
          const receipt = await this.bridge!.start(input.executor, workdir, input.brief, modelSelection ?? undefined, launch?.onCreated);
          await this.items.rememberNative(runtime.endpoint, receipt.task_id, { sceneId: input.scene_id, submittedAt, message: input.brief,
            planVersion: launch?.planVersion, goalRevision: launch?.goalRevision });
          return Response.json(receipt, { status: 201, headers });
        }
        // Explicit submission authorizes the imported directory for the internal runtime.
        await this.projects.add(runtime.endpoint, { directory: input.workdir });
      }
      if (id && !snapshot.tasks.some(task => task.id === id)) return Response.json({ error: '任务不存在。' }, { status: 404, headers });
      const task = snapshot.tasks.find(task => task.id === id);
      if (task && request.method === 'GET' && !action) return Response.json(await this.detail(task, runtime.endpoint), { headers });
      if (task && request.method === 'POST' && action === 'retry') {
        if (!this.resultStatus(task.status) || task.status === 'done') throw new AgentError('只能重试未成功结束的运行。', 409);
        if (task.executor) {
          const last = (await this.detail(task, runtime.endpoint)).turns?.at(-1);
          const message = last?.task.userMessage || last?.steps.find(step => step.kind === 'started')?.input;
          if (!message) throw new AgentError('找不到原始运行指令。', 409);
          await this.continueNative(runtime.endpoint, task, task.sceneId || request.headers.get('X-Work-Scene') || '', message, request, true);
          return Response.json({ task_id: task.id }, { status: 201, headers });
        }
      }
      if (task?.executor && request.method === 'POST' && action) {
        if (action === 'cancel') await this.bridge!.cancel(task);
        else {
          const input = await request.json();
          if (typeof input?.message !== 'string' || !input.message.trim() || input.message.length > 16000) return Response.json({ error: '请提供续聊内容。' }, { status: 400, headers });
          if (action === 'steer') {
            if (task.status !== 'running') throw new AgentError('这次运行已经结束，请改用续聊。', 409);
            await this.bridge!.steer(task, input.message);
          } else {
            await this.continueNative(runtime.endpoint, task, task.sceneId || request.headers.get('X-Work-Scene') || '', input.message, request);
          }
        }
        return Response.json({ task_id: id }, { headers });
      }
      if (request.method !== 'POST' || (id && !action)) return new Response(null, { status: 405, headers });
      const input = await request.json();
      delete input.executor;
      delete input.modelSelection;
      const continuing = task && (action === 'messages' || action === 'retry')
        ? rootTaskId(task.id, new Map(snapshot.tasks.map(row => [row.id, row]))) : undefined;
      if (!continuing) return await this.portalRequest(runtime, url.pathname, input, request.signal, headers, launch);
      return await this.withContinuation(runtime.endpoint, continuing, async (owner, goal) => {
        const versions = action === 'retry' ? { planVersion: owner?.runPlans?.[task!.id], goalRevision: owner?.runGoals?.[task!.id] }
          : this.continuationVersions(owner, goal, request);
        if (action === 'messages' && typeof input.message === 'string' && Buffer.byteLength(input.message) > 16000)
          throw new AgentError('续聊内容过长，请缩短后重试。', 400);
        const response = await this.portalRequest(runtime, url.pathname, input, request.signal, headers);
        if (!response.ok) return response;
        const receipt = await response.clone().json();
        await this.recordContinuation(runtime.endpoint, continuing, receipt.task_id, versions);
        return response;
      });
    } catch (error) {
      if (error instanceof AgentError) return new Response(error.body, { status: error.status, headers: { ...headers, 'Content-Type': error.contentType } });
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
      return Response.json({ error: missing ? '当前 Portal 不支持 Work 续聊，请更新并重启 Portal。' : 'Work 请求失败，请检查 Portal 状态后重试。' }, { status: missing ? 503 : 502, headers });
    }
  }
}
