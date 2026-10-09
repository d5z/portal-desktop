import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import type { LocalApp } from '../../shared/types';

/** User-chosen associations only; never infer an installation from a download or a visit. */
export class LocalApps {
  constructor(private file: string) {}
  private async records(): Promise<LocalApp[]> {
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8'));
      if (!Array.isArray(value)) throw new Error('本机 App 关联记录格式错误。');
      return value.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.path === 'string');
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
  async list() {
    return Promise.all((await this.records()).map(async item => ({ ...item, exists: await stat(item.path).then(s => s.isFile() || s.isDirectory()).catch(() => false) })));
  }
  async associate(entry: unknown, selectedPath: string) {
    const value = entry as LocalApp;
    if (!value || typeof value.id !== 'string' || !/^[\w.-]{1,160}$/.test(value.id) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 300) throw new Error('App 条目无效。');
    const info = await stat(selectedPath);
    if (!info.isFile() && !info.isDirectory()) throw new Error('请选择本机程序。');
    await this.save([...(await this.records()).filter(item => item.id !== value.id), { id: value.id, name: value.name, path: selectedPath, exists: true }]);
  }
  async remove(id: string) { await this.save((await this.records()).filter(item => item.id !== id)); }
  private async save(records: LocalApp[]) {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file + '.tmp', JSON.stringify(records), 'utf8');
    await rename(this.file + '.tmp', this.file);
  }
}
