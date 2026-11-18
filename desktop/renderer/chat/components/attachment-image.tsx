import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ImageViewer } from '../../shared/components/image-viewer';
import { imagePreviewSize, rememberImageSize } from '../services/image-preview-size';
import { AttachmentDownload } from './attachment-download';
import { useAttachmentDownloadBridge } from './use-attachment-download-bridge';

export type AttachmentPreviewImage = { id: string; name: string; src: string };
type LoadedImage = AttachmentPreviewImage & { blob?: Blob };
type AttachmentPreview = { items: AttachmentPreviewImage[]; selectedId: string };
const ImageGallery = createContext<{
  register(image: LoadedImage): () => void;
  open(image: LoadedImage, opener: HTMLButtonElement): void;
} | null>(null);

export function AttachmentGalleryPreview({ items, selectedId, endpoint, onClose, request }: AttachmentPreview & {
  endpoint: string;
  onClose(): void;
  request?: (id: string, input: Parameters<typeof fetch>[0], init?: RequestInit) => Promise<Response>;
}) {
  const [index, setIndex] = useState(() => items.findIndex(item => item.id === selectedId));
  const image = items[index];
  const requestImage = useCallback<typeof fetch>((input, init) => request!(image.id, input, init), [request, image.id]);

  return <ImageViewer src={image.src} name={image.name} onClose={onClose}
    navigation={items.length > 1 ? {
      index, total: items.length, items, select: setIndex,
      previous: () => setIndex(index - 1), next: () => setIndex(index + 1),
    } : undefined}
    actions={<AttachmentDownload iconOnly key={image.id} endpoint={endpoint} id={image.id} name={image.name}
      request={request ? requestImage : undefined}>下载原图</AttachmentDownload>} />;
}

export function AttachmentImageGallery({ ids, endpoint, children }: { ids: string[]; endpoint: string; children: ReactNode }) {
  const loaded = useRef(new Map<string, LoadedImage>());
  const [preview, setPreview] = useState<AttachmentPreview | null>(null);
  const register = useCallback((image: LoadedImage) => {
    loaded.current.set(image.id, image);
    return () => { loaded.current.delete(image.id); };
  }, []);
  const open = useCallback((image: LoadedImage, opener: HTMLButtonElement) => {
    const items = ids.flatMap(id => {
      const candidate = id === image.id ? image : loaded.current.get(id);
      return candidate ? [candidate] : [];
    });
    if (image.blob && parent !== window && location.protocol === 'beings:') {
      // The native viewer moves focus out of the chat frame. Return it to this thumbnail on close.
      const { port1, port2 } = new MessageChannel();
      port1.onmessage = () => {
        opener.focus({ preventScroll: true });
        port1.close();
      };
      parent.postMessage({
        type: 'beings:image-preview', revision: new URLSearchParams(location.search).get('revision'),
        id: image.id, name: image.name, blob: image.blob, endpoint,
        gallery: items.length > 1 ? items.map(({ id, name, blob }) => ({ id, name, blob })) : undefined,
      }, '*', [port2]);
    } else setPreview({ items, selectedId: image.id });
  }, [endpoint, ids]);
  const context = useMemo(() => ({ register, open }), [register, open]);

  return <ImageGallery.Provider value={context}>{children}
    {preview && <AttachmentGalleryPreview {...preview} endpoint={endpoint} onClose={() => setPreview(null)} />}
  </ImageGallery.Provider>;
}

export function AttachmentImage({ src, name, endpoint, id, blob, onImageLoad }: LoadedImage & {
  endpoint: string;
  onImageLoad?: (image: HTMLImageElement) => void;
}) {
  const { register, open } = useContext(ImageGallery)!;
  const [size, setSize] = useState(() => imagePreviewSize(endpoint, id));
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState('');
  useAttachmentDownloadBridge(endpoint, id);
  useEffect(() => register({ src, name, id, blob }), [register, src, name, id, blob]);
  useEffect(() => {
    if (!menu) return;
    const close = (event: Event) => {
      if (event.type === 'pointerdown' && event.target instanceof Element && event.target.closest('.attachment-image-context-menu')) return;
      setMenu(null);
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(null); };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('blur', close); window.removeEventListener('keydown', key); };
  }, [menu]);
  async function copyImage() {
    setCopying(true); setCopyError('');
    try {
      const source: Blob = blob || await fetch(src).then(async response => {
        if (!response.ok) throw new Error('图片读取失败');
        return response.blob();
      });
      const mime = source.type || 'image/png';
      if (!/^image\/(png|jpeg|gif|webp)$/.test(mime)) throw new Error('图片格式不支持复制');
      if (window.parent !== window && location.protocol === 'beings:') {
        const data = await source.arrayBuffer(), requestId = crypto.randomUUID();
        const revision = new URLSearchParams(location.search).get('revision') || '';
        await new Promise<void>((resolve, reject) => {
          const receive = (event: MessageEvent) => {
            if (event.source !== window.parent || event.data?.type !== 'beings:image-copy-result' || event.data.id !== requestId || event.data.revision !== revision) return;
            cleanup(); event.data.ok ? resolve() : reject(new Error(typeof event.data.error === 'string' ? event.data.error : '复制图片失败'));
          };
          const timer = setTimeout(() => { cleanup(); reject(new Error('复制图片超时')); }, 5000);
          const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', receive); };
          window.addEventListener('message', receive);
          window.parent.postMessage({ type: 'beings:image-copy', id: requestId, revision, mime, data }, '*');
        });
      } else {
        if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('当前环境不支持复制图片');
        await navigator.clipboard.write([new ClipboardItem({ [mime]: source })]);
      }
      setMenu(null);
    } catch (error) { setCopyError(error instanceof Error ? error.message : '复制图片失败'); }
    finally { setCopying(false); }
  }
  // The menu is portaled so it is not clipped by the message list.
  return <>
    <button type="button" className="attachment-image-thumbnail" style={size && {
      '--attachment-preview-width': `${size.width}px`, '--attachment-preview-height': `${size.height}px`,
    } as CSSProperties} aria-label={`预览 ${name}`} onClick={event => open({ src, name, id, blob }, event.currentTarget)} onContextMenu={event => {
      event.preventDefault(); event.stopPropagation(); setCopyError(''); setMenu({ x: event.clientX, y: event.clientY });
    }}>
      <img src={src} alt={name} draggable={false} onLoad={event => {
        const image = event.currentTarget;
        rememberImageSize(endpoint, id, image.naturalWidth, image.naturalHeight);
        setSize(imagePreviewSize(endpoint, id));
        onImageLoad?.(image);
      }} />
    </button>
    {menu && createPortal(<div className="attachment-image-context-menu" role="menu" aria-label="图片操作"
      style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 168)), top: Math.max(8, Math.min(menu.y, window.innerHeight - 72)) }}
      onPointerDown={event => event.stopPropagation()}>
      <button type="button" role="menuitem" disabled={copying} onClick={() => void copyImage()}>{copying ? '复制图片中…' : '复制图片'}</button>
      {copyError && <p role="alert">{copyError}</p>}
    </div>, document.body)}
  </>;
}
