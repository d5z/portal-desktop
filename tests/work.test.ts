import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, realpath, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkNetwork } from '../desktop/main/portal/work-network';
import { WorkProjects, directoryProject } from '../desktop/main/portal/work-projects';
import { AgentBridge } from '../desktop/main/agent-bridge/registry';
import { WorkItems } from '../desktop/main/portal/work-items';
import { publicSceneTasks } from '../desktop/main/portal/subagent-tasks';
import { WorkModel, workThreads } from '../desktop/renderer/app/models/work';
import type { SceneTask } from '../desktop/shared/types';

const rootTask: SceneTask = { id: 'sub_root', sceneId: 'scene-main', createdAt: 1, status: 'done', brief: 'Original work', session: 'default' };
const childTask: SceneTask = { ...rootTask, id: 'sub_child', parentTaskId: 'sub_root', userMessage: 'Follow up', createdAt: 3 };
afterEach(() => vi.unstubAllGlobals());

it('keeps Being and Work sessions after clearing manual imports, without crossing Being profiles', async () => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'work-parallel-import-')));
  let endpoint = 'one';
  const tasks: SceneTask[] = [];
  const add = (id: string) => tasks.push({ ...rootTask, id: `agent_codex_${id}`, nativeId: id, workdir: directory, executor: 'codex' });
  add('manual'); add('linked');
  const bridge = new AgentBridge([{
    id: 'codex', name: 'Codex', status: async () => ({ id: 'codex', name: 'Codex', available: true }),
    list: async () => ({ projects: [], tasks: [...tasks] }),
    read: async id => ({ taskId: `agent_codex_${id}`, steps: [] }),
    start: async (_dir, id) => { add(id); return id; },
    native: async () => { add('work-ui'); return Response.json({ thread: { id: 'work-ui' } }); },
    send: async () => {}, cancel: async () => {}, close: () => {},
  }]);
  const open = () => {
    const network = new WorkNetwork(() => 'beings://desktop/', () => ({ directory, endpoint }));
    network.bridge = bridge;
    network.sceneIds = () => ['scene-main'];
    network.readTasks = async () => ({ endpoint, tasks: [rootTask] });
    return network;
  };
  const request = (network: WorkNetwork, path: string, body?: object) => network.handle(new Request(`beings://desktop/api/${path}`, {
    method: body ? 'POST' : 'GET', headers: { 'X-Being-Endpoint': endpoint, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body),
  }));
  try {
    const ledger = new WorkItems(path.join(directory, 'work-projects', 'items'));
    const linked = await ledger.create(endpoint, { title: 'Earlier task', description: '', projectId: '', executor: 'codex', stage: 'done', priority: 'none', labels: [], dueDate: '', parentId: '' });
    await ledger.update(endpoint, data => { data.items.find(item => item.id === linked.id)!.runIds.push('agent_codex_linked'); });
    const network = open();
    await request(network, 'subagent/projects', { directory });
    await request(network, 'work/imports', { projectIds: [], taskIds: ['agent_codex_manual'] });
    const submit = (brief: string) => network.context('start ' + JSON.stringify({ executor: 'codex', workdir: directory, brief }), undefined, 'scene-main');
    const [first, second, ui, selection] = await Promise.all([
      submit('being-one'), submit('being-two'),
      network.native(new Request('beings://codex/thread/start', { method: 'POST', headers: { 'X-Being-Endpoint': endpoint } })),
      request(network, 'work/imports', { projectIds: [], taskIds: [] }),
    ]);
    expect(JSON.parse(first).task_id).toBe('agent_codex_being-one');
    expect(JSON.parse(second).task_id).toBe('agent_codex_being-two');
    expect(ui.status).toBe(200);
    expect(selection.status).toBe(200);
    const restarted = open();
    const managed = ['agent_codex_linked', 'agent_codex_being-one', 'agent_codex_being-two', 'agent_codex_work-ui'];
    expect((await restarted.snapshot()).tasks.map(task => task.id)).toEqual(expect.arrayContaining(managed));
    const catalog = await (await request(restarted, 'work/imports')).json();
    expect(catalog.taskIds).toEqual([]);
    expect(catalog.tasks.map((task: SceneTask) => task.id)).toEqual(['agent_codex_manual']);
    for (const id of managed) expect((await request(restarted, `subagent/tasks/${id}`)).status).toBe(200);
    expect((await request(restarted, 'subagent/tasks/agent_codex_manual')).status).toBe(404);
    endpoint = 'two';
    expect((await restarted.snapshot()).tasks.map(task => task.id)).toEqual(['sub_root']);
    expect((await request(restarted, 'subagent/tasks/agent_codex_being-one')).status).toBe(404);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('persists only chosen imports per Being, keeps native history independent of discovery, and rejects bad choices', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'work-imports-'));
  let endpoint = 'one';
  const tasks: SceneTask[] = ['a', 'b'].map(id => ({ ...rootTask, id: `agent_codex_${id}`, nativeId: id, executor: 'codex', projectId: 'native-project', workdir: '/native' }));
  const list = vi.fn(async () => ({ projects: [{ id: 'native-project', name: 'Native', directory: '/native', createdAt: 1, executor: 'codex' }], tasks }));
  const read = vi.fn(async (id: string) => ({ taskId: `agent_codex_${id}`, steps: [], records: ['not needed by renderer'] }));
  const network = new WorkNetwork(() => 'beings://desktop/', () => ({ directory, endpoint }));
  network.bridge = new AgentBridge([{ id: 'codex', name: 'Codex', status: async () => ({ id: 'codex', name: 'Codex', available: true }), list, read, start: async () => 'a', send: async () => {}, cancel: async () => {}, close: () => {} }]);
  network.readTasks = async () => ({ endpoint, tasks: [rootTask] });
  const request = (resource: string, body?: unknown) => network.handle(new Request(`beings://desktop/api/${resource}`, { method: body ? 'POST' : 'GET', headers: { 'X-Being-Endpoint': endpoint, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  try {
    expect((await network.snapshot()).tasks).toEqual([{ ...rootTask, projectId: undefined }]);
    expect((await (await request('work/imports')).json()).tasks).toHaveLength(2);
    expect((await request('work/imports', { projectIds: ['native-project'], taskIds: ['agent_codex_a'] })).status).toBe(200);
    expect((await network.snapshot()).tasks.map(task => task.id)).toEqual(['sub_root', 'agent_codex_a']);
    expect(list).toHaveBeenLastCalledWith(new Set(['a']));
    const calls = list.mock.calls.length;
    network.bridge.invalidate();
    const response = await request('subagent/tasks/agent_codex_a');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ taskId: 'agent_codex_a', steps: [] });
    expect(list).toHaveBeenCalledTimes(calls);
    expect((await request('subagent/tasks/agent_codex_b')).status).toBe(404);
    expect((await request('work/imports', { projectIds: [], taskIds: [42] })).status).toBe(400);
    const restored = new WorkNetwork(() => 'beings://desktop/', () => ({ directory, endpoint }));
    expect((await (await restored.handle(new Request('beings://desktop/api/work/imports', { headers: { 'X-Being-Endpoint': endpoint } }))).json()).taskIds).toEqual(['agent_codex_a']);
    endpoint = 'two';
    expect((await network.snapshot()).tasks.map(task => task.id)).toEqual(['sub_root']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('shows cached histories immediately, deduplicates opening requests, and fetches only new follow-ups', async () => {
  const work = new WorkModel(); work.configure('one');
  work.snapshot = { endpoint: 'one', tasks: [rootTask] };
  let finish!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal('fetch', fetcher);
  work.select(rootTask.id);
  const pending = work.loadDetails();
  expect(fetcher).toHaveBeenCalledTimes(1);
  finish(Response.json({ taskId: rootTask.id, steps: [{ at: 1, kind: 'message', output: 'Cached response' }] }));
  await pending;
  const cached = work.details[0];
  work.select(''); work.select(rootTask.id);
  expect(work.details[0]).toBe(cached);
  expect(work.detailLoading).toBe(false);
  await work.loadDetails();
  expect(fetcher).toHaveBeenCalledTimes(1);
  work.snapshot = { endpoint: 'one', tasks: [rootTask, childTask] };
  const followup = work.loadDetails();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.at(-1)?.[0]).toBe('beings://desktop/api/subagent/tasks/sub_child');
  finish(Response.json({ taskId: childTask.id, steps: [] })); await followup;
  expect(work.details[0]).toBe(cached);
  expect(work.details).toHaveLength(2);
});

it('ignores delayed history and import responses when switching Being', async () => {
  const work = new WorkModel(); work.configure('one'); work.snapshot = { endpoint: 'one', tasks: [rootTask] };
  const pending: ((response: Response) => void)[] = [];
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => pending.push(resolve))));
  work.select(rootTask.id);
  const details = work.loadDetails();
  const imports = work.openImports();
  work.configure('two');
  pending[0](Response.json({ taskId: rootTask.id, steps: [] }));
  pending[1](Response.json({ projectIds: [], taskIds: [], projects: [], tasks: [], agents: [] }));
  await Promise.all([details, imports]);
  expect(work.details).toEqual([]);
  expect(work.importCatalog).toBeUndefined();
  expect(work.importing).toBe(false);
});

