import { app, clipboard, dialog, shell, type BrowserWindow } from 'electron';
import path from 'node:path';
import type { ClientBrowser } from '../browser/browser';
import { ApprovalDialogs } from '../chat/approval-dialogs';
import { AttachmentDownloads } from '../chat/downloads';
import { editChat } from './context-menu';
import type { RegisterHandler } from './ipc';
import { LocalApps } from './local-apps';
import { LocalFilePreviews } from './local-file-preview';
import type { Exclusive } from './mutations';
import { SettingsStore } from './settings';
import { clientStartup } from './startup';
export function registerShellIpc(options: {
  handle: RegisterHandler; exclusive: Exclusive; directory: string; store: SettingsStore;
  localFiles: LocalFilePreviews; attachmentDownloads: AttachmentDownloads; approvalDialogs: ApprovalDialogs;
  window(): BrowserWindow | null; browser(): ClientBrowser | undefined;
}) {
  const { handle, exclusive, directory, store, localFiles, attachmentDownloads, approvalDialogs,
    window: getWindow, browser: getBrowser } = options;
  handle('beings:local-file-preview', (reference: unknown) => localFiles.preview(reference));
  handle('beings:tool-approval-pending', () => approvalDialogs.current());
  handle('beings:tool-approval-answer', (id: unknown, allowed: unknown) => approvalDialogs.answer(id, allowed));
  handle('beings:local-files-check', (references: unknown) => localFiles.available(references));
  handle('beings:local-file-reveal', (reference: unknown) => localFiles.reveal(reference, file => shell.showItemInFolder(file)));
  handle('beings:local-file-release', (id: unknown) => localFiles.release(id));
  handle('beings:download-directory', (change: boolean) => attachmentDownloads.downloadDirectory(change === true));
  handle('beings:attachment-source', (filename: string) => attachmentDownloads.registerSource(filename));
  handle('beings:client-startup', (enabled?: boolean) => clientStartup(app, process.platform, process.execPath, enabled));
  const localApps = new LocalApps(path.join(directory, 'local-apps.json'));
  handle('beings:local-apps', () => localApps.list());
  handle('beings:associate-app', (entry: unknown) => exclusive(async () => {
    const selection = await dialog.showOpenDialog(getWindow()!, {
      title: '关联已安装的 App', properties: ['openFile'],
      ...(process.platform === 'win32' ? { filters: [{ name: '应用程序', extensions: ['exe'] }] } : {})
    });
    if (selection.canceled || !selection.filePaths[0]) return false;
    await localApps.associate(entry, selection.filePaths[0]); return true;
  }));
  handle('beings:unlink-app', (id: string) => exclusive(() => localApps.remove(id)));
  handle('beings:quit', () => { setImmediate(() => app.quit()); });
  handle('beings:browser-state', () => getBrowser()?.state);
  handle('beings:browser-open', (url?: string) => getBrowser()?.open(url));
  handle('beings:chat-edit', (command: import('../../shared/types').ChatEditCommand) => editChat(getWindow(), command));
  handle('beings:selection-edit', (command: import('../../shared/types').ChatEditCommand) => editChat(getWindow(), command, 'shell'));
  handle('beings:clipboard-copy', (text: string) => {
    if (typeof text !== 'string' || text.length > 200000) throw new Error('复制内容过长。');
    clipboard.writeText(text);
  });
  handle('beings:browser-action', (action: import('../../shared/types').BrowserAction) => getBrowser()?.action(action));
  handle('beings:browser-bounds', (bounds: import('../../shared/types').BrowserBounds) => getBrowser()?.setBounds(bounds));
  handle('beings:choose', async (kind: string) => {
    if (kind !== 'workspace') throw new Error('Invalid dialog');
    const result = await dialog.showOpenDialog(getWindow()!, { title: '选择 Being 工作目录', properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('beings:workspace', async () => {
    if (!store.connection) throw new Error('请先保存工作目录。');
    const error = await shell.openPath(store.settings.workspace); if (error) throw new Error(error);
  });
  handle('beings:open-loom', () => exclusive(async () => {
    if (!store.connection) throw new Error('请先配置 Being 链接，再打开原版 Loom。');
    getBrowser()?.open(store.connection.link);
  }));
}
