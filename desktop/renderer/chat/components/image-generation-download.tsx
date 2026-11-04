import { Icon } from '../../shared/icons/icon';
import { useEffect, useRef, useState } from 'react';
import { MAX_REMOTE_IMAGE_BYTES, REMOTE_IMAGE_MIME, remoteImageName, remoteImageSource } from '../../../shared/remote-image';

/** A sibling of the preview button, so saving never opens the image viewer. */
export function ImageGenerationDownload({src, name}: {src:string; name:string}) {
  const pending = useRef<AbortController | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => () => { pending.current?.abort(); }, [src]);
  async function download() {
    if (pending.current) return;
    const controller = new AbortController(); pending.current = controller;
    setSaving(true); setFailed(false);
    try {
      const response = await fetch(remoteImageSource(src, location.protocol === 'beings:'), {
        signal:AbortSignal.any([controller.signal, AbortSignal.timeout(65000)]), credentials:'omit',
      });
      if (!response.ok || Number(response.headers.get('content-length')) > MAX_REMOTE_IMAGE_BYTES) throw new Error('Download unavailable');
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      if (!blob.size || !REMOTE_IMAGE_MIME.test(blob.type) || blob.size > MAX_REMOTE_IMAGE_BYTES) throw new Error('Invalid image');
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = remoteImageName(name, blob.type);
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) setSaving(false);
    }
  }
  return <button type="button" className="image-generation-download" data-busy={saving} data-failed={failed}
    aria-label={`下载原图 ${name}`} aria-busy={saving} disabled={saving}
    title={failed ? '下载失败，点击重试' : '下载原图'}
    onClick={event => { event.preventDefault(); event.stopPropagation(); void download(); }}>
    <Icon name="download" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    <span role="status">{saving ? '下载中…' : failed ? '重试下载' : '下载'}</span>
  </button>;
}
