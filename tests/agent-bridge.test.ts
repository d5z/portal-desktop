import { expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { chmod, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { AgentBridge, mergeProjects } from '../desktop/main/agent-bridge/registry';
import { AgentError, type AgentAdapter } from '../desktop/main/agent-bridge/types';
import { CodexAdapter, codexDetail } from '../desktop/main/agent-bridge/codex';
import { JsonRpcProcess } from '../desktop/main/agent-bridge/json-rpc';
import { deepseekDetail } from '../desktop/main/agent-bridge/deepseek';
import { WorkNetwork } from '../desktop/main/portal/work-network';
import { workExecutors } from '../desktop/renderer/app/models/work-executors';
function adapter(id: string): AgentAdapter {
  return { id, name: id, status: async () => ({ id, name: id, available: true }), list: async () => ({ projects: [], tasks: [] }),
    start: vi.fn(async () => 'native-1'), send: vi.fn(async () => {}), cancel: vi.fn(async () => {}), read: vi.fn(async () => ({ taskId: `agent_${id}_native-1`, steps: [] })), close: vi.fn() };
}
it('routes independent executors and starts them concurrently without nesting', async () => {
  const a = adapter('codex'), b = adapter('deepseek');
  let finish!: () => void;
  a.start = vi.fn(() => new Promise<string>(resolve => { finish = () => resolve('a'); }));
  const bridge = new AgentBridge([a, b]);
  const first = bridge.start('codex', '/project-a', 'A');
  const modelSelection = { provider: 'deepseek-account', model: 'test-model' };
  expect(await bridge.start('deepseek', '/project-b', 'B', modelSelection)).toEqual({ task_id: 'agent_deepseek_native-1' });
  finish(); expect(await first).toEqual({ task_id: 'agent_codex_a' });
  expect(b.start).toHaveBeenCalledWith('/project-b', 'B', modelSelection);
});
it('keeps one failed adapter from hiding healthy sources', async () => {
  const a = adapter('codex'), b = adapter('deepseek');
  a.list = async () => { throw new AgentError('Disconnected'); };
  const result = await new AgentBridge([a, b]).snapshot();
  expect(result.agents.map(a => a.available)).toEqual([false, true]);
  a.status = async () => { throw new AgentError('Discovery failed'); };
  expect((await new AgentBridge([a, b]).snapshot()).agents).toMatchObject([{ available: false, message: 'Discovery failed' }, { available: true }]);
});
it('merges the same project directory while preserving the local registration', () => {
  const p = { id: 'local', name: 'A', directory: '/A', createdAt: 1 };
  expect(mergeProjects([p], [{ ...p, id: 'native' }])).toEqual([p]);
});
it('converts Codex history into independent turns with tool details and errors', () => {
  const result = codexDetail({ id: 'native', name: null, preview: '', cwd: '/a', projectId: null, createdAt: 1, updatedAt: 2, status: { type: 'idle' }, turns: [
    { id: 'one', status: 'completed', startedAt: 1, completedAt: 2, items: [{ id: 'u', type: 'userMessage', content: [{ type: 'text', text: 'A' }] }, { id: 't', type: 'commandExecution', command: 'echo A', status: 'completed', aggregatedOutput: 'A' }, { id: 'm', type: 'agentMessage', text: 'Done' }] },
    { id: 'two', status: 'failed', startedAt: 3, completedAt: 4, items: [], error: { message: 'Quota' } },
  ] });
  expect(result.turns?.map(t => t.task.status)).toEqual(['done', 'failed']);
  expect(result.turns?.[0].steps.map(s => s.kind)).toEqual(['started', 'tool', 'tool-result', 'message']);
  expect(result.turns?.[1].task.error).toBe('Quota');
});
it('does not report a detached Codex turn as interrupted without a recorded end', () => {
  const thread = { id: 'native', name: null, preview: '', cwd: '/a', projectId: null, createdAt: 1, updatedAt: 2,
    status: { type: 'notLoaded' }, turns: [
      { id: 'one', status: 'interrupted', startedAt: 1, completedAt: 2, items: [] },
      { id: 'two', status: 'interrupted', startedAt: 3, completedAt: null, items: [] },
    ] };
  expect(codexDetail(thread).turns?.map(t => t.task.status)).toEqual(['interrupted', 'unknown']);
  expect(codexDetail({ ...thread, status: { type: 'active' } }).turns?.map(t => t.task.status)).toEqual(['interrupted', 'running']);
  thread.turns[1].status = 'completed';
  thread.turns[1].completedAt = 4;
  expect(codexDetail(thread).turns?.map(t => t.task.status)).toEqual(['interrupted', 'done']);
});
it('retains DeepSeek user messages, tool calls and native terminal status', () => {
  const events = [ ['turn/start', { turn: 1 }], ['user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'B' }] }], ['tool/call', { callId: 't', name: 'write', arguments: '{}' }], ['tool/result', { message: { toolCallId: 't', content: [{ type: 'text', text: 'B' }], isError: false } }], ['assistant/message', { message: { content: [{ type: 'text', text: 'Done B' }] } }], ['turn/end', { reason: { kind: 'completed' } }]];
  const result = deepseekDetail('b', events.map(([type, data], seq) => ({ event: { type: type as string, data, seq, time: seq + 1 } })));
  expect(result.turns?.[0].task).toMatchObject({ status: 'done', userMessage: 'B', nativeId: 'b' });
  expect(result.turns?.[0].steps.at(-1)?.output).toBe('Done B');
});
it('preserves native HTTP failure body and rejects a foreign renderer origin', async () => {
  const a = adapter('deepseek'); a.native = async () => new Response('raw upstream failure', { status: 429, headers: { 'Content-Type': 'text/plain' } });
  const network = new WorkNetwork(() => 'beings://desktop/', () => ({ endpoint: 'one', directory: '/tmp' })); network.bridge = new AgentBridge([a]);
  const request = (origin: string) => new Request('beings://deepseek/api/session/prompt', { method: 'POST', headers: { Origin: origin, 'X-Being-Endpoint': 'one' }, body: '{}' });
  expect((await network.native(request('https://evil.test'))).status).toBe(403);
  const response = await network.native(request('beings://desktop'));
  expect(response.status).toBe(429); expect(await response.text()).toBe('raw upstream failure'); expect(response.headers.get('content-type')).toBe('text/plain');
});
it('reads the DeepSeek catalog and selects the model before submitting the first prompt', async () => {
  const calls: { url: string; body: any }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const value = url.endsWith('/modelCatalog') ? { groups: [{ id: 'provider', name: 'Provider', models: [{ id: 'model', name: 'Model' }] }] }
      : url.endsWith('/workspace/create') ? { workspace: { workspaceId: 'p' } } : url.endsWith('/session/create') ? { sessionId: 's' }
      : url.endsWith('/commands/execute') ? { result: { kind: 'success' } } : { accepted: true };
    return Response.json({ result: { ok: true, value } });
  }));
  try {
    const harness = workExecutors('being').deepseek;
    expect(await harness.models(new AbortController().signal)).toMatchObject([{ id: 'provider', models: [{ id: 'model' }] }]);
    expect(await harness.start('/a', '创建一个 HTML 页面', { provider: 'provider', model: 'model' })).toBe('s');
    expect(calls.map(c => c.url)).toEqual(['beings://deepseek/api/session/modelCatalog', 'beings://deepseek/api/workspace/create', 'beings://deepseek/api/session/create', 'beings://deepseek/api/session/selectModel', 'beings://deepseek/api/commands/execute', 'beings://deepseek/api/session/prompt']);
    expect(calls[0].body.payload.args).toEqual({});
    expect(calls[3].body.payload.args.request).toEqual({ sessionId: 's', provider: 'provider', model: 'model' });
    expect(calls[5].body.payload.args.request).toMatchObject({ sessionId: 's', mode: 'queue', content: [{ type: 'text', text: '创建一个 HTML 页面' }] });
    expect(JSON.stringify(calls)).not.toContain('scene_id');
  } finally { vi.unstubAllGlobals(); }
});

it('applies the approved full-access policy on both resume and turn start', async () => {
  const calls: { url: string; body: any }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return Response.json({}); }));
  try {
    await workExecutors('being').codex.send('native', 'continue');
    expect(calls[0]).toEqual({ url: 'beings://codex/thread/resume', body: { threadId: 'native', approvalPolicy: 'never', sandbox: 'danger-full-access' } });
    expect(calls[1].url).toBe('beings://codex/turn/start');
  } finally { vi.unstubAllGlobals(); }
});
it('cleans the stopped Codex session terminals before interrupt releases the thread, from both entry points', async () => {
  const calls: { url: string; body: any }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return Response.json({}); }));
  const start = vi.spyOn(JsonRpcProcess.prototype, 'start').mockImplementation(function (this: JsonRpcProcess) {
    this.notification('turn/started', { threadId: 'other', turn: { id: 'background' } });
  });
  const request = vi.spyOn(JsonRpcProcess.prototype, 'request').mockImplementation(async method =>
    method === 'turn/start' ? { turn: { id: 'turn', status: 'inProgress' } } as never : {} as never);
  const notify = vi.spyOn(JsonRpcProcess.prototype, 'notify').mockImplementation(() => {});
  const adapter = new CodexAdapter([process.execPath]);
  adapter.permissionMode = () => 'full-access';
  try {
    await workExecutors('being').codex.cancel('native', 'turn');
    expect(calls).toEqual([
      { url: 'beings://codex/thread/backgroundTerminals/clean', body: { threadId: 'native' } },
      { url: 'beings://codex/turn/interrupt', body: { threadId: 'native', turnId: 'turn' } },
    ]);
    await adapter.native(new Request('beings://codex/turn/start', { method: 'POST', body: JSON.stringify({
      threadId: 'native', input: [{ type: 'text', text: 'work' }], approvalPolicy: 'never', sandboxPolicy: { type: 'dangerFullAccess' },
    }) }));
    await adapter.cancel('native');
    expect(request.mock.calls.slice(-2)).toEqual([
      ['thread/backgroundTerminals/clean', { threadId: 'native' }],
      ['turn/interrupt', { threadId: 'native', turnId: 'turn' }],
    ]);
    request.mockRejectedValueOnce(new AgentError('native cleanup failure', 502, 'original error'));
    await expect(adapter.native(new Request('beings://codex/thread/backgroundTerminals/clean', { method: 'POST', body: JSON.stringify({ threadId: 'native' }) }))).rejects.toMatchObject({ body: 'original error' });
    await expect(adapter.native(new Request('beings://codex/thread/backgroundTerminals/clean', { method: 'POST', body: JSON.stringify({ threadId: 'native', command: 'untrusted' }) }))).rejects.toMatchObject({ status: 400 });
    await expect(adapter.native(new Request('beings://codex/turn/interrupt', { method: 'POST', body: JSON.stringify({ threadId: 'native', turnId: 'previous-turn' }) }))).rejects.toMatchObject({ status: 409 });
    await expect(adapter.native(new Request('beings://codex/thread/backgroundTerminals/clean', { method: 'POST', body: JSON.stringify({ threadId: 'other' }) }))).rejects.toMatchObject({ status: 409 });
  } finally { adapter.close(); start.mockRestore(); request.mockRestore(); notify.mockRestore(); vi.unstubAllGlobals(); }
});

