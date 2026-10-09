import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { strToU8, Zip, ZipDeflate } from 'fflate';
import { redact } from '../chat/connection';

const runtimeLogs = ['portal.log', 'portal.err.log', 'portal-runtime.log', 'portal-runtime.err.log',
  'supervisor.log', 'supervisor.err.log'].flatMap(name => [name, name + '.previous']);
const isLog = (name: string) => /\.log(?:\.previous|\.\d+(?:[-.]\d+)*)?$/i.test(name);

/** Export complete existing text logs, including rotations, without reading configuration files. */
export async function createLogArchive(options: {
  logsDirectory: string; runtimeDirectories: string[]; destination: string; secrets: string[];
}) {
  const entries: { file: string; status: string; bytes?: number; sourceBytes?: number }[] = [];
  const clean = (text: string) => redact(text, options.secrets)
    .replace(/((?:authorization|x-relay-secret)\s*[":=]+\s*["']?)(?:bearer\s+)?[^\s,"'}]+/gi, '$1[redacted]')
    .replace(/(["']?(?:token|secret|password|api[_-]?key|access[_-]?token)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[redacted]');
  await mkdir(options.destination, { recursive: true });
  const file = path.join(options.destination, `Portal-Desktop-logs-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.zip`);
  const temporary = file + '.tmp';
  const output = await open(temporary, 'wx', 0o600);
  let pending = Promise.resolve(), failure: unknown, included = 0;
  const archive = new Zip((error, chunk) => {
    if (error) { failure = error; return; }
    pending = pending.then(async () => { await output.writeFile(chunk); }).catch(error => { failure = error; });
  });
  async function drain() { await pending; if (failure) throw failure; }
  const collected = new Set<string>();
  const collect = async (source: string, name: string) => {
    if (collected.has(name)) return;
    collected.add(name);
    let entry: ZipDeflate | undefined, bytes = 0, sourceBytes = 0;
    try {
      const info = await lstat(source);
      if (!info.isFile() || info.isSymbolicLink()) { entries.push({ file: name, status: 'skipped: not a regular file' }); return; }
      const handle = await open(source, 'r');
      try {
        sourceBytes = (await handle.stat()).size;
        entry = new ZipDeflate(name, { level: 1 });
        archive.add(entry);
        const push = async (text: string) => {
          const data = strToU8(clean(text));
          bytes += data.length;
          entry!.push(data);
          await drain();
        };
        // Bound the read to the file size at collection time, even if it keeps growing.
        if (sourceBytes) {
          let buffer = '';
          const stream = handle.createReadStream({ start: 0, end: sourceBytes - 1, encoding: 'utf8', autoClose: false });
          for await (const chunk of stream) {
            buffer += chunk;
            const end = buffer.lastIndexOf('\n');
            if (end >= 0) { await push(buffer.slice(0, end + 1)); buffer = buffer.slice(end + 1); }
          }
          if (buffer) await push(buffer);
        }
        entries.push({ file: name, status: 'included', bytes, sourceBytes });
        included++;
      } finally { await handle.close(); }
    } catch (error) {
      if (failure) throw failure;
      const code = (error as NodeJS.ErrnoException).code;
      entries.push({ file: name, status: entry ? 'incomplete' : code === 'ENOENT' ? 'missing' : 'unavailable', ...(entry ? { bytes, sourceBytes } : {}) });
    } finally {
      entry?.push(new Uint8Array(), true);
      await drain();
    }
  };
  const scan = async (directory: string, prefix: string, recursive: boolean) => {
    let children;
    try { children = await readdir(directory, { withFileTypes: true }); }
    catch (error) {
      entries.push({ file: prefix, status: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unavailable' });
      return;
    }
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      if (child.isSymbolicLink()) continue;
      if (recursive && child.isDirectory()) await scan(path.join(directory, child.name), prefix + child.name + '/', true);
      else if (isLog(child.name)) await collect(path.join(directory, child.name), prefix + child.name);
    }
  };
  try {
    await scan(options.logsDirectory, 'client/', true);
    for (const name of ['portal-runtime.log', 'portal-status.json'])
      await collect(path.join(options.logsDirectory, name), 'portal/' + name);
    const directories = [...new Set(options.runtimeDirectories.filter(Boolean).map(directory => path.resolve(directory)))];
    for (const [index, directory] of directories.entries()) {
      const prefix = `portal/runtime-${index + 1}/`;
      await scan(directory, prefix, false);
      for (const name of [...runtimeLogs, '.portal-start-failure']) await collect(path.join(directory, name), prefix + name);
    }
    if (!included) throw new Error('未能读取日志文件，请检查日志目录权限后重试。');
    const report = new ZipDeflate('collection.json', { level: 1 });
    archive.add(report);
    report.push(strToU8(JSON.stringify({ capturedAt: new Date().toISOString(), entries }, null, 2)), true);
    archive.end();
    await drain();
    await output.close();
    await rename(temporary, file);
    return file;
  } finally {
    archive.terminate();
    await pending;
    await output.close().catch(() => {});
    await rm(temporary, { force: true });
  }
}
