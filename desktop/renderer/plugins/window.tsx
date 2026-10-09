import { useEffect, useState } from 'react';
import type { PluginWindowAPI, PluginWindowInfo } from '../../shared/plugins';
import { PluginFrame } from './page';
import { errorText } from '../shared/models/store';

export function PluginWindow({ api }: { api: PluginWindowAPI }) {
  const [info, setInfo] = useState<PluginWindowInfo>();
  const [error, setError] = useState('');
  const [returning, setReturning] = useState(false);
  const [host] = useState(() => ({
    prepareSession: async () => {},
    compose: (value: { text: string; sceneId: string }) => api.action('compose', value),
    showCommands: () => { void api.action('commands').catch(e => setError(errorText(e))); },
    applyUI: (method: string, value: unknown) => { void api.action('ui', { method, value }).catch(e => setError(errorText(e))); },
  }));
  useEffect(() => {
    let active = true;
    void api.info().then(value => { if (active) setInfo(value); }).catch(e => { if (active) setError(errorText(e)); });
    const stop = api.onTheme(theme => setInfo(value => value ? { ...value, theme } : value));
    return () => { active = false; stop(); };
  }, [api]);
  useEffect(() => {
    if (info) { document.documentElement.dataset.theme = info.theme; document.documentElement.dataset.platform = info.platform; }
  }, [info]);
  return <main className="plugin-window-shell">
    <header className="topbar plugin-window-topbar"><strong>{info?.title || '客户端插件'}</strong><span>Portal Desktop</span>
      <button className="secondary" disabled={returning} onClick={() => {
        setReturning(true); void api.action('dock').catch(e => { setError(errorText(e)); setReturning(false); });
      }}>回到主窗口</button>
    </header>
    {error && <p role="alert">{error}</p>}
    {info && <PluginFrame api={api} model={host} id={info.id} view={info.view} command={info.command} theme={info.theme} title={info.title} />}
  </main>;
}
