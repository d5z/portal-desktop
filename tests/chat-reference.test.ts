import { afterEach, expect, it, vi } from 'vitest';
import { ChatState, type ChatRuntime } from '../desktop/renderer/chat/models/chat';
import { createChatBridge } from '../desktop/renderer/chat/services/bridge';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function fixture() {
  const window = new EventTarget(), parent = { postMessage: vi.fn() };
  vi.stubGlobal('window', window); vi.stubGlobal('parent', parent);
  vi.stubGlobal('location', new URL('beings://chat/?revision=fixture'));
  const state = new ChatState(), bridge = createChatBridge(state);
  const runtime = { loadSbsState: async () => false, send: vi.fn() };
  bridge.start(runtime as unknown as ChatRuntime, { panel() {}, theme() {}, reading() {}, activity() {}, search() {}, jump() {}, focus() {}, scope() {} });
  const send = (data: Record<string, unknown> = {}, origin = 'beings://desktop', source: unknown = parent) => {
    window.dispatchEvent(Object.assign(new Event('message'), { source, origin, data: {
      type: 'beings:scene-draft', id: 'fixture-request', text: '一起看 Portal 日志\n> fixture', expiresAt: Date.now() + 2500, ...data,
    } }));
  };
  const results = () => parent.postMessage.mock.calls.map(call => call[0]).filter(message => message.type === 'beings:scene-draft-result');
  return { state, bridge, runtime, send, results };
}
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
