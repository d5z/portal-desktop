import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ directory: '', packaged: false, startup: undefined as Promise<void> | undefined, windows: [] as unknown[] }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  const app = Object.assign(new EventEmitter(), {
    setName: vi.fn(), setAppUserModelId: vi.fn(), setAboutPanelOptions: vi.fn(), setPath: vi.fn(), setAsDefaultProtocolClient: vi.fn(),
    getPath: (name: string) => { if (name === 'appData') throw new Error("Failed to get 'appData' path"); return fixture.directory; },
    getAppPath: () => fixture.directory, getVersion: () => '0.1.6',
    requestSingleInstanceLock: () => true, quit: vi.fn(),
    whenReady: () => ({ then: (ready: () => Promise<void>) => (fixture.startup = Promise.resolve().then(ready)) }),
  });
  Object.defineProperty(app, 'isPackaged', { get: () => fixture.packaged });
  return { app, BrowserWindow: { getAllWindows: () => fixture.windows }, clipboard: {}, Notification: { isSupported: () => true }, ipcMain: { handle: vi.fn() }, net: { fetch: vi.fn() },
    dialog: { showErrorBox: vi.fn(), showMessageBox: vi.fn() }, nativeTheme: new EventEmitter(), nativeImage: {}, shell: { showItemInFolder: vi.fn() },
    safeStorage: { isEncryptionAvailable: () => true },
    protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
    session: { defaultSession: { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() } },
  };
});
vi.mock('../desktop/main/app/tray', () => ({ installApplicationMenu: vi.fn(), createApplicationTray: () => ({ destroy: vi.fn() }) }));
vi.mock('../desktop/main/app/window', () => ({ createMainWindow: vi.fn() }));
// Native taskbar workers are covered separately; this fixture has no real HWND.
vi.mock('../desktop/main/app/taskbar-icons', () => ({ installWindowsTaskbarIcons: vi.fn() }));

