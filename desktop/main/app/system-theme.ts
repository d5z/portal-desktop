import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { nativeTheme } from 'electron';
import { windowsRoot } from '../portal/windows';

const changes = new EventEmitter();
export const refreshSystemTheme = () => { changes.emit('changed'); };

export async function systemUsesDarkColors(): Promise<boolean> {
  if (process.platform !== 'win32') return nativeTheme.shouldUseDarkColors;
  // Electron 44's system-integrated theme value can still follow the app theme.
  // Read the Windows shell setting directly without changing themeSource.
  return new Promise(resolve => {
    execFile(path.win32.join(windowsRoot(), 'System32', 'reg.exe'), [
      'query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize',
      '/v', 'SystemUsesLightTheme',
    ], { encoding: 'utf8', windowsHide: true, timeout: 1500 }, (error, stdout) => {
      const value = !error && /SystemUsesLightTheme\s+REG_DWORD\s+0x([01])\b/i.exec(stdout);
      resolve(value ? value[1] === '0' : nativeTheme.shouldUseDarkColorsForSystemIntegratedUI);
    });
  });
}

export function watchSystemTheme(apply: (dark: boolean) => void) {
  let revision = 0;
  const update = async () => {
    const current = ++revision;
    const dark = await systemUsesDarkColors();
    if (current === revision) apply(dark);
  };
  nativeTheme.on('updated', update);
  changes.on('changed', update);
  void update();
  return () => {
    ++revision;
    nativeTheme.removeListener('updated', update);
    changes.removeListener('changed', update);
  };
}
