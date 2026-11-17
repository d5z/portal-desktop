import { useEffect, useRef, useState } from 'react';
import { MAX_HOME_PREVIEW, type HomeFileEntry, type HomeFilesAPI } from '../../../shared/home';
import { FileTypeIcon } from '../../shared/components/file-type-icon';
import { loadPdfDocument } from './pdf-document';
import styles from './home-library.module.scss';

const pendingPreviews = new Map<Element, () => void>();
let thumbnailObserver: IntersectionObserver | undefined;

export function HomeFileThumbnail({ file, api }: { file: HomeFileEntry; api?: HomeFilesAPI }) {
  const host = useRef<HTMLDivElement>(null);
  const [thumbnail, setThumbnail] = useState<string>();
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
      setThumbnail(objectUrl);
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

  return <div className={styles.thumbnail} ref={host} aria-hidden="true">
    {api && thumbnail ? <img src={thumbnail} alt="" decoding="async" onError={() => setThumbnail(undefined)} />
      : <FileTypeIcon path={path} className={styles.fileTypeIcon} glyph="chat-file" />}
  </div>;
}
