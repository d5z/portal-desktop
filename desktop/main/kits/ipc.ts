import { dialog, shell, type BrowserWindow } from 'electron';
import { mkdir } from 'node:fs/promises';
import type { KitInstaller } from './install';
import { deleteLocalKit, importLocalKit, kitLocation, localKits, readKit } from './catalog';
import type { SettingsStore } from '../app/settings';
import type { HomeKitPreparation } from '../../shared/home';
import type { HomeConnectors } from '../home/connectors';
import type { KitInstallInput } from '../../shared/types';

type RegisterHandler = (channel: string, callback: (...args: any[]) => unknown) => void;

export interface KitsIpcOptions {
  handle: RegisterHandler;
  exclusive: <T>(operation: () => Promise<T>) => Promise<T>;
  window: () => BrowserWindow | null;
  store: SettingsStore;
  kitInstaller: KitInstaller;
  homeConnectors: HomeConnectors;
}

export function registerKitsIpc(options: KitsIpcOptions) {
  const { handle, exclusive, window, store, kitInstaller } = options;
  handle('beings:kits', () => localKits(store.settings));
  handle('beings:kit-delete', (name: string) => exclusive(async () => {
    const library = await localKits(store.settings);
    const kit = library.kits.find(item => item.name === name);
    if (!kit) return { deleted: false, name };
    await deleteLocalKit(store.settings, name);
    return { deleted: true, name };
  }));
  handle('beings:kit-prepare', (id: string) => exclusive(async () => {
    if (!store.connection) throw new Error('请先连接 Being，再安装本机 Kit。');
    return kitInstaller.prepare(id, store.settings);
  }));
  handle('beings:kit-prepare-home', (input: Omit<HomeKitPreparation, 'detail'>) => exclusive(async () => {
    if (!store.connection) throw new Error('请先连接 Being，再安装本机 Kit。');
    const detail = options.homeConnectors.localKitSource(input.releaseId);
    return kitInstaller.prepare(input.sourceId, store.settings, { ...input, detail });
  }));
  handle('beings:kit-install', (input: KitInstallInput) => exclusive(() => kitInstaller.install(input, store.settings)));
  handle('beings:kit-discard', (ticket: string) => exclusive(() => kitInstaller.discard(ticket)));
  handle('beings:kits-open', async () => {
    const { directory } = await kitLocation(store.settings); await mkdir(directory, { recursive: true });
    const error = await shell.openPath(directory); if (error) throw new Error(error);
  });
  handle('beings:kit-import', () => exclusive(async () => {
    const currentWindow = window();
    if (!currentWindow) return { installed: false };
    const choice = await dialog.showOpenDialog(currentWindow, { title: '选择包含 manifest.json 的 Kit 目录', properties: ['openDirectory'] });
    if (choice.canceled) return { installed: false };
    const kit = await readKit(choice.filePaths[0]);
    const { directory } = await kitLocation(store.settings);
    if (!kit.compatible) throw new Error('这个 Kit 不支持当前系统。');
    const review = await dialog.showMessageBox(currentWindow, { type: 'question', title: '导入 Kit',
      message: `将 ${kit.name} ${kit.version} 导入本机 Portal？`,
      detail: `${kit.description}\n\n${kit.tools.length} 个工具 · 启动命令：${kit.command.join(' ')}\n目标：${directory}\n\n导入会复制文件；依赖和密钥需要自行配置。Portal 会自动刷新清单。${kit.eager ? '此 Kit 会在 Portal 启动时预热。' : 'Being 调用工具时将以当前用户身份运行此 Kit。'}`,
      buttons: ['取消', '导入'], defaultId: 0, cancelId: 0 });
    if (review.response !== 1) return { installed: false };
    const installed = await importLocalKit(choice.filePaths[0], directory);
    return { installed: true, name: installed.name };
  }));
}
