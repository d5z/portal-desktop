import { useEffect, useRef, useState } from 'react';
import { MAX_HOME_PREVIEW, type HomeFileEntry, type HomeFilesAPI } from '../../../shared/home';
import { FileTypeIcon } from '../../shared/components/file-type-icon';
import TiltedCard from '../../shared/components/react-bits/TiltedCard';
import { loadPdfDocument } from './pdf-document';
import styles from './home-library.module.scss';

const pendingPreviews = new Map<Element, () => void>();
let thumbnailObserver: IntersectionObserver | undefined;

export function HomeFileThumbnail({ file, api, onOpen }: { file: HomeFileEntry; api?: HomeFilesAPI; onOpen?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [thumbnail, setThumbnail] = useState<{ url: string; width: number; height: number }>();
  const { name, path, size } = file;

  useEffect(() => {
    setThumbnail(undefined);
    const pdf = /\.pdf$/i.test(name);
    if (!api || size > MAX_HOME_PREVIEW || (!pdf && !/\.(png|jpe?g|gif|webp|avif)$/i.test(name))) return;
    const element = host.current!;
    let disposed = false;
    let objectUrl: string | undefined;
    let task: ReturnType<typeof loadPdfDocument> | undefined;

    const load = async () => {
      const { bytes } = await api.preview(path);
      if (disposed) return;
      let blob: Blob | null = new Blob([new Uint8Array(bytes)]);
      if (pdf) {
        const pdfjs = await import('pdfjs-dist');
        if (disposed) return;
        task = loadPdfDocument(pdfjs, new Uint8Array(bytes));
        const doc = await task.promise;
        const page = await doc.getPage(1);
        if (disposed) return;
        const original = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: 320 / Math.max(original.width, original.height) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, viewport }).promise;
        blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
      }
      if (disposed || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      const image = new Image();
      image.src = objectUrl;
      await image.decode();
      if (disposed) return;
      const scale = Math.min(104 / image.naturalWidth, 76 / image.naturalHeight);
      setThumbnail({ url: objectUrl, width: image.naturalWidth * scale, height: image.naturalHeight * scale });
    };

    thumbnailObserver ??= new IntersectionObserver((entries, observer) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const start = pendingPreviews.get(entry.target);
        pendingPreviews.delete(entry.target);
        observer.unobserve(entry.target);
        start?.();
      }
    });
    pendingPreviews.set(element, () => {
      void load().catch(() => { /* Keep the file icon if the preview is unavailable. */ }).finally(() => {
        const loading = task;
        task = undefined;
        void loading?.destroy().catch(() => {});
      });
    });
    thumbnailObserver.observe(element);

    return () => {
      disposed = true;
      pendingPreviews.delete(element);
      thumbnailObserver?.unobserve(element);
      const loading = task;
      task = undefined;
      void loading?.destroy().catch(() => {});
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [api, name, path, size]);

  const fallback = <FileTypeIcon path={path} className={styles.fileTypeIcon} glyph="chat-file" />;
  const previewLabel = `预览缩略图：${name}`;
  return <div className={styles.thumbnail} ref={host}>
    {api && thumbnail ? <TiltedCard imageSrc={thumbnail.url} altText={name} captionText={previewLabel}
      containerWidth={104} containerHeight={76} imageWidth={thumbnail.width} imageHeight={thumbnail.height}
      radius={6} shadow={0.2} showTooltip={false} onClick={onOpen} />
      : onOpen ? <button type="button" className={styles.thumbnailPreview} aria-label={previewLabel} onClick={onOpen}>{fallback}</button> : fallback}
  </div>;
}
