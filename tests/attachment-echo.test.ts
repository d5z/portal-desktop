import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ChatState} from '../desktop/renderer/chat/models/chat';
import {createChatRuntime} from '../desktop/renderer/chat/services/runtime';
import {SceneQueueStore, type SavedSceneSend} from '../desktop/renderer/chat/services/scene-queue';
import {AttachmentMessageContent} from '../desktop/renderer/chat/components/message-content';
import {attachmentProgress} from '../desktop/renderer/chat/components/attachments';
const endpoint='https://echo.beings.town/alice', id='msg_'+'a'.repeat(64);
const file = () => ({name:'notes.txt',type:'text/plain',size:3,base64:'YWJj'});
let rows: Map<string,SavedSceneSend>, history: any[], delivery:string, jobState:string, posts:any[], requests:string[];
let failSend=false, sendStatus=202;
let parseForces: boolean[] = [];
const view = () => ({version:1,message_id:id,channel:'portal',scene_id:'room',scene_label:'Room',created_at:Math.floor(Date.now()/1000),delivery_status:delivery,
  parts:[{type:'text',text:'原始问题'},{type:'attachment',attachment_id:'att_one',name:'notes.txt',mime:'text/plain',size:3,job_id:parseForces.length?'job_one':undefined,parse_status:jobState==='succeeded'?'ready':'parsing',parse_result_id:jobState==='succeeded'?'result_one':null}]});
