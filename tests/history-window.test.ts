import {describe,it,expect} from 'vitest';
import {historyWindowStart,historyRevealStart,HISTORY_WINDOW_PAGE} from '../desktop/renderer/chat/hooks/use-history-window';
import {historyTargetBubble,replyBubbles} from '../desktop/renderer/chat/models/reply-bubbles';
import type {Message} from '../desktop/renderer/chat/models/chat';
const rows=(n:number)=>Array.from({length:n},(_,i)=>({kind:'separator' as const,id:String(i),text:''}));
describe('progressive chat history window',()=>{
 it('keeps an empty failed fragment separate so retry targets its own history seq',()=>{
  const first={kind:'message',id:'first',historySeq:1,role:'being',text:'part one',replyId:'reply',sceneId:'scene'} as Message;
  const missing={...first,id:'missing',historySeq:2,text:'',historyContentError:true};
  const last={...first,id:'last',historySeq:3,text:'part three'};
  expect(replyBubbles([first,missing,last])).toEqual([first,missing,last]);
 });
 it('locates a later durable fragment inside its combined reply bubble',()=>{
  const first={kind:'message',id:'first',historySeq:1,role:'being',text:'part one',replyId:'reply',sceneId:'scene'} as Message;
  const second={...first,id:'second',historySeq:2,text:'part two'};
  const items=[first,second],timeline=replyBubbles(items);
  expect(timeline).toHaveLength(1);
  expect(historyTargetBubble(items,timeline,2)?.id).toBe('first');
  expect(historyTargetBubble(items,[],2)).toBeUndefined();
  expect(historyTargetBubble(items,timeline,3)).toBeUndefined();
 });
 it('expands a partial global-cache seed when the scene cache arrives',()=>{
  expect(historyWindowStart(rows(6),'4')).toBe(0);
  expect(historyWindowStart(rows(100),'98')).toBe(60);
  expect(historyWindowStart(rows(110),'60')).toBe(60);
 });
 it('search expands older history without removing messages already visible',()=>{
  expect(historyRevealStart(rows(100),'20','80')).toBe(20);
  expect(historyRevealStart(rows(100),'60','25')).toBe(15);
 });
 it('initially exposes only the latest page',()=>{
  expect(rows(300).slice(historyWindowStart(rows(300)))).toHaveLength(HISTORY_WINDOW_PAGE);
  expect(historyWindowStart(rows(12))).toBe(0);
 });
 it('keeps the first visible message when newer replies arrive or older history is prepended',()=>{
  expect(historyWindowStart(rows(305),'260')).toBe(260);
  expect(historyWindowStart([{kind:'separator',id:'older',text:''},...rows(300)],'260')).toBe(261);
 });
 it('falls back safely after a full history rebuild replaces row identities',()=>{
  expect(historyWindowStart(rows(100),'removed')).toBe(60);
 });
});
