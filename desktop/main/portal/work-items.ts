import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { workPriorities, workStages, type WorkGoal, type WorkGoalFields, type WorkGoalRevision, type WorkItem, type WorkItemFields, type WorkModelSelection, type WorkPlanVersion, type WorkResult } from '../../shared/work';
import { AgentError } from '../agent-bridge/types';

export interface PendingWorkResult {
  taskId: string;
  sceneId: string;
  expectedTurn?: string;
  requestId?: string;
  message: string;
  submittedAt: number;
  planVersion?: number;
  goalRevision?: WorkGoalRevision;
}
interface WorkData {
  goals?: WorkGoal[];
  items: WorkItem[];
  results: WorkResult[];
  pending: PendingWorkResult[];
  nativeSessionIds?: string[];
  removedItemRunIds?: string[];
  hiddenProjectSessionIds?: string[];
  since: number;
}

export function managedNativeSessions(data: WorkData) {
  const runs = [...data.items.flatMap(item => item.runIds), ...(data.removedItemRunIds || [])];
  return new Set([...(data.nativeSessionIds || []), ...runs.filter(id => id.startsWith('agent_'))]);
}

export function nativeSourceScenes(data: WorkData) {
  const scenes = new Map<string, string>();
  for (const row of [...data.results, ...data.pending]) {
    if (row.taskId.startsWith('agent_') && row.sceneId && !scenes.has(row.taskId)) scenes.set(row.taskId, row.sceneId);
  }
  return scenes;
}

export function workModelSelection(input: unknown, executor: string): WorkModelSelection | null | undefined {
  if (input === null || input === undefined) return input;
  const selection = input as Partial<WorkModelSelection>;
  if (typeof selection.model !== 'string' || !selection.model.trim() || selection.model.length > 256 ||
      (executor === 'deepseek' ? typeof selection.provider !== 'string' || !selection.provider.trim() || selection.provider.length > 256
        : executor !== 'codex' || selection.provider !== undefined))
    throw new AgentError('请选择此执行器的有效模型。', 400);
  return { model: selection.model, ...(selection.provider !== undefined ? { provider: selection.provider } : {}) };
}

export function workItemFields(input: unknown): WorkItemFields {
  const body = input as Partial<WorkItemFields> | null;
  if (!body || typeof body.title !== 'string' || !body.title.trim() || body.title.length > 200 ||
      typeof body.description !== 'string' || Buffer.byteLength(body.description) > 15000 ||
      typeof body.projectId !== 'string' || typeof body.executor !== 'string' ||
      typeof body.stage !== 'string' || !Object.hasOwn(workStages, body.stage) ||
      typeof body.priority !== 'string' || !Object.hasOwn(workPriorities, body.priority) ||
      !Array.isArray(body.labels) || body.labels.length > 20 || !body.labels.every(label => typeof label === 'string' && label.length <= 40) ||
      typeof body.dueDate !== 'string' || (body.dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate) ||
        !Number.isFinite(Date.parse(body.dueDate)) || new Date(body.dueDate).toISOString().slice(0, 10) !== body.dueDate)) ||
      typeof body.parentId !== 'string') throw new AgentError('请检查工作标题、描述和属性。', 400);
  if ((body.goal !== undefined && (typeof body.goal !== 'string' || Buffer.byteLength(body.goal) > 2000)) ||
      (body.specification !== undefined && (typeof body.specification !== 'string' || Buffer.byteLength(body.specification) > 5000)) ||
      (body.acceptanceCriteria !== undefined && (!Array.isArray(body.acceptanceCriteria) || body.acceptanceCriteria.length > 20 ||
        !body.acceptanceCriteria.every(value => typeof value === 'string' && Buffer.byteLength(value) <= 400))))
    throw new AgentError('请检查目标、规格和验收标准。', 400);
  return { title: body.title.trim(), description: body.description.trim(), projectId: body.projectId, executor: body.executor,
    ...(body.goal === undefined ? {} : { goal: body.goal.trim() }),
    ...(body.specification === undefined ? {} : { specification: body.specification.trim() }),
    ...(body.acceptanceCriteria === undefined ? {} : { acceptanceCriteria: body.acceptanceCriteria.map(value => value.trim()).filter(Boolean) }),
    ...(body.modelSelection === undefined ? {} : { modelSelection: workModelSelection(body.modelSelection, body.executor) }),
    stage: body.stage, priority: body.priority, labels: [...new Set(body.labels.map(label => label.trim()).filter(Boolean))],
    dueDate: body.dueDate, parentId: body.parentId };
}

