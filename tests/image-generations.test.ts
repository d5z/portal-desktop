import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatProxy } from '../desktop/main/chat/proxy';
import { parseConnection } from '../desktop/main/chat/connection';
import { generationSnapshot, generationWait, parseImageGenerationReceipt, type ImageGenerationJob } from '../desktop/shared/image-generation';
import { GenerationQueryError, watchImageGeneration, type GenerationViewState } from '../desktop/renderer/chat/services/image-generations';
import { ImageGenerationAnswer } from '../desktop/renderer/chat/components/image-generation';
import { replyBubbles } from '../desktop/renderer/chat/models/reply-bubbles';
import type { Message } from '../desktop/renderer/chat/models/chat';

const job: ImageGenerationJob = {index:1,title:'暹罗猫',submission:'accepted',generation_id:'gen_one',client_request_id:'cat-one',error_code:null};
const receipt = {type:'being.image-generation',version:1,being_id:'alice',jobs:[job]};
const connection = parseConnection('https://echo.beings.town/alice/?token=private-heart-token');
const headers = {'X-Portal-Being-Endpoint':connection.endpoint,'X-Portal-Generation-Being':'alice'};
const request = (path = 'gen_one', options: RequestInit = {}) => new Request('beings://chat/api/image-generations/' + path,{headers,...options});
const raw = (changes: Record<string,unknown> = {}) => ({id:'gen_one',client_request_id:'cat-one',status:'running',stage:'generating',deadline:Date.now()+60000,poll_after_ms:2000,required_action:null,error_code:null,availability:'pending',manifest:null,...changes});
const output = {id:'out_one',attachment:{source:'being-service',attachment_id:'att_one'},mime:'image/png',view_url:'https://beings.town/api/being-service/v1/assets/att_one/view?token=v1.signature-3a_original'};
const success = () => raw({status:'succeeded',stage:'complete',availability:'available',manifest:{version:1,kind:'image',outputs:[output]}});
const snapshot = (changes = {}) => generationSnapshot(raw(changes),'https://beings.town');
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});

describe('image receipt protocol and rendering',()=>{
  it('accepts exact receipts including unknown submissions, rejects invalid versions, secrets, duplicates and invented shapes',()=>{
    expect(parseImageGenerationReceipt(JSON.stringify(receipt))).toEqual(receipt);
    expect(parseImageGenerationReceipt(JSON.stringify({...receipt,jobs:[{...job,submission:'unknown',generation_id:null}]}))).not.toBeNull();
    for (const value of [{...receipt,version:2},{...receipt,token:'secret'},{...receipt,jobs:[job,{...job,index:2}]},{...receipt,jobs:[{...job,generation_id:null}]},{...receipt,jobs:[{...job,generation_id:'https://evil.test'}]},{...receipt,jobs:[{...job,index:0}]},{...receipt,jobs:[{...job,error_code:undefined}]}]) expect(parseImageGenerationReceipt(JSON.stringify(value))).toBeNull();
    expect(parseImageGenerationReceipt('```json\n'+JSON.stringify(receipt)+'\n```')).toBeNull();
    expect(parseImageGenerationReceipt(JSON.stringify(receipt)+' trailing')).toBeNull();
  });
  it('holds streaming receipts and explains malformed receipts without starting Markdown rendering',()=>{
    const render=(text:string,streaming=false,enabled=true)=>renderToStaticMarkup(createElement(ImageGenerationAnswer,{text,streaming,enabled,endpoint:connection.endpoint,scope:'room',children:'markdown fallback'}));
    expect(render('{"type":"being.image-generation",',true)).toContain('正在确认图片任务');
    expect(render('{"type":"being.image-generation",')).toContain('不要重新生成');
    expect(render('普通消息')).toContain('markdown fallback');
    const html=render(JSON.stringify(receipt));
    expect(html).toContain('image-generation-card');expect(html).not.toContain('markdown fallback');
    expect(html).not.toContain('<code'); expect(html).not.toContain('private-heart-token');
    expect(render(JSON.stringify(receipt),false,false)).toContain('桌面客户端');
  });
  it('keeps machine-readable replies separate from adjacent commentary in the same reply',()=>{
    const base:Message={kind:'message',id:'a',replyId:'reply',role:'being',text:'正在提交',streaming:false,timestamp:'',label:'alice',consecutive:false};
    expect(replyBubbles([base,{...base,id:'b',text:JSON.stringify(receipt)}])).toHaveLength(2);
    expect(replyBubbles([{...base,text:JSON.stringify(receipt)},{...base,id:'b',text:'说明'}])).toHaveLength(2);
    expect(replyBubbles([base,{...base,id:'b',text:'普通内容'}])).toHaveLength(1);
  });
});