it.skipIf(process.platform === 'win32')('starts persistent Codex threads in the project on the shared control socket', async () => {
  const home = await mkdtemp('/tmp/town-codex-rpc-');
  const socket = path.join(home, 'app-server-control/app-server-control.sock');
  const target = path.join(home, 'rpc.sock');
  await mkdir(path.dirname(socket));
  const server = createServer();
  const wss = new WebSocketServer({ server });
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const replies: Record<string, object> = {
    initialize: {},
    'project/list': { data: [{ id: 'native-project', roots: [{ path: '/work' }] }], nextCursor: null },
    'thread/list': { data: [], nextCursor: null },
    'thread/start': { thread: { id: 'native-thread', projectId: 'native-project' } },
    'turn/start': { turn: { id: 'turn', status: 'inProgress' } },
  };
  wss.on('connection', client => client.on('message', bytes => {
    const request = JSON.parse(bytes.toString());
    if (request.id === undefined) return;
    calls.push(request);
    client.send(JSON.stringify({ id: request.id, result: replies[request.method] }));
  }));
  await new Promise<void>(resolve => server.listen(target, resolve));
  await chmod(target, 0o600);
  await symlink(target, socket);
  vi.stubEnv('CODEX_HOME', home);
  const adapter = new CodexAdapter([process.execPath]);
  adapter.permissionMode = () => 'full-access';
  try {
    await expect(adapter.start('/work', 'Run this')).resolves.toBe('native-thread');
    expect(calls.find(call => call.method === 'thread/start')?.params).toMatchObject({ cwd: '/work', projectId: 'native-project', ephemeral: false });
    expect(calls.find(call => call.method === 'turn/start')?.params.threadId).toBe('native-thread');
  } finally {
    adapter.close(); vi.unstubAllEnvs();
    await new Promise<void>(resolve => server.close(() => resolve()));
    wss.close();
    await rm(home, { recursive: true, force: true });
  }
});
it('excludes Harness runtime context from user-visible conversation', () => {
  const records = [
    { event: { type: 'turn/start', seq: 1, time: 1, data: {} } },
    { event: { type: 'user/message', seq: 2, time: 2, data: { source: { kind: 'runtime-context' }, content: [{ type: 'text', text: 'private runtime hints' }] } } },
    { event: { type: 'user/message', seq: 3, time: 3, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'actual request' }] } } },
  ];
  expect(deepseekDetail('native', records).turns?.[0].task.userMessage).toBe('actual request');
});


