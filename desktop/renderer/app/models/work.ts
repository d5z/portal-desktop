import { workExecutors } from './work-executors';
import type { DesktopAPI, SceneTask, WorkSnapshot, WorkProject, WorkImportCatalog, WorkImportSelection, SubagentTaskDetail } from '../../../shared/types';
import { Store } from '../../shared/models/store';
import { workContinuationPrompt, workPlanVersionHeader, workPlanVersionToken, type WorkGoal, type WorkGoalFields, type WorkItem, type WorkItemFields, type WorkModelSelection, type WorkStage } from '../../../shared/work';

export const workStatus: Record<SceneTask['status'], string> = { queued: '排队中', running: '执行中', done: '已完成', failed: '执行失败', cancelled: '已取消', interrupted: '已中断', budget_exhausted: '已达限额', timeout: '已超时' };
export const workActive = (task: SceneTask) => task.status === 'running' || task.status === 'queued';
export function workThreads(tasks: SceneTask[]) {
  const roots = new Map<string, SceneTask[]>();
  const byId = new Map(tasks.map(task => [task.id, task]));
  for (const task of tasks) {
    let root = task;
    while (root.parentTaskId && byId.has(root.parentTaskId)) root = byId.get(root.parentTaskId)!;
    const thread = roots.get(root.id) || [];
    thread.push(task);
    roots.set(root.id, thread);
  }
  return [...roots].map(([id, tasks]) => ({ id, tasks: tasks.sort((a, b) => a.createdAt - b.createdAt) }))
    .sort((a, b) => b.tasks.at(-1)!.createdAt - a.tasks.at(-1)!.createdAt);
}

