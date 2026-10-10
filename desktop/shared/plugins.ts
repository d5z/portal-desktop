import { parseAgentContract } from './plugin-agent';
import type { PluginAgentContract } from '../../plugins/sdk';
export type { GroveSDK, PluginBeingContext } from '../../plugins/sdk';
import type { PluginChangeEvent, PluginResourceKind, PluginWorkspaceContext } from '../../plugins/sdk';
export const PLUGIN_CAPABILITIES = {
  storage: '插件私有存储（1 MB）',
  'agent.read': '读取当前 Being 下本插件的协作数据与变更记录',
  'agent.write': '管理本插件的协作数据，并允许 Being 通过 Portal 插件命令按插件契约读写',
  'town.public.read': '读取 Town 公开目录、种子、公告和故事',
  'town.private.read': '读取已配对 Town 的篝火、围炉、私信和卷轴',
  'being.read': '读取当前 Being 身份、场景及该场景最近对话',
  'being.compose': '把内容放入 Being 对话草稿（不自动发送）',
  'being.chat': '向当前 Being 发起对话（发送前由客户端确认）',
  'ui': '显示通知和打开客户端页面',
  'workspace.read': '读取当前工作区页面和选择（资源内容仍按 Town 读取权限过滤）',
  'being.tasks.read': '读取当前 Being 场景的任务状态和变更通知',
} as const;
export type PluginCapability = keyof typeof PLUGIN_CAPABILITIES;
export interface PluginCommand { id: string; title: string; view: string }
export interface PluginSlot { id: string; title: string; view: string; location: 'right-sidebar' | 'resource-actions'; resourceKinds?: PluginResourceKind[] }
export const PLUGIN_RESOURCE_KINDS: PluginResourceKind[] = ['seeds', 'scrolls', 'embers', 'kits', 'announcements', 'contacts', 'mail', 'bonfire', 'firesides'];
/** Trusted shell -> main only. Never exposed on window.grove. */
export interface PluginHostContext { endpoint: string; sceneId: string; townGeneration: number; context: PluginWorkspaceContext }

export type PluginEvent = { token: string; type: 'being.delta'; data: { text: string } } | { token: string; type: 'subscription'; data: { id: number; event: PluginChangeEvent } };
/** Public desktop plugin API v1; additive features use sdkVersion/minSdkVersion. */
export interface PluginManifest {
  schemaVersion: 1;
  apiVersion: 1;
  minSdkVersion?: '1.0.0' | '1.1.0' | '1.2.0' | '1.3.0' | '1.4.0';
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  entry: string;
  capabilities: PluginCapability[];
  contributes: { agent?: PluginAgentContract; views: { id: string; title: string }[]; commands?: PluginCommand[]; settingsView?: string; slots?: PluginSlot[] };
}
export interface InstalledPlugin {
  manifest: PluginManifest;
  enabled: boolean;
  source: { kind: 'local' | 'grove'; id?: string };
  sha256: string;
  installedAt: string;
  placements?: Record<string, PluginPlacement>;
  visibleSidebarSlots?: string[];
}
export type PluginPlacement = 'page' | 'navigation' | 'window';
export interface PluginHostRequest { requestId: string; action: 'compose' | 'ui' | 'commands' | 'dock'; value?: any }
export interface PluginWindowInfo { id: string; view: string; command?: string; title: string; theme: 'light' | 'dark'; platform: string }
export interface PluginWindowAPI {
  info(): Promise<PluginWindowInfo>;
  open(): Promise<PluginSession>;
  close(token: string): Promise<void>;
  call(token: string, method: string, value?: unknown): Promise<unknown>;
  action(action: PluginHostRequest['action'], value?: unknown): Promise<any>;
  onEvent(callback: (event: PluginEvent) => void): () => void;
  onTheme(callback: (theme: 'light' | 'dark') => void): () => void;
}
declare global { interface Window { beingsPluginWindow?: PluginWindowAPI } }
export interface PluginLibrary { plugins: InstalledPlugin[]; problems: string[] }
export interface PluginSession { token: string; url: string }
export interface DesktopPluginAPI {
  setSidebarSlotVisible?(id: string, slot: string, visible: boolean): Promise<void>;
  setPlacement?(id: string, view: string, placement: PluginPlacement): Promise<void>;
  openWindow?(id: string, view: string, command?: string): Promise<void>;
  onHostRequest?(callback: (request: PluginHostRequest) => void): () => void;
  replyHostRequest?(id: string, value?: unknown, error?: string): Promise<void>;
  list(): Promise<PluginLibrary>;
  importLocal(): Promise<boolean>;
  installGrove(id: string): Promise<boolean>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  remove(id: string): Promise<boolean>;
  open(id: string, view: string, command?: string, slot?: string): Promise<PluginSession>;
  updateContext?(context: PluginHostContext): Promise<void>;
  close(token: string): Promise<void>;
  call(token: string, method: string, value?: unknown): Promise<unknown>;
  onEvent?(callback: (event: PluginEvent) => void): () => void;
}

export function groveEntryKind(entry: Record<string, unknown>): 'plugin' | 'kit' | 'app' {
  const tagged = Array.isArray(entry.tags) && entry.tags.some(tag => {
    const name = typeof tag === 'string' ? tag : tag && typeof tag === 'object' ? (tag as Record<string, unknown>).name : '';
    return typeof name === 'string' && name.toLowerCase() === 'plugin';
  });
  return entry.kind === 'plugin' || (entry.kind === 'app' && tagged) ? 'plugin' : entry.kind === 'app' ? 'app' : 'kit';
}

