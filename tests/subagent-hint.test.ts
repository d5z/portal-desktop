import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { SubagentSetupHint } from '../desktop/renderer/chat/components/subagent-hint';

const actions = { onConfigure: vi.fn(), onEnable: vi.fn(), onClose: vi.fn() };

it('shows separate configure and one-click enable actions in a dismissible hint', () => {
  expect(renderToStaticMarkup(createElement(SubagentSetupHint, { mode: null, ...actions }))).toBe('');
  const configure = renderToStaticMarkup(createElement(SubagentSetupHint, { mode: 'configure', ...actions }));
  expect(configure).toContain('用 subagent 并行处理任务');
  expect(configure).toContain('去配置');
  expect(configure).toContain('aria-label="关闭 subagent 提示"');
  const enable = renderToStaticMarkup(createElement(SubagentSetupHint, { mode: 'enable', ...actions }));
  expect(enable).toContain('subagent 已配置但未开启');
  expect(enable).toContain('一键开启');
});
