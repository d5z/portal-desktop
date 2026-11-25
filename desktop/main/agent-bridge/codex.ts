import type { PermissionMode } from '../../shared/security';
import { externalApprovalNotice, externalExecNotice, requireExternalExecution } from './permissions';
import { access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { SceneTask, SubagentStep, SubagentTaskDetail } from '../../shared/types';
import type { WorkModelSelection } from '../../shared/work';
import { JsonRpcProcess } from './json-rpc';
import { AgentError, agentTaskId, type AgentAdapter } from './types';

type Item = { id: string; type: string; text?: string; content?: { type: string; text?: string }[] | string[]; summary?: string[]; command?: string; aggregatedOutput?: string; status?: string; tool?: string; arguments?: unknown; result?: unknown; changes?: unknown; startedAtMs?: number };
type Turn = { id: string; status: string; startedAt: number | null; completedAt: number | null; items: Item[]; error?: { message: string } };
type Thread = { id: string; name: string | null; preview: string; cwd: string; projectId: string | null; createdAt: number; updatedAt: number; status: { type: string }; turns: Turn[] };
type Project = { id: string; name: string; roots: { path: string }[]; createdAt: number };

export function codexDetail(thread: Thread): SubagentTaskDetail {
  const taskId = agentTaskId('codex', thread.id);
  return { taskId, records: thread.turns, steps: [], turns: thread.turns.map(turn => {
    const at = (turn.startedAt || thread.createdAt) * 1000;
    const steps: SubagentStep[] = turn.items.flatMap<SubagentStep>(item => {
      const time = item.startedAtMs || at;
      if (item.type === 'userMessage') return [{ at: time, kind: 'started', input: (item.content as { text?: string }[]).map(c => c.text || '').join('\n') }];
      if (item.type === 'agentMessage') return [{ at: time, kind: 'message', output: item.text }];
      if (item.type === 'reasoning') return [{ at: time, kind: 'thinking', output: item.summary?.join('\n') }];
      if (['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'collabAgentToolCall'].includes(item.type)) {
        const result: SubagentStep[] = [{ at: time, kind: 'tool', callId: item.id, name: item.tool || item.type, input: item.command || JSON.stringify(item.arguments || item.changes || {}) }];
        if (item.status !== 'inProgress') result.push({ at: time, kind: 'tool-result', callId: item.id, output: item.aggregatedOutput || JSON.stringify(item.result || item.changes || ''), failed: item.status === 'failed' });
        return result;
      }
      return [];
    });
    const task: SceneTask = { id: `${taskId}:${turn.id}`, executor: 'codex', nativeId: thread.id, session: thread.id, sceneId: '', workdir: thread.cwd,
      createdAt: at, endedAt: turn.completedAt ? turn.completedAt * 1000 : undefined, userMessage: steps.find(s => s.kind === 'started')?.input,
      status: turn.status === 'inProgress' ? 'running' : turn.status === 'failed' ? 'failed' : turn.status === 'interrupted' ? 'interrupted' : 'done', error: turn.error?.message };
    return { task, steps };
  }) };
}

export class CodexAdapter implements AgentAdapter {
  allowExec: () => boolean = () => true;
  permissionMode: () => PermissionMode = () => 'supervised';
  readonly id = 'codex'; readonly name = 'Codex';
  private rpc = new JsonRpcProcess();
  private connecting?: Promise<void>;
  private active = new Map<string, string>();
  private starting = new Set<string>();
  private binary = '';
  private summaries = new Map<string, { updatedAt: number; status: SceneTask['status'] }>();
  constructor(private candidates = [process.env.TOWN_CODEX_CLI, '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex', ...((process.env.PATH || '').split(path.delimiter).map(dir => path.join(dir, process.platform === 'win32' ? 'codex.exe' : 'codex')))].filter((x): x is string => !!x)) {
    this.rpc.closed = () => { this.connecting = undefined; this.active.clear(); };
    this.rpc.notification = (method, params) => {
      if (method === 'turn/started') this.active.set(params.threadId, params.turn.id);
      if (method === 'turn/completed') {
        this.active.delete(params.threadId);
        // Release the native thread after each turn so the other client can resume it.
        void this.rpc.request('thread/unsubscribe', { threadId: params.threadId }).catch(() => {});
      }
    };
    this.rpc.serverRequest = async (method) => {
      if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
        requireExternalExecution(this.permissionMode(), this.allowExec());
        return { decision: 'accept' };
      }
      throw new AgentError(`请在 Codex 中处理此交互：${method}`, 409);
    };
  }
  async status() {
    if (!this.binary) for (const candidate of this.candidates) {
      if (await access(candidate).then(() => true, () => false)) { this.binary = candidate; break; }
    }
    return { id: this.id, name: this.name, available: !!this.binary, canExecute: this.allowExec() && this.permissionMode() === 'full-access', message: this.binary ? (!this.allowExec() ? externalExecNotice : this.permissionMode() === 'full-access' ? undefined : externalApprovalNotice) : '请安装 Codex CLI 或 Codex 客户端。' };
  }
  private async connectRPC() {
    if (!(await this.status()).available) throw new AgentError('Codex CLI 未安装。', 503);
    return this.connecting ??= (async () => {
      const socket = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'app-server-control/app-server-control.sock');
      const shared = await access(socket).then(() => true, () => false);
      this.rpc.start(this.binary, shared ? ['app-server', 'proxy', '--sock', socket] : ['app-server']);
      await this.rpc.request('initialize', { clientInfo: { name: 'town_work', title: 'Town Work', version: '1.0.0' }, capabilities: { experimentalApi: true } });
      this.rpc.notify('initialized');
    })().catch(error => { this.connecting = undefined; this.rpc.close(); throw error; });
  }
  async native(request: Request) {
    const method = new URL(request.url).pathname.slice(1);
    const params = await request.json();
    const allowed: Record<string, string[]> = { 'model/list': ['limit', 'cursor'], 'project/list': ['limit', 'cursor'], 'project/create': ['name', 'roots', 'idempotencyKey'], 'thread/start': ['cwd', 'projectId', 'ephemeral', 'approvalPolicy', 'sandbox', 'model'], 'thread/resume': ['threadId', 'approvalPolicy', 'sandbox'], 'turn/start': ['threadId', 'input', 'approvalPolicy', 'sandboxPolicy'], 'turn/interrupt': ['threadId', 'turnId'], 'thread/backgroundTerminals/clean': ['threadId'] };
    if (!allowed[method] || Object.keys(params).some(key => !allowed[method].includes(key))) throw new AgentError('Codex 请求无效。', 400);
    if ((method === 'thread/start' || method === 'thread/resume') && ((method === 'thread/start' && params.ephemeral !== false) || params.approvalPolicy !== 'never' || params.sandbox !== 'danger-full-access')) throw new AgentError('Codex 权限设置无效。', 400);
    if (['thread/start', 'thread/resume', 'turn/start'].includes(method)) requireExternalExecution(this.permissionMode(), this.allowExec());
    if (method === 'turn/start' && (params.approvalPolicy !== 'never' || JSON.stringify(params.sandboxPolicy) !== JSON.stringify({ type: 'dangerFullAccess' }))) throw new AgentError('Codex 权限设置无效。', 400);
    await this.connectRPC();
    if (method === 'thread/resume') {
      const detail = await this.read(params.threadId);
      if (detail.turns?.at(-1)?.task.status === 'running') throw new AgentError('此会话正在执行。', 409);
    }
    if (['thread/start', 'thread/resume', 'turn/start'].includes(method)) requireExternalExecution(this.permissionMode(), this.allowExec());
    const result = await this.rpc.request(method, params);
    return Response.json(result);
  }
  async list(selectedIds = new Set<string>()) {
    await this.connectRPC();
    const projects: Project[] = [], threads: Thread[] = [];
    let cursor: string | null = null;
    do {
      const page: { data: Project[]; nextCursor: string | null } = await this.rpc.request('project/list', { limit: 100, cursor });
      projects.push(...page.data); cursor = page.nextCursor;
    } while (cursor);
    do {
      const page: { data: Thread[]; nextCursor: string | null } = await this.rpc.request('thread/list', { limit: 100, cursor, modelProviders: [], sourceKinds: ['cli', 'vscode', 'appServer', 'exec'], sortKey: 'updated_at' });
      threads.push(...page.data); cursor = page.nextCursor;
    } while (cursor);
    await Promise.all(threads.filter(thread => selectedIds.has(thread.id)).map(async thread => {
      const previous = this.summaries.get(thread.id);
      if (previous?.updatedAt === thread.updatedAt && previous.status !== 'running' && !this.active.has(thread.id)) return;
      const page = await this.rpc.request<{ data: Turn[] }>('thread/turns/list', { threadId: thread.id, limit: 1, sortDirection: 'desc', itemsView: 'notLoaded' });
      const status = page.data[0]?.status;
      this.summaries.set(thread.id, { updatedAt: thread.updatedAt, status: status === 'inProgress' ? 'running' : status === 'failed' ? 'failed' : status === 'interrupted' ? 'interrupted' : 'done' });
    }));
    return { projects: projects.flatMap(p => p.roots.map((root, index) => ({ id: `codex_project_${p.id}_${index}`, nativeId: p.id, executor: this.id, name: p.name, directory: root.path, createdAt: p.createdAt * 1000 }))),
      tasks: threads.map<SceneTask>(thread => ({ id: agentTaskId(this.id, thread.id), executor: this.id, nativeId: thread.id, session: thread.id, projectId: thread.projectId ? `codex_project_${thread.projectId}_0` : undefined, workdir: thread.cwd, sceneId: '',
        brief: thread.name || thread.preview || 'Codex 新对话', createdAt: thread.updatedAt * 1000, status: this.active.has(thread.id) || thread.status.type === 'active' ? 'running' : thread.status.type === 'systemError' ? 'failed' : this.summaries.get(thread.id)?.status || 'done' })) };
  }
  async read(id: string) {
    await this.connectRPC();
    const { thread } = await this.rpc.request<{ thread: Thread }>('thread/read', { threadId: id });
    const turns: Turn[] = [];
    let cursor: string | null = null;
    do {
      const page: { data: Turn[]; nextCursor: string | null } = await this.rpc.request('thread/turns/list', { threadId: id, limit: 100, sortDirection: 'asc', itemsView: 'full', cursor });
      turns.push(...page.data); cursor = page.nextCursor;
    } while (cursor);
    return codexDetail({ ...thread, turns });
  }
  async start(directory: string, message: string, modelSelection?: WorkModelSelection, onCreated?: (nativeId: string) => Promise<void>) {
    requireExternalExecution(this.permissionMode(), this.allowExec());
    await this.connectRPC();
    const snapshot = await this.list();
    let projectId = snapshot.projects.find(p => p.directory === directory)?.nativeId;
    if (!projectId) {
      const { project } = await this.rpc.request<{ project: Project }>('project/create', { name: path.basename(directory), roots: [{ path: directory }], idempotencyKey: `town:${directory}` });
      projectId = project.id;
    }
    const { thread } = await this.rpc.request<{ thread: Thread }>('thread/start', { cwd: directory, projectId, ephemeral: false, approvalPolicy: 'never', sandbox: 'danger-full-access', model: modelSelection?.model });
    await onCreated?.(thread.id);
    await this.turn(thread.id, message, false);
    return thread.id;
  }
  send(id: string, message: string) { return this.turn(id, message, true); }
  async steer(id: string, message: string) {
    requireExternalExecution(this.permissionMode(), this.allowExec());
    const turn = this.active.get(id);
    if (!turn) throw new AgentError('此轮未在当前客户端运行。', 409);
    await this.rpc.request('turn/steer', { threadId: id, expectedTurnId: turn, input: [{ type: 'text', text: message }] });
  }
  private async turn(id: string, message: string, resume: boolean) {
    requireExternalExecution(this.permissionMode(), this.allowExec());
    if (this.active.has(id) || this.starting.has(id)) throw new AgentError('此会话正在执行，请等待完成。', 409);
    this.starting.add(id);
    try {
      await this.connectRPC();
      if (resume) {
        const detail = await this.read(id);
        if (detail.turns?.at(-1)?.task.status === 'running') throw new AgentError('此会话正在原生客户端执行。', 409);
        await this.rpc.request('thread/resume', { threadId: id, approvalPolicy: 'never', sandbox: 'danger-full-access' });
      }
      requireExternalExecution(this.permissionMode(), this.allowExec());
      const { turn } = await this.rpc.request<{ turn: Turn }>('turn/start', { threadId: id, input: [{ type: 'text', text: message }], approvalPolicy: 'never', sandboxPolicy: { type: 'dangerFullAccess' } });
      if (turn.status === 'inProgress') this.active.set(id, turn.id);
      return { turnId: turn.id };
    } finally { this.starting.delete(id); }
  }
  async cancel(id: string) {
    await this.connectRPC();
    const turn = this.active.get(id);
    if (!turn) throw new AgentError('请在拥有此运行任务的 Codex 客户端中停止。', 409);
    // Clean before interruption: turn/completed releases this client's subscription.
    await this.rpc.request('thread/backgroundTerminals/clean', { threadId: id });
    await this.rpc.request('turn/interrupt', { threadId: id, turnId: turn });
  }
  close() { this.rpc.close(); this.connecting = undefined; this.active.clear(); }
}