it('rejects external execution under per-tool approval while leaving history readable', async () => {
  const { CodexAdapter } = await import('../desktop/main/agent-bridge/codex');
  const { DeepSeekAdapter } = await import('../desktop/main/agent-bridge/deepseek');
  for (const external of [new CodexAdapter([]), new DeepSeekAdapter('/missing')]) {
    await expect(external.start('/a', 'write')).rejects.toMatchObject({ status: 409 });
    await expect(external.send('native', 'write')).rejects.toMatchObject({ status: 409 });
    const read = vi.spyOn(external, 'read').mockResolvedValue({ taskId: 'native', steps: [] });
    await external.read('native'); expect(read).toHaveBeenCalled();
    external.close();
  }
});

it('stops a DeepSeek turn if permission sync fails or Town permission changes', async () => {
  const { DeepSeekAdapter } = await import('../desktop/main/agent-bridge/deepseek');
  const external = new DeepSeekAdapter('/missing');
  external.permissionMode = () => 'full-access';
  const call = vi.spyOn(external, 'call').mockResolvedValue({ result: { kind: 'error', text: 'cannot set permission' } });
  await expect(external.send('native', 'hello')).rejects.toThrow('cannot set permission');
  expect(call).toHaveBeenCalledTimes(1);
  call.mockImplementation(async () => { external.permissionMode = () => 'supervised'; return { result: { kind: 'success' } } as never; });
  await expect(external.send('native', 'hello')).rejects.toMatchObject({ status: 409 });
  expect(call).toHaveBeenCalledTimes(2);
});

