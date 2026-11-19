import {AttachmentImageUpload} from './attachment-image-upload';
import {attachmentProcessing} from './attachment-processing';
import {formatBytes} from '../../shared/lib/format-bytes';
import { Fragment, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import type { Message } from '../models/chat';
import { attachmentMessageReader, messageReferences, type AttachmentMessage } from '../services/attachment-messages';
import { viewRequest } from '../services/attachment-view';
import { AttachmentCard } from './attachments';
import { AttachmentImageGallery } from './attachment-image';
import { useNearViewport } from '../../shared/hooks/use-near-viewport';
import { CommandMessageText } from './command-message';
import { ChatStatusRow } from './status-row';
import { MessageImageGroup } from '../../shared/components/message-image-group';
import { FileName } from '../../shared/components/file-name';
import { Icon } from '../../shared/icons/icon';
import { MessageCaptionAnchor } from '../../shared/components/message-action-slot';
const delivery = {unknown:'发送结果待确认，请核对历史', failed:'发送失败', cancelled:'已取消'} as const;
export const isPreviewImage = (mime = '') => /^image\/(png|jpeg|gif|webp)$/.test(mime);

function renderAttachmentRuns<T>(items: T[], isImage: (item: T) => boolean, render: (item: T, index: number) => ReactNode) {
  const result: ReactNode[] = [];
  for (let index = 0; index < items.length;) {
    const start = index++;
    if (isImage(items[start])) {
      while (index < items.length && isImage(items[index])) index++;
    }
    const count = index - start;
    result.push(count === 1 ? render(items[start], start) : (
      <MessageImageGroup key={`images-${start}`} className="attachment-image-group">
        {items.slice(start, index).map((item, offset) => render(item, start + offset))}
      </MessageImageGroup>
    ));
  }
  return result;
}
export function hasAttachmentMessage(message: Message) { return message.role === 'user' && (!!message.attachmentUploads?.length || !!message.attachmentViews?.length || messageReferences(message.text).length > 0); }
type AttachmentMessageProps = {message: Message; processing?: ReturnType<typeof attachmentProcessing>};

export function AttachmentMessageStatus({message, processing = attachmentProcessing(message)}: AttachmentMessageProps) {
  const uploads = message.attachmentViews?.length ? [] : (message.attachmentUploads || []).filter(file => file.progress?.phase === 'failed');
  const deliveryStatus = message.attachmentViews?.map(view => view.delivery_status).find(status => status in delivery);
  const deliveryTitle = deliveryStatus ? delivery[deliveryStatus as keyof typeof delivery] : undefined;
  if (!uploads.length && !deliveryTitle && !message.retry) {
    if (processing) return processing.part ? null : processing.content;
    return message.queueNotice ? <ChatStatusRow title={message.queueNotice} /> : null;
  }
  const title = uploads.length ? (uploads.length === 1 ? '附件上传失败' : `${uploads.length} 个附件上传失败`)
    : deliveryTitle || '附件消息需要处理';
  const uploadDetails = uploads.map(file => [file.name, file.progress?.error].filter(Boolean).join(' · ')).join('；');
  const detail = uploadDetails || (message.queueNotice !== title ? message.queueNotice : undefined);
  return <ChatStatusRow title={title} detail={detail}
    inActions
    tone={uploads.length || deliveryStatus === 'failed' || message.retry ? 'error' : 'neutral'}
    retry={message.retry && { label: message.retryLabel || '重试', run: () => void message.retry?.() }}>
    {message.retry && message.queued && message.cancelQueued && <button type="button" aria-label="移除失败附件" onClick={() => void message.cancelQueued?.()}>移除</button>}
  </ChatStatusRow>;
}
export function originalMessageText(message: Message) {
  const text = message.attachmentViews?.flatMap(view => view.parts.filter(part => part.type === 'text').map(part => part.text));
  return text?.join('\n') ?? (message.attachmentUploads?.length && !message.text.startsWith('[发送了')
    ? message.text
    : hasAttachmentMessage(message) ? '' : message.text);
}
export function AttachmentMessageContent({message, processing = attachmentProcessing(message)}: AttachmentMessageProps) {
  const { ref, ready } = useNearViewport<HTMLDivElement>(!!message.attachmentUploads?.length || !!message.attachmentViews?.length);
  return <div ref={ref} className="attachment-message-host">{ready ? <LoadedAttachmentMessage message={message} processing={processing} />
    : <div className="content attachment-deferred" aria-label="附件消息">附件消息</div>}</div>;
}
function LoadedAttachmentMessage({message, processing}: AttachmentMessageProps) {
  const endpoint = message.attachmentEndpoint || new URLSearchParams(location.search).get('history_scope') || '';
  const [fetched, setFetched] = useState<{key:string;views:AttachmentMessage[]}>({key:'',views:[]}), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const [localImages,setLocalImages]=useState<({src:string;blob:Blob}|undefined)[]>([]);
  // Keep the same object URLs across the upload -> server message transition.
  useLayoutEffect(()=>{
    const images=(message.attachmentUploads || []).map(file=>file.blob && isPreviewImage(file.mime) ? {src:URL.createObjectURL(file.blob),blob:file.blob} : undefined);
    setLocalImages(images);
    return()=>images.forEach(image=>{if(image)URL.revokeObjectURL(image.src);});
  },[message.attachmentUploads]);
  const ids = messageReferences(message.text).join(',');
  const service=attachmentMessageReader(endpoint, viewRequest(endpoint, new AbortController().signal));
  const hasViews=!!message.attachmentViews?.length;
  useEffect(() => {
    if (hasViews || !ids) return;
    let active=true;setError('');
    void Promise.all(ids.split(',').map(id => service.get(id))).then(views=>{if(active)setFetched({key:JSON.stringify([endpoint,ids]),views});}).catch(() => { if(active)setError('附件消息暂时无法加载'); });
    return () => {active=false;};
  }, [ids, endpoint, hasViews, attempt, service]);
  const cached=ids ? ids.split(',').map(id=>service.cache.get(id)).filter((view):view is AttachmentMessage=>!!view) : [];
  const views = hasViews ? message.attachmentViews! : cached.length===ids.split(',').length ? cached : fetched.key===JSON.stringify([endpoint,ids]) ? fetched.views : [];
  if (!views.length && message.attachmentUploads?.length) return <div className="content attachment-message"><div>
    {!message.text.startsWith('[发送了') && <div className="attachment-caption">
      <div className="attachment-message-copy"><p className="attachment-original-text"><CommandMessageText text={message.text}/></p></div>
      <MessageCaptionAnchor />
    </div>}
    {renderAttachmentRuns(message.attachmentUploads, file => !!file.blob && isPreviewImage(file.mime), (file, index) => {
      const p = file.progress, complete = p?.phase === 'complete', failed = p?.phase === 'failed';
      const total = p?.total || file.size;
      const percent = p?.phase === 'uploading' && total > 0 ? Math.min(99, Math.floor(p.loaded / total * 100)) : undefined;
      const status = failed ? undefined : complete ? '上传完成' : p?.phase === 'confirming' ? '正在确认'
        : p?.phase === 'uploading' ? (percent === undefined ? '正在上传' : `正在上传 · ${percent}%`)
          : p ? '准备上传' : '等待上传';
      if (file.blob && isPreviewImage(file.mime)) return <AttachmentImageUpload key={index} src={localImages[index]?.src || ''} blob={file.blob} name={file.name} percent={percent} status={complete ? undefined : status}/>;
      return <section className="attachment-card attachment-upload-card" key={index} aria-label={file.name}><div className="attachment-file-row"><span className="attachment-file-icon" aria-hidden="true"><Icon name="chat-file" width="20" height="20" /></span><span className="attachment-file-label"><FileName name={file.name} /><small>{file.name.match(/.+\.([^.]+)$/)?.[1]?.toUpperCase() || '文件'} · {formatBytes(file.size)}</small></span></div>
        {status && <p role="status">{status}</p>}
        {percent !== undefined && <progress aria-label={`${file.name} 上传进度`} max={100} value={percent} />}
      </section>;
    })}
  </div></div>;
  if (!views.length) return <div className="content attachment-fallback">
    {error ? <ChatStatusRow title={error} tone="error" inActions retry={{ label: '重试加载', run: () => { setError(''); setAttempt(attempt + 1); } }} />
      : <p role="status">正在加载附件消息…</p>}
    <details><summary>查看原始消息</summary><pre>{message.text}</pre></details>
  </div>;
  return <div className="content attachment-message">{views.map(view => {
    const parts = view.parts.filter(part => part.type === 'attachment' || part.text.trim());
    const content: ReactNode[] = [];
    let attachmentIndex = 0;
    for (let start = 0; start < parts.length;) {
      const type = parts[start].type;
      let end = start + 1;
      while (parts[end]?.type === type) end++;
      const run = parts.slice(start, end);
      if (type === 'text') {
        content.push(<div key={start} className="attachment-caption">
          <div className="attachment-message-copy">
            {run.map((part, index) => part.type === 'text' &&
              <p className="attachment-original-text" key={index}><CommandMessageText text={part.text}/></p>)}
          </div>
          <MessageCaptionAnchor />
        </div>);
      } else {
        const attachments = run.filter(part => part.type === 'attachment');
        content.push(<Fragment key={start}>{renderAttachmentRuns(attachments, part => isPreviewImage(part.mime),
          (part, index) => <AttachmentCard key={part.attachment_id} part={part} endpoint={endpoint}
            processing={processing?.part === part ? processing.content : undefined}
            localImage={views.length === 1 ? localImages[attachmentIndex + index] : undefined}/>)}</Fragment>);
        attachmentIndex += attachments.length;
      }
      start = end;
    }
    return <div key={view.message_id}>
      {view.channel !== 'portal' && <small>{view.channel} · {view.scene_label}</small>}
      <AttachmentImageGallery ids={parts.flatMap(part => part.type === 'attachment' && isPreviewImage(part.mime) ? [part.attachment_id] : [])}
        endpoint={endpoint}>{content}</AttachmentImageGallery>
    </div>;
  })}</div>;
}
