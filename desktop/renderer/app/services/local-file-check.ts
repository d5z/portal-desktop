import type { DesktopAPI } from '../../../shared/types';

export type LocalFileAvailability = boolean | null;

/** null means the bridge is not ready, not that the file is missing. */
export async function checkLocalFiles(api: Pick<DesktopAPI, 'checkLocalFiles' | 'previewLocalFile' | 'releaseLocalFilePreview'>, paths: string[]): Promise<LocalFileAvailability[]> {
  if (api.checkLocalFiles) {
    try {
      const result = await api.checkLocalFiles(paths);
      return paths.map((_, i) => typeof result[i] === 'boolean' ? result[i] : null);
    } catch { /* A refreshed renderer may still have an older main process. */ }
  }
  if (!api.previewLocalFile || !api.releaseLocalFilePreview) return paths.map(() => null);
  // Compatibility with clients that already support preview but not metadata
  // checks. Bound concurrency and release every temporary capability immediately.
  const result: LocalFileAvailability[] = [];
  for (let start = 0; start < paths.length; start += 4) {
    result.push(...await Promise.all(paths.slice(start, start + 4).map(async path => {
      try {
        const file = await api.previewLocalFile!(path);
        await api.releaseLocalFilePreview!(file.id);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        return /不存在|无法读取|不支持此文件格式|文件过大|无效的本地文件路径|不能预览文件夹|EACCES|ENOENT/.test(message) ? false : null;
      }
    })));
  }
  return result;
}
