import { useCallback, useEffect, useMemo, type ReactNode, type RefObject } from 'react';
import type { HomeAPI } from '../../../shared/home';
import { workspacePath } from '../../../shared/being-files';
import { HomeFileAction } from '../../shared/components/being-files';
import { HomeLibrary } from '../models/home-library';
import { HomeFilePanel } from './home-file-panel';

export function HomeFileViewer({ api, frame, scope, children }: {
  api?: HomeAPI; frame: RefObject<HTMLIFrameElement | null>; scope: string; children: ReactNode;
}) {
  const store = useMemo(() => new HomeLibrary(api?.files || {
    list: async () => { throw new Error('请更新客户端后访问 Home 文件。'); },
    preview: async () => { throw new Error('请更新客户端后访问 Home 文件。'); },
    download: async () => { throw new Error('请更新客户端后访问 Home 文件。'); },
  }), [api]);
  const open = useCallback((path: string) => {
    void store.open({ path, name: path.split('/').pop()!, type: 'file', size: 0 });
  }, [store]);
  useEffect(() => {
    store.reset();
    let identity: string | undefined, disposed = false, received = false;
    const receive = (state: Awaited<ReturnType<HomeAPI['state']>>) => {
      if (disposed) return;
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
          message?.type !== 'beings:home-file-preview' || message.revision !== new URL(target.src).searchParams.get('revision')) return;
      let path: string;
      try { path = workspacePath(message.path); } catch { return; }
      open(path);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [frame, open]);
  return <HomeFileAction.Provider value={open}>{children}<HomeFilePanel store={store} /></HomeFileAction.Provider>;
}
