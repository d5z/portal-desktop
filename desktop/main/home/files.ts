import { workspacePath } from '../../shared/being-files';
import { open, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { MAX_HOME_PREVIEW, HOME_PREVIEW_TOO_LARGE, type HomeFileEntry, type HomeFileList, type HomeFilePreview } from '../../shared/home';
import type { HomeClient } from './client';
import type { HomeService } from './service';

export { workspacePath } from '../../shared/being-files';
function listing(raw: HomeFileList, directory: string): HomeFileList {
  if (!raw || !Array.isArray(raw.entries)) throw new Error('无法读取文件列表，请刷新重试。');
  const seen = new Set<string>();
  return { entries: raw.entries.map((entry): HomeFileEntry => {
    const file = workspacePath(entry?.path);
    if (!entry || typeof entry.name !== 'string' || !entry.name || entry.name.includes('/') ||
        file !== (directory ? directory + '/' : '') + entry.name || seen.has(file) ||
        !['file', 'directory'].includes(entry.type) || !Number.isSafeInteger(entry.size) || entry.size < 0)
      throw new Error('文件列表格式不正确，请刷新重试。');
    seen.add(file);
    return { name: entry.name, path: file, type: entry.type, size: entry.size };
  }) };
}
const contentPath = (file: string) => '/v1/me/files/content?' + new URLSearchParams({ path: file });
interface FileDialogs {
  chooseDownload(name: string): Promise<string | undefined>;
}
/** Native-selected paths never come from renderer IPC or remote metadata. */
export class HomeFiles {
  private transferring = false;
  constructor(private client: HomeClient, private home: Pick<HomeService, 'fileAccess'>, private dialogs: FileDialogs) {}
  async list(value: unknown): Promise<HomeFileList> {
    const directory = workspacePath(value, true), check = await this.home.fileAccess();
    const result = await this.client.request<HomeFileList>('/v1/me/files' + (directory ? '?' + new URLSearchParams({ path: directory }) : ''));
    check(); return listing(result, directory);
  }
  async preview(value: unknown): Promise<HomeFilePreview> {
    const file = workspacePath(value), check = await this.home.fileAccess();
    const bytes = await this.client.request(contentPath(file), {}, async (response, progress) => {
      const reader = response.body?.getReader();
      if (!reader) throw new Error('文件内容不可用。');
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const part = await reader.read(); check(); if (part.done) break;
          progress();
          size += part.value.byteLength;
          if (size > MAX_HOME_PREVIEW) throw new Error(HOME_PREVIEW_TOO_LARGE);
          chunks.push(part.value);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      return new Uint8Array(Buffer.concat(chunks));
    });
    check(); return { name: file.split('/').pop()!, path: file, bytes };
  }
  private async transfer<T>(operation: () => Promise<T>) {
    if (this.transferring) throw new Error('请先完成当前文件传输。');
    this.transferring = true;
    try { return await operation(); } finally { this.transferring = false; }
  }
  download(value: unknown) {
    const file = workspacePath(value);
    return this.transfer(async () => {
      const check = await this.home.fileAccess();
      // A remote name is only a suggested basename, never a host path.
      const name = file.split('/').pop()!.replace(/[<>:"|?*]/g, '_');
      const selected = await this.dialogs.chooseDownload(name); check(); if (!selected) return false;
      const temporary = selected + '.' + randomUUID() + '.part';
      try {
        await this.client.request(contentPath(file), {}, async (response, progress) => {
          const reader = response.body?.getReader();
          if (!reader) throw new Error('文件内容不可用。');
          try {
            const target = await open(temporary, 'wx', 0o600);
            try {
              while (true) {
                const part = await reader.read(); check(); if (part.done) break;
                progress();
                await target.writeFile(part.value);
              }
            } finally { await target.close(); }
          } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        });
        check(); await rename(temporary, selected); return true;
      } finally { await rm(temporary, { force: true }); }
    });
  }
}
