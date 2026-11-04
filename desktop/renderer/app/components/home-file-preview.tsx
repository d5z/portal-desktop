import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { HomeFilePreview } from '../../../shared/home';
import styles from './home-library.module.scss';
const Pdf = lazy(() => import('./pdf-preview').then(module => ({ default: module.PdfPreview })));
const Xlsx = lazy(() => import('./xlsx-preview').then(module => ({ default: module.XlsxPreview })));
const Pptx = lazy(() => import('./pptx-preview').then(module => ({ default: module.PptxPreview })));
const textExtensions = new Set(['txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'html', 'htm', 'css', 'js', 'ts', 'tsx', 'jsx', 'py', 'rs', 'yaml', 'yml', 'toml', 'xml', 'sh', 'log', 'svg']);
const imageTypes: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif' };
function Image({ blob, name }: { blob: Blob; name: string }) {
  const [url, setURL] = useState('');
  useEffect(() => { const url = URL.createObjectURL(blob); setURL(url); return () => URL.revokeObjectURL(url); }, [blob]);
  return url ? <img className={styles.image} src={url} alt={name} /> : null;
}
export function HomeFileContent({ file, source }: { file: HomeFilePreview; source: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const imageType = Object.hasOwn(imageTypes, extension) ? imageTypes[extension] : undefined;
  const blob = useMemo(() => imageType || ['pdf', 'xlsx', 'pptx'].includes(extension)
    ? new Blob([new Uint8Array(file.bytes)], { type: imageType || 'application/octet-stream' }) : undefined, [file, extension, imageType]);
  const text = useMemo(() => textExtensions.has(extension) ? new TextDecoder().decode(file.bytes) : '', [file, extension]);
  const html = extension === 'html' || extension === 'htm';
  return <>
    {html && !source ? <iframe ref={frame} className={styles.html} title="云端 HTML 预览" sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads" referrerPolicy="no-referrer" src="beings://preview/runtime.html" onLoad={() => frame.current?.contentWindow?.postMessage({ type: 'home:html-preview', html: text }, '*')} /> :
      <div className={styles.previewBody}><Suspense fallback={<div className={styles.previewLoading} role="status"><span aria-hidden="true" /><span>正在加载预览…</span></div>}>
        {blob ? (imageType ? <Image blob={blob} name={file.name} /> : extension === 'pdf' ? <Pdf blob={blob} /> : extension === 'xlsx' ? <Xlsx blob={blob} /> : <Pptx blob={blob} />) : textExtensions.has(extension) ? <pre>{text}</pre> : <p>暂不支持此格式的在线预览，请下载后查看。</p>}
      </Suspense></div>}
  </>;
}
