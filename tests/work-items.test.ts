import { expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkNetwork } from '../desktop/main/portal/work-network';
import { WorkItems } from '../desktop/main/portal/work-items';
import { AgentBridge } from '../desktop/main/agent-bridge/registry';
import { AgentError, type AgentAdapter } from '../desktop/main/agent-bridge/types';
import type { SceneTask, SubagentTaskDetail } from '../desktop/shared/types';
import type { WorkItem, WorkItemFields } from '../desktop/shared/work';

it.each(['internal', 'codex', 'deepseek'])('reconciles an accepted %s launch and preserves the goal revisions of both HTML deliveries', async executor => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'work-reconcile-')));
  const endpoint = 'fixture';
  const runtime = () => ({ directory, pid: 7, endpoint });
  const root = executor === 'internal' ? 'sub_fixture' : `agent_${executor}_native`;
  const results = new Map<string, SubagentTaskDetail>();
  const tasks: SceneTask[] = [];
  const html = path.join(directory, '议程 (活动).html');
  const related = path.join(directory, 'sign-in.html');
  let followUp = '';
  const createTask = (id: string, session: string, parentTaskId?: string) => {
    const task: SceneTask = { id, session, parentTaskId, workdir: directory, sceneId: 'scene', status: 'running', createdAt: Date.now() };
    tasks.push(task);
    return task;
  };
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith('/results')) return Response.json({ delivered: true });
    if (String(url).endsWith('/messages')) {
      followUp = JSON.parse(String(init?.body)).message;
      createTask('sub_followup', tasks[0].session!, root);
      return Response.json({ task_id: 'sub_followup' });
    }
    const key = new Headers(init?.headers).get('X-Work-Launch');
    expect(key).toMatch(/^[a-f0-9-]{36}$/);
    createTask(root, `work-${key}`);
    return new Response('accepted then gateway timed out', { status: 504, headers: { 'Content-Type': 'text/plain' } });
  });
  const turns: NonNullable<SubagentTaskDetail['turns']> = [];
  const nativeStart = vi.fn<AgentAdapter['start']>(async (_directory, message, _model, onCreated) => {
    await onCreated?.('native');
    const task = createTask(root, 'native');
    turns.push({ task: { ...task, id: `${root}:first` }, steps: [{ at: task.createdAt, kind: 'started', input: message }] });
    throw new AgentError('accepted then gateway timed out', 504);
  });
  const bridge = new AgentBridge([{
    id: executor, name: executor, status: async () => ({ id: executor, name: executor, available: true }),
    list: async () => ({ projects: [], tasks: tasks.map(task => ({ ...task, executor, nativeId: 'native' })) }),
    start: nativeStart, read: async () => ({ taskId: root, steps: [], turns }),
    send: async (_id, message) => { followUp = message; return { turnId: 'second' }; }, cancel: async () => {}, close: () => {},
  }]);
  const createNetwork = () => {
    const network = new WorkNetwork(() => 'beings://desktop/', runtime, fetcher);
    network.sceneIds = () => ['scene'];
    network.readTasks = async () => ({ endpoint, tasks: executor === 'internal' ? tasks : [], subagentReady: true });
    network.readDetails = async (_endpoint, ids) => ids.flatMap(id => results.get(id) || []);
    if (executor !== 'internal') network.bridge = bridge;
    return network;
  };
  let network = createNetwork();
  const request = (url: string, method = 'GET', body?: object, headers?: Record<string, string>) => network.handle(new Request(`beings://desktop/api/${url}`, {
    method, headers: { 'X-Being-Endpoint': endpoint, 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body),
  }));
  try {
    await writeFile(path.join(directory, '.portal-ready.json'), JSON.stringify({ pid: 7, nonce: 'fixture' }));
    await writeFile(path.join(directory, '.portal-work.json'), JSON.stringify({ pid: 7, nonce: 'fixture', port: 4321, token: 'fixture' }));
    const goalFields = { title: '筹备社区开放日', outcome: '离线管理开放日', acceptanceCriteria: ['志愿者能在手机查看'], status: 'active' };
    const goal = JSON.parse(await network.context(`create-goal ${JSON.stringify(goalFields)}`, undefined, 'scene'));
    expect(goal).toMatchObject({ version: 1, work_url: `beings://work/${goal.id}` });
    expect(JSON.parse(await network.context('goals'))).toMatchObject([{ id: goal.id }]);
    const project = await (await request('subagent/projects', 'POST', { directory })).json();
    expect(project.goalId).toBeUndefined();
    const linked = JSON.parse(await network.context(`link-project ${JSON.stringify({ project_id: project.id, goal_id: goal.id })}`));
    expect(linked).toMatchObject({ id: project.id, goalId: goal.id });
    const plan = { title: '会议议程', description: '', executor, projectId: project.id, stage: 'todo', priority: 'none', labels: [], dueDate: '', parentId: '',
      goal: '离线浏览议程', specification: '带分类筛选', acceptanceCriteria: ['有空态'] };
    const item = await (await request('work/items', 'POST', plan)).json();
    const launch = await request(`work/items/${item.id}/runs`, 'POST', { scene_id: 'scene' });
    expect(launch.status).toBe(504);
    if (executor === 'internal') expect(await launch.text()).toBe('accepted then gateway timed out');
    const launchedPrompt = executor === 'internal' ? JSON.parse(String(fetcher.mock.calls[0][1]?.body)).brief : nativeStart.mock.calls[0][1];
    expect(launchedPrompt).toBe('会议议程\n\n任务目标：离线浏览议程\n\n规格：带分类筛选\n\n验收标准：\n- 有空态');
    const changedGoal = { ...goalFields, goal_id: goal.id, expectedVersion: 1, outcome: '增加无障碍筛选提示' };
    expect(JSON.parse(await network.context(`update-goal ${JSON.stringify(changedGoal)}`))).toMatchObject({ version: 2 });
    expect((await request(`work/goals/${goal.id}`, 'PATCH', changedGoal)).status).toBe(409);
    network = createNetwork();
    bridge.invalidate();
    const recovered = await (await request(`work/items/${item.id}/dispatch`)).json();
    expect(recovered).toMatchObject({ task_id: root, status: 'started', stage: 'in_progress' });
    expect(await (await request(`work/items/${item.id}/runs`, 'POST', { scene_id: 'scene' })).json()).toMatchObject({ task_id: root, status: 'started' });
    expect(tasks).toHaveLength(1);
    expect(executor === 'internal' ? fetcher : nativeStart).toHaveBeenCalledTimes(1);
    expect((await request('work/items/batch', 'POST', { ids: [item.id], stage: 'done' })).status).toBe(409);
    expect((await request('work/items/order', 'POST', { id: item.id, before: '', stage: 'done' })).status).toBe(409);
    expect((await request(`work/items/${item.id}`, 'PATCH', { ...plan, stage: 'done' })).status).toBe(409);
    const finish = async (source: string, followup = false) => {
      await writeFile(html, source);
      await writeFile(related, '<h1>另一个任务的签到页</h1>');
      const task = tasks.at(-1)!;
      const endedAt = Date.now();
      task.status = 'done';
      task.endedAt = endedAt;
      const message = { kind: 'message' as const, at: endedAt,
        output: followup ? `新版保存为 \`${html}\`。参考了[帮助](https://example.invalid/help.html)。`
          : `本轮交付：[议程](<${html}>)。同目录的 \`${related}\` 由另一项任务交付。` };
      if (executor === 'internal') results.set(task.id, { taskId: task.id, steps: [message] });
      else if (followup) turns.push({ task: { ...task, id: `${root}:second` }, steps: [message] });
      else { Object.assign(turns[0].task, { status: 'done', endedAt }); turns[0].steps.push(message); }
      bridge.invalidate();
      if (!followup) {
        const early = await request(`subagent/tasks/${root}/messages`, 'POST', { message: '增加标题搜索' });
        expect(early.status).toBe(409);
        expect(tasks).toHaveLength(1);
      }
      await network.collectResults();
    };
    await finish('<h1>首版议程</h1>');
    const changed = { ...plan, stage: 'review', specification: '加搜索', expectedVersion: 1 };
    expect((await request(`work/items/${item.id}`, 'PATCH', changed)).status).toBe(200);
    expect((await request(`work/items/${item.id}`, 'PATCH', changed)).status).toBe(409);
    const stale = await request(`subagent/tasks/${root}/messages`, 'POST', { message: '增加标题搜索' }, { 'X-Work-Plan-Version': '1' });
    expect(stale.status).toBe(409);
    expect(followUp).toBe('');
    await network.context(`send ${JSON.stringify({ task_id: root, message: '增加标题搜索' })}`, undefined, 'scene');
    expect(followUp).toBe('增加标题搜索');
    expect((await request('work/items/batch', 'POST', { ids: [item.id], stage: 'done' })).status).toBe(409);
    await finish('<h1>新版议程</h1><input type="search">', true);
    const delivered: WorkItem = await (await request(`work/items/${item.id}`)).json();
    expect(delivered.planHistory?.map(row => row.version)).toEqual([1, 2]);
    expect(delivered.executions?.map(row => [row.planVersion, row.deliveryVersion])).toEqual([[1, 1], [2, 2]]);
    expect(delivered.executions?.map(row => row.goalRevision)).toEqual([{ goalId: goal.id, version: 1 }, { goalId: goal.id, version: 2 }]);
    expect(delivered.executions?.map(row => row.files?.map(file => file.source))).toEqual([[html], [html]]);
    expect(await readFile(delivered.executions![0].files![0].path, 'utf8')).toBe('<h1>首版议程</h1>');
    expect(await readFile(delivered.executions![1].files![0].path, 'utf8')).toContain('type="search"');
    const historical = JSON.parse(await network.context(`result ${delivered.executions![0].resultId}`, undefined, 'scene'));
    expect(historical).toMatchObject({ deliveryVersion: 1, files: delivered.executions![0].files });
    expect(await (await request(`work/items/${item.id}`, 'PATCH', { ...changed, stage: 'done', expectedVersion: 2 })).json()).toMatchObject({ acceptedDeliveryVersion: 2 });
    expect(JSON.parse(await network.context(`goal ${goal.id}`))).toMatchObject({ version: 2, projects: [{ id: project.id, tasks: [{ id: item.id, stage: 'done', acceptedDeliveryVersion: 2 }] }] });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('archives a result when its task starts and finishes during a ledger read', async () => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'work-fast-result-')));
  const endpoint = 'fixture';
  const html = path.join(directory, 'gallery.html');
  const tasks: SceneTask[] = [];
  let blockLedger = false;
  let ledgerReadStarted!: () => void;
  let resumeLedgerRead!: () => void;
  const readingLedger = new Promise<void>(resolve => { ledgerReadStarted = resolve; });
  const ledgerGate = new Promise<void>(resolve => { resumeLedgerRead = resolve; });
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    const createdAt = Date.now();
    tasks.push({ id: 'sub_gallery', sceneId: 'scene', workdir: directory,
      session: `work-${new Headers(init?.headers).get('X-Work-Launch')}`, status: 'done', createdAt, endedAt: createdAt });
    return Response.json({ task_id: 'sub_gallery' });
  });
  const network = new WorkNetwork(() => 'beings://desktop/', () => ({ directory, endpoint, pid: 7 }), fetcher);
  network.sceneIds = () => ['scene'];
  network.chooseProject = async directory => directory || null;
  network.readTasks = async () => {
    if (blockLedger) {
      blockLedger = false;
      ledgerReadStarted();
      await ledgerGate;
    }
    return { endpoint, tasks, subagentReady: true };
  };
  network.readDetails = async () => [{ taskId: 'sub_gallery', steps: [{ kind: 'message', at: Date.now(), output: `[照片墙](<${html}>)` }] }];
  const command = async (args: string) => JSON.parse(await network.context(args, undefined, 'scene'));
  let collecting: Promise<void> | undefined;
  try {
    await writeFile(path.join(directory, '.portal-ready.json'), JSON.stringify({ pid: 7, nonce: 'fixture' }));
    await writeFile(path.join(directory, '.portal-work.json'), JSON.stringify({ pid: 7, nonce: 'fixture', port: 4321, token: 'fixture' }));
    await writeFile(html, '<h1>照片墙</h1>');
    const { project } = await command(`add-project ${JSON.stringify({ directory })}`);
    const item = await command(`create ${JSON.stringify({ title: '生成照片墙', projectId: project.id, executor: 'internal' })}`);
    blockLedger = true;
    collecting = network.collectResults();
    await readingLedger;
    expect(await command(`run ${JSON.stringify({ item_id: item.id })}`)).toMatchObject({ task_id: 'sub_gallery' });
    resumeLedgerRead();
    await collecting;
    const [outcome] = await command(`results ${item.id}`);
    expect(outcome).toMatchObject({ stage: 'review', result: { deliveryVersion: 1, files: [{ source: html }] } });
    expect(await readFile(outcome.result.files[0].path, 'utf8')).toBe('<h1>照片墙</h1>');
  } finally { resumeLedgerRead(); await collecting; await rm(directory, { recursive: true, force: true }); }
});

