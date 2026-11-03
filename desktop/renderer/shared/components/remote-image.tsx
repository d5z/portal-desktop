import styles from './remote-image.module.scss';
import { createContext, useContext, useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ImageViewer, type ImageViewerNavigation } from './image-viewer';
import { type ImageGalleryItem } from '../../../shared/image-gallery';
import { MAX_REMOTE_IMAGE_BYTES, REMOTE_IMAGE_MIME, inlineImageBlob, remoteImageName } from '../../../shared/remote-image';
import { registerRemoteImageBridge } from './remote-image-bridge';

const GalleryContext = createContext<((src: string) => void) | null>(null);
const shellPreview = () => location.protocol === 'beings:' && parent !== window;
export function RemoteImageGroup({items, children}: {items:ImageGalleryItem[];children:ReactNode}) {
  const id = useId(), [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (!shellPreview()) return;
    const release = items.map(item => registerRemoteImageBridge(item.src));
    parent.postMessage({type:'beings:remote-image-gallery-update',gallery:{id,items},revision:new URLSearchParams(location.search).get('revision')}, '*');
    return () => release.forEach(stop => stop());
  }, [id, items]);
  useEffect(() => () => {
    if (shellPreview()) parent.postMessage({type:'beings:remote-image-gallery-update',gallery:{id,items:[]},revision:new URLSearchParams(location.search).get('revision')}, '*');
  }, [id]);
  const open = useCallback((src:string) => {
    const item = items.find(item => item.src === src);
    if (!item) return;
    if (shellPreview()) parent.postMessage({type:'beings:remote-image-preview',...item,gallery:{id,items},revision:new URLSearchParams(location.search).get('revision')}, '*');
    else setSelected(src);
  }, [id,items]);
  return <GalleryContext.Provider value={open}>{children}{selected && items.length > 0 &&
    <RemoteImageGalleryPreview items={items} initialSrc={selected} onClose={() => setSelected(null)}/>}</GalleryContext.Provider>;
}

export function RemoteImageGalleryPreview({items, initialSrc, onClose, load}: {
  items:ImageGalleryItem[];initialSrc:string;onClose():void;load?(src:string,signal:AbortSignal):Promise<Blob>;
}) {
  const [selected,setSelected] = useState(initialSrc);
  const index = Math.max(0,items.findIndex(item => item.src === selected)), item = items[index];
  const src = item?.src;
  const loadCurrent = useCallback((signal:AbortSignal) => load!(src,signal), [load,src]);
  if (!item) return null;
  return <RemoteImagePreview key={item.src} src={item.src} name={item.name} onClose={onClose} load={load ? loadCurrent : undefined}
    navigation={{index,total:items.length,previous:()=>setSelected(items[Math.max(0,index-1)].src),next:()=>setSelected(items[Math.min(items.length-1,index+1)].src)}}/>;
}

export function RemoteImage({ src, name, title, blob, onError }: { src: string; name: string; title?: string; blob?: Blob; onError?(): void }) {
  const [open, setOpen] = useState(false);
  const openGroup = useContext(GalleryContext);
  const label = name || '图片';
  useEffect(() => location.protocol === 'beings:' && /^https:/.test(src) ? registerRemoteImageBridge(src) : undefined, [src]);
  const loadLocal = useCallback(async () => blob!, [blob]);
  function show() {
    if (openGroup) { openGroup(src); return; }
    if (location.protocol === 'beings:' && parent !== window) {
      const local = blob || inlineImageBlob(src);
      parent.postMessage({ type: local ? 'beings:inline-image-preview' : 'beings:remote-image-preview', src, blob:local, name: label,
        revision: new URLSearchParams(location.search).get('revision') }, '*');
    } else setOpen(true);
  }
  return <>
    <button type="button" className={styles.thumbnail} data-slot="image-thumbnail" aria-label={`预览 ${label}`} title={title || '点击查看大图'} onClick={event => { event.preventDefault(); event.stopPropagation(); show(); }}>
      <img src={src} alt={name} loading="lazy" draggable={false} referrerPolicy="no-referrer" onError={onError} />
    </button>
    {open && <RemoteImagePreview src={src} name={label} load={blob ? loadLocal : undefined} onClose={() => setOpen(false)} />}
  </>;
}

export function RemoteImagePreview({ src, name, onClose, load, navigation }: { src: string; name: string; onClose(): void; load?(signal: AbortSignal): Promise<Blob>; navigation?:ImageViewerNavigation }) {
  const pending = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [image, setImage] = useState<{src:string;blob:Blob}|null>(null);
  const source = load ? image?.src : src;
  useEffect(() => {
    return () => { pending.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!load) return;
    const controller = new AbortController();
    let url = '';
    setLoading(true); setFailed(false); setImage(null); setError('');
    void load(controller.signal).then(blob => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob); setImage({src:url,blob});
    }).catch(() => { if (!controller.signal.aborted) { setLoading(false); setFailed(true); } });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [src, load, attempt]);
  async function download() {
    if (pending.current) return;
    const controller = new AbortController(); pending.current = controller;
    setSaving(true); setError('');
    try {
      let blob = image?.blob;
      if (!blob) {
        const response = await fetch(src, { signal: controller.signal, credentials: 'omit' });
        if (!response.ok) throw new Error('图片下载失败，请重试');
        blob = await response.blob();
      }
      if (!REMOTE_IMAGE_MIME.test(blob.type) || blob.size > MAX_REMOTE_IMAGE_BYTES) throw new Error('图片格式或大小不受支持');
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = remoteImageName(name, blob.type);
      document.body.append(link); link.click(); link.remove();
      // The native download needs time to acquire the object URL, including after the preview closes.
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      if (!controller.signal.aborted) setError('下载失败，请重试或打开原图保存');
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setSaving(false);
    }
  }
  return <ImageViewer key={attempt} src={source} name={name} onClose={onClose} navigation={navigation}
    onLoad={() => { setLoading(false); setFailed(false); }} onError={() => { setLoading(false); setFailed(true); }}
    actions={<>
        <button type="button" disabled={saving || loading || failed} onClick={() => void download()}>{saving ? '正在下载…' : '下载原图'}</button>
        {error && <span role="alert">{error} <a href={src} target="_blank" rel="noopener noreferrer">打开原图</a></span>}
    </>}
    notice={loading ? <span role="status">正在加载原图…</span> : failed ? <div role="alert">图片暂时无法加载 <button type="button" onClick={() => { setFailed(false); setLoading(true); setAttempt(value => value + 1); }}>重试</button></div> : undefined} />;
}
