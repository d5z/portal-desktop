import {describe,it,expect} from 'vitest';
import {attachmentTimeline} from '../desktop/renderer/chat/services/attachment-timeline';
const message=(id:string,createdAt:number,extra={})=>({kind:'message',id,createdAt,role:'user',text:'',timestamp:'',label:'you',streaming:false,consecutive:false,...extra} as any);
describe('cross-scene attachment timeline',()=>{
 it('keeps manual outbox order when queued text and attachments are mixed',()=>{
  const attachment=message('local-file',300,{queued:true,attachmentUploads:[{name:'a.pdf'}]});
  const queuedText=message('local-text',200,{queued:true});
  const input=[message('older',100,{historySeq:1}),attachment,queuedText];
  expect(attachmentTimeline(input)).toBe(input);
 });
 it('places an older discovered attachment before newer Heart messages instead of at the tail',()=>{
  const old=message('attachment-old',100,{sceneId:'samples'}),recent=message('recent',300,{historySeq:3,sceneId:'desktop'}),reply=message('reply',310,{historySeq:4,role:'being'});
  expect(attachmentTimeline([recent,reply,old]).map(x=>x.id)).toEqual(['attachment-old','recent','reply']);
 });
 it('keeps authoritative history order, live activity and separators intact',()=>{
  const input=[message('first',100,{historySeq:1}),{kind:'run',id:'run'}, {kind:'separator',id:'sep'},message('second',300,{historySeq:2}),message('queued',400,{queued:true}),message('attachment-b',250),message('attachment-a',200)] as any[];
  const sorted=attachmentTimeline(input);
  expect(sorted.map(x=>x.id)).toEqual(['first','run','attachment-a','attachment-b','sep','second','queued']);
  expect(attachmentTimeline(sorted)).toEqual(sorted);
  expect(input.at(-1).id).toBe('attachment-a');
 });
 it('does not move accepted history or local queued attachments by their upload timestamp',()=>{
  const input=[message('first',300,{historySeq:1}),message('attachment-accepted',100,{historySeq:2}),message('attachment-queued',50,{queued:true})];
  expect(attachmentTimeline(input)).toBe(input);
 });
});