it('does not reuse an in-flight running history after its task completes', async () => {
  const work = new WorkModel(); work.configure('one');
  work.snapshot = { endpoint: 'one', tasks: [{ ...rootTask, status: 'running' }] };
  const pending: ((response: Response) => void)[] = [];
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => pending.push(resolve))));
  work.select(rootTask.id);
  work.snapshot = { endpoint: 'one', tasks: [rootTask] };
  const complete = work.loadDetails();
  expect(pending).toHaveLength(2);
  pending[0](Response.json({ taskId: rootTask.id, steps: [] }));
  pending[1](Response.json({ taskId: rootTask.id, steps: [{ at: 2, kind: 'message', output: 'Complete' }] }));
  await complete;
  expect(work.details[0].steps[0].output).toBe('Complete');
});

it('groups only related follow-ups, preserving unrelated tasks in the same runtime session', () => {
  const groups = workThreads([childTask, rootTask, { ...rootTask, id: 'sub_other', createdAt: 2 }]);
  expect(groups.map(group => group.tasks.map(task => task.id))).toEqual([['sub_root', 'sub_child'], ['sub_other']]);
});

it('retains a failed follow-up draft and ignores old connection responses', async () => {
  const work = new WorkModel();
  work.configure('one'); work.snapshot = { endpoint: 'one', tasks: [rootTask] }; work.selectedId = rootTask.id; work.drafts[rootTask.id] = 'Keep this draft';
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('denied', { status: 409 })));
  await work.send();
  expect(work.drafts[rootTask.id]).toBe('Keep this draft');
  expect(work.error).toContain('409');
  let finish!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { finish = resolve; })));
  const pending = work.refresh();
  work.configure('two');
  finish(Response.json({ endpoint: 'one', tasks: [rootTask] }));
  await pending;
  expect(work.snapshot).toBeUndefined();
  expect(work.drafts).toEqual({});
});