beforeEach(() => {
  vi.useFakeTimers(); rows=new Map(); history=[]; delivery='pending';jobState='succeeded';posts=[];requests=[];failSend=false;sendStatus=202;parseForces=[];
  vi.stubGlobal('location',new URL('beings://chat/?history_scope='+encodeURIComponent(endpoint)+'&scene_id=room'));
  vi.stubGlobal('document',Object.assign(new EventTarget(),{visibilityState:'visible'}));vi.stubGlobal('window',new EventTarget());vi.stubGlobal('navigator',{onLine:true});
  vi.stubGlobal('requestAnimationFrame',(fn:()=>void)=>setTimeout(fn,16));vi.stubGlobal('cancelAnimationFrame',clearTimeout);
  vi.spyOn(SceneQueueStore.prototype,'write').mockImplementation(async row=>{if(typeof row==='string')rows.delete(row);else rows.set(row.id,structuredClone(row));});
  vi.spyOn(SceneQueueStore.prototype,'read').mockImplementation(async ()=>structuredClone([...rows.values()]));
  vi.stubGlobal('fetch',vi.fn(async (input:string,init:RequestInit={})=>{
    const url=new URL(input);requests.push(url.pathname);
    if(url.pathname==='/api/stream/active')return new Response(null,{status:204});
    if(url.pathname==='/health')return new Response('OK fixture');
    if(url.pathname==='/api/history')return Response.json({messages:history});
    if(url.pathname==='/api/chat/stream'){posts.push(JSON.parse(init.body as string));if(failSend)throw new TypeError('connection lost');return Response.json({}, {status:sendStatus});}
    if(url.pathname==='/api/attachments')return Response.json({attachment_id:'att_one',status:'ready'});
    if(url.pathname==='/api/attachments/att_one/parse'){parseForces.push(JSON.parse(init.body as string).force);return Response.json({job_id:'job_one',attachment_id:'att_one',status:'pending'});}
    if(url.pathname==='/api/media-jobs/job_one')return Response.json({job_id:'job_one',attachment_id:'att_one',status:jobState,result_id:jobState==='succeeded'?'result_one':null,progress:{stage:'assembling',completed:2,total:2}});
    if(url.pathname==='/api/attachments/att_one/parsed')return Response.json({attachment_id:'att_one',parse_result_id:'result_one',complete:true,total_segments:1,segments:[{text:'解析资料'}],next_cursor:null});
    if(url.pathname==='/api/attachment-messages'&&init.method!=='POST')return Response.json({messages:rows.size&&delivery!=='accepted'?[view()]:[],next_cursor:null});
    if(url.pathname.startsWith('/api/attachment-messages')){if(init.method==='POST'){const body=JSON.parse(init.body as string);if(body.delivery_status)delivery=body.delivery_status;}return Response.json(view());}
    return Response.json({name:'Alice',being_id:'alice',presets:[]});
  }));
});
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllGlobals();});
async function start(){const state=new ChatState();const runtime=createChatRuntime(state);const starting=runtime.start();await vi.advanceTimersByTimeAsync(50);await starting;await vi.advanceTimersByTimeAsync(0);return {state,runtime};}
describe('desktop attachment queue and echo',()=>{
  it('lets ordinary messages pass a failed attachment while keeping it retryable',async()=>{
    jobState='failed';const {state,runtime}=await start();try {
      await runtime.send('bad attachment',[file()]);await vi.advanceTimersByTimeAsync(4000);
      const failed=state.items.find((m:any)=>m.retry) as any;
      expect(failed).toBeDefined();expect(state.attachmentPending).toBe(false);
      await runtime.send('continue without attachment',[]);await vi.advanceTimersByTimeAsync(0);
      expect(posts).toHaveLength(1);expect(posts[0].message).toContain('continue without attachment');
      expect(failed.retry).toBeTypeOf('function');expect(rows.size).toBe(1);
      await failed.cancelQueued();expect(rows.size).toBe(0);
    }finally{runtime.dispose();}
  });
  it('merges discovered other-scene attachments chronologically with Heart history',async()=>{
    const now=Date.now();history=[{seq:1,role:'user',content:'最新提问',scene_id:'room',at:new Date(now).toISOString()},{seq:2,role:'assistant',content:'最新回复',scene_id:'room',at:new Date(now+1000).toISOString()}];
    const original=globalThis.fetch;
    vi.stubGlobal('fetch',vi.fn((input:string,init:RequestInit={})=>{
      if(new URL(input).pathname==='/api/attachment-messages' && init.method!=='POST')return Promise.resolve(Response.json({messages:[{...view(),scene_id:'samples',created_at:Math.floor(now/1000)-3600}],next_cursor:null}));
      return original(input,init);
    }));
    const {state,runtime}=await start();try{
      await vi.advanceTimersByTimeAsync(0);
      const messages=state.items.filter((item:any)=>item.kind==='message');
      expect(messages[0].id).toBe('attachment-'+id);
      expect(messages.findIndex((item:any)=>item.text==='最新提问')).toBeGreaterThan(0);
    }finally{runtime.dispose();}
  });

  it('keeps desktop files as Blobs and accepts files over the old 10 MiB limit',async()=>{
    const {state,runtime}=await start();try {
      const reader = vi.fn(); vi.stubGlobal('FileReader',reader);
      const file = new File([new Uint8Array(11 * 1024 * 1024)], 'large.bin', {type:'application/octet-stream'});
      runtime.handleFiles([file]);await vi.advanceTimersByTimeAsync(0);
      expect(state.files).toHaveLength(1);expect(state.files[0].blob).toBe(file);expect(state.files[0].base64).toBe('');expect(reader).not.toHaveBeenCalled();
      expect(requests.filter(path=>path==='/api/attachments')).toHaveLength(0);
      runtime.handleFiles([{name:'oversize.bin',size:128 * 1024 * 1024 + 1} as File]);await vi.advanceTimersByTimeAsync(0);
      expect(state.files).toHaveLength(1);expect(state.items.some((m:any)=>m.text?.includes('128 MiB'))).toBe(true);
    }finally{runtime.dispose();}
  });
  it('sends parsed context once, with a stable marker and no original base64',async()=>{
    const {state,runtime}=await start();try{
      await runtime.send('原始问题',[file()]);await vi.advanceTimersByTimeAsync(0);
      expect(posts).toHaveLength(1);expect(posts[0].message).toContain('解析资料');expect(posts[0].message).toContain(`[attachment-message:v1:${id}]`);expect(posts[0].attachments).toBeUndefined();
      expect(delivery).toBe('accepted');expect(rows.size).toBe(0);
      expect(state.items.some((m:any)=>m.attachmentViews?.[0].message_id===id)).toBe(true);
    }finally{runtime.dispose();}
  });
  it.each([200, 202])('keeps the attachment reply in the right turn while status sync is pending (%s)', async status => {
    const oldTime = new Date(Date.now() - 1000).toISOString();
    history = [{seq:1,role:'assistant',content:'上一条回复',scene_id:'room',at:oldTime}];
    const original = globalThis.fetch;
    let finishStatus!: () => void;
    const accepted = new Promise<void>(resolve => { finishStatus = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
      const pathname = new URL(input).pathname;
      if (pathname.startsWith('/api/attachment-messages') && init.method === 'POST' &&
          JSON.parse(init.body as string).delivery_status === 'accepted') await accepted;
      if (pathname === '/api/chat/stream') {
        posts.push(JSON.parse(init.body as string));
        return status === 200
          ? new Response('event: content_block_delta\ndata: {"delta":{"text":"附件回复"}}\n\nevent: message_stop\ndata: {}\n\n')
          : new Response(new ReadableStream(), {status: 202});
      }
      return original(input, init);
    }));
    const {state,runtime} = await start();
    try {
      await runtime.send('原始问题', [file()]);
      await vi.advanceTimersByTimeAsync(0);
      expect(posts).toHaveLength(1);
      const position = () => state.items.map(item => item.kind === 'message' ? item.text : item.kind);
      expect(position().indexOf('原始问题')).toBeGreaterThan(position().indexOf('上一条回复'));
      expect(position().indexOf('run')).toBeGreaterThan(position().indexOf('原始问题'));
      if (status === 202) {
        const at = new Date().toISOString();
        history.push({seq:2,role:'user',content:posts[0].message,scene_id:'room',at},
          {seq:3,role:'assistant',content:'附件回复',scene_id:'room',at});
        await vi.advanceTimersByTimeAsync(2200);
      }
      expect(position().indexOf('附件回复')).toBeGreaterThan(position().indexOf('原始问题'));
      expect(state.streaming).toBe(false);
      expect(state.items.filter(item => item.kind === 'run').at(-1)?.waitingForReply).toBe(false);
    } finally {
      finishStatus();
      await vi.advanceTimersByTimeAsync(0);
      runtime.dispose();
    }
  });
  it('does not retry a Heart request with an unknown outcome, including after restart',async()=>{
    failSend=true;let current=await start();
    await current.runtime.send('',[file()]);await vi.advanceTimersByTimeAsync(0);expect(posts).toHaveLength(1);expect(delivery).toBe('unknown');
    current.runtime.dispose();current=await start();try{await vi.advanceTimersByTimeAsync(10000);expect(posts).toHaveLength(1);expect(rows.size).toBe(1);}finally{current.runtime.dispose();}
  });
  it('resumes the same parser job after restart without uploading or forcing a new parse',async()=>{
    jobState='running';let current=await start();await current.runtime.send('原始问题',[file()]);await vi.advanceTimersByTimeAsync(0);
    expect(posts).toHaveLength(0);expect([...rows.values()][0].files[0].jobId).toBe('job_one');current.runtime.dispose();await vi.advanceTimersByTimeAsync(0);
    const uploads=requests.filter(p=>p==='/api/attachments').length, parses=requests.filter(p=>p.endsWith('/parse')).length;
    jobState='succeeded';current=await start();try{await vi.advanceTimersByTimeAsync(0);expect(posts).toHaveLength(1);expect(requests.filter(p=>p==='/api/attachments')).toHaveLength(uploads);expect(requests.filter(p=>p.endsWith('/parse'))).toHaveLength(parses);}finally{current.runtime.dispose();}
  });
  it('stops an in-flight upload through the same composer action',async()=>{
    const original=globalThis.fetch;let aborted=false;
    vi.stubGlobal('fetch',vi.fn((input:string,init:RequestInit={})=>{
      if(new URL(input).pathname==='/api/attachments')return new Promise<Response>((_resolve,reject)=>{
        const cancel=()=>{aborted=true;reject(new DOMException('Cancelled','AbortError'));};
        if(init.signal?.aborted)cancel();else init.signal?.addEventListener('abort',cancel,{once:true});
      });
      return original(input,init);
    }));
    const {state,runtime}=await start();try{
      await runtime.send('原始问题',[file()]);await vi.advanceTimersByTimeAsync(0);
      expect(state.attachmentPending).toBe(true);
      await runtime.stopCurrentTurn();await vi.advanceTimersByTimeAsync(3000);
      expect(aborted).toBe(true);expect(state.attachmentPending).toBe(false);
      expect(rows.size).toBe(0);expect(parseForces).toHaveLength(0);expect(posts).toHaveLength(0);
    }finally{runtime.dispose();}
  });
  it('uses the composer stop action to cancel parsing and never sends its result',async()=>{
    jobState='running';const {state,runtime}=await start();try{await runtime.send('原始问题',[file()]);await vi.advanceTimersByTimeAsync(0);
      expect(state.attachmentPending).toBe(true);expect(state.streaming).toBe(false);
      await runtime.stopCurrentTurn();expect(state.attachmentPending).toBe(false);expect(state.stopping).toBe(false);jobState='succeeded';await vi.advanceTimersByTimeAsync(3000);
      expect(posts).toHaveLength(0);expect(delivery).toBe('cancelled');expect(rows.size).toBe(0);
    }finally{runtime.dispose();}
  });
  it('restores accepted attachments from history markers even when pending is empty',async()=>{
    delivery='accepted';history=[{seq:1,role:'user',content:`原始问题\n解析资料\n[attachment-message:v1:${id}]`,scene_id:'room',at:new Date().toISOString()}];
    const {state,runtime}=await start();try{await vi.advanceTimersByTimeAsync(0);
      const users=state.items.filter((m:any)=>m.kind==='message'&&m.role==='user') as any[];expect(users).toHaveLength(1);expect(users[0].attachmentViews[0].message_id).toBe(id);
      const markup=renderToStaticMarkup(createElement(AttachmentMessageContent,{message:users[0]}));expect(markup).toContain('原始问题');expect(markup).toContain('notes.txt');expect(markup).not.toContain('解析资料');expect(markup).not.toContain('attachment-message:v1');
    }finally{runtime.dispose();}
  });
  it('stops attachment polling once history has a completed accepted view',async()=>{
    delivery='accepted';history=[{seq:1,role:'user',content:`原始问题\n[attachment-message:v1:${id}]`,scene_id:'room',at:new Date().toISOString()}];
    const {runtime}=await start();try{
      await vi.advanceTimersByTimeAsync(50);
      const count=()=>requests.filter(path=>path.startsWith('/api/attachment-messages')).length;
      const initial=count();await vi.advanceTimersByTimeAsync(60000);
      expect(count()).toBe(initial);
    }finally{runtime.dispose();}
  });
  it('treats proxy 502 as unknown and never automatically retries',async()=>{
    sendStatus=502;const {runtime}=await start();try {await runtime.send('原始问题',[file()]);await vi.advanceTimersByTimeAsync(5000);
      expect(posts).toHaveLength(1);expect(delivery).toBe('unknown');
    }finally{runtime.dispose();}
  });
  it('lets a user retry a definitive rejected send using the same files and parse jobs',async()=>{
    sendStatus=400;const {state,runtime}=await start();try {await runtime.send('原始问题',[file()]);await vi.advanceTimersByTimeAsync(0);
      expect(posts).toHaveLength(1);expect(delivery).toBe('failed');
      const item=state.items.find((m:any)=>m.retry) as any;expect(item).toBeDefined();sendStatus=202;await item.retry();await vi.advanceTimersByTimeAsync(0);
      expect(posts).toHaveLength(2);expect(delivery).toBe('accepted');expect(parseForces).toEqual([false]);
    }finally{runtime.dispose();}
  });
  it('requires a manual action to force a failed parse',async()=>{
    jobState='failed';const {state,runtime}=await start();try {await runtime.send('原始问题',[file()]);await vi.advanceTimersByTimeAsync(4000);
      expect(posts).toHaveLength(0);expect(parseForces).toEqual([false]);
      const item=state.items.find((m:any)=>m.retry) as any;expect(item).toBeDefined();jobState='succeeded';await item.retry();await vi.advanceTimersByTimeAsync(0);
      expect(posts).toHaveLength(1);expect(parseForces).toEqual([false,true]);
    }finally{runtime.dispose();}
  });
  it('merges the local attachment bubble with exact history identity',async()=>{
    const {state,runtime}=await start();try{await runtime.send('原始问题',[file()]);await vi.advanceTimersByTimeAsync(0);
      history=[{seq:1,role:'user',content:posts[0].message,scene_id:'room',at:new Date().toISOString()}];
      const refreshing=runtime.refreshHistory();await vi.advanceTimersByTimeAsync(50);await refreshing;
      const users=state.items.filter((m:any)=>m.kind==='message'&&m.role==='user') as any[];
      expect(users).toHaveLength(1);expect(users[0].historySeq).toBe(1);expect(users[0].attachmentViews[0].message_id).toBe(id);
    }finally{runtime.dispose();}
  });
  it('does not display 100% success while results are assembling',()=>{
    expect(attachmentProgress({...view().parts[1],type:'attachment',progress:{stage:'assembling',completed:2,total:2},parse_status:'parsing'} as any)).toBe('正在整理完整结果');
  });
});
