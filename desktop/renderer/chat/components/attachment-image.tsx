import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
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

  return <ImageViewer src={image.src} name={image.name} onClose={onClose} appearance="attachment"
    navigation={items.length > 1 ? {
      index, total: items.length, thumbnails: { items, select: setIndex },
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
  useAttachmentDownloadBridge(endpoint, id);
  useEffect(() => register({ src, name, id, blob }), [register, src, name, id, blob]);
  return <button type="button" className="attachment-image-thumbnail" style={size && {
    '--attachment-preview-width': `${size.width}px`, '--attachment-preview-height': `${size.height}px`,
  } as CSSProperties} aria-label={`预览 ${name}`} onClick={event => open({ src, name, id, blob }, event.currentTarget)}>
    <img src={src} alt={name} draggable={false} onLoad={event => {
      const image = event.currentTarget;
      rememberImageSize(endpoint, id, image.naturalWidth, image.naturalHeight);
      setSize(imagePreviewSize(endpoint, id));
      onImageLoad?.(image);
    }} />
  </button>;
}
