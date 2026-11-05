import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {ChatState} from '../desktop/renderer/chat/models/chat';
import {createChatRuntime} from '../desktop/renderer/chat/services/runtime';
import {sceneItems} from '../desktop/renderer/chat/models/scenes';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('location', new URL('https://fixture.test/loom.html?scene_id=room&scene_strict=1'));
  vi.stubGlobal('document', Object.assign(new EventTarget(), {visibilityState: 'visible'}));
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('navigator', {onLine: true});
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => setTimeout(fn, 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();});

async function fixture(apiPrefix = "") {
  let active: any = null;
  let readActive: (() => Promise<Response>) | undefined;
  const history: any[] = [], posts: any[] = [];
  let post: (() => Response) | undefined;
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    if (apiPrefix) url.pathname = url.pathname.slice(apiPrefix.length);
    if (url.pathname === '/health') return new Response('OK fixture');
    if (url.pathname === '/api/history') return Response.json({messages: history.filter(m => m.seq > Number(url.searchParams.get('after') || 0))});
    if (url.pathname === '/api/stream/active') return readActive ? readActive() : active ? Response.json(active) : new Response(null, {status: 204});
    if (url.pathname === '/api/chat/stream') {
      posts.push(JSON.parse(String(init?.body)));
      if (post) return post();
      active = {stream_id: 'human-' + posts.length, scene_id: posts.at(-1).scene_id, origin: 'human', finished:false, next_seq:1, events:[]};
      return new Response(new ReadableStream({start(controller) {
        stream = controller;
        init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), {once:true});
        controller.enqueue(new TextEncoder().encode(`event: meta\ndata: ${JSON.stringify({stream_id:active.stream_id,scene_id:active.scene_id})}\n\n`));
      }}));
    }
    return Response.json({sbs_enabled:true});
  });
  vi.stubGlobal('fetch', fetcher);
  const state = new ChatState(), runtime = createChatRuntime(state, apiPrefix ? {connection:{api:"https://fixture.test" + apiPrefix,token:""}} : {});
  await runtime.start();
  return {state,runtime,history,posts,fetcher,
    setActive: (value:any) => {active=value;},
    setActiveRead: (value?:() => Promise<Response>) => {readActive=value;},
    setPost: (value:()=>Response) => {post=value;},
    closeStream: () => stream.close(),
    failStream: () => stream.error(new TypeError('Failed to fetch')),
    emit: (event:string, data:object) => stream.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)),
  };
}

it.each(['timeout', 'reply'])('tracks a follow-up accepted after the previous reply boundary until %s', async outcome => {
  const f = await fixture();
  try {
    await f.runtime.send('first');
    await vi.advanceTimersByTimeAsync(20);
    f.emit('tool_use', {scene_id:'room',name:'read'});
    f.emit('tool_result', {scene_id:'room',content:'done'});
    f.emit('content_block_delta', {scene_id:'room',delta:{text:'first answer'}});
    f.emit('message_stop', {scene_id:'room'});
    await vi.advanceTimersByTimeAsync(20);
    const first = f.state.items.find(i=>i.kind==='run')!;
    expect(first).toMatchObject({outcome:'done'});
    f.setPost(()=>Response.json({queued:true},{status:202}));
    await f.runtime.send('follow-up', [], {mode:'interrupt'});
    await vi.advanceTimersByTimeAsync(20);
    expect(f.posts).toHaveLength(2);
    const runs = f.state.items.filter(i=>i.kind==='run');
    expect(runs).toHaveLength(2);
    expect(runs[1]).toMatchObject({status:'queued',waitingForReply:true,entries:[]});
    if (outcome === 'reply') {
      f.emit('content_block_delta', {scene_id:'room',delta:{text:'follow-up answer'}});
      f.emit('message_stop', {scene_id:'room'});
    } else {
      f.setActive(null);
    }
    await vi.advanceTimersByTimeAsync(outcome === 'reply' ? 20 : 320000);
    expect(runs[1]).toMatchObject({outcome:outcome === 'reply' ? 'done' : 'timeout',end:expect.any(Number)});
    expect(first).toMatchObject({outcome:'done'});
    expect(f.state.items.filter(i=>i.kind==='run')).toHaveLength(2);
    expect(f.fetcher.mock.calls.some(([url])=>new URL(url).pathname==='/api/stop')).toBe(false);
  } finally {f.runtime.dispose();}
});

