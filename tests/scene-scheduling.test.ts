import { it, expect, vi } from 'vitest';
import { mkdtemp, writeFile, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SceneTaskObserver, publicSceneTasks } from '../desktop/main/portal/subagent-tasks';
import { splitSchedulingHint, withScheduling } from '../desktop/renderer/chat/models/scheduling';
import { createSceneRuntime } from '../desktop/renderer/chat/services/scene-runtime';
import { SceneQueueStore } from '../desktop/renderer/chat/services/scene-queue';

it('only exposes bounded, scene-scoped task status and generic auth errors', () => {
  const task = { task_id: 'task1', scene_id: 'a', status: 'failed', created_ms: 10, error: '401 secret-key', brief_head: 'private instructions' };
  expect(publicSceneTasks({ tasks: [task, {...task, scene_id:'other'}]}, new Set(['a']))).toEqual([
    { id:'task1', sceneId:'a', status:'failed', createdAt:10, endedAt:undefined, brief:'private instructions', error:'模型鉴权失败，请检查“模型”设置中的接口凭据' },
  ]);
  expect(publicSceneTasks({}, new Set(['a']))).toEqual([]);
});
it('retains unscoped task metadata while presenting it beside the current scene turn', () => {
  const task = { task_id: 'unscoped', status: 'running', created_ms: 10 };
  const output = publicSceneTasks({ tasks: [task, { ...task, task_id: 'null', scene_id: null },
    { ...task, task_id: 'invalid', scene_id: 123 }, { ...task, task_id: 'other', scene_id: 'other' }] }, new Set(['a']));
  expect(output.map(task => [task.id, task.sceneId])).toEqual([['unscoped', ''], ['null', '']]);
  const user: any = { kind: 'message', role: 'user', id: 'current', sceneId: 'a', createdAt: 1, text: 'task' };
  const run:any = {kind:'run',id:'run',sceneId:'a',start:2,entries:[],label:'思考中'};
  expect(withScheduling([user,run], output)[1]).toMatchObject({ kind: 'run', sceneId: 'a', scheduling: { tasks: output } });
});
it('keeps a run with its preceding scene message when its timer predates the server timestamp', () => {
  const input:any[] = [
    {kind:'message',role:'user',id:'old',sceneId:'a',createdAt:10,text:'old task'},
    {kind:'message',role:'user',id:'new',sceneId:'a',createdAt:50,text:'new task'},
    {kind:'run',id:'current-run',sceneId:'a',start:49,entries:[],label:'思考中'},
  ];
  const old:any = {id:'old-task',sceneId:'a',createdAt:20,endedAt:30,status:'done'};
  const current:any = {id:'new-task',sceneId:'a',createdAt:60,status:'running'};
  const output:any[] = withScheduling(input,[old,current]);
  expect(output.find(item=>item.id==='current-run').scheduling.tasks).toEqual([current]);
  expect(output.map(item=>item.id)).toEqual(input.map(item=>item.id));
});
it('observes atomic ledger replacement without polling and stops on dispose', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(),'scene-task-watch-'));
  const listener = vi.fn(); const observer = new SceneTaskObserver(listener,()=>new Set(['a']));
  const task = {task_id:'task1',scene_id:'a',status:'running',created_ms:10};
  try {
    await writeFile(path.join(directory,'ledger.json'),JSON.stringify({tasks:[task]}));
    expect((await observer.configure(directory))[0].status).toBe('running');
    await writeFile(path.join(directory,'ledger.tmp'),JSON.stringify({tasks:[{...task,status:'done',ended_ms:20}]}));
    await rename(path.join(directory,'ledger.tmp'),path.join(directory,'ledger.json'));
    // OS file events can be coalesced/delayed on busy hosted macOS runners;
    // this checks event-driven delivery, not a one-second latency budget.
    await vi.waitFor(()=>expect(listener).toHaveBeenCalledWith([expect.objectContaining({status:'done'})]), { timeout: 3000 });
    observer.close(); listener.mockClear();
    await writeFile(path.join(directory,'ledger.json'),'{}');
    await new Promise(resolve=>setTimeout(resolve,150)); expect(listener).not.toHaveBeenCalled();
  } finally { observer.close(); await rm(directory,{recursive:true,force:true}); }
});
it('keeps wire metadata intact but splits the terminal Desktop hint for display',()=>{
  const hint='当前输入属于 scene_id="b"。本客户端其他场景尚在处理或等待回复：\n[{"scene_id":"a"}]';
  const wire='问题\n\n[Desktop 场景调度提示]\n'+hint+'\n[/Desktop 场景调度提示]';
  expect(splitSchedulingHint(wire)).toEqual({text:'问题',hint});
  expect(splitSchedulingHint(wire+'普通后文')).toEqual({text:wire+'普通后文',hint:''});
  expect(splitSchedulingHint('解释 [Desktop 场景调度提示]')).toEqual({text:'解释 [Desktop 场景调度提示]',hint:''});
});
it('background work stays active after a partial reply without changing another scene message',async()=>{
  const state:any={currentScene:{sceneId:'a',sceneLabel:'A'},draft:'',subagentReady:true,sceneTasks:[],sceneNames:{},changed:vi.fn()};
  const activity=vi.fn(); const messages:string[]=[];
  const runtime=createSceneRuntime(state,{onSceneActivity:activity},(_state:any,options:any)=>({
    sceneActivity:()=> 'done', syncConnection:()=>{}, waitForPendingFiles:async()=>{}, refreshHistory:async()=>{},
    send:(text:string)=>messages.push(options.prepareMessage(text)),dispose:()=>{},
  }));
  await runtime.send('A 长任务');
  const createdAt=Date.now();
  runtime.updateSceneTasks([{id:'t',sceneId:'a',createdAt,status:'running'}]);
  expect(activity.mock.lastCall?.[0].a).toBe('working');
  await runtime.selectScene({sceneId:'b',sceneLabel:'B'}); await runtime.send('B 新任务');
  expect(messages).toEqual(['A 长任务', 'B 新任务']);
  runtime.updateSceneTasks([{id:'t',sceneId:'a',createdAt,endedAt:createdAt+100,status:'done'}]);
  expect(activity.mock.lastCall?.[0].a).toBe('waiting');
  runtime.updateSceneTasks([{id:'t',sceneId:'a',createdAt,status:'failed'}]);
  expect(activity.mock.lastCall?.[0].a).toBe('task-failed');
  runtime.dispose();
});

