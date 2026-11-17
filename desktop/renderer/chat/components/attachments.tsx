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
    }).catch(() => { if (!controller.signal.aborted) setPreviewError('图片预览暂不可用，可下载原件'); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [endpoint, part.attachment_id, image, localImage]);
  if(/^audio\//.test(part.mime))return <section className="attachment-audio-card" aria-label={part.name}><div className="attachment-audio-filename" title={part.name}>{part.name}</div>
    <AttachmentAudio src={attachmentContentURL(endpoint,part.attachment_id,true)} name={part.name} endpoint={endpoint} id={part.attachment_id}/>
    {part.parse_result_id && <div className="attachment-audio-transcript"><AttachmentTranscript part={part} endpoint={endpoint}/></div>}
    {part.parse_status==='failed' && <p className="attachment-error" role="alert">解析失败，请重试</p>}
  </section>;
  if (image) return <section className="attachment-image-card" aria-label={part.name}>
    {(localImage?.src || preview) ? <AttachmentImage blob={localImage?.blob || imageBlob} src={localImage?.src || preview} name={part.name} endpoint={endpoint} id={part.attachment_id} onImageLoad={(img)=>rememberImageSize(endpoint,part.attachment_id,img.naturalWidth,img.naturalHeight)}/> : <div className={`attachment-image-placeholder${previewError ? "" : " attachment-image-skeleton"}`} style={imagePreviewSize(endpoint,part.attachment_id)} role="status" aria-label={previewError || `正在加载图片 ${part.name}`} aria-busy={!previewError}>{previewError || null}</div>}
    {!localImage && previewError && <AttachmentDownload endpoint={endpoint} id={part.attachment_id} name={part.name}>下载原图</AttachmentDownload>}
  </section>;
  return <section className="attachment-card attachment-file-card" aria-label={part.name}>
    {part.parse_status==='failed' && <p className="attachment-error" role="alert">解析失败，可重试或下载原件</p>}

    <AttachmentFilePreview part={part} endpoint={endpoint}/>
  </section>;
}
