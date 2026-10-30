import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatActivity } from '../desktop/renderer/chat/components/messages';
import type { Run } from '../desktop/renderer/chat/models/chat';

const run: Run = {kind:'run',id:'quiet',start:1,status:'working',label:'处理任务',hint:'',arg:'',
  entries:[{type:'tool',text:'private diagnostic output',artifactPath:'/tmp/report.html'}]};
const render = (value: Run, showDetails = false) => renderToStaticMarkup(createElement(ChatActivity,{run:value,showDetails}));
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
  expect(html).toContain(`data-status="${status}"`);
  expect(html).not.toContain('thinking-dots');
});
it('can render the full activity when the preference is enabled', () => {
  expect(render({...run,end:2,status:'done'},true)).toContain('run-activity');
});
