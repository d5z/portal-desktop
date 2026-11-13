import type { HomeAction, HomeBounds } from '../../shared/home';
import type { HomeService } from './service';
import type { HomeViewer } from './viewer';
import type { HomeFiles } from './files';
import type { HomeConnectors } from './connectors';
import type { ConnectorNetwork } from './network';
export function registerHomeIpc(handle: (channel: string, callback: (...args: any[]) => unknown) => void, home: HomeService, viewer: HomeViewer, files: HomeFiles, connectors?: HomeConnectors, network?: ConnectorNetwork) {
  handle('beings:home-files-list', (path: unknown) => files.list(path));
  handle('beings:home-files-preview', (path: unknown) => files.preview(path));
  handle('beings:home-files-download', (path: unknown) => files.download(path));
  handle('beings:home-state', () => { home.contextChanged(); return home.state; });
  handle('beings:home-refresh', () => home.refresh());
  handle('beings:home-action', (action: HomeAction) => {
    if (!['login', 'cancel-login', 'initialize', 'bind', 'wake', 'stop', 'recreate', 'open', 'close', 'logout'].includes(action)) throw new Error('不支持的云电脑操作。');
    return home.action(action);
  });
  handle('beings:home-preview', () => { home.contextChanged(); return viewer.preview(); });
  handle('beings:home-bounds', (bounds: HomeBounds) => viewer.setBounds(bounds));
  if (connectors) {
    if (network) {
      const register = handle;
      register('beings:home-connector-network-key', () => network.key);
      handle = (channel, callback) => {
        register(channel, callback);
        if (channel !== 'beings:home-connector-open') network.handlers.set(channel.replace('beings:home-connector-', ''), callback);
      };
    }
    handle('beings:home-connector-catalog', (query: { q?: string; after?: string } = {}) => connectors.catalog(query));
    handle('beings:home-connector-installations', (after?: string) => connectors.installations(after));
    handle('beings:home-connector-installation', (installationId: string) => connectors.installation(installationId));
    handle('beings:home-connector-remove-account', (releaseId: string, connectionId: string) => connectors.removeAccount(releaseId, connectionId));
    handle('beings:home-connector-detail', (releaseId: string) => connectors.detail(releaseId));
    handle('beings:home-connector-preview', (releaseId: string, input: { connection_id?: string; method?: string; reauthorize?: boolean }) => connectors.preview(releaseId, input));
    handle('beings:home-connector-confirm', (intentId: string, input: { adopt: boolean; values?: Record<string, string> }) => connectors.confirm(intentId, input));
    handle('beings:home-connector-state', (intentId: string) => connectors.state(intentId));
    handle('beings:home-connector-advance', (intentId: string) => connectors.advance(intentId));
    handle('beings:home-connector-cancel', (intentId: string) => connectors.cancel(intentId));
    handle('beings:home-connector-open', (url: string) => connectors.openAuthorization(url));
    handle('beings:home-connector-tools', (installationId: string) => connectors.tools(installationId));
    handle('beings:home-connector-set-tool', (installationId: string, input: Parameters<HomeConnectors['setTool']>[1]) => connectors.setTool(installationId, input));
    handle('beings:home-connector-being-access', (installationId: string, enabled: boolean, expectedRevision: number) => connectors.setBeingAccess(installationId, enabled, expectedRevision));
    handle('beings:home-connector-get-being-access', (installationId: string) => connectors.beingAccess(installationId));
    handle('beings:home-connector-lifecycle', (installationId: string, action: 'enable' | 'disable' | 'uninstall', expectedRevision: number, requestId?: string) => connectors.lifecycle(installationId, action, expectedRevision, requestId));
  }
}