it('relays real HTTP path, message, status and error body without exposing the Portal capability', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'work-network-'));
  try {
    await writeFile(path.join(directory, '.portal-ready.json'), JSON.stringify({ pid: 123, nonce: 'launch' }));
    await writeFile(path.join(directory, '.portal-work.json'), JSON.stringify({ pid: 123, nonce: 'launch', port: 39001, token: 'secret' }));
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(new Response('raw upstream conflict', { status: 409, headers: { 'Content-Type': 'text/plain' } }));
    let endpoint = 'one';
    const network = new WorkNetwork(() => 'beings://desktop/', () => ({ directory, pid: 123, endpoint }), upstream);
    network.readTasks = async () => ({ endpoint, tasks: [rootTask, childTask] });
    network.readDetails = async (_endpoint, ids) => ids.map(taskId => ({ taskId, steps: [{ at: 1, kind: 'message', output: `${taskId} result` }] }));
    const request = (target = rootTask.id, selectedEndpoint = endpoint, origin = 'beings://desktop') => new Request(`beings://desktop/api/subagent/tasks/${target}/messages`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Being-Endpoint': selectedEndpoint }, body: JSON.stringify({ message: 'Continue this work' }),
    });
    const response = await network.handle(request());
    expect(response.status).toBe(409); expect(response.headers.get('Content-Type')).toBe('text/plain');
    expect(await response.text()).toBe('raw upstream conflict');
    expect(upstream).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:39001/api/subagent/tasks/sub_root/messages', expect.objectContaining({ method: 'POST', body: '{"message":"Continue this work"}', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer secret' } }));
    expect((await network.handle(request('sub_foreign'))).status).toBe(404);
    expect((await network.handle(request(rootTask.id, endpoint, 'https://foreign.invalid'))).status).toBe(403);
    endpoint = 'two';
    expect((await network.handle(request(rootTask.id, 'one'))).status).toBe(409);
    expect(upstream).toHaveBeenCalledTimes(1);
    const context = JSON.parse(await network.context(childTask.id));
    expect(context.conversation.map((turn: { taskId: string }) => turn.taskId)).toEqual([rootTask.id, childTask.id]);
    expect(context.conversation[1].request).toBe('Follow up');
    await writeFile(path.join(directory, '.portal-work.json'), JSON.stringify({ pid: 122, nonce: 'old', port: 39001, token: 'secret' }));
    expect((await network.handle(request())).status).toBe(503);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('preserves newer typing while a previous message is being submitted', async () => {
  const work = new WorkModel();
  work.configure('one'); work.snapshot = { endpoint: 'one', tasks: [rootTask] }; work.selectedId = rootTask.id; work.drafts[rootTask.id] = 'Original message';
  let finish!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn((_url, init) => init.method === 'POST' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(Response.json({ endpoint: 'one', tasks: [] }))));
  const pending = work.send();
  work.drafts[rootTask.id] = 'New text typed while sending';
  finish(Response.json({ task_id: 'sub_new' }));
  await pending;
  expect(work.drafts[rootTask.id]).toBe('New text typed while sending');
});

