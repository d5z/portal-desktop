/** DSH package identity stays separate from the existing Town HTML Plugin SDK. */
import type { DshServiceConfig } from '../../plugins/sdk/dsh';
export type { DshServiceConfig } from '../../plugins/sdk/dsh';
export interface DshPlugin {
  id: string;
  version: string;
  description: string;
  source: string;
  enabled: boolean;
  installedAt: string;
  error?: string;
  missingServices?: string[];
  limitations?: string[];
  config?: Record<string, unknown>;
  status: 'disabled' | 'active' | 'blocked' | 'error';
}
export interface DshClientModule { id: string; owner: string; url: string; inject: string[]; immediately?: boolean }
/** Host-normalized document contributions consumed by the renderer. */
export type DshDocumentInjection = { placement: 'head' | 'body'; owner?: string } & (
  | { kind: 'html'; html: string }
  | { kind: 'script-src'; src: string; type?: string }
);
export interface DshPluginState {
  modelCompatibility?: DshModelCompatibility;
  plugins: DshPlugin[];
  clients: DshClientModule[];
  injections: DshDocumentInjection[];
  routes: { kind: 'exact' | 'prefix'; path: string }[];
  error?: string;
}
export interface DshActivationFailure { id: string; installedAt: string; error: string }
export interface DshPluginAPI {
  onModelNotice?(listener: (message: string) => void): () => void;
  reportFailures(failures: DshActivationFailure[]): Promise<void>;
  state(): Promise<DshPluginState>;
  install(source?: string): Promise<boolean>;
  enable(id: string, enabled: boolean): Promise<void>;
  remove(id: string): Promise<boolean>;
  configure(id: string, config: Record<string, unknown>): Promise<void>;
}
export interface DshModelCompatibility { model?: string; supported: boolean; message: string }
export const DSH_SLOTS = ['settings.section', 'settings.trigger', 'settings.header', 'settings.action', 'settings.close', 'settings.launcher', 'settings.general.item', 'settings.plugins.tab', 'settings.onboarding', 'main', 'sidebar', 'sidebar.panellist', 'sidebar.footer', 'sidebar.footer.action', 'plugins.bundle.config', 'settings.plugin.item', 'rightbar', 'sidebar.right.pane.tab', 'shell.overlay', 'overlay', 'app.overlay'] as const;

export interface DshCommand { name: string; description?: string; input?: { hint?: string } }
export const DEFAULT_DSH_SERVICE_CONFIG: DshServiceConfig = { provider: 'openai-compatible', baseUrl: '', model: '', apiKey: '' };
