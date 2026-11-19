import { expect, it, vi } from 'vitest';
import { createSceneRuntime } from '../desktop/renderer/chat/services/scene-runtime';
import { SceneQueueStore } from '../desktop/renderer/chat/services/scene-queue';
import { AttachmentMessages } from '../desktop/renderer/chat/services/attachment-messages';

it.each([false, true])('removes a restored uncertain send locally and resumes the queue (attachment=%s)', async attachment => {
  vi.useFakeTimers();
  const row:any={id:'uncertain',endpoint:'fixture',scene:{sceneId:'a'},text:'上次发送',files:[],createdAt:Date.now(),phase:'sending',
    ...(attachment ? {attachment:{messageId:'msg_'+'a'.repeat(64),delivery:'unknown'}} : {})};
  const read=vi.spyOn(SceneQueueStore.prototype,'read').mockResolvedValue([row]);
  const write=vi.spyOn(SceneQueueStore.prototype,'write').mockResolvedValue();
  const get=vi.spyOn(AttachmentMessages.prototype,'get').mockRejectedValue(new Error('offline'));
  const update=vi.spyOn(AttachmentMessages.prototype,'update');
  const sent=vi.fn(async()=>{});
  const state:any={items:[],currentScene:{sceneId:'a'},draft:'',files:[],sceneTasks:[],changed:vi.fn()};
  const runtime=createSceneRuntime(state,{},(local:any)=>({
    isBusy:()=>false,sceneActivity:()=>null,syncConnection:()=>{},dispose:()=>{},start:async()=>{},
    waitForPendingFiles:async()=>{},request:async()=>new Response(null,{status:204}),send:sent,
    stageQueuedSend(text:string,files:any[]=[],sendOptions:any={}) {
      const message:any={kind:'message',id:text,role:'user',text,queued:true,...local.currentScene};
      local.items.push(message);return {text,files,sendOptions,message};
    },
  }));
  try {
    await runtime.start();
    const uncertain=state.items[0];
    await runtime.send('下一条',[]);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).not.toHaveBeenCalled();
    expect(state.queued).toBe(2);
    await uncertain.cancelQueued();
    await vi.advanceTimersByTimeAsync(0);
    expect(write).toHaveBeenCalledWith('uncertain');
    expect(update).not.toHaveBeenCalled();
    expect(sent).toHaveBeenCalledExactlyOnceWith('下一条',[],expect.any(Object));
    expect(state.queued).toBe(0);
    expect(state.items).not.toContain(uncertain);
  } finally {runtime.dispose();read.mockRestore();write.mockRestore();get.mockRestore();update.mockRestore();vi.useRealTimers();}
});

it('explains a restored failed send and clears its status when the row is removed', async () => {
  const row:any={id:'failed',endpoint:'fixture',scene:{sceneId:'a'},text:'附件任务',files:[],createdAt:1,phase:'failed',error:'附件解析失败：report.pdf'};
  const read=vi.spyOn(SceneQueueStore.prototype,'read').mockResolvedValue([row]);
  const write=vi.spyOn(SceneQueueStore.prototype,'write').mockResolvedValue();
  const activity=vi.fn();
  const state:any={items:[],currentScene:{sceneId:'a'},draft:'',files:[],sceneTasks:[],changed:vi.fn()};
  const runtime=createSceneRuntime(state,{onSceneActivity:activity},(local:any)=>({
    isBusy:()=>false,sceneActivity:()=> 'done',syncConnection:()=>{},dispose:()=>{},start:async()=>{},
    stageQueuedSend(text:string,files:any[]){const message:any={kind:'message',id:'failed',role:'user',text,queued:true,...local.currentScene};local.items.push(message);return {text,files,message};},
  }));
  try {
    await runtime.start();
    expect(activity.mock.lastCall?.[0].a).toBe('send-failed');
    expect(state.items[0].queueNotice).toBe('附件解析失败：report.pdf');
    await state.items[0].cancelQueued();
    expect(activity.mock.lastCall?.[0].a).toBe('done');
    expect(write).toHaveBeenCalledWith('failed');
  } finally {runtime.dispose();read.mockRestore();write.mockRestore();}
});

