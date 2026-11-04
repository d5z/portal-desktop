import { dialog, type BrowserWindow } from 'electron';
import type { DshPluginManager } from './manager';
export function registerDshIpc(handle: (channel: string, callback: (...args: any[]) => unknown) => void, manager: DshPluginManager, window: () => BrowserWindow | null) {
  handle('beings:dsh-state', async () => { await manager.whenReady(); return manager.state(); });
  handle('beings:dsh-install', async (source?: string) => {
    const owner = window(); if (!owner) return false;
    if (!source) {
      const choice = await dialog.showOpenDialog(owner, { title: '选择 DSH 插件目录或 npm 压缩包', properties: ['openDirectory', 'openFile'] });
      if (choice.canceled || !choice.filePaths[0]) return false; source = choice.filePaths[0];
    }
    const prepared = await manager.prepare(source);
    let installed = false;
    try {
      const p = prepared.entry.plugin;
      const existing = manager.state().plugins.find(plugin => plugin.id === p.id);
      const choice = await dialog.showMessageBox(owner, { type: 'warning', title: '安装第三方插件', message: `${existing ? "更新" : "安装并启用"} ${p.id} v${p.version}？`,
        detail: `${existing ? `当前版本：${existing.version}。宿主启动失败会恢复旧版。\n\n` : ""}${p.description}\n\n来源：${source}\n\nDSH 插件的宿主代码可读写本机文件、运行程序和访问网络；界面代码可访问整个 Town 页面，包括 Being 对话。仅安装你信任的插件。默认不执行安装脚本。若依赖需要本机构建，可勾选下方选项；这些脚本同样拥有本机执行权限。确认后会启动插件并检查所需服务；不适配时会立即提示原因。`, checkboxLabel: '允许此插件及其依赖执行安装／构建脚本', checkboxChecked: false, buttons: ['取消', '安装并启用'], defaultId: 0, cancelId: 0 });
      if (choice.response !== 1) return false;
      if (choice.checkboxChecked) await prepared.build();
      const enabled = await manager.install(prepared.entry);
      installed = true; // Keep the installed package for a later retry, even when activation failed.
      if (!enabled) throw new Error(`${p.id} 已安装，但启用失败，插件已停用。`);
      return true;
    } finally { if (!installed) await prepared.discard(); }
  });
  handle('beings:dsh-enable', (id, enabled) => manager.enable(id, enabled));
  handle('beings:dsh-activation-failures', failures => manager.reportFailures(failures));
  handle('beings:dsh-configure', (id, config) => manager.configure(id, config));
  handle('beings:dsh-remove', async (id: string) => {
    const owner = window(); if (!owner) return false;
    const choice = await dialog.showMessageBox(owner, { title: '卸载第三方插件', message: `卸载 ${id}？`, detail: '插件数据和包副本会保留。重新加载页面后移除全局脚本和样式。', buttons: ['取消', '卸载'], defaultId: 0, cancelId: 0 });
    if (choice.response !== 1) return false; await manager.remove(id); return true;
  });
}
