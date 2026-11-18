import { useEffect, useRef, useState } from 'react';
import { MAX_HOME_PREVIEW, type HomeFileEntry, type HomeFilesAPI } from '../../../shared/home';
import { FileTypeIcon } from '../../shared/components/file-type-icon';
import TiltedCard from '../../shared/components/react-bits/TiltedCard';
import { loadPdfDocument } from './pdf-document';
import styles from './home-library.module.scss';

export function HomeFileThumbnail({ file, api, onOpen }: { file: HomeFileEntry; api?: HomeFilesAPI; onOpen?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [thumbnail, setThumbnail] = useState<{ url: string; width: number; height: number }>();

  useEffect(() => {
    setThumbnail(undefined);
    const pdf = /\.pdf$/i.test(file.name);
    if (!api || file.size > MAX_HOME_PREVIEW || (!pdf && !/\.(png|jpe?g|gif|webp|avif)$/i.test(file.name))) return;

    let disposed = false;
    let objectUrl: string | undefined;
    let documentTask: ReturnType<typeof loadPdfDocument> | undefined;

    const load = async () => {
      const { bytes } = await api.preview(file.path);
      if (disposed) return;
      const canvas = document.createElement('canvas');
      // Keep only a 2x thumbnail in memory; opening the file still loads the original.
      if (pdf) {
        const pdfjs = await import('pdfjs-dist');
        if (disposed) return;
        documentTask = loadPdfDocument(pdfjs, new Uint8Array(bytes));
        const doc = await documentTask.promise;
        const page = await doc.getPage(1);
        if (disposed) return;
        const original = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(208 / original.width, 152 / original.height) });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, viewport }).promise;
      } else {
        const image = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
        if (disposed) { image.close(); return; }
        const scale = Math.min(1, 208 / image.width, 152 / image.height);
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
        image.close();
      }
      if (disposed) return;
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!disposed && blob) {
        objectUrl = URL.createObjectURL(blob);
        const scale = Math.min(104 / canvas.width, 76 / canvas.height);
        setThumbnail({ url: objectUrl, width: canvas.width * scale, height: canvas.height * scale });
      }
    };

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      void load().catch(() => {}).finally(() => {
        if (!disposed) {
          const loading = documentTask;
          documentTask = undefined;
          void loading?.destroy().catch(() => {});
        }
      });
    });
    observer.observe(host.current!);
    return () => {
      disposed = true;
      observer.disconnect();
      void documentTask?.destroy().catch(() => {});
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [api, file]);

  const fallback = <FileTypeIcon path={file.path} className={styles.fileTypeIcon} glyph="chat-file" />;
  const previewLabel = `预览缩略图：${file.name}`;
  return <div className={styles.thumbnail} ref={host}>
    {thumbnail ? <TiltedCard imageSrc={thumbnail.url} altText={file.name}
      captionText={previewLabel} containerWidth={104} containerHeight={76}
      imageWidth={thumbnail.width} imageHeight={thumbnail.height} radius={6} shadow={0.2} showTooltip={false} onClick={onOpen} />
      : onOpen ? <button type="button" className={styles.thumbnailPreview} aria-label={previewLabel} onClick={onOpen}>{fallback}</button> : fallback}
  </div>;
}
