import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { WorkImportSelection } from '../../shared/types';

/** Import choices belong to a Being; selecting a project never grants execution access. */
export class WorkImports {
  private writing: Promise<unknown> = Promise.resolve();
  constructor(private directory: string) {}
  private file(endpoint: string) { return path.join(this.directory, `${createHash('sha256').update(endpoint).digest('hex')}.json`); }
  async read(endpoint: string): Promise<WorkImportSelection> {
    const text = await readFile(this.file(endpoint), 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    return text === null ? { projectIds: [], taskIds: [] } : JSON.parse(text);
  }
  async save(endpoint: string, input: unknown): Promise<WorkImportSelection> {
    const value = input as WorkImportSelection | null;
    if (!value || !Array.isArray(value.projectIds) || !Array.isArray(value.taskIds) ||
      !value.projectIds.every(id => typeof id === 'string') || !value.taskIds.every(id => typeof id === 'string' && /^agent_[a-z][a-z0-9-]*_[a-zA-Z0-9_-]+$/.test(id))) throw new Error('导入选择格式无效。');
    const selection = { projectIds: [...new Set(value.projectIds)], taskIds: [...new Set(value.taskIds)] };
    const write = this.writing.then(async () => {
      await mkdir(this.directory, { recursive: true });
      const file = this.file(endpoint);
      await writeFile(`${file}.tmp`, JSON.stringify(selection), { mode: 0o600 });
      await rename(`${file}.tmp`, file);
      return selection;
    });
    this.writing = write.catch(() => {});
    return write;
  }
}