it('queues same-scene input, allows priority interruption and cancellation, then drains in order', async () => {
  vi.useFakeTimers();
  const rows = new Map<string, any>();
  const read = vi.spyOn(SceneQueueStore.prototype, 'read').mockImplementation(async () => [...rows.values()]);
  const write = vi.spyOn(SceneQueueStore.prototype, 'write').mockImplementation(async row => {
    if (typeof row === 'string') rows.delete(row); else rows.set(row.id, structuredClone(row));
  });
  const activity: Record<string, boolean> = {a: true, b: false};
  const sent = vi.fn(async (..._args:any[]) => {});
  const state: any = {items:[], currentScene:{sceneId:'a'}, draft:'', files:[], sceneTasks:[], changed:vi.fn()};
  const runtime = createSceneRuntime(state, {}, (local:any) => ({
    isBusy:()=>activity[local.currentScene.sceneId], sceneActivity:()=>null,
    syncConnection:()=>{}, waitForPendingFiles:async()=>{}, refreshHistory:async()=>{},
    request:async()=>new Response(null,{status:204}), send:sent, dispose:()=>{}, start:async()=>{},
    stageQueuedSend(text:string, files:any[] = [], sendOptions:any = {}) {
      const message:any={kind:'message', id:Math.random(),role:'user',text,queued:true,createdAt:Date.now(),...local.currentScene};
      local.items.push(message); return {text,files,message,sendOptions};
    },
  }));
  try {
    await runtime.start();
    const files = [{name:'note.txt',base64:'YWJj',type:'text/plain',size:3}];
    await runtime.send('first',files);
    await runtime.send('priority',[],{intelligentUI:true});
    await runtime.send('cancel',[]);
    expect(sent).not.toHaveBeenCalled();
    expect(state.queued).toBe(3);
    expect(rows.size).toBe(3);
    const [first, priority, cancel] = state.items;
    await first.editQueued?.('edited first');
    expect(first.text).toBe('edited first');
    expect([...rows.values()].some(row => row.text === 'edited first')).toBe(true);
    await cancel.moveQueued?.(-1);
    expect(state.items.map((item:any) => item.text)).toEqual(['edited first', 'cancel', 'priority']);
    await cancel.cancelQueued();
    expect(state.queued).toBe(2);
    await priority.interruptQueued();
    expect(sent).toHaveBeenCalledWith('priority',[],expect.objectContaining({queuedMessage:priority,intelligentUI:true}));
    expect(priority.queued).toBe(false);
    expect(state.items).toEqual([first,priority]);
    expect(state.queued).toBe(1);
    await runtime.send('direct',[],{mode:'interrupt'});
    expect(sent.mock.calls.at(-1)?.[0]).toBe('direct');
    await runtime.selectScene({sceneId:'b'});
    await runtime.send('other-scene',[],{mode:'interrupt'});
    expect(state.canInterruptQueue).toBe(false);
    const other = state.items.find((item:any)=>item.text==='other-scene');
    await other.interruptQueued();
    expect(sent).toHaveBeenCalledTimes(2);
    activity.a = false;
    runtime.updateSceneTasks([]);
    await vi.advanceTimersByTimeAsync(2100);
    expect(sent.mock.calls.map(call=>call[0])).toEqual(['priority','direct','edited first','other-scene']);
    expect(sent.mock.calls[2][1]).toEqual(files);
    expect(rows.size).toBe(0);
    expect(state.items.filter((item:any)=>item.queued)).toHaveLength(0);
  } finally {runtime.dispose(); read.mockRestore(); write.mockRestore(); vi.useRealTimers();}
});