it('persists projects per Being and assigns work to the closest actual directory', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'work-projects-')));
  try {
    const projectDirectory = path.join(root, 'product');
    await mkdir(path.join(projectDirectory, 'client'), { recursive: true });
    await mkdir(path.join(root, 'product-other'));
    const projects = new WorkProjects(path.join(root, 'records'));
    const project = await projects.add('one', { directory: projectDirectory });
    expect(await projects.add('one', { directory: projectDirectory })).toEqual(project);
    const nested = await projects.add('one', { directory: path.join(projectDirectory, 'client') });
    expect(await new WorkProjects(path.join(root, 'records')).list('one')).toEqual([project, nested]);
    expect(await projects.list('two')).toEqual([]);
    expect(directoryProject([project, nested], path.join(projectDirectory, 'client', 'src'))?.id).toBe(nested.id);
    expect(directoryProject([project], path.join(root, 'product-other'))).toBeUndefined();
    await writeFile(path.join(root, 'file.txt'), 'not a directory');
    await expect(projects.add('one', { directory: path.join(root, 'file.txt') })).rejects.toThrow('文件夹');
    await expect(projects.add('one', { directory: 'relative/path' })).rejects.toThrow('项目目录');
    const tasks = publicSceneTasks({ tasks: [{ task_id: 'sub_project', scene_id: 'main', status: 'done', created_ms: 1, workdir: projectDirectory }] }, new Set(['main']));
    expect(tasks[0].workdir).toBe(projectDirectory);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('exposes project creation and context through real resources and authorizes only registered directories', async () => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'work-project-network-')));
  try {
    const projectDirectory = path.join(directory, 'project');
    const externalDirectory = path.join(directory, 'other');
    await mkdir(projectDirectory); await mkdir(externalDirectory);
    const network = new WorkNetwork(() => 'beings://desktop/', () => ({ directory, endpoint: 'one' }));
    network.readTasks = async () => ({ endpoint: 'one', tasks: [{ ...rootTask, workdir: projectDirectory }, { ...rootTask, id: 'sub_other', workdir: externalDirectory }] });
    const create = await network.handle(new Request('beings://desktop/api/subagent/projects', { method: 'POST', headers: { 'X-Being-Endpoint': 'one', 'Content-Type': 'application/json' }, body: JSON.stringify({ directory: projectDirectory }) }));
    expect(create.status).toBe(201);
    const project = await create.json();
    const snapshot = await (await network.handle(new Request('beings://desktop/api/subagent/tasks', { headers: { 'X-Being-Endpoint': 'one' } }))).json();
    expect(snapshot.projects).toEqual([project]);
    network.chooseProject = vi.fn().mockResolvedValue(null);
    expect(JSON.parse(await network.context(`add-project ${JSON.stringify({ directory: projectDirectory })}`))).toEqual({ cancelled: true });
    network.chooseProject = vi.fn().mockResolvedValue(projectDirectory);
    expect(JSON.parse(await network.context(`add-project ${JSON.stringify({ directory: externalDirectory })}`)).project).toEqual(project);
    const aborted = new AbortController(); aborted.abort();
    await expect(network.context('add-project', aborted.signal)).rejects.toThrow('取消');
    expect(snapshot.tasks.map((task: SceneTask) => task.projectId)).toEqual([project.id, undefined]);
    expect(JSON.parse(await network.context('projects')).projects).toEqual([project]);
    expect(JSON.parse(await network.context(`project ${project.id}`)).tasks.map((task: SceneTask) => task.id)).toEqual([rootTask.id]);
    expect(JSON.parse(await network.context(`directory ${JSON.stringify(projectDirectory)}`))).toEqual({ allowed: true });
    expect(JSON.parse(await network.context(`directory ${JSON.stringify(externalDirectory)}`))).toEqual({ allowed: false });
    if (process.platform !== 'win32') {
      await symlink(externalDirectory, path.join(projectDirectory, 'outside'));
      expect(JSON.parse(await network.context(`directory ${JSON.stringify(path.join(projectDirectory, 'outside'))}`))).toEqual({ allowed: false });
    }
    const invalid = await network.handle(new Request('beings://desktop/api/subagent/projects', { method: 'POST', headers: { 'X-Being-Endpoint': 'one', 'Content-Type': 'application/json' }, body: '{"directory":"relative"}' }));
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error).toContain('项目目录');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('scopes threads by project and resets project selection when switching Being', () => {
  const work = new WorkModel();
  work.configure('one');
  work.snapshot = { endpoint: 'one', projects: [{ id: 'proj_one', name: 'One', directory: '/one', createdAt: 1 }], tasks: [{ ...rootTask, projectId: 'proj_one' }, { ...childTask, projectId: 'proj_one' }, { ...rootTask, id: 'sub_other' }] };
  work.selectProject('proj_one');
  expect(work.projectThreads.map(thread => thread.id)).toEqual([rootTask.id]);
  work.selectProject('unassigned');
  expect(work.projectThreads.map(thread => thread.id)).toEqual(['sub_other']);
  vi.spyOn(work, 'loadDetails').mockResolvedValue();
  work.select(childTask.id);
  expect(work.projectId).toBe('proj_one');
  expect(work.selected?.tasks.map(task => task.id)).toEqual([rootTask.id, childTask.id]);
  work.startNew();
  expect(work.newProjectId).toBe('proj_one');
  work.select('sub_other');
  expect(work.projectId).toBe('unassigned');
  work.configure('two');
  expect(work.projectId).toBe('');
  expect(work.projects).toEqual([]);
});

