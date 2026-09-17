import { afterEach, expect, it, vi } from 'vitest';
const shellTheme = vi.hoisted(() => ({ light: 0 }));
vi.mock('node:child_process', () => ({ execFile: (_file: string, _args: string[], _options: unknown, done: Function) =>
  done(null, `SystemUsesLightTheme    REG_DWORD    0x${shellTheme.light}`) }));

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    app: { isPackaged: false, getAppPath: () => '/client' },
    nativeTheme: Object.assign(new EventEmitter(), {
      shouldUseDarkColors: false, shouldUseDarkColorsForSystemIntegratedUI: false,
    }),
    BrowserWindow: class extends EventEmitter {
      constructor(public options: unknown) { super(); }
      webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn() });
      setMenuBarVisibility = vi.fn();
      setAppDetails = vi.fn();
      setIcon = vi.fn();
      hookWindowMessage = vi.fn();
      isDestroyed = () => false;
      loadURL = vi.fn();
    },
  };
});
vi.mock('../desktop/main/browser/browser', () => ({ ClientBrowser: class {} }));
import { nativeTheme } from 'electron';
import { createMainWindow } from '../desktop/main/app/window';
import { watchSystemTheme } from '../desktop/main/app/system-theme';

afterEach(() => { nativeTheme.removeAllListeners(); vi.restoreAllMocks(); });

it('keeps the caption black while shell theme listeners follow Windows independently', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
  const { window } = createMainWindow({
    shellURL: () => 'beings://desktop/', isQuitting: () => false, isSessionEnding: () => false,
    markSessionEnding: vi.fn(), openExternal: vi.fn(), onBrowser: vi.fn(), onClosed: vi.fn(),
  });
  expect((window as unknown as { options: { icon: string } }).options.icon).toMatch(/logo\.png$/);
  expect(window.setAppDetails).not.toHaveBeenCalled();
  const shellIcon = vi.fn();
  const stopWatching = watchSystemTheme(shellIcon);
  await vi.waitFor(() => expect(shellIcon).toHaveBeenLastCalledWith(true));
  shellTheme.light = 1;
  Object.assign(nativeTheme, { shouldUseDarkColors: true, shouldUseDarkColorsForSystemIntegratedUI: false });
  nativeTheme.emit('updated');
  await vi.waitFor(() => expect(shellIcon).toHaveBeenLastCalledWith(false));
  shellTheme.light = 0;
  const settingChange = vi.mocked(window.hookWindowMessage).mock.calls[0];
  expect(settingChange[0]).toBe(0x001a);
  settingChange[1](Buffer.alloc(0), Buffer.alloc(0));
  await vi.waitFor(() => expect(shellIcon).toHaveBeenLastCalledWith(true));
  stopWatching();
  window.emit('closed');
  nativeTheme.emit('updated');
  await Promise.resolve();
  expect(window.setIcon).not.toHaveBeenCalled();
});
