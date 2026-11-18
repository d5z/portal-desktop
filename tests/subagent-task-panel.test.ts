import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { SubagentTaskPanel } from '../desktop/renderer/app/components/subagent-tasks';
import type { SceneTask, SubagentStep } from '../desktop/shared/types';

const task: SceneTask = { id: 'sub_live', sceneId: 'scene', status: 'running', createdAt: 1, brief: '文件校验\n完整任务说明' };
const steps: SubagentStep[] = [
  { kind: 'thinking', at: 1 },
  { kind: 'tool', at: 2, callId: 'read', name: 'read', input: 'read file' },
  { kind: 'tool', at: 3, callId: 'exec', name: 'python', input: 'time.sleep(45)' },
  { kind: 'tool-result', at: 4, callId: 'read', name: 'read', output: 'FILE_CONTENT' },
];
const render = (value: SceneTask, activity: SubagentStep[], selected = true) => renderToStaticMarkup(createElement(SubagentTaskPanel, {
  tasks: [value], details: [{ taskId: value.id, steps: activity }], initialSelectedId: selected ? value.id : undefined,
  error: '', onRetry() {}, onClose() {},
}));

it('keeps an outstanding parallel tool running after another tool returns, in list and detail', () => {
  expect(render(task, steps, false)).toContain('正在运行 python');
  const html = render(task, steps);
  expect(html).toContain('正在运行 python');
  expect(html).toContain('正在执行');
  expect(html).not.toContain('结果未确认');
  expect(html).toContain('time.sleep(45)');
  expect(html).toContain('FILE_CONTENT');
  expect(html).toContain('完整任务说明');
  expect(html).toContain('aria-label="子智能体思考过程"');
  expect(html).not.toMatch(/<details[^>]*\bopen[= >]/);
  expect(html).toContain('任务说明');
});

it('keeps the result visible while grouping tool input and output in the collapsed process', () => {
  const html = render({ ...task, status: 'done', endedAt: 6 }, [...steps,
    { kind: 'tool-result', at: 5, callId: 'exec', name: 'python', failed: true, output: 'TEST_ERROR' },
    { kind: 'message', at: 6, output: '**最终结论**：文件不存在，未修改。' },
    { kind: 'finished', at: 6 },
  ]);
  expect(html).toContain('执行失败');
  expect(html.match(/<strong>python<\/strong>/g)).toHaveLength(1);
  expect(html).toContain('TEST_ERROR');
  expect(html).toContain('执行结果');
  expect(html).toContain('<strong>最终结论</strong>');
  expect(html).not.toContain('正在执行');
});
