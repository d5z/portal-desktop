import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { canUseComposerCommand, composerCommandQuery, insertComposerCommand, matchingComposerCommands, parseComposerCommands } from '../desktop/renderer/chat/models/composer-commands';
import { withComposerCommandContext } from '../desktop/renderer/chat/services/composer-command-context';
import { stripClientMessageContext } from '../desktop/renderer/chat/services/local-file-context';
import { withSceneTransition } from '../desktop/renderer/chat/models/scenes';
import { ChatState } from '../desktop/renderer/chat/models/chat';
import { createChatRuntime } from '../desktop/renderer/chat/services/runtime';
import { SceneQueueStore } from '../desktop/renderer/chat/services/scene-queue';
import { HistoryCache } from '../desktop/renderer/chat/services/history-cache';
import { workDraftLink } from '../desktop/renderer/shared/lib/navigation';
import type { WorkStage } from '../desktop/shared/work';

it('sends the Work handover instructions with the selected scene and keeps the visible message short', () => {
  const text = '请接管这项 Work 任务。';
  const request = withComposerCommandContext(text, false, undefined, undefined, 'dispatch-scene', { itemId: 'work_fixture', id: 'dispatch-fixture' });
  expect(request).toContain('@work work_fixture');
  expect(request).toContain('@work agents');
  expect(request).toContain('@work run {"item_id":"work_fixture","dispatch_id":"dispatch-fixture","scene_id":"dispatch-scene"');
  expect(request).toContain('收到各项启动回执后立即结束本轮');
  expect(stripClientMessageContext(request)).toBe(text);
});

it('expands Work references into scoped commands only while sending', () => {
  const item = 'work_12345678-abcd-4321-9876-123456789abc';
  const goal = item.replace('work_', 'goal_');
  const project = item.replace('work_', 'proj_');
  const session = item.replace('work_', 'agent_codex_');
  const run = workDraftLink('报表', item, { kind: 'run', value: 'after-original-run' });
  const result = workDraftLink('报表', session, { kind: 'result', value: `${session}:turn-28` });
  const assignment = workDraftLink('报表', item, { kind: 'assign', value: 't_fixture_collaborator' });
  const share = workDraftLink('报表', item, { kind: 'share', value: 't_status_recipient' });
  const inputs = [
    [`请为 ${run} 安排下一轮执行。`, [`@work ${item}`, `@work run {"item_id":"${item}","request_id":"after-original-run"}`, `@work status ${item}`, '确认未接收才可重试', '收到各项启动回执后立即结束本轮']],
    [`一起看看 ${result} 的第 2 版交付。`, [`@work result ${session}:turn-28`, 'files[].path']],
    [`一起看看 ${workDraftLink('报表', item)} 的进度。`, [`@work ${item}`, `@work results ${item}`]],
    [`一起看看 ${workDraftLink('会话', session)} 的执行情况。`, [`@work ${session}`, '按 next 翻页']],
    [`一起看看 ${workDraftLink('目标', goal)} 的进度。`, [`@work goal ${goal}`]],
    [`帮我在 ${workDraftLink('项目', project, { kind: 'project' })} 创建一个任务：生成 HTML 看板`, [`@work project ${project}`, `projectId 固定为 ${project}`, '@work create', '用户明确要求开工时']],
    [`请把 ${assignment} 的指派私信发给「协作者」。\n\n> 任务正文`, ['完整 Town ID t_fixture_collaborator', '正文取该指派语句下面的引用块']],
    [`请私信「协作者」，分享 ${share} 的当前状态。\n\n> 当前状态：待审核`, ['完整 Town ID t_status_recipient', '保持任务负责人、状态和执行原样']],
  ] as const;
  for (const [visible, instructions] of inputs) {
    const request = withComposerCommandContext(visible, false, undefined, undefined, 'desktop-scene', undefined, true);
    expect(stripClientMessageContext(request)).toBe(visible);
    expect(request).toContain('状态用面板里的中文名称');
    for (const instruction of instructions) expect(request).toContain(instruction);
    expect(request).not.toContain('只发 /work 时');
    expect(request).not.toContain('在同一 Being 对话按标题或派发记录定位任务');
  }
  for (const visible of [`> ${run}`, `\`\`\`md\n${run}\n\`\`\``, run.replace('after-original-run', 'invalid.request'), '[报表](beings://work/' + item + ')', '请为报表安排下一轮执行。']) {
    expect(withComposerCommandContext(visible, false)).toBe(visible);
  }
});

