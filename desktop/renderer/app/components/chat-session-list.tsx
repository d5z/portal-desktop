import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CHAT_SCENE_ACTIVITY_LABELS, type ChatScene, type ChatSceneActivity } from '../../../shared/types';
import { ChatSceneStatus } from './chat-scene-status';
import { SceneNameEditor } from './scene-name-editor';
import { GlideMenu } from './glide-menu';

// Radix ContextMenuTrigger: 700 ms for touch/pen; movement cancels the hold.
// https://github.com/radix-ui/primitives/blob/main/packages/react/context-menu/src/context-menu.tsx
const CONTEXT_MENU_LONG_PRESS_MS = 700;

export function focusSession(id: string) {
  const row = Array.from(document.querySelectorAll<HTMLButtonElement>('.chat-session-row button[data-scene-id]'))
    .find(button => button.dataset.sceneId === id);
  row?.focus({ preventScroll: true });
  row?.scrollIntoView({ block: 'nearest' });
}

export function ChatSessionList({ sessions, activeId, activity, disabled, disabledReason, menuId, selectedIds, onSelection, emptyMessage,
  renameId, onRenameEnd, onRenameSave, onSelect, onMove, onMenu, onRename, onDelete, onCopy, onDragging }: {
  sessions: ChatScene[]; activeId?: string; activity: Record<string, ChatSceneActivity>; disabled: boolean; menuId?: string;
  selectedIds: string[]; onSelection: (ids: string[]) => void; renameId?: string;
  emptyMessage: string; disabledReason: string;
  onRenameEnd: (id: string) => void; onRenameSave: (id: string, name: string) => Promise<void>;
  onSelect: (id: string) => void; onMove: (ids: string[], before?: string) => void;
  onMenu: (scene: ChatScene, x: number, y: number, keyboard?: boolean) => void; onRename: (scene: ChatScene) => void;
  onDelete: (ids: string[]) => void; onCopy: (ids: string[]) => void;
  onDragging: (value: boolean) => void;
}) {
  const list = useRef<HTMLElement>(null);
  const [dragging, setDragging] = useState<string>();
  const source = useRef<string[] | undefined>(undefined);
  const dragImage = useRef<HTMLElement | undefined>(undefined);
  const [drop, setDrop] = useState<{ id: string; after: boolean }>();
  const pointer = useRef<{ x: number; y: number } | undefined>(undefined);
  const typeahead = useRef({ text: '', time: 0 });
  const longPress = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const suppressClick = useRef(false);
  const anchor = useRef<string | undefined>(activeId);
  useEffect(() => { anchor.current = activeId; }, [activeId]);
  const [focusId, setFocusId] = useState<string>();
  const restoreFocus = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (!renameId && restoreFocus.current) {
      focusSession(restoreFocus.current); restoreFocus.current = undefined;
    }
  }, [renameId]);
  const selected = new Set(selectedIds);
  const orderedSelection = (id: string) => sessions.filter(item => selected.has(id) ? selected.has(item.scene_id) : item.scene_id === id).map(item => item.scene_id);
  const range = (id: string, additive = false) => {
    const from = Math.max(0, sessions.findIndex(item => item.scene_id === anchor.current));
    const to = sessions.findIndex(item => item.scene_id === id);
    const ids = sessions.slice(Math.min(from, to), Math.max(from, to) + 1).map(item => item.scene_id);
    onSelection(additive ? [...new Set([...selectedIds, ...ids])] : ids);
  };
  const toggle = (id: string) => { anchor.current = id; onSelection(selected.has(id) ? selectedIds.filter(value => value !== id) : [...selectedIds, id]); };
  const clearLongPress = () => { clearTimeout(longPress.current); longPress.current = undefined; };
  useEffect(() => {
    window.addEventListener('blur', clearLongPress);
    return () => { clearLongPress(); window.removeEventListener('blur', clearLongPress); };
  }, []);
  useEffect(() => { if (disabled) clearLongPress(); }, [disabled]);
  const finish = () => {
    dragImage.current?.remove(); dragImage.current = undefined;
    source.current = undefined; pointer.current = undefined; setDragging(undefined); setDrop(undefined); onDragging(false);
  };
  useEffect(() => () => dragImage.current?.remove(), []);
  useEffect(() => {
    if (!dragging) return;
    let frame: number;
    let previous = performance.now();
    const scroll = (now: number) => {
      const rect = list.current?.getBoundingClientRect(), p = pointer.current;
      if (rect && p && p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom) {
        const velocity = p.y < rect.top + 32 ? -Math.min(1, (rect.top + 32 - p.y) / 32)
          : p.y > rect.bottom - 32 ? Math.min(1, (p.y - rect.bottom + 32) / 32) : 0;
        if (velocity) {
          list.current!.scrollTop += velocity * Math.min(now - previous, 32) * .5;
          const row = document.elementFromPoint(p.x, p.y)?.closest<HTMLElement>('.chat-session-row');
          const id = row?.querySelector<HTMLButtonElement>('[data-scene-id]')?.dataset.sceneId;
          if (row && id) { const box = row.getBoundingClientRect(); setDrop({ id, after: p.y > box.top + box.height / 2 }); }
        }
      }
      previous = now; frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); finish(); } };
    window.addEventListener('keydown', cancel, true);
    window.addEventListener('blur', finish);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', cancel, true); window.removeEventListener('blur', finish); };
  }, [dragging]);
  useEffect(() => { if (disabled) finish(); }, [disabled]);

  return <nav ref={list} className="chat-session-list" role="grid" aria-label="切换场景" aria-multiselectable="true"
    aria-rowcount={sessions.length} data-dragging={!!dragging} data-multiselect={selectedIds.length > 1}
    onScroll={clearLongPress}
    onDragOver={event => {
      if (!source.current || disabled) return;
      event.preventDefault(); event.dataTransfer.dropEffect = 'move';
      pointer.current = { x: event.clientX, y: event.clientY };
      const row = (event.target as Element).closest<HTMLElement>('.chat-session-row');
      const id = row?.querySelector<HTMLButtonElement>('[data-scene-id]')?.dataset.sceneId;
      if (row && id) { const rect = row.getBoundingClientRect(); setDrop({ id, after: event.clientY > rect.top + rect.height / 2 }); }
      else if (sessions.length) setDrop({ id: sessions[sessions.length - 1].scene_id, after: true });
    }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) { pointer.current = undefined; setDrop(undefined); } }}
    onDrop={event => {
      event.preventDefault();
      const ids = source.current;
      if (ids && drop && !disabled && !ids.includes(drop.id)) {
        const index = sessions.findIndex(item => item.scene_id === drop.id);
        const before = drop.after ? sessions.slice(index + 1).find(item => !ids.includes(item.scene_id))?.scene_id : drop.id;
        onMove(ids, before);
      }
      finish();
    }}>
    <GlideMenu disabled={disabled || !!dragging || !!renameId || selectedIds.length > 1}>
    {sessions.map((session, index) => <div key={session.scene_id} className="chat-session-row" role="row"
      aria-rowindex={index + 1} aria-selected={selected.has(session.scene_id)}
      data-menu-open={menuId === session.scene_id}
      data-drag-source={!!dragging && source.current?.includes(session.scene_id)}
      data-drop={drop?.id === session.scene_id && !source.current?.includes(session.scene_id) ? drop.after ? 'after' : 'before' : undefined}
      onPointerDown={event => {
        clearLongPress(); suppressClick.current = false;
        if (disabled || renameId || !event.isPrimary || event.button !== 0 || event.pointerType === 'mouse') return;
        const { clientX, clientY } = event;
        longPress.current = setTimeout(() => {
          suppressClick.current = true;
          onMenu(session, clientX, clientY);
        }, CONTEXT_MENU_LONG_PRESS_MS);
      }}
      onPointerMove={event => { if (event.pointerType !== 'mouse') clearLongPress(); }}
      onPointerUp={clearLongPress} onPointerCancel={clearLongPress} onPointerLeave={clearLongPress}
      onContextMenu={event => {
        if (disabled || renameId === session.scene_id) return;
        event.preventDefault(); event.stopPropagation();
        clearLongPress(); suppressClick.current = true;
        if (menuId === session.scene_id) return;
        const rect = event.currentTarget.getBoundingClientRect();
        onMenu(session, event.clientX || rect.left, event.clientY || rect.bottom, !event.clientX && !event.clientY);
      }}>
      <div role="gridcell" className="chat-session-cell">
      {renameId === session.scene_id ? <><SceneNameEditor scene={session} onSave={onRenameSave} onClose={restore => {
        if (restore) restoreFocus.current = session.scene_id;
        onRenameEnd(session.scene_id);
      }} /><ChatSceneStatus id={`scene-status-${session.scene_id}`} status={activity[session.scene_id]} /></> : <button data-scene-id={session.scene_id} type="button" draggable={!disabled && !renameId}
        tabIndex={(focusId && sessions.some(item => item.scene_id === focusId) ? focusId : activeId || sessions[0]?.scene_id) === session.scene_id ? 0 : -1}
        onFocus={() => setFocusId(session.scene_id)}
        aria-label={`切换到场景：${session.scene_meta.scene_label}`} aria-current={activeId === session.scene_id ? 'true' : undefined}
        aria-haspopup="menu" aria-expanded={menuId === session.scene_id} aria-keyshortcuts="Shift+F10 ContextMenu"
        aria-description={disabled ? disabledReason : "双击或 F2 改名；Command 或 Control 加单击多选，Shift 连选；右键、长按或 Shift+F10 打开操作。"}
        aria-describedby={activity[session.scene_id] ? `scene-status-${session.scene_id}` : undefined}
        data-sidebar-focus-hint={`${session.scene_meta.scene_label}${activity[session.scene_id] ? ` · ${CHAT_SCENE_ACTIVITY_LABELS[activity[session.scene_id]]}` : ''}`}
        data-sidebar-hint={`${session.scene_meta.scene_label}${disabled ? ` · ${disabledReason}` : ''}`} data-sidebar-hint-overflow={disabled ? undefined : true}
        disabled={disabled} onClick={event => {
          // A long press (or macOS Control-click) must not also activate the row.
          if (suppressClick.current) { event.preventDefault(); suppressClick.current = false; return; }
          if (source.current || event.detail > 1) return;
          if (event.shiftKey) { range(session.scene_id, event.metaKey || event.ctrlKey); return; }
          if (event.metaKey || event.ctrlKey) { toggle(session.scene_id); return; }
          anchor.current = session.scene_id; onSelection([session.scene_id]); onSelect(session.scene_id);
        }}
        onDoubleClick={event => {
          if (event.shiftKey || event.metaKey || event.ctrlKey) return;
          event.preventDefault(); onSelection([session.scene_id]); onRename(session);
        }}
        onDragStart={event => {
          clearLongPress();
          if (disabled) { event.preventDefault(); return; }
          const ids = orderedSelection(session.scene_id);
          source.current = ids; onSelection(ids); setDragging(session.scene_id); onDragging(true);
          event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-portal-scene', JSON.stringify(ids));
          if (ids.length > 1) {
            const preview = document.createElement('div'); preview.className = 'chat-session-drag-preview';
            preview.textContent = `${session.scene_meta.scene_label} · ${ids.length} 个场景`;
            document.body.appendChild(preview); dragImage.current = preview; event.dataTransfer.setDragImage(preview, 24, 18);
          } else event.dataTransfer.setDragImage(event.currentTarget.closest('.chat-session-row')!, 24, 18);
        }} onDragEnd={finish}
        onKeyDown={event => {
          suppressClick.current = false;
          const key = event.key;
          if (event.nativeEvent.isComposing) return;
          const modifier = event.metaKey || event.ctrlKey;
          if (key === 'ContextMenu' || (key === 'F10' && event.shiftKey)) {
            event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); onMenu(session, rect.left, rect.bottom, true);
          } else if (key === 'F2') { event.preventDefault(); onRename(session); }
          else if (modifier && key.toLowerCase() === 'a') { event.preventDefault(); anchor.current = session.scene_id; onSelection(sessions.map(item => item.scene_id)); }
          else if (modifier && key.toLowerCase() === 'c') { event.preventDefault(); onCopy(orderedSelection(session.scene_id)); }
          else if (key === 'Delete' || (event.metaKey && key === 'Backspace')) { event.preventDefault(); onDelete(orderedSelection(session.scene_id)); }
          else if (key === 'Escape' && selectedIds.length > 1) { event.preventDefault(); event.stopPropagation(); onSelection([session.scene_id]); anchor.current = session.scene_id; }
          else if (key === ' ') { event.preventDefault(); toggle(session.scene_id); }
          else if (key === 'Enter') { event.preventDefault(); onSelection([session.scene_id]); onSelect(session.scene_id); }
          else if (event.altKey && event.shiftKey && ['ArrowUp', 'ArrowDown'].includes(key)) {
            event.preventDefault();
            const ids = orderedSelection(session.scene_id), indexes = ids.map(id => sessions.findIndex(item => item.scene_id === id));
            const first = Math.min(...indexes), last = Math.max(...indexes);
            if (key === 'ArrowUp' && first > 0) onMove(ids, sessions[first - 1].scene_id);
            if (key === 'ArrowDown' && last < sessions.length - 1) onMove(ids, sessions[last + 2]?.scene_id);
          } else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) {
            event.preventDefault();
            const next = key === 'Home' ? 0 : key === 'End' ? sessions.length - 1 : Math.max(0, Math.min(sessions.length - 1, index + (key === 'ArrowUp' ? -1 : 1)));
            if (event.shiftKey) range(sessions[next].scene_id, modifier);
            else if (!modifier && !event.altKey) { onSelection([sessions[next].scene_id]); anchor.current = sessions[next].scene_id; }
            focusSession(sessions[next].scene_id);
            list.current?.querySelectorAll<HTMLElement>('[data-scene-id]')[next]?.scrollIntoView({ block: 'nearest' });
          } else if (key.length === 1 && key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.nativeEvent.isComposing) {
            const now = Date.now(); typeahead.current = { text: (now - typeahead.current.time < 700 ? typeahead.current.text : '') + key.toLocaleLowerCase(), time: now };
            const next = [...sessions.slice(index + 1), ...sessions.slice(0, index + 1)].find(item => item.scene_meta.scene_label.toLocaleLowerCase().startsWith(typeahead.current.text));
            if (next) { focusSession(next.scene_id); onSelection([next.scene_id]); anchor.current = next.scene_id; }
          }
        }}>
        <span>{session.scene_meta.scene_label}</span>
        <ChatSceneStatus id={`scene-status-${session.scene_id}`} status={activity[session.scene_id]} />
      </button>}
      </div>
    </div>)}
    </GlideMenu>
    {!sessions.length && <p className="chat-session-caption">{emptyMessage}</p>}
  </nav>;
}
