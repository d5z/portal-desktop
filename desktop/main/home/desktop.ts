import { dialog, shell, type BrowserWindow } from 'electron';
import type { RegisterHandler } from '../app/ipc';
import type { SecretStorage } from '../app/settings';
import { SettingsStore } from '../app/settings';
import { HomeClient } from './client';
import { HomeFiles } from './files';
import { registerHomeIpc } from './ipc';
import { HomeService } from './service';
import { HomeViewer } from './viewer';
import { HomeConnectors } from './connectors';
import type { ConnectorNetwork } from './network';
export async function createDesktopHome(options: {
  directory: string; assets: string; secretStorage: SecretStorage; store: SettingsStore;
  window(): BrowserWindow | null; handle: RegisterHandler; network: ConnectorNetwork;
}) {
  const { directory, secretStorage, store, window: getWindow, handle } = options;
  const homeClient = new HomeClient(directory, secretStorage, url => shell.openExternal(url));
  const homeViewer = new HomeViewer(getWindow, viewer => home?.update({ viewer }), options.assets);
  const home = new HomeService(homeClient, homeViewer, () => store.connection, state => {
    const window = getWindow();
    if (window && !window.isDestroyed()) window.webContents.send('beings:home-state', state);
  });
  try { await homeClient.load(); home.update(); }
  catch { home.update({ error: '无法读取 Home 登录信息，请重新连接。' }); }
  const homeFiles = new HomeFiles(homeClient, home, {
    chooseDownload: async name => {
      const window = getWindow();
      if (!window || window.isDestroyed()) throw new Error('客户端窗口已关闭。');
      const result = await dialog.showSaveDialog(window, { title: '保存云端文件', defaultPath: name });
      return result.canceled ? undefined : result.filePath;
    },
  });
  const connectors = new HomeConnectors(homeClient, url => shell.openExternal(url));
  registerHomeIpc(handle, home, homeViewer, homeFiles, connectors, options.network);
  return home;
}
