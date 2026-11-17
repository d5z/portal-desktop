import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {attachmentProcessing} from '../desktop/renderer/chat/components/attachment-processing';
const render=(message:any)=>renderToStaticMarkup(attachmentProcessing(message)?.content);
describe('attachment assistant status transitions',()=>{
 it('moves from queued to upload to parse, then disappears when ready',()=>{
  const message:any={kind:'message',role:'user',queued:true,attachmentUploads:[{name:'report.pdf',size:10}]};
  expect(render(message)).toContain('等待发送');
  message.attachmentUploads[0].progress={phase:'uploading',loaded:5,total:10};
  expect(render(message)).toBe('');
  message.attachmentUploads[0].progress.phase='complete';
  expect(render(message)).toContain('正在解析附件');
  message.attachmentViews=[{parts:[{type:'attachment',name:'report.pdf',parse_status:'parsing',progress:{completed:1,total:2,unit:'page'}}]}];
  expect(render(message)).toContain('1/2 页');
  message.attachmentViews[0].parts[0].parse_status='ready';
  expect(render(message)).toBe('');
  message.queued=false;
  expect(render(message)).toBe('');
 });
 it('does not keep a failed send in an endless processing state',()=>{
  expect(render({kind:'message',queued:true,retry:()=>{},attachmentUploads:[{name:'bad.pdf',size:1}]})).toBe('');
 });
 it('hides processing immediately when an upload fails before retry is attached',()=>{
  expect(render({kind:'message',queued:true,attachmentUploads:[{name:'bad.pdf',size:1,progress:{phase:'failed',loaded:0,total:1}}]})).toBe('');
 });
 it('anchors mixed progress to the active part even when the final part has failed',()=>{
  const ready={type:'attachment',name:'ready.md',parse_status:'ready'};
  const active={type:'attachment',name:'active.pdf',mime:'application/pdf',parse_status:'parsing'};
  const failed={type:'attachment',name:'failed.pdf',parse_status:'failed'};
  const message:any={kind:'message',role:'user',queued:true,attachmentViews:[{parts:[ready,active,failed]}]};
  expect(attachmentProcessing(message)?.part).toBe(active);
  expect(render(message)).toContain('· 1/3');
  active.mime='image/png';
  expect(attachmentProcessing(message)?.part).toBeUndefined();
  expect(render(message)).toContain('· 1/3');
 });
});
