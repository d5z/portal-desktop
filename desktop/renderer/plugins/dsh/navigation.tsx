import { useId, useState, type ComponentType, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useModel } from '../../shared/hooks/use-model';
import { dshRuntime, DshSlot } from './runtime';

/** Portal from the native slot root so stores, locale and injected actions keep
 * their DSH context while Town owns the navigation's position and sizing. */
export function DshNavigation({ boundary: Boundary, openOnboarding }: {
  boundary: ComponentType<{ children: ReactNode; fallback?: ReactNode; resetKey?: number }>;
  openOnboarding: (id: string) => void;
}) {
  const runtime = useModel(dshRuntime);
  const tooltipId = useId();
  const [tip, setTip] = useState<{ label: string; left: number; top: number } | null>(null);
  if (!runtime.navigationHost || !runtime.hasTools) return null;
  const show = (target: EventTarget) => {
    const button = target instanceof Element ? target.closest<HTMLElement>('button, a[href], [role=button]') : null;
    if (!button || button.matches(':disabled')) return;
    const label = button.getAttribute('aria-label') || button.title || button.textContent?.trim();
    if (!label) return;
    const bounds = button.getBoundingClientRect();
    setTip({ label, left: bounds.right + 12, top: Math.max(24, Math.min(innerHeight - 24, bounds.top + bounds.height / 2)) });
  };
  const slots = runtime.slots;
  const names = slots.some(slot => slot.name === 'sidebar') ? ['sidebar'] : ['sidebar.panellist', 'sidebar.footer', 'sidebar.footer.action'];
  const contributed = (name: string) => slots.some(slot => slot.name === name && runtime.state.plugins.some(plugin => plugin.id === slot.owner && plugin.enabled));
  return createPortal(<>
    <div className="dsh-rail-entries" onMouseOver={event => show(event.target)} onMouseLeave={() => setTip(null)}
      onFocus={event => show(event.target)} onBlur={() => setTip(null)} onPointerDown={() => setTip(null)}
      onClick={() => setTip(null)} onKeyDown={event => { if (event.key === 'Escape') setTip(null); }}>
      {names.map(name => <Boundary key={name} resetKey={runtime.lifecycleVersion} fallback={<button aria-label="插件入口加载失败，打开插件管理" onClick={() => runtime.openManager()}>插件入口加载失败</button>}>
        <DshSlot name={name} owner={{ wide: false }} />
      </Boundary>)}
      {contributed('settings.launcher') && <Boundary resetKey={runtime.lifecycleVersion}><DshSlot name="settings.launcher" owner={{ wide: false, settingsOpen: runtime.managerOpen, openSettings: () => runtime.openManager(), openOnboarding }} /></Boundary>}
      {contributed('settings.trigger') && <Boundary resetKey={runtime.lifecycleVersion}><button aria-label="插件设置" onClick={() => runtime.openManager()}><DshSlot name="settings.trigger" owner={{ wide: false }} /></button></Boundary>}
    </div>
    {tip && createPortal(<div id={tooltipId} role="tooltip" className="rail-tooltip" style={{ left: tip.left, top: tip.top }}>{tip.label}</div>, document.body)}
  </>, runtime.navigationHost);
}