it.each(['reasoning', 'tool_use', 'content_block_delta'])('bounds an unresolved EOF after %s and releases another scene', async event => {
  const f = await fixture();
  try {
    await f.runtime.send('task without reply');
    await vi.advanceTimersByTimeAsync(20);
    f.emit(event, {scene_id:'room',text:'planning',name:'read',delta:{text:''}});
    await vi.advanceTimersByTimeAsync(20);
    f.closeStream();
    f.setActive(null);
    await vi.advanceTimersByTimeAsync(20);
    const run = f.state.items.find(i=>i.kind==='run')!;
    expect(run).toMatchObject({status:'waiting',waitingForReply:true});
    await f.runtime.selectScene({sceneId:'other',strict:true});
    f.setPost(()=>Response.json({queued:true},{status:202}));
    await f.runtime.send('next scene');
    expect(f.posts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(302000);
    expect(run).toMatchObject({outcome:'timeout',waitingForReply:false});
    expect(f.posts).toHaveLength(2);
    expect(f.posts[1]).toMatchObject({message:expect.stringContaining('next scene'),scene_id:'other'});
    expect(f.state.items.some(i=>i.kind==='message' && i.queued)).toBe(false);
    expect(f.fetcher.mock.calls.some(([url])=>new URL(url).pathname==='/api/stop')).toBe(false);
  } finally {f.runtime.dispose();}
});

it.each(['POST', 'reader before meta'])('shows a retryable error when a new %s fails after a completed stream', async failure => {
  const f = await fixture();
  try {
    await f.runtime.send('first');
    await vi.advanceTimersByTimeAsync(20);
    f.emit('content_block_delta', {scene_id:'room',delta:{text:'first answer'}});
    f.emit('message_stop', {scene_id:'room'});
    f.closeStream();
    f.setActive(null);
    await vi.advanceTimersByTimeAsync(20);
    f.setPost(()=>{
      if (failure === 'POST') throw new TypeError('Failed to fetch');
      return new Response(new ReadableStream({start(controller) { controller.error(new TypeError('Failed to fetch')); }}));
    });
    await f.runtime.send('second never delivered');
    await vi.advanceTimersByTimeAsync(10000);
    const attempts = failure === 'POST' ? 5 : 2;
    expect(f.posts).toHaveLength(attempts);
    const notice = f.state.items.find(i=>i.kind==='message' && i.role==='system' && i.retry);
    expect(notice).toMatchObject({retry:expect.any(Function),retryLabel:'重试'});
    expect(f.state.items.filter(i=>i.kind==='run').at(-1)).toMatchObject({outcome:'error'});
    expect(f.state.sendWillQueue).toBe(false);
    f.setPost(()=>Response.json({queued:true},{status:202}));
    if (notice?.kind === 'message') await notice.retry!();
    await vi.advanceTimersByTimeAsync(20);
    expect(f.posts).toHaveLength(attempts + 1);
    expect(f.state.items.filter(i=>i.kind==='message' && i.text==='second never delivered')).toHaveLength(1);
    expect(f.state.items.filter(i=>i.kind==='run').at(-1)).toMatchObject({status:'queued'});
  } finally {f.runtime.dispose();}
});

it.each([false, true])('tracks a fresh 200 stream returned to a follow-up through EOF (final reply: %s)', async replied => {
  const f = await fixture();
  try {
    await f.runtime.send('first');
    await vi.advanceTimersByTimeAsync(20);
    f.emit('content_block_delta', {scene_id:'room',delta:{text:'first answer'}});
    f.emit('message_stop', {scene_id:'room'});
    await vi.advanceTimersByTimeAsync(20);
    const events = [
      {event:'meta',data:{stream_id:'human-2',scene_id:'room'}},
      {event:'reasoning',data:{scene_id:'room',text:'new task'}},
      ...(replied ? [{event:'content_block_delta',data:{scene_id:'room',delta:{text:'new answer'}}}] : []),
    ];
    f.setPost(()=>new Response(events.map(({event,data})=>`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('')));
    await f.runtime.send('follow-up', [], {mode:'interrupt'});
    await vi.advanceTimersByTimeAsync(20);
    f.closeStream();
    f.setActive(null);
    const runs = f.state.items.filter(i=>i.kind==='run');
    expect(runs).toHaveLength(2);
    expect(runs[1]).toMatchObject({status:replied ? 'done' : 'waiting'});
    await vi.advanceTimersByTimeAsync(302000);
    expect(runs[1]).toMatchObject({outcome:replied ? 'done' : 'timeout'});
    expect(f.posts).toHaveLength(2);
    expect(f.state.sendWillQueue).toBe(false);
  } finally {f.runtime.dispose();}
});

it('still recovers a failed reader using the current stream identity', async () => {
  const f = await fixture();
  try {
    await f.runtime.send('recover my answer');
    await vi.advanceTimersByTimeAsync(20);
    f.setActive({stream_id:'human-1',scene_id:'room',origin:'human',finished:true,next_seq:4,events:[
      {seq:2,event:'content_block_delta',data:{scene_id:'room',delta:{text:'recovered answer'}}},
      {seq:3,event:'message_stop',data:{scene_id:'room'}},
    ]});
    f.failStream();
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.state.items.filter(i=>i.kind==='message' && i.text==='recovered answer')).toHaveLength(1);
    expect(f.state.items.some(i=>i.kind==='message' && i.retry)).toBe(false);
    expect(f.state.items.find(i=>i.kind==='run')).toMatchObject({outcome:'done'});
    expect(f.posts).toHaveLength(1);
  } finally {f.runtime.dispose();}
});

it.each(['callback', 'beating'])('discovers SBS %s while idle, lets a room interrupt it, and routes its continuation back to that room', async origin => {
  const f = await fixture();
  try {
    const active = {stream_id:'sbs',origin,scene_id:null,finished:false,next_seq:3,events:[
      {seq:1,event:'content_block_delta',data:{scene_id:null,delta:{text:'SBS progress'}}},
      {seq:2,event:'tool_use',data:{scene_id:null,name:'wait'}},
    ]};
    f.setActive(active);
    await vi.advanceTimersByTimeAsync(10020);
    expect(f.state.items.some(i=>i.kind==='message' && i.text==='SBS progress' && !i.sceneId)).toBe(true);
    expect(f.state.streaming).toBe(false);
    expect(f.state.sbsStreamingOrigin).toBe(origin);
    expect(f.state.items.find(i=>i.kind==='run' && !i.sceneId)).toMatchObject({autonomousOrigin:origin});
    f.state.historyScope = 'all';
    f.state.changed();
    await f.runtime.stopCurrentTurn();
    expect(f.fetcher.mock.calls.some(([url])=>new URL(url).pathname==='/api/stop')).toBe(false);
    f.setPost(()=>Response.json({queued:true},{status:202}));
    await f.runtime.send('human interrupt');
    await vi.advanceTimersByTimeAsync(20);
    expect(f.posts).toHaveLength(1);
    expect(f.state.items.find(i=>i.kind==='run' && i.sceneId==='room')).toMatchObject({label:
      `${origin === 'callback' ? 'SBS 自主回调进行中；' : 'SBS 自主处理进行中；'}消息已接收，正在切换到当前对话…`});
    expect(f.state.items.some(i=>i.kind==='message' && i.queued)).toBe(false);
    f.setActive({...active,next_seq:4,events:[
      {seq:3,event:'content_block_delta',data:{scene_id:'room',delta:{text:'human reply'}}},
    ]});
    await vi.advanceTimersByTimeAsync(500);
    expect(f.state.streaming).toBe(true);
    expect(f.state.sbsStreamingOrigin).toBeUndefined();
    expect(f.state.items.find(i=>i.kind==='run' && !i.sceneId)).toMatchObject({end:expect.any(Number),label:'已切换到场景对话'});
    expect(f.state.items.filter(i=>i.kind==='run' && !i.end)).toHaveLength(1);
    f.setActive({...active,next_seq:5,events:[
      {seq:4,event:'message_stop',data:{scene_id:'room'}},
    ]});
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.state.items.filter(i=>i.kind==='message' && i.text==='human reply')).toHaveLength(1);
    expect(f.state.items.find(i=>i.kind==='run' && i.sceneId==='room')).toMatchObject({outcome:'done'});
    expect(f.state.streaming).toBe(false);
    // A later autonomous segment reuses the same aggregate activity record.
    f.setActive({...active,next_seq:6,events:[
      {seq:5,event:'reasoning',data:{scene_id:null,text:'SBS resumes'}},
    ]});
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.state.sbsStreamingOrigin).toBe(origin);
    expect(f.state.streaming).toBe(false);
    expect(f.state.items.filter(i=>i.kind==='run' && !i.end)).toHaveLength(1);
    f.setActive({...active,finished:true,next_seq:7,events:[
      {seq:6,event:'message_stop',data:{scene_id:null}},
    ]});
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.state.sbsStreamingOrigin).toBeUndefined();
    expect(f.state.items.filter(i=>i.kind==='run' && !i.end)).toHaveLength(0);
  } finally {f.runtime.dispose();}
});

it('aggregates callback continuations and tool failures within one stream, but separates the next callback', async () => {
  const f = await fixture();
  try {
    const active = {stream_id:'callback-one',origin:'callback',scene_id:null,finished:false,next_seq:4,events:[
      {seq:1,event:'tool_use',data:{scene_id:null,name:'first'}},
      {seq:2,event:'tool_result',data:{scene_id:null,is_error:true,content:'failed'}},
      {seq:3,event:'message_stop',data:{scene_id:null}},
    ]};
    f.setActive(active);
    await vi.advanceTimersByTimeAsync(10020);
    const first = f.state.items.find(i=>i.kind==='run')!;
    expect(first).toMatchObject({end:expect.any(Number),streamId:'callback-one'});
    const start = first.kind==='run' ? first.start : 0;
    f.setActive({...active,next_seq:5,events:[
      {seq:4,event:'tool_use',data:{scene_id:null,name:'second'}},
    ]});
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.state.items.filter(i=>i.kind==='run')).toEqual([first]);
    expect(first).toMatchObject({end:undefined,start,entries:expect.arrayContaining([
      expect.objectContaining({name:'first',error:true}), expect.objectContaining({name:'second'})
    ])});
    expect(f.state.streaming).toBe(false);
    f.setActive({...active,finished:true,next_seq:8,events:[
      {seq:5,event:'tool_result',data:{scene_id:null,content:'done'}},
      {seq:6,event:'content_block_delta',data:{scene_id:null,delta:{text:'callback result'}}},
      {seq:7,event:'message_stop',data:{scene_id:null}},
    ]});
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.state.items.filter(i=>i.kind==='run')).toEqual([first]);
    expect(first).toMatchObject({end:expect.any(Number),start});
    expect(first.kind==='run' && first.entries.filter(e=>e.type==='tool')).toHaveLength(2);
    f.setActive({stream_id:'callback-two',origin:'callback',scene_id:null,finished:false,next_seq:2,events:[
      {seq:1,event:'reasoning',data:{scene_id:null,text:'separate callback'}},
    ]});
    await vi.advanceTimersByTimeAsync(10020);
    const runs=f.state.items.filter(i=>i.kind==='run');
    expect(runs).toHaveLength(2);
    expect(runs[1]).toMatchObject({streamId:'callback-two',entries:[expect.objectContaining({type:'think'})]});
  } finally {f.runtime.dispose();}
});

it('identifies SBS before its first delta even when the discovery response omits scene_id', async () => {
  const f = await fixture();
  try {
    f.setActive({stream_id:'sbs-empty',origin:'callback',finished:false,next_seq:1,events:[]});
    await vi.advanceTimersByTimeAsync(10020);
    expect(f.state.sbsStreamingOrigin).toBe('callback');
    expect(f.state.streaming).toBe(false);
    expect(f.state.items.filter(i=>i.kind==='run' && i.sceneId==='room')).toHaveLength(0);
    await f.runtime.stopCurrentTurn();
    expect(f.fetcher.mock.calls.some(([url])=>new URL(url).pathname==='/api/stop')).toBe(false);
  } finally {f.runtime.dispose();}
});

it('hands off SBS status even before its first autonomous progress event', async () => {
  const f = await fixture();
  try {
    const active = {stream_id:'sbs-pending',origin:'callback',scene_id:null,finished:false,next_seq:1,events:[]};
    f.setActive(active);
    await vi.advanceTimersByTimeAsync(10020);
    expect(f.state.sbsStreamingOrigin).toBe('callback');
    f.setActive({...active,next_seq:2,events:[
      {seq:1,event:'reasoning',data:{scene_id:'room',text:'working on room reply'}},
    ]});
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.state.sbsStreamingOrigin).toBeUndefined();
    expect(f.state.streaming).toBe(true);
  } finally {f.runtime.dispose();}
});

it('uses the explicit room identity for a scene reply on an SBS-origin transport', async () => {
  const f = await fixture();
  try {
    f.setActive({stream_id:'sbs-addressed',origin:'callback',scene_id:'room',finished:false,next_seq:2,
      events:[{seq:1,event:'reasoning',data:{scene_id:'room',text:'room work'}}]});
    await vi.advanceTimersByTimeAsync(10020);
    expect(f.state.streaming).toBe(true);
    expect(f.state.sbsStreamingOrigin).toBeUndefined();
    expect(f.state.items.find(i=>i.kind==='run')).toMatchObject({sceneId:'room',autonomousOrigin:undefined});
  } finally {f.runtime.dispose();}
});

it('brings in a short autonomous reply from history without refresh or focus', async () => {
  const f = await fixture();
  try {
    f.history.push({seq:1,role:'being',content:'short SBS result',at:new Date().toISOString()});
    await vi.advanceTimersByTimeAsync(10020);
    expect(f.state.items.filter(i=>i.kind==='message' && i.text==='short SBS result')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10020);
    expect(f.state.items.filter(i=>i.kind==='message' && i.text==='short SBS result')).toHaveLength(1);
  } finally {f.runtime.dispose();}
});

it('keeps one activity record when a refreshed human stream finishes after replay', async () => {
  const f = await fixture();
  try {
    const active = {stream_id:'refresh-human',origin:'human',finished:false,next_seq:5,events:[
      {seq:1,event:'reasoning',data:{scene_id:'room',text:'checking'}},
      {seq:2,event:'tool_use',data:{scene_id:'room',name:'read'}},
      {seq:3,event:'tool_result',data:{scene_id:'room',content:'done'}},
      {seq:4,event:'content_block_delta',data:{scene_id:'room',delta:{text:'answer'}}},
    ]};
    f.setActive(active);
    await vi.advanceTimersByTimeAsync(10020);
    expect(f.state.items.filter(i=>i.kind==='run')).toHaveLength(1);
    f.setActive({...active,finished:true,next_seq:6,events:[{seq:5,event:'message_stop',data:{scene_id:'room'}}]});
    await vi.advanceTimersByTimeAsync(3000);
    expect(f.state.items.filter(i=>i.kind==='run')).toHaveLength(1);
  } finally {f.runtime.dispose();}
});

it('does not reopen a completed replay when an older reconnect probe returns late', async () => {
  const f = await fixture();
  let resolve!: (response: Response) => void;
  try {
    const active = {stream_id:'refresh-race',origin:'human',finished:false,next_seq:4,events:[
      {seq:1,event:'tool_use',data:{scene_id:'room',name:'read'}},
      {seq:2,event:'tool_result',data:{scene_id:'room',content:'done'}},
      {seq:3,event:'content_block_delta',data:{scene_id:'room',delta:{text:'answer'}}},
    ]};
    f.setActive(active);
    await vi.advanceTimersByTimeAsync(10020);
    f.setActiveRead(() => {
      f.setActiveRead();
      return new Promise(r => {resolve = r;});
    });
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(20);
    expect(resolve).toBeTypeOf('function');
    const finished = {...active,finished:true,next_seq:5,events:[{seq:4,event:'message_stop',data:{scene_id:'room'}}]};
    f.setActive(finished);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.state.items.filter(i=>i.kind==='run')).toHaveLength(1);
    resolve(Response.json(finished));
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.state.items.filter(i=>i.kind==='run')).toHaveLength(1);
    expect(f.state.streaming).toBe(false);
  } finally {f.runtime.dispose();}
});

it('clears a stale open reader after server completion, reconciles the reply and releases the next scene', async () => {
  const f = await fixture();
  try {
    await f.runtime.send('first'); await vi.advanceTimersByTimeAsync(20);
    await f.runtime.selectScene({sceneId:'other',strict:true});
    await f.runtime.send('second');
    expect(f.posts).toHaveLength(1);
    f.history.push({seq:1,role:'user',content:'first',scene_id:'room'},
      {seq:2,role:'being',content:'server completed',scene_id:'room',at:new Date().toISOString()});
    f.setActive(null);
    await vi.advanceTimersByTimeAsync(12000);
    expect(f.posts).toHaveLength(2);
    expect(f.state.items.find(i=>i.kind==='run' && i.sceneId==='room')).toMatchObject({outcome:'done'});
    expect(f.fetcher.mock.calls.some(([url])=>new URL(url).pathname==='/api/stop')).toBe(false);
  } finally {f.runtime.dispose();}
});

it.each(['', '/being/alice'])('ignores an idle response captured before a new send (API prefix: %s)', async apiPrefix => {
  const f = await fixture(apiPrefix);
  let resolve!: (response:Response)=>void;
  try {
    f.setActiveRead(()=>new Promise(r=>{resolve=r;}));
    await vi.advanceTimersByTimeAsync(10000);
    f.setActiveRead();
    await f.runtime.send('new task'); await vi.advanceTimersByTimeAsync(20);
    resolve(new Response(null,{status:204}));
    await vi.advanceTimersByTimeAsync(20);
    f.emit('content_block_delta',{scene_id:'room',delta:{text:'still live'}});
    await vi.advanceTimersByTimeAsync(20);
    expect(f.state.items.find(i=>i.kind==='message' && i.text==='still live')).toMatchObject({streaming:true});
    expect(f.state.items.find(i=>i.kind==='run' && i.sceneId==='room')).toMatchObject({status:'replying'});
  } finally {f.runtime.dispose();}
});

it.each([{status:503,body:{}},{status:200,body:{}},{status:200,body:null}])('does not reset an active reader on an unavailable or malformed snapshot ($status, $body)', async ({status,body}) => {
  const f = await fixture();
  try {
    await f.runtime.send('active'); await vi.advanceTimersByTimeAsync(20);
    f.setActiveRead(async()=>Response.json(body, {status}));
    await vi.advanceTimersByTimeAsync(10020);
    f.emit('content_block_delta',{scene_id:'room',delta:{text:'preserved'}});
    await vi.advanceTimersByTimeAsync(20);
    expect(f.state.items.find(i=>i.kind==='message' && i.text==='preserved')).toMatchObject({streaming:true});
  } finally {f.runtime.dispose();}
});

it('releases a vanished stream with no reply after its bounded wait so another scene can send', async () => {
  const f = await fixture();
  try {
    await f.runtime.send('lost response'); await vi.advanceTimersByTimeAsync(20);
    f.setActive(null);
    await vi.advanceTimersByTimeAsync(311000);
    expect(f.state.streaming).toBe(false);
    expect(f.state.thinking).toBe(false);
    expect(f.state.items.find(i=>i.kind==='run' && i.sceneId==='room')).toMatchObject({outcome:'timeout',waitingForReply:false});
    await f.runtime.selectScene({sceneId:'other',strict:true});
    await f.runtime.send('next request');
    await vi.advanceTimersByTimeAsync(20);
    expect(f.posts).toHaveLength(2);
    expect(f.state.items.some(i=>i.kind==='message' && i.queued)).toBe(false);
    expect(f.fetcher.mock.calls.some(([url])=>new URL(url).pathname==='/api/stop')).toBe(false);
  } finally {f.runtime.dispose();}
});

it('keeps a server-confirmed running stream through idle checks and omits bodies from diagnostics', async () => {
  const f = await fixture();
  try {
    await f.runtime.send('PRIVATE_MESSAGE_SENTINEL');
    await vi.advanceTimersByTimeAsync(40000);
    f.emit('content_block_delta',{scene_id:'room',delta:{text:'PRIVATE_RESPONSE_SENTINEL'}});
    await vi.advanceTimersByTimeAsync(20);
    expect(f.state.items.find(i=>i.kind==='message' && i.text==='PRIVATE_RESPONSE_SENTINEL')).toMatchObject({streaming:true});
    const logs = vi.mocked(console.info).mock.calls.filter(call=>call[0]==='[chat-network]').map(call=>call[1]).join('\n');
    expect(logs).toContain('"status":200');
    expect(logs).not.toContain('PRIVATE_MESSAGE_SENTINEL');
    expect(logs).not.toContain('PRIVATE_RESPONSE_SENTINEL');
    expect(logs).not.toContain('content_block_delta');
  } finally {f.runtime.dispose();}
});

it.each([null, {stream_id:'completed', finished:true}])('releases a 202 orphan after consecutive idle confirmations (%j) and lets another scene send', async active => {
  const f = await fixture();
  try {
    f.setPost(()=>Response.json({queued:true},{status:202}));
    await f.runtime.send('accepted but never resumed');
    f.setActive(active);
    await vi.advanceTimersByTimeAsync(50000);
    expect(f.state.items.find(i=>i.kind==='run' && i.sceneId==='room')).toMatchObject({status:'queued'});
    await f.runtime.selectScene({sceneId:'other',strict:true});
    await f.runtime.send('next scene');
    expect(f.posts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(22000);
    expect(f.posts).toHaveLength(2);
    expect(f.state.items.find(i=>i.kind==='run' && i.sceneId==='room')).toMatchObject({outcome:'timeout',waitingForReply:false});
    expect(f.fetcher.mock.calls.some(([url])=>new URL(url).pathname==='/api/stop')).toBe(false);
  } finally {f.runtime.dispose();}
});

it('restarts the orphan grace period after an unavailable observation', async () => {
  const f = await fixture();
  try {
    f.setPost(()=>Response.json({queued:true},{status:202}));
    await f.runtime.send('awaiting resume');
    await vi.advanceTimersByTimeAsync(50000);
    f.setActiveRead(async()=>Response.json({}, {status:503}));
    await vi.advanceTimersByTimeAsync(30000);
    f.setActiveRead();
    await vi.advanceTimersByTimeAsync(50000);
    expect(f.state.items.find(i=>i.kind==='run' && i.sceneId==='room')).toMatchObject({status:'queued'});
    await vi.advanceTimersByTimeAsync(21000);
    expect(f.state.items.find(i=>i.kind==='run' && i.sceneId==='room')).toMatchObject({outcome:'timeout'});
  } finally {f.runtime.dispose();}
});

it('does not insert an old room timestamp after a newer visible SBS reply', async () => {
  const f = await fixture();
  try {
    f.state.setShowSbsMessages(true);
    f.history.push({seq:1,role:'being',content:'old room reply',scene_id:'room',at:new Date(Date.now()-600000).toISOString()});
    await vi.advanceTimersByTimeAsync(10020);
    f.history.push({seq:2,role:'being',content:'new SBS reply',at:new Date().toISOString()});
    await vi.advanceTimersByTimeAsync(10020);
    const before = f.state.items.filter(i=>i.kind==='separator' && !i.marker).length;
    await f.runtime.send('interrupt after global reply');
    expect(f.state.items.filter(i=>i.kind==='separator' && !i.marker)).toHaveLength(before);
  } finally {f.runtime.dispose();}
});


it.each([true, false])('shows an ordinary interrupt only on continuation and reconciles its history marker (scene metadata: %s)', async explicitScene => {
  const f = await fixture();
  try {
    void f.runtime.send('first');
    await vi.advanceTimersByTimeAsync(20);
    f.emit('reasoning', {scene_id:'room',text:'working'});
    await vi.advanceTimersByTimeAsync(20);
    f.setPost(()=>Response.json({queued:true},{status:202}));
    await f.runtime.send('change direction', [], {mode:'interrupt'});
    await vi.advanceTimersByTimeAsync(20);
    expect(f.state.items.find(i=>i.kind==='run')).toMatchObject({label:'消息已接收，正在调整回复方向…'});
    const markers = () => f.state.items.filter(i=>i.kind==='separator' && i.text.includes('转向你'));
    expect(markers()).toHaveLength(0);
    const at = new Date().toISOString();
    f.emit('meta', {continuation:true,...(explicitScene ? {scene_id:'room'} : {})});
    await vi.advanceTimersByTimeAsync(20);
    expect(markers()).toHaveLength(1);
    f.emit('meta', {continuation:true,...(explicitScene ? {scene_id:'room'} : {})});
    f.history.push({seq:1,from:'system',type:'marker',content:'[breath yielded]',scene_id:'room',at});
    await vi.advanceTimersByTimeAsync(10020);
    await vi.advanceTimersByTimeAsync(20);
    expect(markers()).toHaveLength(1);
    expect(markers()[0]).toMatchObject({historySeq:1});
  } finally {f.runtime.dispose();}
});

it('keeps unaddressed persisted handoffs out of the current room SBS view', async () => {
  const f = await fixture();
  try {
    f.history.push({seq:1,from:'system',type:'marker',content:'[breath yielded]',at:new Date().toISOString()});
    await f.runtime.refreshHistory();
    expect(f.state.items.find(i=>i.kind==='separator' && i.marker)).toMatchObject({handoffMarker:true});
    expect(sceneItems(f.state.items,'current',{sceneId:'room',strict:true},true).some(i=>i.kind==='separator' && i.marker)).toBe(false);
    expect(sceneItems(f.state.items,'all',{sceneId:'room'},true).some(i=>i.kind==='separator' && i.marker)).toBe(true);
  } finally {f.runtime.dispose();}
});

it('restores one continuation marker from a refreshed stream with user history', async () => {
  const f = await fixture();
  try {
    f.history.push({seq:1,role:'user',content:'change direction',scene_id:'room',at:new Date().toISOString()});
    await vi.advanceTimersByTimeAsync(10020);
    f.setActive({stream_id:'refresh-interrupt',origin:'human',scene_id:'room',finished:false,next_seq:3,events:[
      {seq:1,event:'meta',data:{continuation:true,scene_id:'room'}},
      {seq:2,event:'reasoning',data:{scene_id:'room',text:'new direction'}},
    ]});
    await vi.advanceTimersByTimeAsync(10020);
    expect(f.state.items.filter(i=>i.kind==='separator' && i.text.includes('转向你'))).toHaveLength(1);
  } finally {f.runtime.dispose();}
});

it('does not turn the settled prefix of a resumed human stream into a zero-second run', async () => {
  const f = await fixture();
  try {
    const at = new Date(Date.now() - 6000).toISOString();
    f.history.push(
      {seq:10,from:'system',type:'marker',content:'[breath yielded]',scene_id:'room',at},
      {seq:11,role:'user',content:'change direction',scene_id:'room',at:new Date(Date.now() - 5900).toISOString()},
    );
    await f.runtime.refreshHistory();
    const events = Array.from({length:9}, (_, index) => [
      {seq:7147+index*2,event:'tool_use',data:{scene_id:'room',id:`old-${index}`,name:'old task'}},
      {seq:7148+index*2,event:'tool_result',data:{scene_id:'room',tool_use_id:`old-${index}`,content:'done'}},
    ]).flat();
    f.setActive({stream_id:'resumed-human',origin:'human',finished:false,next_seq:8745,events:[
      ...events,
      {seq:8534,event:'content_block_delta',data:{scene_id:'room',delta:{text:'earlier progress'}}},
      {seq:8535,event:'message_stop',data:{scene_id:'room'}},
      {seq:8536,event:'meta',data:{continuation:true,scene_id:'room'}},
      {seq:8742,event:'tool_use',data:{scene_id:'room',id:'new-tool',name:'current task'}},
      {seq:8744,event:'tool_result',data:{scene_id:'room',tool_use_id:'new-tool',content:'done'}},
    ]});
    await vi.advanceTimersByTimeAsync(10020);
    const runs = f.state.items.filter(item => item.kind==='run');
    expect(runs).toHaveLength(1);
    expect(runs[0].entries.filter(entry=>entry.type==='tool').map(entry=>entry.name)).toEqual(['current task']);
    expect(f.state.items.some(item=>item.kind==='message' && item.text==='earlier progress')).toBe(true);
    expect(f.state.items.filter(item=>item.kind==='separator' && item.text.includes('转向你'))).toHaveLength(1);
    expect(f.state.items.find(item=>item.kind==='separator' && item.text.includes('转向你'))).toMatchObject({historySeq:10});
    f.setActive({stream_id:'resumed-human',origin:'human',finished:true,next_seq:8747,events:[
      {seq:8745,event:'content_block_delta',data:{scene_id:'room',delta:{text:'new answer'}}},
      {seq:8746,event:'message_stop',data:{scene_id:'room'}},
    ]});
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.state.items.filter(item=>item.kind==='run')).toHaveLength(1);
    expect(runs[0]).toMatchObject({outcome:'done'});
  } finally {f.runtime.dispose();}
});


it('does not drop unrelated durable replies from the same room during a newer live turn', async () => {
  const f = await fixture();
  try {
    await f.runtime.send('new live question');
    await vi.advanceTimersByTimeAsync(20);
    f.emit('content_block_delta', { scene_id: 'room', delta: { text: 'new live reply' } });
    await vi.advanceTimersByTimeAsync(30);
    f.history.push({ seq: 1, role: 'user', scene_id: 'room', content: 'older question', at: '2026-10-01T01:00:00Z' },
      { seq: 2, role: 'being', scene_id: 'room', content: 'older durable reply', at: '2026-10-01T01:00:01Z' });
    await f.runtime.refreshHistory();
    expect(f.state.items.some(item => item.kind === 'message' && item.historySeq === 2 && item.text === 'older durable reply')).toBe(true);
    expect(f.state.items.some(item => item.kind === 'message' && item.text === 'new live reply' && item.streaming)).toBe(true);
  } finally { f.runtime.dispose(); }
});

it('keeps a scene wait deadline and progress independent of another scene on the shared SSE', async () => {
  const f = await fixture();
  try {
    await f.runtime.send('finish this scene');
    await vi.advanceTimersByTimeAsync(20);
    f.emit('content_block_delta', {scene_id:'room',delta:{text:'stage reply'}});
    f.emit('meta', {scene_id:'room',persisted:{kind:'self',seq:10,from:'partial',stream_id:'human-1'}});
    f.emit('message_stop', {scene_id:'room'});
    await vi.advanceTimersByTimeAsync(20);
    const run = f.state.items.find(i=>i.kind==='run' && i.sceneId==='room')!;
    const waits = () => vi.mocked(console.info).mock.calls.filter(call=>call[0]==='[chat-reply-wait]')
      .map(call=>JSON.parse(call[1])).filter(e=>e.sceneId==='room');
    const initial = waits().find(e=>e.event==='started');
    expect(run).toMatchObject({status:'waiting'});
    await vi.advanceTimersByTimeAsync(60000);
    f.emit('content_block_delta', {scene_id:'other',delta:{text:'another scene answer'}});
    f.emit('meta', {scene_id:'other',persisted:{kind:'self',seq:11,from:'final',stream_id:'human-1'}});
    f.emit('message_stop', {scene_id:'other'});
    f.closeStream(); f.setActive(null);
    await vi.advanceTimersByTimeAsync(20);
    expect(run).toMatchObject({status:'waiting'});
    expect(waits().at(-1).lastProgressAt).toBe(initial.lastProgressAt);
    expect(waits().at(-1).waitDeadline).toBe(initial.waitDeadline);
    await vi.advanceTimersByTimeAsync(240000);
    expect(run).toMatchObject({outcome:'timeout',waitingForReply:false});
    expect(f.state.items.find(i=>i.kind==='message' && i.text==='another scene answer')).toMatchObject({sceneId:'other'});
    expect(f.fetcher.mock.calls.some(([url])=>new URL(url).pathname==='/api/stop')).toBe(false);
  } finally {f.runtime.dispose();}
});

it('starts a fresh wait when its own scene resumes processing', async () => {
  const f = await fixture();
  try {
    await f.runtime.send('resume later');
    await vi.advanceTimersByTimeAsync(20);
    f.emit('reasoning', {scene_id:'room',text:'first phase'});
    f.emit('message_stop', {scene_id:'room'});
    await vi.advanceTimersByTimeAsync(60000);
    f.emit('tool_use', {scene_id:'room',id:'t',name:'read'});
    f.emit('tool_result', {scene_id:'room',tool_use_id:'t',content:'done'});
    f.emit('message_stop', {scene_id:'room'});
    f.closeStream(); f.setActive(null);
    await vi.advanceTimersByTimeAsync(240020);
    const run = f.state.items.find(i=>i.kind==='run')!;
    expect(run).toMatchObject({status:'waiting'});
    await vi.advanceTimersByTimeAsync(60000);
    expect(run).toMatchObject({outcome:'timeout'});
  } finally {f.runtime.dispose();}
});

it.each(['ack', 'history'])('recognizes a final %s for speech already split off before a tool', async source => {
  const f = await fixture();
  try {
    await f.runtime.send('read and answer');
    await vi.advanceTimersByTimeAsync(20);
    f.emit('content_block_delta', {scene_id:'room',delta:{text:'the answer'}});
    f.emit('tool_use', {scene_id:'room',id:'t',name:'read'});
    f.emit('tool_result', {scene_id:'room',tool_use_id:'t',content:'done'});
    await vi.advanceTimersByTimeAsync(20);
    const message = f.state.items.find(i=>i.kind==='message' && i.text==='the answer')!;
    expect(message).toMatchObject({interim:true});
    if (source === 'ack') f.emit('meta', {scene_id:'room',persisted:{kind:'self',seq:10,from:'final',stream_id:'human-1'}});
    else {
      f.history.push({seq:10,role:'being',from:'final',scene_id:'room',content:'the answer',at:new Date().toISOString()});
      await f.runtime.refreshHistory();
    }
    f.emit('message_stop', {scene_id:'room'});
    f.closeStream(); f.setActive(null);
    await vi.advanceTimersByTimeAsync(10020);
    expect(message).toMatchObject({interim:false,historySeq:10});
    expect(f.state.items.find(i=>i.kind==='run')).toMatchObject({outcome:'done',label:'已回复'});
    expect(f.state.items.filter(i=>i.kind==='message' && i.text==='the answer')).toHaveLength(1);
  } finally {f.runtime.dispose();}
});

it('reconciles a timed-out scene when its final reply arrives in history, without resending', async () => {
  const f = await fixture();
  try {
    f.setPost(()=>new Response(''));
    await f.runtime.send('late result');
    await vi.advanceTimersByTimeAsync(300100);
    const run = f.state.items.find(i=>i.kind==='run')!;
    expect(run).toMatchObject({outcome:'timeout'});
    f.history.push({seq:1,role:'being',from:'final',scene_id:'other',content:'other result',at:new Date().toISOString()},
      {seq:2,role:'being',from:'partial',scene_id:'room',content:'still working',at:new Date().toISOString()});
    await f.runtime.refreshHistory();
    expect(run).toMatchObject({outcome:'timeout'});
    f.history.push({seq:3,role:'being',from:'final',scene_id:'room',content:'late final result',at:new Date().toISOString()});
    await f.runtime.selectScene({sceneId:'other',strict:true});
    await f.runtime.refreshHistory();
    expect(run).toMatchObject({outcome:'done',status:'done',label:'已回复',hint:'',waitingForReply:false});
    expect(f.posts).toHaveLength(1);
    expect(f.fetcher.mock.calls.some(([url])=>new URL(url).pathname==='/api/stop')).toBe(false);
  } finally {f.runtime.dispose();}
});

it('does not let a newer request answer overwrite an older timeout in the same scene', async () => {
  const f = await fixture();
  try {
    f.setPost(()=>new Response(''));
    await f.runtime.send('old request');
    await vi.advanceTimersByTimeAsync(300100);
    const old = f.state.items.find(i=>i.kind==='run')!;
    await f.runtime.send('new request');
    await vi.advanceTimersByTimeAsync(20);
    f.history.push({seq:1,role:'being',from:'final',scene_id:'room',content:'new answer',at:new Date().toISOString()});
    await f.runtime.refreshHistory();
    expect(old).toMatchObject({outcome:'timeout'});
    expect(f.state.items.filter(i=>i.kind==='run').at(-1)).toMatchObject({outcome:'done',label:'已回复'});
  } finally {f.runtime.dispose();}
});
