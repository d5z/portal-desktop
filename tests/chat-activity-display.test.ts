import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatActivity } from '../desktop/renderer/chat/components/messages';
import type { Run } from '../desktop/renderer/chat/models/chat';
import { quietProgressRuns } from '../desktop/renderer/chat/models/reply-bubbles';

const run: Run = {kind:'run',id:'quiet',start:1,status:'working',label:'处理任务',hint:'',arg:'',
  entries:[{type:'tool',text:'private diagnostic output',artifactPath:'/tmp/report.html'}]};
const render = (value: Run, showDetails = false) => renderToStaticMarkup(createElement(ChatActivity,{run:value,showDetails}));
it.each([
  ['queued','queued','1 项排队中'], ['running','running','1 项运行中'], ['done','done','全部完成'],
  ['cancelled','stopped','1 项已停止'], ['interrupted','stopped','1 项已停止'],
  ['failed','failed','1 项失败'], ['timeout','timeout','1 项超时'], ['budget_exhausted','budget_exhausted','1 项预算用尽'],
] as const)('distinguishes delegated %s in its compact entry', (status, displayStatus, label) => {
  const html=renderToStaticMarkup(createElement(ChatActivity,{run:{...run,scheduling:{hint:'',tasks:[
    {id:'child',sceneId:'a',createdAt:1,status},
  ]}},onOpenSubagents:()=>{}}));
  expect(html).toContain(`class="run-subagent-activity" data-status="${displayStatus}"`);
  expect(html).toContain(label);
  expect(html).toContain('run-subagent-mark');
  expect(html).not.toContain('run-delegation-label');
});
it.each([true, false])('exposes delegated work even when reasoning visibility is %s', showDetails => {
  const delegated: Run = {...run, scheduling: { hint: '', tasks: [
    {id:'child-a',sceneId:'a',createdAt:1,status:'running',brief:'Python 文件校验\n用内置运行环境写入文件'},
    {id:'child-b',sceneId:'a',createdAt:2,status:'done',brief:'Node 文件校验\n读回并校验'},
  ]}};
  const html = renderToStaticMarkup(createElement(ChatActivity, {run:delegated,showDetails,onOpenSubagents:()=>{}}));
  expect(html.match(/aria-label="查看子智能体执行详情"/g)).toHaveLength(1);
  expect(html).not.toContain('Python 文件校验');
  expect(html).toContain('子智能体 · 2 项');
  expect(html).toContain('1 项运行中');
  expect(html).not.toContain('run-delegation-label');
  expect(html).not.toContain('run-subagent-icons');
  const entry = html.indexOf('aria-label="查看子智能体执行详情"');
  expect(entry).toBeGreaterThan(html.indexOf('</summary>'));
  expect(entry).toBeLessThan(html.indexOf('</details>'));
  expect(html).not.toContain('run-subagent-messages');
  expect(html).not.toMatch(/<details[^>]*\bopen[= >]/);
  expect(html).not.toContain('用内置运行环境写入文件');
  expect(html).not.toContain('private diagnostic output');
  const finished = {...delegated,end:3,scheduling:{hint:'',tasks:delegated.scheduling!.tasks.map(task=>({...task,status:'failed' as const}))}};
  const completed = renderToStaticMarkup(createElement(ChatActivity, {run:finished,showDetails,onOpenSubagents:()=>{}}));
  expect(completed).toContain('2 项失败');
  expect(completed).not.toContain('查看本轮 subagent 执行详情');
});
it('shows an accessible three-dot bubble without mounting the trace and preserves file results', () => {
  const html = render(run);
  expect(html).toContain('thinking-dots');
  expect(html).toContain('role="status"');
  expect(html).toContain('report.html');
  expect(html).not.toContain('run-activity');
  expect(html).not.toContain('private diagnostic output');
});
it('removes the successful thinking bubble while retaining generated files', () => {
  const html = render({...run,end:2,status:'done',outcome:'done'});
  expect(html).not.toContain('thinking-bubble');
  expect(html).toContain('report.html');
});
it.each(['error','timeout','stopped'] as const)('keeps the %s notice visible with reasoning hidden', status => {
  const html = render({...run,end:2,status,outcome:status,hint:'需要确认任务结果'});
  expect(html).toContain('需要确认任务结果');
  expect(html).toContain(`data-tone="${status === 'stopped' ? 'stopped' : 'error'}"`);
  expect(html).not.toContain('thinking-dots');
});
it('can render the full activity when the preference is enabled', () => {
  expect(render({...run,end:2,status:'done'},true)).toContain('run-activity');
});

it.each([
  {seconds:13, name:'exec', label:'在执行', expected:'用时 13 秒'},
  {seconds:73, name:'exec', label:'在执行', expected:'用时 1 分钟 13 秒'},
  {seconds:120, name:'read_file', label:'在读取', expected:'用时 2 分钟 0 秒'},
])('replaces the completed tool label with elapsed time: $expected', ({seconds,name,label,expected}) => {
  const html = render({...run,end:run.start+seconds*1000,status:'done',outcome:'done',
    entries:[{type:'tool',name,label,done:true}]},true);
  expect(html).toContain(expected);
  expect(html).not.toContain(label);
  expect(html).toContain('class="run-icon" aria-hidden="true"');
  expect(html).toContain('run-chevron');
  expect(html).not.toContain('run-activity running');
});

