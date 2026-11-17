import type {Message} from '../models/chat';
import {attachmentProgress} from './attachments';
export function attachmentProcessing(message: Message) {
  if(!message.queued || message.retry || !(message.attachmentUploads?.length || message.attachmentViews?.length))return null;
  if(message.attachmentUploads?.some(file=>file.progress?.phase==='failed'))return null;
  const parts=message.attachmentViews?.flatMap(view=>view.parts.filter(part=>part.type==='attachment')) || [];
  const uploading=message.attachmentUploads?.some(file=>file.progress?.phase!=='complete') && !parts.length;
  const parsing=!parts.length && !uploading || parts.some(part=>!['ready','failed','unavailable'].includes(part.parse_status));
  const active=parts.find(part=>!['ready','failed','unavailable'].includes(part.parse_status));
  if(!uploading && !parsing)return null;
  // Upload state and its progress already live on each attachment.
  if (uploading && message.attachmentUploads?.some(file => file.progress)) return null;
  const label=uploading ? '等待发送' : active?.parse_status === 'receiving' ? '正在接收附件'
    : active?.parse_status === 'uploaded' ? '等待解析' : '正在解析附件';
  const uploads=message.attachmentUploads || [];
  const total=parts.length || uploads.length;
  const completed=parts.length ? parts.filter(part=>part.parse_status==='ready').length : uploading ? uploads.filter(file=>file.progress?.phase==='complete').length : 0;
  const filename=active?.name || uploads.find(file=>file.progress?.phase!=='complete')?.name;
  const card = parts.length > 1 && active && !active.mime.startsWith('image/') ? active : undefined;
  return { part: card, content: <div className="attachment-processing-status" role="status">
    <span className="attachment-status-spinner" aria-hidden="true" />
    <span title={[filename, active && attachmentProgress(active)].filter(Boolean).join(' · ')}>
      {label}{total > 1 && ` · ${completed}/${total}`}
      {total === 1 && !!active?.progress?.total && ` · ${active.progress.completed}/${active.progress.total}${active.progress.unit ? ` ${active.progress.unit === 'page' ? '页' : '段'}` : ''}`}
    </span>
  </div> };
}