it('scopes Being interaction by task state without dispatching on review or progress checks', () => {
  const item = 'work_12345678-abcd-4321-9876-123456789abc';
  const scenarios: [WorkStage, string[]][] = [
    ['backlog', ['目标、规格和可验证的验收标准', '等我确认后再修改']],
    ['in_progress', [`@work status ${item}`, '结合 activeRun']],
    ['review', [`@work results ${item}`, '@work result <result_id>', 'planVersion、goalRevision', '无法核验', '只做评估']],
    ['blocked', [`@work status ${item}`, `@work results ${item}`, '等我确认再重试']],
    ['done', ['acceptedDeliveryVersion', '保持结案状态']],
    ['cancelled', [`@work results ${item}`, '保持已取消状态']],
  ];
  for (const [stage, instructions] of scenarios) {
    const text = `帮我看看 ${workDraftLink('库存看板', item, { kind: 'stage', value: stage })}。`;
    const transport = withComposerCommandContext(text, false);
    expect(stripClientMessageContext(transport)).toBe(text);
    expect(transport).toContain(`@work ${item}`);
    for (const instruction of instructions) expect(transport).toContain(instruction);
    for (const mutation of ['@work run ', '@work update ', '@work send ']) expect(transport).not.toContain(mutation);
  }
});

it('allows subagent commands without a separate client-side configuration gate', () => {
  const configure = vi.fn();
  for (const state of [{}, { subagentConfigured: false }, { subagentConfigured: true, subagentEnabled: false }]) {
    expect(canUseComposerCommand('subagent', state, configure)).toBe(true);
  }
  expect(canUseComposerCommand('subagent', { subagentConfigured: true, subagentEnabled: true }, configure)).toBe(true);
  expect(canUseComposerCommand('image', {}, configure)).toBe(true);
  expect(canUseComposerCommand('ui', {}, configure)).toBe(true);
  expect(configure).not.toHaveBeenCalled();
});
it('exposes Work and its client operations through slash commands without leaking instruction text into messages', () => {
  const text = '/work 在 Project-A 生成一份测试 HTML';
  expect(parseComposerCommands(text).commands).toEqual(['work']);
  expect(matchingComposerCommands('项目').map(command => command.id)).toEqual(['work']);
  const request = withComposerCommandContext(text, false);
  for (const executor of ['内置 Subagent（internal）', 'Codex（codex）', 'DeepSeek（deepseek）']) expect(request).toContain(executor);
  expect(request).toContain('@work agents');
  expect(request).toContain('新任务默认待办，省略未指定的属性');
  expect(request).toContain('已阻塞 blocked、已完成 done、已取消 cancelled');
  expect(request).toContain('原始日志、校验码和长路径留在工具里');
  expect(request).toContain('只在用户要求开工时派发');
  expect(request).toContain('收到各项启动回执后立即结束本轮');
  expect(request).toContain('收到 starting 就回复「正在启动」');
  expect(request).toContain('@work status <work_id> 查原派发');
  expect(request).toContain('沿用原任务和派发请求');
  expect(request).toContain('在同一 Being 对话');
  expect(request).toContain('@work results <work_id> [<work_id> ...]');
  expect(request).toContain('只查刚才开工回执中的对应任务');
  expect(request).toContain('只把回执中的 files[].path 作为本轮交付链接');
  expect(request).toContain('用户确认结案后');
  expect(request).toContain('stage 改为 done');
  expect(request).toContain('[任务标题](beings://work/<work_id>)');
  for (const operation of ['@work create', '@work run', '@work add-project', '@work artifact', '@work update', '@work automate', '@work steer', '@work retry', 'children_done', 'task_done']) expect(request).toContain(operation);
  expect(withComposerCommandContext(request, false)).toBe(request);
  expect(stripClientMessageContext(request)).toBe(text);
  const scoped = withComposerCommandContext(text, false, undefined, undefined, 'desktop-work-scene');
  expect(scoped).toContain('"scene_id":"desktop-work-scene"');
  expect(stripClientMessageContext(scoped)).toBe(text);
});

