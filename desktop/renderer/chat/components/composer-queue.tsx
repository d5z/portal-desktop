import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Icon } from '../../shared/icons/icon';
import type { Message } from '../models/chat';

function QueueRow({ item, reorderable, allowInterrupt, onEdit }: {
  item: Message;
  reorderable: boolean;
  allowInterrupt: boolean;
  onEdit: (item: Message) => void;
}) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, isDragging, transform, transition } =
    useSortable({ id: item.id, disabled: { draggable: !reorderable, droppable: !reorderable } });
  return <div ref={setNodeRef} className={`composer-queue-item${isDragging ? ' dragging' : ''}`} data-queue-id={item.id}
    style={{ transform: CSS.Translate.toString(transform), transition }}>
    <button ref={setActivatorNodeRef} type="button" className="composer-queue-drag-handle" disabled={!reorderable}
      {...attributes} {...listeners}
      aria-label={`调整排队顺序：${item.text}`} title="拖动排序">
      <Icon name="chat-queue-grip" width="14" height="14" fill="currentColor" stroke="none" />
    </button>
    <span className="composer-queue-content" title={item.text}>{item.text}</span>
    {item.queueNotice && <span className="composer-queue-notice" role="status" title={item.queueNotice} aria-label={item.queueNotice}>!</span>}
    {item.retry && <button className="composer-queue-text-action" type="button" onClick={() => void item.retry?.()}>{item.retryLabel}</button>}
    <button className="composer-queue-steer" type="button" aria-label="调整方向" disabled={!allowInterrupt || !item.canInterruptQueued}
      title="调整方向：立即打断并发送这条消息" onClick={() => void item.interruptQueued?.()}>
      <Icon name="turn-right" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <span>引导</span>
    </button>
    <button type="button" title="删除排队消息" aria-label={`取消排队：${item.text}`} onClick={() => item.cancelQueued?.()}>
      <Icon name="lucide-trash" width="14" height="14" />
    </button>
    <button type="button" aria-label={`编辑排队消息：${item.text}`} title="在输入框编辑" onClick={() => onEdit(item)} disabled={!item.editQueued}>
      <Icon name="chat-edit" width="14" height="14" />
    </button>
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