describe('read-only generation gateway',()=>{
  it('injects existing credentials only to the fixed gateway and strips echoed prompts',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({...success(),request:{prompt:'private prompt'},token:'never-forward'}));
    const response=await new ChatProxy(()=>connection,fetcher).handle(request());
    expect(response.status).toBe(200);
    const result=await response.json(); expect(result.outputs[0].view_url).toBe(output.view_url);
    expect(JSON.stringify(result)).not.toContain('private');expect(result.request).toBeUndefined();
    expect(fetcher.mock.calls[0][0]).toBe('https://beings.town/api/being-service/v1/generations/gen_one');
    expect(fetcher.mock.calls[0][1]).toMatchObject({method:'GET',redirect:'error',credentials:'omit',cache:'no-store'});
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer private-heart-token');
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('X-Being-Id')).toBe('alice');
  });
  it('recovers by request key and verifies upstream identity',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(raw())).mockResolvedValueOnce(Response.json(raw({client_request_id:'other'})));
    const proxy=new ChatProxy(()=>connection,fetcher);
    expect((await proxy.handle(request('by-request/cat-one'))).status).toBe(200);
    expect((await proxy.handle(request('by-request/cat-one'))).status).toBe(502);
    expect(fetcher.mock.calls[0][0]).toContain('/by-request/cat-one');
  });
  it('rejects mutation, arbitrary URL, missing/stale identity and self-hosted token leakage',async()=>{
    const fetcher=vi.fn(); const proxy=new ChatProxy(()=>connection,fetcher);
    for(const req of [request('gen_one',{method:'POST'}),request('gen_one?url=https://evil.test'),request('by-request/bad%2Fkey'),request('gen_one',{headers:{}}),request('gen_one',{headers:{...headers,'X-Portal-Generation-Being':'bob'}})]) expect((await proxy.handle(req)).status).toBeGreaterThanOrEqual(400);
    const own=parseConnection('https://private.example/alice/?token=private');
    expect((await new ChatProxy(()=>own,fetcher).handle(request('gen_one',{headers:{...headers,'X-Portal-Being-Endpoint':own.endpoint}}))).status).toBe(409);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('supports explicitly paired private gateways',async()=>{
    vi.stubEnv('PORTAL_ATTACHMENT_HEART_BASE_URL','https://private.example');vi.stubEnv('PORTAL_ATTACHMENT_GATEWAY_URL','https://gateway.example');
    const own=parseConnection('https://private.example/alice/?token=private');
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json(raw()));
    expect((await new ChatProxy(()=>own,fetcher).handle(request('gen_one',{headers:{...headers,'X-Portal-Being-Endpoint':own.endpoint}}))).status).toBe(200);
    expect(fetcher.mock.calls[0][0]).toBe('https://gateway.example/api/being-service/v1/generations/gen_one');
  });
  it('never returns upstream error bodies or follows credential-bearing redirects',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({error:'private-heart-token'},{status:401}));
    const response=await new ChatProxy(()=>connection,fetcher).handle(request());
    expect(response.status).toBe(401);expect(await response.text()).not.toContain('private-heart-token');
    expect(fetcher.mock.calls[0][1]?.redirect).toBe('error');
  });
  it('rejects unsupported images, foreign URLs, missing manifests and oversized responses',async()=>{
    for (const change of [{view_url:'https://evil.test/image?token=a'},{mime:'image/svg+xml'},{attachment:{source:'evil',attachment_id:'att_one'}}]) {
      expect(()=>generationSnapshot({...success(),manifest:{version:1,kind:'image',outputs:[{...output,...change}]}},'https://beings.town')).toThrow();
    }
    expect(()=>generationSnapshot(raw({status:'succeeded',availability:'available'}),'https://beings.town')).toThrow();
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(1024*1024+1)));
    expect((await new ChatProxy(()=>connection,fetcher).handle(request())).status).toBe(502);
  });
});

