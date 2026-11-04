import { IconButton } from '../../shared/components/icon-button';
import { formatBytes } from '../../shared/lib/format-bytes';
import { Icon } from '../../shared/icons/icon';
import { useEffect, useState } from 'react';
import type { HomeAPI } from '../../../shared/home';
import { useModel } from '../../shared/hooks/use-model';
import { HomeLibrary } from '../models/home-library';
import styles from './home-library.module.scss';
import { HomeFilePanel } from './home-file-panel';
export function BeingLibrary({ api, onConnect, active = true }: { api?: HomeAPI; onConnect: () => void; active?: boolean }) {
  if (!api?.files) return <p className="being-empty">当前客户端不支持云端资料库，请更新桌面客户端。</p>;
  return <Library api={api} active={active} onConnect={onConnect} />;
}
function Library({ api, onConnect, active }: { api: HomeAPI; onConnect: () => void; active: boolean }) {
  const [store] = useState(() => new HomeLibrary(api.files!));
  const model = useModel(store);
  const [query, setQuery] = useState('');
  // Portaled previews must close when their retained tab is no longer visible.
  useEffect(() => { if (!active) store.closePreview(); }, [active, store]);
  useEffect(() => {
    let active = true, received = false;
    let identity: string | undefined;
    const receive = (state: Awaited<ReturnType<HomeAPI['state']>>) => {
      if (!active) return;
      const next = JSON.stringify([state.authenticated, state.authenticating, state.username, state.binding]);
      if (identity === next) return;
      identity = next;
      store.reset(); setQuery(''); void store.load();
    };
    const stop = api.subscribe(state => { received = true; receive(state); });
    void api.state().then(state => { if (!received) receive(state); }).catch(() => { if (active && !received) void store.load(); });
    return () => { active = false; stop(); store.reset(); };
  }, [api, store]);
  const navigate = (path: string) => { setQuery(''); void model.load(path); };
  const search = query.trim().toLocaleLowerCase();
  const entries = search ? model.entries.filter(entry => entry.name.toLocaleLowerCase().includes(search)) : model.entries;
  const parts = model.path ? model.path.split('/') : [];
  return <div className={styles.library}>
    <div className={styles.heading}>
      <nav className={styles.breadcrumbs} aria-label="工作区路径">
        <button type="button" aria-label="工作区" aria-current={!parts.length ? 'location' : undefined} onClick={() => navigate('')}><Icon name="directory" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><span>工作区</span></button>
        {parts.map((part, index) => <span key={index}><span aria-hidden="true">/</span><button type="button" title={part} aria-current={index === parts.length - 1 ? 'location' : undefined} onClick={() => navigate(parts.slice(0, index + 1).join('/'))}>{part}</button></span>)}
      </nav>
      {model.loaded && entries.length > 0 && <span className={styles.count}>{entries.length} 项</span>}
      <IconButton className={styles.iconButton} label="刷新资料库" disabled={model.loading || model.busy} onClick={() => void model.load()}><Icon name="refresh-library" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></IconButton>
    </div>
    <label className={styles.searchField}>
      <Icon name="search-20" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <input className={styles.search} type="search" aria-label="搜索当前文件夹" placeholder="搜索文件" value={query} onChange={event => setQuery(event.target.value)} />
    </label>
    {model.error && <div className={styles.feedback} role="alert"><p>{model.error}</p><div><button type="button" disabled={model.loading || model.busy} onClick={() => void model.load()}>重试</button><button type="button" onClick={onConnect}>前往电脑栏</button></div></div>}
    <p className={styles.status} role="status" hidden={!model.busy && !model.loading && !model.notice}>{model.busy ? '正在保存文件…' : model.loading ? '正在读取工作区…' : model.notice || (model.loaded ? `${entries.length} 项${query ? '匹配结果' : ''}` : '')}</p>
    {model.loaded && !entries.length && <div className={styles.empty}><Icon name="directory" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><strong>{query ? '没有匹配的文件' : '这个文件夹还是空的'}</strong><p>{query ? '试试其他名称，或清除搜索。' : 'Being 生成的文件会出现在这里。'}</p>{query && <button type="button" onClick={() => setQuery('')}>清除搜索</button>}</div>}
    <ul className={styles.files} aria-label="工作区文件" aria-busy={model.loading}>{entries.map(entry => <li key={entry.path}>
      <button className={styles.file} type="button" title={entry.name} disabled={model.busy} onClick={() => entry.type === 'directory' ? navigate(entry.path) : void model.open(entry)}><Icon name={entry.type} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><span><strong>{entry.name}</strong><small>{entry.type === 'directory' ? '文件夹' : formatBytes(entry.size)}</small></span></button>
      {entry.type === 'file' && <button className={styles.iconButton} type="button" aria-label={`下载 ${entry.name}`} title="下载文件" disabled={model.busy} onClick={() => void model.download(entry.path)}><Icon name="download-wide" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></button>}
    </li>)}</ul>
    {active && <HomeFilePanel store={store} />}
  </div>;
}
