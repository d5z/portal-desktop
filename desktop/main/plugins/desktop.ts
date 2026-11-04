import { app, dialog, shell, type BrowserWindow } from 'electron';
import path from 'node:path';
import type { PluginEventTopic } from '../../../plugins/sdk';
import type { ChatScene, SceneTaskSnapshot } from '../../shared/types';
import type { RegisterHandler } from '../app/ipc';
import type { Exclusive } from '../app/mutations';
import { SettingsStore } from '../app/settings';
import { ChatProxy } from '../chat/proxy';
import { downloadFetch } from '../kits/download-fetch';
import { TownClient } from '../town/client';
import { TownLive } from '../town/live';
import { registerPluginsIpc } from './ipc';
import { PluginRegistry } from './registry';
import { createPluginServices } from './services';
import { PluginWindows } from './windows';
import { PluginWorkspace } from './workspace';
export function createDesktopPlugins(options: {
  directory: string; store: SettingsStore; proxy: ChatProxy; town: TownClient; townLive: TownLive;
  shellURL(): string; window(): BrowserWindow | null; appearance(): 'light' | 'dark';
  currentScene(): ChatScene | undefined; tasks(): Promise<SceneTaskSnapshot>;
}) {
  const { directory, store, proxy, town, townLive, shellURL, window: getWindow, currentScene: currentPluginScene } = options;
  const pluginContextKey = () => JSON.stringify([store.connection?.endpoint, store.connection?.token, townLive.state.generation, currentPluginScene()]);
  const pluginWorkspace = new PluginWorkspace(() => ({ key: pluginContextKey(), endpoint: store.connection?.endpoint || '', sceneId: currentPluginScene()?.scene_id || '', townGeneration: townLive.state.generation }), () => publishPluginEvent('workspace.changed'));
  let pluginWindows: PluginWindows | undefined;
  const plugins = new PluginRegistry(path.join(directory, 'plugins'), createPluginServices({
    contextKey: pluginContextKey,
    openExternal: url => shell.openExternal(url, { activate: true }),
    fetcher: globalThis.fetch,
    workspace: manifest => pluginWorkspace.read(manifest),
    tasks: options.tasks,
    being: () => ({ connected: Boolean(store.connection), name: store.settings.being, sceneId: currentPluginScene()?.scene_id || '', sceneLabel: currentPluginScene()?.scene_meta.scene_label || '' }),
    endpoint: () => store.connection?.endpoint || '',
    town: (query, signal) => town.query(query, undefined, signal), proxy,
    confirmChat: async (name, being, message) => {
      const window = getWindow();
      if (!window) return false;
      return (await dialog.showMessageBox(window, {
        type: 'question', title: '插件发起 Being 对话',
        message: `${name} 请求向 ${being.name} 发送消息`, detail: `场景：${being.sceneLabel}\n\n${message}`,
        buttons: ['取消', '发送'], defaultId: 0, cancelId: 0
      })).response === 1;
    },
  }), event => { pluginWindows?.emit(event); const window = getWindow(); if (window && !window.webContents.isDestroyed()) window.webContents.send('beings:plugin-event', event); });
  pluginWindows = new PluginWindows(plugins, shellURL, getWindow, options.appearance);
  const closePluginSessions = () => { pluginWindows?.close(); plugins.invalidate(); };
  app.once('before-quit', () => pluginWindows?.close());
  const publishPluginEvent = (topic: PluginEventTopic) => plugins.publish(topic);
  return {
    registry: plugins, windows: pluginWindows, close: closePluginSessions, publish: publishPluginEvent,
    registerIpc(handle: RegisterHandler, exclusive: Exclusive) {
      registerPluginsIpc({ handle, exclusive, window: getWindow, registry: plugins, closeWindows: id => pluginWindows?.close(id), fetcher: downloadFetch });
      handle('beings:plugins-window-open', (id, view, command) => pluginWindows!.open(id, view, command));
      handle('beings:plugins-host-reply', (id, value, error) => pluginWindows!.reply(id, value, error));
      handle('beings:plugins-context', context => pluginWorkspace.update(context));
    },
  };
}
