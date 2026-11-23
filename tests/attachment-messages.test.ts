import {describe, expect, it, vi} from 'vitest';
import {AttachmentMessages, attachmentContextHeading, attachmentMessageReader, releaseAttachmentMessageReader, messageMarker, messageReferences, validateMessage} from '../desktop/renderer/chat/services/attachment-messages';
const id = 'msg_' + 'a'.repeat(64), other = 'msg_' + 'b'.repeat(64);
const view = {version:1,message_id:id,channel:'portal',scene_id:'room',created_at:1,delivery_status:'pending',parts:[{type:'text',text:'original'}]};
describe('attachment message identity', () => {
  it('recognizes a standalone footer outside code and preserves order without duplicates', () => {
    expect(messageReferences(`${messageMarker(other)}\ntext\n[attachment-message:v1:${id},${other},${id}]\r\n`)).toEqual([id,other]);
    expect(messageReferences(`inline ${messageMarker(id)}`)).toEqual([]);
    expect(messageReferences(`日志\n${messageMarker(id)}\n后续正文`)).toEqual([]);
    expect(messageReferences('~~~text\n' + messageMarker(id) + '\n~~~')).toEqual([]);
    expect(messageReferences('~~~text\n' + messageMarker(id))).toEqual([]);
  });
  it('keeps a transport footer when the parsed excerpt ends in an open code fence', () => {
    const wire = `问题\n\n${attachmentContextHeading}\n附件："notes.md"\n以下为节选，非全文。\n~~~text\n节选\n\n${messageMarker(id)}`;
    expect(messageReferences(wire)).toEqual([id]);
  });
  it('coalesces reads and rejects mismatched responses', async () => {
    const request = vi.fn(async () => Response.json(view)); const service = new AttachmentMessages(request);
    const [a,b] = await Promise.all([service.get(id), service.get(id)]); expect(a).toBe(b); expect(request).toHaveBeenCalledTimes(1);
    expect(() => validateMessage(view,other)).toThrow();
  });
  it('shares in-flight reads between the coordinator and bubbles',async()=>{
    const request=vi.fn(async()=>Response.json(view));
    const first=attachmentMessageReader('test-endpoint',request),second=attachmentMessageReader('test-endpoint',request);
    try{await Promise.all([first.get(id),second.get(id)]);expect(request).toHaveBeenCalledTimes(1);}
    finally{releaseAttachmentMessageReader('test-endpoint',first);}
  });
  it('retries temporary read failures but does not retry permanent errors',async()=>{
    vi.useFakeTimers();
    try{
      const request=vi.fn().mockResolvedValueOnce(new Response('upstream temporarily unavailable',{status:503})).mockResolvedValueOnce(Response.json(view));
      const result=new AttachmentMessages(request).get(id);await vi.advanceTimersByTimeAsync(500);expect(await result).toEqual(view);expect(request).toHaveBeenCalledTimes(2);
      const denied=vi.fn(async()=>Response.json({error:'denied'},{status:403}));
      await expect(new AttachmentMessages(denied).get(id)).rejects.toThrow('denied');expect(denied).toHaveBeenCalledTimes(1);
    }finally{vi.useRealTimers();}
  });
  it('restores accepted metadata on refresh without another request',async()=>{
    const data=new Map();vi.stubGlobal('sessionStorage',{getItem:(key:string)=>data.get(key),setItem:(key:string,value:string)=>data.set(key,value)});
    try{
      const request=vi.fn(async()=>Response.json({...view,delivery_status:'accepted'}));
      await new AttachmentMessages(request,'endpoint').get(id);
      const restored=new AttachmentMessages(request,'endpoint');await restored.get(id);expect(request).toHaveBeenCalledTimes(1);
      await new AttachmentMessages(request,'other-endpoint').get(id);expect(request).toHaveBeenCalledTimes(2);
    }finally{vi.unstubAllGlobals();}
  });
  it('lists all pages without treating pending as full history', async () => {
    const request = vi.fn(async (url:string) => Response.json({messages:[url.includes('cursor=') ? {...view,message_id:other} : view],next_cursor:url.includes('cursor=') ? null : 'next'}));
    expect((await new AttachmentMessages(request).list()).map(v => v.message_id)).toEqual([id,other]);
  });
});
