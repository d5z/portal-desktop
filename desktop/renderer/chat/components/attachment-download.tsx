import { Icon } from '../../shared/icons/icon';
import {AttachmentFileMenu} from './attachment-file-menu';
import {AttachmentAudioMenu} from './attachment-audio-menu';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {formatBytes} from '../../shared/lib/format-bytes';
export function AttachmentDownload({endpoint, id, artifact, name, children, file, details, compact=false, apiBase='', request=fetch, onPreview, onDownloaded}: {
  onDownloaded?:()=>void; onPreview?:()=>void; request?:typeof fetch; apiBase?:string; endpoint: string; id: string; artifact?: string; name: string; children: string; file?:{size:number;mime:string}; details?:ReactNode; compact?:boolean;
}) {
  const [activeAction,setActiveAction]=useState(''),[error,setError]=useState(''),[downloaded,setDownloaded]=useState(false);
  const [checking,setChecking]=useState(true);
  const [status,setStatus]=useState(''),[progress,setProgress]=useState({loaded:0,total:0});
  const busy=!!activeAction, downloading=activeAction==='download';
  const controller=useRef<AbortController | null>(null);
  const url=apiBase+'/api/local-downloads?'+new URLSearchParams({endpoint,id,...(artifact ? {artifact} : {})});
  useEffect(()=>{
    const pending=new AbortController();
    setChecking(true);setDownloaded(false);setStatus('');setError('');
    const check=()=>{void request(url,{signal:pending.signal}).then(r=>r.json()).then(value=>{if(!pending.signal.aborted)setDownloaded(value.downloaded===true);}).catch(()=>{}).finally(()=>{if(!pending.signal.aborted)setChecking(false);});};
    check();window.addEventListener('focus',check);
    return ()=>{pending.abort();controller.current?.abort();window.removeEventListener('focus',check);};
  },[url,request]);
  async function action(kind:string) {
    if(busy)return;
    const pending=new AbortController();controller.current=pending;setActiveAction(kind);setError('');setProgress({loaded:0,total:0});
    setStatus(kind==='download' ? '正在准备下载…' : '');
    try {
      const response=await request(url+'&action='+kind,{method:'POST',signal:pending.signal});
      if(!response.headers.get('Content-Type')?.includes('application/x-ndjson')) {
        const value=await response.json();
        if(value.downloaded===false)setDownloaded(false);
        if(!response.ok)throw new Error(value.error || '操作失败');
        if(value.cancelled)setStatus('已取消');
        return;
      }
      const reader=response.body!.getReader(),decoder=new TextDecoder();let buffer='',complete=false;
      try {
        for(;;){
          const chunk=await reader.read();buffer+=decoder.decode(chunk.value,{stream:!chunk.done});let end;
          while((end=buffer.indexOf('\n'))>=0){
            const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line)continue;
            const event=JSON.parse(line);
            if(event.type==='error')throw new Error(event.error);
            if(event.type==='progress'){setProgress(event);setStatus(event.total && event.loaded>=event.total ? '正在校验下载文件…' : '正在下载');}
            if(event.type==='complete'){complete=true;setDownloaded(true);setStatus('已下载 · 校验通过');onDownloaded?.();}
          }
          if(chunk.done)break;
        }
        if(!complete)throw new Error('下载中断，请重试');
      } finally {await reader.cancel().catch(()=>{});}
    } catch(e){setStatus(kind==='download' ? (pending.signal.aborted ? '已取消下载' : '下载失败') : '');if(!pending.signal.aborted)setError(e instanceof Error ? e.message : '操作失败');}
    finally{if(controller.current===pending){controller.current=null;setActiveAction('');}}
  }
  const extension=name.split('.').pop()?.toLowerCase() || '';
  const fileType=({docx:'Word',doc:'Word',txt:'Text',md:'Text'} as Record<string,string>)[extension] || extension.toUpperCase();
  const codeFile=['txt','md','csv','json'].includes(extension);
  const primary=downloaded ? '打开' : '下载';
  const canPreview=downloaded && !!onPreview;
  const cardAction=checking ? '正在检查本地文件' : canPreview ? '在右侧预览' : downloaded ? '使用系统应用打开' : '下载';
  return <div className="attachment-download">
    {compact ? <AttachmentAudioMenu name={name}>
      {details}
      <button type="button" disabled={busy || checking} onClick={()=>void action(downloaded ? 'open' : 'download')}><Icon name={downloaded ? 'external-link' : 'download-tray'} fill="none" stroke="currentColor" strokeWidth="1.7" /><span>{primary}</span></button>
      {downloaded && <button type="button" disabled={busy} onClick={()=>void action('reveal')}><Icon name="folder" fill="none" stroke="currentColor" strokeWidth="1.7" /><span>打开所在位置</span></button>}
    </AttachmentAudioMenu> : file ? <div className="attachment-file-row">
      <button className="attachment-file-main" type="button" disabled={busy || checking} title={cardAction} aria-label={`${canPreview ? '预览' : primary} ${name}`} onClick={()=>canPreview ? onPreview!() : void action(downloaded ? 'open' : 'download')}>
        <span className="attachment-file-icon" aria-hidden="true">{codeFile ? <span className="attachment-code-icon">&lt;/&gt;</span> : <Icon name="file-text-tall" width="20" height="24" fill="none" />}</span>
        <span className="attachment-file-label"><strong>{name}</strong><small>{fileType} · {formatBytes(file.size)}</small></span>
        <span className="attachment-file-action" aria-hidden="true">{checking ? '…' : downloaded ? '↗' : '↓'}</span>
      </button>
      <AttachmentFileMenu name={name}>
        <button type="button" disabled={busy} onClick={()=>void action(downloaded ? 'open' : 'download')}>{primary}</button>
        {downloaded && <button type="button" disabled={busy} onClick={()=>void action('reveal')}>打开所在位置</button>}
        {details}
      </AttachmentFileMenu>
    </div> : <button type="button" disabled={busy || checking} onClick={()=>void action(downloaded ? 'open' : 'download')}>{checking ? '正在检查…' : downloaded ? '打开' : downloading ? '正在下载…' : children}</button>}
    {downloading && <button type="button" onClick={()=>controller.current?.abort()}>取消下载</button>}
    {status && <small role="status">{status}{downloading && progress.total ? ` · ${Math.min(99,Math.floor(progress.loaded / progress.total * 100))}% · ${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}` : ''}</small>}
    {downloading && <progress aria-label={`${name} 下载进度`} max={progress.total || undefined} value={progress.total ? progress.loaded : undefined} />}
    {error && <p role="alert">{error}</p>}
  </div>;
}
