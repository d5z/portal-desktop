import { dialog, type BrowserWindow } from 'electron';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { downloadBundle, downloadKit, unpackKit } from '../kits/install';
import { TownClient } from '../town/client';
import { groveEntryKind, pluginReleaseUrl, PLUGIN_CAPABILITIES } from '../../shared/plugins';
import { PluginRegistry, readPlugin } from './registry';

export function registerPluginsIpc(options: {
  handle: (channel: string, callback: (...args: any[]) => unknown) => void;
  exclusive: <T>(operation: () => Promise<T>) => Promise<T>;
  window: () => BrowserWindow | null;
  registry: PluginRegistry;
  fetcher: typeof fetch;
  closeWindows?: (id: string) => void;
}) {
  const { handle, exclusive, registry, fetcher } = options;
  const review = async (bundle: Awaited<ReturnType<typeof readPlugin>>, source: string) => {
    const window = options.window(); if (!window) return false;
    const m = bundle.manifest;
    return (await dialog.showMessageBox(window, {
      type: 'question', title: '安装客户端插件', message: `安装并启用 ${m.name} v${m.version}？`,
      detail: `${m.description}\n\n作者：${m.author}\n来源：${source}\n页面：${m.contributes.views.map(v => v.title).join('、')}\n插槽：${m.contributes.slots?.map(s => `${s.location === 'right-sidebar' ? '侧栏' : '资源操作'} · ${s.title}`).join('、') || '无'}\n能力：${m.capabilities.map(capability => PLUGIN_CAPABILITIES[capability]).join('、') || '仅界面'}\n\n插件将在隔离页面中运行 JavaScript。安装只写入插件目录，无需修改客户端源码。\n内容 SHA-256：${bundle.sha256}\n摘要用于内容校验，不代表作者身份已验证。`,
      buttons: ['取消', '安装并启用'], defaultId: 0, cancelId: 0,
    })).response === 1;
  };
  handle('beings:plugins-list', () => registry.list());
  handle('beings:plugins-import', () => exclusive(async () => {
    const window = options.window(); if (!window) return false;
    const choice = await dialog.showOpenDialog(window, { title: '选择包含 desktop.plugin.json 的插件目录', properties: ['openDirectory'] });
    if (choice.canceled || !choice.filePaths[0]) return false;
    const bundle = await readPlugin(choice.filePaths[0]);
    if (!await review(bundle, '本地目录')) return false;
    await registry.install(bundle, { kind: 'local' }); return true;
  }));
  handle('beings:plugins-install', (id: string) => exclusive(async () => {
    const detail = await new TownClient(() => '', fetcher).query({ kind: 'kit', id });
    if (!detail.ok) throw new Error(detail.message);
    if (detail.data.ambiguous || groveEntryKind(detail.data) !== 'plugin') throw new Error('请选择具体的 Grove Plugin 条目（兼容带 plugin 标签的旧 App）。');
    const release = pluginReleaseUrl(detail.data);
    const data = release ? await downloadBundle(release, fetcher)
      : detail.data.has_bundle === true || detail.data.source_url ? await downloadKit(id, fetcher)
      : (() => { throw new Error('条目缺少插件下载包或固定的 GitHub Release。'); })();
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'grove-plugin-'));
    try {
      const source = await unpackKit(data, path.join(temporary, 'unpacked'), 'desktop.plugin.json');
      const bundle = await readPlugin(source);
      if (bundle.manifest.name !== detail.data.name || bundle.manifest.version !== detail.data.version) throw new Error('插件名称或版本与 Grove 条目不一致。');
      if (!await review(bundle, `Grove / ${id}`)) return false;
      await registry.install(bundle, { kind: 'grove', id }); return true;
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }));
  handle('beings:plugins-sidebar-slot-visible', (id, slot, visible) => registry.setSidebarSlotVisible(id, slot, visible));
  handle('beings:plugins-placement', (id, view, placement) => registry.setPlacement(id, view, placement));
  handle('beings:plugins-enable', async (id: string, enabled: boolean) => { await registry.setEnabled(id, enabled); options.closeWindows?.(id); });
  handle('beings:plugins-remove', (id: string) => exclusive(async () => {
    const window = options.window(); if (!window) return false;
    const plugin = (await registry.list()).plugins.find(p => p.manifest.id === id);
    if (!plugin) throw new Error('插件不存在。');
    const choice = await dialog.showMessageBox(window, { type: 'question', title: '卸载插件', message: `卸载 ${plugin.manifest.name}？`, detail: '页面入口将移除。插件私有数据保留，重新安装同 ID 插件后可继续使用。', buttons: ['取消', '卸载'], defaultId: 0, cancelId: 0 });
    if (choice.response !== 1) return false;
    await registry.remove(id); options.closeWindows?.(id); return true;
  }));
  handle('beings:plugins-open', (id: string, view: string, command?: string, slot?: string) => registry.open(id, view, command, slot));
  handle('beings:plugins-close', (token: string) => registry.close(token));
  handle('beings:plugins-call', (token: string, method: string, value?: unknown) => registry.call(token, method, value));
}