describe('generation polling lifecycle',()=>{
  it('queries the existing task until succeeded, uses server intervals, then stops',async()=>{
    vi.useFakeTimers(); const states:GenerationViewState[]=[];
    const query=vi.fn().mockResolvedValueOnce(snapshot({status:'queued',poll_after_ms:3500})).mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(generationSnapshot(success(),'https://beings.town'));
    const watch=watchImageGeneration(job,query,state=>states.push(state));
    await vi.advanceTimersByTimeAsync(0);expect(query).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3499);expect(query).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);expect(query).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);expect(states.at(-1)?.snapshot?.status).toBe('succeeded');
    await vi.advanceTimersByTimeAsync(120000);expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls.every(([path])=>path==='/api/image-generations/gen_one')).toBe(true);watch.stop();
  });
  it('recovers an unknown submission using its key, then polls the discovered id',async()=>{
    vi.useFakeTimers();const query=vi.fn().mockResolvedValue(snapshot());
    const watch=watchImageGeneration({...job,submission:'unknown',generation_id:null},query,()=>{});
    await vi.advanceTimersByTimeAsync(2000);
    expect(query.mock.calls.map(([path])=>path)).toEqual(['/api/image-generations/by-request/cat-one','/api/image-generations/gen_one']);watch.stop();
  });
  it.each(['uncertain','failed','cancelled'] as const)('stops on %s without generating again',async status=>{
    vi.useFakeTimers();const query=vi.fn().mockResolvedValue(snapshot({status}));
    const watch=watchImageGeneration(job,query,()=>{});await vi.advanceTimersByTimeAsync(120000);expect(query).toHaveBeenCalledTimes(1);watch.stop();
  });
  it('deadline and reconciliation stop polling but keep the actual status',()=>{
    expect(generationWait(snapshot({deadline:Date.now()-1}))).toMatchObject({notice:expect.stringContaining('待核对')});
    expect(generationWait(snapshot({required_action:'operator_reconciliation_required'})).delay).toBeUndefined();
  });
  it('retries transport errors with backoff, preserves snapshots and resumes manually after auth errors',async()=>{
    vi.useFakeTimers();const states:GenerationViewState[]=[];
    const query=vi.fn().mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new GenerationQueryError('凭据失效',401)).mockResolvedValueOnce(generationSnapshot(success(),'https://beings.town'));
    const watch=watchImageGeneration(job,query,s=>states.push(s));
    await vi.advanceTimersByTimeAsync(2000);expect(states.at(-1)?.snapshot?.status).toBe('running');
    expect(states.at(-1)?.notice).toContain('重连');await vi.advanceTimersByTimeAsync(2000);
    expect(states.at(-1)?.canQuery).toBe(true);await vi.advanceTimersByTimeAsync(120000);expect(query).toHaveBeenCalledTimes(3);
    watch.retry();await vi.advanceTimersByTimeAsync(0);expect(states.at(-1)?.snapshot?.status).toBe('succeeded');watch.stop();
  });
  it('does not query rejected submissions; aborts in-flight reads on unmount and ignores late results',async()=>{
    const query=vi.fn();const rejected=watchImageGeneration({...job,submission:'rejected',generation_id:null},query,()=>{});expect(query).not.toHaveBeenCalled();rejected.stop();
    let resolve!:(value:any)=>void;const states:GenerationViewState[]=[];
    const pending=vi.fn((_path:string,_signal:AbortSignal)=>new Promise<any>(r=>resolve=r));
    const watch=watchImageGeneration(job,pending,s=>states.push(s));watch.stop();
    expect(pending.mock.calls[0][1].aborted).toBe(true);resolve(snapshot());await Promise.resolve();expect(states).toHaveLength(1);
  });
});