it('recognizes only explicit leading slash commands, including aliases and combinations', () => {
  expect(parseComposerCommands('/image /ui /subagent 做一张图').commands).toEqual(['image', 'ui', 'subagent']);
  expect(parseComposerCommands('/出图 /智能UI /子代理 需求').commands).toEqual(['image', 'ui', 'subagent']);
  expect(parseComposerCommands('/image /image 描述').commands).toEqual(['image']);
  for (const name of ['doc', '文档', 'html', 'md', 'markdown']) expect(parseComposerCommands('/' + name + ' 生成报告').commands).toEqual(['doc']);
  for (const text of ['解释 /image', '`/ui`', '```\n/ui\n```', '/image/example.png', '/unknown', 'https://test/ui']) {
    expect(parseComposerCommands(text).commands).toEqual([]);
    expect(withComposerCommandContext(text, false)).toBe(text);
  }
});
it('filters and inserts without losing a draft or duplicating a selected function', () => {
  expect(composerCommandQuery('/')).toBe('');
  expect(composerCommandQuery('/image /智')).toBe('智');
  expect(composerCommandQuery('正文 /ui')).toBeNull();
  expect(composerCommandQuery('/ui ')).toBeNull();
  expect(matchingComposerCommands('出图').map(command => command.id)).toEqual(['image']);
  expect(insertComposerCommand('/image /智', 'ui')).toBe('/image /ui ');
  expect(insertComposerCommand('画一只猫', 'image')).toBe('/image 画一只猫');
  expect(insertComposerCommand('/image 画一只猫', 'image')).toBe('/image 画一只猫 ');
});
it('includes the document guide only in the request and preserves the visible command', () => {
  const text = '/doc 生成 HTML 报告';
  const request = withComposerCommandContext(text, false);
  expect(request).toContain('https://beings.town/seeds/izFYd7gqLYeHwKFXQVSX3');
  expect(request).not.toContain('Intelligent UI Beta');
  expect(withComposerCommandContext(request, false)).toBe(request);
  expect(stripClientMessageContext(request)).toBe(text);
  expect(matchingComposerCommands('markdown').map(command => command.id)).toEqual(['doc']);
});

it('resolves cloud computer aliases and adds its guide only to the request', () => {
  for (const name of ['computer', '云电脑', '电脑', 'cloud']) {
    expect(parseComposerCommands(`/${name} 生成表格`).commands).toEqual(['computer']);
  }
  expect(matchingComposerCommands('云电脑').map(command => command.id)).toEqual(['computer']);
  const text = insertComposerCommand('生成表格', 'computer');
  const request = withComposerCommandContext(text, false);
  expect(request).toContain('https://beings.town/seeds/8U2i97peLWZSSLJf-QqDg');
  expect(request).not.toContain('Intelligent UI Beta');
  expect(withComposerCommandContext(request, false)).toBe(request);
  expect(stripClientMessageContext(request)).toBe('/computer 生成表格');
  const combined = withComposerCommandContext('/doc /computer 生成报告', false);
  expect(combined).toContain('用户通过 /doc');
  expect(combined).toContain('用户通过 /computer');
});

