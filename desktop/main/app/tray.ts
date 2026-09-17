import { app, Menu, nativeImage, Tray } from 'electron';
import path from 'node:path';
import { watchSystemTheme } from './system-theme';

const CLIENT_NAME = 'Portal Desktop';

export function createApplicationTray(showWindow: () => void, isPackaged: boolean) {
  const branding = path.join(
    isPackaged ? process.resourcesPath : app.getAppPath(),
    isPackaged ? 'branding' : 'resources/branding',
  );
  const image = (dark = true) => {
    if (process.platform === 'darwin') {
      const icon = nativeImage.createFromPath(path.join(branding, 'trayTemplate.png'));
      icon.setTemplateImage(true);
      return icon;
    }
    return nativeImage.createFromPath(path.join(branding, `tray-${dark ? 'white' : 'black'}.png`));
  };
  const tray = new Tray(image());
  if (process.platform !== 'darwin') {
    const stopWatching = watchSystemTheme(dark => { if (!tray.isDestroyed()) tray.setImage(image(dark)); });
    app.once('will-quit', stopWatching);
  }
  tray.setToolTip(CLIENT_NAME);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主窗口', click: showWindow },
    { type: 'separator' },
    { label: '退出客户端', click: () => app.quit() },
  ]));
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
  return tray;
}

export function installApplicationMenu(showWindow: () => void, showUpdates: () => void) {
  const applicationMenu = Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: CLIENT_NAME, submenu: [
      { role: 'about' as const, label: `关于 ${CLIENT_NAME}` },
      { type: 'separator' as const }, { role: 'services' as const, label: '服务' },
      { type: 'separator' as const },
      { role: 'hide' as const, label: `隐藏 ${CLIENT_NAME}` },
      { role: 'hideOthers' as const, label: '隐藏其他应用' },
      { role: 'unhide' as const, label: '显示全部' },
      { type: 'separator' as const }, { role: 'quit' as const, label: `退出 ${CLIENT_NAME}` },
    ] }] : []),
    { label: '客户端', submenu: [{ label: '显示主窗口', click: showWindow }, { label: '退出客户端', click: () => app.quit() }] },
    { role: 'editMenu' }, { label: '视图', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' }, { label: '帮助', submenu: [{ label: '检查更新…', click: showUpdates }] },
  ]);
  // Windows keeps every command in the in-app options or tray. Removing the
  // native application menu avoids a second, visually unrelated top bar.
  Menu.setApplicationMenu(process.platform === 'win32' ? null : applicationMenu);
}
