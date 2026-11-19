import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { DesktopAPI, PortalState, TownLiveState } from '../shared/types';
import { CONNECTOR_NETWORK_METHODS, connectorNetworkPath, homeErrorMessage } from '../shared/home';

async function connectorRequest(operation: keyof typeof CONNECTOR_NETWORK_METHODS, ...args: unknown[]): Promise<any> {
  const key = await ipcRenderer.invoke('beings:home-connector-network-key');
  const home = await ipcRenderer.invoke('beings:home-state');
  const method = CONNECTOR_NETWORK_METHODS[operation];
  const requestArgs = [...args];
  const url = new URL(`beings://desktop${connectorNetworkPath(operation, requestArgs)}`);
  let body: unknown;
  let sessionVersion = home.sessionVersion;
  if (operation === 'catalog' || operation === 'legacy-catalog') {
    const query = (requestArgs[0] || {}) as { q?: string; after?: string };
    url.searchParams.set('limit', '12');
    if (query.q?.trim()) {
      let q = '';
      for (const character of query.q.trim()) { if (new TextEncoder().encode(q + character).length > 100) break; q += character; }
      if (q) url.searchParams.set('q', q);
    }
    if (query.after) url.searchParams.set('after', query.after);
  } else if (operation === 'installations' || operation === 'local-kit-history') {
    url.searchParams.set('limit', operation === 'installations' ? '50' : '12');
    if (requestArgs[0]) url.searchParams.set('after', String(requestArgs[0]));
  } else if (operation === 'lifecycle') {
    body = { action: requestArgs[0], expected_revision: requestArgs[1], request_id: requestArgs[2] || crypto.randomUUID() };
  } else if (operation === 'being-access') {
    body = { enabled: requestArgs[0], expected_revision: requestArgs[1] };
  } else if (method !== 'GET') {
    body = requestArgs[0];
    if (operation === 'report-local-kit-history' && requestArgs[1] !== undefined) sessionVersion = requestArgs[1];
  }
  const response = await fetch(url.href, {
    method, credentials: 'omit', cache: 'no-store',
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), 'X-Connector-Access': key, 'X-Home-Session': String(sessionVersion) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 204) return;
  const text = await response.text();
  let value: any;
  try { value = text ? JSON.parse(text) : undefined; }
  catch { if (response.ok) throw new Error('Connector 返回无效响应。'); }
  if (!response.ok) {
    const code = typeof value?.error === 'string' ? value.error : '';
    const message = homeErrorMessage(response.status, code);
    if (operation === 'catalog' && [404, 405].includes(response.status)) return connectorRequest('legacy-catalog', ...args);
    if (operation === 'lifecycle' && response.status === 409) return { accepted: false, message };
    throw Object.assign(new Error(message), { status: response.status, code });
  }
  if (operation === 'lifecycle') return { accepted: true };
  if (!value) throw new Error('Connector 返回空响应。');
  // Presentation normalization happens after DevTools has received the original body.
  if (operation === 'catalog' || operation === 'legacy-catalog' || operation === 'detail') {
    const items = operation === 'detail' ? [value] : value.items;
    if (!Array.isArray(items)) throw new Error('统一应用目录响应无效。');
    for (const item of items) if (item.icon_url) item.icon_url = new URL(item.icon_url, 'https://home.beings.town/').href;
  }
  return value;
}

