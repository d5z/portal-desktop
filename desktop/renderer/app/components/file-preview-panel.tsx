import { WorkspaceDrawer } from "../../shared/components/workspace-drawer";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from '../../shared/components/icon-button';
import { Icon } from '../../shared/icons/icon';
import { PanelResizeHandle, usePanelWidth } from '../../shared/components/panel-resize';

/** One right-hand preview surface for local files, attachments and Home files. */
export function FilePreviewPanel({ name, path, onClose, actions, children, portal = false }: {
  name: string; path?: string; onClose: () => void; actions?: ReactNode; children: ReactNode; portal?: boolean;
}) {
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const [width, setWidth] = usePanelWidth('file-preview', 640);
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const current = panel.current;
    // Files and the browser share the same right-hand panel.
    window.dispatchEvent(new CustomEvent('beings:side-panel-open', { detail: current }));
    const replace = (event: Event) => { if ((event as CustomEvent).detail !== current) close.current(); };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      event.stopImmediatePropagation(); close.current();
    };
    window.addEventListener('beings:side-panel-open', replace);
    window.addEventListener('keydown', keyboard, true);
    return () => {
      window.removeEventListener('beings:side-panel-open', replace);
      window.removeEventListener('keydown', keyboard, true);
      requestAnimationFrame(() => {
        if (!document.querySelector('.client-file-viewer') && document.activeElement === document.body && opener?.isConnected)
          opener.focus({ preventScroll: true });
      });
    };
  }, []);
  const content = <WorkspaceDrawer ref={panel} style={{ '--file-preview-width': `${width}px` } as CSSProperties}
    className={`client-file-viewer${maximized ? ' maximized' : ''}`} aria-label={`文件预览：${name}`}>
    <PanelResizeHandle panel={panel} label="调整附件预览宽度" width={width} onResize={setWidth} initial={640} min={280} max={1200} reserve={280} disabled={maximized} />
    <header>
      <IconButton className="file-preview-layout-toggle" label={maximized ? '恢复对话' : '展开全部'} aria-pressed={maximized} onClick={() => setMaximized(value => !value)}><Icon name="panel-expand" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" /></IconButton>
      <strong title={path || name}>{name}</strong>{actions}
      <IconButton className="file-preview-icon" label="关闭文件预览" onClick={onClose}><Icon name="close" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" /></IconButton>
    </header>
    {children}
  </WorkspaceDrawer>;
  return portal ? createPortal(content, document.querySelector('.workspace-body') || document.body) : content;
}


export function FilePreviewModes({ source, onChange }: { source: boolean; onChange: (source: boolean) => void }) {
  return <div className="file-preview-modes" role="group" aria-label="文件显示方式">
    <button type="button" aria-pressed={!source} onClick={() => onChange(false)}>预览</button>
    <button type="button" aria-pressed={source} onClick={() => onChange(true)}>源码</button>
  </div>;
}
