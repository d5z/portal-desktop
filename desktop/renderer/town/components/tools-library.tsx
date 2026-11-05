import { useEffect, useState } from 'react';
import { TownModel, str } from '../models/town';
import { CatalogDetail, LocalKitDetail, Pagination } from './catalog';
import { PluginCard } from '../../plugins/page';
import { dshRuntime } from '../../plugins/dsh/runtime';
import { navigateTabs } from '../../shared/lib/tab-navigation';

export { toolEntries } from '../models/tool-library';
import { toolPage } from '../models/pagination';

export function ToolsLibrary({ town }: { town: TownModel }) {
  return town.groveKind === 'plugin' ? <PluginLibrary town={town} /> : <ToolCatalog town={town} />;
}

function PluginLibrary({ town }: { town: TownModel }) {
  const [kind, setKind] = useState<'dsh' | 'town'>(town.pluginKind);
  useEffect(() => {
    dshRuntime.managerNavigate = () => { town.pluginKind = 'dsh'; setKind('dsh'); };
    return () => { dshRuntime.managerNavigate = undefined; dshRuntime.closeManager(); };
  }, [town]);
  return <div className="plugin-library">
    <div className="plugin-library-tabs" role="tablist" aria-label="插件类型" onKeyDown={navigateTabs}>
      {([['town', '官方插件'], ['dsh', 'DeepSeek Harness 插件']] as const).map(([id, label]) => <button key={id} id={`plugin-type-${id}`} role="tab" aria-selected={kind === id} aria-controls={`plugin-library-${id}`} tabIndex={kind === id ? 0 : -1} onClick={() => { town.pluginKind = id; setKind(id); }}>{label}</button>)}
    </div>
    <div id="plugin-library-dsh" role="tabpanel" aria-labelledby="plugin-type-dsh" hidden={kind !== 'dsh'}>{kind === 'dsh' && <div className="dsh-library-host" ref={dshRuntime.setManagerHost} />}</div>
    <div id="plugin-library-town" role="tabpanel" aria-labelledby="plugin-type-town" hidden={kind !== 'town'}>
      <div className="town-plugin-toolbar"><p>管理 Town 插件与本地扩展</p><input type="search" aria-label="搜索 Town 插件" placeholder="搜索 Town 插件…" value={town.search} onChange={event => town.setSearch(event.target.value)} /><label className="tools-local-filter"><input type="checkbox" checked={town.localOnly} onChange={event => { town.localOnly = event.target.checked; town.offset = 0; town.changed(); }} />仅本机存在</label>{town.plugins?.api && <button className="primary" disabled={town.plugins.busy} onClick={() => void town.plugins!.act(() => town.plugins!.api!.importLocal())}>导入插件目录</button>}{town.plugins && <button className="secondary" onClick={() => town.plugins!.showCommands(true)}>快捷操作</button>}</div>
      <ToolCatalog town={town} /><div className="plugin-library-pagination"><Pagination town={town} /></div>
    </div>
  </div>;
}

function ToolCatalog({ town }: { town: TownModel }) {
  const { items: visible } = toolPage(town);
  const selected = town.toolSelection;
  const entry = visible.find(item => item.key === selected) || (town.localKit ? visible.find(item => item.kit?.name === town.localKit?.name) : undefined) || visible[0];
  const remoteId = entry?.remote && !entry.kit && !entry.plugin ? str(entry.remote.id) : undefined;
  // List refreshes may restore a cached detail without changing the visible key.
  // Reconcile resource identity too, including requests cancelled by a refresh.
  const needsSelection = selected !== (entry?.key || '') ||
    Boolean(entry?.kit && town.localKit?.name !== entry.kit.name) ||
    (remoteId !== undefined && (town.selectedId !== remoteId ||
      (!town.detailLoading && !town.detailError &&
        (town.detail?.query.kind !== 'kit' || town.detail.query.id !== remoteId))));
  useEffect(() => {
    if (needsSelection) town.selectTool(entry);
  }, [entry?.key, remoteId, needsSelection, town]);
  return <>
    {town.plugins?.error && <p role="alert">{town.plugins.error}</p>}
    {town.plugins?.library.problems.map(problem => <p role="alert" key={problem}>{problem}</p>)}
    {town.installedError && <p role="alert">本机 Kit：{town.installedError}</p>}
    {town.localAppsError && <p role="alert">本机 App：{town.localAppsError}</p>}
    {!town.localOnly && town.error && <p role="status">Grove 暂时不可用：{town.error.message}。仍可使用本机工具。<button className="text-button" onClick={() => void town.load(true)}>重试</button></p>}
    <div className="catalog-split tools-library">
      <div className="catalog-list">
        {visible.map(item => <button className={`catalog-item${item.key === entry?.key ? ' selected' : ''}`} key={item.key} onClick={() => { if (item.key !== entry?.key) town.selectTool(item); }}>
          <strong className="catalog-title">{item.name}</strong><p>{item.description}</p>
          <span className="grove-tag-row"><span className="mini-tag">{{ app: 'App', kit: 'Kit', plugin: 'Plugin' }[item.kind]}</span>{item.local && <span className="mini-tag">✓ 本机存在</span>}{item.plugin && <span className="mini-tag">{item.plugin.enabled ? '已启用' : '已停用'}</span>}</span>
        </button>)}
        {!visible.length && <p className="empty-inline">{town.groveKind === 'plugin' ? '尚未安装插件。' : '没有符合筛选条件的工具。'}{town.loading && !town.localOnly && ' 正在读取 Grove…'}</p>}
      </div>
      <div className="catalog-detail">
        {entry?.plugin && town.plugins ? <PluginCard model={town.plugins} plugin={entry.plugin} /> : entry?.kit ? <LocalKitDetail town={town} kit={entry.kit} /> : entry?.remote ? <CatalogDetail key={remoteId} town={town} expectedId={remoteId} /> : entry?.app ? <><h2>{entry.name}</h2><p>{entry.description}</p><code className="local-path">{entry.app.path}</code></> : <p className="detail-placeholder">选择工具，查看详情与可用操作。</p>}
        {entry?.kind === 'app' && town.api.associateApp && <div className="kit-actions">
          <button className="secondary" onClick={() => void town.run(async () => { await town.api.associateApp!({ id: entry.app?.id || str(entry.remote?.id), name: entry.name }); await town.refreshLocalApps(); })}>{entry.app ? '重新关联本机 App' : '关联本机 App'}</button>
          {entry.app && <button className="secondary" onClick={() => void town.run(async () => { await town.api.unlinkApp!(entry.app!.id); await town.refreshLocalApps(); })}>取消本机关联</button>}
          <p className="field-help">选择已安装的程序以确认本机存在；取消关联不会删除程序。</p>
        </div>}
      </div>
    </div>
  </>;
}
