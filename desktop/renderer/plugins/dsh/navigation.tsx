import type { ComponentType, ReactNode } from 'react';
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
  if (!runtime.navigationHost || !runtime.hasTools) return null;
  const slots = runtime.slots;
  const names = slots.some(slot => slot.name === 'sidebar') ? ['sidebar'] : ['sidebar.panellist', 'sidebar.footer', 'sidebar.footer.action'];
  const contributed = (name: string) => slots.some(slot => slot.name === name && runtime.state.plugins.some(plugin => plugin.id === slot.owner && plugin.enabled));
  return createPortal(
    <div className="dsh-rail-entries">
      {names.map(name => <Boundary key={name} resetKey={runtime.lifecycleVersion} fallback={<button aria-label="插件入口加载失败，打开插件管理" onClick={() => runtime.openManager()}>插件入口加载失败</button>}>
        <DshSlot name={name} owner={{ wide: false }} />
      </Boundary>)}
      {contributed('settings.launcher') && <Boundary resetKey={runtime.lifecycleVersion}><DshSlot name="settings.launcher" owner={{ wide: false, settingsOpen: runtime.managerOpen, openSettings: () => runtime.openManager(), openOnboarding }} /></Boundary>}
      {contributed('settings.trigger') && <Boundary resetKey={runtime.lifecycleVersion}><button aria-label="插件设置" onClick={() => runtime.openManager()}><DshSlot name="settings.trigger" owner={{ wide: false }} /></button></Boundary>}
    </div>, runtime.navigationHost);
}
