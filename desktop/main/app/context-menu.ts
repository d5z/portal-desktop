import type { BrowserWindow } from 'electron';
import type { ChatEditCommand } from '../../shared/types';

export function editChat(window: BrowserWindow | null, command: ChatEditCommand) {
  if (!['cut', 'copy', 'paste'].includes(command) || !window || window.isDestroyed()) return false;
  const frame = window.webContents.focusedFrame;
  if (!frame || frame.detached) return false;
  const url = new URL(frame.url);
  if (url.protocol !== 'beings:' || url.hostname !== 'chat' || url.pathname !== '/') return false;
  // The styled menu restores focus and selection before requesting the edit.
  // Native editing targets the focused frame, without exposing clipboard contents to the shell.
  window.webContents[command]();
  return true;
}
