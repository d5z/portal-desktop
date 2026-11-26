import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatState, type Run, type Message } from '../desktop/renderer/chat/models/chat';
import { ChatActivity } from '../desktop/renderer/chat/components/messages';
import { createChatRuntime } from '../desktop/renderer/chat/services/runtime';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('location', new URL('https://fixture.test/loom.html?scene_id=desktop-test'));
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => setTimeout(fn, 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function fixture(initial: 'live' | 'queued' | 'empty' = 'live') {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  let sends = 0;
  let historyRead: (() => Promise<Response>) | undefined;
  let activeRead: (() => Response) | undefined;
  const activity = vi.fn();
  const fetcher = vi.fn(async (input: string) => {
    const path = new URL(input).pathname;
    if (path === '/api/history') return historyRead ? historyRead() : Response.json({ messages: [] });
    if (path === '/api/stream/active') return activeRead ? activeRead() : new Response(null, {status: 204});
    if (path === '/health') return new Response('OK fixture');
    if (path === '/api/chat/stream') {
      if (++sends > 1 || initial === 'queued') return Response.json({queued: true}, {status: 202});
      if (initial === 'empty') return new Response('');
      return new Response(new ReadableStream({start(controller) { stream = controller; }}));
    }
    return Response.json({sbs_enabled: false});
  });
  vi.stubGlobal('fetch', fetcher);
  const state = new ChatState(), runtime = createChatRuntime(state, {onSceneActivity: activity});
  state.subagentReady = true;
  await runtime.start();
  await runtime.send('long task');
  await vi.advanceTimersByTimeAsync(20);
  return { state, runtime, activity, fetcher,
    runs: () => state.items.filter((i): i is Run => i.kind === 'run' && i.sceneId === 'desktop-test'),
    emit(event: string, data: object = {}, scene_id = 'desktop-test') {
      stream.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify({scene_id, ...data})}\n\n`));
    },
    finishStream() { stream.close(); },
    setHistory(read: () => Promise<Response>) { historyRead = read; },
    setActive(read: () => Response) { activeRead = read; },
    close() { runtime.dispose(); try { stream?.close(); } catch {} },
  };
}

it('resumes a server-queued input and keeps a long task active, then waits afresh for its final reply', async () => {
  const f = await fixture();
  try {
    f.emit('reasoning', {text: 'started'});
    await vi.advanceTimersByTimeAsync(20);
    await f.runtime.send('follow-up accepted into the live stream', null, {mode:'interrupt'});
    await vi.advanceTimersByTimeAsync(20);
    expect(f.runs()[0]).toMatchObject({status: 'queued', waitingForReply: true});
    expect(f.activity.mock.lastCall?.[0]['desktop-test']).toBe('queued');
    for (let i = 0; i < 22; i++) {
      f.emit('tool_use', {name: 'portal_exec', input: {command: 'fixture'}});
      await vi.advanceTimersByTimeAsync(20);
      expect(f.runs()[0].status).toBe('working');
      f.emit('tool_result', {is_error: i === 0, content: i === 0 ? 'failed command' : 'ok'});
      await vi.advanceTimersByTimeAsync(30000);
    }
    expect(f.runs()).toHaveLength(1);
    expect(f.runs()[0]).toMatchObject({status: 'thinking', waitingForReply: false});
    expect(f.runs()[0].end).toBeUndefined();
    f.emit('message_stop');
    await vi.advanceTimersByTimeAsync(20);
    expect(f.runs()[0]).toMatchObject({status: 'waiting', label: '等待接续回复'});
    await vi.advanceTimersByTimeAsync(240000);
    expect(f.runs()[0].end).toBeUndefined();
    f.emit('content_block_delta', {delta: {text: 'final answer'}});
    await vi.advanceTimersByTimeAsync(20);
    expect(f.runs()[0].status).toBe('replying');
    f.emit('message_stop');
    await vi.advanceTimersByTimeAsync(20);
    expect(f.runs()[0]).toMatchObject({status: 'done', outcome: 'done', label: '已回复'});
    expect(f.runs()[0].entries.filter(e => e.error)).toHaveLength(1);
  } finally { f.close(); }
});

it('ignores an overdue history check that completes after tool progress cancelled the wait', async () => {
  const f = await fixture();
  let finishRead: (() => void) | undefined;
  try {
    await f.runtime.send('queued follow-up', null, {mode:'interrupt'});
    await vi.advanceTimersByTimeAsync(20);
    f.setHistory(() => new Promise(resolve => { finishRead = () => resolve(Response.json({messages: []})); }));
    await vi.advanceTimersByTimeAsync(2000);
    expect(finishRead).toBeTypeOf('function');
    await vi.advanceTimersByTimeAsync(298000);
    f.emit('tool_use', {name: 'portal_exec', input: {}});
    await vi.advanceTimersByTimeAsync(20);
    finishRead!();
    await vi.advanceTimersByTimeAsync(20);
    expect(f.runs()[0]).toMatchObject({status: 'working', waitingForReply: false});
    expect(f.runs()[0].end).toBeUndefined();
  } finally { finishRead?.(); f.close(); }
});

it.each(['queued', 'empty'] as const)('reports an unconfirmed result after a genuinely idle %s wait, without stopping the server', async initial => {
  const f = await fixture(initial);
  try {
    expect(f.runs()[0].status).toBe(initial === 'queued' ? 'queued' : 'waiting');
    await vi.advanceTimersByTimeAsync(300100);
    expect(f.runs()[0]).toMatchObject({status: 'timeout', outcome: 'timeout', label: '等待超时，结果待确认'});
    expect(f.runs()[0].replyWait).toMatchObject({httpStatus: initial === 'queued' ? 202 : 200,
      active: {status: 204, state: 'idle'}, history: {failed: false}});
    expect(f.runs()[0].replyWait?.boundary).toBe(initial === 'empty' ? 'sse-eof' : undefined);
    expect(f.runs()[0].replyWait?.lastEvent).toBeUndefined();
    expect(f.activity.mock.lastCall?.[0]['desktop-test']).toBe('timeout');
    expect(f.fetcher.mock.calls.some(([url]) => new URL(url).pathname === '/api/stop')).toBe(false);
  } finally { f.close(); }
});

it('does not let another scene or empty deltas extend the current wait, and preserves unknown tool results', async () => {
  const f = await fixture();
  try {
    f.emit('tool_use', {name: 'portal_exec', input: {}});
    f.emit('message_stop');
    await vi.advanceTimersByTimeAsync(20);
    expect(f.runs()[0].entries.find(e => e.type === 'tool')?.done).not.toBe(true);
    for (let i = 0; i < 10; i++) {
      f.emit('content_block_delta', {delta: {text: ''}});
      f.emit('reasoning', {text: ''});
      f.emit('tool_use', {name: 'other_tool'}, 'other-scene');
      f.emit('tool_result', {is_error: false, content: 'ok'}, 'other-scene');
      await vi.advanceTimersByTimeAsync(30000);
    }
    expect(f.runs()[0].status).toBe('timeout');
    expect(f.runs()[0].replyWait).toMatchObject({boundary: 'message-stop', lastEvent: {type: 'tool_use', source: 'sse'}});
    const html = renderToStaticMarkup(createElement(ChatActivity, {run: f.runs()[0]}));
    expect(html).toContain('1 次结果未确认');
    expect(html).not.toContain('class="run-entry"');
  } finally { f.close(); }
});

it('reports the last tool result, EOF and failed recovery checks for the same reply without logging content', async () => {
  const f = await fixture();
  try {
    f.setActive(() => new Response('upstream busy', {status: 503}));
    f.setHistory(async () => new Response('history unavailable', {status: 502}));
    f.emit('meta', {stream_id: 'fixture-stream'});
    f.emit('reasoning', {text: 'private reasoning text'});
    f.emit('tool_use', {id: 'tool-1', name: 'portal_exec', input: {command: 'private tool argument'}});
    f.emit('tool_result', {tool_use_id: 'tool-1', is_error: true, content: 'private tool result'});
    f.finishStream();
    await vi.advanceTimersByTimeAsync(2100);
    const run = f.runs()[0];
    const expected = {httpStatus: 200, boundary: 'sse-eof', lastEvent: {type: 'tool_result', source: 'sse'},
      active: {status: 503, state: 'unavailable'}, history: {failed: true}};
    expect(run).toMatchObject({status: 'waiting', replyWait: expected});
    const waiting = renderToStaticMarkup(createElement(ChatActivity, {run, showDetails: false}));
    expect(waiting).toContain('已读到 SSE 响应末尾，最终回复待确认。');
    expect(waiting).not.toContain('请刷新会话。');
    await vi.advanceTimersByTimeAsync(298000);
    expect(run).toMatchObject({status: 'timeout', replyWait: expected});
    expect(run.hint).toContain('请刷新会话。');
    expect(renderToStaticMarkup(createElement(ChatActivity, {run, showDetails: false}))).toContain('请刷新会话。');
    const logs = vi.mocked(console.info).mock.calls;
    const wait = logs.filter(([tag]) => tag === '[chat-reply-wait]').map(([, line]) => JSON.parse(line));
    expect(wait.at(-1)).toMatchObject({...expected, event: 'timeout', timeoutReason: 'deadline',
      sceneId: 'desktop-test', streamId: 'fixture-stream', runId: run.id, toolCount: 1});
    expect(JSON.stringify(logs)).not.toMatch(/private |upstream busy|history unavailable/);
  } finally { f.close(); }
});

it('cancels the initial 202 wait when replay discovers progress and accepts a reply after five minutes', async () => {
  const f = await fixture('queued');
  let seq = 0;
  let events: object[] = [];
  try {
    f.setActive(() => Response.json({stream_id: 'queued-stream', scene_id: 'desktop-test', origin: 'human',
      finished: false, next_seq: seq += events.length, events: events.splice(0)}));
    events.push({event: 'tool_use', data: {scene_id: 'desktop-test', name: 'portal_exec', input: {}}});
    await f.runtime.refreshOnRegainedAttention();
    await vi.advanceTimersByTimeAsync(20);
    expect(f.runs()[0].status).toBe('working');
    for (let i = 0; i < 12; i++) {
      events.push({event: 'tool_result', data: {scene_id: 'desktop-test', is_error: false, content: 'ok'}},
        {event: 'tool_use', data: {scene_id: 'desktop-test', name: 'portal_exec', input: {}}});
      await vi.advanceTimersByTimeAsync(30000);
    }
    expect(f.runs()[0].end).toBeUndefined();
    events.push({event: 'content_block_delta', data: {scene_id: 'desktop-test', delta: {text: 'completed'}}},
      {event: 'message_stop', data: {scene_id: 'desktop-test'}});
    await vi.advanceTimersByTimeAsync(30000);
    expect(f.runs()[0]).toMatchObject({status: 'done', outcome: 'done'});
  } finally { f.close(); }
});

it('distinguishes waiting timeout from failed tools in the collapsed activity summary', () => {
  const run: Run = {kind: 'run', id: 'r', start: 1, end: 664001, status: 'timeout', outcome: 'timeout',
    label: '等待超时，结果待确认', hint: '后台任务可能仍在运行', arg: '',
    entries: [{type: 'tool', done: true}, {type: 'tool', done: true, error: true}, {type: 'tool'}]};
  const html = renderToStaticMarkup(createElement(ChatActivity, {run}));
  const summary = html.split('</summary>')[0];
  expect(summary).toContain('data-status="timeout"');
  expect(summary).not.toContain('class="run-entry"');
  expect(summary).toContain('1 次工具调用失败');
  expect(summary).toContain('1 次结果未确认');
  expect(summary).not.toContain('含失败项');
});

it.each(['human', 'beating'])('discovers a queued reply in a %s stream without focus or reconnect', async origin => {
  const f = await fixture('queued');
  try {
    // The original SBS stream can keep its global identity after yielding.
    const scene = origin === 'beating' ? {} : {scene_id: 'desktop-test'};
    f.setActive(() => Response.json({stream_id: 'yielded-stream', ...scene, origin,
      finished: false, next_seq: 3, events: [
        {seq: 1, event: 'content_block_delta', data: {scene_id: 'desktop-test', delta: {text: 'reply after yield'}}},
        {seq: 2, event: 'message_stop', data: {scene_id: 'desktop-test'}},
      ]}));
    await vi.advanceTimersByTimeAsync(2100);
    expect(f.state.items.filter(i => i.kind === 'message' && i.text === 'reply after yield')).toHaveLength(1);
    expect(f.runs()[0]).toMatchObject({status: 'done', outcome: 'done'});
  } finally { f.close(); }
});

it('does not settle a retry with delayed old history or a persisted yielded partial', async () => {
  const f = await fixture('queued');
  try {
    const old = new Date(Date.now() - 7 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    f.setHistory(async () => Response.json({messages: [
      {seq: 1, role: 'being', content: 'old reply', scene_id: 'desktop-test', at: old},
      {seq: 2, role: 'being', content: 'yielded partial', from: 'partial', scene_id: 'desktop-test', at: now},
      {seq: 3, from: 'system', type: 'marker', content: '[breath yielded]', at: old},
    ]}));
    await vi.advanceTimersByTimeAsync(2100);
    expect(f.runs()[0]).toMatchObject({status: 'queued', waitingForReply: true});
    expect(f.state.items.some(i => i.kind === 'message' && i.role === 'user' && i.text === 'long task')).toBe(true);
    expect(f.state.items.filter(i => i.kind === 'separator' && !i.marker)).toHaveLength(0);
    // A delayed marker's old timestamp must not override durable seq order.
    // The unconfirmed user bubble remains intact until its own history arrives.
    expect(f.state.items.flatMap(i => 'historySeq' in i && i.historySeq ? [i.historySeq] : []))
      .toEqual([1, 2, 3]);
    f.setHistory(async () => Response.json({messages: [
      {seq: 4, role: 'being', content: 'final reply', from: 'final', scene_id: 'desktop-test', at: new Date().toISOString()},
    ]}));
    await vi.advanceTimersByTimeAsync(4100);
    expect(f.runs()[0]).toMatchObject({status: 'done', outcome: 'done'});
  } finally { f.close(); }
});

it('does not count the shared replay reader as another busy scene when sending to the only active scene', async () => {
  const posts = vi.fn();
  vi.stubGlobal('fetch', async (input: string) => {
    const path = new URL(input).pathname;
    if (path === '/api/history') return Response.json({messages: []});
    if (path === '/health') return new Response('OK fixture');
    if (path === '/api/stream/active') return Response.json({stream_id:'shared-reader',origin:'human',finished:false,next_seq:2,
      events:[{seq:1,event:'reasoning',data:{scene_id:'scene-b',text:'B is working'}}]});
    if (path === '/api/chat/stream') { posts(); return Response.json({queued:true},{status:202}); }
    return Response.json({sbs_enabled:false});
  });
  const state = new ChatState(), runtime = createChatRuntime(state);
  try {
    await runtime.start();
    await vi.advanceTimersByTimeAsync(20);
    await runtime.selectScene({sceneId:'scene-b',strict:true});
    await runtime.send('interrupt B', null, {mode:'interrupt'});
    await vi.advanceTimersByTimeAsync(20);
    expect(posts).toHaveBeenCalledTimes(1);
    expect(state.items.some(i => i.kind === 'message' && i.queued)).toBe(false);
  } finally { runtime.dispose(); }
});

// Live capture: the old final/stop arrived 9ms before the interrupt POST's 200.
it('keeps the completed run with its reply when an interrupt races a new stream', async () => {
  const f = await fixture();
  try {
    f.emit('content_block_delta', {delta:{text:'上一轮答复'}});
    await vi.advanceTimersByTimeAsync(20);
    const oldRun = f.runs()[0];
    const original = f.fetcher.getMockImplementation()!;
    let accept!: (response: Response) => void;
    f.fetcher.mockImplementation(input => new URL(input).pathname === '/api/chat/stream'
      ? new Promise<Response>(resolve => { accept = resolve; }) : original(input));
    const sending = f.runtime.send('新的问题', [], {mode:'interrupt'});
    await vi.advanceTimersByTimeAsync(0);
    f.emit('message_stop');
    await vi.advanceTimersByTimeAsync(20);
    const user = f.state.items.find(item => item.kind === 'message' && item.text === '新的问题')!;
    expect(oldRun).toMatchObject({status:'done'});
    expect(f.state.items.indexOf(oldRun)).toBeLessThan(f.state.items.indexOf(user));
    accept(new Response('event: reasoning\ndata: {"text":"正在处理新问题"}\n\nevent: message_stop\ndata: {}\n\n'));
    await sending;
    await vi.advanceTimersByTimeAsync(20);
    expect(f.runs()).toHaveLength(2);
    expect(f.state.items.indexOf(f.runs()[1])).toBeGreaterThan(f.state.items.indexOf(user));
    expect(f.runs()[1].label).toBe('等待接续回复');
  } finally { f.close(); }
});

it('projects one status into the transcript and scene list without changing reply content', async () => {
  const f = await fixture();
  const check = (status: string) => {
    expect(f.runs().at(-1)?.status).toBe(status);
    expect(f.activity.mock.lastCall?.[0]['desktop-test']).toBe(status);
  };
  try {
    f.emit('reasoning', {text:'检查中'});
    await vi.advanceTimersByTimeAsync(20);
    check('thinking');
    f.emit('tool_use', {name:'read_file', id:'read-1', input:{}});
    await vi.advanceTimersByTimeAsync(20);
    check('working');
    f.emit('tool_result', {name:'read_file', tool_use_id:'read-1', is_error:true, content:'missing file'});
    await vi.advanceTimersByTimeAsync(20);
    check('thinking'); // A failed tool is not a failed turn.
    await f.runtime.send('补充问题', [], {mode:'interrupt'});
    await vi.advanceTimersByTimeAsync(20);
    check('queued');
    f.emit('message_stop');
    await vi.advanceTimersByTimeAsync(20);
    check('waiting');
    f.emit('meta', {continuation:true});
    f.emit('content_block_delta', {delta:{text:''}});
    await vi.advanceTimersByTimeAsync(20);
    check('waiting'); // Transport markers alone are not model progress.
    f.emit('content_block_delta', {delta:{text:'完整答复'}});
    await vi.advanceTimersByTimeAsync(20);
    check('replying');
    f.emit('message_stop');
    await vi.advanceTimersByTimeAsync(20);
    check('done');
    const order = f.state.items.map(item => item.id);
    const replies = f.state.items.filter((item): item is Message => item.kind === 'message' && item.role === 'being');
    expect(replies.map(item => item.text)).toEqual(['完整答复']);
    expect(f.runs().at(-1)?.replyConfirmed).toBe(true);
    f.runs().at(-1)!.label = 'Translated completion label';
    await f.runtime.refreshHistory();
    await vi.advanceTimersByTimeAsync(20);
    check('done');
    expect(f.state.items.map(item => item.id)).toEqual(order);
    expect(f.state.items.filter(item => item.kind === 'message' && item.role === 'being')).toEqual(replies);
  } finally { f.close(); }
});


it('keeps activity above the reply and starts the next turn without the previous text phase', async () => {
  const f = await fixture();
  try {
    const firstRun = f.runs()[0];
    const runIndex = f.state.items.indexOf(firstRun);
    f.emit('content_block_delta', {delta:{text:'first reply'}});
    await vi.advanceTimersByTimeAsync(20);
    expect(f.state.items.indexOf(firstRun)).toBe(runIndex);
    const reply = f.state.items.find(item => item.kind === 'message' && item.role === 'being');
    expect(runIndex).toBeLessThan(f.state.items.indexOf(reply!));
    f.emit('message_stop');
    f.finishStream();
    await vi.advanceTimersByTimeAsync(20);
    const original = f.fetcher.getMockImplementation()!;
    let accept!: (response: Response) => void;
    f.fetcher.mockImplementation(input => new URL(input).pathname === '/api/chat/stream'
      ? new Promise<Response>(resolve => { accept = resolve; }) : original(input));
    const sending = f.runtime.send('next turn');
    await vi.advanceTimersByTimeAsync(20);
    expect(f.runs().at(-1)?.status).toBe('thinking');
    expect(f.activity.mock.lastCall?.[0]['desktop-test']).toBe('thinking');
    accept(Response.json({queued:true}, {status:202}));
    await sending;
  } finally { f.close(); }
});