it.each(['queued', 'running', 'done', 'failed'] as const)('keeps a completed chat reply idle while its Work task is %s', async status => {
  const state:any = {currentScene:{sceneId:'a'},items:[],draft:'',sceneTasks:[],changed:vi.fn()};
  const activity = vi.fn();
  let repliedAt = 0;
  const runtime = createSceneRuntime(state, {onSceneActivity:activity}, (_state:any, options:any) => ({
    sceneActivity:()=> 'done', replyCompletedAt:()=>repliedAt,
    isBusy:()=>false, waitForPendingFiles:async()=>{}, send:(text:string)=>options.prepareMessage(text), dispose:()=>{},
  }));
  try {
    await runtime.send('请做一个活动照片墙，开始了先告诉我。');
    const createdAt = Date.now();
    repliedAt = createdAt+5;
    const task = {id:'sub_gallery',sceneId:'a',session:'work-6e1769d9-3a48-4b98-8c5d-87bc3e3fd279',
      status,createdAt,endedAt:status === 'done' || status === 'failed' ? createdAt+10 : undefined};
    runtime.updateSceneTasks([task]);
    expect(activity.mock.lastCall?.[0].a).toBe('done');
    expect(state.sceneTasks).toEqual([task]);
  } finally {runtime.dispose();}
});

