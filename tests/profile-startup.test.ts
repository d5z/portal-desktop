import { expect, it, vi } from 'vitest';
import { ClientErrorLog } from '../desktop/main/app/error-log';
import { publicErrorMessage } from '../desktop/shared/errors';

const fixture = vi.hoisted(() => ({ startup: undefined as Promise<void> | undefined }));
vi.mock('electron', () => ({
  app: {
    setName: vi.fn(), setAppUserModelId: vi.fn(), setAboutPanelOptions: vi.fn(), setPath: vi.fn(), quit: vi.fn(),
    getPath: () => { throw new Error("Failed to get 'appData' path"); },
    whenReady: () => ({ then: (ready: () => Promise<void>) => (fixture.startup = Promise.resolve().then(ready)) }),
    requestSingleInstanceLock: vi.fn(),
  },
  protocol: { registerSchemesAsPrivileged: vi.fn() }, dialog: { showErrorBox: vi.fn() },
}));

it('logs a failed system profile lookup and exits with a short dialog instead of an uncaught main-process exception', async () => {
  vi.stubEnv('PORTAL_DESKTOP_USER_DATA', undefined);
  const report = vi.spyOn(ClientErrorLog.prototype, 'report').mockImplementation((_context, error, fallback) => publicErrorMessage(error, fallback));
  try {
    const { app, dialog } = await import('electron');
    await expect(import('../desktop/main/main')).resolves.toBeDefined();
    await fixture.startup;
    expect(report).toHaveBeenCalledWith('profile-initialization', expect.objectContaining({ message: "Failed to get 'appData' path" }), expect.any(String));
    expect(dialog.showErrorBox).toHaveBeenCalledWith('Portal Desktop Dev 启动失败', '客户端配置目录不可用，请检查系统用户目录后重试。');
    expect(app.requestSingleInstanceLock).not.toHaveBeenCalled();
    expect(app.quit).toHaveBeenCalledOnce();
  } finally { vi.restoreAllMocks(); vi.unstubAllEnvs(); }
});
