import { nativeTheme, type BrowserWindow } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RegisterHandler } from './ipc';
import type { Exclusive } from './mutations';
export async function loadAppearance(directory: string, getWindow: () => BrowserWindow | null) {
  let appearance: 'light' | 'dark' = 'light';
  try { const saved = JSON.parse(await readFile(path.join(directory, 'appearance.json'), 'utf8')); if (saved.theme === 'dark') appearance = 'dark'; } catch { /* First launch uses the light workspace. */ }
  nativeTheme.themeSource = appearance;
  return {
    get current() { return appearance; },
    registerIpc(handle: RegisterHandler, exclusive: Exclusive, changed: (theme: 'light' | 'dark') => void) {
      handle('beings:appearance', (theme?: 'light' | 'dark') => exclusive(async () => {
        if (theme === undefined) return appearance;
        if (theme !== 'light' && theme !== 'dark') throw new Error('无效的配色。');
        await mkdir(directory, { recursive: true });
        const file = path.join(directory, 'appearance.json');
        await writeFile(file + '.tmp', JSON.stringify({ theme })); await rename(file + '.tmp', file);
        nativeTheme.themeSource = theme; appearance = theme; changed(theme);
        if (!(process.platform === 'win32' && Number(os.release().split('.')[2]) >= 22621)) getWindow()?.setBackgroundColor(theme === 'dark' ? '#212121' : '#ffffff');
        return appearance;
      }));
    },
  };
}
