import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, writeFile, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SceneTaskObserver, publicSceneTasks } from '../desktop/main/portal/subagent-tasks';
import { splitSchedulingHint, withScheduling } from '../desktop/renderer/chat/models/scheduling';
import { createSceneRuntime } from '../desktop/renderer/chat/services/scene-runtime';

it('only exposes bounded, scene-scoped task status and generic auth errors', () => {
  const task = { task_id: 'task1', scene_id: 'a', status: 'failed', created_ms: 10, error: '401 secret-key', brief_head: 'private instructions' };
  expect(publicSceneTasks({ tasks: [task, {...task, scene_id:'other'}]}, new Set(['a']))).toEqual([
    { id:'task1', sceneId:'a', status:'failed', createdAt:10, endedAt:undefined, error:'模型鉴权失败，请检查 subagent 密钥' },
  ]);
  expect(publicSceneTasks({}, new Set(['a']))).toEqual([]);
});
it('observes atomic ledger replacement without polling and stops on dispose', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(),'scene-task-watch-'));
  const listener = vi.fn(); const observer = new SceneTaskObserver(listener,()=>new Set(['a']));
  const config = path.join(directory,'portal.toml');
  await writeFile(config, `[subagent]\nstate_dir = ${JSON.stringify(directory)}\n`);
  const task = {task_id:'task1',scene_id:'a',status:'running',created_ms:10};
  try {
    await writeFile(path.join(directory,'ledger.json'),JSON.stringify({tasks:[task]}));
    expect((await observer.configure(config))[0].status).toBe('running');
    await writeFile(path.join(directory,'ledger.tmp'),JSON.stringify({tasks:[{...task,status:'done',ended_ms:20}]}));
    await rename(path.join(directory,'ledger.tmp'),path.join(directory,'ledger.json'));
    await vi.waitFor(()=>expect(listener).toHaveBeenCalledWith([expect.objectContaining({status:'done'})]));
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
  expect(activity.mock.lastCall?.[0].a).toBe('error');
  runtime.dispose();
});

it('attaches interleaved scene tasks and hints to their own turn without mutating runtime state', () => {
  const user = (id:string, sceneId:string, createdAt:number, text = 'question'):any => ({kind:'message',id,role:'user',sceneId,createdAt,text});
  const run = (id:string,sceneId:string,start:number):any => ({kind:'run',id,sceneId,start,end:start+1,entries:[],label:'已回复'});
  const hint = 'question\n\n[Desktop 场景调度提示]\n当前输入属于 scene_id="b"。本客户端其他场景尚在处理或等待回复：[]\n[/Desktop 场景调度提示]';
  const input = [user('a1','a',10),user('b1','b',20,hint),run('b-run','b',21),run('a-run','a',11),user('a2','a',50)];
  const task:any = {id:'task-a',sceneId:'a',createdAt:30,status:'running'};
  const output:any[] = withScheduling(input,[task]);
  expect(output).toHaveLength(input.length);
  expect(output.find(i=>i.id==='a-run')).toMatchObject({label:'后台执行中',end:undefined,scheduling:{tasks:[task]}});
  expect(output.find(i=>i.id==='b-run').scheduling.hint).toContain('scene_id="b"');
  expect(output.find(i=>i.id==='a2').scheduling).toBeUndefined();
  expect(input[3].label).toBe('已回复');
});
it('rebuilds one collapsed process row from history, waits after stage replies, then settles on final reply', () => {
  const input:any[] = [ {kind:'message',role:'user',id:'a',sceneId:'a',createdAt:10,text:'task'},
    {kind:'message',role:'being',id:'stage',sceneId:'a',createdAt:20,text:'已委派'} ];
  const tasks:any[] = [{id:'t1',sceneId:'a',createdAt:15,endedAt:30,status:'done'}, {id:'t2',sceneId:'a',createdAt:16,endedAt:35,status:'done'}];
  const before:any[] = withScheduling(input,tasks);
  expect(before.filter(i=>i.kind==='run')).toHaveLength(1);
  expect(before[1]).toMatchObject({label:'后台已完成，尚未收到回复',waitingForReply:true,scheduling:{tasks}});
  const after:any[] = withScheduling([...input,{...input[1],id:'final',createdAt:40}],tasks);
  expect(after[1].end).toBe(35);
  expect(after[1].label).toBe('思考过程');
  expect(withScheduling(input,[{...tasks[0],sceneId:'external'}])).toEqual(input);
});

it('does not use a newer turn reply to finish older delegated work', () => {
  const input:any[] = [
    {kind:'message',role:'user',id:'old',sceneId:'a',createdAt:10,text:'old task'},
    {kind:'message',role:'user',id:'new',sceneId:'a',createdAt:40,text:'new question'},
    {kind:'message',role:'being',id:'new-answer',sceneId:'a',createdAt:50,text:'new answer'},
  ];
  const output:any[] = withScheduling(input,[{id:'old-task',sceneId:'a',status:'done',createdAt:20,endedAt:30}]);
  expect(output[1]).toMatchObject({id:'scheduling-old',label:'后台已完成，尚未收到回复'});
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
  for (const outcome of ['error','stopped'] as const) {
    const input:any[]=[{kind:'message',role:'user',id:'user',sceneId:'b',createdAt:10,text:'independent'},
      {kind:'run',id:'run',sceneId:'b',start:11,end:100,entries:[],label:'等待回复超时',outcome}];
    const output:any[]=withScheduling(input,[{id:'sub-b',sceneId:'b',createdAt:20,endedAt:30,status:'done'}]);
    expect(output[1]).toMatchObject({label:'等待回复超时',outcome,end:100});
    expect(output[1].scheduling.tasks).toHaveLength(1);
  }
});
