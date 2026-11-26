import type { SceneTask, WorkProject } from '../../shared/types';
import type { WorkModelSelection } from '../../shared/work';
import { AgentError, agentTaskId, type AgentAdapter, type AgentDescriptor, type AgentSnapshot } from './types';

/** Add an adapter here; Work and Being need no executor-specific branches. */
export class AgentBridge {
  private adapters = new Map<string, AgentAdapter>();
  private cached?: Promise<AgentSnapshot & { agents: AgentDescriptor[] }>;
  private refreshedAt = 0;
  private selectionKey = '';
  constructor(adapters: AgentAdapter[]) { for (const adapter of adapters) this.register(adapter); }
  register(adapter: AgentAdapter) {
    if (this.adapters.has(adapter.id)) throw new Error(`执行器 ID 已注册：${adapter.id}`);
    this.adapters.set(adapter.id, adapter);
    this.invalidate();
  }
  adapter(id: string) { const adapter = this.adapters.get(id); if (!adapter) throw new AgentError('未知的执行器。', 400); return adapter; }
  hasNative(id: string) { return !!this.adapters.get(id)?.native; }
  invalidate() { this.cached = undefined; }
  snapshot(taskIds: string[] = []) {
    const key = JSON.stringify(taskIds);
    if (key !== this.selectionKey) { this.selectionKey = key; this.invalidate(); }
    if (this.cached && Date.now() - this.refreshedAt < 1500) return this.cached;
    this.refreshedAt = Date.now();
    return this.cached = (async () => {
      const rows = await Promise.all([...this.adapters.values()].map(async adapter => {
        let descriptor: AgentDescriptor = { id: adapter.id, name: adapter.name, available: false };
        try {
          descriptor = await adapter.status();
          if (!descriptor.available) return { descriptor, projects: [], tasks: [] };
          const prefix = `agent_${adapter.id}_`;
          return { descriptor, ...await adapter.list(new Set(taskIds.filter(id => id.startsWith(prefix)).map(id => id.slice(prefix.length)))) };
        } catch (error) {
          return { descriptor: { ...descriptor, available: false, message: (error as Error).message }, projects: [], tasks: [] };
        }
      }));
      return { agents: rows.map(row => row.descriptor), projects: rows.flatMap(row => row.projects), tasks: rows.flatMap(row => row.tasks) };
    })();
  }
  async start(executor: string, directory: string, message: string, modelSelection?: WorkModelSelection, onCreated?: (nativeId: string) => Promise<void>) {
    const adapter = this.adapter(executor);
    const nativeId = onCreated ? await adapter.start(directory, message, modelSelection, onCreated) : await adapter.start(directory, message, modelSelection);
    this.invalidate(); return { task_id: agentTaskId(executor, nativeId) };
  }
  async read(task: SceneTask) { return this.adapter(task.executor!).read(task.nativeId!); }
  async send(task: SceneTask, message: string) {
    const turn = await this.adapter(task.executor!).send(task.nativeId!, message);
    this.invalidate();
    return turn;
  }
  async steer(task: SceneTask, message: string) {
    const adapter = this.adapter(task.executor!);
    if (!adapter.steer) throw new AgentError('此执行器不支持向运行中的任务追加指令。', 409);
    await adapter.steer(task.nativeId!, message);
  }
  async cancel(task: SceneTask) { await this.adapter(task.executor!).cancel(task.nativeId!); this.invalidate(); }
  async connect(id: string) { const adapter = this.adapter(id); if (!adapter.connect) throw new AgentError('此执行器无需安装连接插件。', 400); await adapter.connect(); this.invalidate(); }
  close() { for (const adapter of this.adapters.values()) adapter.close(); }
}
/** Local registrations win. Native projects with the same canonical directory share one group. */
export function mergeProjects(local: WorkProject[], imported: WorkProject[]) {
  const projects = new Map(local.map(project => [project.directory, project]));
  for (const project of imported) if (!projects.has(project.directory)) projects.set(project.directory, project);
  return [...projects.values()];
}
