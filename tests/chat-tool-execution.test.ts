import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatState, type Run } from '../desktop/renderer/chat/models/chat';
import { createChatRuntime } from '../desktop/renderer/chat/services/runtime';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('location', new URL('https://fixture.test/loom.html?scene_id=room&scene_strict=1'));
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => setTimeout(fn, 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function fixture() {
  let stream!: ReadableStreamDefaultController<Uint8Array>, signal!: AbortSignal;
  let active: any = null, sends = 0;
  const history: any[] = [];
  let stop: (signal: AbortSignal) => Promise<Response> = async () => Response.json({ ok: true });
  const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    if (url.pathname === '/health') return new Response('OK fixture');
    if (url.pathname === '/api/history') return Response.json({ messages: history });
    if (url.pathname === '/api/stream/active') return active ? Response.json(active) : new Response(null, { status: 204 });
    if (url.pathname === '/api/stop') return stop(init!.signal!);
    if (url.pathname === '/api/chat/stream') {
      const streamId = `stream-${++sends}`;
      active = { stream_id: streamId, scene_id: 'room', origin: 'human', finished: false, next_seq: 1, events: [] };
      signal = init!.signal!;
      return new Response(new ReadableStream({ start(controller) {
        stream = controller;
        signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
        controller.enqueue(new TextEncoder().encode(`event: meta\ndata: {"stream_id":"${streamId}","scene_id":"room"}\n\n`));
      } }));
    }
    return Response.json({ sbs_enabled: false });
  });
  vi.stubGlobal('fetch', fetcher);
  const state = new ChatState(), runtime = createChatRuntime(state);
  await runtime.start();
  return { state, runtime, fetcher, history,
    signal: () => signal,
    setStop: (handler: typeof stop) => { stop = handler; },
    setActive: (value: any) => { active = value; },
    emit: (event: string, data: object) => stream.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify({ scene_id: 'room', ...data })}\n\n`)),
    close: () => { active = null; stream.close(); },
    tools: () => state.items.flatMap(item => item.kind === 'run' ? item.entries.filter(entry => entry.type === 'tool') : []),
  };
}

it.each(['live', 'replay'])('pairs parallel calls and retains errors through %s events', async transport => {
  const f = await fixture();
  const events = [
    ['tool_use', { call_id: 'a', name: 'portal_exec', input: { command: 'first' } }],
    ['tool_use', { call_id: 'b', name: 'portal_exec', input: { command: 'second' } }],
    ['tool_result', { call_id: 'a', content: 'first failed\ncompiler diagnostics', is_error: true, exit_code: 1, duration_ms: 200 }],
    ['tool_use', { call_id: 'a', name: 'portal_exec' }],
    ['tool_result', { call_id: 'a', content: 'duplicate must not replace failure', is_error: false }],
  ] as const;
  try {
    if (transport === 'live') {
      await f.runtime.send('run tools'); await vi.advanceTimersByTimeAsync(20);
      for (const [type, data] of events) f.emit(type, data);
    } else {
      f.setActive({ stream_id: 'replay', scene_id: 'room', origin: 'human', finished: false, next_seq: 6,
        events: events.map(([event, data], index) => ({ seq: index + 1, event, data: { scene_id: 'room', ...data } })) });
      await vi.advanceTimersByTimeAsync(10020);
    }
    await vi.advanceTimersByTimeAsync(250);
    expect(f.tools()).toHaveLength(2);
    expect(f.tools()[0]).toMatchObject({ toolCallId: 'a', done: true, error: true, resultDetail: 'first failed\ncompiler diagnostics', exitCode: 1 });
    expect(f.tools()[1]).toMatchObject({ toolCallId: 'b' });
    expect(f.tools()[1].done).toBeUndefined();
    expect(f.state.items.find(item => item.kind === 'run')).toMatchObject({ status: 'working' });
  } finally { f.runtime.dispose(); }
});

it.each(['http', 'receipt', 'invalid-json', 'wrong-stream', 'accepted', 'network', 'timeout'])('preserves the stream after a %s stop failure and supports retry', async failure => {
  const f = await fixture();
  try {
    await f.runtime.send('long work'); await vi.advanceTimersByTimeAsync(20);
    f.emit('tool_use', { call_id: 'a', name: 'portal_exec' });
    await vi.advanceTimersByTimeAsync(20);
    f.setStop(async signal => {
      if (failure === 'network') throw new TypeError('network down');
      if (failure === 'timeout') return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
      if (failure === 'receipt') return Response.json({ ok: false });
      if (failure === 'invalid-json') return new Response('not a stop receipt');
      if (failure === 'wrong-stream') return Response.json({ ok: true, stream_id: 'another' });
      return Response.json({ ok: true }, { status: failure === 'accepted' ? 202 : 503 });
    });
    const stopping = f.runtime.stopCurrentTurn();
    if (failure === 'timeout') await vi.advanceTimersByTimeAsync(10001);
    await stopping;
    expect(f.signal().aborted).toBe(false);
    expect(f.state.streaming).toBe(true);
    expect(f.state.stopping).toBe(false);
    f.emit('tool_result', { call_id: 'a', content: 'still received' });
    await vi.advanceTimersByTimeAsync(250);
    expect(f.tools()[0].resultDetail).toBe('still received');
    const notice = f.state.items.find(item => item.kind === 'message' && item.retryLabel === '再次停止');
    expect(notice?.kind).toBe('message');
    f.setStop(async () => Response.json({ ok: true }));
    if (notice?.kind === 'message') await notice.retry?.();
    await vi.advanceTimersByTimeAsync(20);
    expect(f.signal().aborted).toBe(true);
    expect(f.state.streaming).toBe(false);
    expect(f.state.items.some(item => item.kind === 'run' && item.outcome === 'stopped')).toBe(true);
  } finally { f.runtime.dispose(); }
});

it('waits for a receipt and ignores a late stop acknowledgement after a new turn starts', async () => {
  const f = await fixture();
  let resolve!: (response: Response) => void;
  try {
    await f.runtime.send('first'); await vi.advanceTimersByTimeAsync(20);
    f.setStop(() => new Promise(done => { resolve = done; }));
    const pending = f.runtime.stopCurrentTurn();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.state.stopping).toBe(true);
    expect(f.signal().aborted).toBe(false);
    await f.runtime.stopCurrentTurn();
    expect(f.fetcher.mock.calls.filter(([url]) => new URL(url).pathname === '/api/stop')).toHaveLength(1);
    f.emit('content_block_delta', { delta: { text: 'finished naturally' } });
    f.emit('message_stop', {}); f.close();
    await vi.advanceTimersByTimeAsync(250);
    await f.runtime.send('second'); await vi.advanceTimersByTimeAsync(250);
    const next = f.signal();
    resolve(Response.json({ ok: true })); await pending;
    expect(next.aborted).toBe(false);
    expect(f.state.streaming).toBe(true);
  } finally { f.runtime.dispose(); }
});

it('keeps replay polling alive when stop fails', async () => {
  const f = await fixture();
  try {
    const active = { stream_id: 'replay', scene_id: 'room', origin: 'human', finished: false, next_seq: 2,
      events: [{ seq: 1, event: 'tool_use', data: { scene_id: 'room', call_id: 'a', name: 'read' } }] };
    f.setActive(active); await vi.advanceTimersByTimeAsync(10020);
    f.setStop(async () => Response.json({ ok: false }, { status: 503 }));
    await f.runtime.stopCurrentTurn();
    f.setActive({ ...active, next_seq: 3, events: [{ seq: 2, event: 'tool_result', data: { scene_id: 'room', call_id: 'a', content: 'polled after failure' } }] });
    await vi.advanceTimersByTimeAsync(3000);
    expect(f.tools()[0]).toMatchObject({ done: true, resultDetail: 'polled after failure' });
    expect(f.state.items.filter((item): item is Run => item.kind === 'run').every(run => run.outcome !== 'stopped')).toBe(true);
  } finally { f.runtime.dispose(); }
});

it('records a confirmed stop when the server closes SSE before sending its receipt', async () => {
  const f = await fixture();
  let resolve!: (response: Response) => void;
  try {
    await f.runtime.send('work'); await vi.advanceTimersByTimeAsync(20);
    f.emit('tool_use', { call_id: 'a', name: 'read' });
    await vi.advanceTimersByTimeAsync(20);
    f.setStop(() => new Promise(done => { resolve = done; }));
    const pending = f.runtime.stopCurrentTurn();
    await vi.advanceTimersByTimeAsync(0);
    f.close(); await vi.advanceTimersByTimeAsync(250);
    resolve(Response.json({ ok: true })); await pending;
    expect(f.state.streaming).toBe(false);
    expect(f.state.items.find(item => item.kind === 'run')).toMatchObject({ outcome: 'stopped', status: 'stopped', label: '已停止' });
  } finally { f.runtime.dispose(); }
});

it.each(['same-scene', 'other-scene', 'old-marker'])('reconciles an unconfirmed stop from a %s durable marker', async kind => {
  const f = await fixture();
  try {
    await f.runtime.send('stop with lost receipt');
    await vi.advanceTimersByTimeAsync(20);
    f.emit('content_block_delta', {delta:{text:'partial answer'}});
    await vi.advanceTimersByTimeAsync(20);
    f.setStop(async () => Response.json({accepted:true}, {status:202}));
    const requestedAt = Date.now();
    await f.runtime.stopCurrentTurn();
    expect(f.state.items.some(item=>item.kind==='message' && item.notice==='stop')).toBe(true);
    f.history.push({seq:1,role:'system',from:'system',type:'marker',content:'[breath interrupted]',
      scene_id:kind==='other-scene'?'other':'room',at:new Date(requestedAt-(kind==='old-marker'?60000:0)).toISOString()});
    await f.runtime.refreshHistory();
    await vi.advanceTimersByTimeAsync(20);
    if(kind==='same-scene') {
      expect(f.state.streaming).toBe(false);
      expect(f.state.items.some(item=>item.kind==='message' && item.notice==='stop')).toBe(false);
      expect(f.state.items.find(item=>item.kind==='run')).toMatchObject({status:'stopped',waitingForReply:false,stopHistorySeq:1});
    } else {
      expect(f.signal().aborted).toBe(false);
      expect(f.state.items.some(item=>item.kind==='message' && item.notice==='stop')).toBe(true);
    }
  } finally {f.runtime.dispose();}
});

it.each([200, 204])('accepts the deployed empty HTTP %s stop acknowledgement', async status => {
  const f = await fixture();
  try {
    await f.runtime.send('stop'); await vi.advanceTimersByTimeAsync(20);
    f.setStop(async()=>new Response(null,{status}));
    await f.runtime.stopCurrentTurn(); await vi.advanceTimersByTimeAsync(20);
    expect(f.signal().aborted).toBe(true);
    expect(f.state.streaming).toBe(false);
    expect(f.state.items.some(item=>item.kind==='message' && item.notice==='stop')).toBe(false);
    expect(f.state.items.find(item=>item.kind==='run')).toMatchObject({status:'stopped'});
    expect(f.state.items.filter(item=>item.kind==='run')).toHaveLength(1);
  } finally {f.runtime.dispose();}
});

it.each(['before', 'after'])('deduplicates stop history arriving %s the HTTP receipt', async order => {
  const f = await fixture();
  let resolve!: (response: Response) => void;
  try {
    await f.runtime.send('stop'); await vi.advanceTimersByTimeAsync(20);
    f.emit('content_block_delta', {delta:{text:'partial answer'}});
    await vi.advanceTimersByTimeAsync(20);
    f.setStop(() => new Promise(done => { resolve = done; }));
    const requestedAt = Date.now(), pending = f.runtime.stopCurrentTurn();
    await vi.advanceTimersByTimeAsync(0);
    if (order === 'after') { resolve(new Response(null,{status:200})); await pending; }
    f.history.push({seq:1,role:'system',from:'system',type:'marker',content:'[breath interrupted]',scene_id:'room',at:new Date(requestedAt).toISOString()});
    await f.runtime.refreshHistory();
    if (order === 'before') { resolve(new Response(null,{status:200})); await pending; }
    await vi.advanceTimersByTimeAsync(20);
    expect(f.state.items.find(item=>item.kind==='run')).toMatchObject({status:'stopped',stopHistorySeq:1});
    expect(f.state.items.filter(item=>item.kind==='run')).toHaveLength(1);
  } finally { f.runtime.dispose(); }
});
