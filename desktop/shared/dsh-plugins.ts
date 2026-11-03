/** DSH package identity stays separate from the existing Town HTML Plugin SDK. */
export interface DshPlugin {
  id: string;
  version: string;
  description: string;
  source: string;
  enabled: boolean;
  installedAt: string;
  error?: string;
  config?: Record<string, unknown>;
  status: 'disabled' | 'active' | 'blocked' | 'error';
}
export interface DshClientModule { id: string; owner: string; url: string; inject: string[]; immediately?: boolean }
/** Host-normalized document contributions consumed by the renderer. */
export type DshDocumentInjection = { placement: 'head' | 'body' } & (
  | { kind: 'html'; html: string }
  | { kind: 'script-src'; src: string; type?: string }
);
export interface DshPluginState {
  plugins: DshPlugin[];
  clients: DshClientModule[];
  injections: DshDocumentInjection[];
  routes: { kind: 'exact' | 'prefix'; path: string }[];
  error?: string;
}
export interface DshPluginAPI {
  state(): Promise<DshPluginState>;
  install(source?: string): Promise<boolean>;
  enable(id: string, enabled: boolean): Promise<void>;
  remove(id: string): Promise<boolean>;
  configure(id: string, config: Record<string, unknown>): Promise<void>;
}
export const DSH_SLOTS = ['settings.section', 'settings.trigger', 'settings.header', 'settings.action', 'settings.close', 'settings.launcher', 'settings.general.item', 'settings.plugins.tab', 'settings.onboarding', 'main', 'sidebar', 'sidebar.panellist', 'sidebar.footer', 'sidebar.footer.action', 'plugins.bundle.config', 'settings.plugin.item', 'rightbar', 'shell.overlay', 'overlay', 'app.overlay'] as const;
