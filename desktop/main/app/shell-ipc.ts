import type { BrowserWindow } from 'electron';

export function sendToShell(window: BrowserWindow | null | undefined, channel: string, ...payload: unknown[]) {
  const contents = window?.webContents;
  if (!window || window.isDestroyed() || !contents || contents.isDestroyed()) return;
  try { contents.send(channel, ...payload); } catch { /* renderer or pipe already gone */ }
}
