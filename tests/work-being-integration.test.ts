import { expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ClientCommandServer } from '../desktop/main/chat/client-server';
import { WorkNetwork } from '../desktop/main/portal/work-network';
import { AgentBridge } from '../desktop/main/agent-bridge/registry';
import { AgentError, type AgentAdapter } from '../desktop/main/agent-bridge/types';
import type { SceneTask, SubagentTaskDetail } from '../desktop/shared/types';
import type { WorkModelSelection } from '../desktop/shared/work';

it('lets Being discover projects, launch independent executors, continue, cancel and collect complete histories through its authenticated command channel', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'work-being-')));
  const directories = [path.join(root, '中文 Project-A'), path.join(root, 'Project-B')];
  await Promise.all(directories.map(directory => mkdir(directory)));
  const tasks: SceneTask[] = [];
  const histories = new Map<string, SubagentTaskDetail>();
  const starts: { executor: string; directory: string; message: string; modelSelection?: WorkModelSelection }[] = [];
  let endpoint = 'fixture-being';
  const adapters: AgentAdapter[] = ['codex', 'deepseek'].map(executor => ({
    id: executor, name: executor, status: async () => ({ id: executor, name: executor, available: true, canExecute: true }),
    list: async () => ({ projects: [], tasks: tasks.filter(task => task.executor === executor) }),
    start: async (directory, message, modelSelection) => {
      const nativeId = `${executor}-${starts.length}`;
      const id = `agent_${executor}_${nativeId}`;
      starts.push({ executor, directory, message, modelSelection });
      tasks.push({ id, nativeId, executor, sceneId: '', workdir: directory, brief: message, status: 'running', createdAt: starts.length });
      histories.set(id, { taskId: id, steps: [{ at: 1, kind: 'tool', name: 'read', callId: id, input: 'welcome.html' }, { at: 2, kind: 'tool-result', callId: id, output: '完整中文🙂'.repeat(5000) + 'FIRST_RESULT_END' }] });
      return nativeId;
    },
    read: async id => histories.get(`agent_${executor}_${id}`)!,
    send: async (id, message) => {
      const task = tasks.find(task => task.nativeId === id)!;
      if (task.status === 'running') throw new AgentError('会话正在执行。', 409);
      histories.get(task.id)!.steps.push({ at: 3, kind: 'started', input: message }, { at: 4, kind: 'message', output: 'FOLLOWUP_PRIVATE_MARKER_917' });
    },
    cancel: async id => { tasks.find(task => task.nativeId === id)!.status = 'interrupted'; },
    close: () => {},
  }));
  const network = new WorkNetwork(() => 'beings://desktop/', () => ({ directory: root, endpoint }));
  network.bridge = new AgentBridge(adapters);
  network.readTasks = async () => ({ endpoint, tasks: [], subagentReady: true });
  network.sceneIds = () => ['calling-scene'];
  network.chooseProject = async suggested => suggested || null;
  const clientFile = path.join(root, 'client.json');
  const server = new ClientCommandServer(clientFile, () => endpoint, (request, signal) => network.context(request.args, signal, request.sceneId));
  try {
    await server.start();
    const { port, token } = JSON.parse(await readFile(clientFile, 'utf8'));
    const command = async (args: string) => {
      const response = await fetch(`http://127.0.0.1:${port}/command`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ endpoint, verb: 'work', args, sceneId: 'calling-scene' }) });
      expect(response.status).toBe(200);
      return response.json() as Promise<{ text?: string; error?: string }>;
    };
    expect(JSON.parse((await command('add-project')).text!)).toEqual({ cancelled: true });
    for (const directory of directories) await command(`add-project ${JSON.stringify({ directory })}`);
    const projects = JSON.parse((await command('projects')).text!).projects.sort((a: { directory: string }, b: { directory: string }) => directories.indexOf(a.directory) - directories.indexOf(b.directory));
    expect(projects.map((project: { directory: string }) => project.directory)).toEqual(directories);
    expect(JSON.parse((await command('agents')).text!)).toMatchObject([
      { id: 'internal', available: true, canExecute: true }, { id: 'codex' }, { id: 'deepseek' },
    ]);
    const goal = JSON.parse((await command(`create-goal ${JSON.stringify({
      title: '线下活动工具包', outcome: '让志愿者离线查找信息', acceptanceCriteria: ['手机可读'], status: 'active',
    })}`)).text!);
    await command(`link-project ${JSON.stringify({ project_id: projects[1].id, goal_id: goal.id })}`);
    expect((await command(`create ${JSON.stringify({ title: '无效优先级', projectId: projects[1].id, priority: 'invalid' })}`)).error)
      .toContain('请检查工作标题、描述和属性');
    const models = [{ model: 'codex-fixture' }, { provider: 'deepseek-account', model: 'deepseek-fixture' }];
    const planned = await Promise.all(projects.map(async (project: { id: string }, index: number) => {
      const fields = { title: ['生成欢迎页', '生成说明页'][index], description: '生成带分类筛选、计数与空态的自包含 HTML 页面。', projectId: project.id,
        executor: ['codex', 'deepseek'][index], modelSelection: models[index] };
      const payload = JSON.stringify(fields);
      return JSON.parse((await command(`create ${index ? JSON.stringify(payload) : payload}`)).text!);
    }));
    expect(planned.map(item => [item.stage, item.executor, item.runIds])).toEqual([['todo', 'codex', []], ['todo', 'deepseek', []]]);
    expect(planned[1]).toMatchObject({ priority: 'none', labels: [], dueDate: '', parentId: '' });
    const { modelSelection: _selection, ...legacyFields } = planned[0];
    await command(`update ${JSON.stringify({ ...legacyFields, item_id: planned[0].id })}`);
    expect(starts).toHaveLength(0);
    const extraInstruction = '志愿者需要离线查看。完成后请用 Markdown 链接列出交付文件。';
    const receipts = await Promise.all(['codex', 'deepseek'].map((executor, index) => {
      const payload = JSON.stringify({ item_id: planned[index].id, executor, ...(index && { request_id: 'after-prior-run', instruction: extraInstruction }) });
      return command(`run ${index ? `'${payload}'` : payload}`);
    }));
    const ids = receipts.map(receipt => JSON.parse(receipt.text!).task_id as string);
    const repeated = await command(`run ${JSON.stringify({ item_id: planned[1].id, executor: 'deepseek', request_id: 'after-prior-run' })}`);
    expect(JSON.parse(repeated.text!)).toMatchObject({ task_id: ids[1], status: 'started' });
    expect(starts).toHaveLength(2);
    expect(starts.find(start => start.executor === 'codex')?.directory).toBe(directories[0]);
    expect(starts.find(start => start.executor === 'deepseek')?.directory).toBe(directories[1]);
    expect(starts.find(start => start.executor === 'codex')?.message).toBe('生成欢迎页\n\n生成带分类筛选、计数与空态的自包含 HTML 页面。');
    expect(starts.find(start => start.executor === 'deepseek')?.message).toBe(`生成说明页\n\n生成带分类筛选、计数与空态的自包含 HTML 页面。\n\n${extraInstruction}`);
    expect(['codex', 'deepseek'].map(executor => starts.find(start => start.executor === executor)?.modelSelection)).toEqual(models);
    const snapshot = await network.snapshot();
    expect(ids.map(id => snapshot.tasks.find(task => task.id === id)?.projectId)).toEqual(projects.map((project: { id: string }) => project.id));
    expect(planned.map((item, index) => snapshot.items?.find(row => row.id === item.id)?.runIds.includes(ids[index]))).toEqual([true, true]);
    expect((await command(`send ${JSON.stringify({ task_id: ids[0], message: 'Premature continuation' })}`)).error).toContain('会话正在执行');
    tasks.find(task => task.id === ids[0])!.status = 'done'; network.bridge.invalidate();
    await command(`send ${JSON.stringify({ task_id: ids[0], message: 'Actual follow-up from Being' })}`);
    await command(`cancel ${JSON.stringify({ task_id: ids[1] })}`);
    const cancelled = JSON.parse((await command(ids[1])).text!);
    // Large histories are immutable JSON text pages, including partial cancelled output.
    expect(cancelled.next).toContain('@work context ');
    let page = JSON.parse((await command(ids[0])).text!);
    let text = page.content, pageCount = 1;
    while (page.next) {
      page = JSON.parse((await command(page.next.slice('@work '.length))).text!);
      text += page.content; pageCount++;
    }
    const collected = JSON.parse(text);
    expect(pageCount).toBeGreaterThan(2);
    expect(collected.conversation[0].steps[1].output).toBe('完整中文🙂'.repeat(5000) + 'FIRST_RESULT_END');
    expect(collected.conversation[0].steps.at(-1).output).toBe('FOLLOWUP_PRIVATE_MARKER_917');
    expect(collected.conversation[0].steps.at(-2).input).toBe('Actual follow-up from Being');
    expect(collected.tasks[0].status).toBe('done');
    const project = JSON.parse((await command(`project ${projects[1].id}`)).text!);
    expect(project.tasks.map((task: SceneTask) => [task.id, task.status])).toEqual([[ids[1], 'interrupted']]);
    expect((await command(`start ${JSON.stringify({ executor: 'codex', workdir: root, brief: 'Unregistered directory' })}`)).error).toContain('请先添加此项目目录');
    expect(starts).toHaveLength(2);
    expect((await command('agent_codex_unknown')).error).toContain('不存在');
    const beforeSwitch = page;
    endpoint = 'other-being';
    expect((await command(ids[0])).error).toContain('不存在');
    expect((await command(`context ${JSON.stringify({ snapshot: beforeSwitch.snapshot, offset: 0 })}`)).error).toContain('已过期');
    expect(starts).toHaveLength(2);
  } finally { await server.close(); network.bridge.close(); await rm(root, { recursive: true, force: true }); }
});
