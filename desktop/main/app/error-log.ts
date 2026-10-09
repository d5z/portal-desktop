import { appendFile, mkdir, open, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { redact } from '../chat/connection';
import { publicErrorMessage } from '../../shared/errors';

export class ClientErrorLog {
  readonly directory: string;
  readonly file: string;
  readonly runtimeFile: string;
  private writing = Promise.resolve();
  private recent = new Map<string, number>();
  constructor(directory: string, private secrets: () => string[] = () => []) {
    this.directory = path.join(directory, 'logs');
    this.file = path.join(this.directory, 'client-errors.log');
    this.runtimeFile = path.join(this.directory, 'client-runtime.log');
  }
  private append(file: string, entry: string, maxBytes: number) {
    this.writing = this.writing.then(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const size = await stat(file).then(info => info.size, error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
        throw error;
      });
      if (size + Buffer.byteLength(entry) > maxBytes) {
        await rm(file + '.previous', { force: true });
        if (size) await rename(file, file + '.previous');
      }
      await appendFile(file, entry, { mode: 0o600 });
    }).catch(error => { console.error('Client log unavailable:', redact(String(error), this.secrets())); });
  }
  info(context: string, detail: unknown) {
    const text = redact(String(detail), this.secrets());
    this.append(this.runtimeFile, `${new Date().toISOString()} [${context}]\n${text}\n\n`, 10 * 1024 * 1024);
  }
  report(context: string, error: unknown, fallback?: string): string {
    const raw = error instanceof Error ? error.stack || error.message : String(error);
    const detail = redact(raw, this.secrets()).slice(0, 32_000);
    const key = context + '\n' + detail;
    const now = Date.now();
    if (now - (this.recent.get(key) || 0) > 15_000) {
      if (this.recent.size >= 100) this.recent.delete(this.recent.keys().next().value!);
      this.recent.set(key, now);
      const entry = `${new Date(now).toISOString()} [${context}]\n${detail}\n\n`;
      this.append(this.file, entry, 1024 * 1024);
    }
    return publicErrorMessage(error, fallback);
  }
  async flush() { await this.writing; }
  async exportSnapshot(runtime: string[], status: Record<string, unknown>) {
    await this.flush();
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeFile(this.file, '暂无客户端错误。后续错误详情会自动记录在此文件。\n', { flag: 'wx', mode: 0o600 })
      .catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; });
    await writeFile(path.join(this.directory, 'portal-runtime.log'),
      redact(runtime.join('\n') || '暂无 Portal 运行输出。请查看 portal-status.json 中的启动状态。', this.secrets()), { mode: 0o600 });
    await writeFile(path.join(this.directory, 'portal-status.json'),
      redact(JSON.stringify(status, null, 2), this.secrets()), { mode: 0o600 });
  }
  async recentText() {
    await this.flush();
    let file;
    try { file = await open(this.file, 'r'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw error; }
    try {
      const { size } = await file.stat();
      const start = Math.max(0, size - 16_000);
      const buffer = Buffer.alloc(Math.min(size, 16_000));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
      const text = buffer.subarray(0, bytesRead).toString('utf8');
      return start ? '[较早内容已省略]\n' + text.slice(text.indexOf('\n') + 1) : text;
    } finally { await file.close(); }
  }
}