it('allows a fresh launch only after the original Portal admission is proven absent', async () => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'work-missing-admission-')));
  const endpoint = 'fixture';
  const runtime = () => ({ directory, pid: 7, endpoint });
  const keys: string[] = [];
  let verified = false;
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const route = new URL(String(url)).pathname;
    if (route.endsWith('/resolve')) {
      expect(route).toBe(`/api/subagent/dispatches/${keys[0]}/resolve`);
      expect(JSON.parse(String(init?.body))).toEqual({ admission: 'fixture-epoch' });
      return Response.json({ status: verified ? 'not_accepted' : 'unconfirmed' });
    }
    keys.push(new Headers(init?.headers).get('X-Work-Launch')!);
    return keys.length === 1 ? new Response('not connected', { status: 408 }) : Response.json({ task_id: 'sub_retried' });
  });
  const network = new WorkNetwork(() => 'beings://desktop/', runtime, fetcher);
  network.sceneIds = () => ['scene'];
  network.readTasks = async () => ({ endpoint, tasks: [], subagentReady: true });
  const request = (route: string, method = 'GET', body?: object) => network.handle(new Request(`beings://desktop/api/${route}`, {
    method, headers: { 'X-Being-Endpoint': endpoint, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body),
  }));
  try {
    await writeFile(path.join(directory, '.portal-ready.json'), JSON.stringify({ pid: 7, nonce: 'fixture' }));
    await writeFile(path.join(directory, '.portal-work.json'), JSON.stringify({ pid: 7, nonce: 'fixture', port: 4321, token: 'fixture', launchAdmission: 'fixture-epoch' }));
    const project = await (await request('subagent/projects', 'POST', { directory })).json();
    const item = await (await request('work/items', 'POST', { title: '生成 HTML', description: '', stage: 'todo', executor: 'internal',
      projectId: project.id, priority: 'none', labels: [], dueDate: '', parentId: '' })).json();
    const launch = () => request(`work/items/${item.id}/runs`, 'POST', { scene_id: 'scene' });
    expect((await launch()).status).toBe(408);
    expect(await (await launch()).json()).toMatchObject({ status: 'unconfirmed' });
    expect(keys).toHaveLength(1);
    verified = true;
    expect(await (await request(`work/items/${item.id}/dispatch`)).json()).toMatchObject({ status: 'failed' });
    expect(await (await launch()).json()).toMatchObject({ task_id: 'sub_retried' });
    expect(await (await launch()).json()).toMatchObject({ task_id: 'sub_retried', status: 'started' });
    expect(keys).toHaveLength(2);
    expect(keys[1]).not.toBe(keys[0]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('makes a persisted result available while notification delivery is still pending', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'work-pending-callback-'));
  const endpoint = 'fixture';
  let started!: () => void;
  let finish!: () => void;
  const deliveryStarted = new Promise<void>(resolve => { started = resolve; });
  const holdDelivery = new Promise<void>(resolve => { finish = resolve; });
  const rows = new WorkItems(path.join(directory, 'work-projects', 'items'));
  const result = { id: 'agent_codex_fixture:turn', taskId: 'agent_codex_fixture', executor: 'codex', status: 'done' as const,
    summary: '审核完成', title: 'HTML 审核', sceneId: 'scene', at: Date.now(), deliveryVersion: 1 };
  const network = new WorkNetwork(() => 'beings://desktop/', () => ({ directory, pid: 7, endpoint }), async () => {
    started();
    await holdDelivery;
    return Response.json({ delivered: true });
  });
  network.readTasks = async () => ({ endpoint, tasks: [], subagentReady: true });
  network.readDetails = async () => [];
  let publishing: Promise<void> | undefined;
  try {
    await writeFile(path.join(directory, '.portal-ready.json'), JSON.stringify({ pid: 7, nonce: 'fixture' }));
    await writeFile(path.join(directory, '.portal-work.json'), JSON.stringify({ pid: 7, nonce: 'fixture', port: 4321, token: 'fixture' }));
    await rows.update(endpoint, data => { data.results.push(result); });
    publishing = network.collectResults();
    await deliveryStarted;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const read = network.context('results', undefined, 'scene').then(JSON.parse);
      await expect(Promise.race([read, new Promise(resolve => { timer = setTimeout(() => resolve('timeout'), 2000); })]))
        .resolves.toEqual([result]);
    } finally { clearTimeout(timer); }
  } finally {
    finish();
    await publishing;
    await rm(directory, { recursive: true, force: true });
  }
});

