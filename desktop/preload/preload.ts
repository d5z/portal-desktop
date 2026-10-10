import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI, PortalState, TownLiveState } from '../shared/types';
const api: DesktopAPI = {
  localApps: () => ipcRenderer.invoke('beings:local-apps'),
  associateApp: entry => ipcRenderer.invoke('beings:associate-app', entry),
  unlinkApp: id => ipcRenderer.invoke('beings:unlink-app', id),
  plugins: {
    setPlacement: (id, view, placement) => ipcRenderer.invoke('beings:plugins-placement', id, view, placement),
    openWindow: (id, view, command) => ipcRenderer.invoke('beings:plugins-window-open', id, view, command),
    replyHostRequest: (id, value, error) => ipcRenderer.invoke('beings:plugins-host-reply', id, value, error),
    onHostRequest: callback => {
      const listener = (_event: unknown, request: import('../shared/plugins').PluginHostRequest) => callback(request);
      ipcRenderer.on('beings:plugin-host-request', listener);
      return () => ipcRenderer.removeListener('beings:plugin-host-request', listener);
    },
    list: () => ipcRenderer.invoke('beings:plugins-list'),
    importLocal: () => ipcRenderer.invoke('beings:plugins-import'),
    installGrove: id => ipcRenderer.invoke('beings:plugins-install', id),
    setEnabled: (id, enabled) => ipcRenderer.invoke('beings:plugins-enable', id, enabled),
    remove: id => ipcRenderer.invoke('beings:plugins-remove', id),
    open: (id, view, command, slot) => ipcRenderer.invoke('beings:plugins-open', id, view, command, slot),
    updateContext: context => ipcRenderer.invoke('beings:plugins-context', context),
    close: token => ipcRenderer.invoke('beings:plugins-close', token),
    call: (token, method, value) => ipcRenderer.invoke('beings:plugins-call', token, method, value),
    onEvent: callback => {
      const listener = (_event: unknown, event: import('../shared/plugins').PluginEvent) => callback(event);
      ipcRenderer.on('beings:plugin-event', listener);
      return () => ipcRenderer.removeListener('beings:plugin-event', listener);
    },
  },
  platform: process.platform,
  changeChatSession: (operation, value, endpoint, sceneId) => ipcRenderer.invoke('beings:chat-session', operation, value, endpoint, sceneId),
  clientStartup: enabled => ipcRenderer.invoke('beings:client-startup', enabled),
  notifications: patch => ipcRenderer.invoke('beings:notifications', patch),
  testNotification: () => ipcRenderer.invoke('beings:notification-test'),
  takeNotificationTarget: () => ipcRenderer.invoke('beings:notification-target'),
  onNotificationOpen: callback => {
    const listener = () => callback();
    ipcRenderer.on('beings:notification-open', listener);
    return () => ipcRenderer.removeListener('beings:notification-open', listener);
  },
  quit: () => ipcRenderer.invoke('beings:quit'),
  browserState: () => ipcRenderer.invoke('beings:browser-state'),
  openBrowser: url => ipcRenderer.invoke('beings:browser-open', url),
  copyText: text => ipcRenderer.invoke('beings:clipboard-copy', text),
  editChat: command => ipcRenderer.invoke('beings:chat-edit', command),
  editSelection: command => ipcRenderer.invoke('beings:selection-edit', command),
  browserAction: action => ipcRenderer.invoke('beings:browser-action', action),
  browserBounds: bounds => ipcRenderer.invoke('beings:browser-bounds', bounds),
  onBrowser: callback => {
    const listener = (_event: unknown, state: import('../shared/types').BrowserState) => callback(state);
    ipcRenderer.on('beings:browser-state', listener);
    return () => ipcRenderer.removeListener('beings:browser-state', listener);
  },
  checkUpdates: () => ipcRenderer.invoke('beings:check-updates'),
  downloadUpdate: () => ipcRenderer.invoke('beings:download-update'),
  installUpdate: () => ipcRenderer.invoke('beings:install-update'),
  cancelUpdate: () => ipcRenderer.invoke('beings:cancel-update'),
  updateState: () => ipcRenderer.invoke('beings:update-state'),
  onUpdate: callback => {
    const listener = (_event: unknown, state: import('../shared/types').UpdateState) => callback(state);
    ipcRenderer.on('beings:update-state', listener);
    return () => ipcRenderer.removeListener('beings:update-state', listener);
  },
  appearance: theme => ipcRenderer.invoke('beings:appearance', theme),
  town: query => ipcRenderer.invoke('beings:town', query),
  townLive: () => ipcRenderer.invoke('beings:town-live'),
  reconnectTown: () => ipcRenderer.invoke('beings:town-reconnect'),
  sendTown: input => ipcRenderer.invoke('beings:town-send', input),
  onTownLive: callback => {
    const listener = (_event: unknown, state: TownLiveState) => callback(state);
    ipcRenderer.on('beings:town-live', listener);
    return () => ipcRenderer.removeListener('beings:town-live', listener);
  },
  townAuth: () => ipcRenderer.invoke('beings:town-auth'),
  pairTown: input => ipcRenderer.invoke('beings:town-pair', input),
  autoPairTown: input => ipcRenderer.invoke('beings:town-auto-pair', input),
  cancelTownPair: requestId => ipcRenderer.invoke('beings:town-pair-cancel', requestId),
  saveTownToken: token => ipcRenderer.invoke('beings:town-token', token),
  localKits: () => ipcRenderer.invoke('beings:kits'),
  deleteKit: name => ipcRenderer.invoke('beings:kit-delete', name),
  importKit: () => ipcRenderer.invoke('beings:kit-import'),
  prepareKit: id => ipcRenderer.invoke('beings:kit-prepare', id),
  installKit: input => ipcRenderer.invoke('beings:kit-install', input),
  discardKit: ticket => ipcRenderer.invoke('beings:kit-discard', ticket),
  openKits: () => ipcRenderer.invoke('beings:kits-open'),
  openTownLink: route => ipcRenderer.invoke('beings:town-open', route),
  snapshot: () => ipcRenderer.invoke('beings:snapshot'),
  save: input => ipcRenderer.invoke('beings:save', input),
  beingModelCatalog: input => ipcRenderer.invoke('beings:model-catalog', input),
  beingModelConfig: patch => ipcRenderer.invoke("beings:model-config", patch),
  sceneTasks: () => ipcRenderer.invoke('beings:scene-tasks'),
  onSceneTasks: callback => {
    const listener = (_event: unknown, snapshot: import('../shared/types').SceneTaskSnapshot) => callback(snapshot);
    ipcRenderer.on('beings:scene-tasks', listener);
    return () => ipcRenderer.removeListener('beings:scene-tasks', listener);
  },
  subagentConfig: () => ipcRenderer.invoke('beings:subagent-config'),
  choose: kind => ipcRenderer.invoke('beings:choose', kind),
  startPortal: () => ipcRenderer.invoke('beings:portal-start'),
  restartPortal: () => ipcRenderer.invoke('beings:portal-restart'),
  forceStartPortal: () => ipcRenderer.invoke('beings:portal-force-start'),
  connectionDefaults: input => ipcRenderer.invoke('beings:connection-defaults', input),
  stopPortal: () => ipcRenderer.invoke('beings:portal-stop'),
  openWorkspace: () => ipcRenderer.invoke('beings:workspace'),
  openLogs: () => ipcRenderer.invoke('beings:logs'),
  collectLogs: () => ipcRenderer.invoke('beings:collect-logs'),
  portalLogReference: () => ipcRenderer.invoke('beings:portal-log-reference'),
  diagnostics: () => ipcRenderer.invoke('beings:diagnostics'),
  exportDiagnostics: () => ipcRenderer.invoke('beings:diagnostics-export'),
  openLoom: () => ipcRenderer.invoke('beings:open-loom'),
  onPortal: callback => {
    const listener = (_event: unknown, state: PortalState) => callback(state);
    ipcRenderer.on('beings:portal-state', listener);
    return () => ipcRenderer.removeListener('beings:portal-state', listener);
  },
};
if (process.isMainFrame) {
  if (process.argv.includes('--beings-plugin-window')) {
    const windowApi: import('../shared/plugins').PluginWindowAPI = {
      info: () => ipcRenderer.invoke('beings:plugin-window', 'info'),
      open: () => ipcRenderer.invoke('beings:plugin-window', 'open'),
      close: token => ipcRenderer.invoke('beings:plugin-window', 'close', token),
      call: (token, method, value) => ipcRenderer.invoke('beings:plugin-window', 'call', token, method, value),
      action: (action, value) => ipcRenderer.invoke('beings:plugin-window', 'action', action, value),
      onEvent: callback => api.plugins!.onEvent!(callback),
      onTheme: callback => {
        const listener = (_event: unknown, theme: 'light' | 'dark') => callback(theme);
        ipcRenderer.on('beings:plugin-window-theme', listener);
        return () => ipcRenderer.removeListener('beings:plugin-window-theme', listener);
      },
    };
    contextBridge.exposeInMainWorld('beingsPluginWindow', windowApi);
  } else contextBridge.exposeInMainWorld('beings', api);
}
