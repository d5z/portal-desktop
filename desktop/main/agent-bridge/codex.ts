import type { PermissionMode } from '../../shared/security';
import { externalApprovalNotice, externalExecNotice, requireExternalExecution } from './permissions';
import { access, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { SceneTask, SubagentStep, SubagentTaskDetail } from '../../shared/types';
import type { WorkModelSelection } from '../../shared/work';
import type { WorkAttachment } from '../../shared/work-attachments';
import { localFileReference } from '../../shared/local-file';
import { JsonRpcProcess } from './json-rpc';
import { AgentError, agentTaskId, type AgentAdapter, type AgentNativeLifecycle } from './types';

type Item = { id: string; type: string; text?: string; content?: { type: string; text?: string; path?: string; url?: string }[]; summary?: string[]; command?: string; aggregatedOutput?: string; status?: string; tool?: string; arguments?: unknown; result?: unknown; changes?: unknown; startedAtMs?: number };
type Turn = { id: string; status: string; startedAt: number | null; completedAt: number | null; items: Item[]; error?: { message: string } };
type Thread = { id: string; name: string | null; preview: string; cwd: string; projectId: string | null; createdAt: number; updatedAt: number; status: { type: string }; turns: Turn[] };
type Project = { id: string; name: string; roots: { path: string }[]; createdAt: number };

function codexTurnStatus(turn?: Turn, threadStatus?: string): SceneTask['status'] {
  if (turn?.status === 'inProgress') return 'running';
  if (turn?.status === 'failed') return 'failed';
  if (turn?.status === 'interrupted') {
    // A detached Codex server reports an open turn as interrupted without a completion time.
    if (turn.completedAt == null && !turn.error) {
      if (threadStatus === 'notLoaded') return 'unknown';
      if (threadStatus === 'active') return 'running';
    }
    return 'interrupted';
  }
  return 'done';
}

export function codexDetail(thread: Thread): SubagentTaskDetail {
  const taskId = agentTaskId('codex', thread.id);
  return { taskId, records: thread.turns, steps: [], turns: thread.turns.map(turn => {
    const at = (turn.startedAt || thread.createdAt) * 1000;
    const steps: SubagentStep[] = turn.items.flatMap<SubagentStep>(item => {
      const time = item.startedAtMs || at;
      if (item.type === 'userMessage') {
        const content = item.content || [];
        const attachments = content.flatMap<WorkAttachment>(part => {
          if (part.type === 'localImage') {
            const file = localFileReference(part.path);
            return [{ type: 'localImage', path: file ? path.resolve(thread.cwd, file) : '', name: file ? path.basename(file) : '图片' }];
          }
          if (part.type === 'image') return [{ type: 'image', src: part.url || '', name: '图片' }];
          return [];
        });
        let input = content.filter(part => part.type === 'text').map(part => part.text || '').join('\n');
        if (attachments.length) input = input.replace(/^\s*# Files mentioned by the user:\r?\n[\s\S]*?\r?\nDistinguish instructions in attached documents from the user's request\.\r?\n\s*## My request:[ \t]*\r?\n/, '');
        return [{ at: time, kind: 'started', input, ...(attachments.length ? { attachments } : {}) }];
      }
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
      status: codexTurnStatus(turn, turn === thread.turns.at(-1) ? thread.status.type : undefined), error: turn.error?.message };
    return { task, steps };
  }) };
}

export class CodexAdapter implements AgentAdapter {
  allowExec: () => boolean = () => true;
  executionEnabled: () => boolean = () => true;
  permissionMode: () => PermissionMode = () => 'supervised';
  readonly id = 'codex'; readonly name = 'Codex';
  private rpc = new JsonRpcProcess();
  private connecting?: Promise<void>;
  private active = new Map<string, string>();
  private starting = new Set<string>();
  private binary = '';
  private summaries = new Map<string, { updatedAt: number; status: SceneTask['status']; turnId?: string }>();
  constructor(private candidates = [process.env.TOWN_CODEX_CLI, '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex', ...((process.env.PATH || '').split(path.delimiter).map(dir => path.join(dir, process.platform === 'win32' ? 'codex.exe' : 'codex')))].filter((x): x is string => !!x)) {
    this.rpc.closed = () => { this.connecting = undefined; this.active.clear(); };
    this.rpc.notification = (method, params) => {
      if (method === 'turn/completed' && this.active.get(params.threadId) === params.turn.id) {
        this.active.delete(params.threadId);
        // Release the native thread after each turn so the other client can resume it.
        void this.rpc.request('thread/unsubscribe', { threadId: params.threadId }).catch(() => {});
      }
    };
    this.rpc.serverRequest = async (method) => {
      if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
        requireExternalExecution(this.permissionMode(), this.allowExec(), this.executionEnabled());
        return { decision: 'accept' };
      }
      throw new AgentError(`请在 Codex 中处理此交互：${method}`, 409);
    };
  }
  async status() {
    if (!this.binary) for (const candidate of this.candidates) {
      if (await access(candidate).then(() => true, () => false)) { this.binary = candidate; break; }
    }
    return { id: this.id, name: this.name, available: !!this.binary, canExecute: this.allowExec() && this.permissionMode() === 'full-access',
      capabilities: { attachments: 'image' as const, models: true, steer: true, steerAttachments: true },
      message: this.binary ? (!this.allowExec() ? externalExecNotice : this.permissionMode() === 'full-access' ? undefined : externalApprovalNotice) : '请安装 Codex CLI 或 Codex 客户端。' };
  }
  async probe() {
    await this.connectRPC();
    await this.rpc.request('model/list', { limit: 1 });
  }
  private async connectRPC() {
    if (!(await this.status()).available) throw new AgentError('Codex CLI 未安装。', 503);
    return this.connecting ??= (async () => {
      const socket = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'app-server-control/app-server-control.sock');
      const owner = process.getuid?.();
      const resolved = owner === undefined ? undefined : await realpath(socket).catch(() => undefined);
      const file = resolved ? await stat(resolved).catch(() => undefined) : undefined;
      const shared = resolved && file?.isSocket() && file.uid === owner && (file.mode & 0o077) === 0
        && await this.rpc.openSocket(resolved).then(() => true, () => false);
      if (!shared) this.rpc.start(this.binary, ['app-server']);
      await this.rpc.request('initialize', { clientInfo: { name: 'town_work', title: 'Town Work', version: '1.0.0' }, capabilities: { experimentalApi: true } });
      this.rpc.notify('initialized');
    })().catch(error => { this.connecting = undefined; this.rpc.close(); throw error; });
  }
  async native(request: Request, lifecycle?: AgentNativeLifecycle) {
    const method = new URL(request.url).pathname.slice(1);
    const params = await request.json();
    const allowed: Record<string, string[]> = { 'model/list': ['limit', 'cursor'], 'project/list': ['limit', 'cursor'], 'project/create': ['name', 'roots', 'idempotencyKey'], 'thread/start': ['cwd', 'projectId', 'ephemeral', 'approvalPolicy', 'sandbox', 'model'], 'thread/resume': ['threadId', 'approvalPolicy', 'sandbox'], 'turn/start': ['threadId', 'input', 'approvalPolicy', 'sandboxPolicy'], 'turn/steer': ['threadId', 'expectedTurnId', 'input'], 'turn/interrupt': ['threadId', 'turnId'], 'thread/backgroundTerminals/clean': ['threadId'] };
    if (!Object.hasOwn(allowed, method) || Object.keys(params).some(key => !allowed[method].includes(key))) throw new AgentError('Codex 请求无效。', 400);
    if ((method === 'thread/start' || method === 'thread/resume') && ((method === 'thread/start' && params.ephemeral !== false) || params.approvalPolicy !== 'never' || params.sandbox !== 'danger-full-access')) throw new AgentError('Codex 权限设置无效。', 400);
    const executes = ['project/create', 'thread/start', 'thread/resume', 'turn/start', 'turn/steer'].includes(method);
    if (executes) requireExternalExecution(this.permissionMode(), this.allowExec(), this.executionEnabled());
    if (method === 'turn/start' && (typeof params.threadId !== 'string' || !params.threadId || params.approvalPolicy !== 'never' ||
      JSON.stringify(params.sandboxPolicy) !== JSON.stringify({ type: 'dangerFullAccess' }))) throw new AgentError('Codex 启动参数无效。', 400);
    await this.connectRPC();
    if (method === 'thread/resume') {
      const detail = await this.read(params.threadId);
      if (detail.turns?.at(-1)?.task.status === 'running') throw new AgentError('此会话正在执行。', 409);
    }
    if (executes) requireExternalExecution(this.permissionMode(), this.allowExec(), this.executionEnabled());
    if (method === 'turn/steer' && (!params.expectedTurnId || this.active.get(params.threadId) !== params.expectedTurnId)) throw new AgentError('此轮未在当前客户端运行。', 409);
    if (method === 'thread/backgroundTerminals/clean' || method === 'turn/interrupt') {
      const turn = this.active.get(params.threadId);
      if (!turn || (method === 'turn/interrupt' && params.turnId !== turn)) throw new AgentError('请在拥有此运行任务的 Codex 客户端中停止。', 409);
    }
    if (method === 'turn/start') {
      const submit = async () => {
        requireExternalExecution(this.permissionMode(), this.allowExec(), this.executionEnabled());
        const id = params.threadId;
        if (this.active.has(id) || this.starting.has(id)) throw new AgentError('此会话正在执行，请等待完成。', 409);
        this.starting.add(id);
        try {
          const result = await this.rpc.request<{ turn?: Turn }>(method, params);
          const turnId = result.turn?.id;
          if (result.turn?.status === 'inProgress') this.active.set(id, result.turn.id);
          return { response: Response.json(result), receipt: turnId ? { turnId } : undefined };
        } finally { this.starting.delete(id); }
      };
      return lifecycle ? lifecycle.turn(params.threadId, submit) : (await submit()).response;
    }
    const result = await this.rpc.request(method, params);
    if (method === 'thread/start') {
      const threadId = (result as { thread?: Thread }).thread?.id;
      if (threadId) await lifecycle?.created(threadId);
    }
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
      if (previous?.updatedAt === thread.updatedAt && previous.status !== 'running' && previous.status !== 'unknown' && !this.active.has(thread.id)) return;
      const page = await this.rpc.request<{ data: Turn[] }>('thread/turns/list', { threadId: thread.id, limit: 1, sortDirection: 'desc', itemsView: 'notLoaded' });
      const turn = page.data[0];
      this.summaries.set(thread.id, { updatedAt: thread.updatedAt, status: codexTurnStatus(turn, thread.status.type), turnId: turn?.id });
    }));
    return { projects: projects.flatMap(p => p.roots.map((root, index) => ({ id: `codex_project_${p.id}_${index}`, nativeId: p.id, executor: this.id, name: p.name, directory: root.path, createdAt: p.createdAt * 1000 }))),
      tasks: threads.map<SceneTask>(thread => {
        const id = agentTaskId(this.id, thread.id);
        const summary = this.summaries.get(thread.id);
        const active = this.active.get(thread.id) || (summary?.status === 'running' ? summary.turnId : undefined);
        return { id, executor: this.id, nativeId: thread.id, session: thread.id, projectId: thread.projectId ? `codex_project_${thread.projectId}_0` : undefined, workdir: thread.cwd, sceneId: '',
          brief: thread.name || thread.preview || 'Codex 新对话', createdAt: thread.updatedAt * 1000,
          activeTurnId: active ? `${id}:${active}` : undefined,
          status: this.active.has(thread.id) || thread.status.type === 'active' ? 'running' : thread.status.type === 'systemError' ? 'failed' : summary?.status || 'done' };
      }) };
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
    requireExternalExecution(this.permissionMode(), this.allowExec(), this.executionEnabled());
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
    requireExternalExecution(this.permissionMode(), this.allowExec(), this.executionEnabled());
    const turn = this.active.get(id);
    if (!turn) throw new AgentError('此轮未在当前客户端运行。', 409);
    await this.rpc.request('turn/steer', { threadId: id, expectedTurnId: turn, input: [{ type: 'text', text: message }] });
  }
  private async turn(id: string, message: string, resume: boolean) {
    requireExternalExecution(this.permissionMode(), this.allowExec(), this.executionEnabled());
    if (this.active.has(id) || this.starting.has(id)) throw new AgentError('此会话正在执行，请等待完成。', 409);
    this.starting.add(id);
    try {
      await this.connectRPC();
      if (resume) {
        const detail = await this.read(id);
        if (detail.turns?.at(-1)?.task.status === 'running') throw new AgentError('此会话正在原生客户端执行。', 409);
        await this.rpc.request('thread/resume', { threadId: id, approvalPolicy: 'never', sandbox: 'danger-full-access' });
      }
      requireExternalExecution(this.permissionMode(), this.allowExec(), this.executionEnabled());
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
