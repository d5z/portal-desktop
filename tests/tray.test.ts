import { afterEach, expect, it, vi } from 'vitest';
const shellTheme = vi.hoisted(() => ({ light: 1 }));
vi.mock('node:child_process', () => ({ execFile: (_file: string, _args: string[], _options: unknown, done: Function) =>
  done(null, `SystemUsesLightTheme    REG_DWORD    0x${shellTheme.light}`) }));

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    app: Object.assign(new EventEmitter(), { getAppPath: () => '/client', quit: vi.fn() }),
    nativeTheme: Object.assign(new EventEmitter(), {
      shouldUseDarkColors: false, shouldUseDarkColorsForSystemIntegratedUI: false,
    }),
    nativeImage: { createFromPath: vi.fn(file => ({ file, setTemplateImage: vi.fn() })) },
    Menu: { buildFromTemplate: vi.fn(items => items) },
    Tray: class extends EventEmitter {
      constructor(public image: unknown) { super(); }
      setImage = vi.fn();
      setToolTip = vi.fn();
      setContextMenu = vi.fn();
      isDestroyed = vi.fn(() => false);
    },
  };
});
import { app, nativeImage, nativeTheme } from 'electron';
import { createApplicationTray } from '../desktop/main/app/tray';

afterEach(() => {
  app.emit('will-quit');
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it('follows the Windows taskbar theme even when the app theme is opposite', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
  Object.assign(nativeTheme, { shouldUseDarkColors: true, shouldUseDarkColorsForSystemIntegratedUI: false });
  const tray = createApplicationTray(vi.fn(), false);
  await vi.waitFor(() => expect(nativeImage.createFromPath).toHaveBeenLastCalledWith(expect.stringMatching(/tray-black\.png$/)));
  vi.mocked(tray.setImage).mockClear();
  shellTheme.light = 0;
  Object.assign(nativeTheme, { shouldUseDarkColors: false, shouldUseDarkColorsForSystemIntegratedUI: true });
  nativeTheme.emit('updated');
  await vi.waitFor(() => expect(nativeImage.createFromPath).toHaveBeenLastCalledWith(expect.stringMatching(/tray-white\.png$/)));
  expect(tray.setImage).toHaveBeenCalledOnce();
  app.emit('will-quit');
  nativeTheme.emit('updated');
  await Promise.resolve();
  expect(tray.setImage).toHaveBeenCalledOnce();
});

it('lets macOS color the template icon instead of imposing the app theme', () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
  createApplicationTray(vi.fn(), false);
  expect(nativeImage.createFromPath).toHaveBeenCalledWith(expect.stringMatching(/trayTemplate\.png$/));
  const icon = vi.mocked(nativeImage.createFromPath).mock.results[0].value;
  expect(icon.setTemplateImage).toHaveBeenCalledWith(true);
  nativeTheme.emit('updated');
  expect(nativeImage.createFromPath).toHaveBeenCalledOnce();
});

it('does not update a destroyed tray', () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
  const tray = createApplicationTray(vi.fn(), false);
  vi.mocked(tray.isDestroyed).mockReturnValue(true);
  nativeTheme.emit('updated');
  expect(tray.setImage).not.toHaveBeenCalled();
});