it('starts independent work with the selected project directory and preserves the exact upstream payload', async () => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'work-create-')));
  try {
    await writeFile(path.join(directory, '.portal-ready.json'), JSON.stringify({ pid: 123, nonce: 'launch' }));
    await writeFile(path.join(directory, '.portal-work.json'), JSON.stringify({ pid: 123, nonce: 'launch', port: 39001, token: 'secret' }));
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ task_id: 'sub_new', status: 'running' }));
    const network = new WorkNetwork(() => 'beings://desktop/', () => ({ directory, endpoint: 'one', pid: 123 }), upstream);
    network.readTasks = async () => ({ endpoint: 'one', tasks: [] });
    network.sceneIds = () => ['main'];
    network.chooseProject = async () => directory;
    const { project } = JSON.parse(await network.context('add-project'));
    const body = { brief: 'New independent task', workdir: directory, scene_id: 'main' };
    const request = (input = body) => new Request('beings://desktop/api/subagent/tasks', { method: 'POST', headers: { 'X-Being-Endpoint': 'one', 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const response = await network.handle(request());
    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledWith('http://127.0.0.1:39001/api/subagent/tasks', expect.objectContaining({ body: JSON.stringify(body), method: 'POST' }));
    expect((await network.handle(request({ ...body, scene_id: 'other' }))).status).toBe(400);
    const work = new WorkModel(); work.configure('one');
    work.snapshot = { endpoint: 'one', tasks: [], projects: [project], subagentReady: true };
    work.startNew(); work.newDraft = body.brief;
    vi.stubGlobal('fetch', vi.fn(async (url, init) => init.method === 'POST' ? Response.json({ task_id: 'sub_new' }) : String(url).endsWith('/sub_new') ? Response.json({ taskId: 'sub_new', steps: [] }) : Response.json({ endpoint: 'one', projects: [project], tasks: [{ ...rootTask, id: 'sub_new', projectId: project.id }], subagentReady: true })));
    await work.createTask('main');
    expect(fetch).toHaveBeenCalledWith('beings://desktop/api/subagent/tasks', expect.objectContaining({ body: JSON.stringify(body) }));
    expect(work.selected?.id).toBe('sub_new');
    expect(work.creating).toBe(false);
    expect(work.newDraft).toBe('');
  } finally { await rm(directory, { recursive: true, force: true }); }
});


