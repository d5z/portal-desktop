import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Markdown, markdownText } from '../desktop/renderer/shared/components/markdown';
import { placeFromURL, validPlaceTarget, workDraftLink, workTaskReferences } from '../desktop/renderer/shared/lib/navigation';
import { AppModel } from '../desktop/renderer/app/models/app';
import { WorkModel } from '../desktop/renderer/app/models/work';
import type { DesktopAPI } from '../desktop/shared/types';

const ids = ['sub_894ccaa9-1d4e-4afe-a509-57d22523b7ff', 'agent_codex_01a207e5-52f1-7440-bc5c-b0b579e7620f', 'agent_deepseek_session-61285e6b-8b49-4306-9689-56c0b8ad59be'];
const render = (content: string, embedded = true) => renderToStaticMarkup(createElement(Markdown, { content, chat: true, onPlace: embedded ? () => {} : undefined }));

describe('Work conversation references', () => {
  it('recognizes complete executor task IDs in prose, code and punctuation without accepting truncated or extended IDs', () => {
    const text = `任务：${ids[0]}；\`${ids[1]}\`\n{"task_id":"${ids[2]}"}`;
    expect(workTaskReferences(text).map(({ id, index }) => [id, text.slice(index, index + id.length)])).toEqual(ids.map(id => [id, id]));
    for (const invalid of [ids[0].slice(0, -1), ids[1] + '0', 'prefix_' + ids[2], ids[0] + '-suffix', 'sub_agent', ids[1].slice(12)]) expect(workTaskReferences(invalid)).toEqual([]);
  });
  it.each(ids)('accepts only the specific local Work destination for %s', id => {
    expect(placeFromURL(`beings://work/${id}`)).toEqual({ view: 'work', id });
    expect(validPlaceTarget({ view: 'work', id })).toBe(true);
    for (const raw of [`beings://work/${id}?token=x`, `beings://work/${id}/cancel`, `beings://work@evil/${id}`, `https://evil/work/${id}`, `beings://work/../${id}`]) expect(placeFromURL(raw)).toBeNull();
    expect(validPlaceTarget({ view: 'work', id: '../' + id })).toBe(false);
    expect(validPlaceTarget({ view: 'work' })).toBe(false);
  });
  it('links ordinary text, inline code and table cells, preserving original text and source copying', () => {
    const source = `已安排 ${ids[0]}，续聊 \`${ids[1]}\`。\n\n| 会话 |\n| --- |\n| ${ids[2]} |`;
    const html = render(source);
    for (const id of ids) expect(html).toContain(`data-work-task="${id}"`);
    expect(html.match(/data-work-task=/g)).toHaveLength(3);
    expect(html).toContain(`<code><button`);
    expect(markdownText(source)).toContain(ids[1]);
    expect(render(source, false)).not.toContain('data-work-task');
  });
  it('uses a named title link without nesting clickable ID references inside it or external URLs', () => {
    const html = render(`[整理反馈](beings://work/${ids[0]}) 与 [${ids[1]}](https://example.com/readme)`);
    expect(html.match(/data-work-task=/g)).toHaveLength(1);
    expect(html).toContain('>整理反馈</button>');
    expect(html).toContain(`href="https://example.com/readme"`);
    expect(html).not.toContain('href="beings:');
  });
  it('opens a scoped Work reference at its underlying task or project', () => {
    const id = 'work_894ccaa9-1d4e-4afe-a509-57d22523b7ff';
    const project = id.replace('work_', 'proj_');
    expect(render(workDraftLink('报表', id, { kind: 'run', value: 'after-original-run' }))).toContain(`data-work-task="${id}"`);
    expect(placeFromURL(`beings://work/${project}#project`)).toEqual({ view: 'work', id: project });
    expect(placeFromURL(`beings://work/${id}#run=not%20valid`)).toBeNull();
  });
  it('opens a native Work goal from a Being conversation link', () => {
    const id = 'goal_6e1769d9-3a48-4b98-8c5d-87bc3e3fd279';
    expect(placeFromURL(`beings://work/${id}`)).toEqual({ view: 'work', id });
    expect(render(`[社区开放日准备](beings://work/${id})`)).toContain('title="打开 Work 目标">社区开放日准备</button>');
    const model = new WorkModel();
    model.select(id);
    expect(model.panel).toBe('goals');
    expect(model.goalId).toBe(id);
  });
  it('renders a document task title literally and keeps the full item ID clickable', () => {
    const id = 'work_6e1769d9-3a48-4b98-8c5d-87bc3e3fd279';
    const html = render(`交给 Being [生成 \\[欢迎页\\] \\*草稿\\* \\& 说明](beings://work/${id})，任务 ID：\`${id}\`。`);
    expect(html).toContain('>生成 [欢迎页] *草稿* &amp; 说明</button>');
    expect(html).toContain(`aria-label="打开 Work 会话 ${id}"`);
    expect(html.match(/data-work-task=/g)).toHaveLength(2);
  });
  it('keeps fenced JSON unchanged and adds one opening action per task after the source', () => {
    const source = JSON.stringify({ task_id: ids[0], again: ids[0], other: ids[2] });
    const html = render('```json\n' + source + '\n```');
    const code = html.match(/<pre\b[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/)![1];
    expect(code).not.toContain('<button');
    expect(code.replace(/<\/?span\b[^>]*>/g, '')).toBe(renderToStaticMarkup(createElement('span', null, source)).slice(6, -7));
    expect(html.match(/data-work-task=/g)).toHaveLength(2);
    expect(html).toContain('data-markdown-copy="exclude"');
  });
});

it('opens another Work session from chat or an already open import view without reusing the previous history', async () => {
  const app = new AppModel({} as DesktopAPI);
  app.snapshot = { settings: { endpoint: 'one' } } as typeof app.snapshot;
  app.work.configure('one');
  app.work.snapshot = { endpoint: 'one', tasks: ids.slice(0, 2).map((id, i) => ({ id, status: 'done', createdAt: i, sceneId: 'scene' })) };
  app.work.selectedId = ids[0];
  app.work.details = [{ taskId: ids[0], steps: [{ at: 1, kind: 'message', output: 'Previous conversation' }] }];
  const request = vi.spyOn(app.work, 'request').mockResolvedValue({ taskId: ids[1], steps: [{ at: 2, kind: 'message', output: 'Selected conversation' }] });
  vi.spyOn(app.town, 'show').mockImplementation(() => {});
  app.openWork(ids[1]);
  expect(app.view).toBe('work');
  expect(app.work.selected?.id).toBe(ids[1]);
  expect(app.work.details.some(detail => detail.taskId === ids[0])).toBe(false);
  await vi.waitFor(() => expect(app.work.details[0]?.steps[0].output).toBe('Selected conversation'));
  app.work.importing = true;
  const refresh = vi.spyOn(app.work, 'refresh').mockResolvedValue();
  app.openWork(ids[0]);
  expect(app.work.importing).toBe(false);
  expect(app.work.selected?.id).toBe(ids[0]);
  expect(refresh).toHaveBeenCalledOnce();
  request.mockRestore();
});

it('opens the latest execution conversation for a managed task and keeps task details when switching sessions', async () => {
  const work = new WorkModel();
  work.configure('one');
  const itemId = 'work_6e1769d9-3a48-4b98-8c5d-87bc3e3fd279';
  const item = { id: itemId, title: '生成欢迎页', description: '', projectId: '', executor: '', stage: 'review' as const, priority: 'none' as const,
    labels: [], dueDate: '', parentId: '', createdAt: 1, updatedAt: 2, runIds: ids.slice(1), artifacts: [], notes: [] };
  const tasks = ids.slice(1).map((id, index) => ({ id, status: 'done' as const, createdAt: index + 1, sceneId: 'scene' }));
  vi.spyOn(work, 'request').mockImplementation(async (path = '') => (path ? { taskId: path.slice(1), steps: [{ at: 1, kind: 'message', output: path }] }
    : { endpoint: work.endpoint, items: [item], tasks }) as never);
  work.select(itemId);
  await work.refresh();
  expect(work.item?.id).toBe(itemId);
  expect(work.selected?.id).toBe(ids[2]);
  expect(work.conversation[0]?.steps[0].output).toBe(`/${ids[2]}`);
  work.select(ids[1]);
  expect(work.panel).toBe('items');
  expect(work.item?.id).toBe(itemId);
  await vi.waitFor(() => expect(work.conversation[0]?.steps[0].output).toBe(`/${ids[1]}`));
  work.configure('two');
  work.select(ids[1]);
  await work.refresh();
  expect(work.selected?.id).toBe(ids[1]);
  expect(work.item?.id).toBe(itemId);
  expect(work.panel).toBe('items');
});
