import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Dialog } from '../../shared/components/dialog';
import { PermissionIcon, choicesFor } from '../../shared/components/permission-picker';
import type { AppModel } from '../models/app';
import type { PermissionMode, ToolApprovalView } from '../../../shared/security';

export function PermissionSettings({ app }: { app: AppModel }) {
  const menu = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mode = app.snapshot?.settings.permissionMode ?? 'auto-review';
  useLayoutEffect(() => {
    const element = menu.current!;
    if (!app.permissionSettingsOpen) { if (element.matches(':popover-open')) element.hidePopover(); return; }
    setError('');
    element.showPopover();
    const position = () => {
      const anchor = app.permissionAnchor ?? { left: 80, top: innerHeight - 100, bottom: innerHeight - 68 };
      const bounds = element.getBoundingClientRect();
      const left = Math.max(8, Math.min(anchor.left, innerWidth - bounds.width - 8));
      const top = anchor.top - bounds.height - 8 >= 8 ? anchor.top - bounds.height - 8
        : Math.max(8, Math.min(anchor.bottom + 8, innerHeight - bounds.height - 8));
      element.style.left = `${left}px`; element.style.top = `${top}px`;
    };
    position();
    const observer = new ResizeObserver(position); observer.observe(element);
    element.querySelector<HTMLButtonElement>('[aria-checked=true]')?.focus();
    const resized = () => app.closePermissionSettings();
    window.addEventListener('resize', resized);
    return () => { observer.disconnect(); window.removeEventListener('resize', resized); };
  }, [app, app.permissionSettingsOpen, app.permissionAnchor]);
  const apply = async (nextMode: PermissionMode) => {
    if (!app.snapshot || busy) return;
    if (nextMode === mode) { app.closePermissionSettings(); return; }
    setBusy(true); setError('');
    try { app.applySnapshot(await app.api.save({ ...app.snapshot.settings, permissionMode: nextMode })); app.closePermissionSettings(); }
    catch (e) { setError(e instanceof Error ? e.message : '无法应用权限设置'); }
    finally { setBusy(false); }
  };
  return <div ref={menu} popover="auto" role="menu" aria-label="工作权限" aria-busy={busy} className="permission-menu"
    onToggle={event => { if (event.newState === 'closed' && app.permissionSettingsOpen) app.closePermissionSettings(); }}
    onKeyDown={event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      if (!items.length) return;
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
      items[next].focus();
    }}>
    <div className="permission-menu-heading">Portal 调用权限</div>
    {choicesFor(mode).map(choice => <button key={choice.value} type="button" role="menuitemradio" aria-checked={choice.value === mode}
      tabIndex={choice.value === mode ? 0 : -1} data-mode={choice.value} disabled={busy || !app.snapshot?.settings.hasToken} onClick={() => void apply(choice.value)}>
      <PermissionIcon kind={choice.icon}/><span className="permission-menu-copy"><strong>{choice.title}</strong><small>{choice.detail}</small></span>
      <span className="permission-menu-check" aria-hidden="true">{choice.value === mode ? '✓' : ''}</span>
    </button>)}
    <div className="permission-menu-note" role="status">{busy ? '正在切换…' : '切换会重启运行时，中断当前本机任务'}</div>
    {error && <p role="alert" className="permission-menu-error">{error}</p>}
  </div>;
}

export function ToolApprovalDialog({ app }: { app: AppModel }) {
  const [request, setRequest] = useState<ToolApprovalView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const denyButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (request) denyButton.current?.focus(); }, [request?.id]);
  useEffect(() => {
    let active = true, changed = false;
    const off = app.api.onToolApproval?.(value => { changed = true; setRequest(value); setBusy(false); setError(''); });
    void app.api.toolApprovalPending?.().then(value => { if (active && !changed) setRequest(value); }).catch(() => {});
    return () => { active = false; off?.(); };
  }, [app]);
  async function answer(allowed: boolean) {
    if (!request || busy) return false;
    setBusy(true);
    try { if (!app.api.answerToolApproval) throw new Error('客户端审批通道不可用'); await app.api.answerToolApproval(request.id, allowed); setRequest(null); return true; }
    catch (e) { setError(e instanceof Error ? e.message : '审批失败'); return false; }
    finally { setBusy(false); }
  }
  return <Dialog open={Boolean(request)} busy={busy} onClose={() => void answer(false)} className="permissions-dialog tool-approval-dialog" aria-labelledby="tool-approval-title">
    <header className="permission-dialog-header"><span className="permission-header-icon"><PermissionIcon/></span><div><h2 id="tool-approval-title">此操作需要你的允许</h2><p>仅对当前这一次调用生效</p></div></header>
    <div className="permission-dialog-body"><strong className="approval-action">{request?.message}</strong><pre className="approval-request">{request?.detail}</pre>
      <p className="permission-note">关闭即拒绝 · 2 分钟后自动过期 · 不会记住此授权</p>{error && <p role="alert" className="form-error">{error}</p>}</div>
    <footer className="permission-dialog-footer"><button type="button" className="permission-manage" disabled={busy} onClick={() => { void answer(false).then(answered => { if (answered) app.openPermissionSettings(); }); }}>调整权限…</button><button type="button" ref={denyButton} onClick={() => void answer(false)} disabled={busy}>拒绝</button><button type="button" className="primary" onClick={() => void answer(true)} disabled={busy}>允许这一次</button></footer>
  </Dialog>;
}