it('reads every follow-up and paginates immutable full tool records without losing content', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'work-context-'));
  let endpoint = 'one';
  const network = new WorkNetwork(() => 'beings://desktop/', () => ({ directory, endpoint }));
  const tasks = Array.from({ length: 9 }, (_, i) => ({ ...rootTask, id: `sub_${i}`, parentTaskId: i ? `sub_${i - 1}` : undefined, createdAt: i, userMessage: `request ${i}` }));
  const long = '头🙂\n'.repeat(10000) + 'COMPLETE_END';
  network.readTasks = async () => ({ endpoint, tasks });
  network.readDetails = async (_endpoint, ids) => ids.map(taskId => ({ taskId, steps: [{ at: 1, kind: 'tool', input: 'write data' }, { at: 2, kind: 'tool-result', output: taskId === 'sub_0' ? long : 'ok' }] }));
  try {
    let page = JSON.parse(await network.context('sub_0'));
    const firstNext = page.next;
    let text = page.content;
    // Later pages must read the same snapshot, even if a native agent advances.
    network.readDetails = async () => { throw new Error('must not refetch'); };
    while (page.next) { page = JSON.parse(await network.context(page.next.slice('@work '.length))); text += page.content; }
    const result = JSON.parse(text);
    expect(result.tasks).toHaveLength(9);
    expect(result.conversation[0].steps[1].output).toBe(long);
    expect(result.conversation[8].request).toBe('request 8');
    endpoint = 'two';
    await expect(network.context(firstNext.slice('@work '.length))).rejects.toThrow('过期');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
