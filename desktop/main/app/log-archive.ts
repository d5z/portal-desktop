import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { strToU8, zip } from 'fflate';
import { redact } from '../chat/connection';

export const MAX_LOG_BYTES = 4 * 1024 * 1024;
const runtimeLogs = ['portal.log', 'portal.err.log', 'portal-runtime.log', 'portal-runtime.err.log',
  'supervisor.log', 'supervisor.err.log'].flatMap(name => [name, name + '.previous']);

/** Collect known log files only, never runtime configuration or connection files. */
export async function createLogArchive(options: {
  logsDirectory: string; runtimeDirectories: string[]; destination: string; secrets: string[];
}) {
  const files: Record<string, Uint8Array> = {};
  const entries: { file: string; status: string; bytes?: number }[] = [];
  const clean = (text: string) => redact(text, options.secrets)
    .replace(/((?:authorization|x-relay-secret)\s*[":=]+\s*["']?)(?:bearer\s+)?[^\s,"'}]+/gi, '$1[redacted]')
    .replace(/(["']?(?:token|secret|password|api[_-]?key|access[_-]?token)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[redacted]');
  const collect = async (source: string, name: string) => {
    try {
      const info = await lstat(source);
      if (!info.isFile() || info.isSymbolicLink()) { entries.push({ file: name, status: 'skipped: not a regular file' }); return; }
      const handle = await open(source, 'r');
      let text: string, truncated: boolean;
      try {
        const { size } = await handle.stat();
        truncated = size > MAX_LOG_BYTES;
        const buffer = Buffer.alloc(Math.min(size, MAX_LOG_BYTES));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, Math.max(0, size - MAX_LOG_BYTES));
        text = buffer.subarray(0, bytesRead).toString('utf8');
        // Drop a partial leading line, including any partial credential.
        if (truncated) text = '[较早内容已省略，仅保留文件末尾 4 MiB 内的完整行]\n' + (text.includes('\n') ? text.slice(text.indexOf('\n') + 1) : '');
      } finally { await handle.close(); }
      files[name] = strToU8(clean(text));
      entries.push({ file: name, status: truncated ? 'truncated' : 'included', bytes: files[name].length });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      entries.push({ file: name, status: code === 'ENOENT' ? 'missing' : 'unavailable' });
    }
  };
  for (const name of ['client-errors.log', 'client-errors.log.previous'])
    await collect(path.join(options.logsDirectory, name), 'client/' + name);
  for (const name of ['portal-runtime.log', 'portal-status.json'])
    await collect(path.join(options.logsDirectory, name), 'portal/' + name);
  const directories = [...new Set(options.runtimeDirectories.filter(Boolean).map(directory => path.resolve(directory)))];
  for (const [index, directory] of directories.entries()) {
    for (const name of [...runtimeLogs, '.portal-start-failure'])
      await collect(path.join(directory, name), `portal/runtime-${index + 1}/${name}`);
  }
  if (!Object.keys(files).length) throw new Error('未能读取日志文件，请检查日志目录权限后重试。');
  files['collection.json'] = strToU8(JSON.stringify({ capturedAt: new Date().toISOString(), maxFileBytes: MAX_LOG_BYTES, entries }, null, 2));
  const archive = await new Promise<Uint8Array>((resolve, reject) => {
    zip(files, { level: 1 }, (error, data) => error ? reject(error) : resolve(data));
  });
  await mkdir(options.destination, { recursive: true });
  const file = path.join(options.destination, `Portal-Desktop-logs-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.zip`);
  const temporary = file + '.tmp';
  try {
    await writeFile(temporary, archive, { flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
  return file;
}
