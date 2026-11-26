import { readFile, rename, writeFile } from 'node:fs/promises';
import type { SceneTask, WorkProject } from '../../shared/types';
import type { WorkModelSelection } from '../../shared/work';
import type { WorkAgentConnection } from '../../shared/work-executor';
import { AgentError, agentTaskId, type AgentAdapter, type AgentDescriptor, type AgentSnapshot } from './types';
import { workExecutionDisabled } from './permissions';

/** Add an adapter here; Work and Being need no executor-specific branches. */
export class AgentBridge {
  private adapters = new Map<string, AgentAdapter>();
  private cached?: Promise<AgentSnapshot & { agents: AgentDescriptor[] }>;
  private refreshedAt = 0;
  private selectionKey = '';
  private disabled = new Set<string>();
  private saving: Promise<unknown> = Promise.resolve();
  constructor(adapters: AgentAdapter[], private settingsFile?: string) { for (const adapter of adapters) this.register(adapter); }
  register(adapter: AgentAdapter) {
    if (this.adapters.has(adapter.id)) throw new Error(`执行器 ID 已注册：${adapter.id}`);
    this.adapters.set(adapter.id, adapter);
    this.invalidate();
  }
  adapter(id: string) { const adapter = this.adapters.get(id); if (!adapter) throw new AgentError('未知的执行器。', 400); return adapter; }
  hasNative(id: string) { return !!this.adapters.get(id)?.native; }
  invalidate() { this.cached = undefined; }
  async loadSettings() {
    if (!this.settingsFile) return;
    const raw = await readFile(this.settingsFile, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (raw === undefined) return;
    const disabled: unknown = JSON.parse(raw);
    if (!Array.isArray(disabled) || disabled.some(id => typeof id !== 'string')) throw new Error('执行器连接设置格式无效。');
    this.disabled = new Set(disabled);
    this.invalidate();
  }
  executionEnabled(id: string) { return !this.disabled.has(id); }
  setExecutionEnabled(id: string, enabled: boolean) {
    this.adapter(id);
    const save = this.saving.then(async () => {
      const disabled = new Set(this.disabled);
      if (enabled) disabled.delete(id);
      else disabled.add(id);
      if (this.settingsFile) {
        await writeFile(this.settingsFile + '.tmp', JSON.stringify([...disabled]), { mode: 0o600 });
        await rename(this.settingsFile + '.tmp', this.settingsFile);
      }
      this.disabled = disabled;
      this.invalidate();
      return { id, enabled };
    });
    this.saving = save.catch(() => {});
    return save;
  }
  private executionStatus(descriptor: AgentDescriptor) {
    return this.executionEnabled(descriptor.id) ? descriptor : { ...descriptor, canExecute: false, message: workExecutionDisabled };
  }
  async connections(): Promise<WorkAgentConnection[]> {
    return Promise.all([...this.adapters.values()].map(async adapter => {
      let status: AgentDescriptor = { id: adapter.id, name: adapter.name, available: false };
      try {
        status = await adapter.status();
        if (status.available) await adapter.probe?.();
        return { ...this.executionStatus(status), enabled: this.executionEnabled(adapter.id),
          diagnostic: status.available ? undefined : 'unavailable' };
      } catch (error) {
        return { ...status, enabled: this.executionEnabled(adapter.id), available: false, canExecute: false,
          diagnostic: 'error', message: error instanceof AgentError ? `无法连接到本机执行器（${error.status}）。` : '无法连接到本机执行器。' };
      }
    }));
  }
  snapshot(taskIds: string[] = []) {
    const key = JSON.stringify(taskIds);
    if (key !== this.selectionKey) { this.selectionKey = key; this.invalidate(); }
    if (this.cached && Date.now() - this.refreshedAt < 1500) return this.cached;
    this.refreshedAt = Date.now();
    return this.cached = (async () => {
      const rows = await Promise.all([...this.adapters.values()].map(async adapter => {
        let descriptor: AgentDescriptor = { id: adapter.id, name: adapter.name, available: false };
        try {
          descriptor = this.executionStatus(await adapter.status());
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
    if (!this.executionEnabled(executor)) throw new AgentError(workExecutionDisabled, 403);
    const nativeId = onCreated ? await adapter.start(directory, message, modelSelection, onCreated) : await adapter.start(directory, message, modelSelection);
    this.invalidate(); return { task_id: agentTaskId(executor, nativeId) };
  }
  async read(task: SceneTask) { return this.adapter(task.executor!).read(task.nativeId!); }
  async send(task: SceneTask, message: string) {
    if (!this.executionEnabled(task.executor!)) throw new AgentError(workExecutionDisabled, 403);
    const turn = await this.adapter(task.executor!).send(task.nativeId!, message);
    this.invalidate();
    return turn;
  }
  async steer(task: SceneTask, message: string) {
    if (!this.executionEnabled(task.executor!)) throw new AgentError(workExecutionDisabled, 403);
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