it('attaches interleaved scene tasks and hints to their own turn without mutating runtime state', () => {
  const user = (id:string, sceneId:string, createdAt:number, text = 'question'):any => ({kind:'message',id,role:'user',sceneId,createdAt,text});
  const run = (id:string,sceneId:string,start:number):any => ({kind:'run',id,sceneId,start,end:start+1,entries:[],label:'已回复'});
  const hint = 'question\n\n[Desktop 场景调度提示]\n当前输入属于 scene_id="b"。本客户端其他场景尚在处理或等待回复：[]\n[/Desktop 场景调度提示]';
  const input = [user('a1','a',10),user('b1','b',20,hint),run('b-run','b',21),run('a-run','a',11),user('a2','a',50)];
  const task:any = {id:'task-a',sceneId:'a',createdAt:30,status:'running',brief:'子任务完整说明只在详情中展示'};
  const output:any[] = withScheduling(input,[task]);
  expect(output).toHaveLength(input.length);
  expect(output.find(i=>i.id==='a-run')).toMatchObject({label:'已回复',end:12,scheduling:{tasks:[task]}});
  expect(output.find(i=>i.id==='b-run').scheduling.hint).toContain('scene_id="b"');
  expect(output.find(i=>i.id==='a2').scheduling).toBeUndefined();
  expect(input[3].label).toBe('已回复');
  expect(output.find(i=>i.id==='a-run').context).toBeUndefined();
  expect(output.find(i=>i.id==='a-run').scheduling.tasks[0].brief).toBe(task.brief);
});
it.each(['running','done','failed'] as const)('does not rebuild process rows from refreshed history with %s tasks', status => {
  const input:any[] = [ {kind:'message',role:'user',id:'a',sceneId:'a',createdAt:10,text:'task'},
    {kind:'message',role:'being',id:'stage',sceneId:'a',createdAt:20,text:'已委派'} ];
  const tasks:any[] = [{id:'t1',sceneId:'a',createdAt:15,endedAt:30,status}];
  expect(withScheduling(input,tasks)).toEqual(input);
  const final = [...input,{...input[1],id:'final',createdAt:40}];
  expect(withScheduling(final,tasks)).toEqual(final);
});

it.each(['queued','thinking','working','replying','waiting','reconnecting','done','stopped','error','timeout'] as const)(
  'keeps parent %s authoritative across child lifecycle changes', status => {
    const terminal=['done','stopped','error','timeout'].includes(status);
    const parent:any={kind:'run',id:'parent',sceneId:'a',start:11,end:terminal?50:undefined,
      entries:[{type:'tool',name:'portal_exec',done:terminal}],status,label:'主对话状态',hint:'主对话提示',
      outcome:terminal?status:undefined,waitingForReply:status==='waiting',replyConfirmed:status==='done'};
    const input:any[]=[{kind:'message',role:'user',id:'user',sceneId:'a',createdAt:10,text:'task'},parent];
    for(const childStatus of ['queued','running','done','failed'] as const) {
      const task:any={id:'child',sceneId:'a',createdAt:20,endedAt:childStatus==='done'||childStatus==='failed'?40:undefined,status:childStatus};
      const result:any=withScheduling(input,[task])[1];
      expect(result).toEqual({...parent,scheduling:{hint:'',tasks:[task]}});
      expect(parent.scheduling).toBeUndefined();
    }
  },
);

it('leaves final-reply reconciliation to the runtime when task history arrives separately', () => {
  const input:any[] = [
    {kind:'message',role:'user',id:'user',sceneId:'a',createdAt:10,text:'task'},
    {kind:'run',id:'run',sceneId:'a',start:11,entries:[],label:'后台执行中',status:'working',waitingForReply:true},
    {kind:'message',role:'being',id:'reply',sceneId:'a',createdAt:40,text:'已完成',streaming:false},
  ];
  const output:any[] = withScheduling(input,[{id:'task-a',sceneId:'a',createdAt:20,endedAt:30,status:'done'}]);
  expect(output.find(item=>item.id==='run')).toMatchObject(input[1]);
  expect(output.find(item=>item.id==='run').end).toBeUndefined();
});

it('does not use a newer turn reply to finish older delegated work', () => {
  const input:any[] = [
    {kind:'message',role:'user',id:'old',sceneId:'a',createdAt:10,text:'old task'},
    {kind:'run',id:'old-run',sceneId:'a',start:11,entries:[],label:'思考中'},
    {kind:'message',role:'user',id:'new',sceneId:'a',createdAt:40,text:'new question'},
    {kind:'message',role:'being',id:'new-answer',sceneId:'a',createdAt:50,text:'new answer'},
  ];
  const output:any[] = withScheduling(input,[{id:'old-task',sceneId:'a',status:'done',createdAt:20,endedAt:30}]);
  expect(output[1]).toMatchObject(input[1]);
  expect(output[1].waitingForReply).toBeUndefined();
});