const api: DesktopAPI = {
  home: {
    connectors: {
      catalog: query => connectorRequest('catalog', query),
      localKitHistory: after => connectorRequest('local-kit-history', after),
      reportLocalKitHistory: (input, sessionVersion) => connectorRequest('report-local-kit-history', input, sessionVersion),
      installations: after => connectorRequest('installations', after),
      installation: installationId => connectorRequest('installation', installationId),
      removeAccount: (releaseId, connectionId) => connectorRequest('remove-account', releaseId, connectionId),
      detail: releaseId => connectorRequest('detail', releaseId),
      preview: (releaseId, input) => connectorRequest('preview', releaseId, input),
      confirm: (intentId, input) => connectorRequest('confirm', intentId, input),
      state: intentId => connectorRequest('state', intentId),
      advance: intentId => connectorRequest('advance', intentId),
      cancel: intentId => connectorRequest('cancel', intentId),
      openAuthorization: url => ipcRenderer.invoke('beings:home-connector-open', url),
      tools: installationId => connectorRequest('tools', installationId),
      setTool: (installationId, input) => connectorRequest('set-tool', installationId, input),
      setBeingAccess: (installationId, enabled, expectedRevision) => connectorRequest('being-access', installationId, enabled, expectedRevision),
      beingAccess: installationId => connectorRequest('get-being-access', installationId),
      lifecycle: (installationId, action, expectedRevision, requestId) => connectorRequest('lifecycle', installationId, action, expectedRevision, requestId),
    },
    files: {
      list: path => ipcRenderer.invoke('beings:home-files-list', path),
      preview: path => ipcRenderer.invoke('beings:home-files-preview', path),
      download: path => ipcRenderer.invoke('beings:home-files-download', path),
    },
    state: () => ipcRenderer.invoke('beings:home-state'),
    refresh: () => ipcRenderer.invoke('beings:home-refresh'),
    action: action => ipcRenderer.invoke('beings:home-action', action),
    bounds: bounds => ipcRenderer.invoke('beings:home-bounds', bounds),
    preview: () => ipcRenderer.invoke('beings:home-preview'),
    onExpand: callback => {
      const listener = () => callback();
      ipcRenderer.on('beings:home-expand', listener);
      return () => ipcRenderer.removeListener('beings:home-expand', listener);
    },
    subscribe: callback => {
      const listener = (_event: unknown, state: import('../shared/home').HomeState) => callback(state);
      ipcRenderer.on('beings:home-state', listener);
      return () => ipcRenderer.removeListener('beings:home-state', listener);
    },
  },
  dshPlugins: {
    onModelNotice: callback => {
      const listener = (_event: unknown, message: string) => callback(message);
      ipcRenderer.on('beings:dsh-model-notice', listener);
      return () => ipcRenderer.removeListener('beings:dsh-model-notice', listener);
    },
    reportFailures: failures => ipcRenderer.invoke('beings:dsh-activation-failures', failures),
    state: () => ipcRenderer.invoke('beings:dsh-state'),
    install: source => ipcRenderer.invoke('beings:dsh-install', source),
    enable: (id, enabled) => ipcRenderer.invoke('beings:dsh-enable', id, enabled),
    remove: id => ipcRenderer.invoke('beings:dsh-remove', id),
    configure: (id, config) => ipcRenderer.invoke('beings:dsh-configure', id, config),
  },
  checkLocalFiles: paths => ipcRenderer.invoke('beings:local-files-check', paths),
  revealLocalFile: path => ipcRenderer.invoke('beings:local-file-reveal', path),
  previewLocalFile: path => ipcRenderer.invoke('beings:local-file-preview', path),
  releaseLocalFilePreview: id => ipcRenderer.invoke('beings:local-file-release', id),
  downloadDirectory: change => ipcRenderer.invoke('beings:download-directory', change === true),
  registerAttachmentSource: file => ipcRenderer.invoke('beings:attachment-source',webUtils.getPathForFile(file)),
  localApps: () => ipcRenderer.invoke('beings:local-apps'),
  associateApp: entry => ipcRenderer.invoke('beings:associate-app', entry),
  unlinkApp: id => ipcRenderer.invoke('beings:unlink-app', id),
  plugins: {
    setIcon: (id, view, icon) => ipcRenderer.invoke('beings:plugins-icon', id, view, icon),
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
    setSidebarSlotVisible: (id, slot, visible) => ipcRenderer.invoke('beings:plugins-sidebar-slot-visible', id, slot, visible),
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
  notifySceneActivity: (endpoint, activity) => ipcRenderer.invoke('beings:scene-notification', endpoint, activity),
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
  copyImage: (data, mime) => ipcRenderer.invoke('beings:clipboard-image', data, mime),
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
  localKitHistoryCandidates: () => ipcRenderer.invoke('beings:kit-history-candidates'),
  localKits: () => ipcRenderer.invoke('beings:kits'),
  deleteKit: name => ipcRenderer.invoke('beings:kit-delete', name),
  importKit: () => ipcRenderer.invoke('beings:kit-import'),
  prepareKit: id => ipcRenderer.invoke('beings:kit-prepare', id),
  installKit: input => ipcRenderer.invoke('beings:kit-install', input),
  discardKit: ticket => ipcRenderer.invoke('beings:kit-discard', ticket),
  openKits: () => ipcRenderer.invoke('beings:kits-open'),
  openTownLink: route => ipcRenderer.invoke('beings:town-open', route),
  snapshot: () => ipcRenderer.invoke('beings:snapshot'),
  save: async input => {
    if (input.subagentInherit === undefined && !input.subagentSetup) return ipcRenderer.invoke('beings:save', input);
    const { key, url, body } = await ipcRenderer.invoke('beings:subagent-network-prepare', input);
    const response = await fetch(url, {
      method: 'POST', credentials: 'omit', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Subagent-Access': key },
      body,
    });
    // DevTools retains the original response; the form displays the safe summary.
    if (!response.ok && response.headers.has('X-Subagent-Error')) {
      await response.arrayBuffer();
      throw new Error(decodeURIComponent(response.headers.get('X-Subagent-Error')!));
    }
    if (!response.ok) {
      const value = await response.json();
      throw new Error(value.error || `subagent 配置失败（HTTP ${response.status}）。`);
    }
    await response.arrayBuffer();
    return ipcRenderer.invoke('beings:subagent-network-result', key);
  },
  toolApprovalPending: () => ipcRenderer.invoke('beings:tool-approval-pending'),
  answerToolApproval: (id, allowed) => ipcRenderer.invoke('beings:tool-approval-answer', id, allowed),
  onToolApproval: callback => {
    const listener = (_event: unknown, value: import('../shared/security').ToolApprovalView | null) => callback(value);
    ipcRenderer.on('beings:tool-approval', listener);
    return () => ipcRenderer.removeListener('beings:tool-approval', listener);
  },
  sceneTasks: () => ipcRenderer.invoke('beings:scene-tasks'),
  subagentTaskDetails: (endpoint, taskIds) => ipcRenderer.invoke('beings:subagent-task-details', endpoint, taskIds),
  recentChatHistory: endpoint => ipcRenderer.invoke('beings:recent-chat-history', endpoint),
  onSceneTasks: callback => {
    const listener = (_event: unknown, snapshot: import('../shared/types').SceneTaskSnapshot) => callback(snapshot);
    ipcRenderer.on('beings:scene-tasks', listener);
    return () => ipcRenderer.removeListener('beings:scene-tasks', listener);
  },
  subagentConfig: () => ipcRenderer.invoke('beings:subagent-config'),
  subagentStatus: () => ipcRenderer.invoke('beings:subagent-status'),
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
