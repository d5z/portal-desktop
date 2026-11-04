import { watch, type FSWatcher } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { SceneTask } from '../../shared/types';

const statuses = new Set(['queued', 'running', 'done', 'failed', 'cancelled', 'interrupted', 'budget_exhausted', 'timeout']);
export function publicSceneTasks(document: unknown, scenes: Set<string>): SceneTask[] {
  const tasks = (document as { tasks?: unknown })?.tasks;
  if (!Array.isArray(tasks)) return [];
  return tasks.filter(t => t && typeof t.task_id === 'string' && typeof t.scene_id === 'string' && scenes.has(t.scene_id) && statuses.has(t.status)
    && Number.isFinite(t.created_ms)).slice(-200).map(t => ({
      id: t.task_id.slice(0, 256), sceneId: t.scene_id, status: t.status,
      createdAt: t.created_ms, endedAt: Number.isFinite(t.ended_ms) ? t.ended_ms : undefined,
      // Task errors may contain upstream response bodies or credentials. Never expose them here.
      error: t.status === 'failed' ? (/\b401\b/.test(String(t.error)) ? '模型鉴权失败，请检查 subagent 密钥' : 'subagent 执行失败，请查看本机诊断') : undefined,
    }));
}

/** Watch the directory, not the inode: Portal atomically replaces ledger.json. No polling. */
export class SceneTaskObserver {
  private watcher?: FSWatcher;
  private timer?: ReturnType<typeof setTimeout>;
  private file = '';
  private generation = 0;
  constructor(private publish: (tasks: SceneTask[]) => void, private scenes: () => Set<string>) {}
  async configure(directory?: string) {
    if (!directory) { this.close(); this.file = ''; return []; }
    const file = path.join(directory, 'ledger.json');
    if (file !== this.file || !this.watcher) {
      this.close(); this.file = file;
      await this.arm();
    }
    return this.read();
  }
  private async arm() {
    const generation = this.generation;
    let directory = path.dirname(this.file);
    while (directory !== path.dirname(directory)) {
      try { await stat(directory); break; } catch { directory = path.dirname(directory); }
    }
    if (generation !== this.generation) return;
    try {
      this.watcher = watch(directory, () => {
        clearTimeout(this.timer);
        this.timer = setTimeout(async () => {
          if (generation !== this.generation) return;
          this.watcher?.close(); this.watcher = undefined;
          await this.arm();
          const tasks = await this.read();
          if (generation === this.generation) this.publish(tasks);
        }, 80);
      });
      this.watcher.on('error', () => { this.watcher?.close(); this.watcher = undefined; });
    } catch { /* Read-only snapshot remains available. */ }
  }
  async read() {
    try {
      if ((await stat(this.file)).size > 2_000_000) return [];
      return publicSceneTasks(JSON.parse(await readFile(this.file, 'utf8')), this.scenes());
    } catch { return []; }
  }
  close() { this.generation++; clearTimeout(this.timer); this.watcher?.close(); this.watcher = undefined; }
}
