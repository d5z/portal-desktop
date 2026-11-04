import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {attachmentPreviewRequest} from '../desktop/renderer/app/services/attachment-preview-request';
let channel:any;
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('MessageChannel',class {
 port1={postMessage:vi.fn(),close:vi.fn(),onmessage:null as any,onmessageerror:null as any};
 port2={close:vi.fn()};constructor(){channel=this;}
});});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
const target=()=>({src:'beings://chat/?revision=one',contentWindow:{postMessage:vi.fn()}} as any);
const file={id:'one',endpoint:'https://example.test'};
describe('preview request lifetime',()=>{
 it('times out when a chat card no longer responds',async()=>{
  const result=attachmentPreviewRequest(target(),file,'https://local/?action=open');
  const error=expect(result).rejects.toThrow('附件操作超时');
  await vi.advanceTimersByTimeAsync(15000);await error;
  expect(channel.port1.postMessage).toHaveBeenCalledWith('abort');expect(channel.port1.close).toHaveBeenCalled();
 });
 it('rejects an already cancelled operation before sending',async()=>{
  const frame=target();await expect(attachmentPreviewRequest(frame,file,'https://local', {signal:AbortSignal.abort()})).rejects.toMatchObject({name:'AbortError'});
  expect(frame.contentWindow.postMessage).not.toHaveBeenCalled();
 });
 it('forwards streamed data and releases the channel on completion',async()=>{
  const result=attachmentPreviewRequest(target(),file,'https://local');
  channel.port1.onmessage({data:{body:new Response('hello').body,status:200,headers:{}}});
  expect(await (await result).text()).toBe('hello');expect(channel.port1.close).toHaveBeenCalled();
 });
 it('propagates cancellation after response headers',async()=>{
  const controller=new AbortController();const result=attachmentPreviewRequest(target(),file,'https://local',{signal:controller.signal});
  channel.port1.onmessage({data:{body:new ReadableStream(),status:200,headers:{}}});
  const response=await result;controller.abort();
  await expect(response.text()).rejects.toMatchObject({name:'AbortError'});
  expect(channel.port1.postMessage).toHaveBeenCalledWith('abort');
 });
});
