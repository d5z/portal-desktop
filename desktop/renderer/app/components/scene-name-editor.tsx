import { useEffect, useRef, useState } from 'react';
import type { ChatScene } from '../../../shared/types';

/** Inline editing keeps the row, its status and the user's place in the list. */
export function SceneNameEditor({ scene, onSave, onClose }: {
  scene: ChatScene; onSave: (id: string, name: string) => Promise<void>;
  onClose: (restoreFocus: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false), pending = useRef(false), composing = useRef(false);
  const [value, setValue] = useState(scene.scene_meta.scene_label);
  const [error, setError] = useState(''), [saving, setSaving] = useState(false);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const save = async (restoreFocus: boolean) => {
    if (finished.current || pending.current || composing.current) return;
    const name = value.trim();
    if (!name || name.length > 128 || /[\r\n\u0000-\u001f]/.test(name)) {
      setError('请输入 1–128 个字符的场景名称'); input.current?.focus(); return;
    }
    if (name === scene.scene_meta.scene_label) { finished.current = true; onClose(restoreFocus); return; }
    pending.current = true; setSaving(true); setError('');
    try { await onSave(scene.scene_id, name); finished.current = true; onClose(restoreFocus); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      input.current?.focus();
    } finally { pending.current = false; setSaving(false); }
  };
  return <div className="chat-session-inline-editor" onPointerDown={event => event.stopPropagation()}
    onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
    onContextMenu={event => event.stopPropagation()}>
    <input ref={input} aria-label="场景名称" value={value} maxLength={128} readOnly={saving} aria-busy={saving}
      aria-invalid={!!error} aria-describedby={error ? `scene-name-error-${scene.scene_id}` : undefined}
      onChange={event => { setValue(event.target.value); setError(''); }}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onBlur={() => void save(false)} onKeyDown={event => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
        if (event.key === 'Enter') { event.preventDefault(); void save(true); }
        if (event.key === 'Escape' && !pending.current) { event.preventDefault(); finished.current = true; onClose(true); }
      }} />
    {saving && <span className="sidebar-sr-only" role="status">正在保存场景名称</span>}
    {error && <span id={`scene-name-error-${scene.scene_id}`} role="alert" className="chat-session-name-error">{error}</span>}
  </div>;
}
