import { applyEntryPatches, entryListSchema } from '@deepseek-ai/cordis-plugin-include';
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader';
import { satisfies, validRange } from 'semver';
import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { load } from 'js-yaml';
import { createRequire } from 'node:module';

export function packageName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || name.length > 214 || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name)) throw new Error('无效的 npm 插件名称。');
}
export async function containedFile(root: string, relative: unknown) {
  if (typeof relative !== 'string' || path.isAbsolute(relative)) throw new Error('插件入口必须是包内相对路径。');
  const base = await realpath(root), file = await realpath(path.resolve(base, relative));
  if (!file.startsWith(base + path.sep)) throw new Error('插件入口越过包目录。');
  return file;
}
export async function readDshPackage(root: string, requireDeclaration = true, allowUnbuiltClient = false) {
  const data = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  packageName(data.name);
  if ((requireDeclaration && !data.dsh) || typeof data.version !== 'string') throw new Error('此包没有 DSH 插件声明。');
  data.dsh ??= {};
  if (data.dsh.client?.platform && !['web', 'all'].includes(data.dsh.client.platform)) throw new Error(`不支持此客户端平台：${data.dsh.client.platform}`);
  if (data.engines?.dsh && (!validRange(data.engines.dsh) || !satisfies('0.2.1-rc.5', data.engines.dsh, { includePrerelease: true }))) throw new Error(`插件要求 DSH ${data.engines.dsh}；当前适配目标为 0.2.1-rc.5。`);
  if (data.dsh.client?.inject && (!Array.isArray(data.dsh.client.inject) || data.dsh.client.inject.some((name: unknown) => typeof name !== 'string'))) throw new Error('客户端 inject 必须是模块名列表。');
  const patchFile = data.dsh.bundle?.patch;
  let rows: EntryOptions[] = [];
  if (patchFile) {
    const patches = load(await readFile(await containedFile(root, patchFile), 'utf8'), { schema: entryListSchema });
    if (!Array.isArray(patches)) throw new Error('DSH bundle patch 必须是操作列表。');
    for (const operation of patches) {
      if (!operation || typeof operation !== 'object' || Object.keys(operation).some(k => !['id', 'insert', 'name', 'config', 'group', 'disabled', 'inject', 'isolate', 'intercept'].includes(k))) throw new Error('无效的 DSH patch；支持 insert 和按 id 覆盖配置。');
    }
    rows = applyEntryPatches([], patches, (message, ...args) => { throw new Error(`bundle 引用了不存在或不匹配的配置行：${message} ${args.join(' ')}`); });
    let total = 0;
    const validate = (entries: EntryOptions[]) => {
      for (const row of entries) {
        if (++total > 100) throw new Error('插件 bundle 超过 100 个模块。');
        if (!row || typeof row.name !== 'string') throw new Error('无效的 bundle 行');
        if (!row.name.startsWith('cordis:')) packageName(row.name);
        row.id ||= row.name;
        if (row.group) { if (!Array.isArray(row.config)) throw new Error('group config 必须是行列表'); validate(row.config); }
      }
    };
    validate(rows);
  } else if (data.main || typeof data.exports === 'string' || data.exports?.['.']) rows.push({ id: data.name, name: data.name });
  if (rows.length > 100) throw new Error('插件 bundle 超过 100 个模块。');
  let client: string | undefined;
  if (data.dsh.client) {
    const entry = data.exports?.['./client'];
    const file = typeof entry === 'string' ? entry : entry?.default || entry?.browser;
    try { client = await containedFile(root, file); } catch (error) { if (!allowUnbuiltClient || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return { data, rows, client };
}
export async function resolvePackageEntry(root: string, name: string) {
  const require = createRequire(path.join(root, 'package.json'));
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (name === manifest.name) {
    const entry = typeof manifest.exports === 'string' ? manifest.exports : manifest.exports?.['.'];
    return containedFile(root, (typeof entry === 'string' ? entry : entry?.default || entry?.import) || manifest.main || 'index.js');
  }
  return require.resolve(name);
}

/** Resolve a dependency manifest even when package.json is hidden by exports. */
export async function resolvePackageRoot(root: string, name: string) {
  let directory = path.dirname(await resolvePackageEntry(root, name));
  for (;;) {
    try { const data = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')); if (data.name === name) return directory; } catch {}
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`找不到插件包：${name}`);
    directory = parent;
  }
}
