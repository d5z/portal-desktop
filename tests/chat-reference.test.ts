import { afterEach, expect, it, vi } from 'vitest';
import { ChatState, type ChatRuntime } from '../desktop/renderer/chat/models/chat';
import { createChatBridge } from '../desktop/renderer/chat/services/bridge';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function fixture() {
  const window = new EventTarget(), parent = { postMessage: vi.fn() };
  vi.stubGlobal('window', window); vi.stubGlobal('parent', parent);
  vi.stubGlobal('location', new URL('beings://chat/?revision=fixture'));
  const state = new ChatState(), bridge = createChatBridge(state);
  const runtime = { loadSbsState: async () => false, send: vi.fn(), refreshHistory: vi.fn(async () => {}) };
  bridge.start(runtime as unknown as ChatRuntime, { panel() {}, theme() {}, reading() {}, activity() {}, search() {}, jump() {}, focus() {}, scope() {} });
  const send = (data: Record<string, unknown> = {}, origin = 'beings://desktop', source: unknown = parent) => {
    window.dispatchEvent(Object.assign(new Event('message'), { source, origin, data: {
      type: 'beings:scene-draft', id: 'fixture-request', text: '一起看 Portal 日志\n> fixture', expiresAt: Date.now() + 2500, ...data,
    } }));
  };
  const results = () => parent.postMessage.mock.calls.map(call => call[0]).filter(message => message.type === 'beings:scene-draft-result');
  return { state, bridge, runtime, send, results, parent };
}
it('copies complete Markdown through the desktop bridge and waits for a trusted acknowledgement', async () => {
  const f = fixture();
  const text = '**完整正文**\n\n1. 第一条\n2. 第二条';
  const copied = f.bridge.copyText(text);
  const request = f.parent.postMessage.mock.calls.map(call => call[0]).find(message => message.type === 'beings:chat-copy');
  expect(request).toMatchObject({ text, revision: 'fixture' });
  let completed = false;
  void copied.then(() => { completed = true; });
  f.send({ type: 'beings:chat-edit-result', id: request.id, revision: 'fixture', ok: true }, 'https://untrusted.example');
  await Promise.resolve();
  expect(completed).toBe(false);
  f.send({ type: 'beings:chat-edit-result', id: request.id, revision: 'fixture', ok: true });
  await expect(copied).resolves.toBeUndefined();
  f.bridge.dispose();
});
it('reports clipboard failure instead of claiming success', async () => {
  const f = fixture();
  const copied = f.bridge.copyText('正文');
  const request = f.parent.postMessage.mock.calls.map(call => call[0]).find(message => message.type === 'beings:chat-copy');
  f.send({ type: 'beings:chat-edit-result', id: request.id, revision: 'fixture', ok: false });
  await expect(copied).rejects.toThrow('Copy failed');
  f.bridge.dispose();
});
it('refreshes history from the current trusted shell without changing drafts or sending messages', async () => {
  const f = fixture();
  f.state.draft = '保留草稿';
  const request = { type: 'beings:chat-refresh', revision: 'fixture', id: 'refresh-1' };
  f.send(request, 'https://untrusted.example');
  f.send({ ...request, revision: 'stale' });
  expect(f.runtime.refreshHistory).not.toHaveBeenCalled();
  f.send(request);
  await Promise.resolve();
  expect(f.runtime.refreshHistory).toHaveBeenCalledOnce();
  expect(f.state.draft).toBe('保留草稿');
  expect(f.runtime.send).not.toHaveBeenCalled();
  expect(f.parent.postMessage.mock.calls.map(call => call[0])).toContainEqual({ type: 'beings:chat-refreshed', revision: 'fixture', id: 'refresh-1', ok: true });
  f.bridge.dispose();
});
it('places a log quotation in the existing draft and never sends a chat request', () => {
  const f = fixture();
  f.send();
  expect(f.state.draft).toBe('一起看 Portal 日志\n> fixture');
  expect(f.results()).toEqual([{ type: 'beings:scene-draft-result', id: 'fixture-request', ok: true, revision: 'fixture' }]);
  expect(f.runtime.send).not.toHaveBeenCalled();
  f.send({ type: 'beings:diagnostics-send' });
  expect(f.runtime.send).not.toHaveBeenCalled();
  f.bridge.dispose();
});
it.each(['draft', 'attachment'])('preserves an existing %s when a log reference is requested', kind => {
  const f = fixture();
  if (kind === 'draft') f.state.draft = 'existing draft';
  else f.state.files = [{ name: 'private.txt', type: 'text/plain', base64: 'cHJpdmF0ZQ==', size: 7 }];
  const before = { draft: f.state.draft, files: [...f.state.files] };
  f.send();
  expect(f.results()[0]).toMatchObject({ ok: false });
  expect({ draft: f.state.draft, files: f.state.files }).toEqual(before);
  expect(f.runtime.send).not.toHaveBeenCalled();
  f.bridge.dispose();
});
it('ignores expired drafts, untrusted frames and requests after disposal', () => {
  const f = fixture();
  f.send({ expiresAt: Date.now() - 1 });
  f.send({}, 'https://untrusted.example'); f.send({}, 'beings://desktop', {});
  expect(f.state.draft).toBe(''); expect(f.results()).toEqual([]);
  f.bridge.dispose(); f.send(); expect(f.state.draft).toBe('');
  expect(f.runtime.send).not.toHaveBeenCalled();
});
it('sends a Town reply request immediately without replacing the visible draft or attachments', async () => {
  const f = fixture();
  f.state.draft = '保留手写草稿';
  f.state.files = [{ name: 'private.txt', type: 'text/plain', base64: 'cHJpdmF0ZQ==', size: 7 }];
  f.send({ type: 'beings:town-reply', text: '请回复这条 Town 消息' });
  expect(f.runtime.send).toHaveBeenCalledWith('请回复这条 Town 消息', []);
  expect(f.state.draft).toBe('保留手写草稿');
  expect(f.state.files).toHaveLength(1);
  f.bridge.dispose();
});
