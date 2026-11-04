import { app, safeStorage } from 'electron';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BackgroundPortal } from '../portal/background';
import { ClientErrorLog } from './error-log';
import { SettingsStore } from './settings';

export async function loadDesktopConfiguration(errorLog: ClientErrorLog) {
  const directory = app.getPath('userData');
  const binary = app.isPackaged
    ? path.join(process.resourcesPath, process.platform === 'win32' ? 'heart-portal.exe' : 'heart-portal')
    : path.resolve('resources', process.platform === 'win32' ? 'heart-portal.exe' : 'heart-portal');
  const secretStorage = {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
    encryptString: (value: string) => safeStorage.encryptString(value), decryptString: (value: Buffer) => safeStorage.decryptString(value),
  };
  const store = new SettingsStore(directory, secretStorage, binary);
  let startupNotice: string | undefined;
  try { await store.load(); }
  catch (error) { startupNotice = errorLog.report('settings-load', error, '连接配置读取失败，请检查密钥库或连接设置。'); }
  let configCandidates: string[] = [];
  const reusePreviousConfig = async () => {
    await store.reusePortalConfig(configCandidates);
    if (store.connection && store.settings.portalConfigPath) await store.save(store.settings);
  };
  try {
    const savedService = JSON.parse(await readFile(path.join(directory, 'portal-service.json'), 'utf8').catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'null';
      throw error;
    }));
    if (savedService && (savedService.existing || savedService.kind || savedService.label !== new BackgroundPortal(directory).label)) {
      configCandidates.push(savedService.configPath || path.join(savedService.root, 'portal.toml'));
    }
    // An explicitly selected profile is independent (including test profiles).
    // Its own saved service can still migrate, but it must not import the user's
    // global Being connection or workspace just because it is initially empty.
    if (!store.connection && !process.env.PORTAL_DESKTOP_USER_DATA) configCandidates.push(path.join(os.homedir(), '.heart-portal/portal.toml'), path.join(os.homedir(), '.heart-portal/runtime/portal.toml'));
    await reusePreviousConfig();
  } catch (error) { startupNotice = errorLog.report('portal-config-import', error, '已有 Portal 配置读取失败，请检查后重试。'); }
  return { directory, binary, secretStorage, store, startupNotice, reusePreviousConfig };
}
