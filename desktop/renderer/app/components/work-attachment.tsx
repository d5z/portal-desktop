import { useEffect, useState } from 'react';
import { workImageMime, type WorkAttachment } from '../../../shared/work-attachments';
import { ImageViewer } from '../../shared/components/image-viewer';
import { IconButton } from '../../shared/components/icon-button';
import { Icon } from '../../shared/icons/icon';
import { workExecutors } from '../models/work-executors';
import styles from './work.module.scss';

export function WorkAttachmentTile({ source, endpoint, executor, sessionId, remove, disabled, inline }: {
  source: File | WorkAttachment; endpoint: string; executor?: string; sessionId?: string; remove?(): void; disabled?: boolean; inline?: boolean;
}) {
  const [src, setSrc] = useState<string | null>();
  const [open, setOpen] = useState(false);
  const image = source instanceof File ? workImageMime.test(source.type) : source.type !== 'file';
  useEffect(() => {
    setSrc(undefined);
    if (!image) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    const blobUrl = (blob: Blob) => {
      if (controller.signal.aborted) return null;
      objectUrl = URL.createObjectURL(blob);
      return objectUrl;
    };
    const load = async (): Promise<string | null> => {
      if (source instanceof File) return blobUrl(source);
      if (source.type === 'image') return /^data:image\/(png|jpeg|webp|gif);base64,/i.test(source.src) ? source.src : null;
      if (source.type === 'localImage' && /\.(png|jpe?g|webp|gif)$/i.test(source.path)) {
        const preview = await window.beings.previewLocalFile?.(source.path);
        if (preview) void window.beings.releaseLocalFilePreview?.(preview.id);
        if (preview?.bytes && preview.mime && workImageMime.test(preview.mime)) {
          return blobUrl(new Blob([new Uint8Array(preview.bytes)], { type: preview.mime }));
        }
      } else if (source.type === 'executorImage' && executor && sessionId) {
        return await workExecutors(endpoint)[executor]?.readImage?.(sessionId, source.reference, controller.signal) ?? null;
      }
      return null;
    };
    void load().catch(() => null).then(url => { if (!controller.signal.aborted) setSrc(url); });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source, image, endpoint, executor, sessionId]);
  const name = source.name || '图片';
  return <span className={inline ? `${styles.attachmentTile} ${styles.inlineAttachment}` : styles.attachmentTile} data-image={image}>
    {src ? <button type="button" className={styles.attachmentPreview} aria-label={`预览图片：${name}`} onClick={() => setOpen(true)}>
      <img src={src} alt={name} draggable={false} loading={remove ? 'eager' : 'lazy'} onError={() => setSrc(null)} />
    </button> : <span className={styles.attachmentName} title={name}>
      <Icon name="chat-file" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <span>{name}{image && src === null && !remove ? ' · 无法预览' : ''}</span>
    </span>}
    {remove && <IconButton label={`移除 ${name}`} className={styles.removeAttachment} disabled={disabled} onClick={remove}>
      <Icon name="chat-close" width="13" height="13" />
    </IconButton>}
    {open && src && <ImageViewer src={src} name={name} actions={null} onClose={() => setOpen(false)} />}
  </span>;
}