it('waits for every delegated result even when tasks finish out of creation order', async () => {
  const state:any={currentScene:{sceneId:'a'},draft:'',subagentReady:true,sceneTasks:[],sceneNames:{},changed:vi.fn()};
  const activity=vi.fn(); const messages:string[]=[];
  let repliedAt=0;
  const runtime=createSceneRuntime(state,{onSceneActivity:activity},(_state:any,options:any)=>({
    sceneActivity:()=> 'done', replyCompletedAt:()=>repliedAt, syncConnection:()=>{},
    waitForPendingFiles:async()=>{},refreshHistory:async()=>{},
    send:(text:string)=>messages.push(options.prepareMessage(text)),dispose:()=>{},
  }));
  try {
    await runtime.send('A 长任务');
    const at=Date.now(); repliedAt=at+50;
    runtime.updateSceneTasks([
      {id:'slow',sceneId:'a',createdAt:at,status:'done',endedAt:at+100},
      {id:'fast',sceneId:'a',createdAt:at+1,status:'done',endedAt:at+20},
    ]);
    expect(activity.mock.lastCall?.[0].a).toBe('waiting');
    await runtime.selectScene({sceneId:'b'}); await runtime.send('B 新任务');
    expect(messages[1]).toBe('B 新任务');
    expect(state.sceneTasks.map((task:any) => task.id)).toEqual(['slow', 'fast']);
    repliedAt=at+110;
    runtime.updateSceneTasks(state.sceneTasks);
    expect(activity.mock.lastCall?.[0].a).toBe('done');
  } finally {runtime.dispose();}
});

it('keeps independent scene messages unchanged regardless of subagent readiness', async () => {
  const state:any={currentScene:{sceneId:'a'},draft:'',sceneTasks:[],changed:vi.fn()};
  const messages:string[]=[];
  const runtime=createSceneRuntime(state,{},(_state:any,options:any)=>({
    sceneActivity:()=> 'working',syncConnection:()=>{},waitForPendingFiles:async()=>{},refreshHistory:async()=>{},
    send:(text:string)=>messages.push(options.prepareMessage(text)),dispose:()=>{},
  }));
  try {
    await runtime.send('A unrelated task');
    await runtime.selectScene({sceneId:'b'}); await runtime.send('B unrelated task');
    expect(messages[1]).toBe('B unrelated task'); // Unknown must not mean healthy.
    runtime.updateSceneTasks([],true);
    await runtime.selectScene({sceneId:'c'}); await runtime.send('C unrelated task');
    expect(messages[2]).toBe('C unrelated task');
    runtime.updateSceneTasks([],false);
    await runtime.send('C follow-up');
    expect(messages[3]).toBe('C follow-up');
  } finally {runtime.dispose();}
});

it('does not resurrect a timed-out or stopped reply when the background task is done', () => {
  for (const outcome of ['error','timeout','stopped'] as const) {
    const input:any[]=[{kind:'message',role:'user',id:'user',sceneId:'b',createdAt:10,text:'independent'},
      {kind:'run',id:'run',sceneId:'b',start:11,end:100,entries:[],label:'等待回复超时',outcome}];
    const output:any[]=withScheduling(input,[{id:'sub-b',sceneId:'b',createdAt:20,endedAt:30,status:'done'}]);
    expect(output[1]).toMatchObject({label:'等待回复超时',outcome,end:100});
    expect(output[1].scheduling.tasks).toHaveLength(1);
  }
});

it('removes a restored uncertain send after history confirms that Heart accepted it', async () => {
  const createdAt = Date.now();
  const saved:any = {id:'saved-send',endpoint:'fixture',scene:{sceneId:'a',strict:true},text:'已送达',files:[],createdAt,phase:'sending'};
  const read = vi.spyOn(SceneQueueStore.prototype,'read').mockResolvedValue([saved]);
  const write = vi.spyOn(SceneQueueStore.prototype,'write').mockResolvedValue();
  const activity = vi.fn();
  const state:any = {items:[],currentScene:{sceneId:'a',strict:true},draft:'',files:[],sceneTasks:[],sceneNames:{},changed:vi.fn()};
  const runtime = createSceneRuntime(state,{onSceneActivity:activity},(sessionState:any) => ({
    sceneActivity:()=> 'done', isBusy:()=>false, syncConnection:()=>{}, waitForPendingFiles:async()=>{},
    refreshHistory:async()=>{}, request:async()=>new Response(null,{status:204}), send:vi.fn(), dispose:()=>{},
    stageQueuedSend(text:string,files:any[]) {
      const message:any = {kind:'message',role:'user',text,queued:true,createdAt,...sessionState.currentScene};
      sessionState.items.push(message);
      return {text,files,message};
    },
    async start() {
      sessionState.items.push({kind:'message',role:'user',text:'已送达',historySeq:9,createdAt:createdAt+1000,...sessionState.currentScene});
    },
  }));
  try {
    await runtime.start();
    expect(state.queued).toBe(0);
    expect(state.items.filter((item:any)=>item.queued)).toEqual([]);
    expect(state.items.filter((item:any)=>item.historySeq).map((item:any)=>item.text)).toEqual(['已送达']);
    expect(write).toHaveBeenCalledWith('saved-send');
    expect(activity.mock.lastCall?.[0]).toEqual({a:'done'});
  } finally {
    runtime.dispose();
    read.mockRestore();
    write.mockRestore();
  }
});

