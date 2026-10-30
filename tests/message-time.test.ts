import {describe,it,expect} from 'vitest';
import {startsTimeGroup,appendChatText} from '../desktop/renderer/shared/models/message-time';
import {fullMessageTime} from '../desktop/renderer/shared/components/message-menu';
describe('message timeline and plain-text draft',()=>{
 const base=new Date(2026,9,29,15,0).getTime();
 it('groups nearby speech, separating five-minute gaps and calendar days',()=>{
  expect(startsTimeGroup(base)).toBe(true);
  expect(startsTimeGroup(base+299999,base)).toBe(false);
  expect(startsTimeGroup(base+300000,base)).toBe(true);
  expect(startsTimeGroup(base,base+300000)).toBe(true);
  expect(startsTimeGroup(new Date(2026,9,30,0,0).getTime(),new Date(2026,9,29,23,59).getTime())).toBe(true);
 });
 it('does not invent times for missing or invalid metadata',()=>{
  for(const value of [undefined,NaN,Infinity,1e20])expect(startsTimeGroup(value,base)).toBe(false);
  expect(fullMessageTime(undefined,'')).toBe('');
  expect(fullMessageTime(undefined,'15:30')).toBe('15:30');
 });
 it('appends text without surrounding blank lines and preserves internal paragraphs',()=>{
  expect(appendChatText('已有草稿\n第二行','原文一\n\n原文二')).toBe('已有草稿\n第二行\n\n原文一\n\n原文二');
  expect(appendChatText('','选中文本')).toBe('选中文本');
  expect(appendChatText(' \n\n',' \n选中文本\n ')).toBe('选中文本');
  expect(appendChatText('草稿\n\n','原文')).toBe('草稿\n\n原文');
  expect(appendChatText('草稿','  ')).toBe('草稿');
 });
});
