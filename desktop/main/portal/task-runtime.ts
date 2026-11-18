import { access, cp, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

/** Standalone engines may omit the sidecar; client packages always carry it. */
export async function portalRuntimeId(binary: string): Promise<string | undefined> {
  const text = await readFile(path.join(path.dirname(binary), 'portal-runtime/runtime.json'), 'utf8')
    .catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return undefined; throw error; });
  if (text === undefined) return undefined;
  const value = JSON.parse(text);
  if (value.schema !== 1 || !/^[a-f0-9]{64}$/.test(value.id)) throw new Error('Portal 内置运行时清单无效。');
  return value.id;
}

async function runtimeManifestId(root: string) {
  const document = JSON.parse(await readFile(path.join(root, 'runtime.json'), 'utf8')) as {
    schema?: number; id?: string; python?: { path?: string }; node?: { path?: string };
  };
  if (document.schema !== 1 || !/^[a-f0-9]{64}$/.test(document.id || '') ||
      !document.python?.path || !document.node?.path ||
      !document.python.path.split(/[\\/]/).every(part => part && part !== '.' && part !== '..') ||
      !document.node.path.split(/[\\/]/).every(part => part && part !== '.' && part !== '..')) return undefined;
  await access(path.join(root, document.python.path));
  await access(path.join(root, document.node.path));
  return document.id;
}

/** Install one user-level runtime copy shared by foreground and background Portal. */
export async function ensurePortalRuntime(binary: string, directory: string, runtimeId?: string) {
  const id = runtimeId ?? await portalRuntimeId(binary);
  if (id === undefined) return undefined;
  const source = path.join(path.dirname(binary), 'portal-runtime');
  const sourceId = await runtimeManifestId(source);
  if (sourceId !== id) throw new Error('Portal 内置运行时清单与版本不一致。');
  const root = path.join(directory, 'portal-runtimes', id);
  if (await runtimeManifestId(root).catch(() => undefined) === id) return root;
  await mkdir(path.dirname(root), { recursive: true, mode: 0o700 });
  const temporary = `${root}.${randomUUID()}.tmp`;
  try {
    await cp(source, temporary, { recursive: true, verbatimSymlinks: true });
    await rm(root, { recursive: true, force: true });
    await rename(temporary, root);
  } finally { await rm(temporary, { recursive: true, force: true }); }
  return root;
}