it('keeps plans separate from runs, collects native results once and restores review, notes and artifacts', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'work-items-')));
  const project = path.join(root, 'project');
  const endpoint = 'fixture';
  const runtime = () => ({ directory: root, pid: 7, endpoint });
  const posted: unknown[] = [];
  const native: SceneTask[] = [];
  const internal: SceneTask[] = [];
  const details = new Map<string, SubagentTaskDetail>();
  const steer = vi.fn(async () => {});
  const send = vi.fn(async () => ({ turnId: 'followup' }));
  const network = new WorkNetwork(() => 'beings://desktop/', runtime, async (url, init) => {
    expect(String(url)).toBe('http://127.0.0.1:4321/api/subagent/results');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fixture');
    const payload = JSON.parse(String(init?.body));
    posted.push(payload);
    if (payload.event_id === 'agent_codex_bad:bad') return Response.json({ error: 'Invalid Work result' }, { status: 400 });
    return Response.json({ delivered: true });
  });
  network.readTasks = async () => ({ endpoint, tasks: internal, subagentReady: true });
  network.sceneIds = () => ['scene'];
  network.bridge = new AgentBridge([{
    id: 'codex', name: 'Codex', status: async () => ({ id: 'codex', name: 'Codex', available: true }),
    list: async () => ({ projects: [], tasks: native }),
    start: async (directory, message) => {
      const task: SceneTask = { id: 'agent_codex_fixture', nativeId: 'fixture', executor: 'codex', workdir: directory,
        status: 'running', createdAt: Date.now(), sceneId: '', brief: message };
      native.push(task);
      details.set(task.id, { taskId: task.id, steps: [], turns: [{ task: { ...task, id: task.id + ':turn' },
        steps: [{ at: task.createdAt, kind: 'started', input: message }, { at: task.createdAt, kind: 'message', output: '完成验收' }] }] });
      return 'fixture';
    },
    read: async () => details.get(native[0].id)!,
    send, steer, cancel: async () => {}, close: () => {},
  }]);
  const request = (url: string, method = 'GET', body?: object, sceneId = 'scene') => network.handle(new Request('beings://desktop/api/' + url, {
    method, headers: { 'X-Being-Endpoint': endpoint, 'X-Work-Scene': sceneId, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body),
  }));
  try {
    await mkdir(project);
    await writeFile(path.join(project, 'result.txt'), '验收结果');
    await writeFile(path.join(root, 'outside.txt'), 'outside');
    await writeFile(path.join(root, '.portal-ready.json'), JSON.stringify({ pid: 7, nonce: 'fixture' }));
    await writeFile(path.join(root, '.portal-work.json'), JSON.stringify({ pid: 7, nonce: 'fixture', port: 4321, token: 'fixture' }));
    await new WorkItems(path.join(root, 'work-projects', 'items')).update(endpoint, data => {
      data.results.push({ id: 'agent_codex_bad:bad', taskId: 'agent_codex_bad', executor: 'codex', sceneId: '', title: '无效回执', summary: '', status: 'done', at: Date.now() });
    });
    const savedProject = await (await request('subagent/projects', 'POST', { directory: project })).json();
    const projectRules = await request(`subagent/projects/${savedProject.id}`, 'PATCH', { executor: 'codex' });
    expect(projectRules.status).toBe(200);
    expect(JSON.parse(await network.context(`project ${savedProject.id}`)).project.rules).toEqual({ executor: 'codex' });
    const fields: WorkItemFields = { title: '验证产物', description: '读取项目中的验收文件', projectId: savedProject.id, executor: '',
      stage: 'todo', priority: 'high', labels: ['质量'], dueDate: '2026-11-24', parentId: '' };
    const response = await request('work/items', 'POST', fields);
    expect(response.status).toBe(201);
    const plan: WorkItem = await response.json();
    expect(native).toHaveLength(0);
    const child = JSON.parse(await network.context('create ' + JSON.stringify({ ...fields, title: '检查记录', parentId: plan.id })));
    const statusUpdate = await request('work/items/batch', 'POST', { ids: [child.id], stage: 'in_progress' });
    expect(statusUpdate.status).toBe(200);
    expect(await statusUpdate.json()).toMatchObject([{ id: child.id, stage: 'in_progress', runIds: [] }]);
    expect((await request('work/items/' + plan.id, 'PATCH', { ...fields, parentId: child.id })).status).toBe(409);
    expect((await request('work/items/' + plan.id + '/artifacts', 'POST', { value: '../outside.txt' })).status).toBe(400);
    expect((await request('work/items/' + plan.id + '/artifacts', 'POST', { value: 'result.txt' })).status).toBe(201);
    await network.context('note ' + JSON.stringify({ item_id: plan.id, value: '只检查项目范围。' }));
    const dispatchPath = `work/items/${plan.id}/dispatch`;
    const dispatchBody = { scene_id: 'scene', before: child.id };
    const dispatchResponse = await request(dispatchPath, 'POST', dispatchBody);
    expect(dispatchResponse.status).toBe(201);
    const firstDispatch = await dispatchResponse.json();
    expect(native).toHaveLength(0);
    expect(await (await request(`work/items/${plan.id}`)).json()).toMatchObject({ stage: 'todo', dispatch: firstDispatch });
    expect((await request(dispatchPath, 'POST', dispatchBody)).status).toBe(409);
    expect((await request(dispatchPath, 'PATCH', { dispatch_id: firstDispatch.id, queued: false })).status).toBe(200);
    const dispatch = await (await request(dispatchPath, 'POST', dispatchBody)).json();
    expect(dispatch.id).not.toBe(firstDispatch.id);
    expect((await request(dispatchPath, 'PATCH', { dispatch_id: dispatch.id, queued: true })).status).toBe(200);
    const run = { item_id: plan.id, dispatch_id: dispatch.id, executor: 'codex' };
    await expect(network.context('run ' + JSON.stringify({ ...run, dispatch_id: 'stale' }), undefined, 'scene')).rejects.toThrow('接管请求已变化');
    expect(native).toHaveLength(0);
    const receipt = JSON.parse(await network.context('run ' + JSON.stringify(run), undefined, 'scene'));
    expect(receipt).toMatchObject({ work_url: `beings://work/${plan.id}`, next_step: expect.stringContaining('派发轮只确认启动') });
    expect(JSON.parse(await network.context('run ' + JSON.stringify(run), undefined, 'scene'))).toMatchObject({ status: 'started', task_id: receipt.task_id });
    expect(native).toHaveLength(1);
    expect(receipt.task_id).toBe(native[0].id);
    expect((await request(`subagent/tasks/${receipt.task_id}/steer`, 'POST', { message: '补充说明' })).status).toBe(200);
    expect(steer).toHaveBeenCalledWith('fixture', '补充说明');
    expect((await request('work/items/' + plan.id + '/runs', 'POST', { scene_id: 'scene', request_id: 'new-run' })).status).toBe(409);
    expect((await network.snapshot()).items?.map(row => row.id)).toEqual([plan.id, child.id]);
    expect((await network.snapshot()).items?.find(row => row.id === plan.id)).toMatchObject({ stage: 'in_progress', executor: 'codex', runIds: [receipt.task_id] });
    const busyDelete = await request(`work/items/${plan.id}`, 'DELETE');
    expect(busyDelete.status).toBe(409);
    expect(await busyDelete.json()).toMatchObject({ error: '请等派发或执行结束后再删除任务。' });
    native[0].status = 'done';
    details.get(native[0].id)!.turns![0].task.status = 'done';
    internal.push({ id: 'sub_fixture', status: 'failed', sceneId: 'scene', createdAt: Date.now(), endedAt: Date.now(), brief: '内置失败' });
    network.bridge.invalidate();
    await Promise.all([network.collectResults(), network.collectResults()]);
    await network.collectResults();
    expect(posted).toHaveLength(2);
    expect(posted).toEqual(expect.arrayContaining([expect.objectContaining({ event_id: 'agent_codex_bad:bad' }), expect.objectContaining({ task_id: receipt.task_id, scene_id: 'scene', summary: '完成验收' })]));
    const result = JSON.parse(await network.context('results'));
    expect(result).toHaveLength(3);
    expect(result.find((row: { id: string }) => row.id === 'agent_codex_bad:bad')).toMatchObject({ delivered: false, delivery: { error: '回执送达失败（HTTP 400）' } });
    expect(result.find((row: { taskId: string }) => row.taskId === receipt.task_id)).toMatchObject({ delivered: true, status: 'done', planVersion: 1, deliveryVersion: 1 });
    expect(JSON.parse(await network.context('results', undefined, 'scene'))).toEqual(result.filter((row: { sceneId: string }) => row.sceneId === 'scene'));
    const selected = await network.context(`results ${plan.id} ${child.id}`, undefined, 'scene');
    expect(selected.trim().split('\n')).toHaveLength(4);
    expect(JSON.parse(selected)).toMatchObject([
      { work_id: plan.id, work_url: `beings://work/${plan.id}`, stage: 'review', result: { taskId: receipt.task_id, summary: '完成验收' } },
      { work_id: child.id, stage: 'in_progress', result: null },
    ]);
    expect(JSON.parse(await network.context(`results ${plan.id}`, undefined, 'other-scene'))[0].result).toBeNull();
    const context = JSON.parse(await network.context(plan.id));
    expect(context.item).toMatchObject({ stage: 'review', runIds: [receipt.task_id], artifacts: [path.join(project, 'result.txt')],
      stageHistory: [{ from: 'todo', to: 'in_progress', at: expect.any(Number) }, { from: 'in_progress', to: 'review', at: expect.any(Number) }],
      notes: [expect.objectContaining({ text: '只检查项目范围。' })] });
    expect(context.conversation[0].turns[0].steps.at(-1).output).toBe('完成验收');
    expect((await request(`subagent/tasks/${receipt.task_id}/messages`, 'POST', { message: '补充说明' }, 'other-scene')).status).toBe(200);
    expect((await network.snapshot()).items?.find(row => row.id === plan.id)?.stage).toBe('in_progress');
    expect(JSON.parse(await network.context(`results ${plan.id}`, undefined, 'scene'))[0]).toMatchObject({ stage: 'in_progress', result: null });
    native[0].status = 'failed';
    details.get(native[0].id)!.turns!.push({
      task: { ...native[0], id: native[0].id + ':followup', error: '续聊失败' },
      steps: [{ kind: 'started', at: Date.now(), input: '补充说明' }],
    });
    network.bridge.invalidate();
    await network.collectResults();
    expect((await network.snapshot()).items?.find(row => row.id === plan.id)?.stage).toBe('blocked');
    expect(JSON.parse(await network.context(`results ${plan.id}`, undefined, 'scene'))[0]).toMatchObject({
      stage: 'blocked', result: { id: receipt.task_id + ':followup', sceneId: 'scene', summary: '续聊失败' },
    });
    expect(JSON.parse(await network.context(`results ${plan.id}`, undefined, 'other-scene'))[0].result).toBeNull();
    expect((await request('work/items/order', 'POST', { id: child.id, before: plan.id, stage: 'blocked' })).status).toBe(200);
    expect((await network.snapshot()).items?.map(row => [row.id, row.stage])).toEqual([[child.id, 'blocked'], [plan.id, 'blocked']]);
    expect((await request('work/items/batch', 'POST', { ids: [plan.id, child.id], stage: 'done' })).status).toBe(200);
    expect((await request('work/results/read', 'POST', { id: receipt.task_id + ':turn' })).status).toBe(200);
    const restarted = new WorkNetwork(() => 'beings://desktop/', runtime);
    restarted.readTasks = network.readTasks;
    restarted.sceneIds = network.sceneIds;
    const persisted = await restarted.snapshot();
    expect(persisted.items?.map(row => row.stage)).toEqual(['done', 'done']);
    expect(persisted.results?.entries.find(row => row.id === receipt.task_id + ':turn')).toMatchObject({ read: true, delivered: true });
    expect(JSON.parse(await restarted.context('run ' + JSON.stringify(run), undefined, 'scene'))).toMatchObject({ task_id: receipt.task_id, status: 'started' });
    const manual = await request('work/items', 'POST', { ...fields, title: '生成 HTML 草稿', stage: 'in_progress' });
    expect(manual.status).toBe(201);
    expect(await manual.json()).toMatchObject({ stage: 'in_progress', runIds: [] });
    const edited = await request(`work/items/${child.id}`, 'PATCH', { ...fields, parentId: plan.id, stage: 'in_progress' });
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({ stage: 'in_progress', runIds: [] });
    expect((await request('work/items/batch', 'POST', { ids: [child.id], stage: 'todo' })).status).toBe(200);
    const ordered = await request('work/items/order', 'POST', { id: child.id, before: '', stage: 'in_progress' });
    expect(ordered.status).toBe(200);
    expect(await ordered.json()).toMatchObject({ id: child.id, stage: 'in_progress', runIds: [] });
    expect(native).toHaveLength(1);
    native[0].status = 'failed';
    network.bridge.invalidate();
    expect((await request(`subagent/tasks/${receipt.task_id}/retry`, 'POST', {})).status).toBe(201);
    expect(send).toHaveBeenLastCalledWith('fixture', '补充说明');
    expect((await network.snapshot()).items?.find(row => row.id === plan.id)?.stage).toBe('in_progress');
    const task = { id: 'sub_html', sceneId: 'scene', status: 'done', createdAt: Date.now(), endedAt: Date.now() } as const;
    const readDetails = vi.fn().mockRejectedValueOnce(new Error('执行日志暂时不可用')).mockResolvedValue([
      { taskId: task.id, steps: [{ kind: 'message', output: '报名页已生成，移动端校验通过。' }] },
    ]);
    network.readDetails = readDetails;
    internal.push(task);
    await network.collectResults();
    expect((await network.snapshot()).results?.entries.some(row => row.id === task.id)).toBe(false);
    await network.collectResults();
    expect((await network.snapshot()).results?.entries.find(row => row.id === task.id)?.summary).toBe('报名页已生成，移动端校验通过。');
    expect(readDetails).toHaveBeenCalledTimes(2);
    const grandchild = JSON.parse(await network.context('create ' + JSON.stringify({ ...fields, title: '生成交付说明页', parentId: child.id })));
    const removed = await request(`work/items/${child.id}`, 'DELETE');
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ id: child.id });
    expect((await request(`work/items/${child.id}`)).status).toBe(404);
    expect(await (await request(`work/items/${grandchild.id}`)).json()).toMatchObject({ parentId: plan.id });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('finds a late launch after the Being command stops waiting and replays the same receipt', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'work-launch-')));
  const endpoint = 'fixture';
  const runtime = () => ({ directory: root, endpoint });
  const network = new WorkNetwork(() => 'beings://desktop/', runtime);
  network.readTasks = async () => ({ endpoint, tasks: [], subagentReady: true });
  network.sceneIds = () => ['scene'];
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  const start = vi.fn(async () => {
    enter();
    await released;
    return 'late';
  });
  network.bridge = new AgentBridge([{
    id: 'codex', name: 'Codex', status: async () => ({ id: 'codex', name: 'Codex', available: true }),
    list: async () => ({ projects: [], tasks: [] }), read: async () => ({ taskId: '', steps: [] }),
    start, send: async () => {}, cancel: async () => {}, close: () => {},
  }]);
  const request = (url: string, method = 'GET', body?: object) => network.handle(new Request('beings://desktop/api/' + url, {
    method, headers: { 'X-Being-Endpoint': endpoint, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body),
  }));
  try {
    const project = await (await request('subagent/projects', 'POST', { directory: root })).json();
    const plan = await (await request('work/items', 'POST', {
      title: '慢启动验收', description: '', projectId: project.id, executor: 'codex', stage: 'todo',
      priority: 'none', labels: [], dueDate: '', parentId: '',
    })).json();
    const run = 'run ' + JSON.stringify({ item_id: plan.id });
    const caller = new AbortController();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const first = network.context(run, caller.signal, 'scene');
    await entered;
    await vi.advanceTimersByTimeAsync(6000);
    const pending = JSON.parse(await first);
    caller.abort();
    vi.useRealTimers();
    expect(pending).toMatchObject({ work_id: plan.id, status: 'starting' });
    expect(pending).toMatchObject(JSON.parse(await network.context('status ' + plan.id)));
    expect(JSON.parse(await network.context(run, undefined, 'scene'))).toEqual(pending);
    release();
    await vi.waitFor(async () => {
      expect(JSON.parse(await network.context('status ' + plan.id))).toMatchObject({ status: 'started', task_id: 'agent_codex_late' });
    });
    expect(JSON.parse(await network.context(run, undefined, 'scene'))).toMatchObject({ task_id: 'agent_codex_late' });
    expect(await (await request(`work/items/${plan.id}`)).json()).toMatchObject({ stage: 'in_progress', runIds: ['agent_codex_late'] });
    expect(start).toHaveBeenCalledTimes(1);
  } finally {
    release();
    vi.useRealTimers();
    await rm(root, { recursive: true, force: true });
  }
});