it('rolls a sending transition back and clears activity when disposal wins the dispatch race', async () => {
  vi.useFakeTimers();
  const writes:any[] = [];
  let releaseSending!:()=>void;
  const sending = new Promise<void>(resolve => { releaseSending = resolve; });
  const read = vi.spyOn(SceneQueueStore.prototype,'read').mockResolvedValue([]);
  const write = vi.spyOn(SceneQueueStore.prototype,'write').mockImplementation(async (row:any) => {
    writes.push(typeof row === 'string' ? row : {...row});
    if (typeof row !== 'string' && row.phase === 'sending') await sending;
  });
  const busy:Record<string,boolean> = {a:true,b:false};
  const sent = vi.fn();
  const activity = vi.fn();
  const state:any = {items:[],currentScene:{sceneId:'a',strict:true},draft:'',files:[],sceneTasks:[],sceneNames:{},changed:vi.fn()};
  const runtime = createSceneRuntime(state,{onSceneActivity:activity},(sessionState:any) => ({
    sceneActivity:()=> 'done', isBusy:()=>busy[sessionState.currentScene.sceneId] === true,
    syncConnection:()=>{}, waitForPendingFiles:async()=>{}, refreshHistory:async()=>{},
    request:async()=>new Response(null,{status:204}), send:sent, dispose:()=>{}, start:async()=>{},
    stageQueuedSend(text:string,files:any[] = []) {
      const message:any = {kind:'message',role:'user',text,queued:true,createdAt:Date.now(),...sessionState.currentScene};
      sessionState.items.push(message);
      return {text,files,message};
    },
  }));
  try {
    await runtime.start();
    await runtime.selectScene({sceneId:'b',strict:true});
    await runtime.send('等待发送',[]);
    expect(state.queued).toBe(1);
    busy.a = false;
    runtime.updateSceneTasks([]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(writes.map(row=>row.phase)).toEqual(['queued','sending']);
    runtime.dispose();
    releaseSending();
    await vi.advanceTimersByTimeAsync(0);
    expect(writes.map(row=>row.phase)).toEqual(['queued','sending','queued']);
    expect(sent).not.toHaveBeenCalled();
    expect(state.queued).toBe(0);
    expect(activity.mock.lastCall?.[0]).toEqual({});
  } finally {
    releaseSending();
    runtime.dispose();
    read.mockRestore();
    write.mockRestore();
    vi.useRealTimers();
  }
});

it.each(['running', 'done'] as const)('does not block a new scene on a %s ledger row without runtime ownership', async status => {
  const state:any = {items:[],currentScene:{sceneId:'a'},draft:'',files:[],sceneTasks:[],changed:vi.fn()};
  const sent = vi.fn();
  const runtime = createSceneRuntime(state, {}, (_state:any, options:any) => ({
    sceneActivity:()=> 'done', isBusy:()=>false, syncConnection:()=>{},
    waitForPendingFiles:async()=>{}, refreshHistory:async()=>{}, dispose:()=>{},
    send:(text:string)=>sent(options.prepareMessage(text)),
    stageQueuedSend:()=>{throw new Error('Idle runtime must not queue');},
  }));
  try {
    await runtime.send('A');
    runtime.updateSceneTasks([{id:'old',sceneId:'a',createdAt:Date.now(),endedAt:Date.now()+100,status}]);
    await runtime.selectScene({sceneId:'b'});
    await runtime.send('B');
    expect(sent.mock.calls.map(call=>call[0])).toEqual(['A','B']);
  } finally { runtime.dispose(); }
});

it.each([{interim:true}, {streaming:true}])('does not finish delegated work on an unfinished reply (%j)', flags => {
  const input:any[] = [
    {kind:'message',role:'user',id:'u',sceneId:'a',createdAt:10,text:'task'},
    {kind:'run',id:'run',sceneId:'a',start:11,entries:[],label:'思考中'},
    {kind:'message',role:'being',id:'a',sceneId:'a',createdAt:40,text:'stage',...flags},
  ];
  const output:any[] = withScheduling(input,[{id:'t',sceneId:'a',createdAt:20,endedAt:30,status:'done'}]);
  expect(output[1]).toMatchObject(input[1]);
  expect(output[1].end).toBeUndefined();
});

it('shows failed delegated work even when another task completed', async () => {
  const state:any={currentScene:{sceneId:'a'},draft:'',sceneTasks:[],changed:vi.fn()};
  const activity=vi.fn();
  const runtime=createSceneRuntime(state,{onSceneActivity:activity},(_state:any,options:any)=>({
    sceneActivity:()=> 'done', syncConnection:()=>{}, waitForPendingFiles:async()=>{}, refreshHistory:async()=>{},
    send:(text:string)=>options.prepareMessage(text),dispose:()=>{},
  }));
  try {
    await runtime.send('two tasks');
    const at=Date.now();
    const tasks:any[]=[{id:'ok',sceneId:'a',createdAt:at,endedAt:at+10,status:'done'},
      {id:'bad',sceneId:'a',createdAt:at,endedAt:at+20,status:'failed'}];
    runtime.updateSceneTasks(tasks);
    expect(activity.mock.lastCall?.[0].a).toBe('task-failed');
    const input:any[]=[{kind:'message',role:'user',id:'u',sceneId:'a',createdAt:at-1,text:'two tasks'},
      {kind:'run',id:'run',sceneId:'a',start:at,end:at+20,entries:[],label:'已回复'}];
    expect(withScheduling(input,tasks)[1]).toMatchObject({...input[1],scheduling:{tasks}});
  } finally {runtime.dispose();}
});

it.each([
  {name:'old failure before the latest question', taskAt:20, replyAt:0, interim:false, expected:undefined},
  {name:'current unresolved failure', taskAt:60, replyAt:0, interim:false, expected:'task-failed'},
  {name:'current failure followed by a final reply', taskAt:60, replyAt:80, interim:false, expected:undefined},
  {name:'current failure followed only by progress', taskAt:60, replyAt:80, interim:true, expected:'task-failed'},
])('restores the scene badge from history: $name', ({taskAt, replyAt, interim, expected}) => {
  const state:any = {items:[
    {kind:'message',role:'user',id:'old',sceneId:'a',createdAt:10,text:'old task'},
    {kind:'message',role:'user',id:'current',sceneId:'a',createdAt:50,text:'current question'},
    ...(replyAt ? [{kind:'message',role:'being',id:'answer',sceneId:'a',createdAt:replyAt,text:'reply',streaming:false,interim}] : []),
  ],currentScene:{sceneId:'a'},draft:'',sceneTasks:[],changed:vi.fn()};
  const activity = vi.fn();
  const runtime = createSceneRuntime(state,{onSceneActivity:activity},()=>({
    sceneActivity:()=>null, replyCompletedAt:()=>0, isBusy:()=>false, syncConnection:()=>{}, dispose:()=>{},
  }));
  try {
    const task:any = {id:'failed',sceneId:'a',createdAt:taskAt,endedAt:taskAt+5,status:'failed'};
    runtime.updateSceneTasks([task]);
    expect(activity.mock.lastCall?.[0].a).toBe(expected);
    expect(state.sceneTasks).toEqual([task]);
  } finally {runtime.dispose();}
});

it.each(['queued','thinking','replying','working','waiting','reconnecting'])('prioritizes the current %s stream over an old task ledger', status => {
  const state:any={items:[],currentScene:{sceneId:'a'},sceneTasks:[],changed:vi.fn()};
  const activity=vi.fn();
  const runtime=createSceneRuntime(state,{onSceneActivity:activity},()=>({
    sceneActivity:()=>status,isBusy:()=>true,syncConnection:()=>{},dispose:()=>{},
  }));
  try {
    runtime.updateSceneTasks([
      {id:'old-failure',sceneId:'a',createdAt:10,endedAt:20,status:'failed'},
      {id:'old-running',sceneId:'a',createdAt:11,status:'running'},
    ]);
    expect(activity.mock.lastCall?.[0].a).toBe(status);
    expect(state.sceneTasks).toHaveLength(2);
  } finally {runtime.dispose();}
});