export function workPlanVersion(fields: WorkItemFields, version: number, at: number, source: WorkPlanVersion['source']): WorkPlanVersion {
  return { version, at, source, title: fields.title, description: fields.description,
    goal: fields.goal || '', specification: fields.specification || '', acceptanceCriteria: fields.acceptanceCriteria || [] };
}

export class WorkItems {
  private loads = new Map<string, Promise<WorkData>>();
  private writing: Promise<unknown> = Promise.resolve();
  constructor(private directory: string) {}
  private file(endpoint: string) {
    return path.join(this.directory, createHash('sha256').update(endpoint).digest('hex') + '.json');
  }
  read(endpoint: string) {
    let data = this.loads.get(endpoint);
    if (!data) {
      data = readFile(this.file(endpoint), 'utf8').then(text => JSON.parse(text) as WorkData, error => {
        if (error.code !== 'ENOENT') throw error;
        return { items: [], results: [], pending: [], since: Date.now() };
      });
      this.loads.set(endpoint, data);
    }
    return data;
  }
  update<T>(endpoint: string, change: (data: WorkData) => T) {
    const write = this.writing.then(async () => {
      const previous = await this.read(endpoint);
      const data = structuredClone(previous);
      const value = change(data);
      await mkdir(this.directory, { recursive: true });
      const file = this.file(endpoint);
      await writeFile(file + '.tmp', JSON.stringify(data), { mode: 0o600 });
      await rename(file + '.tmp', file);
      this.loads.set(endpoint, Promise.resolve(data));
      return value;
    });
    this.writing = write.catch(() => {});
    return write;
  }
  rememberNative(endpoint: string, taskId: string, pending?: Omit<PendingWorkResult, 'taskId'>) {
    return this.update(endpoint, data => {
      data.nativeSessionIds = [...new Set([...(data.nativeSessionIds || []), taskId])];
      if (pending) data.pending.push({ taskId, ...pending });
    });
  }
  saveGoal(endpoint: string, id: string | undefined, input: unknown) {
    const fields = input as Partial<WorkGoalFields> & { expectedVersion?: number } | null;
    if (!fields || typeof fields.title !== 'string' || !fields.title.trim() || fields.title.length > 200 ||
        typeof fields.outcome !== 'string' || Buffer.byteLength(fields.outcome) > 2500 ||
        !Array.isArray(fields.acceptanceCriteria) || fields.acceptanceCriteria.length > 12 ||
        !fields.acceptanceCriteria.every(value => typeof value === 'string' && Buffer.byteLength(value) <= 400) ||
        (fields.status !== 'active' && fields.status !== 'done'))
      throw new AgentError('请检查目标标题、预期结果和验收条件。', 400);
    const criteria = { title: fields.title.trim(), outcome: fields.outcome.trim(), acceptanceCriteria: fields.acceptanceCriteria.map(value => value.trim()).filter(Boolean) };
    const status = fields.status;
    return this.update(endpoint, data => {
      const goals = data.goals ??= [];
      const goal = goals.find(row => row.id === id);
      const at = Date.now();
      if (id) {
        if (!goal) throw new AgentError('目标不存在。', 404);
        if (fields.expectedVersion !== undefined && fields.expectedVersion !== goal.version) throw new AgentError('目标已更新，请重新打开目标再编辑。', 409);
        if (goal.title !== criteria.title || goal.outcome !== criteria.outcome || JSON.stringify(goal.acceptanceCriteria) !== JSON.stringify(criteria.acceptanceCriteria))
          goal.history.push({ ...criteria, version: ++goal.version, at });
        Object.assign(goal, criteria, { status, updatedAt: at });
        return goal;
      }
      const created = { ...criteria, status, id: 'goal_' + randomUUID(), version: 1,
        createdAt: at, updatedAt: at, history: [{ ...criteria, version: 1, at }] };
      goals.push(created);
      return created;
    });
  }
  create(endpoint: string, fields: WorkItemFields, source: WorkPlanVersion['source'] = 'user') {
    return this.update(endpoint, data => {
      if (fields.parentId && !data.items.some(item => item.id === fields.parentId && item.projectId === fields.projectId))
        throw new AgentError('请选择同项目中的父任务。', 400);
      const now = Date.now();
      const item: WorkItem = { ...fields, id: 'work_' + randomUUID(), createdAt: now, updatedAt: now, runIds: [], artifacts: [], notes: [],
        planHistory: [workPlanVersion(fields, 1, now, source)] };
      data.items.push(item);
      return item;
    });
  }
}