it('shows elapsed time for completed delegation with reasoning hidden', () => {
  const html = renderToStaticMarkup(createElement(ChatActivity, {
    run:{...run,end:run.start+73000,status:'done',outcome:'done',scheduling:{hint:'',tasks:[
      {id:'child',sceneId:'a',createdAt:1,status:'done'},
    ]}},showDetails:false,onOpenSubagents:()=>{},
  }));
  expect(html).toContain('用时 1 分钟 13 秒');
  expect(html).not.toContain('思考过程');
  expect(html).toContain('查看子智能体执行详情');
});

it.each(['working','error','stopped','timeout'] as const)('keeps the %s status instead of showing a completed duration', status => {
  const html = render({...run,status,end:status==='working' ? undefined : 73001,
    label:'当前状态',entries:[{type:'tool',label:'在执行'}]},true);
  expect(html).not.toContain('用时');
  expect(html).toContain(status==='working' ? '在执行' : '当前状态');
});

it.each(['error','timeout','stopped'] as const)('retires an older %s notice when a newer run takes over', status => {
  const previous:Run = {...run,end:73001,status,outcome:status,label:'旧轮次异常',hint:'旧错误详情',
    entries:[{type:'tool',error:true,done:true,result:'旧工具错误',artifactPath:'/tmp/report.html'}]};
  const detailed = renderToStaticMarkup(createElement(ChatActivity,{run:previous,showDetails:true,superseded:true}));
  expect(detailed).toContain('用时 1 分钟 13 秒');
  expect(detailed).toContain('class="run-icon" aria-hidden="true"');
  expect(detailed).not.toContain('1 次失败');
  expect(detailed).not.toContain('旧轮次异常');
  expect(detailed).toContain('report.html');
  const quiet = renderToStaticMarkup(createElement(ChatActivity,{run:previous,showDetails:false,superseded:true}));
  expect(quiet).not.toContain('chat-status-row');
  expect(quiet).toContain('1 次工具调用失败');
  expect(quiet).not.toContain('旧轮次异常');
  expect(quiet).toContain('report.html');
  expect(previous.outcome).toBe(status);
  expect(previous.entries[0].result).toBe('旧工具错误');
});

it('shows only the latest progress per scene without losing errors or artifacts', () => {
  const runs = [run, {...run,id:'next'}, {...run,id:'other',sceneId:'other'}];
  const visible = quietProgressRuns(runs);
  expect([...visible]).toEqual(['next','other']);
  const html = renderToStaticMarkup(createElement(ChatActivity, {run,showDetails:false,showProgress:false}));
  expect(html).not.toContain('thinking-dots');
  expect(html).toContain('report.html');
  expect(renderToStaticMarkup(createElement(ChatActivity, {run:{...run,status:'error'},showDetails:false,showProgress:false}))).toContain('data-tone="error"');
});

it('replaces typing dots with streamed text and restores them for an interrupt or tool stage', () => {
  const reply:any = {kind:'message',role:'being',id:'reply',text:'回答',streaming:true};
  expect([...quietProgressRuns([reply,run])]).toEqual([]);
  expect([...quietProgressRuns([{...reply,streaming:false},run])]).toEqual(['quiet']);
  expect([...quietProgressRuns([reply,{...reply,id:'interrupt',role:'user',streaming:false},run])]).toEqual(['quiet']);
  expect([...quietProgressRuns([reply,{...run,sceneId:'other'}])]).toEqual(['quiet']);
});

it('keeps the stopped status in its run while preserving artifacts', () => {
  const stopped = {...run,end:2,status:'stopped' as const,stopHistorySeq:3};
  expect(render(stopped,false)).toContain('chat-status-row');
  expect(render(stopped,false)).toContain('report.html');
  expect(render({...stopped,status:'error'},false)).toContain('data-tone="error"');
  const notice:any={kind:'message',role:'system',id:'stop-notice',text:'停止尚未确认',notice:'stop',statusRunId:run.id};
  expect([...quietProgressRuns([run,notice])]).toEqual([]);
});

it.each([true,false])('renders a stopped turn without records as a compact notice (details %s)', showDetails => {
  const stopped:Run={...run,entries:[],label:'已停止',status:'stopped',outcome:'stopped',end:1001};
  const html=render(stopped,showDetails);
  expect(html).toContain('已停止');
  expect(html).toContain('用时 1 秒');
  expect(html).not.toContain('<details');
  expect(html).not.toContain('run-empty');
  expect(renderToStaticMarkup(createElement(ChatActivity,{run:stopped,showDetails,superseded:true}))).toBe('');
});

it('keeps elapsed time beside the collapsed thinking label', () => {
  const html=render({...run,start:Date.now()-13000,status:'thinking',label:'思考中',entries:[]},true);
  expect(html).toMatch(/class="run-label"[^>]*>思考中<\/span><span class="run-elapsed">· 13 秒<\/span>/);
  expect(html).not.toContain('总耗时');
});

it('keeps an elapsed row without an empty disclosure after a plain reply', () => {
  const html = render({...run, entries:[], end:2001, status:'done', outcome:'done'}, true);
  expect(html).toContain('用时 2 秒');
  expect(html).not.toContain('<details');
  expect(render({...run, entries:[], status:'thinking'}, true)).toContain('run-activity');
});

it.each(['queued', 'waiting', 'reconnecting'] as const)('shows %s as a passive status instead of thinking dots', status => {
  const html = render({...run, entries:[], status, label:'等待状态', waitingForReply:true});
  expect(html).toContain('等待状态');
  expect(html).not.toContain('thinking-dots');
  expect(html).toContain('role="status"');
});
