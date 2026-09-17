import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile, rename, access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { x as extract } from 'tar';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { TOWN_ORIGIN, TownClient } from '../town/client';
import { readKit, kitLocation } from './catalog';
import { redact } from '../chat/connection';
import type { Settings, KitInstallPlan, KitInstallInput } from '../../shared/types';

const MAX_DOWNLOAD = 64 * 1024 * 1024;
const MAX_FILES = 20000;
const MAX_UNPACKED = 256 * 1024 * 1024;
const hosts = new Set(['beings.town', 'github.com', 'codeload.github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
const exists = (file: string) => access(file).then(() => true, () => false);
export function dotenv(values: Record<string, string>) {
  const quote = (value: string) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n').replaceAll('\r', '\\r').replaceAll('\t', '\\t')}"`;
  return Object.entries(values).filter(([, value]) => value).map(([name, value]) => `${name}=${quote(value)}`).join('\n') + '\n';
}
export function archivePath(value: string) {
  const name = value.replace(/^(\.\/)+/, '').replace(/\/$/, '');
  if (!name || name === '.') return '';
  if (path.posix.isAbsolute(name) || path.win32.isAbsolute(name) || /[\\:\x00-\x1f]/.test(name) || name.split('/').some(p => !p || p === '..' || p === '.' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(p))) throw new Error('Kit 压缩包包含不安全或不兼容的路径。');
  return name;
}
export async function unpackKit(buffer: Buffer, directory: string) {
  if (buffer[0] !== 0x1f || buffer[1] !== 0x8b) throw new Error('Kit 下载内容不是受支持的 tar.gz 压缩包。');
  let count = 0, bytes = 0;
  const seen = new Set<string>();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let expanded = 0;
  const limit = new Transform({ transform(chunk, _encoding, callback) { expanded += chunk.length; callback(expanded > MAX_UNPACKED + 32 * 1024 * 1024 ? new Error('Kit 解压数据超过限制。') : null, chunk); } });
  const tarFile = path.join(path.dirname(directory), '.beings-archive-' + randomUUID() + '.tar');
  let violation: Error | undefined;
  try {
    await pipeline(Readable.from([buffer]), createGunzip(), limit, createWriteStream(tarFile, { mode: 0o600, flags: 'wx' }));
    await extract({ file: tarFile, cwd: directory, strict: true, preservePaths: false, umask: 0o077, noChmod: true,
      filter: (name, entry) => {
        if (violation) return false;
        try {
          const normalized = archivePath(name);
          if (!('type' in entry) || !['File', 'Directory', 'OldFile'].includes(entry.type)) throw new Error('Kit 压缩包不能包含链接或特殊文件。');
          if (!normalized) return false;
          const key = normalized.toLowerCase();
          if (seen.has(key)) throw new Error('Kit 压缩包包含重名文件。'); seen.add(key);
          if (++count > MAX_FILES || !Number.isSafeInteger(entry.size) || entry.size < 0 || (bytes += entry.size) > MAX_UNPACKED) throw new Error('Kit 解压内容超过限制（256 MB / 20,000 项）。');
          return true;
        } catch (error) { violation = error as Error; return false; }
      } });
    if (violation) throw violation;
  } finally { await rm(tarFile, { force: true }); }
  if (await exists(path.join(directory, 'manifest.json'))) return directory;
  const entries = await readdir(directory, { withFileTypes: true });
  const folders = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'));
  if (folders.length === 1 && await exists(path.join(directory, folders[0].name, 'manifest.json'))) return path.join(directory, folders[0].name);
  throw new Error('压缩包根目录或单个顶层目录中缺少 manifest.json。');
}
export async function downloadKit(id: string, fetcher: typeof fetch) {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id)) throw new Error('无效的 Kit 编号。');
  let url = `${TOWN_ORIGIN}/api/grove/${id}/download`;
  const signal = AbortSignal.timeout(120000);
  for (let attempt = 0; attempt < 6; attempt++) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || !hosts.has(parsed.hostname)) throw new Error('此下载源暂不支持客户端安装，请使用 Grove 或 GitHub Release 的压缩包。');
    const response = await fetcher(url, { redirect: 'manual', credentials: 'omit', signal, headers: { Accept: 'application/gzip,application/octet-stream' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get('location'); await response.body?.cancel();
      if (!next) throw new Error('下载重定向缺少地址。'); url = new URL(next, url).href; continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Kit 下载失败（HTTP ${response.status}）。`); }
    if (Number(response.headers.get('content-length')) > MAX_DOWNLOAD) { await response.body?.cancel(); throw new Error('Kit 压缩包超过 64 MB。'); }
    const reader = response.body?.getReader(); if (!reader) throw new Error('下载内容为空。');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX_DOWNLOAD) throw new Error('Kit 压缩包超过 64 MB。'); chunks.push(value); }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    return Buffer.concat(chunks);
  }
  throw new Error('Kit 下载重定向次数过多。');
}
function kill(child: ReturnType<typeof spawn>) {
  if (!child.pid) return;
  if (process.platform === 'win32') { const p = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); p.on('error', () => child.kill()); }
  else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
}
export async function runInstallCommand(program: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(program, args, { cwd, env, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', timedOut = false;
    for (const stream of [child.stdout, child.stderr]) stream?.on('data', data => { output = (output + data).slice(-3000); });
    const timer = setTimeout(() => { timedOut = true; kill(child); }, 300000);
    child.once('error', () => { clearTimeout(timer); reject(new Error(`找不到或无法运行 ${path.basename(program)}，请先安装对应运行环境。`)); });
    child.once('exit', code => { clearTimeout(timer); child.stdout?.destroy(); child.stderr?.destroy(); const secrets = Object.entries(env).filter(([key]) => /KEY|TOKEN|SECRET|PASSWORD/i.test(key)).map(([, value]) => value || ''); code === 0 ? resolve() : reject(new Error(timedOut ? '安装依赖超时，请重试。' : `安装依赖失败：${redact(output, secrets)}`)); });
  });
}
interface Prepared { plan: KitInstallPlan; root: string; directory: string; manifest: any; settings: Settings; created: number }
export class KitInstaller {
  private pending = new Map<string, Prepared>();
  constructor(private cache: string, private fetcher: typeof fetch = fetch) {}
  async prepare(id: string, settings: Settings): Promise<KitInstallPlan> {
    for (const [ticket, value] of this.pending) if (Date.now() - value.created > 30 * 60000) await this.discard(ticket);
    if (this.pending.size >= 3) throw new Error('请先关闭其他 Kit 安装窗口。');
    const { directory, enabled } = await kitLocation(settings);
    if (!enabled) throw new Error('请先在本机设置或现有 Portal 配置中启用 Kits。');
    const details = await new TownClient(() => '', this.fetcher).query({ kind: 'kit', id });
    if (!details.ok) throw new Error(details.message);
    if (details.data.ambiguous) throw new Error('此名称对应多个 Kit，请通过市集中的具体条目安装。');
    if (details.data.kind === 'app') throw new Error('Grove App 没有 Kit bundle，请前往其仓库获取安装方式。');
    if (details.data.has_bundle === false && !details.data.source_url) throw new Error('此 Kit 没有可下载的安装包。');
    const data = await downloadKit(id, this.fetcher);
    // Stage beside kits_dir, so final activation uses an atomic same-filesystem rename.
    await mkdir(path.dirname(directory), { recursive: true });
    const root = await mkdtemp(path.join(path.dirname(directory), '.beings-download-'));
    try {
      const source = await unpackKit(data, path.join(root, 'unpacked'));
      const file = path.join(source, 'manifest.json');
      if ((await stat(file)).size > 1024 * 1024) throw new Error('Kit manifest 超过 1 MB。');
      const manifest = JSON.parse(await readFile(file, 'utf8'));
      if (manifest.name !== details.data.name || manifest.version !== details.data.version) throw new Error('下载包名称或版本与 Grove 清单不一致，请刷新后重试。');
      // Grove can enrich provision metadata without rewriting the stored archive.
      const catalogManifest = details.data.manifest as any;
      manifest.provision = { ...(catalogManifest?.provision || {}), ...(manifest.provision || {}) };
      if (manifest.transport && manifest.transport !== 'stdio') throw new Error('当前 Portal 仅支持 stdio Kit。');
      manifest.platform ??= manifest.provision?.platforms;
      manifest.tools = (manifest.tools || []).map((t: any) => ({ ...t, description: t.description || '', params: t.params || t.inputSchema || { type: 'object', properties: {} } }));
      await writeFile(file, JSON.stringify(manifest));
      const kit = await readKit(source); if (!kit.compatible) throw new Error('此 Kit 不支持当前系统。');
      if (await exists(path.join(directory, kit.name))) throw new Error('同名 Kit 已安装，当前安装不会覆盖已有配置。');
      const environment = (manifest.provision?.env || []).map((v: any) => {
        if (!v || typeof v.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(v.name) || /^(PATH|HOME|USERPROFILE|NODE_OPTIONS|LD_PRELOAD|DYLD_.*|ELECTRON_.*|PORTAL_.*)$/i.test(v.name)) throw new Error('Kit 声明了不支持的环境变量。');
        return { name: v.name, description: String(v.description || ''), required: v.required !== false };
      });
      let dependency: KitInstallPlan['dependency'] = 'none';
      if (await exists(path.join(source, 'package.json'))) dependency = 'npm';
      else if (await exists(path.join(source, 'requirements.txt'))) dependency = 'python';
      const plan: KitInstallPlan = { ticket: randomUUID(), name: kit.name, version: kit.version, description: kit.description, tools: kit.tools.length,
        command: kit.command, environment, dependency, sha256: createHash('sha256').update(data).digest('hex'),
        notes: manifest.provision?.install || manifest.provision?.post_install ? '作者还声明了自定义安装步骤；本客户端只自动处理 package.json / requirements.txt，未执行自定义命令。' : '' };
      this.pending.set(plan.ticket, { plan, root, directory: source, manifest, settings: { ...settings }, created: Date.now() });
      return plan;
    } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
  }
  async discard(ticket: string) { const item = this.pending.get(ticket); if (item) { this.pending.delete(ticket); await rm(item.root, { recursive: true, force: true }); } }
  async dispose() { for (const ticket of this.pending.keys()) await this.discard(ticket); }
  async install(input: KitInstallInput, settings: Settings) {
    const item = this.pending.get(input?.ticket); if (!item) throw new Error('安装准备已过期，请重新选择 Kit。');
    if (JSON.stringify(settings) !== JSON.stringify(item.settings)) throw new Error('Portal 配置已改变，请关闭此窗口并重新安装。');
    const supplied = input.environment || {};
    if (Object.keys(supplied).some(key => !item.plan.environment.some(e => e.name === key))) throw new Error('无效的 Kit 配置字段。');
    for (const field of item.plan.environment) {
      if (typeof supplied[field.name] !== 'string' || supplied[field.name].length > 8192 || supplied[field.name].includes('\0')) throw new Error(`无效的 ${field.name} 配置。`);
      if (field.required && !supplied[field.name].trim()) throw new Error(`请填写 ${field.name}。`);
    }
    const location = await kitLocation(settings); const target = path.join(location.directory, item.plan.name);
    if (await exists(target)) throw new Error('同名 Kit 已安装。');
    const baseEnv: NodeJS.ProcessEnv = { ...process.env, ...(settings.portalEnvironmentPath ? { PATH: settings.portalEnvironmentPath } : {}) };
    let original: string[] = item.manifest.command;
    if (item.plan.dependency === 'npm') {
      // npm's JS CLI avoids Windows .cmd shell quoting when npm is available beside Node.
      const args = [await exists(path.join(item.directory, 'package-lock.json')) ? 'ci' : 'install', '--no-audit', '--no-fund'];
      if (process.platform === 'win32') {
        const dirs = (baseEnv.PATH || baseEnv.Path || '').split(path.delimiter);
        let node = '', npm = '';
        for (const dir of dirs) {
          if (!node && await exists(path.join(dir, 'node.exe'))) node = path.join(dir, 'node.exe');
          const cli = path.join(dir, 'node_modules/npm/bin/npm-cli.js');
          if (!npm && await exists(cli)) npm = cli;
        }
        if (!node || !npm) throw new Error('未找到 Node.js / npm，请先安装 Node.js 并重新打开客户端。');
        await runInstallCommand(node, [npm, ...args], item.directory, baseEnv);
      } else await runInstallCommand('npm', args, item.directory, baseEnv);
    } else if (item.plan.dependency === 'python') {
      const python = process.platform === 'win32' ? 'python' : 'python3';
      await runInstallCommand(python, ['-m', 'venv', '.venv'], item.directory, baseEnv);
      const executable = path.join(item.directory, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
      await runInstallCommand(executable, ['-m', 'pip', 'install', '-r', 'requirements.txt'], item.directory, baseEnv);
      if (/^python[\d.]*$/.test(original[0])) original = [path.join('{{KIT_DIR}}', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'), ...original.slice(1)];
    }
    const resolve = (root: string) => original.map(v => v.replaceAll('{{KIT_DIR}}', root));
    const check = resolve(item.directory);
    if (check.some(v => /\{\{.*?\}\}/.test(v))) throw new Error('Kit 启动命令包含未配置占位符，请联系作者提供可迁移的版本。');
    if (!path.isAbsolute(check[0]) && await exists(path.join(item.directory, check[0]))) check[0] = path.join(item.directory, check[0]);
    const command = resolve(target);
    if (!path.isAbsolute(command[0]) && await exists(path.join(item.directory, command[0]))) command[0] = path.join(target, command[0]);
    const finalManifest = { ...item.manifest };
    finalManifest.command = command;
    // Portal owns Kit configuration and process lifecycle. Keep credentials in
    // its documented kit-local dotenv file instead of wrapping the command.
    await rm(path.join(item.directory, '.env'), { force: true });
    if (Object.values(supplied).some(Boolean)) await writeFile(path.join(item.directory, '.env'), dotenv(supplied), { mode: 0o600 });
    await writeFile(path.join(item.directory, 'manifest.json'), JSON.stringify(finalManifest, null, 2) + '\n');
    await writeFile(path.join(item.directory, '.beings-install.json'), JSON.stringify({ sha256: item.plan.sha256, installedAt: new Date().toISOString() }), { mode: 0o600 });
    await mkdir(location.directory, { recursive: true });
    await rename(item.directory, target); await this.discard(input.ticket);
    return { name: item.plan.name, tools: item.plan.tools, message: '已安装。Portal 将自动刷新清单，并在首次调用时启动 Kit。' };
  }
}
