import { workPlanVersionHeader, type WorkModelSelection } from '../../../shared/work';

export type WorkModelGroup = { id: string; name: string; models: { id: string; name: string }[] };

/** Adapter UI transports preserve each native API's method, resource path and request body. */
export interface WorkExecutorTransport {
  models(signal: AbortSignal): Promise<WorkModelGroup[]>;
  start(directory: string, message: string, modelSelection?: WorkModelSelection): Promise<string>;
  send(id: string, message: string, planVersion?: string): Promise<void>;
  cancel(id: string, turnId?: string): Promise<void>;
}
export function workExecutors(endpoint: string, sceneId?: string): Record<string, WorkExecutorTransport> {
  const call = async (agent: string, method: string, body: object, signal?: AbortSignal, planVersion?: string) => {
    const response = await fetch(`beings://${agent}/${agent === 'deepseek' ? 'api/' : ''}${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Being-Endpoint': endpoint, ...(sceneId ? { 'X-Work-Scene': sceneId } : {}),
        ...(planVersion ? { [workPlanVersionHeader]: planVersion } : {}) },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) throw new Error(`${agent} 请求失败（${response.status}），请在 Network 查看原始响应。`);
    return response.json();
  };
  const codex = (method: string, body: object, signal?: AbortSignal, planVersion?: string) => call('codex', method, body, signal, planVersion);
  const deepseek = async (method: string, request?: object, signal?: AbortSignal, planVersion?: string) => {
    const value = await call('deepseek', method, { type: 'client-request', rpcId: crypto.randomUUID(), method, payload: { args: method === 'commands/execute' ? request : request ? { request } : {} } }, signal, planVersion);
    if (!value.result.ok) throw new Error(value.result.error.message);
    return value.result.value;
  };
  const codexSend = async (id: string, message: string, planVersion?: string) => { await codex('turn/start', { threadId: id, input: [{ type: 'text', text: message }], approvalPolicy: 'never', sandboxPolicy: { type: 'dangerFullAccess' } }, undefined, planVersion); };
  const deepseekSend = async (id: string, message: string, planVersion?: string) => {
    const permission = await deepseek('commands/execute', { agentId: id, line: '/permission danger-full-access', submittedAttachments: [] });
    if (permission?.result.kind !== 'success') throw new Error(permission?.result.text || '无法同步客户端权限。');
    await deepseek('session/prompt', { sessionId: id, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: message }] }, undefined, planVersion); };
  return {
    codex: {
      async models(signal) {
        const models: WorkModelGroup['models'] = [];
        let cursor: string | null = null;
        do {
          const page: { data: { model: string; displayName: string; hidden: boolean }[]; nextCursor: string | null } = await codex('model/list', { cursor, limit: 100 }, signal);
          models.push(...page.data.filter(model => !model.hidden).map(model => ({ id: model.model, name: model.displayName })));
          cursor = page.nextCursor;
        } while (cursor);
        return [{ id: '', name: 'Codex', models }];
      },
      async start(directory, message, modelSelection) {
        let project: { id: string; roots: { path: string }[] } | undefined;
        let cursor: string | null = null;
        do {
          const page = await codex('project/list', { limit: 100, cursor });
          project = page.data.find((p: { roots: { path: string }[] }) => p.roots.some(root => root.path === directory)); cursor = page.nextCursor;
        } while (!project && cursor);
        project ??= (await codex('project/create', { name: directory.split(/[\\/]/).at(-1) || directory, roots: [{ path: directory }], idempotencyKey: `town:${directory}` })).project;
        const { thread } = await codex('thread/start', { cwd: directory, projectId: project!.id, ephemeral: false, approvalPolicy: 'never', sandbox: 'danger-full-access', model: modelSelection?.model });
        await codexSend(thread.id, message); return thread.id;
      },
      async send(id, message, planVersion) { await codex('thread/resume', { threadId: id, approvalPolicy: 'never', sandbox: 'danger-full-access' }); await codexSend(id, message, planVersion); },
      async cancel(id, turnId) {
        await codex('thread/backgroundTerminals/clean', { threadId: id });
        await codex('turn/interrupt', { threadId: id, turnId });
      },
    },
    deepseek: {
      async models(signal) {
        const { groups } = await deepseek('session/modelCatalog', undefined, signal);
        return groups;
      },
      async start(directory, message, modelSelection) {
        const { workspace } = await deepseek('workspace/create', { path: directory });
        const { sessionId } = await deepseek('session/create', { workspaceId: workspace.workspaceId });
        if (modelSelection) await deepseek('session/selectModel', { sessionId, ...modelSelection });
        await deepseekSend(sessionId, message); return sessionId;
      },
      send: deepseekSend,
      async cancel(id) { await deepseek('session/cancel', { sessionId: id }); },
    },
  };
}
