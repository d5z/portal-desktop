import { expect, it, vi } from 'vitest';
import { repairDevelopmentShortcut, updateNotificationShortcutIcon, windowsAppId } from '../desktop/main/app/windows-identity';
it('keeps installation/notification identity stable and separates development', () => {
  expect(windowsAppId(true)).toBe('town.beings.portal-desktop');
  expect(windowsAppId(false)).toBe('town.beings.portal-desktop.development');
});
it('updates only the current installation notification shortcut icon, preserving its identity', () => {
  const target = 'C:/Apps/Portal Desktop/portal-desktop.exe';
  const original = { target, appUserModelId: windowsAppId(true), icon: 'old.ico', iconIndex: 0 };
  const shell = { readShortcutLink: vi.fn(() => original), writeShortcutLink: vi.fn(() => true) };
  updateNotificationShortcutIcon('C:/user/AppData/Roaming', target, 'white.ico', shell);
  expect(shell.writeShortcutLink).toHaveBeenCalledWith(expect.stringMatching(/Portal Desktop\.lnk$/), 'update', { target, icon: 'white.ico', iconIndex: 0 });
  shell.writeShortcutLink.mockClear();
  shell.readShortcutLink.mockReturnValue({ ...original, target: 'C:/Other/portal-desktop.exe' });
  updateNotificationShortcutIcon('C:/user/AppData/Roaming', target, 'white.ico', shell);
  expect(shell.writeShortcutLink).not.toHaveBeenCalled();
});
it('only migrates the conflicting development shortcut and preserves target/other fields', () => {
  const original = { target: 'D:\\code\\Town-Client\\node_modules\\electron\\dist\\electron.exe', appUserModelId: windowsAppId(true) };
  const shell = { readShortcutLink: vi.fn(() => original), writeShortcutLink: vi.fn(() => true) };
  repairDevelopmentShortcut('C:/user/AppData/Roaming', shell);
  expect(shell.writeShortcutLink).toHaveBeenCalledWith(expect.stringMatching(/Electron\.lnk$/), 'update', { target: original.target, appUserModelId: windowsAppId(false) });
  shell.writeShortcutLink.mockClear();
  for (const shortcut of [{ ...original, appUserModelId: 'other-app' }, { ...original, target: 'C:\\Apps\\portal-desktop.exe' }]) {
    shell.readShortcutLink.mockReturnValue(shortcut);
    repairDevelopmentShortcut('C:/user/AppData/Roaming', shell);
  }
  expect(shell.writeShortcutLink).not.toHaveBeenCalled();
  shell.readShortcutLink.mockImplementation(() => { throw new Error('missing'); });
  expect(() => repairDevelopmentShortcut('C:/user/AppData/Roaming', shell)).not.toThrow();
});
