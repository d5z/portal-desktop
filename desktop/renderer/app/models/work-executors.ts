import { workPlanVersionHeader, type WorkModelSelection } from '../../../shared/work';
import { deepseekUploadPath, workImageMime } from '../../../shared/work-attachments';

export type WorkModelGroup = { id: string; name: string; models: { id: string; name: string }[] };

/** Adapter UI transports preserve each native API's method, resource path and request body. */
export interface WorkExecutorTransport {
  models(signal: AbortSignal): Promise<WorkModelGroup[]>;
  start(directory: string, message: string, modelSelection?: WorkModelSelection, files?: readonly File[]): Promise<string>;
  send(id: string, message: string, options?: { planVersion?: string; files?: readonly File[] }): Promise<void>;
  steer(id: string, message: string, files: readonly File[], turnId?: string): Promise<void>;
  readImage?(id: string, reference: unknown, signal: AbortSignal): Promise<string | null>;
  cancel(id: string, turnId?: string): Promise<void>;
}
function attachmentDataURL(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`无法读取附件 ${file.name}。`));
    reader.readAsDataURL(file);
  });
}
export function workPromptImages(files: readonly File[]) {
  return Promise.all(files.map(async file => ({
    name: file.name, mediaType: file.type, data: (await attachmentDataURL(file)).split(',', 2)[1],
  })));
}
export function workExecutors(endpoint: string, sceneId?: string): Record<string, WorkExecutorTransport> {
  const call = async (agent: string, method: string, body: object, signal?: AbortSignal, planVersion?: string) => {
    const upload = body instanceof Blob;
    const response = await fetch(`beings://${agent}/${agent === 'deepseek' ? 'api/' : ''}${method}`, {
      method: 'POST',
      headers: { 'Content-Type': upload ? 'application/octet-stream' : 'application/json', 'X-Being-Endpoint': endpoint, ...(sceneId ? { 'X-Work-Scene': sceneId } : {}),
        ...(planVersion ? { [workPlanVersionHeader]: planVersion } : {}) },
      body: upload ? body : JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      if (agent === 'codex' && method === 'thread/resume' && response.status === 502 &&
        (await response.text()).includes('already has an active writer')) {
        throw new Error('此 Codex 会话已被另一个进程加载。草稿已保留，请在会话释放后重试。');
      }
      throw new Error(`${agent} 请求失败（${response.status}），请在 Network 查看原始响应。`);
    }
    return response.json();
  };
  const codex = (method: string, body: object, signal?: AbortSignal, planVersion?: string) => call('codex', method, body, signal, planVersion);
  const deepseek = async (method: string, request?: object, signal?: AbortSignal, planVersion?: string) => {
    const value = await call('deepseek', method, { type: 'client-request', rpcId: crypto.randomUUID(), method, payload: { args: method === 'commands/execute' ? request : request ? { request } : {} } }, signal, planVersion);
    if (!value.result.ok) throw new Error(value.result.error.message);
    return value.result.value;
  };
  const codexInput = async (message: string, files: readonly File[]) => [
    ...(message ? [{ type: 'text', text: message }] : []),
    ...await Promise.all(files.map(async file => ({ type: 'image' as const, url: await attachmentDataURL(file) }))),
  ];
  const codexSend = async (id: string, input: Awaited<ReturnType<typeof codexInput>>, planVersion?: string) => {
    await codex('turn/start', { threadId: id, input, approvalPolicy: 'never', sandboxPolicy: { type: 'dangerFullAccess' } }, undefined, planVersion);
  };
  const deepseekSend = async (id: string, message: string, files: readonly File[], mode: 'queue' | 'steer', planVersion?: string) => {
    const content: ({ type: 'text'; text: string } | { type: 'file'; receiptId: string })[] = message ? [{ type: 'text', text: message }] : [];
    for (const file of files) {
      const query = new URLSearchParams({ sessionId: id, name: file.name });
      if (workImageMime.test(file.type)) query.set('mediaType', file.type);
      const uploaded = await call('deepseek', deepseekUploadPath.slice('/api/'.length) + '?' + query, file);
      if (!uploaded.ok) throw new Error(uploaded.error.message);
      content.push({ type: 'file', receiptId: uploaded.value.receiptId });
    }
    const permission = await deepseek('commands/execute', { agentId: id, line: '/permission danger-full-access', submittedAttachments: [] });
    if (permission?.result.kind !== 'success') throw new Error(permission?.result.text || '无法同步客户端权限。');
    await deepseek('session/prompt', { sessionId: id, requestId: crypto.randomUUID(), mode, content }, undefined, planVersion);
  };
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
      async start(directory, message, modelSelection, files = []) {
        const input = await codexInput(message, files);
        let project: { id: string; roots: { path: string }[] } | undefined;
        let cursor: string | null = null;
        do {
          const page = await codex('project/list', { limit: 100, cursor });
          project = page.data.find((p: { roots: { path: string }[] }) => p.roots.some(root => root.path === directory)); cursor = page.nextCursor;
        } while (!project && cursor);
        project ??= (await codex('project/create', { name: directory.split(/[\\/]/).at(-1) || directory, roots: [{ path: directory }], idempotencyKey: `town:${directory}` })).project;
        const { thread } = await codex('thread/start', { cwd: directory, projectId: project!.id, ephemeral: false, approvalPolicy: 'never', sandbox: 'danger-full-access', model: modelSelection?.model });
        await codexSend(thread.id, input); return thread.id;
      },
      async send(id, message, { planVersion, files = [] } = {}) {
        const input = await codexInput(message, files);
        await codex('thread/resume', { threadId: id, approvalPolicy: 'never', sandbox: 'danger-full-access' });
        await codexSend(id, input, planVersion);
      },
      async steer(id, message, files, turnId) {
        if (!turnId) throw new Error('尚未同步当前 Codex 运行，请刷新会话后再追加附件。');
        await codex('turn/steer', { threadId: id, expectedTurnId: turnId, input: await codexInput(message, files) });
      },
      async cancel(id, turnId) {
        if (!turnId) throw new Error('尚未同步当前 Codex 运行，请刷新会话后再停止。');
        await codex('thread/backgroundTerminals/clean', { threadId: id });
        await codex('turn/interrupt', { threadId: id, turnId });
      },
    },
    deepseek: {
      async models(signal) {
        const { groups } = await deepseek('session/modelCatalog', undefined, signal);
        return groups;
      },
      async start(directory, message, modelSelection, files = []) {
        const { workspace } = await deepseek('workspace/create', { path: directory });
        const { sessionId } = await deepseek('session/create', { workspaceId: workspace.workspaceId });
        if (modelSelection) await deepseek('session/selectModel', { sessionId, ...modelSelection });
        await deepseekSend(sessionId, message, files, 'queue'); return sessionId;
      },
      send: (id, message, { planVersion, files = [] } = {}) => deepseekSend(id, message, files, 'queue', planVersion),
      steer: (id, message, files) => deepseekSend(id, message, files, 'steer'),
      async readImage(sessionId, attachment, signal) {
        const image = await deepseek('session/attachment', { sessionId, attachment }, signal);
        return workImageMime.test(image.attachment.mediaType) ? `data:${image.attachment.mediaType};base64,${image.data}` : null;
      },
      async cancel(id) { await deepseek('session/cancel', { sessionId: id }); },
    },
  };
}