it.each(['normal', 'manual installer', 'downloaded update'] as const)('initializes one usable window and allows it to close during %s shutdown', async shutdown => {
  vi.resetModules();
  vi.clearAllMocks();
  fixture.windows = [];
  fixture.directory = await mkdtemp(path.join(os.tmpdir(), 'portal-window-startup-'));
  vi.stubEnv('PORTAL_DESKTOP_USER_DATA', fixture.directory);
  const { SettingsStore } = await import('../desktop/main/app/settings');
  const { BackgroundPortal } = await import('../desktop/main/portal/background');
  const { app, protocol, dialog, ipcMain, shell } = await import('electron');
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
      isDestroyed: () => false, isMinimized: () => false, isResizable: () => true, isFullScreen: () => false, isFullScreenable: () => true, setFullScreenable: vi.fn(),
      show: vi.fn(), focus: vi.fn(), restore: vi.fn(), setProgressBar: vi.fn(),
      webContents: Object.assign(new EventEmitter(), { isDestroyed: () => false, send: vi.fn() }),
    });
    const browser = { close: vi.fn() };
    fixture.windows = [window];
    options.onBrowser(browser as never);
    return { window, browser } as never;
  });
  try {
    await import('../desktop/main/main');
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    // NSIS launch plus updater fallback, or a double click during credential IO.
    app.emit('second-instance', {}, ['portal-desktop.exe']);
    app.emit('activate');
    const callback = { preventDefault: vi.fn() };
    app.emit('open-url', callback, 'being-app://connector/complete');
    expect(callback.preventDefault).toHaveBeenCalledOnce();
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
    expect(app.setAsDefaultProtocolClient).toHaveBeenCalledWith('being-app', process.execPath, [process.argv[1]]);
    window.show.mockClear();
    app.emit('open-url', { preventDefault() {} }, 'being-app://connector/complete?token=fixture');
    expect(window.show).not.toHaveBeenCalled();
    app.emit('open-url', { preventDefault() {} }, 'being-app://connector/complete');
    app.emit('second-instance', {}, ['portal-desktop.exe', 'being-app://connector/complete']);
    expect(window.show).toHaveBeenCalledTimes(2);
    expect(createMainWindow).toHaveBeenCalledOnce();
    window.webContents.mainFrame = { url: 'beings://desktop/' };
    const request = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
    const handlers = new Map(vi.mocked(ipcMain.handle).mock.calls);
    if (process.platform === 'win32') expect(app.setAppUserModelId).toHaveBeenCalledWith('town.beings.portal-desktop.development');
    const notifications = await handlers.get('beings:notifications')!(request as never, { enabled: true, bonfire: true });
    expect(notifications.preferences).toMatchObject({ enabled: true, bonfire: true });
    expect(await handlers.get('beings:notification-target')!(request as never)).toBeNull();
    await expect(handlers.get('beings:notifications')!({ ...request, senderFrame: {} } as never, { enabled: false })).rejects.toThrow('Untrusted');
    const snapshot = await handlers.get('beings:snapshot')!(request as never);
    const archives = await Promise.all([handlers.get('beings:collect-logs')!(request as never), handlers.get('beings:collect-logs')!(request as never)]);
    expect(archives[0]).toBe(archives[1]);
    expect(shell.showItemInFolder).toHaveBeenCalledExactlyOnceWith(archives[0]);
    expect((await readFile(archives[0])).subarray(0, 2).toString()).toBe('PK');
    expect(snapshot.portal.message).toBe('Windows 命令环境不可用，请检查后重试。');
    expect(snapshot.notice).not.toContain('ENOENT');
    const detail = 'powershell.exe (1): Error: Config file not found: status\n#< CLIXML\n<Objs>runtime details</Objs>';
    vi.spyOn(SettingsStore.prototype, 'save').mockRejectedValueOnce(new Error(detail));
    await expect(handlers.get('beings:save')!(request as never, {})).rejects.toThrow('旧 Portal 版本不兼容，请停止旧实例后重试。');
    await vi.waitFor(async () => expect(await readFile(path.join(fixture.directory, 'logs/client-errors.log'), 'utf8')).toContain(detail));

    // app.quit emits before-quit before asking windows to close. The real main
    // window hides and cancels that close unless this callback reports quitting.
    const closingStates: boolean[] = [];
    vi.mocked(app.quit).mockImplementation(() => {
      const event = { preventDefault: vi.fn() };
      app.emit('before-quit', event);
      if (!event.preventDefault.mock.calls.length) {
        closingStates.push(vi.mocked(createMainWindow).mock.calls[0][0].isQuitting());
      }
    });
    if (shutdown === 'downloaded update') {
      const installer = await import('../desktop/main/updates/manual-installer');
      const { UpdateChecker } = await import('../desktop/main/updates/checker');
      const handoff = Object.assign(vi.fn(async () => {}), { discard: vi.fn(async () => {}) });
      vi.spyOn(installer, 'stageInstaller').mockResolvedValue(handoff);
      vi.spyOn(UpdateChecker.prototype, 'check').mockImplementation(function (this: InstanceType<typeof UpdateChecker>) {
        this.state = { ...this.state, phase: 'available', latestVersion: '0.1.9' };
        return Promise.resolve(this.state);
      });
      fixture.packaged = true;
      await handlers.get('beings:download-update')!(request as never);
      await handlers.get('beings:install-update')!(request as never);
      expect(handoff).toHaveBeenCalledOnce();
    } else if (shutdown === 'manual installer') {
      app.emit('second-instance', {}, ['portal-desktop.exe', '--prepare-installer=0.1.9']);
    } else {
      app.quit();
    }
    await vi.waitFor(() => expect(closingStates).toHaveLength(1));
    expect(closingStates).toEqual([true]);
    if (shutdown !== 'normal') {
      expect(JSON.parse(await readFile(path.join(fixture.directory, 'client-install.json'), 'utf8'))).toMatchObject({ target: '0.1.9' });
    }
  } finally {
    fixture.packaged = false;
    releaseSettings();
    await fixture.startup;
    app.emit('before-quit', { preventDefault() {} });
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalled());
    app.removeAllListeners(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

it.each(['--prepare-installer=0.1.9', '--quit-for-update'])('exits a first-instance %s request without initializing the client', async argument => {
  vi.resetModules();
  fixture.directory = await mkdtemp(path.join(os.tmpdir(), 'portal-installer-control-'));
  fixture.startup = undefined;
  vi.stubEnv('PORTAL_DESKTOP_USER_DATA', fixture.directory);
  const argv = process.argv;
  process.argv = ['portal-desktop.exe', argument];
  try {
    const { app } = await import('electron');
    const { createMainWindow } = await import('../desktop/main/app/window');
    vi.mocked(app.quit).mockClear();
    vi.mocked(createMainWindow).mockClear();
    await import('../desktop/main/main');
    expect(app.quit).toHaveBeenCalledOnce();
    expect(fixture.startup).toBeUndefined();
    expect(createMainWindow).not.toHaveBeenCalled();
    expect(app.listenerCount('second-instance')).toBe(0);
  } finally {
    process.argv = argv;
    vi.unstubAllEnvs();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
