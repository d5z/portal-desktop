import { nativeResource } from './resources';

export function brandingPath(file: string) { return nativeResource('branding', file); }

export function systemIcon(dark = true) {
  return brandingPath(process.platform === 'win32' ? dark ? 'logo-white.png' : 'logo.png'
    : process.platform === 'darwin' ? 'app-mac.png' : 'app.png');
}

export function notificationIcon(dark = true) {
  return process.platform === 'win32'
    ? brandingPath(`notification-${dark ? 'white' : 'black'}.png`)
    : systemIcon(dark);
}
