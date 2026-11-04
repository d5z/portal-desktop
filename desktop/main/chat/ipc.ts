import { app, type BrowserWindow } from 'electron';
import type { PluginEventTopic } from '../../../plugins/sdk';
import type { RegisterHandler } from '../app/ipc';
import { SettingsStore } from '../app/settings';
import { readSubagentState } from '../portal/status';
import { readSubagentConfig } from '../portal/subagent-setup';
import { SceneTaskObserver } from '../portal/subagent-tasks';
import { PortalSupervisor } from '../portal/supervisor';
import { ChatProxy } from './proxy';
import { RecentChatHistory } from './recent-history';
import { ChatSessions } from './scene';
export function registerChatIpc(options: {
  handle: RegisterHandler; directory: string; store: SettingsStore; portal: PortalSupervisor; proxy: ChatProxy;
  chatSessions?: ChatSessions; window(): BrowserWindow | null;
  publishPluginEvent(topic: PluginEventTopic): void;
}) {
  const { handle, directory, store, portal, proxy, chatSessions, window: getWindow, publishPluginEvent } = options;
  handle('beings:model-catalog', async (input: { kind: string; route?: string; api_key?: string }) => {
    if (!input || !['routes', 'models', 'keys'].includes(input.kind) ||
      (input.kind !== 'routes' && (typeof input.route !== 'string' || !input.route || input.route.length > 256)) ||
      (input.kind === 'keys' && (typeof input.api_key !== 'string' || !input.api_key.trim() || input.api_key.length > 16384)))
      throw new Error('无效的模型目录请求。');
    const path = '/api/llm/' + input.kind + (input.kind === 'models' ? '?route=' + encodeURIComponent(input.route!) : '');
    const response = await proxy.handle(new Request('beings://chat' + path, {
      method: input.kind === 'keys' ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      ...(input.kind === 'keys' ? { body: JSON.stringify({ route: input.route, api_key: input.api_key }) } : {}),
    }));
    return { status: response.status, data: await response.json().catch(() => ({ error: '无法读取模型目录。' })) };
  });
  handle('beings:model-config', async (patch?: Record<string, unknown>) => {
    if (patch !== undefined && (!patch || Array.isArray(patch) || typeof patch !== 'object' ||
      Object.entries(patch).some(([key, value]) => !['model', 'provider', 'base_url', 'api_key', 'thinking', 'temperature', 'rollback'].includes(key) || !['string', 'number', 'boolean'].includes(typeof value)) || JSON.stringify(patch).length > 16384))
      throw new Error('无效的模型配置。');
    const response = await proxy.handle(new Request('beings://chat/api/llm/config', {
      method: patch === undefined ? 'GET' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      ...(patch === undefined ? {} : { body: JSON.stringify(patch) }),
    }));
    const data = await response.json();
    if (!response.ok && patch === undefined) throw new Error(data.error || '无法读取或保存 Being 模型配置。');
    return { ...data, ...(!response.ok ? { ok: false, http_status: data.http_status || response.status } : {}) };
  });
  const taskSnapshot = async () => {
    const endpoint = store.connection?.endpoint || '';
    const settings = store.settings, phase = portal.state.phase, pid = portal.state.pid;
    const subagent = await readSubagentState(portal.state.runtimePath || directory, pid);
    const tasks = await sceneTasks.configure(subagent?.state_dir);
    const current = endpoint === store.connection?.endpoint && settings.portalConfigPath === store.settings.portalConfigPath &&
      phase === portal.state.phase && pid === portal.state.pid;
    return {
      endpoint, tasks: current ? tasks : [], subagentReady: subagent?.ready === true && phase === 'connected' && current,
      ...(subagent && current ? {
        subagentConfigured: subagent.configured,
        subagentEnabled: subagent.enabled,
      } : {}),
    };
  };
  const publishTasks = () => {
    void taskSnapshot().then(snapshot => {
      const window = getWindow();
      if (snapshot.endpoint === store.connection?.endpoint && window && !window.isDestroyed()) window.webContents.send('beings:scene-tasks', snapshot);
    });
  };
  const sceneTasks = new SceneTaskObserver(() => {
    publishPluginEvent('tasks.changed');
    publishTasks();
  }, () => new Set((chatSessions?.list(store.connection?.endpoint) || []).map(scene => scene.scene_id)));
  // The existing runtime observer also sees installation completing while the
  // connection phase stays unchanged and no task ledger exists yet.
  portal.on('state', publishTasks);
  app.once('will-quit', () => { portal.off('state', publishTasks); sceneTasks.close(); });
  handle('beings:scene-tasks', taskSnapshot);
  const recentHistory = new RecentChatHistory(proxy, () => store.connection);
  handle('beings:recent-chat-history', (endpoint: string) => recentHistory.read(endpoint));
  handle('beings:subagent-config', () => readSubagentConfig(directory, store.settings));
  return { taskSnapshot };
}
