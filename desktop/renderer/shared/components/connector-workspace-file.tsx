import { formatBytes } from '../lib/format-bytes';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ConnectorContext, ConnectorImport, ConnectorImportReceipt, ConnectorResources } from '../../../shared/connector-resources';
import { HomeFileAction } from './being-files';

export const ConnectorResourceAction = createContext<ConnectorResources | undefined>(undefined);
const labels: Record<ConnectorImport['state'], string> = {
  pending: '导出完成，等待保存', copying: '导出完成，正在保存到工作区…', write_unknown: '保存结果确认中…',
  ready: '文件已保存到工作区', failed: '工作区保存失败', deleting: '正在删除工作区副本…', delete_unknown: '删除结果确认中…', deleted: '工作区副本已删除',
};
export function ConnectorWorkspaceFile({ initial }: { initial: ConnectorImportReceipt }) {
  const resources = useContext(ConnectorResourceAction), open = useContext(HomeFileAction);
  const [confirmed, setConfirmed] = useState(false);
  const [canWrite, setCanWrite] = useState(false);
  const [value, setValue] = useState<ConnectorImport | undefined>(initial.state ? initial : undefined);
  const [error, setError] = useState(''), [connected, setConnected] = useState(false), [busy, setBusy] = useState(false);
  const context = useRef<ConnectorContext | undefined>(undefined);
  const locked = useRef(false), disposed = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const root = `/v1/me/connector-imports/${encodeURIComponent(initial.import_id)}`;
  const update = async () => {
    if (!resources || disposed.current || locked.current || document.hidden) return;
    locked.current = true;
    try {
      const current = await resources.context();
      if (!context.current || current.session !== context.current.session || current.endpoint !== context.current.endpoint || current.account !== context.current.account) {
        setConnected(false); setError('连接已切换，请回到对应 Being 的工作区查看文件。'); return;
      }
      const next = await resources.request<ConnectorImport>(context.current, root);
      if (disposed.current) return;
      setValue(next); setConfirmed(true); setError('');
      if (['pending', 'copying', 'write_unknown', 'deleting', 'delete_unknown'].includes(next.state)) timer.current = setTimeout(() => void update(), 2500);
    } catch (e) { if (!disposed.current) setError(e instanceof Error ? e.message : '无法查询保存状态'); }
    finally { locked.current = false; }
  };
  useEffect(() => {
    disposed.current = false;
    void resources?.context().then(next => {
      if (disposed.current) return;
      if (!next.account || !next.endpoint) {
        setError('请连接当前 Being 的 Home 账号后查看保存状态。');
        return;
      }
      context.current = next;
      setConnected(true);
      setCanWrite(next.canWriteFiles);
      void update();
    }).catch(() => { if (!disposed.current) setError('无法连接 Home 查询工作区保存状态。'); });
    const focus = () => { clearTimeout(timer.current); void update(); };
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus);
    return () => { disposed.current = true; clearTimeout(timer.current); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  }, [resources, initial.import_id]);
  const mutate = async (remove: boolean) => {
    if (!resources || !context.current || locked.current) return;
    if (remove && !window.confirm('仅删除此文件的工作区副本？原飞书文档不受影响。')) return;
    locked.current = true; setBusy(true); setError(''); clearTimeout(timer.current);
    try {
      await resources.request(context.current, root + (remove ? '' : '/retry'), remove ? 'DELETE' : 'POST');
      setValue(current => current && { ...current, state: remove ? 'deleting' : 'pending', path: null });
    } catch (e) { setError(e instanceof Error ? e.message : '操作未完成'); }
    finally { locked.current = false; setBusy(false); void update(); }
  };
  return <section className="run-artifacts" aria-label="Connector 工作区文件">
    <div><strong>{value?.name || '飞书导出文件'}</strong><p role="status">{connected && !confirmed ? '正在核对工作区保存状态…' : value ? labels[value.state] : '工作区保存状态待核对'}</p>
      {value?.size_bytes !== undefined && <small>{formatBytes(value.size_bytes)}</small>}
      {value?.sha256 && <details><summary>文件摘要</summary><code>{value.sha256}</code></details>}
      {value?.error_code && <p>{value.error_code}</p>}{error && <p role="alert">{error}</p>}
      {connected && confirmed && value?.state === 'ready' && value.path && <><button type="button" onClick={() => open?.(value.path!, 'preview')}>查看文件</button><button type="button" onClick={() => open?.(value.path!, 'download')}>下载文件</button><button type="button" disabled={busy || !canWrite} title={canWrite ? undefined : '需要 files:write 权限，请重新登录授权'} onClick={() => void mutate(true)}>删除工作区副本</button></>}
      {connected && confirmed && value?.state === 'failed' && <button type="button" disabled={busy || !canWrite} title={canWrite ? undefined : '需要 files:write 权限，请重新登录授权'} onClick={() => void mutate(false)}>重试保存</button>}
      {connected && error && <button type="button" disabled={busy} onClick={() => void update()}>刷新保存状态</button>}
    </div>
  </section>;
}
