import { homeConnectorResources } from '../../shared/services/home-connector-resources';
import { ConnectorResourceAction } from '../../shared/components/connector-workspace-file';
import { ConnectorWorkspaceImports } from '../../shared/components/connector-workspace-imports';
import { IconButton } from '../../shared/components/icon-button';
import { formatBytes } from '../../shared/lib/format-bytes';
import { Icon, type IconName } from '../../shared/icons/icon';
import { useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { HomeAPI } from '../../../shared/home';
import { DropdownMenuMotion } from '../../shared/components/animate-ui/dropdown-menu-motion';
import { useMenuDismiss } from '../../shared/hooks/use-menu-dismiss';
import { useModel } from '../../shared/hooks/use-model';
import { FileTypeIcon } from '../../shared/components/file-type-icon';
import Folder from '../../shared/components/react-bits/Folder';
import { WarmTooltipGroup } from '../../shared/components/react-bits/WarmTooltip';
import { shellTooltipAppearance, WarmTooltipAnchors } from '../../shared/components/warm-tooltip-anchors';
import { LocalFileAction } from '../../shared/components/local-file-link';
import { homeRecentFiles } from '../models/home-recent-files';
import { HomeLibrary } from '../models/home-library';
import styles from './home-library.module.scss';
import { HomeFilePanel } from './home-file-panel';
import { HomeFileThumbnail } from './home-file-thumbnail';
const folderPapers = [{}, {}];
const viewModes = [['grid', '网格视图', 'lucide-layout-grid'], ['list', '列表视图', 'lucide-list']] as const;
const libraryTooltipAppearance = { ...shellTooltipAppearance, side: 'top' as const, gap: 6, radius: 8, font: 12, px: 10, py: 6 };
const recentFileTime = { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false } as const;

type FileMenuAction = { label: string; icon: IconName; run: () => void };
type FileMenu = { name: string; opener: HTMLButtonElement; x: number; y: number; actions: FileMenuAction[] };

function LibraryListIcon({ name, directory }: { name: string; directory?: boolean }) {
  const glyph = directory ? 'lucide-folder' : /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(name) ? 'chat-image' : 'chat-file';
  return <span className={styles.thumbnail}><Icon name={glyph} width={20} height={20} /></span>;
}

export function BeingLibrary({ api, onConnect, active = true }: { api?: HomeAPI; onConnect: () => void; active?: boolean }) {
  const resources = useMemo(() => api?.connectorResources ? homeConnectorResources(api.connectorResources) : undefined, [api?.connectorResources]);
  if (!api?.files) return <p className="being-empty">当前客户端不支持云端资料库，请更新桌面客户端。</p>;
  return <ConnectorResourceAction.Provider value={resources}><Library api={api} active={active} onConnect={onConnect} /></ConnectorResourceAction.Provider>;
}
function Library({ api, onConnect, active }: { api: HomeAPI; onConnect: () => void; active: boolean }) {
  const [store] = useState(() => new HomeLibrary(api.files!));
  const model = useModel(store);
  useEffect(() => {
    const changed = () => { if (active && store.loaded) void store.load(); };
    window.addEventListener('beings:connector-workspace-changed', changed);
    return () => window.removeEventListener('beings:connector-workspace-changed', changed);
  }, [store, active]);
  const recent = useModel(homeRecentFiles);
  const openLocal = useContext(LocalFileAction);
  const [tab, setTab] = useState<'recent' | 'workspace'>('recent');
  const [view, setView] = useState<'grid' | 'list'>(() => {
    try { return localStorage.getItem('beings:home-files-view') === 'list' ? 'list' : 'grid'; }
    catch { return 'grid'; }
  });
  const reduce = useReducedMotion();
  const tileMotion = { layout: reduce ? false as const : 'position' as const, layoutDependency: view };
  const list = view === 'list';
  const tabId = useId();
  const library = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<FileMenu>();
  const [workspaceQuery, setWorkspaceQuery] = useState('');
  const [recentQuery, setRecentQuery] = useState('');
  // Portaled surfaces must close when their retained tab is no longer visible.
  useEffect(() => { if (!active) { setMenu(undefined); store.closePreview(); } }, [active, store]);
  useMenuDismiss(!!menu, menuRef, () => setMenu(undefined), event => {
    if (event.target !== menuRef.current) setMenu(undefined);
  });
  useLayoutEffect(() => {
    const node = menuRef.current;
    if (!menu || !node) return;
    const left = Math.max(8, Math.min(menu.x, window.innerWidth - node.offsetWidth - 8));
    const top = Math.max(8, Math.min(menu.y, window.innerHeight - node.offsetHeight - 8));
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
    node.querySelector('button')?.focus({ preventScroll: true });
  }, [menu]);
  const menuTrigger = (name: string, actions: (FileMenuAction | false)[]) => {
    const open = (event: MouseEvent<HTMLLIElement> | KeyboardEvent<HTMLLIElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const available = actions.filter(action => action !== false);
      if (!available.length) return;
      const primary = event.currentTarget.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
      const pointer = 'clientX' in event;
      const opener = !pointer && event.target instanceof HTMLButtonElement ? event.target : primary;
      const bounds = opener.getBoundingClientRect();
      setMenu({ name, opener, actions: available, x: pointer ? event.clientX : bounds.left, y: pointer ? event.clientY : bounds.bottom });
    };
    return { onContextMenu: open, onKeyDown: (event: KeyboardEvent<HTMLLIElement>) => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) open(event);
    } };
  };
  useEffect(() => {
    let active = true, received = false;
    let identity: string | undefined;
    const receive = (state: Awaited<ReturnType<HomeAPI['state']>>) => {
      if (!active) return;
      homeRecentFiles.setIdentity(state);
      const next = JSON.stringify([state.authenticated, state.authenticating, state.username, state.binding]);
      if (identity === next) return;
      identity = next;
      setMenu(undefined); store.reset(); setWorkspaceQuery(''); setRecentQuery(''); void store.load();
    };
    const stop = api.subscribe(state => { received = true; receive(state); });
    void api.state().then(state => { if (!received) receive(state); }).catch(() => { if (active && !received) void store.load(); });
    return () => { active = false; stop(); store.reset(); };
  }, [api, store]);
  const navigate = (path: string) => { setWorkspaceQuery(''); void model.load(path); };
  const workspaceSearch = workspaceQuery.trim().toLocaleLowerCase();
  const recentSearch = recentQuery.trim().toLocaleLowerCase();
  const entries = workspaceSearch ? model.entries.filter(entry => entry.name.toLocaleLowerCase().includes(workspaceSearch)) : model.entries;
  const recentEntries = recentSearch ? recent.entries.filter(entry => entry.name.toLocaleLowerCase().includes(recentSearch)) : recent.entries;
  const parts = model.path ? model.path.split('/') : [];
  const viewControls = <div className={styles.viewModes} role="group" aria-label="文件显示布局">
    {viewModes.map(([mode, label, icon]) => <IconButton key={mode} className={styles.iconButton} label={label}
      aria-pressed={view === mode} onClick={() => {
        setView(mode);
        try { localStorage.setItem('beings:home-files-view', mode); } catch { /* Keep the current view. */ }
      }}>
      <Icon name={icon} />
    </IconButton>)}
  </div>;
  return <WarmTooltipGroup delay={300} travel={0} tooltipClassName={styles.fileTooltip}>
    <div ref={library} className={styles.library} data-warm-tooltip-scope>
    <div className={styles.toolbar}>
    <div className={styles.tabs} role="tablist" aria-label="资料库内容" onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 'recent' : event.key === 'End' ? 'workspace' : tab === 'recent' ? 'workspace' : 'recent';
      setTab(next);
      event.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
    }}>
      {([['recent', '最近'], ['workspace', '工作区']] as const).map(([key, label]) =>
        <button type="button" role="tab" key={key} id={`${tabId}-${key}-tab`} data-tab={key} aria-selected={tab === key}
          aria-controls={`${tabId}-${key}`} tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)}>
          {tab === key && <motion.span className={styles.tabIndicator} layoutId={reduce ? undefined : `${tabId}-indicator`} />}
          {label}
        </button>)}
    </div>
    {tab === 'workspace' && <>
      {model.loaded && entries.length > 0 && <span className={styles.count}>{entries.length} 项</span>}
      <IconButton className={styles.iconButton} label="刷新资料库" disabled={model.loading || model.busy} onClick={() => void model.load()}><Icon name="lucide-refresh-cw" /></IconButton>
    </>}
    </div>
    <div className={styles.searchRow}>
      <label className={styles.searchField}>
        <Icon name="lucide-search" />
        <input className={styles.search} type="search" aria-label={tab === 'recent' ? '搜索最近文件' : '搜索当前文件夹'} placeholder="搜索文件"
          value={tab === 'recent' ? recentQuery : workspaceQuery}
          onChange={event => (tab === 'recent' ? setRecentQuery : setWorkspaceQuery)(event.target.value)} />
      </label>
      {viewControls}
    </div>
    <section role="tabpanel" id={`${tabId}-recent`} aria-labelledby={`${tabId}-recent-tab`} hidden={tab !== 'recent'}>
      {!recentEntries.length && <p className={styles.recentEmpty}>{recentSearch ? '没有匹配的文件。' : '打开本机或云电脑中的文件后，会显示在这里。'}</p>}
      <ul className={styles.fileGrid} data-layout={view} aria-label="最近的文件">{recentEntries.map(entry => <motion.li {...tileMotion} className={styles.tile} key={`${entry.source}:${entry.path}`}
        {...menuTrigger(entry.name, [
          entry.source === 'local' ? !!openLocal && { label: '打开', icon: 'chat-file', run: () => openLocal(entry.path) }
            : !model.busy && { label: '预览', icon: 'chat-file', run: () => void model.open(entry) },
          entry.source === 'cloud' && !model.busy && { label: '下载', icon: 'chat-download', run: () => void model.download(entry.path) },
          { label: '从最近记录移除', icon: 'chat-close', run: () => recent.remove(entry.path, entry.source) },
        ])}>
          {list ? <LibraryListIcon name={entry.name} /> : entry.source === 'cloud'
            ? <HomeFileThumbnail file={entry} api={active && tab === 'recent' ? api.files : undefined}
                onOpen={model.busy ? undefined : () => void model.open(entry)} />
            : <span className={styles.thumbnail}><FileTypeIcon path={entry.path} className={styles.fileTypeIcon} glyph="chat-file" /></span>}
        <button className={styles.tileButton} type="button" aria-haspopup="menu" aria-keyshortcuts="Shift+F10" disabled={entry.source === 'local' ? !openLocal : model.busy}
          data-warm-tooltip={`${entry.name}\n最近打开 · ${new Date(entry.openedAt).toLocaleString('zh-CN', recentFileTime)}`}
          onClick={() => { if (entry.source === 'local') openLocal?.(entry.path); else void model.open(entry); }}>
          <span className={styles.fileName}>{entry.name}</span><span className={styles.fileSource}>{entry.source === 'local' ? '本机' : '云电脑'}</span>
        </button>
        <IconButton className={`${styles.iconButton} ${styles.tileAction} ${styles.removeRecent}`} label={`从最近记录移除：${entry.name}`}
          title="" data-warm-tooltip="移除最近记录" onClick={() => recent.remove(entry.path, entry.source)}>
          <Icon name="chat-close" />
        </IconButton>
      </motion.li>)}</ul>
    </section>
    <section role="tabpanel" id={`${tabId}-workspace`} aria-labelledby={`${tabId}-workspace-tab`} hidden={tab !== 'workspace'}>
      {active && tab === 'workspace' && <ConnectorWorkspaceImports />}
    {parts.length > 0 && <div className={styles.heading}>
      <nav className={styles.breadcrumbs} aria-label="工作区路径">
        <button type="button" aria-label="工作区" aria-current={!parts.length ? 'location' : undefined} onClick={() => navigate('')}><Icon name="lucide-folder" /><span>工作区</span></button>
        {parts.map((part, index) => <span key={index}><span aria-hidden="true">/</span><button type="button" title={part} aria-current={index === parts.length - 1 ? 'location' : undefined} onClick={() => navigate(parts.slice(0, index + 1).join('/'))}>{part}</button></span>)}
      </nav>
    </div>}
    {model.error && <div className={styles.feedback} role="alert"><p>{model.error}</p><div><button type="button" disabled={model.loading || model.busy} onClick={() => void model.load()}>重试</button><button type="button" onClick={onConnect}>前往电脑栏</button></div></div>}
    <p className={styles.status} role="status" hidden={!model.busy && !model.loading && !model.notice}>{model.busy ? '正在保存文件…' : model.loading ? '正在读取工作区…' : model.notice || (model.loaded ? `${entries.length} 项${workspaceSearch ? '匹配结果' : ''}` : '')}</p>
    {model.loaded && !entries.length && <motion.div className={styles.empty}
      initial={workspaceSearch || reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.12 }}>
      <Icon name="lucide-folder" />
      <strong>{workspaceSearch ? '没有匹配的文件' : '这个文件夹还是空的'}</strong>
      <p>{workspaceSearch ? '试试其他名称，或清除搜索。' : 'Being 生成的文件会出现在这里。'}</p>
      {workspaceSearch && <button type="button" onClick={() => setWorkspaceQuery('')}>清除搜索</button>}
    </motion.div>}
    <ul className={styles.fileGrid} data-layout={view} aria-label="工作区文件" aria-busy={model.loading}>{entries.map(entry => (
      <motion.li {...tileMotion} className={`${styles.tile} ${entry.type === 'directory' ? styles.folderTile : ''}`} key={entry.path}
        {...menuTrigger(entry.name, model.busy ? [] : entry.type === 'directory'
          ? [{ label: '打开文件夹', icon: 'lucide-folder', run: () => navigate(entry.path) }]
          : [{ label: '预览', icon: 'chat-file', run: () => void model.open(entry) },
            { label: '下载', icon: 'chat-download', run: () => void model.download(entry.path) }])}>
        {entry.type === 'directory' ? <>
          {list ? <LibraryListIcon name={entry.name} directory />
            : <Folder items={folderPapers} size={0.42} theme={document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'}
              openOn="hover" compactOpen openPaperInset={14} tilt={0.15} bounce={0} intro={false}
              draggable={false} zoomOnClick={false} onItemClick={() => { if (!model.busy) navigate(entry.path); }} />}
          <button className={styles.folderName} type="button" aria-haspopup="menu" aria-keyshortcuts="Shift+F10" data-warm-tooltip={entry.name} disabled={model.busy} onClick={() => navigate(entry.path)}>
            <span className={styles.fileName}>{entry.name}</span>
          </button>
        </> : <>
          {list ? <LibraryListIcon name={entry.name} />
            : <HomeFileThumbnail file={entry} api={active && tab === 'workspace' ? api.files : undefined}
              onOpen={model.busy ? undefined : () => void model.open(entry)} />}
          <button className={styles.tileButton} type="button" aria-haspopup="menu" aria-keyshortcuts="Shift+F10" data-warm-tooltip={entry.name} disabled={model.busy} onClick={() => void model.open(entry)}>
            <span className={styles.fileName}>{entry.name}</span>
            <small className={styles.fileSize}>{formatBytes(entry.size)}</small>
          </button>
          <IconButton className={`${styles.iconButton} ${styles.tileAction}`} label={`下载 ${entry.name}`} title="" data-warm-tooltip="下载文件"
            disabled={model.busy} onClick={() => void model.download(entry.path)}>
            <Icon name="chat-download" />
          </IconButton>
        </>}
      </motion.li>
    ))}</ul>
    </section>
    {createPortal(<AnimatePresence>{menu && active && <DropdownMenuMotion ref={menuRef} className={styles.contextMenu}
      role="menu" aria-label={`${menu.name}的操作`} onContextMenu={event => event.preventDefault()}
      onKeyDown={event => {
        if (event.key === 'Escape' || event.key === 'Tab') {
          event.preventDefault();
          event.stopPropagation();
          setMenu(undefined);
          menu.opener.focus({ preventScroll: true });
        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const items = Array.from(event.currentTarget.querySelectorAll('button'));
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
            : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length]?.focus({ preventScroll: true });
        }
      }}>
      {menu.actions.map(({ label, icon, run }) => <button key={label} type="button" role="menuitem" tabIndex={-1}
        onClick={() => { setMenu(undefined); menu.opener.focus({ preventScroll: true }); run(); }}>
        <Icon name={icon} /><span>{label}</span>
      </button>)}
    </DropdownMenuMotion>}</AnimatePresence>, document.body)}
    {active && <HomeFilePanel store={store} />}
    {active && <WarmTooltipAnchors rootRef={library} appearance={libraryTooltipAppearance} />}
    </div>
  </WarmTooltipGroup>;
}
