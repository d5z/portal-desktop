import { Icon } from '../../shared/icons/icon';
import { ChatActionMenu } from './chat-action-menu';
import { AttachmentAudioMenu, type AudioMenuControls } from './attachment-audio-menu';
import { useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MessageAction, MessageActionSlot } from '../../shared/components/message-action-slot';
import { ErrorIndicator } from '../../shared/components/error-indicator';
import { FileName } from '../../shared/components/file-name';
import {formatBytes} from '../../shared/lib/format-bytes';
import { ChatStatusRow } from './status-row';
export function AttachmentDownload({endpoint, id, artifact, name, children, file, details, audioControls, iconOnly=false, apiBase='', request=fetch, onPreview, previewing, previewFailure, onDownloaded}: {
  onDownloaded?:()=>void; onPreview?:()=>void; request?:typeof fetch; apiBase?:string; endpoint: string; id: string; artifact?: string; name: string; children: string; file?:{size:number;mime:string;parseFailed?:boolean}; details?:ReactNode; audioControls?:AudioMenuControls; iconOnly?:boolean;
  previewing?: boolean; previewFailure?: { detail: string; run(): void };
}) {
  const compact = Boolean(audioControls);
  const slot = useContext(MessageActionSlot);
  const [menuGroup] = useState(() => file && slot ? document.createElement('div') : null);
  const menuTarget = slot?.menu;
  const registerExtraActions = slot?.registerExtraActions;
  const [downloaded,setDownloaded]=useState(false);
  const hasFileActions = !!file && (downloaded || !!details);
  useLayoutEffect(() => hasFileActions ? registerExtraActions?.() : undefined, [hasFileActions, registerExtraActions]);
  useLayoutEffect(() => {
    if (!hasFileActions || !menuGroup || !menuTarget) return;
    menuGroup.setAttribute('role', 'group');
    menuGroup.setAttribute('aria-label', name);
    menuTarget.appendChild(menuGroup);
    return () => menuGroup.remove();
  }, [hasFileActions, menuGroup, menuTarget, name]);
  const [activeAction,setActiveAction]=useState(''),[error,setError]=useState('');
  const [checking,setChecking]=useState(true);
  const [status,setStatus]=useState(''),[progress,setProgress]=useState({loaded:0,total:0});
  const busy=!!activeAction, downloading=activeAction==='download';
  const controller=useRef<AbortController | null>(null);
  const downloadCheck=useRef<AbortController | null>(null);
  const failedAction=useRef('download');
  const url=apiBase+'/api/local-downloads?'+new URLSearchParams({endpoint,id,...(artifact ? {artifact} : {})});
  useEffect(()=>{
    setChecking(true);setDownloaded(false);setStatus('');setError('');
    const check=()=>{
      downloadCheck.current?.abort();
      const pending=new AbortController();
      downloadCheck.current=pending;
      void request(url,{signal:pending.signal}).then(r=>r.json()).then(value=>{if(!pending.signal.aborted)setDownloaded(value.downloaded===true);}).catch(()=>{}).finally(()=>{if(!pending.signal.aborted)setChecking(false);});
    };
    const onFocus=()=>{if(!controller.current)check();};
    check();window.addEventListener('focus',onFocus);
    return ()=>{downloadCheck.current?.abort();controller.current?.abort();window.removeEventListener('focus',onFocus);};
  },[url,request]);
  async function action(kind:string) {
    if(busy)return;
    downloadCheck.current?.abort();
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
            if(event.type==='complete'){complete=true;setDownloaded(true);setStatus('已下载');onDownloaded?.();}
          }
          if(chunk.done)break;
        }
        if(!complete)throw new Error('下载中断，请重试');
      } finally {await reader.cancel().catch(()=>{});}
    } catch(e){setStatus(kind==='download' ? (pending.signal.aborted ? '已取消下载' : '下载失败') : '');if(!pending.signal.aborted){failedAction.current=kind;setError(e instanceof Error ? e.message : '操作失败');}}
    finally{if(controller.current===pending){controller.current=null;setActiveAction('');}}
  }
  const extension = (name.match(/.+\.([^.]+)$/)?.[1] || '').toUpperCase();
  const fileType = extension || '文件';
  const primary=downloaded ? '打开' : '下载';
  const imageAction = downloaded ? '打开' : children;
  const canPreview=downloaded && !!onPreview;
  const cardAction=checking ? '正在检查本地文件' : canPreview ? '在右侧预览' : downloaded ? '使用系统应用打开' : '下载';
  const feedback = error ? <ChatStatusRow title={status || '无法打开文件'} detail={file || compact ? `${name} · ${error}` : error} tone="error" inActions={!!(file || compact)}
    retry={{ label: failedAction.current === 'download' ? '重新下载' : failedAction.current === 'reveal' ? '重新打开所在文件夹' : '重新打开',
      disabled: busy || checking, run: () => void action(failedAction.current) }} />
    : previewFailure ? <ChatStatusRow title="暂时无法预览" detail={`${name} · ${previewFailure.detail}`} tone="error" inActions
      retry={{ label: '重新预览', run: previewFailure.run }} /> : null;
  const fileActions = hasFileActions && <>
    {canPreview && <button type="button" role="menuitem" disabled={busy || checking} onClick={()=>void action('open')}>
      <Icon name="chat-external-link" />用系统应用打开
    </button>}
    {downloaded && <button type="button" role="menuitem" disabled={busy} onClick={()=>void action('reveal')}>
      <Icon name="folder" />打开所在位置
    </button>}
    {details}
  </>;
  const progressBar = <div className="attachment-download-progress">
    <button type="button" aria-label="取消下载" title="取消下载" onClick={()=>controller.current?.abort()}>
      <Icon name="chat-close" width="16" height="16" />
    </button>
    {!iconOnly && <>
      <small role="status">{status}{progress.total > 0 && progress.loaded < progress.total
        ? ` · ${Math.min(99, Math.floor(progress.loaded / progress.total * 100))}%` : ''}</small>
      <progress aria-label={`${name} 下载进度`} max={progress.total || undefined} value={progress.total ? progress.loaded : undefined} />
    </>}
  </div>;
  return <div className="attachment-download">
    {audioControls ? <AttachmentAudioMenu name={name} controls={audioControls}>
      <button type="button" data-audio-menu-focus="download" disabled={busy || checking} onClick={()=>void action(downloaded ? 'open' : 'download')}><Icon name={downloaded ? 'chat-external-link' : 'chat-download'} /><span>{primary}</span></button>
      {downloaded && <button type="button" data-audio-menu-focus="location" disabled={busy} onClick={()=>void action('reveal')}><Icon name="folder" fill="none" stroke="currentColor" strokeWidth="1.7" /><span>打开所在位置</span></button>}
    </AttachmentAudioMenu> : file ? <div className="attachment-file-row">
      <button className="attachment-file-main" type="button" disabled={busy || checking || previewing} title={`${name} · ${fileType} · ${formatBytes(file.size)}\n${cardAction}`} aria-label={`${canPreview ? '预览' : primary} ${name}`} aria-description={`${fileType} · ${formatBytes(file.size)}`} onClick={()=>canPreview ? onPreview!() : void action(downloaded ? 'open' : 'download')}>
        <span className="attachment-file-icon" aria-hidden="true"><Icon name="chat-file" width="20" height="20" /></span>
        <span className="attachment-file-label"><FileName name={name} /><small className="attachment-file-metadata">{fileType} · {formatBytes(file.size)}</small></span>
      </button>
      {hasFileActions && (menuGroup ? createPortal(<><strong title={name}>{name}</strong>{fileActions}</>, menuGroup)
        : <ChatActionMenu label={`${name} 文件操作`}>{fileActions}</ChatActionMenu>)}
      {!feedback && file.parseFailed && <span className="attachment-file-feedback">
        <ErrorIndicator description={`解析失败 · ${name} · 可以下载原件查看。`} />
      </span>}
    </div> : iconOnly ? <button type="button" disabled={busy || checking} aria-busy={busy || checking} aria-label={imageAction} title={imageAction}
      onClick={()=>void action(downloaded ? 'open' : 'download')}>
      <Icon name={busy || checking ? 'chat-busy' : downloaded ? 'chat-external-link' : 'chat-download'} width="18" height="18" />
    </button> : <button type="button" disabled={busy || checking} onClick={()=>void action(downloaded ? 'open' : 'download')}>{checking ? '正在检查…' : downloaded ? '打开' : children}</button>}
    {downloading && (file || compact ? <MessageAction>{progressBar}</MessageAction> : progressBar)}
    {!iconOnly && !downloading && !error && !previewFailure && (previewing || status) && (file || compact
      ? <MessageAction><small className="message-action-status" role="status">{previewing ? '正在准备预览…' : status}</small></MessageAction>
      : <small role="status">{status}</small>)}
    {feedback}
  </div>;
}
