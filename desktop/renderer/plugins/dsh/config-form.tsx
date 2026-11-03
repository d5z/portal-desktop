import { cloneElement, useEffect, useState, useSyncExternalStore } from 'react';
import { dshRuntime } from './runtime';
/** Schema-driven fallback for plugins that do not register their own configuration page. */
export function DshConfigForm({ view, onState }: { view: any; onState: (state: { dirty: boolean; busy: boolean }) => void }) {
  const form = dshRuntime.configForm(view.ns);
  const snapshot: any = useSyncExternalStore(form.subscribe.bind(form), form.getSnapshot.bind(form));
  const [edits, setEdits] = useState<Record<string, { op: string; path: string[]; value?: unknown }>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [jsonDrafts, setJsonDrafts] = useState<Record<string, string>>({});
  const [invalid, setInvalid] = useState<Record<string, string>>({});
  const dirty = !!(Object.keys(edits).length || Object.keys(jsonDrafts).length);
  useEffect(() => { onState({ dirty, busy }); }, [dirty, busy, onState]);
  useEffect(() => () => onState({ dirty: false, busy: false }), [onState]);
  const edit = (path: string[], value: unknown, op = 'set') => {
    const key = JSON.stringify(path);
    setError('');
    setInvalid(current => { const next = { ...current }; delete next[key]; return next; });
    setEdits(current => ({ ...current, [key]: { op, path, value } }));
    if (op === 'unset') setJsonDrafts(current => { const next = { ...current }; delete next[key]; return next; });
  };
  const fields = (schema: any, value: any, basePath: string[] = []): React.ReactNode => Object.entries(schema?.dict || {}).map(([name, field]: [string, any]) => {
    if (field.meta?.hidden) return null;
    const path = [...basePath, name], key = JSON.stringify(path), pending = edits[key];
    const inherited = path.reduce((value, key) => value?.[key], snapshot.base);
    const current = pending ? pending.op === 'set' ? pending.value : inherited ?? field.meta?.default : value?.[name];
    const label = field.meta?.description || name;
    if (field.type === 'object') return <fieldset key={key}><legend>{label}</legend>{fields(field, value?.[name], path)}</fieldset>;
    const choices = field.type === 'union' && field.list?.every((item: any) => item.type === 'const') ? field.list.map((item: any) => item.value) : undefined;
    const control = choices ? <select value={String(current ?? '')} onChange={e => edit(path, choices.find((item: any) => String(item) === e.target.value))}>{choices.map((item: any) => <option key={String(item)}>{String(item)}</option>)}</select>
      : field.type === 'boolean' ? <input type="checkbox" checked={!!current} onChange={e => edit(path, e.target.checked)} />
      : ['number', 'natural', 'integer'].includes(field.type) ? <input type="number" value={String(current ?? '')} min={field.meta?.min} max={field.meta?.max} onChange={e => edit(path, e.target.value === '' ? undefined : Number(e.target.value))} />
      : field.type === 'string' ? <input type={field.meta?.role === 'secret' ? 'password' : 'text'} value={String(current ?? '')} autoComplete="off" placeholder={field.meta?.role === 'secret' ? '输入新值以替换' : ''} onChange={e => edit(path, e.target.value)} />
      : <textarea value={jsonDrafts[key] ?? JSON.stringify(current ?? null, null, 2)} aria-invalid={!!invalid[key]} onChange={e => {
        setJsonDrafts(current => ({ ...current, [key]: e.target.value }));
        try { edit(path, JSON.parse(e.target.value)); }
        catch { setInvalid(current => ({ ...current, [key]: `${name} 需要有效 JSON` })); }
      }} />;
    return <div className="dsh-config-field" key={key}><label><span>{label}</span>{cloneElement(control, { 'aria-label': label })}</label><button type="button" className="secondary" onClick={() => edit(path, undefined, 'unset')}>恢复默认</button></div>;
  });
  return <form className="dsh-config-form" onSubmit={async event => { event.preventDefault(); if (busy || Object.keys(invalid).length || snapshot.status !== 'ready' || !snapshot.writable) return; setBusy(true); setError(''); try { if (await form.mutate(Object.values(edits), snapshot.revision)) { setEdits({}); setJsonDrafts({}); } else setError('配置已变化或校验未通过，请检查后重试。'); } catch (error) { setError(String(error)); } finally { setBusy(false); } }}>
    <fieldset disabled={busy || snapshot.status !== 'ready' || !snapshot.writable}>{fields(view.schema, snapshot.value)}</fieldset>
    {error && <p role="alert">{error}</p>}
    {Object.entries(invalid).map(([key, message]) => <p key={key} role="alert">{message}</p>)}
    <button className="primary" disabled={busy || !!Object.keys(invalid).length || snapshot.status !== 'ready' || !snapshot.writable || !Object.keys(edits).length}>{busy ? '正在保存…' : '保存配置'}</button>
  </form>;
}
