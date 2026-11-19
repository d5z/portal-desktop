import { dropdownMenuPopover } from '../components/animate-ui/dropdown-menu-motion';
import { Icon } from '../icons/icon';
import { useUIToast } from './feedback';
import { CodeClipboard } from '../components/clipboard';
import type { AppSelections } from './surfaces';
import { memo, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { applyUIChanges, evaluate, reconcileState, reconcileUpdatedState, type UIDocument, type UINode, type Value } from './runtime';
import { UIStream } from './stream';
import { loadUIState, rememberUIState, saveUIState } from './storage';
import { DataChart, DataTable, Diagram, displayValue } from './visuals';
import { Tabs, Breakdown } from './explorers';
import { ContentImage, Checklist } from './content';
import { LocalApp } from './app-host';
import { ErrorIndicator } from '../components/error-indicator';
export interface UIActions {
  onActivate?: () => void;
  onEdit?: () => void;
  storageKey?: string;
  onContinue?: (text: string) => void;
  onRepair?: (text: string) => void;
  onSnapshot?: (text: string, values?: Record<string, Value>, apps?: AppSelections, active?: boolean) => void;
  submitDisabled?: boolean;
}
export const IntelligentUI = memo(function IntelligentUI({ source, streaming = false, ...actions }: UIActions & { source: string; streaming?: boolean }) {
  const parser = useRef(new UIStream());
  const [accepted, setAccepted] = useState<UIDocument | null>(null), [error, setError] = useState('');
  const [showSource, setShowSource] = useState(false), [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  // Coalesce token bursts without remounting the currently interactive tree.
  useEffect(() => {
    const update = () => { const result = parser.current.update(source, streaming); if (result.doc) setAccepted(result.doc); setError(result.error); };
    if (!streaming) { update(); return; }
    const frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [source, streaming]);
  // Initial static rendering supports previews and non-browser tests.
  const initial = useRef<{ source: string; result: ReturnType<UIStream['update']> } | null>(null);
  if (!initial.current) initial.current = { source, result: parser.current.update(source, streaming) };
  const doc = accepted || initial.current.result.doc;
  const notice = error || (!accepted ? initial.current.result.error : '');
  const repair = actions.onRepair || actions.onContinue;
  useLayoutEffect(() => {
    const panel = dialog.current!;
    if (menu.current?.matches(':popover-open')) menu.current.hidePopover();
    if (expanded) {
      panel.showModal();
      panel.focus({ preventScroll: true });
    } else if (panel.open) panel.close();
  }, [expanded]);
  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = () => {
      if (menu.current?.matches(':popover-open')) menu.current.hidePopover();
    };
    window.addEventListener('resize', dismiss);
    document.addEventListener('scroll', dismiss, true);
    return () => {
      window.removeEventListener('resize', dismiss);
      document.removeEventListener('scroll', dismiss, true);
    };
  }, [menuOpen]);
  return <dialog ref={dialog} onPointerDownCapture={actions.onActivate} onFocusCapture={actions.onActivate}
    role={expanded ? 'dialog' : 'region'} className={`intelligent-ui${expanded ? ' iui-expanded' : ''}`}
    aria-label={expanded ? doc?.title || '交互界面' : 'Intelligent UI'} onClose={event => {
      if (event.target === event.currentTarget) setExpanded(false);
    }} onKeyDown={event => {
    if (event.key !== 'Escape') return;
    if (menu.current?.matches(':popover-open')) {
      event.preventDefault();
      event.stopPropagation();
      menu.current.hidePopover();
      more.current?.focus({ preventScroll: true });
    } else if (expanded) {
      event.stopPropagation();
    }
  }}>
    <header className="iui-toolbar">
      <span className="iui-status" role="status">{streaming && <><span className="iui-status-dot" />正在生成</>}</span>
      <div className="iui-toolbar-actions">
        {!showSource && actions.onEdit && <button type="button" disabled={streaming || actions.submitDisabled}
          title="将此界面及当前选择带入下一条消息" onClick={() => { setExpanded(false); actions.onEdit?.(); }}>修改</button>}
        <button type="button" onClick={() => setExpanded(v => !v)}
          aria-label={expanded ? '收起界面' : '展开界面'}>{expanded ? '收起' : '展开'}</button>
        <button ref={more} className="iui-menu-trigger" type="button" aria-label="界面更多选项" popoverTarget={menuId} aria-expanded={menuOpen}
          onClick={event => {
            const popup = menu.current!;
            if (popup.matches(':popover-open')) return;
            event.preventDefault();
            popup.showPopover();
            const anchor = event.currentTarget.getBoundingClientRect();
            const gap = 4, edge = 8;
            const { offsetWidth: width, offsetHeight: height } = popup;
            const below = anchor.bottom + gap;
            const opensBelow = below + height <= innerHeight - edge;
            popup.style.left = `${Math.max(edge, Math.min(anchor.right - width, innerWidth - width - edge))}px`;
            popup.style.top = `${Math.max(edge, opensBelow ? below : anchor.top - gap - height)}px`;
            popup.style.transformOrigin = opensBelow ? 'top right' : 'bottom right';
            popup.querySelector('button')?.focus({ preventScroll: true });
          }}><Icon name="chat-more" width="16" height="16" /></button>
        <div id={menuId} ref={menu} className="iui-menu-surface" popover="auto" {...dropdownMenuPopover}
          onToggle={event => { if (event.target === event.currentTarget) setMenuOpen(event.newState === 'open'); }}>
          <button type="button" onClick={() => {
            menu.current?.hidePopover();
            setShowSource(value => !value);
            more.current?.focus({ preventScroll: true });
          }}>{showSource ? '返回预览' : '源码'}</button>
        </div>
      </div>
    </header>
    <div className="iui-preview" hidden={showSource}>
      {!doc && streaming && <p className="iui-notice" role="status">正在接收界面描述…</p>}
      {doc && <UIRuntime doc={doc} {...actions}
        onEdit={actions.onEdit ? () => { setExpanded(false); actions.onEdit?.(); } : undefined}
        onContinue={actions.onContinue ? text => { setExpanded(false); actions.onContinue?.(text); } : undefined}
        submitDisabled={streaming || actions.submitDisabled} />}
    </div>
    {showSource && <pre className="iui-source"><code>{source}</code></pre>}
    {notice && !streaming && <div className="iui-feedback"><ErrorIndicator description={`界面未更新：${notice}${doc ? ' · 已保留可用内容' : ''}`}
      retry={repair && { label: '让 Being 修正', run: () => { setExpanded(false); repair(`请修正刚才生成的智能界面「${doc?.title || '交互界面'}」。客户端报告：${notice}。请优先按上述错误中的节点、字段和层级修正，不要猜测删除其他合法属性。node 事件的 parent 必须与 op、node 同级，不能写入 node 对象；section.value、slider.value 和 list/checklist 项目的 description 都是合法字段。保留原需求和有效内容，重新输出完整的 intelligent-ui 界面；联动结果必须实际引用绑定状态。JSON 能解析不等于客户端校验通过，未经实际验证不要声称通过。`); } }} /></div>}
  </dialog>;
});
export function UIRuntime({ doc, storageKey, onContinue, onEdit, onSnapshot, submitDisabled, onEvent, embedded = false }: UIActions & { embedded?: boolean; doc: UIDocument; onEvent?: (key: string, value: Value) => void }) {
  const prefix = useId();
  const copyText = useContext(CodeClipboard);
  const { notify, toast } = useUIToast();
  const [snapshot, setSnapshot] = useState({ doc, values: { ...doc.state } });
  const [actionStatus, setActionStatus] = useState('');
  const appSelections = useRef<AppSelections>({});
  const appIds: string[] = [];
  const findApps = (nodes: UINode[]) => { for (const node of nodes) { if (node.type === 'app') appIds.push(node.id); if (node.children) findApps(node.children); } };
  findApps(doc.body);
  const currentApps = () => Object.fromEntries(appIds.filter(id => appSelections.current[id]).map(id => [id, appSelections.current[id]]));
  const touched = useRef(new Set<string>()), loaded = useRef(false);
  const latest = useRef(snapshot.values);
  let values = snapshot.values;
  if (snapshot.doc !== doc) {
    // A Worker owns its live state. Only streamed declarative documents retain local choices.
    values = embedded ? { ...doc.state } : reconcileUpdatedState(doc, snapshot.doc, values, touched.current);
    setSnapshot({ doc, values });
  }
  latest.current = values;
  useEffect(() => {
    let active = true;
    if (!storageKey) return;
    // When a live message receives its persisted identity, migrate the current values.
    if (loaded.current) { void saveUIState(storageKey, latest.current); return; }
    void loadUIState(storageKey).then(saved => {
      if (!active) return;
      loaded.current = true;
      if (saved) setSnapshot(prev => {
        const merged = { ...saved };
        for (const key of touched.current) merged[key] = prev.values[key];
        return { doc: prev.doc, values: reconcileState(prev.doc, merged) };
      });
    });
    return () => { active = false; };
  }, [storageKey]);
  useEffect(() => {
    if (!storageKey || !loaded.current) return;
    rememberUIState(storageKey, values);
    const timer = setTimeout(() => void saveUIState(storageKey, latest.current), 300);
    return () => clearTimeout(timer);
  }, [storageKey, values]);
  useEffect(() => {
    if (!storageKey) return;
    const save = () => { if (loaded.current) void saveUIState(storageKey, latest.current); };
    window.addEventListener('pagehide', save); document.addEventListener('visibilitychange', save);
    return () => { save(); window.removeEventListener('pagehide', save); document.removeEventListener('visibilitychange', save); };
  }, [storageKey]);
  const summary = (next: Record<string, Value>) => {
    const labels = new Map<string, string>();
    const visit = (nodes: UINode[]) => { for (const n of nodes) {
      if (n.bind && n.label) labels.set(n.bind, n.label);
      for (const item of n.items || []) if (item.bind) labels.set(item.bind, item.label);
      if (n.children) visit(n.children);
    } };
    visit(doc.body);
    return `界面「${doc.title}」的当前选择：\n${Object.entries(next).map(([k, v]) => `${labels.get(k) || k}: ${displayValue(v)}`).join('\n')}`;
  };
  useEffect(() => { onSnapshot?.(summary(values), values, currentApps()); }, [values, doc]);
  const update = (key: string, value: Value) => {
    touched.current.add(key);
    const next = { ...reconcileState(doc, latest.current), [key]: value };
    latest.current = next;
    setSnapshot({ doc, values: next });
    if (storageKey) rememberUIState(storageKey, next);
    onSnapshot?.(summary(next), next, currentApps()); onEvent?.(key, value);
  };
  // Hidden actions (including inactive tabs) cannot provide a way back to chat.
  const hasVisibleContinue = (nodes: UINode[]): boolean => nodes.some(n => {
    if (n.when !== undefined && evaluate(n.when, values) !== true) return false;
    if (n.type === 'button' && n.action === 'continue') return true;
    const children = n.type === 'tabs' ? n.children?.filter(child => child.id === values[n.bind!]) : n.children;
    return !!children && hasVisibleContinue(children);
  });
  const fallbackContinue = !embedded && !!(onEdit || onContinue) && (Object.keys(values).length > 0 || appIds.length > 0) && !hasVisibleContinue(doc.body);
  const continueWithSelections = () => {
    if (submitDisabled || (!onEdit && !onContinue)) return;
    const apps = currentApps();
    const text = [summary(latest.current), ...Object.values(apps).map(app =>
      `界面「${app.title}」的当前选择：\n${Object.entries(app.values).map(([key, value]) => `${key}: ${displayValue(value)}`).join('\n')}`
    )].join('\n\n');
    onSnapshot?.(text, latest.current, apps);
    if (onEdit) onEdit();
    else onContinue?.(`请根据以下当前选择继续处理。\n\n${text}`);
  };
  async function action(n: UINode) {
    if (n.action === 'set') {
      try {
        const next = applyUIChanges(doc, latest.current, n.changes!);
        for (const key of Object.keys(n.changes!)) touched.current.add(key);
        latest.current = next; setSnapshot({ doc, values: next });
        if (storageKey) rememberUIState(storageKey, next);
        onSnapshot?.(summary(next), next, currentApps());
        for (const key of Object.keys(n.changes!)) onEvent?.(key, next[key]);
        setActionStatus('');
      } catch (error) { setActionStatus(error instanceof Error ? error.message : '操作失败'); }
      return;
    }
    if (n.action === 'event') { onEvent?.(n.id, evaluate(n.value, values)); return; }
    if (n.action === 'reset') { for (const key of Object.keys(doc.state)) touched.current.add(key); latest.current = { ...doc.state }; setSnapshot({ doc, values: latest.current }); onSnapshot?.(summary(latest.current), latest.current, currentApps()); return; }
    const text = n.value === undefined ? summary(values) : displayValue(evaluate(n.value, values));
    if (n.action === 'continue') { onContinue?.(n.value === undefined ? text : `${text}\n\n${summary(values)}`); setActionStatus('已放入输入框，可编辑后发送'); }
    else { try { await copyText(text); notify('已复制', true); } catch { notify('复制失败，请重试'); } }
  }
  function node(n: UINode): ReactNode {
    if (!n.appearance && n.when === undefined) return renderNode(n);
    const tokens = Object.entries(n.appearance || {}).map(([key, value]) => `iui-design-${key}-${value}`).join(' ');
    return <div key={n.id} className={`iui-composition ${tokens}`} hidden={n.when !== undefined && evaluate(n.when, values) !== true}>{renderNode(n)}</div>;
  }
  function renderNode(n: UINode): ReactNode {
    const id = `${prefix}-${n.id}`, value = displayValue(evaluate(n.value, values)), bound = n.bind ? values[n.bind] : null;
    switch (n.type) {
      case 'hero': return <header key={n.id} className="iui-hero">{n.meta && <small>{n.meta}</small>}<h3>{n.label || doc.title}</h3>{n.value !== undefined && <p>{value}</p>}</header>;
      case 'callout': return <aside key={n.id} className="iui-callout">{n.label && <strong>{n.label}</strong>}<p>{value}</p></aside>;
      case 'box': case 'split': return <div key={n.id} className={`iui-${n.type}`}>{n.children?.map(node)}</div>;
      case 'badge': return <span key={n.id} className="iui-badge">{value || n.label}</span>;
      case 'progress': { const amount = evaluate(n.value, values); const valid = typeof amount === 'number' && Number.isFinite(amount); return <div key={n.id} className="iui-progress"><div><label htmlFor={id}>{n.label || n.id}</label><output>{valid ? displayValue(amount) : '—'}</output></div><progress id={id} max={n.max! - n.min!} value={valid ? Math.max(0, Math.min(n.max! - n.min!, amount - n.min!)) : undefined} /></div>; }
      case 'choice': return <fieldset key={n.id} className="iui-choice"><legend>{n.label || n.id}</legend>{n.items!.map(item => <label key={item.id} className={bound === item.id ? 'selected' : ''}><input type="radio" name={id} value={item.id} checked={bound === item.id} onChange={() => update(n.bind!, item.id)} /><span><strong>{item.label}</strong>{item.description && <small>{item.description}</small>}</span></label>)}</fieldset>;
      case 'tabs': return <Tabs key={n.id} node={n} selected={String(bound)} onSelect={v => update(n.bind!, v)} render={node} />;
      case 'breakdown': return <Breakdown key={n.id} node={n} values={values} />;
      case 'grid': case 'gallery': return <div key={n.id} className={`iui-${n.type} iui-layout-${n.variant || (n.type === 'gallery' ? 'collage' : 'two')}${n.type === 'grid' && n.children?.length && n.children.every(child => child.type === 'metric') ? ' iui-summary-grid' : ''}`}>{n.children?.map(node)}</div>;
      case 'heading': { const Tag = `h${n.level || 3}` as 'h2' | 'h3' | 'h4'; return <Tag key={n.id} className="iui-heading">{n.label}</Tag>; }
      case 'divider': return <hr key={n.id} className="iui-divider" />;
      case 'facts': return <section key={n.id} className="iui-facts">{n.label && <h4>{n.label}</h4>}<dl>{n.rows!.map((row, i) => <div key={i}><dt>{displayValue(evaluate(row[0], values))}</dt><dd>{displayValue(evaluate(row[1], values))}</dd></div>)}</dl></section>;
      case 'list': return <ul key={n.id} className="iui-list">{n.items!.map(item => <li key={item.id}><strong>{item.label}</strong>{item.description && <p>{item.description}</p>}</li>)}</ul>;
      case 'media': return <article key={n.id} className="iui-media">{n.src && <ContentImage src={n.src} label={n.label} />}<div><h4>{n.label}</h4>{n.value !== undefined && <p>{value}</p>}</div></article>;
      case 'stepper': return <div key={n.id} className={`iui-stepper${n.range ? ' iui-stepper-range' : ''}`}><span id={id}>{n.label || n.id}</span><div role="group" aria-labelledby={id}><button type="button" aria-label={`减少${n.label || n.id}`} disabled={Number(bound) <= n.min!} onClick={() => update(n.bind!, Math.max(n.min!, Number((Number(latest.current[n.bind!]) - (n.step ?? 1)).toPrecision(12))))}>−</button><output aria-live="polite">{n.value === undefined ? displayValue(bound) : value}</output><button type="button" aria-label={`增加${n.label || n.id}`} disabled={Number(bound) >= n.max!} onClick={() => update(n.bind!, Math.min(n.max!, Number((Number(latest.current[n.bind!]) + (n.step ?? 1)).toPrecision(12))))}>+</button></div>{n.range && <input type="range" aria-labelledby={id} min={n.min} max={n.max} step={n.step ?? 1} value={Number(bound)} onChange={e => { const number = e.target.valueAsNumber; if (Number.isFinite(number)) update(n.bind!, Math.max(n.min!, Math.min(n.max!, number))); }} />}</div>;
      case 'stack': case 'row': return <div key={n.id} className={`iui-${n.type}`}>{n.children?.map(node)}</div>;
      case 'image': return <ContentImage key={n.id} src={n.src!} label={n.label} caption={n.value === undefined ? undefined : value} />;
      case 'section': case 'card': return <section key={n.id} className={`iui-${n.type}`}>{n.label && <h4>{n.label}</h4>}{n.value !== undefined && <p>{value}</p>}{n.children?.map(node)}</section>;
      case 'text': return <p key={n.id} className="iui-text">{n.label && <strong>{n.label} </strong>}{value}</p>;
      case 'metric': return <div key={n.id} className="iui-metric"><span>{n.label}</span><output>{value}{n.unit && <small>{n.unit}</small>}</output>{n.description && <p>{n.description}</p>}</div>;
      case 'slider': case 'number': return <div key={n.id} className={`iui-field${n.type === 'slider' ? ' iui-range-field' : ''}`}><label htmlFor={id}>{n.label || n.id}{n.type === 'slider' && <output>{n.value === undefined ? displayValue(bound) : value}</output>}</label><input id={id} type={n.type === 'slider' ? 'range' : 'number'} min={n.min} max={n.max} step={n.step ?? 1} value={Number(bound)} onChange={e => { const number = e.target.valueAsNumber; if (Number.isFinite(number)) update(n.bind!, Math.max(n.min!, Math.min(n.max!, number))); }} />{n.type === 'slider' && <div className="iui-range-scale" aria-hidden="true"><span>{n.min}</span><span>{Number(((n.min! + n.max!) / 2).toFixed(4))}</span><span>{n.max}</span></div>}</div>;
      case 'input': return <div key={n.id} className="iui-field"><label htmlFor={id}>{n.label || n.id}</label><input id={id} type="text" maxLength={10000} value={String(bound)} onChange={e => update(n.bind!, e.target.value)} /></div>;
      case 'select': return <div key={n.id} className="iui-field"><label htmlFor={id}>{n.label || n.id}</label><select id={id} value={String(bound)} onChange={e => update(n.bind!, e.target.value)}>{n.options!.map((v, i) => <option key={i} value={v}>{v}</option>)}</select></div>;
      case 'segmented': return <div key={n.id} className="iui-field"><span>{n.label}</span><div className={`iui-segments${n.variant === 'quiet' ? ' iui-segments-quiet' : ''}`} role="group" aria-label={n.label}>{n.options!.map(v => <button key={v} type="button" aria-pressed={v === bound} onClick={() => update(n.bind!, v)}>{v}</button>)}</div></div>;
      case 'toggle': return <label key={n.id} className="iui-toggle"><input type="checkbox" checked={Boolean(bound)} onChange={e => update(n.bind!, e.target.checked)} />{n.label || n.id}</label>;
      case 'button': return <button key={n.id} type="button" className={`iui-reset${n.variant ? ` iui-button-${n.variant}` : ''}`} disabled={n.action === 'continue' && (!onContinue || submitDisabled) || n.action === 'event' && !onEvent} onClick={() => void action(n)}>{n.label || '重置'}</button>;
      case 'table': return <DataTable key={n.id} node={n} values={values} />;
      case 'chart': return <DataChart key={n.id} node={n} values={values} />;
      case 'diagram': return <Diagram key={n.id} node={n} selected={String(bound)} explode={Number(values[n.explodeBind!] || 0)} onExplode={v => n.explodeBind && update(n.explodeBind, v)} onSelect={part => update(n.bind!, part)} />;
      case 'timeline': case 'checklist': return <Checklist key={n.id} node={n} values={values} onChange={update} />;
      case 'app': return <LocalApp key={n.id} code={n.code!} label={n.label} onRepair={onContinue} storageKey={storageKey ? `${storageKey}:${n.id}` : undefined} render={(next, event) => <UIRuntime embedded doc={next} onContinue={onContinue} onSnapshot={(text, values) => {
        appSelections.current[n.id] = { title: next.title, values: { ...values } };
        onSnapshot?.(`${summary(latest.current)}\n\n${text}`, latest.current, currentApps());
      }} submitDisabled={submitDisabled} onEvent={event} />} />;
    }
  }
  return <div className="iui-body">{toast}{!embedded && doc.body[0]?.type !== 'hero' && <h3>{doc.title}</h3>}{doc.body.map(node)}{fallbackContinue && <div className="iui-continue"><button type="button" className="iui-reset iui-button-primary" disabled={submitDisabled} onClick={continueWithSelections}>用当前选择继续</button></div>}{actionStatus && <p className="iui-action-status" role="status">{actionStatus}</p>}</div>;
}
