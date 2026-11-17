import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { Icon } from '../../shared/icons/icon';
import type { Message } from '../models/chat';
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
  const text = parts.length ? parts.filter(part => part.type === 'text').map(part => part.text).join('\n')
    : files.length && item.text.startsWith('[发送了') ? '' : item.text;
  const summary = text || (images.length && images.length === files.length ? `${images.length} 张图片`
    : files.length === 1 ? files[0].name : `${files.length} 个附件`);
  const parsing = uploaded.find(part => part.parse_status === 'parsing');
  const upload = uploads.find(file => file.progress?.phase === 'uploading')?.progress;
  const status = item.retry ? item.queueNotice : parsing ? attachmentProgress(parsing)
    : upload ? `正在上传${upload.total > 0 ? ` · ${Math.min(99, Math.floor(upload.loaded / upload.total * 100))}%` : ''}` : item.queueNotice;
  return <div ref={setNodeRef} className={`composer-queue-item${isDragging ? ' dragging' : ''}`} data-queue-id={item.id}
    style={{ transform: CSS.Translate.toString(transform), transition, '--queue-preview-anchor': previewAnchor } as CSSProperties}>
    <button ref={setActivatorNodeRef} type="button" className="composer-queue-drag-handle" disabled={!reorderable}
      {...attributes} {...listeners}
      aria-label={`调整排队顺序：${summary}`} title="拖动排序">
      <Icon name="chat-queue-grip" width="14" height="14" fill="currentColor" stroke="none" />
    </button>
    <button type="button" className="composer-queue-preview-trigger" popoverTarget={previewId} aria-haspopup="dialog"
      aria-label={`预览待发消息：${summary.slice(0, 80)}`}>
      {thumbnail && <QueueThumbnail blob={thumbnail} />}
      <span className="composer-queue-content">{summary}</span>
    </button>
    <div ref={preview} id={previewId} className="composer-queue-preview" role="dialog" aria-label="待发消息预览" popover="auto" tabIndex={0}>
      {text}
      {!!files.length && <ul aria-label="待发附件">{files.map((file, index) => <li key={index}>{file.name}</li>)}</ul>}
      {status && <small>{status}</small>}
    </div>
    {status && <span className="composer-queue-status" role="status" data-error={!!item.retry || undefined} title={status}>{status}</span>}
    {item.retry && <button className="composer-queue-text-action" type="button" onClick={() => void item.retry?.()}>{item.retryLabel}</button>}
    {!files.length && <button className="composer-queue-steer" type="button" aria-label="调整方向" disabled={!allowInterrupt || !item.canInterruptQueued}
      title="调整方向：立即打断并发送这条消息" onClick={() => void item.interruptQueued?.()}>
      <Icon name="turn-right" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <span>引导</span>
    </button>}
    <button type="button" title="删除排队消息" aria-label={`取消排队：${summary}`} onClick={() => item.cancelQueued?.()} disabled={!item.cancelQueued}>
      <Icon name="lucide-trash" width="14" height="14" />
    </button>
    {!files.length && <button type="button" aria-label={`编辑排队消息：${summary}`} title="在输入框编辑" onClick={() => onEdit(item)} disabled={!item.editQueued}>
      <Icon name="chat-edit" width="14" height="14" />
    </button>}
  </div>;
}

export function ComposerQueue({ items, allowInterrupt, onEdit }: {
  items: Message[];
  allowInterrupt: boolean;
  onEdit: (item: Message) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const ids = items.filter(item => item.reorderQueued).map(item => item.id);
  const sortable = new Set(ids);
  return <div className="composer-queue" role="group" aria-label={`待发送消息，共 ${items.length} 条`}>
    <DndContext id="composer-queue-sort" sensors={sensors} collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
      accessibility={{ screenReaderInstructions: { draggable: '按空格提起，使用上下方向键移动。按空格放下，按 Esc 取消。' } }}
      onDragEnd={({ active, over }) => {
        if (over && active.id !== over.id)
          void items.find(item => item.id === active.id)?.reorderQueued?.(String(over.id));
      }}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {items.map(item => <QueueRow key={item.id} item={item} reorderable={ids.length > 1 && sortable.has(item.id)}
          allowInterrupt={allowInterrupt} onEdit={onEdit} />)}
      </SortableContext>
    </DndContext>
  </div>;
}
