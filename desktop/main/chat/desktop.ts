import { app, net } from 'electron';
import os from 'node:os';
import type { ChatScene } from '../../shared/types';
import type { ClientErrorLog } from '../app/error-log';
import type { RegisterHandler } from '../app/ipc';
import type { Exclusive } from '../app/mutations';
import type { SettingsStore } from '../app/settings';
import type { BackgroundPortal } from '../portal/background';
import type { PortalSupervisor } from '../portal/supervisor';
import { ChatProxy } from './proxy';
import { ChatSessions, loadDesktopScene } from './scene';
import { withScenePortal } from './scene-portal';

export async function createDesktopChat(options: {
  directory: string; store: SettingsStore; portal: PortalSupervisor; background: BackgroundPortal; errorLog: ClientErrorLog;
}) {
  const { directory, store, portal, background, errorLog } = options;
  let chatScene: ChatScene | undefined;
  let chatSceneNotice: string | undefined;
  let chatSessions: ChatSessions | undefined;
  try {
    chatScene = await loadDesktopScene(directory, app.getVersion(), os.hostname());
    const sessions = new ChatSessions(directory, chatScene);
    await sessions.load();
    chatSessions = sessions;
  }
  catch { chatSceneNotice = '桌面场景标识未能读取或保存，暂时无法发送消息。请检查客户端配置目录后重启。'; }
  const sceneWithPortal = (scene: ChatScene | undefined) => withScenePortal(scene, portal.state, store.connection?.endpoint);
  const proxy = new ChatProxy(() => store.connection, (url, init) => init?.body instanceof ReadableStream ? fetch(url, init) : net.fetch(url as string, init), () => sceneWithPortal(chatSessions?.current(store.connection?.endpoint) || chatScene), id => sceneWithPortal(chatSessions?.list(store.connection?.endpoint).find(scene => scene.scene_id === id)), true);
  const currentPluginScene = () => chatSessions?.current(store.connection?.endpoint) || chatScene;
  return {
    proxy, sessions: chatSessions, currentScene: currentPluginScene,
    registerSessions(handle: RegisterHandler, exclusive: Exclusive, notice: () => string | undefined, closePluginSessions: () => void) {
      const snapshot = () => ({ settings: store.settings, portal: portal.state, background: background.state, chatScene: sceneWithPortal(chatSessions?.current(store.connection?.endpoint) || chatScene), chatSessions: chatSessions?.list(store.connection?.endpoint).map(scene => sceneWithPortal(scene)!), notice: [notice() && errorLog.report('startup-notice', notice()), chatSceneNotice].filter(Boolean).join('\n') || undefined });
      handle('beings:chat-session', (operation: string, value: string, endpoint: string, sceneId?: string) => exclusive(async () => {
        if (!chatSessions || !store.connection) throw new Error('请先连接 Being，或检查场景目录。');
        if (endpoint !== store.connection.endpoint) throw new Error('Being 连接已切换，请重试。');
        if (!['create', 'bind', 'select', 'rename', 'delete'].includes(operation)) throw new Error('无效的场景操作。');
        const previousPluginScene = JSON.stringify(currentPluginScene());
        await chatSessions.change(endpoint, operation as 'create' | 'bind' | 'select' | 'rename' | 'delete', value, sceneId);
        if (JSON.stringify(currentPluginScene()) !== previousPluginScene) closePluginSessions();
        return snapshot();
      }));
      // Initial reads wait for configuration validation and upgrade recovery.
      handle('beings:snapshot', () => exclusive(async () => snapshot()));
      return snapshot;
    },
  };
}