/** Native plugins and legacy tagged Apps share the same fixed Release asset. */
export function pluginReleaseUrl(entry: Record<string, unknown>): string | undefined {
  if (typeof entry.repo_url !== 'string' || typeof entry.release_tag !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(entry.release_tag)) return;
  try {
    const url = new URL(entry.repo_url);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.port || url.search || url.hash || !/^\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+\/?$/.test(url.pathname)) return;
    return `${url.origin}${url.pathname.replace(/\/$/, '').replace(/\.git$/, '')}/releases/download/${encodeURIComponent(entry.release_tag)}/desktop-plugin.tar.gz`;
  } catch { return; }
}

export function pluginId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(value) || value.length > 100 || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(value)) throw new Error('无效的 Plugin ID。');
}
export function parsePluginManifest(raw: unknown): PluginManifest {
  if (!raw || typeof raw !== 'object') throw new Error('缺少 desktop.plugin.json。');
  const m = raw as PluginManifest;
  pluginId(m.id);
  if (m.schemaVersion !== 1 || m.apiVersion !== 1) throw new Error('插件需要不受支持的 Plugin API 版本（当前为 1）。');
  if (m.minSdkVersion !== undefined && !['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0'].includes(m.minSdkVersion)) throw new Error('插件需要更新版本的客户端 SDK。');
  for (const key of ['name', 'description', 'author'] as const) {
    if (typeof m[key] !== 'string' || !m[key].trim() || m[key].length > 1000) throw new Error(`插件 ${key} 无效。`);
  }
  if (typeof m.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(m.version) || m.version.length > 80) throw new Error('插件版本必须是 semver。');
  if (typeof m.entry !== 'string' || !/^[a-zA-Z0-9_-]+\.html$/.test(m.entry)) throw new Error('插件入口必须是根目录中的独立 HTML 文件。');
  if (!Array.isArray(m.capabilities) || new Set(m.capabilities).size !== m.capabilities.length || m.capabilities.some(c => !Object.hasOwn(PLUGIN_CAPABILITIES, c))) throw new Error('插件请求了尚未开放的能力。');
  if (m.capabilities.some(c => c.startsWith('agent.')) && m.minSdkVersion !== '1.4.0') throw new Error('插件协作能力需要 minSdkVersion 1.4.0。');
  const agent = m.contributes?.agent === undefined ? undefined : parseAgentContract(m.contributes.agent);
  if (m.capabilities.some(c => c.startsWith('agent.')) && !agent) throw new Error('插件协作能力需要声明行为契约。');
  if (agent && (!m.capabilities.includes('agent.read') || m.minSdkVersion !== '1.4.0')) throw new Error('行为契约需要 agent.read 和 SDK 1.4.0。');
  if (!Array.isArray(m.contributes?.views) || !m.contributes.views.length || m.contributes.views.length > 8) throw new Error('插件需要声明 1–8 个页面入口。');
  const ids = new Set<string>();
  for (const view of m.contributes.views) {
    if (!view) throw new Error('插件页面声明无效。');
    pluginId(view.id);
    if (ids.has(view.id) || typeof view.title !== 'string' || !view.title.trim() || view.title.length > 60) throw new Error('插件页面名称无效或 ID 重复。');
    ids.add(view.id);
  }
  const commands = m.contributes.commands;
  if (commands !== undefined) {
    if (!Array.isArray(commands) || commands.length > 30) throw new Error('插件最多声明 30 个命令。');
    const commandIds = new Set<string>();
    for (const command of commands) {
      if (!command) throw new Error('插件命令无效。');
      pluginId(command.id);
      if (commandIds.has(command.id) || !ids.has(command.view) || typeof command.title !== 'string' || !command.title.trim() || command.title.length > 80) throw new Error('插件命令重复或目标页面无效。');
      commandIds.add(command.id);
    }
  }
  if (m.contributes.settingsView !== undefined && !ids.has(m.contributes.settingsView)) throw new Error('插件设置页面不存在。');
  const slots = m.contributes.slots;
  if (slots !== undefined) {
    if (!Array.isArray(slots) || slots.length > 12 || !m.capabilities.includes('ui')) throw new Error('插件插槽需要 ui 能力，最多 12 个。');
    const slotIds = new Set<string>();
    for (const slot of slots) {
      if (!slot) throw new Error('插件插槽无效。');
      pluginId(slot.id);
      if (slotIds.has(slot.id) || !ids.has(slot.view) || !['right-sidebar', 'resource-actions'].includes(slot.location) || typeof slot.title !== 'string' || !slot.title.trim() || slot.title.length > 60) throw new Error('插件插槽重复或目标无效。');
      if (slot.resourceKinds !== undefined && (!Array.isArray(slot.resourceKinds) || !slot.resourceKinds.length || slot.resourceKinds.length > PLUGIN_RESOURCE_KINDS.length || new Set(slot.resourceKinds).size !== slot.resourceKinds.length || slot.resourceKinds.some(kind => !PLUGIN_RESOURCE_KINDS.includes(kind)))) throw new Error('插件资源类型无效。');
      slotIds.add(slot.id);
    }
  }
  return { schemaVersion: 1, apiVersion: 1, ...(m.minSdkVersion ? { minSdkVersion: m.minSdkVersion } : {}), id: m.id, name: m.name, version: m.version, description: m.description, author: m.author, entry: m.entry, capabilities: [...m.capabilities], contributes: { ...(agent ? { agent } : {}), views: m.contributes.views.map(v => ({ id: v.id, title: v.title })), ...(commands ? { commands: commands.map(c => ({ id: c.id, title: c.title, view: c.view })) } : {}), ...(m.contributes.settingsView ? { settingsView: m.contributes.settingsView } : {}), ...(slots ? { slots: slots.map(s => ({ id: s.id, title: s.title, view: s.view, location: s.location, ...(s.resourceKinds ? { resourceKinds: [...s.resourceKinds] } : {}) })) } : {}) } };
}
