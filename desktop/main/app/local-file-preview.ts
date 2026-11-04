import { access, open, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { htmlPreviewPolicy, previewLinkScript } from './html-preview';
import { localFileReference, type LocalFilePreview, type LocalFileRevealResult } from '../../shared/local-file';

const textTypes = new Set(['html', 'htm', 'txt', 'md', 'markdown', 'csv', 'json', 'js', 'jsx', 'ts', 'tsx', 'css', 'py', 'yaml', 'yml', 'xml', 'log', 'sh', 'sql']);
const binaryTypes: Record<string, string> = {
  pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
};
const resourceTypes: Record<string, string> = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf',
};
async function readBounded(file: string, limit: number) {
  const handle = await open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('请选择文件，不能预览文件夹。');
    if (stat.size > limit) throw new Error(`文件过大，预览上限为 ${limit / 1024 / 1024} MB。`);
    const bytes = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, null);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > stat.size) throw new Error('文件正在写入，请稍后刷新预览。');
    return bytes.subarray(0, offset);
  } finally { await handle.close(); }
}

/** Only the trusted shell creates/revokes capabilities. HTML receives no filesystem or IPC access. */
export class LocalFilePreviews {
  private roots = new Map<string, string>();
  constructor(private workspace: () => string) {}
  release(id: unknown) { if (typeof id === 'string') this.roots.delete(id); }

  private async resolveFile(reference: unknown) {
    const input = localFileReference(reference);
    if (!input) throw Object.assign(new Error('无效的本地文件路径。'), { code: 'INVALID_PATH' });
    const expanded = input.startsWith('~/') ? path.join(os.homedir(), input.slice(2)) : input;
    if (!path.isAbsolute(expanded) && !this.workspace()) throw Object.assign(new Error('请先在客户端设置中选择工作目录，或使用文件的绝对路径。'), { code: 'INVALID_PATH' });
    let file: string;
    try { file = await realpath(path.resolve(this.workspace(), expanded)); }
    catch (error) { throw Object.assign(new Error('本地文件不存在或无法读取，请确认文件已保存在这台电脑上。'), { code: (error as NodeJS.ErrnoException).code }); }
    const info = await stat(file);
    if (!info.isFile()) throw Object.assign(new Error('请选择文件，不能预览文件夹。'), { code: 'INVALID_PATH' });
    return { file, info };
  }

  async reveal(reference: unknown, showItem: (file: string) => void): Promise<LocalFileRevealResult> {
    let file: string;
    try { ({ file } = await this.resolveFile(reference)); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return { ok: false, reason: 'missing' };
      if (code === 'EACCES' || code === 'EPERM') return { ok: false, reason: 'permission' };
      if (code === 'INVALID_PATH') return { ok: false, reason: 'invalid-path' };
      throw error;
    }
    // Revealing a file does not read it and is independent of preview type/size limits.
    showItem(file);
    return { ok: true };
  }

  async resolvePreviewFile(reference: unknown): Promise<{ file: string; extension: string }> {
    const { file, info } = await this.resolveFile(reference);
    const extension = path.extname(file).slice(1).toLowerCase();
    if (!textTypes.has(extension) && !binaryTypes[extension]) throw new Error('暂不支持此文件格式的客户端预览。');
    if (info.size > (textTypes.has(extension) ? 2 : 128) * 1024 * 1024) throw new Error('文件过大，超过预览大小限制。');
    await access(file, constants.R_OK);
    return { file, extension };
  }

  async available(references: unknown): Promise<boolean[]> {
    if (!Array.isArray(references) || references.length > 64) throw new Error('无效的文件检查请求。');
    // Only metadata is read: checking links does not read or execute file contents.
    return Promise.all(references.map(reference => this.resolvePreviewFile(reference).then(() => true, () => false)));
  }

  async preview(reference: unknown): Promise<LocalFilePreview> {
    const { file, extension } = await this.resolvePreviewFile(reference);
    const bytes = await readBounded(file, (textTypes.has(extension) ? 2 : 128) * 1024 * 1024);
    const result: LocalFilePreview = { id: randomUUID(), path: file, name: path.basename(file), extension };
    if (textTypes.has(extension)) result.text = bytes.toString('utf8');
    else { result.bytes = new Uint8Array(bytes); result.mime = binaryTypes[extension]; }
    if (['html', 'htm'].includes(extension)) {
      // A bounded capability exposes only preview assets inside this document's directory.
      if (this.roots.size >= 32) this.roots.delete(this.roots.keys().next().value!);
      this.roots.set(result.id, path.dirname(file));
      result.url = `beings://preview/${result.id}/${encodeURIComponent(path.basename(file))}`;
    }
    return result;
  }

  async resource(request: Request): Promise<Response> {
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    try {
      const url = new URL(request.url);
      const [, id, ...segments] = url.pathname.split('/');
      const root = this.roots.get(id);
      if (!root) return new Response('Preview closed', { status: 404 });
      const relative = decodeURIComponent(segments.join('/'));
      if (relative.includes('\\') || relative.includes('\0')) return new Response('Forbidden', { status: 403 });
      const file = await realpath(path.resolve(root, relative));
      if (!file.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
      const type = resourceTypes[path.extname(file).slice(1).toLowerCase()];
      if (!type) return new Response('Unsupported resource', { status: 403 });
      const scope = `beings://preview/${id}/`;
      const bytes = await readBounded(file, 20 * 1024 * 1024);
      return new Response(type === 'text/html' ? '<!doctype html><meta charset="utf-8">' + previewLinkScript + bytes.toString('utf8') : new Uint8Array(bytes), { headers: {
        'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': htmlPreviewPolicy(scope),
      } });
    } catch { return new Response('File unavailable', { status: 404 }); }
  }
}
