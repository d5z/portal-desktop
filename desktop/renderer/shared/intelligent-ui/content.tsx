import { useContext, useState } from 'react';
import { evaluate, type UINode, type Value } from './runtime';
import { displayValue } from './visuals';
import { useUIToast } from './feedback';
import { CodeClipboard } from '../components/clipboard';
import { RemoteImage } from '../components/remote-image';

/** Keep useful captions when an optional remote asset fails; never show a broken image icon. */
export function ContentImage({ src, label, caption }: { src: string; label?: string; caption?: string }) {
  const [failed, setFailed] = useState<string>();
  const unavailable = failed === src;
  return <figure className={`iui-image${unavailable ? ' iui-image-unavailable' : ''}`}>
    {!unavailable && <RemoteImage src={src} name={label || caption || '图片'} onError={() => setFailed(src)} />}
    {(caption || unavailable && label) && <figcaption>{caption || label}{unavailable && <span className="iui-image-note"> · 图片暂不可用</span>}</figcaption>}
  </figure>;
}

export function Checklist({ node, values, onChange }: { node: UINode; values: Record<string, Value>; onChange: (key: string, value: Value) => void }) {
  const copyText = useContext(CodeClipboard);
  const items = node.items!;
  const checkable = node.checkable !== false;
  const done = items.filter(item => item.bind && values[item.bind]).length;
  const { notify, toast } = useUIToast();
  const groups = [...new Set(items.map(item => item.group || ''))];
  async function copy() {
    const text = [node.label, ...groups.flatMap(group => [group, ...items.filter(item => (item.group || '') === group).map(item => `${item.bind && values[item.bind] ? '[✓]' : '[ ]'} ${item.label}${item.value !== undefined ? ` · ${displayValue(evaluate(item.value, values))}` : ''}${item.description ? ` — ${item.description}` : ''}`)])].filter(Boolean).join('\n');
    try { await copyText(text); notify('已复制', true); } catch { notify('复制失败，请重试'); }
  }
  return <section className={`iui-timeline${checkable ? ' iui-checklist' : ' iui-numbered-timeline'}`}>
    <div className="iui-checklist-heading"><div>{node.label && <h4>{node.label}</h4>}{node.description && <p className="iui-task-description">{node.description}</p>}</div>{node.copyable && <button type="button" onClick={() => void copy()}>复制清单</button>}{checkable && <span role="status" aria-live="polite">{done} / {items.length} 已完成</span>}</div>
    {toast}
    {checkable && <progress aria-label={`${node.label || '清单'}完成进度`} value={done} max={Math.max(1, items.length)} />}
    {groups.map(group => <div className="iui-task-group" key={group}>{group && <h5>{group}</h5>}<ol>{items.filter(item => (item.group || '') === group).map(item => {
      const checked = Boolean(item.bind && values[item.bind]);
      const content = <><span className="iui-task-content"><strong>{item.label}</strong>{item.description && <span className="iui-task-description">{item.description}</span>}</span>{item.time && <span className="iui-task-time">{item.time}</span>}{item.value !== undefined && <span className="iui-task-value">{displayValue(evaluate(item.value, values))}</span>}</>;
      return <li key={item.id} data-complete={checkable && checked}>
        {checkable && item.bind ? <label><input type="checkbox" aria-label={item.label} checked={checked} onChange={e => onChange(item.bind!, e.target.checked)} />{content}</label> : <div className="iui-timeline-entry"><span className="iui-timeline-number" aria-hidden="true">{items.indexOf(item) + 1}</span>{content}</div>}
      </li>;
    })}</ol></div>)}
  </section>;
}