it('fails pending requests on disconnect and ignores the previous process exit after reconnect', async () => {
  const { JsonRpcProcess } = await import('../desktop/main/agent-bridge/json-rpc');
  const rpc = new JsonRpcProcess();
  rpc.start(process.execPath, ['-e', 'process.stdin.resume()']);
  const old = rpc.request('start', {});
  const rejection = expect(old).rejects.toThrow('closed');
  rpc.close();
  rpc.start(process.execPath, ['-e', `require('readline').createInterface({input:process.stdin}).on('line', line => { const q = JSON.parse(line); console.log(JSON.stringify({id:q.id,result:q.params})); });`]);
  try {
    await rejection;
    expect(await Promise.all([rpc.request('one', 'A'), rpc.request('two', 'B')])).toEqual(['A', 'B']);
    expect(await rpc.request('after-old-exit', 'C')).toBe('C');
  } finally { rpc.close(); }
});

it('settles malformed protocol output and can connect again', async () => {
  const { JsonRpcProcess } = await import('../desktop/main/agent-bridge/json-rpc');
  const rpc = new JsonRpcProcess();
  rpc.start(process.execPath, ['-e', `process.stdin.once('data', () => console.log('bad json'));`]);
  await expect(rpc.request('read', {})).rejects.toThrow('invalid JSON-RPC');
  await expect(rpc.request('again', {})).rejects.toMatchObject({ status: 503 });
  rpc.close();
});


it('honors the client command-execution switch even with full access', async () => {
  const { CodexAdapter } = await import('../desktop/main/agent-bridge/codex');
  const { DeepSeekAdapter } = await import('../desktop/main/agent-bridge/deepseek');
  for (const external of [new CodexAdapter([]), new DeepSeekAdapter('/missing')]) {
    external.permissionMode = () => 'full-access';
    external.allowExec = () => false;
    await expect(external.start('/a', 'write')).rejects.toThrow('关闭命令执行');
    await expect(external.send('native', 'write')).rejects.toThrow('关闭命令执行');
    expect((await external.status()).canExecute).toBe(false);
    external.close();
  }
});
