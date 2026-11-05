import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { FileCard } from './file-card';
import { localFileReference } from '../../../shared/local-file';
import { checkLocalFile } from '../services/local-file-availability';

export const LocalFileAction = createContext<((path: string) => void) | undefined>(undefined);

export function LocalFileLink({ path, children, card = false, inlineCode = false }: { path: string; children: ReactNode; card?: boolean; inlineCode?: boolean }) {
  const preview = useContext(LocalFileAction);
  const [availability, setAvailability] = useState<{path:string;ready:boolean|null}>({ path: '', ready: null });
  const [check, setCheck] = useState(0);
  const version = useRef(0);
  const opening = useRef<{path:string}|null>(null);
  useEffect(() => {
    if (!preview) return;
    let active = true;
    const verify = () => {
      // A passive focus/ready check must not invalidate an explicit pending click.
      if(opening.current?.path===path)return;
      const ticket=++version.current;
      void checkLocalFile(path).then(ready => { if (active && ticket===version.current) setAvailability({ path, ready }); });
    };
    const invalidate = (event:MessageEvent) => {
      if(event.source===window.parent && event.data?.type==='beings:local-files-ready' && event.data.revision===new URLSearchParams(location.search).get('revision')){verify();return;}
      if(event.source!==window.parent || event.data?.type!=='beings:local-file-unavailable' || event.data.path!==path || event.data.revision!==new URLSearchParams(location.search).get('revision'))return;
      version.current++;setAvailability({path,ready:false});
    };
    verify();
    window.addEventListener('focus', verify);
    window.addEventListener('message', invalidate);
    return () => { active = false; version.current++;window.removeEventListener('focus', verify);window.removeEventListener('message', invalidate); };
  }, [path, preview, check]);
  const name = path.split(/[\\/]/).pop() || path;
  if (!preview || availability.path !== path || !availability.ready) {
    const value = inlineCode ? children : card ? name : children;
    return <span onPointerEnter={() => setCheck(value => value + 1)}>{value}</span>;
  }
  const open = async () => {
    if(opening.current?.path===path)return;
    const operation={path};opening.current=operation;
    const ticket=++version.current;
    try {
      const ready = await checkLocalFile(path, true);
      if(ticket!==version.current)return;
      setAvailability({ path, ready });
      if (ready===true) preview(path);
    } finally { if(opening.current===operation)opening.current=null; }
  };
  if (card) return <FileCard path={path} name={name} localPath={path} className="chat-local-file-card"
    title={`在客户端预览：${path}`} onOpen={() => void open()} />;
  return <button type="button" className="chat-local-file-link" data-local-file={path}
    title={`在客户端预览：${path}`} onClick={() => void open()}>{children}<span aria-hidden="true"> ↗</span></button>;
}

export function requestLocalFilePreview(path: string) {
  const reference = localFileReference(path);
  if (reference) window.parent.postMessage({ type: 'beings:local-file-preview', path: reference,
    revision: new URLSearchParams(location.search).get('revision') }, '*');
}
