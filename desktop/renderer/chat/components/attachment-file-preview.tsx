import {useEffect,useRef,useState} from 'react';
import type {AttachmentPart} from '../services/attachment-messages';
import {parsedPage} from '../services/attachment-view';
import {AttachmentDownload} from './attachment-download';
import {AttachmentDetails} from './attachment-details';
import {useAttachmentDownloadBridge} from './use-attachment-download-bridge';
import { postFilePreview } from '../../shared/services/file-preview-bridge';
export function AttachmentFilePreview({part,endpoint}:{part:AttachmentPart;endpoint:string}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const controller=useRef(new AbortController());
  useEffect(()=>{const current=new AbortController();controller.current=current;return()=>current.abort();},[]);
  useAttachmentDownloadBridge(endpoint,part.attachment_id);
  const extension=part.name.split('.').pop()?.toLowerCase() || '';
  const supported=['pdf','txt','md','csv','json','docx','xlsx','pptx'].includes(extension);
  async function preview() {
    if(busy)return;
    const opener = document.activeElement as HTMLElement | null;
    setBusy(true);setError('');
    try {
      let blob:Blob|undefined,text:string|undefined,segments:{text:string;label:string}[]|undefined;
      if(extension==='docx') {
        if(!part.parse_result_id)throw new Error(part.parse_status==='failed'?'附件解析失败，请下载原件查看':'附件仍在解析，请稍后查看');
        segments=[];let cursor:string|null=null;const seen=new Set<string>();let total=0;
        do {
          const page=await parsedPage(endpoint,part.attachment_id,part.parse_result_id,cursor,controller.current.signal);
          for(const segment of page.segments){total+=segment.text.length;if(total>8_000_000)throw new Error('内容过大，请下载完整解析文件或原件查看');segments.push({text:segment.text,label:segment.location?.page ? `第 ${segment.location.page} 页` : ''});}
          cursor=page.next_cursor;
          if(cursor){if(seen.has(cursor)||seen.size>=200)throw new Error('解析内容分页异常，请下载原件查看');seen.add(cursor);}
        }while(cursor);
      } else {
        if(!['pdf','pptx','xlsx'].includes(extension) && part.size>2*1024*1024)throw new Error('文本超过 2 MB，请下载原件查看');
        const response=await fetch('/api/local-downloads?'+new URLSearchParams({endpoint,id:part.attachment_id,action:'content'}),{signal:controller.current.signal});
        if(!response.ok){window.dispatchEvent(new Event('focus'));throw new Error(response.status===409?'本地文件已移动、删除或发生变化，请重新下载':'无法读取本地文件，请重试');}
        if(extension==='xlsx'){blob=new Blob([await response.blob()],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});}else if(extension==='pptx'){blob=new Blob([await response.blob()],{type:'application/vnd.openxmlformats-officedocument.presentationml.presentation'});}else if(extension==='pdf'){
          blob=await response.blob();
          if(!((await blob.slice(0,5).text()).startsWith('%PDF-')))throw new Error('文件不是有效的 PDF');
          blob=new Blob([blob],{type:'application/pdf'});
        }else text=await response.text();
      }
      postFilePreview({type:'beings:file-preview',id:part.attachment_id,name:part.name,endpoint,extension,blob,text,segments}, opener);
    }catch(e){if(!controller.current.signal.aborted)setError(e instanceof Error?e.message:'预览失败');}
    finally{if(!controller.current.signal.aborted)setBusy(false);}
  }
  return <AttachmentDownload onDownloaded={() => setError('')} endpoint={endpoint} id={part.attachment_id} name={part.name}
    file={{ size: part.size, mime: part.mime, parseFailed: part.parse_status === 'failed' }}
    onPreview={supported ? () => void preview() : undefined} previewing={busy}
    previewFailure={error ? { detail: error, run: () => void preview() } : undefined}
    details={part.parse_result_id ? dismissMenu => <AttachmentDetails key={JSON.stringify([endpoint,part.attachment_id,part.parse_result_id])}
      part={part} endpoint={endpoint} dismissMenu={dismissMenu} /> : undefined}>
    下载原件
  </AttachmentDownload>;
}
