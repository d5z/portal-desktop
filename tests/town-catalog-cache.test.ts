import {describe,it,expect,vi} from 'vitest';
import {TownClient} from '../desktop/shared/town-client';
import {TownModel} from '../desktop/renderer/town/models/town';
import {SceneStore} from '../desktop/renderer/shared/models/scene';
import type {DesktopAPI} from '../desktop/shared/types';
describe('catalog cache',()=>{
 it('keeps bonfire batch caches separate and refreshes using the selected count',async()=>{
  const read=vi.fn(async(query:any)=>({ok:true,data:{messages:[{seq:query.limit,content:String(query.limit)}]},fetchedAt:new Date().toISOString()}));
  const town=new TownModel({town:read,townAuth:async()=>({configured:false})} as unknown as DesktopAPI,()=>{},()=>{},new SceneStore(),()=>{},()=>{});
  town.view='bonfire';town.tab='bonfire';town.visible=true;
  await town.load();
  town.setBonfireLimit(200);
  await vi.waitFor(()=>expect(town.loading).toBe(false));
  expect(town.data?.messages).toEqual([{seq:200,content:'200'}]);
  expect(town.status).not.toContain('最近 200 条');
  await town.load(true);
  expect(read.mock.calls.filter(([query])=>query.kind==='bonfire').map(([query])=>query.limit)).toEqual([100,200,200]);
 });
 it('discards validators when a refreshed response prohibits storage',async()=>{
  const headers:Headers[]=[];
  const client=new TownClient(()=>'',(async(_url:unknown,init?:RequestInit)=>{
   headers.push(new Headers(init?.headers));
   return Response.json({scrolls:[]},{headers:{ETag:'"v1"',...(headers.length===2?{'Cache-Control':'private, no-store'}:{})}});
  }) as typeof fetch);
  await client.query({kind:'scrolls'});
  await client.query({kind:'scrolls'});
  await client.query({kind:'scrolls'});
  expect(headers[1].get('If-None-Match')).toBe('"v1"');
  expect(headers[2].has('If-None-Match')).toBe(false);
 });
 it('reuses unchanged bodies with ETag and clears validators on identity changes',async()=>{
  let identity='a';const headers:Headers[]=[];
  const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>{
   headers.push(new Headers(init?.headers));
   return headers.at(-1)!.has('If-None-Match')?new Response(null,{status:304}):Response.json({scrolls:[{id:'1',title:'first'}]},{headers:{ETag:'"v1"'}});
  });
  const client=new TownClient(()=>identity,fetcher as typeof fetch);
  const first=await client.query({kind:'scrolls'}), next=await client.query({kind:'scrolls'});
  expect(first.ok&&next.ok&&first.data===next.data).toBe(true);
  expect(headers[1].get('If-None-Match')).toBe('"v1"');
  identity='b';await client.query({kind:'scrolls'});
  expect(headers[2].has('If-None-Match')).toBe(false);
 });
 it('reuses recent catalogs across navigation, refreshes changes and retains data after failure',async()=>{
  let fail=false;let title='first';
  const read=vi.fn(async()=>fail?{ok:false,message:'offline'}:{ok:true,data:{scrolls:[{id:'1',title}]},fetchedAt:new Date().toISOString()});
  const town=new TownModel({town:read,townAuth:async()=>({configured:false})} as unknown as DesktopAPI,()=>{},()=>{},new SceneStore(),()=>{},()=>{});
  town.view='scrolls';town.tab='scrolls';town.visible=true;
  await town.load();const cached=town.data;
  town.show('chat');town.show('scrolls');
  expect(town.data).toBe(cached);expect(read).toHaveBeenCalledTimes(1);
  title='updated';await town.load(true);expect((town.data?.scrolls as any[])[0].title).toBe('updated');
  fail=true;await town.load(true);expect((town.data?.scrolls as any[])[0].title).toBe('updated');expect(town.refreshError).toContain('offline');
 });
});
