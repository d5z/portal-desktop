import { useCallback, useEffect, useMemo, type ReactNode, type RefObject } from 'react';
import type { HomeAPI } from '../../../shared/home';
import { workspacePath } from '../../../shared/being-files';
import { HomeFileAction } from '../../shared/components/being-files';
import { HomeLibrary } from '../models/home-library';
import { homeRecentFiles } from '../models/home-recent-files';
import { HomeFilePanel } from './home-file-panel';

export function HomeFileViewer({ api, frame, scope, children, onNotice }: {
  api?: HomeAPI; frame: RefObject<HTMLIFrameElement | null>; scope: string; children: ReactNode; onNotice?: (message: string) => void;
}) {
  const store = useMemo(() => new HomeLibrary(api?.files || {
    list: async () => { throw new Error('请更新客户端后访问 Home 文件。'); },
    preview: async () => { throw new Error('请更新客户端后访问 Home 文件。'); },
    download: async () => { throw new Error('请更新客户端后访问 Home 文件。'); },
  }), [api]);
  const open = useCallback((path: string, action: 'preview' | 'download' = 'preview') => {
    if (action === 'download') {
      if (store.busy) return;
      void store.download(path).then(() => {
        const message = store.error || store.notice;
        if (message) onNotice?.(message);
      });
      return;
    }
    void store.open({ path, name: path.split('/').pop()!, type: 'file', size: 0 });
  }, [store, onNotice]);
  useEffect(() => {
    store.reset();
    let identity: string | undefined, disposed = false, received = false;
    const receive = (state: Awaited<ReturnType<HomeAPI['state']>>) => {
      if (disposed) return;
      homeRecentFiles.setIdentity(state);
      const next = JSON.stringify([state.authenticated, state.authenticating, state.username, state.binding]);
      if (identity !== undefined && identity !== next) store.reset();
      identity = next;
    };
    const stop = api?.subscribe(state => { received = true; receive(state); });
    void api?.state().then(state => { if (!received) receive(state); }).catch(() => {});
    return () => { disposed = true; stop?.(); store.reset(); };
  }, [api, store, scope]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const target = frame.current, message = event.data;
      if (!target?.getAttribute('src') || event.source !== target.contentWindow || event.origin !== 'beings://chat' ||
          !['beings:home-file-preview', 'beings:home-file-download'].includes(message?.type) || message.revision !== new URL(target.src).searchParams.get('revision')) return;
      let path: string;
      try { path = workspacePath(message.path); } catch { return; }
      open(path, message.type === 'beings:home-file-download' ? 'download' : 'preview');
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [frame, open]);
  return <HomeFileAction.Provider value={open}>{children}<HomeFilePanel store={store} /></HomeFileAction.Provider>;
}
