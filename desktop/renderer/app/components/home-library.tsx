import { IconButton } from '../../shared/components/icon-button';
import { formatBytes } from '../../shared/lib/format-bytes';
import { Icon } from '../../shared/icons/icon';
import { useContext, useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import type { HomeAPI } from '../../../shared/home';
import { useModel } from '../../shared/hooks/use-model';
import { FileTypeIcon } from '../../shared/components/file-type-icon';
import { LocalFileAction } from '../../shared/components/local-file-link';
import { homeRecentFiles, type RecentFile } from '../models/home-recent-files';
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
  const recent = useModel(homeRecentFiles);
  const openLocal = useContext(LocalFileAction);
  const [tab, setTab] = useState<'recent' | 'workspace'>('recent');
  const tabId = useId();
  const [tip, setTip] = useState<{ path: string; source: RecentFile['source']; left: number; top: number; width: number; above: boolean } | null>(null);
  const hovered = recent.entries.find(entry => entry.path === tip?.path && entry.source === tip?.source);
  const showTip = (element: HTMLButtonElement, entry: RecentFile) => {
    const bounds = element.parentElement!.getBoundingClientRect();
    const width = Math.min(320, bounds.width, innerWidth - 24);
    const above = bounds.top > 150;
    setTip({ path: entry.path, source: entry.source, width, left: Math.max(12, Math.min(bounds.left, innerWidth - width - 12)), top: above ? bounds.top - 8 : bounds.bottom + 8, above });
  };
  useEffect(() => {
    if (!tip) return;
    const close = () => setTip(null);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); window.removeEventListener('keydown', escape); };
  }, [tip]);
  const [query, setQuery] = useState('');
  // Portaled previews must close when their retained tab is no longer visible.
  useEffect(() => { if (!active) store.closePreview(); }, [active, store]);
  useEffect(() => {
    let active = true, received = false;
    let identity: string | undefined;
    const receive = (state: Awaited<ReturnType<HomeAPI['state']>>) => {
      if (!active) return;
      homeRecentFiles.setIdentity(state);
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
    <div className={styles.toolbar}>
    <div className={styles.tabs} role="tablist" aria-label="资料库内容" onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 'recent' : event.key === 'End' ? 'workspace' : tab === 'recent' ? 'workspace' : 'recent';
      setTab(next);
      event.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
    }}>
      <button type="button" role="tab" id={`${tabId}-recent-tab`} data-tab="recent" aria-selected={tab === 'recent'} aria-controls={`${tabId}-recent`} tabIndex={tab === 'recent' ? 0 : -1} onClick={() => setTab('recent')}>最近</button>
      <button type="button" role="tab" id={`${tabId}-workspace-tab`} data-tab="workspace" aria-selected={tab === 'workspace'} aria-controls={`${tabId}-workspace`} tabIndex={tab === 'workspace' ? 0 : -1} onClick={() => setTab('workspace')}>工作区</button>
    </div>
    {tab === 'workspace' && <>
      {model.loaded && entries.length > 0 && <span className={styles.count}>{entries.length} 项</span>}
      <IconButton className={styles.iconButton} label="刷新资料库" disabled={model.loading || model.busy} onClick={() => void model.load()}><Icon name="refresh-library" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></IconButton>
    </>}
    </div>
    <section role="tabpanel" id={`${tabId}-recent`} aria-labelledby={`${tabId}-recent-tab`} hidden={tab !== 'recent'}>
      {!recent.entries.length && <p className={styles.recentEmpty}>打开本机或云电脑中的文件后，会显示在这里。</p>}
      <ul className={styles.recentFiles} aria-label="最近的文件">{recent.entries.map(entry => <li key={`${entry.source}:${entry.path}`} onMouseLeave={() => setTip(null)}>
        <button className={styles.recentFile} type="button" disabled={entry.source === 'local' ? !openLocal : model.busy}
          aria-describedby={hovered === entry ? `${tabId}-file-tip` : undefined}
          onMouseEnter={event => showTip(event.currentTarget, entry)} onFocus={event => showTip(event.currentTarget, entry)} onBlur={() => setTip(null)}
          onClick={() => { setTip(null); if (entry.source === 'local') openLocal?.(entry.path); else void model.open(entry); }}>
          <FileTypeIcon path={entry.path} className={styles.fileTypeIcon} /><span className={styles.recentName}>{entry.name}</span><span className={styles.fileSource}>{entry.source === 'local' ? '本机' : '云电脑'}</span>
        </button>
        <IconButton className={styles.iconButton} label={`从最近记录移除：${entry.name}`} title="移除最近" onMouseEnter={() => setTip(null)} onFocus={() => setTip(null)} onClick={() => { setTip(null); recent.remove(entry.path, entry.source); }}><Icon name="trash" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></IconButton>
      </li>)}</ul>
    </section>
    <section role="tabpanel" id={`${tabId}-workspace`} aria-labelledby={`${tabId}-workspace-tab`} hidden={tab !== 'workspace'}>
    {parts.length > 0 && <div className={styles.heading}>
      <nav className={styles.breadcrumbs} aria-label="工作区路径">
        <button type="button" aria-label="工作区" aria-current={!parts.length ? 'location' : undefined} onClick={() => navigate('')}><Icon name="directory" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><span>工作区</span></button>
        {parts.map((part, index) => <span key={index}><span aria-hidden="true">/</span><button type="button" title={part} aria-current={index === parts.length - 1 ? 'location' : undefined} onClick={() => navigate(parts.slice(0, index + 1).join('/'))}>{part}</button></span>)}
      </nav>
    </div>}
    <label className={styles.searchField}>
      <Icon name="search-20" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <input className={styles.search} type="search" aria-label="搜索当前文件夹" placeholder="搜索文件" value={query} onChange={event => setQuery(event.target.value)} />
    </label>
    {model.error && <div className={styles.feedback} role="alert"><p>{model.error}</p><div><button type="button" disabled={model.loading || model.busy} onClick={() => void model.load()}>重试</button><button type="button" onClick={onConnect}>前往电脑栏</button></div></div>}
    <p className={styles.status} role="status" hidden={!model.busy && !model.loading && !model.notice}>{model.busy ? '正在保存文件…' : model.loading ? '正在读取工作区…' : model.notice || (model.loaded ? `${entries.length} 项${query ? '匹配结果' : ''}` : '')}</p>
    {model.loaded && !entries.length && <div className={styles.empty}><Icon name="directory" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><strong>{query ? '没有匹配的文件' : '这个文件夹还是空的'}</strong><p>{query ? '试试其他名称，或清除搜索。' : 'Being 生成的文件会出现在这里。'}</p>{query && <button type="button" onClick={() => setQuery('')}>清除搜索</button>}</div>}
    <ul className={styles.files} aria-label="工作区文件" aria-busy={model.loading}>{entries.map(entry => <li key={entry.path}>
      <button className={styles.file} type="button" title={entry.name} disabled={model.busy} onClick={() => entry.type === 'directory' ? navigate(entry.path) : void model.open(entry)}>{entry.type === 'directory' ? <Icon name="directory" className={styles.folderIcon} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /> : <FileTypeIcon path={entry.path} className={styles.fileTypeIcon} />}<span className={styles.fileName}>{entry.name}</span>{entry.type === 'directory' ? <Icon className={styles.folderArrow} name="chevron-right-20" fill="none" stroke="currentColor" strokeWidth="1.5" /> : <small>{formatBytes(entry.size)}</small>}</button>
      {entry.type === 'file' && <button className={styles.iconButton} type="button" aria-label={`下载 ${entry.name}`} title="下载文件" disabled={model.busy} onClick={() => void model.download(entry.path)}><Icon name="download-wide" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></button>}
    </li>)}</ul>
    </section>
    {active && tab === 'recent' && tip && hovered && createPortal(<div id={`${tabId}-file-tip`} role="tooltip" className={styles.fileTooltip}
      style={{ left: tip.left, top: tip.top, width: tip.width, transform: tip.above ? 'translateY(-100%)' : undefined }}>
      <span className={styles.tipType}>{hovered.source === 'local' ? '本机文件' : '云电脑文件'}</span>
      <strong>{hovered.name}</strong>
      <span className={styles.tipTime}>最近打开 · <time dateTime={new Date(hovered.openedAt).toISOString()}>{new Date(hovered.openedAt).toLocaleString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}</time></span>
    </div>, document.body)}
    {active && <HomeFilePanel store={store} />}
  </div>;
}
