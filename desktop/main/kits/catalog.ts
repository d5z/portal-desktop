import { cp, lstat, mkdir, readdir, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { parse } from 'smol-toml';
import type { Settings, KitLibrary, LocalKit } from '../../shared/types';

const expand = (value: string, home: string) => value === '~' ? home : value.startsWith('~/') ? path.join(home, value.slice(2)) : value;
export async function kitLocation(settings: Settings, home = os.homedir()) {
  let directory = path.join(home, '.heart-portal', 'kits');
  const enabled = settings.kitsEnabled;
  if (settings.portalConfigPath) {
    const config = parse((await readFile(settings.portalConfigPath, 'utf8')).replace(/^\uFEFF/, ''));
    if (typeof config.kits_dir === 'string') directory = path.resolve(settings.workspace, expand(config.kits_dir, home));
  }
  return { directory, enabled, configPath: settings.portalConfigPath };
}
export async function readKit(directory: string, platform: string = process.platform): Promise<LocalKit> {
  const file = path.join(directory, 'manifest.json');
  if ((await stat(file)).size > 1024 * 1024) throw new Error('manifest.json 超过 1 MB。');
  const manifest = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
  if (typeof manifest.name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(manifest.name)) throw new Error('Kit 名称必须由字母、数字、横线或下划线组成。');
  const command = Array.isArray(manifest.command)
    ? manifest.command
    : manifest.command && typeof manifest.command === 'object'
      ? (process.platform === 'win32' ? manifest.command.windows : manifest.command.posix) || []
      : [];
  if (typeof manifest.version !== 'string' || !manifest.version || !command.length || !command.every((v: unknown) => typeof v === 'string' && !v.includes('\0'))) throw new Error('manifest.json 缺少 version 或 Portal 所需的 command 数组。');
  if (!Array.isArray(manifest.tools) || manifest.tools.length > 1000 || !manifest.tools.every((v: any) => v && typeof v.name === 'string' && typeof v.description === 'string')) throw new Error('manifest.json 的 tools 格式不符合 Portal 要求。');
  if (manifest.platform !== undefined && (!Array.isArray(manifest.platform) || !manifest.platform.every((v: unknown) => typeof v === 'string'))) throw new Error('platform 必须是字符串数组。');
  const normalizePlatform = (value: string) => value.toLowerCase().replace(/^macos$/, 'darwin').replace(/^win32$/, 'windows');
  const current = normalizePlatform(platform);
  const platforms = manifest.platform?.map(normalizePlatform);
  return { name: manifest.name, version: manifest.version, description: String(manifest.description || ''),
    directory, command, tools: manifest.tools.map((v: any) => ({ name: v.name, description: v.description, params: v.params })),
    compatible: !platforms || platforms.includes(current), eager: manifest.eager === true };
}
export async function localKits(settings: Settings, home?: string): Promise<KitLibrary> {
  const location = await kitLocation(settings, home);
  let entries;
  try { entries = await readdir(location.directory, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...location, kits: [] }; throw error; }
  const kits: LocalKit[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const directory = path.join(location.directory, entry.name);
    try { kits.push(await readKit(directory)); }
    catch (error) { kits.push({ name: entry.name, directory, version: '', description: '', command: [], tools: [], compatible: false, eager: false, problem: `无法加载：${error instanceof Error ? error.message : 'manifest.json 无效'}` }); }
  }
  return { ...location, kits };
}

export async function deleteLocalKit(settings: Settings, name: string, home = os.homedir()): Promise<void> {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(name)) throw new Error('无效的 Kit 名称。');
  const { directory } = await kitLocation(settings, home);
  const target = path.join(directory, name);
  if (path.dirname(target) !== path.resolve(directory)) throw new Error('无效的 Kit 路径。');
  let metadata;
  try { metadata = await lstat(target); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  if (!metadata.isDirectory()) throw new Error('Kit 路径不是目录，未删除任何文件。');
  await rm(target, { recursive: true, force: false });
}

// Import only a directory chosen through the native file picker. Never run provision scripts.
// Stage outside kits_dir: Portal must never see a partially copied manifest during startup.
export async function importLocalKit(source: string, destination: string): Promise<LocalKit> {
  const canonicalSource = await realpath(source);
  await mkdir(path.dirname(destination), { recursive: true });
  const canonicalParent = await realpath(path.dirname(destination));
  if (canonicalParent === canonicalSource || canonicalParent.startsWith(canonicalSource + path.sep)) throw new Error('不能把 Kit 导入到它自己的子目录。');
  const kit = await readKit(source);
  if (!kit.compatible) throw new Error('这个 Kit 不支持当前系统。');
  const target = path.join(destination, kit.name);
  try { await lstat(target); throw new Error('同名 Kit 已存在，请先在 Kit 目录中处理旧版本。'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  let total = 0, count = 0;
  const inspect = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name); const metadata = await lstat(file);
      if (metadata.isSymbolicLink() || (!metadata.isFile() && !metadata.isDirectory())) throw new Error('导入目录包含链接或特殊文件，请使用普通文件组成的 Kit。');
      if (++count > 20000 || (total += metadata.size) > 256 * 1024 * 1024) throw new Error('Kit 超过导入限制（256 MB / 20,000 个文件）。');
      if (metadata.isDirectory()) await inspect(file);
    }
  };
  await inspect(canonicalSource);
  const stage = path.join(path.dirname(destination), '.beings-kit-' + randomUUID());
  try {
    await cp(canonicalSource, stage, { recursive: true, dereference: false, errorOnExist: true, force: false });
    if (!(await lstat(stage)).isDirectory()) throw new Error('Kit 源目录在导入期间发生了变化，请重试。');
    total = 0; count = 0; await inspect(stage);
    // Grove manifests can contain portable paths. Resolve KIT_DIR for the Rust loader.
    const manifestPath = path.join(stage, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.command = manifest.command.map((value: string) => value.replaceAll('{{KIT_DIR}}', target));
    if (manifest.command.some((value: string) => /\{\{.*\}\}/.test(value))) throw new Error('command 中仍有未配置的占位符，请先填写后导入。');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    await readKit(stage);
    await mkdir(destination, { recursive: true });
    await rename(stage, target);
    return { ...kit, directory: target, command: manifest.command };
  } finally { await rm(stage, { recursive: true, force: true }); }
}
