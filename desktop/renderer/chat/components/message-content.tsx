import {AttachmentImageUpload} from './attachment-image-upload';
import {AttachmentProcessing} from './attachment-processing';
import {formatBytes} from '../../shared/lib/format-bytes';
import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import type { Message } from '../models/chat';
import { attachmentMessageReader, messageReferences, type AttachmentMessage } from '../services/attachment-messages';
import { viewRequest } from '../services/attachment-view';
import { AttachmentCard } from './attachments';
import { useNearViewport } from '../../shared/hooks/use-near-viewport';
import { CommandMessageText } from './command-message';
import { FileName } from '../../shared/components/file-name';
import { Icon } from '../../shared/icons/icon';
import { MessageImageGroup } from '../../shared/components/message-image-group';
const delivery: Record<string,string> = {pending:'等待处理或发送', sending:'正在发送', accepted:'已发送', unknown:'发送结果待确认，请核对历史', failed:'发送失败', cancelled:'已取消'};
const isPreviewImage = (mime = '') => /^image\/(png|jpeg|gif|webp)$/.test(mime);

function renderAttachmentRuns<T>(items: T[], isImage: (item: T) => boolean, render: (item: T, index: number) => ReactNode) {
  const result: ReactNode[] = [];
  for (let index = 0; index < items.length;) {
    const start = index++;
    if (isImage(items[start])) {
      while (index < items.length && isImage(items[index])) index++;
    }
    result.push(index === start + 1 ? render(items[start], start) :
      <MessageImageGroup key={start}>{items.slice(start, index).map((item, offset) => render(item, start + offset))}</MessageImageGroup>);
  }
  return result;
}

export function hasAttachmentMessage(message: Message) { return message.role === 'user' && (!!message.attachmentUploads?.length || !!message.attachmentViews?.length || messageReferences(message.text).length > 0); }
export function originalMessageText(message: Message) {
  return message.attachmentViews?.map(v => v.parts.filter(p => p.type === 'text').map(p => p.text).join('\n')).join('\n') ?? (hasAttachmentMessage(message) ? '附件消息' : message.text);
}
export function AttachmentMessageContent({message}: {message: Message}) {
  const { ref, ready } = useNearViewport<HTMLDivElement>(!!message.attachmentUploads?.length || !!message.attachmentViews?.length);
  return <div ref={ref} className="attachment-message-host">{ready ? <LoadedAttachmentMessage message={message} />
    : <div className="content attachment-deferred" aria-label="附件消息">附件消息</div>}</div>;
}
function LoadedAttachmentMessage({message}: {message: Message}) {
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
  if (!views.length && message.attachmentUploads?.length) return <div className="content attachment-message">
    {renderAttachmentRuns(message.attachmentUploads, file => !!file.blob && isPreviewImage(file.mime), (file, index) => {
      const p = file.progress, complete = p?.phase === 'complete', failed = p?.phase === 'failed';
      const percent = complete ? 100 : Math.min(99, Math.floor((p?.loaded || 0) / (p?.total || file.size) * 100));
      if (file.blob && isPreviewImage(file.mime)) return <AttachmentImageUpload key={index} src={localImages[index]?.src || ''} blob={file.blob} name={file.name} percent={percent} complete={complete} phase={p?.phase} error={p?.error}/>;
      return <section className="attachment-card attachment-upload-card" key={index}><div className="attachment-file-row"><span className="attachment-file-icon" aria-hidden="true"><Icon name="chat-file" width="18" height="18" /></span><span className="attachment-file-label"><FileName name={file.name} /><small>{file.name.split('.').pop()?.toUpperCase()} · {formatBytes(file.size)}</small></span></div>
        <p role="status">{failed ? `上传失败：${p?.error || '请重试'}` : complete ? '上传完成' : p?.phase === 'confirming' ? '正在确认上传' : p?.phase === 'uploading' ? '正在上传' : p ? '正在准备上传' : '等待上传'}{!failed && ` · ${percent}%`}</p>
        {!complete && !failed && <progress aria-label={`${file.name} 上传进度`} max={100} value={percent} />}
        <small>{formatBytes(p?.loaded || 0)} / {formatBytes(p?.total || file.size)}</small>
      </section>;
    })}
    {!message.text.startsWith('[发送了') && <p className="attachment-original-text"><CommandMessageText text={message.text}/></p>}
  </div>;
  if (!views.length) return <div className="content attachment-fallback"><p role="status">{error || '正在加载附件消息…'}</p>{error && <button onClick={() => { setError(''); setAttempt(attempt + 1); }}>重试加载</button>}<details><summary>查看原始消息</summary><pre>{message.text}</pre></details></div>;
  return <div className="content attachment-message">{views.map(view => <div key={view.message_id}>
    {view.channel !== 'portal' && <small>{view.channel} · {view.scene_label}</small>}
    {renderAttachmentRuns(view.parts.filter(part=>part.type==='attachment'), part => isPreviewImage(part.mime), (part, index) =>
      <AttachmentCard key={part.attachment_id} part={part} endpoint={endpoint} localImage={views.length===1 ? localImages[index] : undefined}/>)}
    <AttachmentProcessing items={[message]} />
    <div className="attachment-message-copy">
      {view.parts.filter(part=>part.type==='text').map((part,i)=><p className="attachment-original-text" key={i}><CommandMessageText text={part.text}/></p>)}
    </div>
    {['unknown','failed','cancelled'].includes(view.delivery_status) && <small role="status">{delivery[view.delivery_status]}</small>}
  </div>)}</div>;
}
