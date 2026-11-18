import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatActivity } from '../desktop/renderer/chat/components/messages';
import type { Run } from '../desktop/renderer/chat/models/chat';
import { quietProgressRuns } from '../desktop/renderer/chat/models/reply-bubbles';

const run: Run = {kind:'run',id:'quiet',start:1,status:'working',label:'处理任务',hint:'',arg:'',
  entries:[{type:'tool',text:'private diagnostic output',artifactPath:'/tmp/report.html'}]};
const render = (value: Run, showDetails = false) => renderToStaticMarkup(createElement(ChatActivity,{run:value,showDetails}));
it.each([true, false])('exposes delegated work even when reasoning visibility is %s', showDetails => {
  const delegated: Run = {...run, scheduling: { hint: '', tasks: [
    {id:'child-a',sceneId:'a',createdAt:1,status:'running',brief:'Python 文件校验\n用内置运行环境写入文件'},
    {id:'child-b',sceneId:'a',createdAt:2,status:'done',brief:'Node 文件校验\n读回并校验'},
  ]}};
  const html = renderToStaticMarkup(createElement(ChatActivity, {run:delegated,showDetails,onOpenSubagents:()=>{}}));
  expect(html.match(/aria-label="查看子智能体执行详情"/g)).toHaveLength(1);
  expect(html).not.toContain('Python 文件校验');
  expect(html).toContain('子智能体 · 2');
  expect(html).toContain('1 运行中');
  expect(html).toContain('子智能体协作');
  const entry = html.indexOf('aria-label="查看子智能体执行详情"');
  expect(entry).toBeGreaterThan(html.indexOf('</summary>'));
  expect(entry).toBeLessThan(html.indexOf('</details>'));
  expect(html).not.toContain('run-subagent-messages');
  expect(html).not.toMatch(/<details[^>]*\bopen[= >]/);
  expect(html).not.toContain('用内置运行环境写入文件');
  expect(html).not.toContain('private diagnostic output');
  const finished = {...delegated,end:3,scheduling:{hint:'',tasks:delegated.scheduling!.tasks.map(task=>({...task,status:'failed' as const}))}};
  const completed = renderToStaticMarkup(createElement(ChatActivity, {run:finished,showDetails,onOpenSubagents:()=>{}}));
  expect(completed).toContain('2 异常');
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

it('uses the durable stop marker instead of another status row while preserving artifacts', () => {
  const stopped = {...run,end:2,status:'stopped' as const,stopHistorySeq:3};
  expect(render(stopped,false)).not.toContain('chat-status-row');
  expect(render(stopped,false)).toContain('report.html');
  expect(render({...stopped,status:'error'},false)).toContain('data-tone="error"');
  const notice:any={kind:'message',role:'system',id:'stop-notice',text:'停止尚未确认',notice:'stop',statusRunId:run.id};
  expect([...quietProgressRuns([run,notice])]).toEqual([]);
});
