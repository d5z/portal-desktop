import clsx from 'clsx';
import styles from './image-viewer.module.scss';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icons/icon';

/** Shared top-layer viewer for generated images and uploaded attachments. */
export type ImageViewerNavigation = {
  index: number; total: number; previous(): void; next(): void;
  items: readonly { src: string; name: string }[];
  renderThumbnail?(item: { src: string; name: string }): ReactNode;
  select(index: number): void;
};
export function ImageViewer({ src, name, onClose, actions, notice, onLoad, onError, navigation }: {
  src?: string; name: string; onClose(): void; actions: ReactNode; notice?: ReactNode;
  onLoad?(): void; onError?(): void;
  navigation?: ImageViewerNavigation;
}) {
  const dialog = useRef<HTMLDialogElement>(null), stage = useRef<HTMLDivElement>(null), image = useRef<HTMLImageElement>(null);
  const thumbnails = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<number | null>(null), [dragging, setDragging] = useState(false);
  const drag = useRef<{ id:number; x:number; y:number; left:number; top:number } | null>(null);
  const anchor = useRef<{ x:number; y:number; clientX:number; clientY:number } | null>(null);
  const moved = useRef(false);
  const pressOnImage = useRef(false);
  const fit = natural.width && viewport.width ? Math.min(1, viewport.width / natural.width, viewport.height / natural.height) : 1;
  const scale = zoom ?? fit, minimum = Math.min(.1, fit), ready = natural.width > 0;
  const canPan = natural.width * scale > viewport.width + 1 || natural.height * scale > viewport.height + 1;
  useLayoutEffect(() => {
    const viewer = dialog.current!;
    viewer.showModal();
    // Start on the preview so the first Tab enters the toolbar.
    viewer.focus({ preventScroll: true });
  }, []);
  useLayoutEffect(() => { setNatural({width:0,height:0}); reset(); }, [src]);
  useLayoutEffect(() => {
    const tray = thumbnails.current, selected = tray?.querySelector('[aria-current=true]');
    if (!tray || !selected) return;
    const bounds = tray.getBoundingClientRect(), button = selected.getBoundingClientRect();
    if (button.left < bounds.left + 3) tray.scrollLeft += button.left - bounds.left - 3;
    else if (button.right > bounds.right - 3) tray.scrollLeft += button.right - bounds.right + 3;
  }, [navigation?.index, navigation?.total, viewport.width]);
  useLayoutEffect(() => {
    const node = stage.current!;
    const resize = () => setViewport({ width: node.clientWidth, height: node.clientHeight });
    resize(); const observer = new ResizeObserver(resize); observer.observe(node);
    return () => observer.disconnect();
  }, []);
  function changeScale(next: number, point?: { x:number; y:number }) {
    if (!ready || !stage.current || !image.current) return;
    const target = Math.max(minimum, Math.min(8, next));
    if (target === scale) return;
    const bounds = stage.current.getBoundingClientRect(), picture = image.current.getBoundingClientRect();
    const clientX = point?.x ?? bounds.left + bounds.width / 2, clientY = point?.y ?? bounds.top + bounds.height / 2;
    anchor.current = { x:(clientX-picture.left)/scale, y:(clientY-picture.top)/scale, clientX, clientY };
    setZoom(target);
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
      <div className={styles.actions}>{actions}</div>
      <button type="button" aria-label="关闭图片预览" title="关闭（Esc）" onClick={() => dialog.current?.close()}><Icon name="chat-close" width="20" height="20" strokeWidth="1.5" /></button>
    </div>
    <div ref={stage} className={clsx(styles.stage, canPan && styles.canPan, dragging && styles.isDragging)} data-zoomed={zoom !== null || undefined}
      onPointerDown={event => {
        moved.current = false;
        pressOnImage.current = event.target === image.current;
        if (!pressOnImage.current || !canPan || event.button !== 0) return;
        const node = event.currentTarget;
        drag.current = {id:event.pointerId,x:event.clientX,y:event.clientY,left:node.scrollLeft,top:node.scrollTop};
        node.setPointerCapture(event.pointerId); setDragging(true); event.preventDefault();
      }}
      onPointerMove={event => {
        const origin = drag.current;
        if (!origin || origin.id !== event.pointerId) return;
        if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 4) moved.current = true;
        event.currentTarget.scrollLeft = origin.left - event.clientX + origin.x;
        event.currentTarget.scrollTop = origin.top - event.clientY + origin.y;
      }}
      onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); drag.current=null; setDragging(false); }}
      onPointerCancel={() => { drag.current=null; setDragging(false); }}
      onLostPointerCapture={() => { drag.current=null; setDragging(false); }}
      onClick={() => {
        if (!moved.current && !pressOnImage.current) dialog.current?.close();
      }}
      onDoubleClick={event => {
        if (!pressOnImage.current || moved.current) return;
        if (zoom !== null) reset(); else changeScale(scale * 2, {x:event.clientX,y:event.clientY});
      }}>
      <div className={styles.canvas} style={{width:ready ? Math.max(viewport.width,natural.width*scale) : '100%',height:ready ? Math.max(viewport.height,natural.height*scale) : '100%'}}>
        {src && <img ref={image} src={src} alt={name} draggable={false} style={ready ? {width:natural.width*scale,height:natural.height*scale} : {visibility:'hidden'}}
          onLoad={event => { setNatural({width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight}); onLoad?.(); }}
          onError={() => { setNatural({width:0,height:0}); onError?.(); }} />}
      </div>
    </div>
    {notice && <div className={styles.notice}>{notice}</div>}
    <div className={styles.footer}>
      {navigation && navigation.total > 1 && <div ref={thumbnails} className={styles.thumbnails} role="group" aria-label="同批图片">
        {navigation.items.map((item, index) => <button type="button" key={`${index}:${item.src}`} aria-label={`查看 ${item.name}`}
          aria-current={index === navigation.index ? 'true' : undefined} onClick={() => navigation.select(index)}>
          {navigation.renderThumbnail ? navigation.renderThumbnail(item)
            : <img src={item.src} alt="" loading="lazy" draggable={false} referrerPolicy="no-referrer" />}
        </button>)}
      </div>}
      <div className={styles.controls} role="group" aria-label="图片缩放">
        <button type="button" disabled={!ready || scale <= minimum} aria-label="缩小图片" title="缩小（−）" onClick={() => changeScale(scale / 1.25)}>−</button>
        <button type="button" disabled={!ready || scale >= 8} aria-label="放大图片" title="放大（+）" onClick={() => changeScale(scale * 1.25)}>+</button>
        <button type="button" disabled={!ready} aria-label="适应窗口" title="适应窗口（0）" onClick={reset}>
          <Icon name="expand" width="17" height="17" stroke="currentColor" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </button>
      </div>
    </div>
  </dialog>, document.body);
}
