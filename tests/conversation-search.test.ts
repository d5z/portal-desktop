import { describe, it, expect } from 'vitest';
import { ConversationSearch, searchEntries } from '../desktop/renderer/chat/services/conversation-search';
describe('conversation search',()=>{
 it('pages across scenes and matches replies as well as questions beyond a short preview',async()=>{
  const paths:string[]=[];
  const pages=[{messages:[{seq:1,role:'user',content:'计划',scene_id:'a'},{seq:2,role:'being',content:'x'.repeat(500)+'计划答案',scene_id:'b',scene_label:'读书'}]}, {messages:[{seq:3,role:'assistant',content:'计划三',scene_id:'c'}]}, {messages:[]}];
  const search=new ConversationSearch(async path=>{paths.push(path);return Response.json(pages.shift());});
  await search.sync(new AbortController().signal,()=>{});
  expect(paths).toEqual(['/api/history?limit=500&after=0','/api/history?limit=500&after=2','/api/history?limit=500&after=3']);
  const matches=searchEntries(search.rows,'计划');
  expect(matches.map(m=>m.sceneId)).toEqual(['c','b','a']);
  expect(matches[1].text).toContain('计划答案');
  expect(matches[1].sceneLabel).toBe('读书');
 });
 it('stops when servers repeat a page and resumes without duplicating history',async()=>{
  const search=new ConversationSearch(async()=>Response.json({messages:[{seq:1,role:'being',content:'hello'}]}));
  await search.sync(new AbortController().signal,()=>{});
  await search.sync(new AbortController().signal,()=>{});
  expect(search.rows).toHaveLength(1);
  expect(searchEntries(search.rows,'HELLO')).toHaveLength(1);
  expect(searchEntries(search.rows,'')).toEqual([]);
 });
 it('reports incomplete history without discarding successful pages',async()=>{
  let count=0;const search=new ConversationSearch(async()=>++count===1?Response.json({messages:[{seq:1,role:'being',content:'reply'}]}):new Response('',{status:503}));
  await expect(search.sync(new AbortController().signal,()=>{})).rejects.toThrow();
  expect(searchEntries(search.rows,'reply')).toHaveLength(1);
 });
});
