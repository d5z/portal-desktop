import { IconButton } from '../../shared/components/icon-button';
import { Icon } from '../../shared/icons/icon';
import { localFileReference } from '../../../shared/local-file';
import { checkLocalFiles } from '../services/local-file-check';
import { revealLocalFile } from '../services/local-file-reveal';
import { FilePreviewPanel, FilePreviewModes } from './file-preview-panel';
import {attachmentPreviewRequest} from '../services/attachment-preview-request';
import {XlsxPreview} from './xlsx-preview';
import {PdfPreview} from './pdf-preview';
import {useEffect,useState,useCallback,useRef,type RefObject} from 'react';
import {PptxPreview} from './pptx-preview';
import {AttachmentDownload} from '../../chat/components/attachment-download';
import {Markdown} from '../../shared/components/markdown';
import {validFilePreview} from '../lib/file-preview-data';
import { TextFile, FileImage } from './file-preview-content';
type FileView={id:string;name:string;extension:string;blob?:Blob;text?:string;segments?:{label:string;text:string}[];endpoint:string;path?:string;url?:string};
export function AttachmentFileViewer({frame}:{frame:RefObject<HTMLIFrameElement|null>}) {
  const [file,setFile]=useState<FileView|null>(null);
  const [localPath,setLocalPath]=useState<string|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[source,setSource]=useState(false);
  const [revealError,setRevealError]=useState('');
  const sequence=useRef(0);
  const loadLocal=useCallback(async(path:string)=>{
    const ticket=++sequence.current;
    const available=await checkLocalFiles(window.beings,[path]);
    if(ticket!==sequence.current)return;
    if(available?.[0]!==true){
      setFile(null);setLocalPath(null);setBusy(false);setError('');
      const target=frame.current;
      if(available[0]===false && target?.src)target.contentWindow?.postMessage({type:'beings:local-file-unavailable',path,revision:new URL(target.src).searchParams.get('revision')},'beings://chat');
      return;
    }
    setLocalPath(path);setFile(null);setError('');setBusy(true);setSource(false);
    setRevealError('');
    try {
      if(!window.beings.previewLocalFile)throw new Error('当前客户端不支持本地文件预览。');
      const result=await window.beings.previewLocalFile(path);
      if(ticket!==sequence.current){void window.beings.releaseLocalFilePreview?.(result.id);return;}
      setFile({...result,endpoint:'',blob:result.bytes ? new Blob([new Uint8Array(result.bytes)],{type:result.mime}) : undefined});
      setLocalPath(result.path);
    }catch{if(ticket===sequence.current)setError('文件已不存在、无法读取或不支持预览。');}
    finally{if(ticket===sequence.current)setBusy(false);}
  },[frame]);
  useEffect(()=>()=>{sequence.current++;},[]);
  useEffect(()=>{if(!file?.path)return;const id=file.id;return()=>{void window.beings.releaseLocalFilePreview?.(id);};},[file?.id,file?.path]);
  const close=useCallback(()=>{sequence.current++;setFile(null);setLocalPath(null);setBusy(false);setError('');frame.current?.focus();},[frame]);
  useEffect(()=>{
    const receive=(event:MessageEvent)=>{
      const target=frame.current,data=event.data;
      if(!target?.src || event.source!==target.contentWindow || event.origin!=='beings://chat' || !['beings:file-preview','beings:local-file-preview','beings:local-files-check'].includes(data?.type))return;
      const source=new URL(target.src);
      if(data.revision!==source.searchParams.get('revision'))return;
      if(data.type==='beings:local-files-check'){
        if(typeof data.id!=='string' || data.id.length>64 || !Array.isArray(data.paths) || data.paths.length>64 || !data.paths.every((path:unknown)=>typeof path==='string' && path.length<=4096))return;
        void checkLocalFiles(window.beings,data.paths).then(available=>{
          if(frame.current===target && target.src===source.href)target.contentWindow?.postMessage({type:'beings:local-files-checked',id:data.id,revision:data.revision,available},'beings://chat');
        });return;
      }
      if(data.type==='beings:local-file-preview'){const path=localFileReference(data.path);if(path){void loadLocal(path);}return;}
      if(!validFilePreview(data))return;
      sequence.current++;setLocalPath(null);setBusy(false);setError('');setSource(false);
      setFile({...data,endpoint:source.searchParams.get('history_scope') || ''});
    };
    window.addEventListener('message',receive);
    const target=frame.current;
    if(target?.src)target.contentWindow?.postMessage({type:'beings:local-files-ready',revision:new URL(target.src).searchParams.get('revision')},'beings://chat');
    return()=>{window.removeEventListener('message',receive);};
  },[frame,loadLocal]);
  const request=useCallback<typeof fetch>(async(input,init)=>{
    const target=frame.current;if(!target?.contentWindow || !file)throw new Error('对话已关闭');
    return attachmentPreviewRequest(target,file,input,init);
  },[frame,file]);
  const name=file?.name || localPath?.split(/[\\/]/).pop() || '';
  const html=!!file && ['html','htm'].includes(file.extension);
  const reveal=async()=>{
    if(!localPath)return;
    const ticket=sequence.current;
    const message=await revealLocalFile(window.beings,localPath);
    if(ticket===sequence.current)setRevealError(message);
  };
  return (file || localPath) && <FilePreviewPanel key={localPath || file?.id} name={name} path={localPath || undefined} onClose={close}
    actions={localPath ? <>
      {html && <FilePreviewModes source={source} onChange={setSource} />}
      <IconButton className="file-preview-icon" label="刷新" disabled={busy} onClick={()=>void loadLocal(localPath)}><Icon name="refresh-library" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" /></IconButton>
      {file && <IconButton className="file-preview-icon" label="打开所在文件夹" onClick={()=>void reveal()}><Icon name="directory" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" /></IconButton>}
    </> : undefined}>
    {file && !localPath && <div className="client-file-actions"><span>{file.segments?'内容预览 · 不保留原版排版':'原文件预览'}</span><AttachmentDownload key={JSON.stringify([file.endpoint,file.id])} request={request} endpoint={file.endpoint} id={file.id} name={file.name}>下载原件</AttachmentDownload></div>}
    {localPath && revealError && <div role="alert">{revealError}</div>}
    {busy && <div className="client-file-body" role="status">正在读取本地文件…</div>}
    {error && <div className="client-file-body" role="alert">{error}</div>}
    {file && (html && !source ? <iframe key={file.id} title="HTML 文件预览" sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads" referrerPolicy="no-referrer" src={file.url}/> :
      file.blob?.type.startsWith('image/') ? <FileImage blob={file.blob} name={file.name}/> :
      file.extension==='xlsx'?<XlsxPreview key={file.id} blob={file.blob!}/>:file.extension==='pptx'?<PptxPreview key={file.id} blob={file.blob!}/>:file.extension==='pdf'?<PdfPreview key={file.id} blob={file.blob!}/>:<div className="client-file-body">{file.segments?file.segments.map((s,i)=><section key={i}>{s.label && <h3>{s.label}</h3>}<Markdown content={s.text} intelligentUI={false}/></section>):<TextFile extension={file.extension} text={file.text || ''}/>}</div>)}
  </FilePreviewPanel>;
}
