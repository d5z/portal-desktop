import {it, expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ChatProxy} from '../desktop/main/chat/proxy';
import {parseConnection} from '../desktop/main/chat/connection';
import {uploadAttachment, type UploadProgress} from '../desktop/renderer/chat/services/attachment-transfer';
import {attachmentError} from '../desktop/shared/attachment-error';
import {AttachmentMessageContent, AttachmentMessageStatus} from '../desktop/renderer/chat/components/message-content';
import type {Message} from '../desktop/renderer/chat/models/chat';

const connection = parseConnection('https://echo.beings.town/alice/?token=secret');
const headers = {'X-Portal-Being-Endpoint':connection.endpoint,'X-Portal-Scene-Id':'room','Idempotency-Key':'failure-test'};
async function failUpload(failure: () => Promise<Response>) {
  const proxy = new ChatProxy(() => connection, async (url) => {
    if(String(url).includes('/uploads'))return Response.json({attachment:{attachment_id:'att_one'},upload:{url:'https://bucket.oss-cn-shanghai.aliyuncs.com/object?signature=secret',method:'PUT',headers:{}}});
    return failure();
  }, {scene_id:'room',scene_meta:{client:'test',scene_label:'Room'}});
  const events: UploadProgress[] = [];
  const task = uploadAttachment((path, init) => proxy.handle(new Request('beings://chat'+path,{...init,headers:{...init?.headers,...headers}})), '/api/attachments?filename=a.log',{method:'POST',body:'hello'}, p=>events.push(p));
  await expect(task).rejects.toThrow();
  return events;
}
it('propagates transport cause and stage to the failed card state',async()=>{
  const events=await failUpload(async()=>{throw new TypeError('fetch failed',{cause:Object.assign(new Error('connection'),{code:'ECONNREFUSED'})});});
  expect(events.at(-1)).toMatchObject({phase:'failed',loaded:0,total:5});
  expect(events.at(-1)?.error).toContain('上传至对象存储');
  expect(events.at(-1)?.error).toContain('ECONNREFUSED');
});
it('preserves HTTP status even for non-JSON storage errors',async()=>{
  const events=await failUpload(async()=>new Response('<Error>Denied</Error>',{status:403}));
  expect(events.at(-1)?.error).toContain('HTTP 403');
});
it('reports timeouts and redacts signed URLs and credentials',()=>{
  expect(attachmentError(new DOMException('timed out','TimeoutError'))).toContain('超时');
  const error=attachmentError(new Error('failed https://example.org/?signature=private token=private Bearer private'));
  expect(error).not.toContain('private');
});
it('marks request failures and resets stale failures when retry starts',async()=>{
  const events:UploadProgress[]=[];
  await expect(uploadAttachment(async()=>{throw new Error('offline');},'/upload',{},p=>events.push(p))).rejects.toThrow('offline');
  expect(events.at(-1)?.phase).toBe('failed');
  await uploadAttachment(async()=>Response.json({attachment_id:'att_one',status:'ready'}),'/upload',{},p=>events.push(p));
  expect(events.at(-1)).toEqual({phase:'preparing',loaded:0,total:0});
});
it('marks an invalid completion as failed instead of leaving confirmation progress',async()=>{
  for (const response of [Response.json({}),new Response('{"type":"progress","phase":"confirming","loaded":5,"total":5}\n{"type":"complete","attachment":{}}\n',{headers:{'Content-Type':'application/x-ndjson'}})]) {
    const events:UploadProgress[]=[];
    await expect(uploadAttachment(async()=>response,'/upload',{},p=>events.push(p))).rejects.toThrow('尚未确认');
    expect(events.at(-1)?.phase).toBe('failed');
  }
});
it('sanitizes the queue error as well as the card error',async()=>{
  const events:UploadProgress[]=[];
  await expect(uploadAttachment(async()=>{throw new Error('failed https://example.org/?signature=private');},'/upload',{},p=>events.push(p))).rejects.toThrow('failed [服务地址]');
  expect(events.at(-1)?.error).not.toContain('private');
});
it('keeps failed image cards free of message-level upload feedback',()=>{
  const message = {role:'user',text:'查看图片',attachmentEndpoint:connection.endpoint,attachmentUploads:[{
    name:'a.png',mime:'image/png',size:12,blob:new Blob(['png']),progress:{phase:'failed',loaded:0,total:12}
  }]} as Message;
  const html=renderToStaticMarkup(createElement(AttachmentMessageContent,{message}));
  expect(html).not.toContain('上传失败');
  expect(html).not.toContain('<progress'); expect(html).not.toContain('正在上传');
});
it('shows upload failure with its filename and reason below the bubble',()=>{
  const message = {role:'user',text:'查看内容',attachmentEndpoint:connection.endpoint,attachmentUploads:[{name:'service.log',size:12,progress:{phase:'failed',loaded:0,total:12,error:'ECONNREFUSED'}}]} as Message;
  const html=renderToStaticMarkup(createElement(AttachmentMessageContent,{message}));
  expect(html).not.toContain('上传失败'); expect(html).not.toContain('ECONNREFUSED');
  expect(html).not.toContain('<progress'); expect(html).not.toContain('正在上传');
  const status=renderToStaticMarkup(createElement(AttachmentMessageStatus,{message}));
  expect(status).toContain('附件上传失败'); expect(status).toContain('service.log · ECONNREFUSED');
});