export class WorkModel extends Store {
  endpoint = '';
  snapshot?: Omit<WorkSnapshot, 'projects'> & { projects?: WorkProject[] };
  executor = 'internal';
  newModel: WorkModelSelection | null = null;
  connectionNotice = '';
  details: SubagentTaskDetail[] = [];
  selectedId = '';
  resultTurnId = '';
  panel: 'sessions' | 'items' | 'results' | 'goals' = 'items';
  private overview: { panel: WorkModel['panel']; projectId: string } = { panel: 'items', projectId: '' };
  goalId = '';
  itemId = '';
  itemEditor?: { id: string; fields: WorkItemFields; expectedVersion?: number; startAfterSave?: boolean };
  filter = 'all';
  query = '';
  projectId = '';
  addingProject = false;
  creating = false;
  newProjectId = '';
  newDraft = '';
  drafts: Record<string, string> = {};
  loading = false;
  detailLoading = false;
  sending = false;
  error = '';
  syncError = '';
  sidebarCollapsed = false;
  importing = false;
  importLoading = false;
  importSaving = false;
  importError = '';
  importCatalog?: WorkImportCatalog;
  private detailCache = new Map<string, { signature: string; detail: SubagentTaskDetail }>();
  private detailRequests = new Map<string, Promise<SubagentTaskDetail>>();
  private threadSource?: SceneTask[];
  private threadPending?: SceneTask;
  private threadCache: ReturnType<typeof workThreads> = [];
  private conversationDetails?: SubagentTaskDetail[];
  private conversationTasks?: SceneTask[];
  private conversationCache: { task: SceneTask; steps: SubagentTaskDetail['steps'] }[] = [];
  private pendingTask?: SceneTask;
  private requestRevision = 0;
  private selectionRevision = 0;
  get agents() { return this.snapshot?.agents || [{ id: 'internal', name: '内置 Subagent', available: !!this.snapshot?.subagentReady }]; }
  get currentExecutor() { return this.creating ? this.executor : this.selected?.tasks[0].executor || 'internal'; }
  get ready() { const agent = this.agents.find(agent => agent.id === this.currentExecutor); return !!agent?.available && agent.canExecute !== false; }
  get conversation() {
    const tasks = this.selected?.tasks;
    if (tasks !== this.conversationTasks || this.details !== this.conversationDetails) {
      this.conversationTasks = tasks; this.conversationDetails = this.details;
      const byId = new Map(this.details.map(detail => [detail.taskId, detail]));
      this.conversationCache = tasks?.flatMap(task => {
        const detail = byId.get(task.id);
        return detail?.turns?.map(turn => turn.task.workdir || !task.workdir ? turn : {
          ...turn, task: { ...turn.task, workdir: task.workdir },
        }) || [{ task, steps: detail?.steps || [] }];
      }) || [];
    }
    return this.conversationCache;
  }
  async connectAgent(id: string) {
    try {
      const response = await fetch(`beings://desktop/api/work/agents/${id}/connect`, { method: 'POST', headers: { 'X-Being-Endpoint': this.endpoint } });
      if (!response.ok) throw new Error('连接安装失败，请查看 Network 响应。');
      this.connectionNotice = '连接插件已安装，请重启 DeepSeek Harness。'; await this.refresh();
    } catch (error) { this.error = (error as Error).message; this.changed(); }
  }
  get threads() {
    const tasks = this.snapshot?.tasks;
    if (tasks !== this.threadSource || this.pendingTask !== this.threadPending) {
      this.threadSource = tasks; this.threadPending = this.pendingTask;
      this.threadCache = workThreads(this.pendingTask && !tasks?.some(task => task.id === this.pendingTask!.id) ? [...(tasks || []), this.pendingTask] : tasks || []);
    }
    return this.threadCache;
  }
  get projects() { return this.snapshot?.projects || []; }
  get goals() { return this.snapshot?.goals || []; }
  get goal() { return this.goals.find(row => row.id === this.goalId); }
  goalForProject(id: string | undefined) {
    const project = this.projects.find(row => row.id === id);
    return this.goals.find(row => row.id === project?.goalId);
  }
  get project() { return this.projects.find(project => project.id === this.projectId); }
  get projectThreads() { return this.threads.filter(thread => !this.projectId || (this.projectId === 'unassigned' ? !thread.tasks[0].projectId : thread.tasks[0].projectId === this.projectId)); }
  get item() { return this.snapshot?.items?.find(item => item.id === this.itemId); }
  get selected() {
    const id = this.selectedId || this.item?.runIds.at(-1);
    return id ? this.threads.find(thread => thread.id === id || thread.tasks.some(task => task.id === id)) : undefined;
  }
  configure(endpoint: string) {
    if (this.endpoint === endpoint) return;
    this.endpoint = endpoint;
    this.requestRevision++; this.selectionRevision++;
    this.pendingTask = undefined; this.syncError = '';
    this.detailCache.clear(); this.detailRequests.clear();
    this.importing = false; this.importLoading = false; this.importSaving = false; this.importError = ''; this.importCatalog = undefined;
    this.snapshot = undefined; this.details = []; this.selectedId = ''; this.drafts = {}; this.error = ''; this.sending = false;
    this.panel = 'items'; this.itemId = ''; this.goalId = ''; this.itemEditor = undefined;
    this.overview = { panel: 'items', projectId: '' };
    this.filter = 'all'; this.query = ''; this.projectId = ''; this.addingProject = false; this.loading = false; this.detailLoading = false;
    this.creating = false; this.newProjectId = ''; this.newDraft = '';
    this.newModel = null;
    this.changed();
  }
  async request<T>(path = '', body?: object, resource = 'tasks', sceneId?: string, planVersion?: string): Promise<T> {
    const response = await fetch(`beings://desktop${resource === 'imports' ? '/api/work/imports' : `/api/subagent/${resource}`}${path}`, {
      method: body ? 'POST' : 'GET', headers: { 'X-Being-Endpoint': this.endpoint, ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(sceneId ? { 'X-Work-Scene': sceneId } : {}), ...(planVersion ? { [workPlanVersionHeader]: planVersion } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(resource === 'projects' ? `项目目录添加失败（${response.status}），请确认目录存在并可访问。` : `Work 请求失败（${response.status}），请检查执行器连接或在 Network 查看详情。`);
    return response.json();
  }
  async openImports() {
    const endpoint = this.endpoint;
    this.importing = true; this.importLoading = true; this.importCatalog = undefined; this.importError = ''; this.changed();
    try {
      const catalog = await this.request<WorkImportCatalog>('', undefined, 'imports');
      if (endpoint === this.endpoint) this.importCatalog = catalog;
    } catch (error) { if (endpoint === this.endpoint) this.importError = (error as Error).message; }
    finally { if (endpoint === this.endpoint) { this.importLoading = false; this.changed(); } }
  }
  async saveImports(selection: WorkImportSelection) {
    const endpoint = this.endpoint;
    this.importSaving = true; this.importError = ''; this.changed();
    try {
      await this.request('', selection, 'imports');
      if (endpoint !== this.endpoint) return;
      this.importing = false;
      await this.refresh();
      if (this.projectId !== 'unassigned' && !this.projects.some(project => project.id === this.projectId)) this.projectId = '';
      if (!this.selected) this.select('');
    } catch (error) { if (endpoint === this.endpoint) this.importError = (error as Error).message; }
    finally { if (endpoint === this.endpoint) { this.importSaving = false; this.changed(); } }
  }
  selectProject(id: string) { this.projectId = id; this.filter = 'all'; this.query = ''; this.select(''); }
  openGoals(id = '') {
    this.goalId = id;
    this.openPanel('goals');
  }
  async saveGoal(id: string, fields: WorkGoalFields, expectedVersion?: number) {
    const endpoint = this.endpoint;
    const goal = await this.workRequest<WorkGoal>(id ? `goals/${id}` : 'goals', id ? 'PATCH' : 'POST', { ...fields, expectedVersion });
    if (endpoint !== this.endpoint) return;
    await this.refresh();
    if (endpoint === this.endpoint && this.panel === 'goals') this.openGoals(goal.id);
  }
  async linkProject(projectId: string, goalId: string, expectedGoalId?: string) {
    const endpoint = this.endpoint;
    await this.workRequest(`projects/${projectId}`, 'PATCH', { goalId, expectedGoalId }, 'subagent');
    if (endpoint === this.endpoint) await this.refresh();
  }
  async addProject(api: DesktopAPI, goalId?: string) {
    if (this.addingProject || !this.endpoint) return;
    const endpoint = this.endpoint;
    this.addingProject = true; this.error = ''; this.changed();
    try {
      const wasCreating = this.creating;
      const directory = await api.choose('project');
      if (!directory || endpoint !== this.endpoint) return;
      const project = goalId ? await this.workRequest<WorkProject>('projects', 'POST', { directory, goalId }, 'subagent')
        : await this.request<WorkProject>('', { directory }, 'projects');
      if (endpoint !== this.endpoint) return;
      await this.refresh();
      if (endpoint === this.endpoint && !goalId) { this.selectProject(project.id); if (wasCreating) this.startNew(); }
    } catch (error) { if (endpoint === this.endpoint) this.error = (error as Error).message; }
    finally { if (endpoint === this.endpoint) { this.addingProject = false; this.changed(); } }
  }
  async refresh() {
    if (!this.endpoint) return;
    const revision = ++this.requestRevision;
    this.loading = !this.snapshot; this.changed();
    try {
      const snapshot = await this.request<WorkSnapshot>();
      if (revision !== this.requestRevision || snapshot.endpoint !== this.endpoint) return;
      const previous = this.selected;
      this.snapshot = snapshot; this.syncError = '';
      if (snapshot.tasks.some(task => task.id === this.pendingTask?.id)) this.pendingTask = undefined;
      const current = this.selected;
      if (current && this.panel === 'sessions') {
        const owner = snapshot.items?.find(item => item.runIds.includes(current.id));
        if (owner) { this.itemId = owner.id; this.panel = 'items'; }
      }
      if (current?.id !== previous?.id) this.details = [];
      const latest = current?.tasks.at(-1), prior = previous?.tasks.at(-1);
      if (!this.pendingTask && (!this.details.length || latest?.id !== prior?.id || latest?.status !== prior?.status || latest?.createdAt !== prior?.createdAt || latest?.turns !== prior?.turns || (latest && workActive(latest)))) await this.loadDetails();
    } catch (error) { if (revision === this.requestRevision) this.syncError = (error as Error).message; }
    finally { if (revision === this.requestRevision) { this.loading = false; this.changed(); } }
  }
  select(id: string, resultTurnId = '') {
    if (id.startsWith('goal_')) { this.openGoals(id); return; }
    if (id && !this.itemId && !this.selectedId && !this.creating)
      this.overview = { panel: this.panel, projectId: this.projectId };
    const isItemId = id.startsWith('work_');
    const thread = id && !isItemId ? this.threads.find(row => row.id === id || row.tasks.some(task => task.id === id)) : undefined;
    this.itemId = isItemId ? id : thread ? this.snapshot?.items?.find(item => item.runIds.includes(thread.id))?.id || '' : '';
    this.panel = !id || this.itemId ? 'items' : 'sessions';
    this.itemEditor = undefined;
    this.importing = false; this.creating = false; this.selectedId = isItemId ? '' : id;
    this.resultTurnId = resultTurnId;
    if (thread && !this.itemId) this.projectId = thread.tasks[0].projectId || 'unassigned';
    this.details = this.selected?.tasks.flatMap(task => this.detailCache.get(task.id)?.detail || []) || [];
    this.detailLoading = !!this.selected && this.details.length < this.selected.tasks.length;
    this.error = ''; this.changed(); void this.loadDetails();
  }
  openPanel(panel: WorkModel['panel']) {
    this.select('');
    this.panel = panel;
    this.changed();
  }
  back() {
    if (this.importing) { this.importing = false; this.changed(); return; }
    if (this.panel === 'goals') { this.openGoals(); return; }
    if (this.creating) { this.openPanel('sessions'); return; }
    this.projectId = this.overview.projectId;
    this.openPanel(this.overview.panel);
  }
  async workRequest<T>(path: string, method = 'GET', body?: object, resource: 'work' | 'subagent' = 'work'): Promise<T> {
    const response = await fetch(`beings://desktop/api/${resource}/${path}`, {
      method, headers: { 'X-Being-Endpoint': this.endpoint, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body && JSON.stringify(body),
    });
    const value = response.headers.get('Content-Type')?.includes('application/json') ? await response.json() : { error: await response.text() };
    if (!response.ok) throw new Error(value.error || `Work 请求失败（${response.status}）`);
    return value;
  }
  async saveItem(id: string, fields: WorkItemFields, expectedVersion?: number, expectedStage?: WorkStage) {
    const endpoint = this.endpoint;
    const item = await this.workRequest<WorkItem>(id ? 'items/' + id : 'items', id ? 'PATCH' : 'POST', { ...fields, expectedVersion, expectedStage });
    if (endpoint === this.endpoint) {
      this.itemEditor = undefined;
      await this.refresh();
    }
    return item;
  }
  async deleteItem(id: string) {
    const endpoint = this.endpoint;
    await this.workRequest(`items/${id}`, 'DELETE');
    if (endpoint !== this.endpoint) return;
    if (this.itemId === id) this.openPanel('items');
    await this.refresh();
  }
  async setProjectSessionVisible(id: string, projectVisible: boolean) {
    const endpoint = this.endpoint;
    await this.workRequest(`sessions/${id}`, 'PATCH', { projectVisible });
    if (endpoint === this.endpoint) await this.refresh();
  }
  createItem(defaults: Partial<WorkItemFields> = {}) {
    if (this.panel !== 'items') this.openPanel('items');
    this.itemEditor = { id: '', fields: {
      title: '', description: '', projectId: this.project?.id || '', executor: '', stage: 'todo',
      priority: 'none', labels: [], dueDate: '', parentId: '', ...defaults,
    } };
    this.changed();
  }
  async moveItems(ids: string[], stage: WorkStage) {
    const endpoint = this.endpoint;
    await this.workRequest('items/batch', 'POST', { ids, stage });
    if (endpoint === this.endpoint) await this.refresh();
  }
  startNew(projectId = this.project?.id) {
    this.openPanel('sessions');
    this.newProjectId = projectId || this.projects.find(project => project.id === this.newProjectId)?.id || this.projects[0]?.id || '';
    this.creating = true; this.changed();
  }
  async createTask(sceneId: string) {
    const project = this.projects.find(project => project.id === this.newProjectId);
    const draft = this.newDraft;
    if (this.sending || !project || !draft.trim() || !sceneId) return;
    const endpoint = this.endpoint;
    this.sending = true; this.error = ''; this.changed();
    let itemId = '';
    try {
      if (project.goalId) {
        const message = draft.trim();
        const title = message.split('\n')[0].slice(0, 80);
        const item = await this.workRequest<WorkItem>('items', 'POST', {
          title, description: message === title ? '' : message, projectId: project.id, executor: this.executor,
          modelSelection: this.newModel, stage: 'todo', priority: 'none', labels: [], dueDate: '', parentId: '',
        });
        if (endpoint !== this.endpoint) return;
        itemId = item.id;
        if (this.newDraft === draft) this.newDraft = '';
        this.newModel = null;
        this.projectId = project.id;
        this.overview = { panel: 'items', projectId: project.id };
        this.select(item.id);
        const receipt = await this.workRequest<{ task_id?: string }>(`items/${item.id}/runs`, 'POST', { scene_id: sceneId });
        if (endpoint !== this.endpoint) return;
        await this.refresh();
        if (receipt.task_id && this.itemId === item.id && this.threads.some(thread => thread.id === receipt.task_id)) this.select(receipt.task_id);
        return;
      }
      const external = workExecutors(endpoint, sceneId)[this.executor];
      const receipt = external ? { task_id: `agent_${this.executor}_${await external.start(project.directory, draft.trim(), this.newModel ?? undefined)}` } : await this.request<{ task_id: string }>('', { brief: draft.trim(), workdir: project.directory, scene_id: sceneId, ...(this.executor !== 'internal' ? { executor: this.executor } : {}) });
      if (endpoint !== this.endpoint) return;
      if (external) this.pendingTask = { id: receipt.task_id, nativeId: receipt.task_id.slice(`agent_${this.executor}_`.length), executor: this.executor, projectId: project.id, workdir: project.directory, sceneId, brief: draft.trim(), userMessage: draft.trim(), status: 'queued', createdAt: Date.now() };
      if (this.newDraft === draft) this.newDraft = '';
      this.newModel = null;
      this.creating = false; this.projectId = project.id; this.filter = 'all'; this.query = ''; this.selectedId = receipt.task_id;
      await this.refresh();
    } catch (error) {
      if (endpoint !== this.endpoint) return;
      if (itemId) await this.refresh();
      if (endpoint === this.endpoint) this.error = (error as Error).message;
    }
    finally { if (endpoint === this.endpoint) { this.sending = false; this.changed(); } }
  }
  async loadDetails() {
    const revision = ++this.selectionRevision;
    const selected = this.selected;
    if (!selected) { this.details = []; this.detailLoading = false; this.changed(); return; }
    this.detailLoading = !this.details.length; this.changed();
    try {
      const endpoint = this.endpoint;
      const details = await Promise.all(selected.tasks.map(async task => {
        const signature = JSON.stringify(task);
        const cached = this.detailCache.get(task.id);
        if (cached?.signature === signature && !workActive(task)) return cached.detail;
        const requestKey = `${task.id}:${signature}`;
        let request = this.detailRequests.get(requestKey);
        if (!request) {
          request = this.request<SubagentTaskDetail>(`/${task.id}`);
          this.detailRequests.set(requestKey, request);
          void request.finally(() => { if (this.detailRequests.get(requestKey) === request) this.detailRequests.delete(requestKey); }).catch(() => {});
        }
        const detail = await request;
        if (endpoint === this.endpoint) {
          if (detail.turns && cached?.detail.turns) {
            const previous = new Map(cached.detail.turns.filter(turn => !workActive(turn.task)).map(turn => [turn.task.id, turn]));
            detail.turns = detail.turns.map(turn => {
              const saved = previous.get(turn.task.id);
              return saved && saved.task.status === turn.task.status && saved.task.endedAt === turn.task.endedAt && saved.steps.length === turn.steps.length ? saved : turn;
            });
          }
          this.detailCache.delete(task.id);
          this.detailCache.set(task.id, { signature, detail });
          // Bound retained full histories while keeping recent switches instant.
          if (this.detailCache.size > 24) this.detailCache.delete(this.detailCache.keys().next().value!);
        }
        return detail;
      }));
      if (revision === this.selectionRevision) this.details = details;
    } catch (error) { if (revision === this.selectionRevision) this.error = (error as Error).message; }
    finally { if (revision === this.selectionRevision) { this.detailLoading = false; this.changed(); } }
  }
  async send(cancel = false, sceneId?: string) {
    const selected = this.selected;
    if (!selected || this.sending) return;
    const task = selected.tasks.at(-1)!;
    const submittedDraft = this.drafts[selected.id] || '';
    const draft = submittedDraft.trim();
    const steering = !cancel && task.status === 'running';
    if (!cancel && (!draft || task.status === 'queued')) return;
    const item = !cancel && !steering ? this.item : undefined;
    const goal = this.goalForProject(item?.projectId);
    const version = item ? workPlanVersionToken(item.planHistory?.at(-1)?.version || 1, goal) : undefined;
    const message = item ? workContinuationPrompt(draft, item, goal) : draft;
    const endpoint = this.endpoint;
    this.sending = true; this.error = ''; this.changed();
    try {
      const external = task.executor && workExecutors(endpoint, task.sceneId || sceneId)[task.executor];
      if (steering) await this.request(`/${task.id}/steer`, { message });
      else if (external) {
        if (cancel) await external.cancel(task.nativeId!, this.conversation.at(-1)?.task.id.split(':').at(-1));
        else await external.send(task.nativeId!, message, version);
      } else await this.request(`/${task.id}/${cancel ? 'cancel' : 'messages'}`, cancel ? {} : { message }, 'tasks', undefined, version);
      if (endpoint !== this.endpoint) return;
      if (!cancel && this.drafts[selected.id] === submittedDraft) this.drafts[selected.id] = '';
      await this.refresh();
    } catch (error) { if (endpoint === this.endpoint) this.error = (error as Error).message; }
    finally { if (endpoint === this.endpoint) { this.sending = false; this.changed(); } }
  }
  async retry(task: SceneTask, sceneId: string) {
    if (this.sending) return;
    const endpoint = this.endpoint;
    this.sending = true; this.error = ''; this.changed();
    try {
      await this.request(`/${task.id}/retry`, {}, 'tasks', sceneId || undefined);
      if (endpoint === this.endpoint) await this.refresh();
    } catch (error) { if (endpoint === this.endpoint) this.error = (error as Error).message; }
    finally { if (endpoint === this.endpoint) { this.sending = false; this.changed(); } }
  }
  watch(api: DesktopAPI) {
    const unsubscribe = api.onSceneTasks(snapshot => { if (snapshot.endpoint === this.endpoint) void this.refresh(); });
    let disposed = false;
    const poll = async () => {
      if (disposed) return;
      if (document.visibilityState === 'visible' && !this.loading) await this.refresh();
      if (!disposed) timer = setTimeout(poll, 2500);
    };
    let timer = setTimeout(poll, 2500);
    return () => { disposed = true; clearTimeout(timer); unsubscribe(); };
  }
}
