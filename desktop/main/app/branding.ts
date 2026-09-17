import { app } from 'electron';
import path from 'node:path';

export function brandingPath(file: string) {
  return path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(),
    app.isPackaged ? 'branding' : 'resources/branding', file);
}

export function systemIcon(dark = true) {
  return brandingPath(process.platform === 'win32' ? dark ? 'logo-white.png' : 'logo.png'
    : process.platform === 'darwin' ? 'app-mac.png' : 'app.png');
}

export function notificationIcon(dark = true) {
  return process.platform === 'win32'
    ? brandingPath(`notification-${dark ? 'white' : 'black'}.png`)
    : systemIcon(dark);
}
