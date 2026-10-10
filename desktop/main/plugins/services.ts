import type { PluginBeingContext, PluginCapability, PluginManifest } from '../../shared/plugins';
import { townRoute } from '../../shared/town-client';
import type { TownQuery, TownResult, SceneTaskSnapshot } from '../../shared/types';
import type { PluginEventTopic, PluginTaskSnapshot, PluginWorkspaceContext } from '../../../plugins/sdk';
import { createHash } from 'node:crypto';
import type { ChatProxy } from '../chat/proxy';

export interface PluginCallContext { manifest: PluginManifest; signal: AbortSignal; emit: (text: string) => void; check: () => void }
export interface PluginServices {
  contextKey(): string;
  endpoint?(): string;
  call(method: string, value: unknown, context: PluginCallContext): Promise<unknown>;
}
export function eventCapability(topic: unknown): PluginCapability {
  const topics = { 'workspace.changed': 'workspace.read', 'town.changed': 'town.private.read', 'tasks.changed': 'being.tasks.read', 'agent.changed': 'agent.read' } as const;
  if (typeof topic !== 'string' || !Object.hasOwn(topics, topic)) throw new Error('插件事件主题未开放。');
  return topics[topic as PluginEventTopic];
}
export function capabilityFor(method: string, value?: unknown): PluginCapability {
  if (method === 'events.subscribe' || method === 'events.unsubscribe') return eventCapability((value as { topic?: unknown })?.topic);
  if (method === 'workspace.context') return 'workspace.read';
  if (method === 'agent.snapshot') return 'agent.read';
  if (method === 'agent.mutate') return 'agent.write';
  if (method === 'being.tasks.list') return 'being.tasks.read';
  if (method.startsWith('storage.') && ['storage.load', 'storage.save', 'storage.patch'].includes(method)) return 'storage';
  if (method === 'town.query') {
    const query = value as TownQuery;
    // Validate with a placeholder identity; the real client still owns authentication.
    return townRoute(query, 'plugin-reader').private ? 'town.private.read' : 'town.public.read';
  }
  const methods: Record<string, PluginCapability> = { 'being.context': 'being.read', 'being.history': 'being.read', 'being.compose': 'being.compose', 'being.chat': 'being.chat', 'ui.notice': 'ui', 'ui.navigate': 'ui' };
  if (!Object.hasOwn(methods, method)) throw new Error('插件请求了尚未开放的操作。');
  return methods[method];
}
export function boundedText(value: unknown, limit: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || value.includes('\0')) throw new Error('插件文本为空或超出长度限制。');
  return value;
}
async function readBounded(response: Response, limit = 1024 * 1024) {
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Being 请求失败（HTTP ${response.status}）。`); }
  const reader = response.body?.getReader(); if (!reader) throw new Error('Being 返回内容为空。');
  let bytes = 0, text = ''; const decoder = new TextDecoder();
  try { while (true) { const item = await reader.read(); if (item.done) break; if ((bytes += item.value.length) > limit) throw new Error('Being 返回内容超过限制。'); text += decoder.decode(item.value, { stream: true }); } return text + decoder.decode(); }
  finally { await reader.cancel().catch(() => {}); }
}
export function createPluginServices(options: {
  contextKey: () => string;
  being: () => PluginBeingContext;
  endpoint: () => string;
  town: (query: TownQuery, signal: AbortSignal) => Promise<TownResult>;
  proxy: Pick<ChatProxy, 'handle'>;
  confirmChat: (name: string, being: PluginBeingContext, text: string) => Promise<boolean>;
  workspace?: (manifest: PluginManifest) => PluginWorkspaceContext;
  tasks?: () => Promise<SceneTaskSnapshot>;
}): PluginServices {
  let chatting = false;
  return { contextKey: options.contextKey, endpoint: options.endpoint, async call(method, value, context) {
    context.check();
    if (method === 'town.query') return options.town(value as TownQuery, context.signal);
    if (method === 'being.context') return options.being();
    if (method === 'workspace.context') {
      if (!options.workspace) throw new Error('工作区服务不可用。');
      return options.workspace(context.manifest);
    }
    if (method === 'ui.notice') return { text: boundedText(value, 300), plugin: context.manifest.name };
    if (method === 'ui.navigate') {
      const target = value as { view?: string; id?: string };
      if (!target || !['chat', 'town', 'bonfire', 'firesides', 'mail', 'seeds', 'embers', 'scrolls', 'kits', 'announcements', 'contacts'].includes(target.view || '') || (target.id !== undefined && (typeof target.id !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(target.id)))) throw new Error('无效的客户端页面。');
      return { view: target.view, id: target.id };
    }
    const being = options.being();
    if (!being.connected || !being.sceneId) throw new Error('请先连接 Being 并选择对话场景。');
    if (method === 'being.tasks.list') {
      if (!options.tasks) throw new Error('任务服务不可用。');
      const endpoint = options.endpoint();
      const snapshot = await options.tasks(); context.check();
      if (snapshot.endpoint !== endpoint) throw new Error('任务所属 Being 已切换。');
      const result: PluginTaskSnapshot = { scopeId: createHash('sha256').update(endpoint).digest('hex'), sceneId: being.sceneId,
        ready: snapshot.subagentReady === true, configured: snapshot.subagentConfigured === true, enabled: snapshot.subagentEnabled === true,
        tasks: snapshot.tasks.filter(task => task.sceneId === being.sceneId).slice(-200).map(task => ({ id: task.id, status: task.status, createdAt: task.createdAt, ...(task.endedAt === undefined ? {} : { endedAt: task.endedAt }) })) };
      return result;
    }
    if (method === 'being.compose') return { text: boundedText(value, 16000), sceneId: being.sceneId, plugin: context.manifest.name };
    const headers = { 'X-Portal-Being-Endpoint': options.endpoint(), 'X-Portal-Scene-Id': being.sceneId };
    if (method === 'being.history') {
      const limit = (value as { limit?: number } | undefined)?.limit ?? 30;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('历史条数须为 1–100。');
      const response = await options.proxy.handle(new Request(`beings://chat/api/history?limit=100`, { headers, signal: AbortSignal.any([context.signal, AbortSignal.timeout(20000)]) }));
      const data = JSON.parse(await readBounded(response));
      if (!Array.isArray(data.messages)) throw new Error('Being 历史格式无效。');
      return { sceneId: being.sceneId, messages: data.messages.filter((m: any) => m && m.scene_id === being.sceneId && ['user', 'being', 'assistant'].includes(m.role) && typeof m.content === 'string').slice(-limit).map((m: any) => ({ role: m.role, content: m.content.slice(0, 16000), ...(typeof m.at === 'string' ? { at: m.at } : {}) })) };
    }
    if (method !== 'being.chat') throw new Error('插件操作未开放。');
    const message = boundedText(value, 16000);
    if (chatting) throw new Error('已有插件对话请求正在确认或执行。');
    chatting = true;
    try {
      const confirmationExpires = Date.now() + 5 * 60 * 1000;
      if (!await options.confirmChat(context.manifest.name, being, message)) throw new Error('已取消发送。');
      if (Date.now() > confirmationExpires) throw new Error('发送确认已过期，请重新发起。');
      context.check();
      const response = await options.proxy.handle(new Request('beings://chat/api/chat/stream', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ message }),
        signal: AbortSignal.any([context.signal, AbortSignal.timeout(120000)]),
      }));
      if (response.status === 202) { await response.body?.cancel(); return { status: 'accepted', text: '', sceneId: being.sceneId }; }
      if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) { await response.body?.cancel(); throw new Error(`Being 对话未返回有效流（HTTP ${response.status}）；请检查对话记录，不自动重发。`); }
      const reader = response.body!.getReader(), decoder = new TextDecoder();
      let buffer = '', text = '', bytes = 0, completed = false;
      const consume = (block: string) => {
        const lines = block.split('\n'); const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
        const body = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!body || !['content_block_delta', 'message_stop', 'error'].includes(event || '')) return;
        const data = JSON.parse(body);
        if (typeof data.scene_id === 'string' && data.scene_id !== being.sceneId) return;
        if (event === 'error') throw new Error('Being 返回执行错误，请查看主对话。');
        if (event === 'message_stop') completed = true;
        if (event === 'content_block_delta' && typeof data.delta?.text === 'string') {
          completed = false; text += data.delta.text; context.check(); context.emit(data.delta.text);
        }
      };
      try {
        while (true) {
          const item = await reader.read(); if (item.done) break;
          if ((bytes += item.value.length) > 1024 * 1024) throw new Error('对话输出超过 1 MB，请在主对话中继续查看。');
          buffer += decoder.decode(item.value, { stream: true });
          buffer = buffer.replace(/\r\n/g, '\n');
          let end; while ((end = buffer.indexOf('\n\n')) >= 0) { consume(buffer.slice(0, end)); buffer = buffer.slice(end + 2); }
        }
        buffer += decoder.decode(); if (buffer.trim()) consume(buffer);
        if (!completed) throw new Error('对话流中断，完成状态未确认；请检查主对话，不自动重发。');
        return { status: 'completed', text, sceneId: being.sceneId };
      } finally { await reader.cancel().catch(() => {}); }
    } finally { chatting = false; }
  } };
}
