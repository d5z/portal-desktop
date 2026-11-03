import { useEffect, useRef } from 'react';
import { templates, toUIStream } from '../../shared/intelligent-ui/templates';
import { IntelligentUI } from '../../shared/intelligent-ui/view';
import clsx from 'clsx';
import styles from './intelligent-ui-examples.module.scss';

export type UIExampleId = keyof typeof templates;

export function IntelligentUIExamples({ example, overlay, embedded = false, onSelect, onClose, onContinue }: {
  example: UIExampleId; overlay: boolean; embedded?: boolean; onSelect: (example: UIExampleId) => void; onClose: () => void; onContinue: (text: string) => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { (close.current || panel.current?.querySelector('select'))?.focus(); }, []);
  return <aside ref={panel} className={clsx(styles.panel, embedded && styles.embedded)} data-slot="ui-examples-panel" role={overlay ? 'dialog' : 'complementary'} aria-modal={overlay || undefined} aria-label="智能 UI 交互示例"
    onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
      if (!overlay || event.key !== 'Tab') return;
      const controls = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select, input, [tabindex="0"], summary') || [])].filter(element => element.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    {!embedded && <header className={styles.header}><div><span>智能 UI</span><h2>交互示例</h2></div>
      <button ref={close} type="button" aria-label="关闭交互示例" onClick={onClose}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
    </header>}
    <div className={styles.picker}><label htmlFor="iui-example-select">探索示例</label><select id="iui-example-select" aria-label="选择交互示例" value={example} onChange={event => onSelect(event.target.value as UIExampleId)}>
      {Object.entries(templates).map(([id, document]) => <option key={id} value={id}>{document.title}</option>)}
    </select><p>试着调整控件，看看内容如何随之变化。</p></div>
    <div className={styles.content} key={example}><IntelligentUI source={toUIStream(templates[example])} onContinue={onContinue}/></div>
  </aside>;
}
