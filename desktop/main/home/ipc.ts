import type { HomeAction, HomeBounds } from '../../shared/home';
import type { HomeService } from './service';
import type { HomeViewer } from './viewer';
export function registerHomeIpc(handle: (channel: string, callback: (...args: any[]) => unknown) => void, home: HomeService, viewer: HomeViewer) {
  handle('beings:home-state', () => { home.contextChanged(); return home.state; });
  handle('beings:home-refresh', () => home.refresh());
  handle('beings:home-action', (action: HomeAction) => {
    if (!['login', 'cancel-login', 'initialize', 'bind', 'wake', 'stop', 'recreate', 'open', 'close', 'logout'].includes(action)) throw new Error('不支持的云电脑操作。');
    return home.action(action);
  });
  handle('beings:home-preview', () => { home.contextChanged(); return viewer.preview(); });
  handle('beings:home-bounds', (bounds: HomeBounds) => viewer.setBounds(bounds));
}
