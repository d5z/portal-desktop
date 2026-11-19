import { app, type BrowserWindow } from 'electron';
import path from 'node:path';
import type { PluginEventTopic } from '../../../plugins/sdk';
import type { RegisterHandler } from '../app/ipc';
import { SettingsStore } from '../app/settings';
import { readSubagentState, subagentHealth } from '../portal/status';
import { readSubagentConfig } from '../portal/subagent-setup';
import { SceneTaskObserver } from '../portal/subagent-tasks';
import { readSubagentActivity } from '../portal/subagent-activity';
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
  const taskSnapshot = async () => {
    const endpoint = store.connection?.endpoint || '';
    const settings = store.settings, phase = portal.state.phase, pid = portal.state.pid;
    const subagent = await readSubagentState(portal.state.runtimePath || directory, pid,
      settings.portalConfigPath || path.join(directory, 'desktop-portal.toml'), endpoint);
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
  let taskPublishRevision = 0;
  const publishTasks = () => {
    const revision = ++taskPublishRevision;
    void taskSnapshot().then(snapshot => {
      // Ledger and Portal state notifications can overlap. Only the newest
      // snapshot may reach the renderer, otherwise an older read can restore
      // a stale running/error badge after a newer done state was published.
      if (revision !== taskPublishRevision) return;
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
  handle('beings:subagent-task-details', async (endpoint: string, taskIds: string[]) => {
    if (endpoint !== store.connection?.endpoint || !Array.isArray(taskIds) || taskIds.length > 200 ||
      !taskIds.every(id => typeof id === 'string' && /^sub_[a-zA-Z0-9_-]{1,100}$/.test(id))) throw new Error('无效的 subagent 任务请求。');
    const pid = portal.state.pid;
    const engine = await readSubagentState(portal.state.runtimePath || directory, pid,
      store.settings.portalConfigPath || path.join(directory, 'desktop-portal.toml'), endpoint);
    if (!engine) return [];
    const available = await sceneTasks.configure(engine.state_dir);
    const allowed = new Set(available.map(task => task.id));
    const connection = store.connection;
    const details = await Promise.all(taskIds.filter(id => allowed.has(id)).map(id =>
      readSubagentActivity(engine.state_dir, id, [connection?.token || '', connection?.relaySecret || ''])));
    return endpoint === store.connection?.endpoint && pid === portal.state.pid ? details : [];
  });
  const recentHistory = new RecentChatHistory(proxy, () => store.connection);
  handle('beings:recent-chat-history', (endpoint: string) => recentHistory.read(endpoint));
  handle('beings:subagent-config', () => readSubagentConfig(directory, store.settings));
  handle('beings:subagent-status', async () => {
    const [config, snapshot] = await Promise.all([readSubagentConfig(directory, store.settings), taskSnapshot()]);
    return subagentHealth(config, snapshot, portal.state.phase);
  });
  return { taskSnapshot };
}
