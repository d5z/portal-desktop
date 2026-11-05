import { Service, type Context } from '@deepseek-ai/cordis';
import type { DshClientRuntime } from './runtime';
import type { DshCommand } from '../../../shared/dsh-plugins';

export interface CommandDecoration {
  name: string;
  available?: () => boolean;
  ui: { kind: string; options(): Promise<{ id: string; label: string; detail?: string }[]>; onSelect(option: { id: string }, session: { sessionId: string }): Promise<void> };
}
export interface SidebarTab { id: string; kind: string; title(): string; guide?: { title(): string }[] }

export function installInteractions(ctx: Context, runtime: DshClientRuntime) {
  class CommandUi extends Service {
    decorations = new Map<string, CommandDecoration>();
    constructor() { super(ctx, 'commandUi'); }
    decorate(def: CommandDecoration) {
      if (this.decorations.has(def.name)) throw new Error(`命令界面重复：${def.name}`);
      this.decorations.set(def.name, def);
      return this.ctx.effect(() => () => { this.decorations.delete(def.name); });
    }
    async candidates(): Promise<DshCommand[]> {
      const result = await (ctx.get('remote.commands') as any).list();
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    }
  }
  const commandUi = new CommandUi();
  class SidebarTabs extends Service {
    constructor() { super(ctx, 'sidebarRightTabs'); }
    register(def: SidebarTab) {
      if (runtime.sidebarTabs.some(tab => tab.id === def.id || tab.kind === def.kind)) throw new Error(`侧栏标签重复：${def.id}`);
      runtime.sidebarTabs.push(def); runtime.changed();
      return this.ctx.effect(() => () => {
        runtime.sidebarTabs = runtime.sidebarTabs.filter(tab => tab !== def);
        if (runtime.activeSidebarTab === def.id) { runtime.activeSidebarTab = undefined; runtime.closeRightbar(); }
        runtime.changed();
      });
    }
  }
  new SidebarTabs();
  ctx.provide('sidebarRight', { openTab(kind: string) {
    const tab = runtime.sidebarTabs.find(tab => tab.kind === kind);
    if (!tab) throw new Error(`未知侧栏类型：${kind}`);
    runtime.activeSidebarTab = tab.id;
    (ctx.get('layout') as any).openRightbar(true, false);
  } });
  type Shortcut = { id: string; label(): string; defaults: Record<string, { code: string; modifiers: string[] }>; regions?: string[]; modals?: string[]; resolve(context: unknown): { status: string; run?(): void } };
  const shortcuts = new Map<string, Shortcut>();
  const listeners = new Set<() => void>();
  const mac = /Mac/.test(navigator.platform);
  const profile = 'desktop:' + (mac ? 'macos' : /Win/.test(navigator.platform) ? 'windows' : 'linux');
  let catalog: { id: string; label: string; keys: string[]; conflicts: string[] }[] = [];
  const signature = (binding: { code: string; modifiers: string[] }) => [binding.code, ...binding.modifiers.map(m => m === 'primary' ? mac ? 'meta' : 'control' : m).sort()].join('+');
  const reserved = new Map([[signature({code:'KeyP',modifiers:['primary','shift']}), 'Town 命令面板']]);
  const publish = () => {
    catalog = [...shortcuts.values()].map(shortcut => {
      const binding = shortcut.defaults[profile];
      const key = binding && signature(binding);
      const conflicts = key ? [...(reserved.has(key) ? [reserved.get(key)!] : []), ...[...shortcuts.values()].filter(other => other !== shortcut && other.defaults[profile] && signature(other.defaults[profile]) === key).map(other => other.id)] : [];
      return { id: shortcut.id, label: shortcut.label(), conflicts,
        keys: binding && !conflicts.length ? [...binding.modifiers.map(m => m === 'primary' ? mac ? 'Cmd+' : 'Ctrl+' : m + '+'), binding.code.replace(/^Key/, '')] : [] };
    });
    runtime.shortcutConflicts = catalog.filter(row => row.conflicts.length).map(row => `${row.label}：与 ${row.conflicts.join('、')} 冲突，快捷键未启用`);
    runtime.changed(); listeners.forEach(fn => fn());
  };
  class Shortcuts extends Service {
    catalog = { getSnapshot: () => catalog, subscribe(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); } };
    constructor() { super(ctx, 'shortcuts'); }
    register(def: Shortcut) {
      if (shortcuts.has(def.id)) throw new Error(`快捷键重复：${def.id}`);
      shortcuts.set(def.id, def); publish();
      return this.ctx.effect(() => () => { shortcuts.delete(def.id); publish(); });
    }
  }
  new Shortcuts();
  const keydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat || event.isComposing) return;
    const target = event.target instanceof Element ? event.target : null;
    const region = target?.closest('input, textarea, [contenteditable="true"]') ? 'editable' : 'page';
    const modal = document.querySelector('dialog[open]')?.id || null;
    for (const shortcut of shortcuts.values()) {
      const binding = shortcut.defaults[profile];
      if (!binding || binding.code !== event.code || catalog.find(row => row.id === shortcut.id)?.conflicts.length) continue;
      if (shortcut.regions && !shortcut.regions.includes(region)) continue;
      if (modal && !shortcut.modals?.includes(modal)) continue;
      const mods = new Set(binding.modifiers.map(m => m === 'primary' ? mac ? 'meta' : 'control' : m));
      if (event.metaKey !== mods.has('meta') || event.ctrlKey !== mods.has('control') || event.shiftKey !== mods.has('shift') || event.altKey !== mods.has('alt')) continue;
      const result = shortcut.resolve({ source: 'keyboard', region, modal, target });
      if (result.status === 'handled') { event.preventDefault(); result.run?.(); break; }
    }
  };
  ctx.effect(() => { window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown); });
  return commandUi;
}
