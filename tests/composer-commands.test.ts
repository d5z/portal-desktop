import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { canUseComposerCommand, composerCommandQuery, insertComposerCommand, matchingComposerCommands, parseComposerCommands } from '../desktop/renderer/chat/models/composer-commands';
import { withComposerCommandContext } from '../desktop/renderer/chat/services/composer-command-context';
import { stripClientMessageContext } from '../desktop/renderer/chat/services/local-file-context';
import { withSceneTransition } from '../desktop/renderer/chat/models/scenes';
import { ChatState } from '../desktop/renderer/chat/models/chat';
import { createChatRuntime } from '../desktop/renderer/chat/services/runtime';
import { SceneQueueStore } from '../desktop/renderer/chat/services/scene-queue';
import { HistoryCache } from '../desktop/renderer/chat/services/history-cache';

it('opens subagent configuration before selection when missing, unknown or disabled', () => {
  const configure = vi.fn();
  for (const state of [{}, { subagentConfigured: false }, { subagentConfigured: true, subagentEnabled: false }]) {
    expect(canUseComposerCommand('subagent', state, configure)).toBe(false);
  }
  expect(configure).toHaveBeenCalledTimes(3);
  expect(canUseComposerCommand('subagent', { subagentConfigured: true, subagentEnabled: true }, configure)).toBe(true);
  expect(canUseComposerCommand('image', {}, configure)).toBe(true);
  expect(canUseComposerCommand('ui', {}, configure)).toBe(true);
  expect(configure).toHaveBeenCalledTimes(3);
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
