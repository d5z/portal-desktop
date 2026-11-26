import { homeConnectorResources } from '../../shared/services/home-connector-resources';
import { ConnectorResourceAction } from '../../shared/components/connector-workspace-file';
import { useCallback, useEffect, useMemo, useState, type ReactNode, type RefObject } from 'react';
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
  const resources = useMemo(() => api?.connectorResources ? homeConnectorResources(api.connectorResources) : undefined, [api?.connectorResources]);
  const [openerPort, setOpenerPort] = useState<MessagePort>();
  const open = useCallback((path: string, action: 'preview' | 'download' = 'preview', port?: MessagePort) => {
    if (action === 'download') {
      if (store.busy) return;
      void store.download(path).then(() => {
        const message = store.error || store.notice;
        if (message) onNotice?.(message);
      });
      return;
    }
    setOpenerPort(port);
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
          !['beings:home-file-preview', 'beings:home-file-download', 'beings:connector-resource'].includes(message?.type) || message.revision !== new URL(target.src).searchParams.get('revision')) return;
      if (message.type === 'beings:connector-resource') {
        const port = event.ports[0];
        if (!port || !resources || !Array.isArray(message.args)) return;
        if (message.operation === 'request' && (typeof message.args[1] !== 'string' || !message.args[1].startsWith('/v1/me/connector-imports/'))) { port.postMessage({ error: '不支持的工作区资源' }); port.close(); return; }
        const work = message.operation === 'context' ? resources.context()
          : message.operation === 'request' ? resources.request(message.args[0], message.args[1], message.args[2], message.args[3])
          : Promise.reject(new Error('不支持的工作区操作'));
        void work.then(value => {
          if (frame.current?.contentWindow !== event.source || new URL(frame.current.src).searchParams.get('revision') !== message.revision) return;
          port.postMessage({ value });
        }, error => port.postMessage({ error: error instanceof Error ? error.message : '工作区请求失败' })).finally(() => port.close());
        return;
      }
      let path: string;
      try { path = workspacePath(message.path); } catch { return; }
      open(path, message.type === 'beings:home-file-download' ? 'download' : 'preview', event.ports[0]);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [frame, open, resources]);
  return <ConnectorResourceAction.Provider value={resources}><HomeFileAction.Provider value={open}>{children}<HomeFilePanel store={store} openerPort={openerPort} /></HomeFileAction.Provider></ConnectorResourceAction.Provider>;
}
