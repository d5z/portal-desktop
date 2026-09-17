import path from 'node:path';
import type { ShortcutDetails } from 'electron';
import installer from '../../windows-installer.json';

export const windowsAppId = (packaged: boolean) => installer.appId + (packaged ? '' : '.development');

export function updateNotificationShortcutIcon(appData: string, executable: string, icon: string, shell: {
  readShortcutLink(file: string): ShortcutDetails;
  writeShortcutLink(file: string, operation: 'update', options: ShortcutDetails): boolean;
}) {
  const file = path.join(appData, 'Microsoft/Windows/Start Menu/Programs/Portal Desktop.lnk');
  let shortcut: ShortcutDetails;
  try { shortcut = shell.readShortcutLink(file); } catch { return; }
  if (shortcut.appUserModelId !== installer.appId || path.resolve(shortcut.target).toLowerCase() !== path.resolve(executable).toLowerCase()) return;
  if (shortcut.icon === icon && shortcut.iconIndex === 0) return;
  if (!shell.writeShortcutLink(file, 'update', { target: shortcut.target, icon, iconIndex: 0 }))
    throw new Error('未能更新通知来源图标。');
}

export function repairDevelopmentShortcut(appData: string, shell: {
  readShortcutLink(file: string): ShortcutDetails;
  writeShortcutLink(file: string, operation: 'update', options: ShortcutDetails): boolean;
}) {
  const file = path.join(appData, 'Microsoft/Windows/Start Menu/Programs/Electron.lnk');
  let shortcut: ShortcutDetails;
  try { shortcut = shell.readShortcutLink(file); } catch { return; }
  // Electron 44 creates this link when notifications are used during development.
  // Only repair our own conflicting link; preserve its target and all other data.
  if (shortcut.appUserModelId !== installer.appId || !/[\\/]node_modules[\\/]electron[\\/]dist[\\/]electron\.exe$/i.test(shortcut.target)) return;
  if (!shell.writeShortcutLink(file, 'update', { target: shortcut.target, appUserModelId: windowsAppId(false) }))
    throw new Error('未能修复开发版通知标识。');
}
