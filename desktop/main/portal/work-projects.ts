import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { WorkProject } from '../../shared/types';
import type { WorkProjectRules } from '../../shared/work';
import { AgentError } from '../agent-bridge/types';

export function directoryProject<T extends Pick<WorkProject, 'directory'>>(projects: T[], directory: string) {
  return projects.filter(project => {
    // Rust canonical paths carry the Windows \\?\ prefix; Node realpath may not.
    const relative = path.relative(path.toNamespacedPath(project.directory), path.toNamespacedPath(directory));
    return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
  }).sort((a, b) => b.directory.length - a.directory.length)[0];
}

/** Local projects belong to one Being and grant subagents access only to their directories. */
export class WorkProjects {
  private writing: Promise<unknown> = Promise.resolve();
  constructor(private directory: string) {}
  private file(endpoint: string) { return path.join(this.directory, `${createHash('sha256').update(endpoint).digest('hex')}.json`); }
  async list(endpoint: string): Promise<WorkProject[]> {
    try {
      const value: unknown = JSON.parse(await readFile(this.file(endpoint), 'utf8'));
      if (!Array.isArray(value) || !value.every(p => p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.directory === 'string' && path.isAbsolute(p.directory) && Number.isFinite(p.createdAt))) throw new Error('项目记录格式错误。');
      return value;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
  async add(endpoint: string, input: unknown, goalId?: string) {
    const value = input as { directory?: unknown } | null;
    if (!value || typeof value.directory !== 'string' || !path.isAbsolute(value.directory)) throw new Error('请选择项目目录。');
    const directory = await realpath(value.directory);
    if (!(await stat(directory)).isDirectory()) throw new Error('请选择文件夹作为项目目录。');
    return this.update(endpoint, projects => {
      const existing = projects.find(project => project.directory === directory);
      if (existing) {
        if (goalId && existing.goalId && existing.goalId !== goalId) throw new AgentError('该项目已关联其他目标。', 409);
        if (goalId) existing.goalId = goalId;
        return existing;
      }
      const project = { id: `proj_${randomUUID()}`, name: path.basename(directory) || directory, directory, createdAt: Date.now(), goalId };
      projects.push(project);
      return project;
    });
  }
  setGoal(endpoint: string, id: string, goalId: string, expectedGoalId?: string) {
    return this.update(endpoint, projects => {
      const project = projects.find(row => row.id === id);
      if (!project) throw new AgentError('请先将目录添加为 Work 项目。', 404);
      if (project.goalId && project.goalId !== goalId && project.goalId !== expectedGoalId)
        throw new AgentError('该项目已关联其他目标。', 409);
      project.goalId = goalId || undefined;
      return project;
    });
  }
  setRules(endpoint: string, id: string, rules: WorkProjectRules) {
    return this.update(endpoint, projects => {
      const project = projects.find(row => row.id === id);
      if (!project) throw new AgentError('请先将目录添加为 Work 项目。', 404);
      project.rules = rules;
      return project;
    });
  }
  private update(endpoint: string, change: (projects: WorkProject[]) => WorkProject) {
    const saved = this.writing.then(async () => {
      const projects = await this.list(endpoint);
      const project = change(projects);
      await mkdir(this.directory, { recursive: true });
      const file = this.file(endpoint);
      await writeFile(`${file}.tmp`, JSON.stringify(projects), { mode: 0o600 });
      await rename(`${file}.tmp`, file);
      return project;
    });
    this.writing = saved.catch(() => {});
    return saved;
  }
}
