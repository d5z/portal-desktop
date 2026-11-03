import clsx from 'clsx';
import styles from './image-viewer.module.scss';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Shared top-layer viewer for generated images and uploaded attachments. */
export type ImageViewerNavigation = { index: number; total: number; previous(): void; next(): void };
export function ImageViewer({ src, name, onClose, actions, notice, onLoad, onError, navigation }: {
  src?: string; name: string; onClose(): void; actions: ReactNode; notice?: ReactNode;
  onLoad?(): void; onError?(): void;
  navigation?: ImageViewerNavigation;
}) {
  const dialog = useRef<HTMLDialogElement>(null), stage = useRef<HTMLDivElement>(null), image = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<number | null>(null), [dragging, setDragging] = useState(false);
  const drag = useRef<{ id:number; x:number; y:number; left:number; top:number } | null>(null);
  const anchor = useRef<{ x:number; y:number; clientX:number; clientY:number } | null>(null);
  const fit = natural.width && viewport.width ? Math.min(1, viewport.width / natural.width, viewport.height / natural.height) : 1;
  const scale = zoom ?? fit, minimum = Math.min(.1, fit), ready = natural.width > 0;
  const canPan = natural.width * scale > viewport.width + 1 || natural.height * scale > viewport.height + 1;
  useEffect(() => { dialog.current?.showModal(); }, []);
  useLayoutEffect(() => { setNatural({width:0,height:0}); setZoom(null); }, [src]);
  useLayoutEffect(() => {
    const node = stage.current!;
    const resize = () => setViewport({ width: node.clientWidth, height: node.clientHeight });
    resize(); const observer = new ResizeObserver(resize); observer.observe(node);
    return () => observer.disconnect();
  }, []);
  function changeScale(next: number, point?: { x:number; y:number }) {
    if (!ready || !stage.current || !image.current) return;
    const bounds = stage.current.getBoundingClientRect(), picture = image.current.getBoundingClientRect();
    const clientX = point?.x ?? bounds.left + bounds.width / 2, clientY = point?.y ?? bounds.top + bounds.height / 2;
    anchor.current = { x:(clientX-picture.left)/scale, y:(clientY-picture.top)/scale, clientX, clientY };
    setZoom(Math.max(minimum, Math.min(8, next)));
  }
  function reset() { anchor.current = null; setZoom(null); stage.current?.scrollTo(0, 0); }
  useLayoutEffect(() => {
    const point = anchor.current, node = stage.current, picture = image.current;
    if (!point || !node || !picture) return;
    const bounds = picture.getBoundingClientRect();
    node.scrollLeft += bounds.left + point.x * scale - point.clientX;
    node.scrollTop += bounds.top + point.y * scale - point.clientY;
    anchor.current = null;
  }, [scale]);
  useEffect(() => {
    const node = stage.current!;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      changeScale(scale * Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * .003), {x:event.clientX,y:event.clientY});
    };
    node.addEventListener('wheel', wheel, {passive:false});
    return () => node.removeEventListener('wheel', wheel);
  }, [scale, ready, minimum]);
  return createPortal(<dialog ref={dialog} className={styles.viewer} aria-label={`图片预览：${name}`} onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}
    onKeyDown={event => {
      // Portals still bubble through React parents, including expanded intelligent UI.
      event.stopPropagation();
      if (navigation && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        if (event.key === 'ArrowLeft' && navigation.index > 0) navigation.previous();
        if (event.key === 'ArrowRight' && navigation.index < navigation.total - 1) navigation.next();
      }
      if (event.key === '+' || event.key === '=') { event.preventDefault(); changeScale(scale * 1.25); }
      if (event.key === '-') { event.preventDefault(); changeScale(scale / 1.25); }
      if (event.key === '0') { event.preventDefault(); reset(); }
    }}>
    <div className={styles.toolbar}>
      <button type="button" autoFocus aria-label="关闭图片预览" title="关闭（Esc）" onClick={() => dialog.current?.close()}>×</button>
      <span className={styles.name} title={name}>{name}</span>
      {navigation && <output className={styles.position} aria-label="图片位置" aria-live="polite">{navigation.index + 1} / {navigation.total}</output>}
      <div className={styles.actions}>{actions}</div>
    </div>
    <div ref={stage} className={clsx(styles.stage, canPan && styles.canPan, dragging && styles.isDragging)}
      onPointerDown={event => {
        if (!canPan || event.button !== 0) return;
        const node = event.currentTarget;
        drag.current = {id:event.pointerId,x:event.clientX,y:event.clientY,left:node.scrollLeft,top:node.scrollTop};
        node.setPointerCapture(event.pointerId); setDragging(true); event.preventDefault();
      }}
      onPointerMove={event => {
        const origin = drag.current;
        if (!origin || origin.id !== event.pointerId) return;
        event.currentTarget.scrollLeft = origin.left - event.clientX + origin.x;
        event.currentTarget.scrollTop = origin.top - event.clientY + origin.y;
      }}
      onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); drag.current=null; setDragging(false); }}
      onPointerCancel={() => { drag.current=null; setDragging(false); }}
      onLostPointerCapture={() => { drag.current=null; setDragging(false); }}
      onDoubleClick={event => { if (canPan) reset(); else changeScale(scale * 2, {x:event.clientX,y:event.clientY}); }}>
      <div className={styles.canvas} style={{width:ready ? Math.max(viewport.width,natural.width*scale) : '100%',height:ready ? Math.max(viewport.height,natural.height*scale) : '100%'}}>
        {src && <img ref={image} src={src} alt={name} draggable={false} style={ready ? {width:natural.width*scale,height:natural.height*scale} : {visibility:'hidden'}}
          onLoad={event => { setNatural({width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight}); onLoad?.(); }}
          onError={() => { setNatural({width:0,height:0}); onError?.(); }} />}
      </div>
    </div>
    {notice && <div className={styles.notice}>{notice}</div>}
    {navigation && navigation.total > 1 && <div className={styles.navigation} role="group" aria-label="同批图片切换">
      <button type="button" className={styles.previous} aria-label="上一张图片" title="上一张（←）" disabled={navigation.index === 0} onClick={navigation.previous}>‹</button>
      <button type="button" className={styles.next} aria-label="下一张图片" title="下一张（→）" disabled={navigation.index === navigation.total - 1} onClick={navigation.next}>›</button>
    </div>}
    <div className={styles.controls} role="group" aria-label="图片缩放">
      <button type="button" disabled={!ready || scale <= minimum} aria-label="缩小图片" title="缩小（−）" onClick={() => changeScale(scale / 1.25)}>−</button>
      <output aria-label="缩放比例">{ready ? `${Math.round(scale * 100)}%` : '—'}</output>
      <button type="button" disabled={!ready || scale >= 8} aria-label="放大图片" title="放大（+）" onClick={() => changeScale(scale * 1.25)}>+</button>
      <span className={styles.controlDivider} />
      <button type="button" disabled={!ready} title="适应窗口（0）" onClick={reset}>适应窗口</button>
    </div>
    <small className={styles.hint}>{navigation && navigation.total > 1 ? '← → 切换图片 · ' : ''}滚轮缩放 · 放大后拖动查看 · Esc 关闭</small>
  </dialog>, document.body);
}
