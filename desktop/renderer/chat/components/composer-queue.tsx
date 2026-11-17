import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { Icon } from '../../shared/icons/icon';
import { ChatTooltipGroup } from '../../shared/components/chat-action-tooltip';
import type { Message } from '../models/chat';
import { attachmentContentURL } from '../services/attachment-view';
import { attachmentProgress } from './attachments';

function QueueThumbnail({ blob }: { blob: Blob }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    const url = URL.createObjectURL(blob);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return src && <img className="composer-queue-thumbnail" src={src} alt="" draggable={false} />;
}

function QueueRow({ item, reorderable, allowInterrupt, onEdit }: {
  item: Message;
  reorderable: boolean;
  allowInterrupt: boolean;
  onEdit: (item: Message) => void;
}) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, isDragging, transform, transition } =
    useSortable({ id: item.id, disabled: { draggable: !reorderable, droppable: !reorderable } });
  const previewId = useId();
  const preview = useRef<HTMLDivElement>(null);
  const previewAnchor = `--queue-preview-${previewId.replace(/[^\w-]/g, '')}`;
  useEffect(() => { if (isDragging) preview.current?.hidePopover(); }, [isDragging]);
  const parts = item.attachmentViews?.flatMap(view => view.parts) ?? [];
  const uploaded = parts.filter(part => part.type === 'attachment');
  const uploads = item.attachmentUploads ?? [];
  const files = uploaded.length ? uploaded : uploads;
  const images = files.filter(file => file.mime?.startsWith('image/'));
  const thumbnail = uploads.find(file => file.blob && file.mime?.startsWith('image/'))?.blob;
  const uploadedImage = uploaded.find(file => file.mime?.startsWith('image/'));
  const text = parts.length ? parts.filter(part => part.type === 'text').map(part => part.text).join('\n')
    : files.length && item.text.startsWith('[发送了') ? '' : item.text;
  const summary = text || (images.length && images.length === files.length ? `${images.length} 张图片`
    : files.length === 1 ? files[0].name : `${files.length} 个附件`);
  const parsing = uploaded.find(part => part.parse_status === 'parsing');
  const upload = uploads.find(file => file.progress?.phase === 'uploading')?.progress;
  const phase = item.queuePhase ?? 'queued';
  const failed = phase === 'failed' || !!item.retry;
  const unconfirmed = phase === 'sending' && !!item.queueNotice;
  const working = phase === 'preparing' || (phase === 'sending' && !unconfirmed);
  const status = failed || unconfirmed ? item.queueNotice : parsing ? attachmentProgress(parsing)
    : upload ? `正在上传${upload.total > 0 ? ` · ${Math.min(99, Math.floor(upload.loaded / upload.total * 100))}%` : ''}`
    : item.queueNotice || (working ? phase === 'preparing' ? '正在处理附件' : '正在发送' : '');
  return <div ref={setNodeRef} className={`composer-queue-item${isDragging ? ' dragging' : ''}`} data-queue-id={item.id}
    data-queue-phase={phase} data-working={working || undefined} data-queue-dragging={isDragging || undefined}
    style={{ transform: CSS.Translate.toString(transform), transition, '--queue-preview-anchor': previewAnchor } as CSSProperties}>
    {reorderable ? <button ref={setActivatorNodeRef} type="button" className="composer-queue-drag-handle"
      {...attributes} {...listeners}
      aria-label={`调整排队顺序：${summary}`} title="拖动排序">
      <Icon name="chat-queue-grip" width="14" height="14" fill="currentColor" stroke="none" />
    </button> : <span className="composer-queue-leading" aria-hidden="true">
      <Icon name={working ? 'chat-busy' : 'chat-queue'} width="14" height="14" />
    </span>}
    <button type="button" className="composer-queue-preview-trigger" popoverTarget={previewId} aria-haspopup="dialog"
      aria-label={`预览待发消息：${summary.slice(0, 80)}`}>
      {thumbnail ? <QueueThumbnail blob={thumbnail} /> : uploadedImage && item.attachmentEndpoint &&
        <img className="composer-queue-thumbnail" src={attachmentContentURL(item.attachmentEndpoint, uploadedImage.attachment_id, true)} alt="" draggable={false} />}
      <span className="composer-queue-content">{summary}</span>
    </button>
    <div ref={preview} id={previewId} className="composer-queue-preview" role="dialog" aria-label="待发消息预览" popover="auto" tabIndex={0}>
      {text}
      {!!files.length && <ul aria-label="待发附件">{files.map((file, index) => <li key={index}>{file.name}</li>)}</ul>}
      {status && <small>{status}</small>}
    </div>
    {status && <span className="composer-queue-status" role="status" data-error={failed || undefined} title={status}>{unconfirmed ? '送达未确认' : status}</span>}
    <div className="composer-queue-row-actions">
      {item.retry ? <button className="composer-queue-steer" type="button" data-warm-tooltip="重试" aria-label={item.retryLabel || '重试'} disabled={item.queueBusy}
        onClick={() => void item.retry?.()}><Icon name="chat-retry" width="14" height="14" />重试</button>
        : phase === 'queued' && item.canInterruptQueued && <button type="button" className="composer-queue-steer" aria-label="调整方向"
          disabled={!allowInterrupt} data-warm-tooltip="发给正在运行的任务" onClick={() => void item.interruptQueued?.()}>
          <Icon name="turn-right" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />引导
        </button>}
      {phase !== 'sending' && item.cancelQueued && <button type="button" data-warm-tooltip="取消排队" aria-label={`取消排队：${summary}`}
        onClick={() => item.cancelQueued?.()} disabled={item.queueBusy && phase !== 'preparing'}>
        <Icon name="lucide-trash" width="14" height="14" />
      </button>}
      {phase === 'queued' && !files.length && item.editQueued &&
        <button type="button" aria-label={`编辑排队消息：${summary}`} data-warm-tooltip="编辑消息" onClick={() => onEdit(item)} disabled={item.queueBusy}>
          <Icon name="chat-edit" width="14" height="14" />
        </button>}
    </div>
  </div>;
}

export function ComposerQueue({ items, allowInterrupt, onEdit }: {
  items: Message[];
  allowInterrupt: boolean;
  onEdit: (item: Message) => void;
}) {
  const tooltipRoot = useRef<HTMLDivElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const ids = items.filter(item => item.reorderQueued && !item.queueBusy && (item.queuePhase ?? 'queued') === 'queued').map(item => item.id);
  const sortable = new Set(ids);
  return <ChatTooltipGroup anchorRoot={tooltipRoot}><div ref={tooltipRoot} className="composer-queue" data-warm-tooltip-scope role="group" aria-label={`待发送消息，共 ${items.length} 条`}>
    <DndContext id="composer-queue-sort" sensors={sensors} collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
      accessibility={{ screenReaderInstructions: { draggable: '按空格提起，使用上下方向键移动。按空格放下，按 Esc 取消。' } }}
      onDragEnd={({ active, over }) => {
        if (over && active.id !== over.id && sortable.has(String(active.id)) && sortable.has(String(over.id)))
          void items.find(item => item.id === active.id)?.reorderQueued?.(String(over.id));
      }}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {items.map(item => <QueueRow key={item.id} item={item} reorderable={ids.length > 1 && sortable.has(item.id)}
          allowInterrupt={allowInterrupt} onEdit={onEdit} />)}
      </SortableContext>
    </DndContext>
  </div></ChatTooltipGroup>;
}
