import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { SettingsStore } from '../desktop/main/app/settings';
import { BackgroundPortal } from '../desktop/main/portal/background';

const fixture = vi.hoisted(() => ({ directory: '', startup: undefined as Promise<void> | undefined }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  const app = Object.assign(new EventEmitter(), {
    isPackaged: false, setName: vi.fn(), setAppUserModelId: vi.fn(), setAboutPanelOptions: vi.fn(), setPath: vi.fn(),
    getPath: (name: string) => { if (name === 'appData') throw new Error("Failed to get 'appData' path"); return fixture.directory; },
    getAppPath: () => fixture.directory, getVersion: () => '0.1.6',
    requestSingleInstanceLock: () => true, quit: vi.fn(),
    whenReady: () => ({ then: (ready: () => Promise<void>) => (fixture.startup = Promise.resolve().then(ready)) }),
  });
  return { app, clipboard: {}, Notification: { isSupported: () => true }, ipcMain: { handle: vi.fn() }, net: { fetch: vi.fn() },
    dialog: { showErrorBox: vi.fn(), showMessageBox: vi.fn() }, nativeTheme: new EventEmitter(), nativeImage: {}, shell: {},
    safeStorage: { isEncryptionAvailable: () => true },
    protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
    session: { defaultSession: { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() } },
  };
});
vi.mock('../desktop/main/app/tray', () => ({ installApplicationMenu: vi.fn(), createApplicationTray: () => ({ destroy: vi.fn() }) }));
vi.mock('../desktop/main/app/window', () => ({ createMainWindow: vi.fn() }));

it('defers repeated launch until initialization and opens one usable window even when background discovery fails', async () => {
  fixture.directory = await mkdtemp(path.join(os.tmpdir(), 'portal-window-startup-'));
  vi.stubEnv('PORTAL_DESKTOP_USER_DATA', fixture.directory);
  const { app, protocol, dialog, ipcMain } = await import('electron');
  const { createMainWindow } = await import('../desktop/main/app/window');
  let releaseSettings!: () => void;
  const settingsGate = new Promise<void>(resolve => { releaseSettings = resolve; });
  const load = vi.spyOn(SettingsStore.prototype, 'load').mockImplementation(() => settingsGate);
  const reuse = vi.spyOn(SettingsStore.prototype, 'reusePortalConfig');
  vi.spyOn(BackgroundPortal.prototype, 'discover').mockRejectedValueOnce(new Error('spawn powershell.exe ENOENT'));
  vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', undefined);
  vi.stubGlobal('PORTAL_DESKTOP_UPDATE_REPOSITORY', 'fixture/releases');
  const protocolReadyAtCreation: boolean[] = [];
  vi.mocked(createMainWindow).mockImplementation(options => {
    protocolReadyAtCreation.push(vi.mocked(protocol.handle).mock.calls.length > 0);
    const window = Object.assign(new EventEmitter(), {
      isDestroyed: () => false, isMinimized: () => false, show: vi.fn(), focus: vi.fn(), restore: vi.fn(),
      webContents: { isDestroyed: () => false, send: vi.fn() },
    });
    const browser = { close: vi.fn() };
    options.onBrowser(browser as never);
    return { window, browser } as never;
  });
  try {
    await import('../desktop/main/main');
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    // NSIS launch plus updater fallback, or a double click during credential IO.
    app.emit('second-instance', {}, ['portal-desktop.exe']);
    app.emit('activate');
    const earlyWindows = protocolReadyAtCreation.length;
    releaseSettings();
    await fixture.startup;
    expect(dialog.showErrorBox).not.toHaveBeenCalled();
    expect({ earlyWindows, protocolReadyAtCreation }).toEqual({ earlyWindows: 0, protocolReadyAtCreation: [true] });
    app.emit('second-instance', {}, ['portal-desktop.exe']);
    app.emit('activate');
    expect(createMainWindow).toHaveBeenCalledOnce();
    expect(reuse).toHaveBeenCalledWith([]);
    const window = vi.mocked(createMainWindow).mock.results[0].value.window;
    window.webContents.mainFrame = { url: 'beings://desktop/' };
    const request = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
    const handlers = new Map(vi.mocked(ipcMain.handle).mock.calls);
    if (process.platform === 'win32') expect(app.setAppUserModelId).toHaveBeenCalledWith('town.beings.portal-desktop.development');
    const notifications = await handlers.get('beings:notifications')!(request as never, { enabled: true, bonfire: true });
    expect(notifications.preferences).toMatchObject({ enabled: true, bonfire: true });
    expect(await handlers.get('beings:notification-target')!(request as never)).toBeNull();
    await expect(handlers.get('beings:notifications')!({ ...request, senderFrame: {} } as never, { enabled: false })).rejects.toThrow('Untrusted');
    const snapshot = await handlers.get('beings:snapshot')!(request as never);
    expect(snapshot.portal.message).toBe('Windows 命令环境不可用，请检查后重试。');
    expect(snapshot.notice).not.toContain('ENOENT');
    const detail = 'powershell.exe (1): Error: Config file not found: status\n#< CLIXML\n<Objs>runtime details</Objs>';
    vi.spyOn(SettingsStore.prototype, 'save').mockRejectedValueOnce(new Error(detail));
    await expect(handlers.get('beings:save')!(request as never, {})).rejects.toThrow('旧 Portal 版本不兼容，请停止旧实例后重试。');
    await vi.waitFor(async () => expect(await readFile(path.join(fixture.directory, 'logs/client-errors.log'), 'utf8')).toContain(detail));
  } finally {
    releaseSettings();
    await fixture.startup;
    app.emit('before-quit', { preventDefault() {} });
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalled());
    app.removeAllListeners(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