it('expands context once and strips it from display, preserving slash tokens and scene cues', () => {
  const text = withSceneTransition('/image /ui /subagent 设计', { sceneId: 'b' }, { sceneId: 'a' });
  const request = withComposerCommandContext(text, false, '{"title":"当前界面"}');
  expect(request).toContain('用户通过 /image');
  expect(request).toContain('用户通过 /subagent');
  expect(request).toContain('[客户端 Intelligent UI Beta 上下文]');
  expect(request).toContain('当前界面');
  expect(withComposerCommandContext(request, false, '{"title":"当前界面"}')).toBe(request);
  expect(stripClientMessageContext(request)).toBe(text);
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('location', new URL('https://fixture.test/loom.html?scene_id=a'));
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => setTimeout(fn, 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.spyOn(HistoryCache.prototype, 'read').mockResolvedValue(null);
  vi.spyOn(HistoryCache.prototype, 'write').mockResolvedValue();
  vi.spyOn(SceneQueueStore.prototype, 'read').mockResolvedValue([]);
  vi.spyOn(SceneQueueStore.prototype, 'write').mockResolvedValue();
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each(['a', 'b'])('keeps Work result guidance after a file-only reply in the originating scene (reply scene: %s)', async replyScene => {
  vi.stubGlobal('location', new URL('beings://chat/?scene_id=a'));
  vi.stubGlobal('parent', {});
  const received: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const route = new URL(url).pathname;
    if (route === '/api/history') return Response.json({ messages: [
      { seq: 1, role: 'assistant', scene_id: replyScene, content: '已派发 [报名页](beings://work/work_5f99bc14-a1c8-41dc-89db-6c9e80df4371)' },
      { seq: 2, role: 'user', scene_id: 'a', content: '网页可以打开了吗？' },
      { seq: 3, role: 'assistant', scene_id: 'a', content: '可以了，[报名页.html](file:///tmp/报名页.html)。' },
    ] });
    if (route === '/api/stream/active') return new Response(null, { status: 204 });
    if (route === '/api/chat/stream') {
      received.push(JSON.parse(String(init?.body)).message);
      return new Response('event: content_block_delta\ndata: {"delta":{"text":"查到了"}}\n\nevent: message_stop\ndata: {}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    }
    return Response.json({ sbs_enabled: false });
  }));
  const state = new ChatState(), runtime = createChatRuntime(state);
  const question = '刚才的报名页做好了吗？';
  try {
    await runtime.start();
    await runtime.send(question);
    await vi.advanceTimersByTimeAsync(20);
    expect(received).toHaveLength(1);
    for (const command of ['@work results <work_id>', '@work artifact', '@work update', '状态用面板里的中文名称']) {
      expect(received[0].includes(command)).toBe(replyScene === 'a');
    }
    expect(stripClientMessageContext(received[0]).endsWith(question)).toBe(true);
    expect(state.items.some(item => item.kind === 'message' && item.role === 'user' && item.text === question)).toBe(true);
  } finally { runtime.dispose(); }
});

it.each([true, false])('expands direct, interrupted and queued sends and freezes context (has snapshot: %s)', async hasSnapshot => {
  const sends: string[] = [], history: any[] = [];
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const route = new URL(input).pathname;
    if (route === '/api/history') return Response.json({ messages: history });
    if (route === '/api/stream/active') return new Response(null, { status: 204 });
    if (route === '/health') return new Response('OK fixture');
    if (route === '/api/chat/stream') {
      sends.push(JSON.parse(String(init?.body)).message);
      if (sends.length === 1) return new Response(new ReadableStream({ start(controller) { stream = controller; } }));
      if (sends.length === 2) return Response.json({ queued: true }, { status: 202 });
      return new Response('event: content_block_delta\ndata: {"delta":{"text":"完成"}}\n\nevent: message_stop\ndata: {}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    }
    return Response.json({ sbs_enabled: false });
  }));
  const state = new ChatState(), runtime = createChatRuntime(state);
  try {
    await runtime.start();
    await runtime.send('/image 猫');
    await vi.advanceTimersByTimeAsync(20);
    await runtime.send('/subagent 调研', [], { mode: 'interrupt' });
    await vi.advanceTimersByTimeAsync(20);
    expect(sends[0]).toContain('用户通过 /image');
    expect(sends[1]).toContain('用户通过 /subagent');
    if (hasSnapshot) state.intelligentUISnapshots.a = '{"title":"发送时的界面"}';
    await runtime.send('/ui 预算');
    expect(state.items.some(item => item.kind === 'message' && item.queued && item.text === '/ui 预算')).toBe(true);
    state.intelligentUISnapshots.a = '{"title":"后来切换的界面"}';
    stream?.enqueue(new TextEncoder().encode('event: content_block_delta\ndata: {"delta":{"text":"完成"}}\n\nevent: message_stop\ndata: {}\n\n'));
    stream?.close(); stream = undefined;
    await vi.advanceTimersByTimeAsync(2500);
    expect(sends[2]).toContain('[客户端 Intelligent UI Beta 上下文]');
    if (hasSnapshot) expect(sends[2]).toContain('发送时的界面');
    else expect(sends[2]).not.toContain('[客户端当前界面选择]');
    expect(sends[2]).not.toContain('后来切换的界面');
    history.push(...sends.map((content, i) => ({ seq: i + 1, role: 'user', scene_id: 'a', content })));
    history.push({ seq: 4, role: 'assistant', scene_id: 'a', content: '完成' });
    await runtime.refreshHistory();
    const users = state.items.filter(item => item.kind === 'message' && item.role === 'user');
    expect(users.map(item => item.kind === 'message' && item.text)).toEqual(['/image 猫', '/subagent 调研', '/ui 预算']);
    await runtime.send('普通消息');
    await vi.advanceTimersByTimeAsync(2500);
    expect(sends.at(-1)).toBe('普通消息');
  } finally { runtime.dispose(); try { stream?.close(); } catch {} }
});

it('validates slash UI snapshots before clearing the draft or staging a queue entry', async () => {
  const state = new ChatState(), runtime = createChatRuntime(state);
  state.draft = '/ui 修改';
  state.intelligentUISnapshots.a = 'x'.repeat(100001);
  try {
    await runtime.send(state.draft);
    expect(state.draft).toBe('/ui 修改');
    expect(state.items.some(item => item.kind === 'message' && item.role === 'system' && item.text.includes('过长'))).toBe(true);
    expect(state.items.some(item => item.kind === 'message' && item.role === 'user')).toBe(false);
  } finally { runtime.dispose(); }
});
