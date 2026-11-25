import type { PermissionMode } from '../../shared/security';
import { externalApprovalNotice, externalExecNotice, requireExternalExecution } from './permissions';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { SceneTask, SubagentTaskDetail } from '../../shared/types';
import type { WorkModelSelection } from '../../shared/work';
import { AgentError, agentTaskId, type AgentAdapter } from './types';
import { installDeepSeekDiscovery } from './deepseek-discovery';

type Workspace = { workspaceId: string; title: string; path: string; createdAt: string; sessionIds: string[] };
type Session = { sessionId: string; cwd?: string; updatedAt: number; running: boolean; blank: boolean; origin?: string; parentSessionId?: string; projections?: { values: Record<string, any> } };
type RecordEntry = { event: { type: string; seq: number; time: number; data: any } };
export function deepseekDetail(id: string, records: RecordEntry[]): SubagentTaskDetail {
  const taskId = agentTaskId('deepseek', id);
  const turns: NonNullable<SubagentTaskDetail['turns']> = [];
  for (const { event } of records) {
    const { type, time: at, data, seq } = event;
    if (type === 'turn/start' || (!turns.length && type === 'user/message')) turns.push({ task: { id: `${taskId}:${seq}`, executor: 'deepseek', nativeId: id, sceneId: '', createdAt: at, status: 'running' }, steps: [] });
    const turn = turns.at(-1);
    if (!turn) continue;
    const text = (content: { type: string; text?: string }[] = []) => content.filter(c => c.type === 'text').map(c => c.text || '').join('\n');
    if (type === 'user/message' && data.source?.kind === 'user') {
      const input = text(data.content);
      turn.task.userMessage = [turn.task.userMessage, input].filter(Boolean).join('\n');
      turn.steps.push({ at, kind: 'started', input, requestId: data.source.rpcId });
    }
    if (type === 'assistant/message') {
      for (const part of data.message.content) {
        if (part.type === 'text') turn.steps.push({ at, kind: 'message', output: part.text });
        if (part.type === 'thinking' || part.type === 'reasoning') turn.steps.push({ at, kind: 'thinking', output: part.text || part.thinking });
      }
    }
    if (type === 'tool/call') turn.steps.push({ at, kind: 'tool', callId: data.callId, name: data.name, input: typeof data.arguments === 'string' ? data.arguments : JSON.stringify(data.arguments) });
    if (type === 'tool/result') turn.steps.push({ at, kind: 'tool-result', callId: data.message.toolCallId, output: text(data.message.content), failed: data.message.isError });
    if (type === 'turn/end') { turn.task.endedAt = at; turn.task.status = data.reason.kind === 'completed' ? 'done' : data.reason.kind === 'error' ? 'failed' : 'interrupted'; turn.task.error = data.reason.error?.message; }
  }
  return { taskId, steps: [], turns, records: records.filter(({ event }) => event.type === 'user/message' ? event.data.source?.kind === 'user' : ['assistant/message', 'tool/call', 'tool/result', 'turn/start', 'turn/end', 'command/run', 'command/done', 'sandbox/mode', 'approval/policy'].includes(event.type)) };
}

