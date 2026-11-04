import type { DesktopAPI } from '../../../shared/types';

const restartMessage = '定位文件接口尚未加载，请完全退出并重新启动客户端后再试。';

/** Empty string means the native reveal request was accepted. */
export async function revealLocalFile(api: Pick<DesktopAPI, 'revealLocalFile'>, path: string): Promise<string> {
  if (!api.revealLocalFile) return restartMessage;
  try {
    const result = await api.revealLocalFile(path);
    if (result === true || (result && typeof result === 'object' && result.ok)) return '';
    if (result && typeof result === 'object' && !result.ok) {
      if (result.reason === 'missing') return '文件已移动或删除，请刷新预览后重试。';
      if (result.reason === 'permission') return '没有权限访问此文件所在的位置，请检查系统文件访问权限。';
      if (result.reason === 'invalid-path') return '无法识别本地文件路径，请重新打开文件预览。';
    }
  } catch (error) {
    if (error instanceof Error && /No handler registered|No ipc handler/i.test(error.message)) return restartMessage;
  }
  return '系统未能打开所在文件夹，请重试。';
}
