import { AttachmentDownload } from './attachment-download';
import { AnimatePresence } from 'motion/react';
import { CollapsibleMotion } from '../../shared/components/animate-ui/collapsible-motion';
import { useEffect, useRef, useState } from 'react';
import type { AttachmentPart } from '../services/attachment-messages';
import { parsedPage } from '../services/attachment-view';
function locationLabel(location: any, index: number) {
  if (Number.isFinite(location?.page)) return `第 ${location.page} 页`;
  if (Number.isFinite(location?.start_seconds)) {
    const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
    return `${time(location.start_seconds)}${Number.isFinite(location.end_seconds) ? ' – ' + time(location.end_seconds) : ''}`;
  }
  return `第 ${index + 1} 段`;
}
export function AttachmentDetails({part, endpoint}: {part: AttachmentPart; endpoint: string}) {
  const [open, setOpen] = useState(false), [segments, setSegments] = useState<any[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [report, setReport] = useState<string | undefined>(part.progress?.report?.artifact_id);
  const controller = useRef(new AbortController());
  const seen = useRef(new Set<string>());
  useEffect(() => { const current = new AbortController(); controller.current = current; return () => current.abort(); }, []);
  const load = async () => {
    if (busy || !part.parse_result_id) return;
    setBusy(true); setError('');
    try {
      const page = await parsedPage(endpoint, part.attachment_id, part.parse_result_id, loaded ? cursor : null, controller.current.signal);
      if (controller.current.signal.aborted) return;
      if (page.next_cursor && seen.current.has(page.next_cursor)) throw new Error('解析分页重复');
      if (page.next_cursor) seen.current.add(page.next_cursor);
      setSegments(old => [...old, ...page.segments]); setCursor(page.next_cursor); setLoaded(true);
      const artifact = page.artifacts?.find((a: any) => a.name === 'content.md' && /^[a-zA-Z0-9_-]{1,160}$/.test(a.artifact_id));
      if (artifact) setReport(artifact.artifact_id);
    } catch (e) { if (!controller.current.signal.aborted) setError(e instanceof Error ? e.message : '加载失败'); }
    finally { if (!controller.current.signal.aborted) setBusy(false); }
  };
  return <div className="attachment-details">
    <button type="button" role="menuitem" aria-expanded={open} onClick={() => { setOpen(!open); if (!open && !loaded) void load(); }}>{open ? '收起解析内容' : '查看解析内容'}</button>
    <AnimatePresence>{open && <CollapsibleMotion className="attachment-details-content">
      {segments.map((s, i) => <div className="attachment-segment" key={i}><small>{locationLabel(s.location, i)}</small><pre>{s.text}</pre></div>)}
      {error && <p role="alert">{error}</p>}
      {(!loaded || cursor) && <button type="button" disabled={busy} onClick={() => void load()}>{busy ? '正在读取…' : error ? '重试读取' : '继续查看'}</button>}
      {loaded && !cursor && <p>当前版本已全部显示</p>}
      {report && <AttachmentDownload endpoint={endpoint} id={part.attachment_id} artifact={report} name="content.md">下载完整解析文件</AttachmentDownload>}
    </CollapsibleMotion>}</AnimatePresence>
  </div>;
}