/** Connects to the existing native Harness host, never through the Codex adapter. */
export class DeepSeekAdapter implements AgentAdapter {
  allowExec: () => boolean = () => true;
  permissionMode: () => PermissionMode = () => 'supervised';
  readonly id = 'deepseek'; readonly name = 'DeepSeek Harness';
  private auth?: { pid: number; origin: string; cookie: string };
  private workspaces: Workspace[] = [];
  private archived: string[] = [];
  private socket?: WebSocket;
  private opening?: Promise<void>;
  private summaries = new Map<string, { revision: number; status: SceneTask['status'] }>();
  private starting = new Set<string>();
  private prepared = new Set<string>();
  constructor(readonly home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')) {}
  async status() {
    const available = await access(path.join(this.home, 'town-bridge/host.json')).then(() => true, () => false);
    return { id: this.id, name: this.name, available, canExecute: this.allowExec() && this.permissionMode() === 'full-access', message: available ? (!this.allowExec() ? externalExecNotice : this.permissionMode() === 'full-access' ? undefined : externalApprovalNotice) : '连接后重启 DeepSeek Harness，再选择需要导入的项目和会话。' };
  }
  async connect() { await installDeepSeekDiscovery(this.home); }
  private async connection() {
    const discovery = JSON.parse(await readFile(path.join(this.home, 'town-bridge/host.json'), 'utf8'));
    const url = new URL(discovery.url);
    if (discovery.version !== 1 || !Number.isInteger(discovery.pid) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.protocol !== 'http:') throw new AgentError('DeepSeek 本机连接信息无效。', 503);
    process.kill(discovery.pid, 0);
    if (this.auth?.pid !== discovery.pid) {
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
      const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
      if (response.status !== 303 || !cookie) throw new AgentError('DeepSeek 本机认证失败。', response.status, await response.text(), response.headers.get('content-type') || 'text/plain');
      this.socket?.close(); this.opening = undefined;
      this.auth = { pid: discovery.pid, origin: url.origin, cookie };
    }
    return this.auth!;
  }
  async native(request: Request) {
    const method = new URL(request.url).pathname.slice('/api/'.length);
    const input = await request.json();
    const command = method === 'commands/execute';
    const catalog = method === 'session/modelCatalog';
    const args = input.payload?.args;
    const keys: Record<string, string[]> = { 'workspace/create': ['path'], 'session/create': ['workspaceId'], 'session/modelCatalog': [], 'session/selectModel': ['sessionId', 'provider', 'model'], 'session/prompt': ['sessionId', 'requestId', 'mode', 'content'], 'session/cancel': ['sessionId'], 'commands/execute': ['agentId', 'line', 'submittedAttachments'] };
    if (!Object.hasOwn(keys, method) || input.method !== method || input.type !== 'client-request' || !args || (!command && !catalog && !args.request)) throw new AgentError('DeepSeek 请求无效。', 400);
    const value = command || catalog ? args : args.request;
    if (Object.keys(value).some(key => !keys[method].includes(key))) throw new AgentError('DeepSeek 请求字段无效。', 400);
    if (!catalog && method !== 'session/cancel') requireExternalExecution(this.permissionMode(), this.allowExec());
    if (command && (typeof value.agentId !== 'string' || value.line !== '/permission danger-full-access' || !Array.isArray(value.submittedAttachments) || value.submittedAttachments.length)) throw new AgentError('DeepSeek 权限请求无效。', 400);
    if (method === 'session/prompt' && !this.prepared.delete(value.sessionId)) throw new AgentError('请先同步客户端权限后重新发送。', 409);
    const auth = await this.connection();
    if (!catalog && method !== 'session/cancel') requireExternalExecution(this.permissionMode(), this.allowExec());
    const response = await fetch(`${auth.origin}/api/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: auth.cookie }, body: JSON.stringify(input), signal: request.signal, redirect: 'error' });
    if (command && response.ok) {
      const result = await response.clone().json();
      if (result.result?.ok && result.result.value?.result.kind === 'success') this.prepared.add(value.agentId);
    }
    return response;
  }

  async call<T>(method: string, request: object): Promise<T> {
    const auth = await this.connection();
    const response = await fetch(`${auth.origin}/api/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: auth.cookie },
      body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload: { args: method === 'commands/execute' ? request : method === 'session/list' ? { _request: request } : { request } } }), signal: AbortSignal.timeout(30000) });
    const body = await response.text();
    if (!response.ok) throw new AgentError('DeepSeek 请求失败。', response.status, body, response.headers.get('content-type') || 'application/json');
    const data = JSON.parse(body);
    if (!data.result?.ok) throw new AgentError(data.result?.error?.message || 'DeepSeek RPC failed.', 502, body);
    return data.result.value;
  }
  private async followWorkspaces() {
    const auth = await this.connection();
    return this.opening ??= new Promise<void>((resolve, reject) => {
      const socket = this.socket = new WebSocket(`${auth.origin.replace('http:', 'ws:')}/api/remote.mux`, { headers: { Cookie: auth.cookie } });
      const timer = setTimeout(() => { socket.close(); reject(new AgentError('DeepSeek 项目同步超时。', 504)); }, 10000);
      socket.on('open', () => socket.send(JSON.stringify({ type: 'open', streamId: 'town-workspaces', endpoint: 'workspace/follow', payload: { args: {} } })));
      socket.on('message', bytes => {
        const envelope = JSON.parse(bytes.toString());
        const frame = envelope.value;
        if (!frame) return;
        if (frame.type === 'baseline' || frame.type === 'replace') { this.workspaces = frame.value.items; this.archived = frame.value.archivedSessionIds; clearTimeout(timer); resolve(); }
        if (frame.type === 'upsert') this.workspaces = [...this.workspaces.filter(p => p.workspaceId !== frame.workspace.workspaceId), frame.workspace];
        if (frame.type === 'remove') this.workspaces = this.workspaces.filter(p => p.workspaceId !== frame.workspaceId);
        if (frame.type === 'archived') this.archived = frame.archivedSessionIds;
      });
      socket.on('error', error => { clearTimeout(timer); reject(error); });
      socket.on('close', () => { clearTimeout(timer); this.opening = undefined; reject(new AgentError('DeepSeek 连接已断开。', 503)); });
    });
  }
  async list(selectedIds = new Set<string>()) {
    await this.followWorkspaces();
    const { items } = await this.call<{ items: Session[] }>('session/list', {});
    await Promise.all(items.filter(s => selectedIds.has(s.sessionId) && !s.running && !s.blank && !s.parentSessionId && s.origin !== 'subagent').map(async session => {
      const revision = session.projections?.values.sessionListMetadata?.lastPromptAt || session.updatedAt;
      const previous = this.summaries.get(session.sessionId);
      if (previous?.revision === revision) return;
      const page = await this.call<{ records: RecordEntry[] }>('session/page', { address: { kind: 'session', sessionId: session.sessionId }, maxMessages: 1 });
      const end = [...page.records].reverse().find(record => record.event.type === 'turn/end');
      const reason = end?.event.data.reason.kind;
      if (reason) this.summaries.set(session.sessionId, { revision, status: reason === 'completed' ? 'done' : reason === 'error' ? 'failed' : 'interrupted' });
    }));
    return { projects: this.workspaces.map(p => ({ id: `deepseek_project_${p.workspaceId}`, executor: this.id, nativeId: p.workspaceId, name: p.title, directory: p.path, createdAt: Date.parse(p.createdAt) })),
      tasks: items.filter(s => !s.parentSessionId && s.origin !== 'subagent' && !this.archived.includes(s.sessionId)).map<SceneTask>(session => ({ id: agentTaskId(this.id, session.sessionId), executor: this.id, nativeId: session.sessionId, session: session.sessionId, sceneId: '', projectId: this.workspaces.find(p => p.sessionIds.includes(session.sessionId)) ? `deepseek_project_${this.workspaces.find(p => p.sessionIds.includes(session.sessionId))!.workspaceId}` : undefined, workdir: session.cwd, createdAt: session.updatedAt,
        status: session.running ? 'running' : this.summaries.get(session.sessionId)?.status || 'done', brief: session.projections?.values.title?.text || session.projections?.values.title || 'DeepSeek 对话' })) };
  }
  async read(id: string) {
    const records: RecordEntry[] = [];
    let beforeSeq: number | undefined;
    let throughSeq: number | undefined;
    let more = true;
    while (more) {
      const page: { records: RecordEntry[]; hasMore: boolean; cursor: number } = await this.call('session/page', { address: { kind: 'session', sessionId: id }, maxMessages: 100, beforeSeq, throughSeq });
      records.unshift(...page.records); more = page.hasMore; throughSeq = page.cursor; beforeSeq = page.records[0]?.event.seq;
    }
    return deepseekDetail(id, records);
  }
  async start(directory: string, message: string, modelSelection?: WorkModelSelection, onCreated?: (nativeId: string) => Promise<void>) {
    requireExternalExecution(this.permissionMode(), this.allowExec());
    const { workspace } = await this.call<{ workspace: Workspace }>('workspace/create', { path: directory });
    const { sessionId } = await this.call<{ sessionId: string }>('session/create', { workspaceId: workspace.workspaceId });
    if (modelSelection) await this.call('session/selectModel', { sessionId, ...modelSelection });
    await onCreated?.(sessionId);
    await this.send(sessionId, message);
    return sessionId;
  }
  async steer(id: string, message: string) { await this.send(id, message, 'steer'); }
  async send(id: string, message: string, mode: 'queue' | 'steer' = 'queue') {
    requireExternalExecution(this.permissionMode(), this.allowExec());
    if (this.starting.has(id)) throw new AgentError('消息正在提交。', 409);
    this.starting.add(id);
    try {
      const permission = await this.call<{ result: { kind: string; text?: string } } | null>('commands/execute', { agentId: id, line: '/permission danger-full-access', submittedAttachments: [] });
      if (permission?.result.kind !== 'success') throw new AgentError(permission?.result.text || 'DeepSeek 无法同步客户端权限。', 409);
      requireExternalExecution(this.permissionMode(), this.allowExec());
      const requestId = randomUUID();
      await this.call('session/prompt', { sessionId: id, requestId, mode, content: [{ type: 'text', text: message }] });
      return { requestId };
    } finally { this.starting.delete(id); }
  }
  async cancel(id: string) { await this.call('session/cancel', { sessionId: id }); }
  close() { this.prepared.clear(); this.socket?.close(); this.opening = undefined; this.auth = undefined; }
}