it('hands off review and wakes on a dependency, all children, or time only once', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'work-automation-')));
  const endpoint = 'fixture';
  const runtime = () => ({ directory: root, pid: 7, endpoint });
  const submitted: SceneTask[] = [];
  const callbacks: string[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    callbacks.push(JSON.parse(String(init?.body)).scene_id);
    return Response.json({ delivered: true });
  };
  const bridge = new AgentBridge(['codex', 'deepseek'].map(executor => ({
    id: executor, name: executor,
    status: async () => ({ id: executor, name: executor, available: true }),
    list: async () => ({ projects: [], tasks: submitted.filter(task => task.executor === executor) }),
    start: async (directory: string, message: string) => {
      const nativeId = String(submitted.length + 1);
      submitted.push({ id: `agent_${executor}_${nativeId}`, nativeId, executor, workdir: directory,
        status: 'running', createdAt: Date.now(), sceneId: '', brief: message });
      return nativeId;
    },
    read: async (id: string) => {
      const task = submitted.find(task => task.nativeId === id)!;
      return { taskId: task.id, steps: [], turns: [{ task: { ...task, id: task.id + ':turn' }, steps: [
        { kind: 'started' as const, at: task.createdAt, input: task.brief },
        { kind: 'message' as const, at: task.createdAt, output: 'first result' },
      ] }] };
    },
    send: async () => {}, cancel: async () => {}, close: () => {},
  })));
  const connect = () => {
    const network = new WorkNetwork(() => 'beings://desktop/', runtime, fetcher);
    network.bridge = bridge;
    network.sceneIds = () => ['scene'];
    network.readTasks = async () => ({ endpoint, tasks: [], subagentReady: true });
    return network;
  };
  const network = connect();
  const command = async (name: string, input: object) => JSON.parse(await network.context(name + ' ' + JSON.stringify(input)));
  try {
    await writeFile(path.join(root, '.portal-ready.json'), JSON.stringify({ pid: 7, nonce: 'fixture' }));
    await writeFile(path.join(root, '.portal-work.json'), JSON.stringify({ pid: 7, nonce: 'fixture', port: 4321, token: 'fixture' }));
    const savedProject = await network.handle(new Request('beings://desktop/api/subagent/projects', {
      method: 'POST', headers: { 'X-Being-Endpoint': endpoint, 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory: root }),
    }));
    const project = await savedProject.json();
    const fields: WorkItemFields = { title: 'Primary', description: 'Initial requirements', projectId: project.id,
      executor: 'codex', stage: 'todo', priority: 'none', labels: [], dueDate: '', parentId: '' };
    const primary = await command('create', fields);
    const parent = await command('create', { ...fields, title: 'Parent', stage: 'blocked' });
    const child = await command('create', { ...fields, title: 'Child', parentId: parent.id });
    const otherChild = await command('create', { ...fields, title: 'Other child', parentId: parent.id, stage: 'done' });
    const waiting = await command('create', { ...fields, title: 'Dependency' });
    const timed = await command('create', { ...fields, title: 'Timed' });
    const rule = { executor: 'deepseek', instruction: 'Check the output' };
    await expect(command('automate', { item_id: primary.id, scene_id: 'unknown', handoff: rule })).rejects.toThrow('当前客户端对话');
    await command('automate', { item_id: primary.id, scene_id: 'scene', handoff: rule });
    await command('automate', { item_id: parent.id, scene_id: 'scene', wakeup: { ...rule, kind: 'children_done' } });
    await command('automate', { item_id: waiting.id, scene_id: 'scene', wakeup: { ...rule, kind: 'task_done', itemId: primary.id } });
    const initialNow = Date.now();
    await command('automate', { item_id: timed.id, scene_id: 'scene', wakeup: { ...rule, kind: 'at', at: initialNow + 60_000 } });
    await command('run', { item_id: primary.id, scene_id: 'scene' });
    await network.collectResults();
    expect(submitted).toHaveLength(1);
    submitted[0].status = 'done';
    bridge.invalidate();
    await Promise.all([network.collectResults(), network.collectResults()]);
    expect(submitted.map(task => task.executor)).toEqual(['codex', 'deepseek']);
    expect(submitted[1].brief).toContain('first result');
    submitted[1].status = 'done';
    bridge.invalidate();
    await network.collectResults();
    expect(callbacks).toEqual(['scene', 'scene']);
    expect(submitted).toHaveLength(2);
    await command('update', { ...fields, item_id: primary.id, stage: 'done' });
    await command('update', { ...fields, item_id: child.id, title: 'Child', parentId: parent.id, stage: 'done' });
    const restarted = connect();
    const time = vi.spyOn(Date, 'now').mockReturnValue(initialNow + 60_001);
    try {
      await restarted.collectResults();
      await restarted.collectResults();
    } finally { time.mockRestore(); }
    expect(submitted).toHaveLength(5);
    const items = (await restarted.snapshot()).items!;
    expect(items.find(item => item.id === primary.id)?.handoff).toMatchObject({ status: 'started', runId: submitted[1].id });
    expect(items.filter(item => item.wakeup?.status === 'started')).toHaveLength(3);
    expect(submitted[2].brief).toContain(otherChild.id);
    expect(submitted[3].brief).toContain(primary.id);
    const config = await restarted.handle(new Request(`beings://desktop/api/subagent/projects/${project.id}`, {
      method: 'PATCH', headers: { 'X-Being-Endpoint': endpoint, 'Content-Type': 'application/json' },
      body: JSON.stringify({ executor: 'codex', handoff: rule }),
    }));
    expect(config.status).toBe(200);
    const inherited = JSON.parse(await restarted.context('create ' + JSON.stringify({ ...fields, title: 'Inherits project rules', executor: '' })));
    await restarted.context('run ' + JSON.stringify({ item_id: inherited.id }), undefined, 'scene');
    expect(submitted[5].executor).toBe('codex');
    submitted[5].status = 'done';
    bridge.invalidate();
    await restarted.collectResults();
    expect(submitted[6].executor).toBe('deepseek');
    expect(submitted[6].brief).toContain(rule.instruction);
    expect((await restarted.snapshot()).items?.find(item => item.id === inherited.id)?.handoff).toMatchObject({ status: 'started', runId: submitted[6].id });
  } finally { await rm(root, { recursive: true, force: true }); }
});
