import { expect, it, vi } from 'vitest';
import { TownLive } from '../desktop/main/town/live';

it('clears the previous display on re-pairing and publishes the new name only after identity confirmation', async () => {
  let expected = 't_First', display = '柳树';
  const fetcher = vi.fn(async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(`event: hello\ndata: ${JSON.stringify({ town_id: expected, anonymous: false, token_kind: 'client' })}\n\n`));
  } }), { headers: { 'Content-Type': 'text/event-stream' } }));
  const live = new TownLive(() => 'fixture-token', () => expected, () => {}, fetcher as typeof fetch, 'https://beings.town', () => display);
  try {
    live.restart();
    expect(live.state.display).toBeUndefined();
    await vi.waitFor(() => expect(live.state.phase).toBe('connected'));
    expect(live.state.message).toContain('柳树');
    expected = 't_Second'; display = '河流';
    live.restart();
    expect(live.state.display).toBeUndefined();
    await vi.waitFor(() => expect(live.state.phase).toBe('connected'));
    expect(live.state).toMatchObject({ beingId: 't_Second', display: '河流' });
    expect(live.state.message).not.toContain('柳树');
    live.rejectAuth();
    expect(live.state.display).toBeUndefined();
  } finally { live.dispose(); }
});

it('prefers the live Town display name and removes a parenthesized Town ID fallback', async () => {
  const fetcher = vi.fn(async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(
      'event: hello\ndata: {"town_id":"t_Willow","display_name":"实时柳树","token_kind":"client","anonymous":false}\n\n',
    ));
  } }), { headers: { 'Content-Type': 'text/event-stream' } }));
  const live = new TownLive(() => 'fixture-token', () => 't_Willow', () => {}, fetcher as typeof fetch,
    'https://beings.town', () => '旧名称 (t_Willow)');
  try {
    live.restart();
    await vi.waitFor(() => expect(live.state.phase).toBe('connected'));
    expect(live.state.display).toBe('实时柳树');
  } finally { live.dispose(); }
});

it('accepts documented SSE payloads, decodes split UTF-8 and deduplicates REST/SSE IDs per channel', async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const fetcher = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }), { headers: { 'Content-Type': 'text/event-stream' } }));
  const publish = vi.fn();
  const live = new TownLive(() => 'private-client-token', () => 'willow', publish, fetcher as typeof fetch);
  try {
    live.restart();
    await vi.waitFor(() => expect(stream).toBeDefined());
    live.remember({ kind: 'bonfire' }, { messages: [{ seq: 1 }] });
    const encode = (type: string, data: unknown) => `event: ${type}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;
    const message = { seq: 2, being_id: 'river', display_name: '河流', content: '只供主进程读取', at: '2026-09-11', via: 'client:phone', reply_to: 1 };
    const bytes = new TextEncoder().encode(encode('hello', { being_id: 'willow', token_kind: 'client', anonymous: false }) +
      encode('bonfire', { ...message, seq: 1 }) + encode('bonfire', message) + encode('bonfire', message) +
      encode('dm', { id: 'letter-1', sender_being_id: 'river', sender_name: '河流', recipient: 'willow', content: '私信', via: 'being' }) +
      encode('fireside', { fireside_id: 10, seq: 2, speaker_name: '河流', content: '围炉', via: 'client:phone' }) +
      encode('fireside', { fireside_id: 11, seq: 2, speaker_name: '河流', content: '另一围炉', via: 'being' }));
    for (let i = 0; i < bytes.length; i += 7) stream.enqueue(bytes.slice(i, i + 7));
    await vi.waitFor(() => expect(live.state.versions).toEqual({ bonfire: 1, mail: 1, firesides: 2 }));
    expect(live.state.firesideVersions).toEqual({ '10': 1, '11': 1 });
    expect(live.state).toMatchObject({ phase: 'connected', beingId: 'willow' });
    const [url, options] = (fetcher.mock.calls as unknown[][])[0];
    expect(url).toBe('https://beings.town/api/client/stream?token=private-client-token');
    expect(options).toMatchObject({ credentials: 'omit', redirect: 'error', headers: { Accept: 'text/event-stream' } });
    expect(JSON.stringify(publish.mock.calls)).not.toMatch(/private-client-token|只供主进程读取|私信|phone/);
  } finally { live.dispose(); }
});

it.each([{ being_id: 'other', token_kind: 'client', anonymous: false }, { being_id: 'willow', token_kind: 'being', anonymous: false }])(
  'rejects an unexpected identity or a non-client authentication path: %j', async hello => {
    const body = `event: hello\ndata: ${JSON.stringify(hello)}\n\n`;
    const fetcher = vi.fn(async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }));
    const live = new TownLive(() => 'private-client-token', () => 'willow', () => {}, fetcher as typeof fetch);
    try {
      live.restart();
      await vi.waitFor(() => expect(live.state.phase).toBe('auth-error'));
      expect(live.state.beingId).toBeUndefined();
      expect(live.state.message).toContain('凭据无效或已失效');
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { live.dispose(); }
  });
