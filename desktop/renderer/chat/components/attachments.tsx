import {AttachmentTranscript} from './attachment-transcript';
import {imagePreviewSize,rememberImageSize} from '../services/image-preview-size';
import {AttachmentFilePreview} from './attachment-file-preview';
import { AttachmentImage } from './attachment-image';
import { AttachmentAudio } from './attachment-audio';
import { AttachmentDownload } from './attachment-download';
import { useEffect, useState } from 'react';
import type { AttachmentPart } from '../services/attachment-messages';
import { attachmentContentURL } from '../services/attachment-view';
import { useNearViewport } from '../../shared/hooks/use-near-viewport';
import { MessageAction } from '../../shared/components/message-action-slot';
import { MessageError } from './message-error';
export function attachmentProgress(part: AttachmentPart) {
  const p = part.progress;
  if (part.parse_status === 'ready') return '解析完成';
  if (part.parse_status === 'failed') return '解析失败';
  if (p?.stage === 'assembling') return '正在整理完整结果';
  if (p && Number.isFinite(p.completed)) return `已处理 ${p.completed}${Number.isFinite(p.total) ? ` / ${p.total}` : ''} ${p.unit === 'page' ? '页' : '段'}`;
  return ({receiving:'正在接收', uploaded:'已上传，等待解析', parsing:'正在解析', unavailable:'附件不可用'} as Record<string,string>)[part.parse_status] || '等待处理';
}
export function AttachmentCard({part, endpoint, localImage}: {part: AttachmentPart; endpoint: string; localImage?:{src:string;blob:Blob}}) {
  const { ref, ready } = useNearViewport<HTMLDivElement>(!!localImage);
  return <div ref={ref} className="attachment-card-host">{ready ? <LoadedAttachmentCard part={part} endpoint={endpoint} localImage={localImage} />
    : part.mime.startsWith('image/') ? <div className="attachment-image-placeholder attachment-image-skeleton" style={imagePreviewSize(endpoint, part.attachment_id)} role="status" aria-label={`图片 ${part.name}`} aria-busy="true" />
      : <div className="attachment-deferred">{part.name}</div>}</div>;
}
function LoadedAttachmentCard({part, endpoint, localImage}: {part: AttachmentPart; endpoint: string; localImage?:{src:string;blob:Blob}}) {
  const [imageBlob,setImageBlob]=useState<Blob>();
  const [preview, setPreview] = useState(''), [previewError, setPreviewError] = useState('');
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const image = /^image\/(png|jpeg|gif|webp)$/.test(part.mime);
  useEffect(() => {
    if (!image || localImage) return;
    const controller = new AbortController(); let url = '';
    void fetch(attachmentContentURL(endpoint, part.attachment_id, true), {signal:controller.signal}).then(async r => {
      if (!r.ok || !/^image\/(png|jpeg|gif|webp)$/.test(r.headers.get('content-type') || '')) throw new Error('图片预览暂不可用');
      const blob = await r.blob(); if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob);
      // Decode before swapping the skeleton, so the image never has zero height.
      const decoded=new Image();decoded.src=url;await decoded.decode();
      if(controller.signal.aborted)return;
      rememberImageSize(endpoint,part.attachment_id,decoded.naturalWidth,decoded.naturalHeight);
      setImageBlob(blob); setPreview(url);
    }).catch(() => { if (!controller.signal.aborted) setPreviewError('图片预览暂不可用'); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [endpoint, part.attachment_id, image, localImage, previewAttempt]);
  if(/^audio\//.test(part.mime))return <section className="attachment-audio-card" aria-label={part.name}><div className="attachment-audio-filename" title={part.name}>{part.name}</div>
    <AttachmentAudio src={attachmentContentURL(endpoint,part.attachment_id,true)} name={part.name} endpoint={endpoint} id={part.attachment_id}/>
    {part.parse_result_id && <div className="attachment-audio-transcript"><AttachmentTranscript part={part} endpoint={endpoint}/></div>}
    {part.parse_status==='parsing' && <div className="attachment-audio-caption" role="status">正在转写</div>}
    {part.parse_status === 'failed' && <MessageAction><MessageError reason={`无法生成语音转录 · ${part.name}`} /></MessageAction>}
  </section>;
  if (image) return <section className="attachment-image-card" aria-label={part.name}>
    {(localImage?.src || preview) ? <AttachmentImage blob={localImage?.blob || imageBlob} src={localImage?.src || preview} name={part.name} endpoint={endpoint} id={part.attachment_id} onImageLoad={(img)=>rememberImageSize(endpoint,part.attachment_id,img.naturalWidth,img.naturalHeight)}/>
      : previewError ? <div className="attachment-image-failure" style={imagePreviewSize(endpoint,part.attachment_id)}>
        <MessageAction>
          <MessageError reason={`${previewError} · ${part.name}`} retryLabel="重新加载图片"
            retry={() => { setPreviewError(''); setPreviewAttempt(n => n + 1); }} />
          <AttachmentDownload iconOnly endpoint={endpoint} id={part.attachment_id} name={part.name}>下载原图</AttachmentDownload>
        </MessageAction>
      </div>
      : <div className="attachment-image-placeholder attachment-image-skeleton" style={imagePreviewSize(endpoint,part.attachment_id)} role="status" aria-label={`正在加载图片 ${part.name}`} aria-busy="true" />}
  </section>;
  return <section className="attachment-card attachment-file-card" aria-label={part.name}>
    {part.parse_status === 'failed' && <MessageAction><MessageError reason={`解析失败，可下载原件 · ${part.name}`} /></MessageAction>}

    <AttachmentFilePreview part={part} endpoint={endpoint}/>
  </section>;
}
