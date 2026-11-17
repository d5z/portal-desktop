import { Icon } from '../../shared/icons/icon';
import { AttachmentAudioMenu, type AudioMenuControls } from './attachment-audio-menu';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {formatBytes} from '../../shared/lib/format-bytes';
import {FileName} from '../../shared/components/file-name';
import { MessageAction, MessageFileActions } from './message-action-row';
import { MessageError } from './message-error';
export function AttachmentDownload({endpoint, id, artifact, name, children, file, details, audioControls, iconOnly=false, apiBase='', request=fetch, onPreview, onDownloaded}: {
  onDownloaded?:()=>void; onPreview?:()=>void; request?:typeof fetch; apiBase?:string; endpoint: string; id: string; artifact?: string; name: string; children: string; file?:{size:number;mime:string}; details?:ReactNode; audioControls?:AudioMenuControls; iconOnly?:boolean;
}) {
  const [activeAction,setActiveAction]=useState(''),[error,setError]=useState(''),[downloaded,setDownloaded]=useState(false);
  const [checking,setChecking]=useState(true);
  const [status,setStatus]=useState(''),[progress,setProgress]=useState({loaded:0,total:0});
  const busy=!!activeAction, downloading=activeAction==='download';
  const inActions = !!(file || audioControls || iconOnly);
  const controller=useRef<AbortController | null>(null);
  const failedAction=useRef('download');
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
    } catch(e){setStatus(kind==='download' ? (pending.signal.aborted ? '已取消下载' : '下载失败') : '');if(!pending.signal.aborted){failedAction.current=kind;setError(e instanceof Error ? e.message : '操作失败');}}
    finally{if(controller.current===pending){controller.current=null;setActiveAction('');}}
  }
  const extension=name.split('.').pop()?.toLowerCase() || '';
  const fileType=extension.toUpperCase() || '文件';
  const primary=downloaded ? '打开' : '下载';
  const canPreview=downloaded && !!onPreview;
  const cardAction=checking ? '正在检查本地文件' : canPreview ? '在右侧预览' : downloaded ? '使用系统应用打开' : '下载';
  const imageAction = downloaded ? '打开原图' : children;
  const statusLabel = status + (downloading && progress.total ? ` · ${Math.min(99,Math.floor(progress.loaded / progress.total * 100))}% · ${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}` : '');
  return <div className="attachment-download">
    {audioControls ? <AttachmentAudioMenu name={name} controls={audioControls}>
      <button type="button" disabled={busy || checking} onClick={()=>void action(downloaded ? 'open' : 'download')}><Icon name={downloaded ? 'external-link' : 'download-tray'} fill="none" stroke="currentColor" strokeWidth="1.7" /><span>{primary}</span></button>
      {downloaded && <button type="button" disabled={busy} onClick={()=>void action('reveal')}><Icon name="folder" fill="none" stroke="currentColor" strokeWidth="1.7" /><span>打开所在位置</span></button>}
    </AttachmentAudioMenu> : file ? <div className="attachment-file-row">
      <button className="attachment-file-main" type="button" disabled={busy || checking} title={cardAction} aria-label={`${canPreview ? '预览' : primary} ${name}`} onClick={()=>canPreview ? onPreview!() : void action(downloaded ? 'open' : 'download')}>
        <span className="attachment-file-icon" aria-hidden="true"><Icon name="chat-file" width="18" height="18" strokeWidth="1.65" /></span>
        <span className="attachment-file-label"><FileName name={name} /><small>{fileType} · {formatBytes(file.size)}</small></span>
        <span className="attachment-file-action" aria-hidden="true">{checking ? '…' : downloaded ? '↗' : '↓'}</span>
      </button>
      {(downloaded || details) && <MessageFileActions name={name}>
        {canPreview && <button type="button" role="menuitem" disabled={busy} onClick={()=>void action('open')}><Icon name="chat-external-link" />用系统应用打开</button>}
        {downloaded && <button type="button" role="menuitem" disabled={busy} onClick={()=>void action('reveal')}><Icon name="folder" />打开所在位置</button>}
        {details}
      </MessageFileActions>}
    </div> : iconOnly ? <button type="button" className="attachment-download-icon" disabled={busy || checking}
      aria-label={imageAction} title={imageAction} onClick={()=>void action(downloaded ? 'open' : 'download')}>
      <Icon name={downloaded ? 'external-link' : 'chat-download'} width="16" height="16" />
    </button> : <button type="button" disabled={busy || checking} onClick={()=>void action(downloaded ? 'open' : 'download')}>{checking ? '正在检查…' : downloaded ? '打开' : downloading ? '正在下载…' : children}</button>}
    {inActions ? <MessageAction>
      {downloading && <div className="attachment-download-progress">
        <small role="status">{statusLabel}</small>
        <progress aria-label={`${name} 下载进度`} max={progress.total || undefined} value={progress.total ? progress.loaded : undefined} />
        <button type="button" onClick={()=>controller.current?.abort()}>取消下载</button>
      </div>}
      {!downloading && !error && status && <small className="message-action-status" role="status">{status}</small>}
      {error && <MessageError reason={`${name} · ${error}`} disabled={busy || checking}
        retryLabel={failedAction.current === 'download' ? '重新下载' : failedAction.current === 'reveal' ? '重新打开所在文件夹' : '重新打开'}
        retry={() => void action(failedAction.current)} />}
    </MessageAction> : <>
      {downloading && <button type="button" onClick={()=>controller.current?.abort()}>取消下载</button>}
      {status && <small role="status">{statusLabel}</small>}
      {downloading && <progress aria-label={`${name} 下载进度`} max={progress.total || undefined} value={progress.total ? progress.loaded : undefined} />}
      {error && <p role="alert">{error}</p>}
    </>}
  </div>;
}
