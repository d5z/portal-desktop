import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatState, type ChatItem } from "../desktop/renderer/chat/models/chat";
import { inCurrentScene, messageScene, sceneItems, sceneName, sceneTransitionNotice, stripSceneTransition, withSceneTransition } from "../desktop/renderer/chat/models/scenes";
import { withScheduling } from "../desktop/renderer/chat/models/scheduling";
import { createChatRuntime } from "../desktop/renderer/chat/services/runtime";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const current = { sceneId: "desktop-test", sceneLabel: "桌面·测试机" };

describe("scene history refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("location", new URL("https://fixture.test/loom.html?scene_id=desktop-test"));
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("requestAnimationFrame", (fn: () => void) => setTimeout(fn, 16));
    vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  });

  it.each([false, true])("deduplicates a reply closed without message_stop after history catches up (new topic=%s)", async newTopic => {
    const history: { seq: number; role: string; content: string; scene_id: string }[] = [];
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    let sends = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === "/api/history") return Response.json({ messages: history.filter(m => m.seq > Number(url.searchParams.get("after") || 0)) });
      if (url.pathname === "/api/stream/active") return new Response(null, { status: 204 });
      if (url.pathname === "/health") return new Response("OK fixture");
      if (url.pathname === "/api/chat/stream") {
        sends++;
        return new Response(new ReadableStream({ start(controller) { stream = controller; } }));
      }
      return Response.json({ sbs_enabled: false });
    }));
    const state = new ChatState(), runtime = createChatRuntime(state);
    try {
      await runtime.start();
      if (newTopic) await runtime.selectScene({ sceneId: "new-topic", strict: true });
      await runtime.send("一次提问");
      await vi.advanceTimersByTimeAsync(0);
      const sceneId = state.currentScene.sceneId!;
      stream.enqueue(new TextEncoder().encode(`event: content_block_delta\ndata: ${JSON.stringify({ scene_id: sceneId, delta: { text: "完整回复" } })}\n\n`));
      stream.close();
      await vi.advanceTimersByTimeAsync(20);
      const reply = state.items.find(item => item.kind === "message" && item.role === "being");
      expect(reply).toMatchObject({ text: "完整回复", streaming: false });
      expect(state.streaming).toBe(false);
      history.push(
        { seq: 1, role: "user", content: "一次提问", scene_id: sceneId },
        { seq: 2, role: "being", content: "完整回复", scene_id: sceneId },
        { seq: 3, role: "being", content: "其他场景的独立回复", scene_id: "other-topic" },
      );
      await runtime.refreshHistory();
      await runtime.refreshHistory();
      expect(sends).toBe(1);
      expect(state.items).toContain(reply);
      expect(state.items.filter(item => item.kind === "message").map(item => item.text))
        .toEqual(["一次提问", "完整回复", "其他场景的独立回复"]);
    } finally { runtime.dispose(); }
  });

  it("deduplicates history that arrives before message_stop under a known legacy scene id", async () => {
    const history: { seq: number; role: string; content: string; scene_id: string; at?: string }[] = [];
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const event = (name: string, data: unknown) => stream.enqueue(new TextEncoder().encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`));
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === "/api/history") return Response.json({ messages: history.filter(m => m.seq > Number(url.searchParams.get("after") || 0)) });
      if (url.pathname === "/api/stream/active") return new Response(null, { status: 204 });
      if (url.pathname === "/health") return new Response("OK fixture");
      if (url.pathname === "/api/chat/stream") return new Response(new ReadableStream({ start(controller) { stream = controller; } }));
      return Response.json({ sbs_enabled: false });
    }));
    const state = new ChatState();
    state.currentScene = { sceneId: "desktop-test", legacySceneId: "loom-legacy", strict: true };
    state.activeScene = state.currentScene;
    const runtime = createChatRuntime(state);
    try {
      await runtime.start();
      const sending = runtime.send("一次提问");
      await vi.advanceTimersByTimeAsync(0);
      event("content_block_delta", { scene_id: "desktop-test", delta: { text: "同一条回复" } });
      await vi.advanceTimersByTimeAsync(20);

      history.push({ seq: 1, role: "being", content: "同一条回复", scene_id: "loom-legacy", at: "2026-09-24T17:55:15+08:00" });
      await runtime.refreshHistory();
      expect(state.items.filter(item => item.kind === "message" && item.text === "同一条回复")).toHaveLength(2);

      event("message_stop", { scene_id: "desktop-test" });
      stream.close();
      await sending;
      await vi.advanceTimersByTimeAsync(20);
      const replies = state.items.filter(item => item.kind === "message" && item.text === "同一条回复");
      expect(replies).toHaveLength(1);
      expect(replies[0]).toMatchObject({ sceneId: "desktop-test", historySeq: 1, timestamp: "17:55:15" });
    } finally { runtime.dispose(); }
  });

  it("compares the selected scene with the global previous message even when other scenes are hidden", async () => {
    vi.useRealTimers();
    vi.stubGlobal("location", new URL("beings://chat/loom.html?scene_id=desktop-test&strict_scene=1"));
    const requests: { scene_id: string; message: string }[] = [];
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      const route = new URL(input).pathname;
      if (route === "/api/history") return Response.json({ messages: [
        { seq: 1, role: "user", content: "其他场景上下文", scene_id: "other-scene" },
      ] });
      if (route === "/api/stream/active") return new Response(null, { status: 204 });
      if (route === "/health") return new Response("OK fixture");
      if (route === "/api/chat/stream") {
        requests.push({ ...JSON.parse(String(init?.body)), scene_id: new Headers(init?.headers).get("X-Portal-Scene-Id") });
        return new Response(new ReadableStream({ start(controller) { stream = controller; } }), { headers: { "Content-Type": "text/event-stream" } });
      }
      return Response.json({ sbs_enabled: false });
    }));
    const state = new ChatState(), runtime = createChatRuntime(state);
    state.subagentReady = true;
    await runtime.start();
    try {
      await runtime.selectScene({ ...current, strict: true });
      state.historyScope = "current";
      state.draft = "继续当前场景";
      expect(state.items.some(item => item.kind === "message" && item.text === "其他场景上下文")).toBe(true);
      expect(sceneItems(state.items, "current", state.currentScene).some(item => item.kind === "message" && item.text === "其他场景上下文")).toBe(false);
      const sending = runtime.send(state.draft);
      await new Promise(resolve => setTimeout(resolve, 30));
      expect(requests).toEqual([expect.objectContaining({
        scene_id: current.sceneId,
        message: "【新消息来自 scene「桌面·测试机 · ID: desktop-test」】\n\n继续当前场景",
      })]);
      expect(state.items.find(item => item.kind === "message" && item.role === "user" && item.sceneId === current.sceneId))
        .toMatchObject({ text: "继续当前场景" });
      expect(state.items.find(item => item.kind === "run" && !item.end && item.sceneId === current.sceneId))
        .toMatchObject({ context: "【新消息来自 scene「桌面·测试机 · ID: desktop-test」】" });
      stream.enqueue(new TextEncoder().encode('event: content_block_delta\ndata: {"scene_id":"desktop-test","delta":{"text":"收到"}}\n\nevent: message_stop\ndata: {"scene_id":"desktop-test"}\n\n'));
      stream.close();
      await sending;
      await new Promise(resolve => setTimeout(resolve, 30));
      expect(state.currentScene.sceneId).toBe(current.sceneId);
      expect(state.historyScope).toBe("current");
    } finally { runtime.dispose(); }
  });

  it("preserves the global cross-scene cue across a manual network retry", async () => {
    vi.stubGlobal("location", new URL("beings://chat/loom.html?scene_id=desktop-test&scene_label=桌面·测试机"));
    const requests: string[] = [];
    let online = false;
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      const route = new URL(input).pathname;
      if (route === "/api/history") return Response.json({ messages: [] });
      if (route === "/api/stream/active") return new Response(null, { status: 204 });
      if (route === "/health") return new Response("OK fixture");
      if (route === "/api/chat/stream") {
        requests.push(JSON.parse(String(init?.body)).message);
        if (!online) throw new TypeError("offline");
        return new Response('event: content_block_delta\ndata: {"scene_id":"desktop-test","delta":{"text":"收到"}}\n\nevent: message_stop\ndata: {"scene_id":"desktop-test"}\n\n', { headers: { "Content-Type": "text/event-stream" } });
      }
      return Response.json({ sbs_enabled: false });
    }));
    const state = new ChatState();
    state.items.push({
      kind: "message", id: "previous", role: "being", text: "其他场景的上一条回复",
      streaming: false, timestamp: "", label: "being", consecutive: false, sceneId: "other-scene",
    });
    const runtime = createChatRuntime(state);
    try {
      const sending = runtime.send("保留正文");
      await vi.advanceTimersByTimeAsync(0);
      expect(requests).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(requests).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(2000);
      expect(requests).toHaveLength(3);
      await vi.advanceTimersByTimeAsync(4000);
      expect(requests).toHaveLength(4);
      await sending;
      const failure = state.items.find((item): item is Extract<ChatItem, { kind: "message" }> =>
        item.kind === "message" && item.retryLabel === "重试");
      expect(failure?.retry).toBeTypeOf("function");
      online = true;
      const retrying = failure!.retry!();
      await vi.advanceTimersByTimeAsync(20);
      await retrying;
      const expected = "【新消息来自 scene「桌面·测试机 · ID: desktop-test」】\n\n保留正文";
      expect(requests).toEqual([expected, expected, expected, expected, expected]);
      expect(state.items.filter(item => item.kind === "message" && item.role === "user" && item.text === "保留正文")).toHaveLength(1);
      expect(state.items.some(item => item.kind === "message" && item.role === "user" && item.text === expected)).toBe(false);
    } finally { runtime.dispose(); }
  });

  it.each([false, true])("queues independent scenes in FIFO order without changing their visible text (subagent=%s)", async subagentReady => {
    const requests: { message: string; scene_id: string }[] = [];
    const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
    const signals: AbortSignal[] = [];
    const emit = (index: number, event: string, data: object) => streams[index].enqueue(new TextEncoder().encode(
      `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      const path = new URL(input).pathname;
      if (path === "/api/history") return Response.json({ messages: [] });
      if (path === "/api/stream/active") return new Response(null, { status: 204 });
      if (path === "/health") return new Response("OK fixture");
      if (path === "/api/chat/stream") {
        requests.push(JSON.parse(String(init?.body)));
        signals.push(init!.signal!);
        return new Response(new ReadableStream({ start(c) { streams.push(c); } }));
      }
      return Response.json({ sbs_enabled: false });
    }));
    const state = new ChatState(), runtime = createChatRuntime(state);
    state.subagentReady = subagentReady;
    try {
      await runtime.start();
      await runtime.send("A 独立任务");
      await vi.advanceTimersByTimeAsync(20);
      emit(0, "content_block_delta", { scene_id: "desktop-test", delta: { text: "A 开始" } });
      await vi.advanceTimersByTimeAsync(20);
      state.draft = "A 未发送的草稿";
      await runtime.selectScene({ sceneId: "desktop-b", strict: true });
      await runtime.send("B 独立任务");
      await runtime.selectScene({ sceneId: "desktop-c", strict: true });
      await runtime.send("C 独立任务");
      expect(requests.map(r => r.message)).toEqual(["A 独立任务"]);
      expect(state.items.filter(i => i.kind === "message" && i.queued).map(i => i.sceneId))
        .toEqual(["desktop-b", "desktop-c"]);
      expect(state.items.filter(i => i.kind === "run").map(i => i.sceneId)).toEqual(["desktop-test"]);
      expect(signals[0].aborted).toBe(false);
      emit(0, "content_block_delta", { scene_id: "desktop-test", delta: { text: " A 完成" } });
      emit(0, "message_stop", { scene_id: "desktop-test" });
      streams[0].close();
      await vi.advanceTimersByTimeAsync(2100);
      expect(requests.map(r => [r.scene_id, r.message])).toEqual([
        ["desktop-test", "A 独立任务"], ["desktop-b", "【新消息来自 scene「ID: desktop-b」】\n\nB 独立任务"],
      ]);
      expect(state.items.filter(i => i.kind === "message" && i.queued).map(i => i.sceneId)).toEqual(["desktop-c"]);
      emit(1, "content_block_delta", { scene_id: "desktop-b", delta: { text: "B 完成" } });
      emit(1, "message_stop", { scene_id: "desktop-b" });
      streams[1].close();
      await vi.advanceTimersByTimeAsync(2100);
      expect(requests[2]).toMatchObject({ scene_id: "desktop-c", message: "【新消息来自 scene「ID: desktop-c」】\n\nC 独立任务" });
      emit(2, "content_block_delta", { scene_id: "desktop-c", delta: { text: "C 完成" } });
      emit(2, "message_stop", { scene_id: "desktop-c" });
      streams[2].close();
      await vi.advanceTimersByTimeAsync(20);
      expect(state.items.flatMap(i => i.kind === "message" && i.role === "being" ? [[i.sceneId, i.text]] : []))
        .toEqual([["desktop-test", "A 开始 A 完成"], ["desktop-b", "B 完成"], ["desktop-c", "C 完成"]]);
      expect(state.items.some(i => i.kind === "message" && i.queued)).toBe(false);
      expect(state.currentScene.sceneId).toBe("desktop-c");
      await runtime.selectScene({ sceneId: "desktop-test", strict: true });
      expect(state.draft).toBe("A 未发送的草稿");
    } finally {
      for (const stream of streams) { try { stream.close(); } catch {} }
      await vi.advanceTimersByTimeAsync(0);
      runtime.dispose();
    }
  });

  it("refreshes empty history without replacing a live reply, and retries failed reads", async () => {
    let history: { seq: number; role: string; content: string; scene_id: string }[] = [];
    let failHistory = false;
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const event = (text: string) => stream.enqueue(new TextEncoder().encode(`event: content_block_delta\ndata: ${JSON.stringify({ delta: { text } })}\n\n`));
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const path = new URL(input).pathname;
      if (path === "/api/history") return Response.json({ messages: history }, { status: failHistory ? 503 : 200 });
      if (path === "/api/stream/active") return new Response(null, { status: 204 });
      if (path === "/health") return new Response("OK fixture");
      if (path === "/api/chat/stream") return new Response(new ReadableStream({ start(controller) { stream = controller; event("正在回复"); } }));
      return Response.json({ sbs_enabled: false });
    }));
    const state = new ChatState(), runtime = createChatRuntime(state);
    state.subagentReady = true;
    await runtime.start();
    const sending = runtime.send("本地输入");
    await vi.advanceTimersByTimeAsync(20);
    try {
      const reply = state.items.find(item => item.kind === "message" && item.streaming);
      expect(reply).toBeDefined();
      const resetScroll = state.resetScroll;
      state.draft = "未发送的草稿";
      state.historyScope = "all";
      history = [
        { seq: 1, role: "user", content: "本地输入", scene_id: "desktop-test" },
        { seq: 2, role: "being", content: "网页新增的对话", scene_id: "loom-Willow" },
      ];
      failHistory = true;
      await runtime.refreshHistory();
      expect(state.items).toContain(reply);
      failHistory = false;
      await runtime.refreshHistory();
      await runtime.refreshHistory();
      expect(state.items.filter(item => item.kind === "message").map(item => item.text)).toEqual(["本地输入", "正在回复", "网页新增的对话"]);
      expect(state.items).toContain(reply);
      expect(state.draft).toBe("未发送的草稿");
      expect(state.resetScroll).toBe(resetScroll);
      expect(state.streaming).toBe(true);
      event("，继续生成");
      await vi.advanceTimersByTimeAsync(20);
      expect(reply).toMatchObject({ text: "正在回复，继续生成", streaming: true });
    } finally { stream.close(); await sending; runtime.dispose(); }
  });

  it("switches sessions without cancelling a stream, preserves drafts and filters strictly", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const path = new URL(input).pathname;
      if (path === "/api/history") return Response.json({ messages: [] });
      if (path === "/api/stream/active") return new Response(null, { status: 204 });
      if (path === "/health") return new Response("OK fixture");
      if (path === "/api/chat/stream") return new Response(new ReadableStream({ start(controller) {
        stream = controller;
        stream.enqueue(new TextEncoder().encode('event: content_block_delta\ndata: {"scene_id":"desktop-test","delta":{"text":"A 回复"}}\n\n'));
      } }));
      return Response.json({ sbs_enabled: false });
    }));
    const state = new ChatState(), runtime = createChatRuntime(state);
    state.subagentReady = true;
    await runtime.start();
    const sending = runtime.send("A 输入");
    await vi.advanceTimersByTimeAsync(20);
    state.draft = "A 草稿";
    await runtime.selectScene({ sceneId: "desktop-b", sceneLabel: "B", strict: true });
    expect(state.draft).toBe("");
    expect(state.streaming).toBe(true);
    expect(sceneItems(state.items, "current", state.currentScene)).toEqual([]);
    state.draft = "B 草稿";
    await runtime.selectScene({ ...current, strict: true });
    expect(state.draft).toBe("A 草稿");
    stream.enqueue(new TextEncoder().encode('event: content_block_delta\ndata: {"scene_id":"desktop-test","delta":{"text":"继续"}}\n\n'));
    await vi.advanceTimersByTimeAsync(20);
    expect(state.items.some(item => item.kind === "message" && item.text === "A 回复继续")).toBe(true);
    await runtime.selectScene({ sceneId: "desktop-b", strict: true });
    expect(state.draft).toBe("B 草稿");
    expect(inCurrentScene({}, state.currentScene)).toBe(false);
    stream.close(); await sending; runtime.dispose();
  });

  it("cancels a locally queued B message without interrupting A's stream", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    let signal!: AbortSignal;
    const requests: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      const path = new URL(input).pathname;
      if (path === "/api/history") return Response.json({ messages: [] });
      if (path === "/api/stream/active") return new Response(null, { status: 204 });
      if (path === "/health") return new Response("OK fixture");
      if (path === "/api/chat/stream") {
        requests.push(JSON.parse(String(init?.body)));
        signal = init!.signal!;
        return new Response(new ReadableStream({ start(c) { stream = c; } }));
      }
      return Response.json({ sbs_enabled: false });
    }));
    const state = new ChatState(), runtime = createChatRuntime(state);
    try {
      await runtime.start(); await runtime.send("A 输入");
      await vi.advanceTimersByTimeAsync(20);
      await runtime.selectScene({ sceneId: "desktop-b", strict: true });
      await runtime.send("B 输入");
      const queued = state.items.find(i => i.kind === "message" && i.queued);
      expect(queued).toMatchObject({ sceneId: "desktop-b", text: "B 输入" });
      if (queued?.kind !== "message") throw new Error("Missing queued message");
      expect(queued.cancelQueued).toBeTypeOf("function");
      await queued.cancelQueued!();
      expect(state.items).not.toContain(queued);
      expect(signal.aborted).toBe(false);
      stream.enqueue(new TextEncoder().encode('event: content_block_delta\ndata: {"scene_id":"desktop-test","delta":{"text":"A 仍继续"}}\n\nevent: message_stop\ndata: {"scene_id":"desktop-test"}\n\n'));
      stream.close();
      await vi.advanceTimersByTimeAsync(2100);
      expect(requests).toHaveLength(1);
      expect(state.items.find(i => i.kind === "message" && i.text === "A 仍继续"))
        .toMatchObject({ sceneId: "desktop-test", streaming: false });
    } finally { try { stream?.close(); } catch {} runtime.dispose(); }
  });

  it("does not create a desktop run just for polling another scene's active stream", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const path = new URL(input).pathname;
      if (path === "/api/history") return Response.json({ messages: [] });
      if (path === "/health") return new Response("OK fixture");
      if (path === "/api/stream/active") return Response.json({
        stream_id: "feishu-active", origin: "human", finished: false,
        events: [
          { seq: 1, event: "reasoning", data: { scene_id: "feishu-weiguo_being", text: "thinking" } },
          { seq: 2, event: "tool_use", data: { scene_id: "feishu-weiguo_being", name: "portal_exec", input: {} } },
        ],
      });
      return Response.json({ sbs_enabled: false });
    }));
    const state = new ChatState(), runtime = createChatRuntime(state);
    state.subagentReady = true;
    try {
      await runtime.start();
      await vi.advanceTimersByTimeAsync(1100);
      const runs = state.items.filter(i => i.kind === "run");
      expect(runs).toHaveLength(1);
      expect(runs[0].sceneId).toBe("feishu-weiguo_being");
    } finally { runtime.dispose(); }
  });

  it("routes interleaved text, tools and errors before updating scene state", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const emit = (type: string, scene: string, data: object = {}) => stream.enqueue(new TextEncoder().encode(
      `event: ${type}\ndata: ${JSON.stringify({ scene_id: scene, ...data })}\n\n`));
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const path = new URL(input).pathname;
      if (path === "/api/history") return Response.json({ messages: [] });
      if (path === "/api/stream/active") return new Response(null, { status: 204 });
      if (path === "/health") return new Response("OK fixture");
      if (path === "/api/chat/stream") return new Response(new ReadableStream({ start(c) { stream = c; } }));
      return Response.json({ sbs_enabled: false });
    }));
    const state = new ChatState(), runtime = createChatRuntime(state);
    state.subagentReady = true;
    await runtime.start();
    const sending = runtime.send("A 输入");
    await vi.advanceTimersByTimeAsync(20);
    try {
      emit("content_block_delta", "desktop-test", { delta: { text: "A1" } });
      emit("tool_use", "desktop-b", { name: "portal_exec", input: { command: "B tool" } });
      emit("content_block_delta", "desktop-b", { delta: { text: "B1" } });
      emit("tool_result", "desktop-b", { name: "portal_exec", content: "B result" });
      emit("error", "desktop-b", { message: "B failed" });
      emit("content_block_delta", "desktop-test", { delta: { text: "A2" } });
      await vi.advanceTimersByTimeAsync(20);
      expect(state.items.filter((i): i is Extract<ChatItem, { kind: "message" }> => i.kind === "message" && i.role === "being").map(i => [i.sceneId, i.text]))
        .toEqual([["desktop-test", "A1A2"], ["desktop-b", "B1"]]);
      expect(state.items.find(i => i.kind === "message" && i.role === "system")).toMatchObject({ sceneId: "desktop-b", text: "⚠ B failed" });
      const bRun = state.items.find(i => i.kind === "run" && i.sceneId === "desktop-b");
      expect(bRun).toMatchObject({ entries: [expect.objectContaining({ name: "portal_exec", done: true })] });
      expect(state.items.filter(i => i.kind === "run" && i.sceneId === "desktop-test").every(i => i.kind === "run" && i.entries.every(e => e.name !== "portal_exec"))).toBe(true);
      emit("message_stop", "desktop-test");
    } finally { stream.close(); await sending; runtime.dispose(); }
  });

  it("routes tagged reasoning to C and ignores repeated stops without creating empty runs", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const c = "desktop-ab7ce9b8-0aac-4980-be1b-fd722e20b040";
    const emit = (event: string, data: object) => stream.enqueue(new TextEncoder().encode(
      `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const path = new URL(input).pathname;
      if (path === "/api/history") return Response.json({ messages: [] });
      if (path === "/api/stream/active") return new Response(null, { status: 204 });
      if (path === "/health") return new Response("OK fixture");
      if (path === "/api/chat/stream") return new Response(new ReadableStream({ start(controller) { stream = controller; } }));
      return Response.json({ sbs_enabled: false });
    }));
    const state = new ChatState(), runtime = createChatRuntime(state);
    state.subagentReady = true;
    await runtime.start();
    const sending = runtime.send("A input");
    await vi.advanceTimersByTimeAsync(20);
    try {
      await runtime.selectScene({ sceneId: "desktop-b", strict: true });
      emit("reasoning", { scene_id: c, text: "Ben" });
      await vi.advanceTimersByTimeAsync(220);
      const runs = () => state.items.filter((i): i is Extract<ChatItem, {kind:"run"}> => i.kind === "run" && i.sceneId === c);
      expect(runs()).toHaveLength(1);
      expect(runs()[0].entries).toEqual([expect.objectContaining({ text: "Ben" })]);
      expect(sceneItems(state.items, "current", state.currentScene)).toEqual([]);
      await runtime.selectScene({ sceneId: c, strict: true });
      expect(sceneItems(state.items, "current", state.currentScene)).toContain(runs()[0]);
      emit("message_stop", { scene_id: c });
      await vi.advanceTimersByTimeAsync(20);
      emit("message_stop", { scene_id: c });
      emit("message_stop", { scene_id: "desktop-b" });
      await vi.advanceTimersByTimeAsync(20);
      expect(runs()).toHaveLength(1);
      expect(state.items.filter(i => i.kind === "run" && i.sceneId === "desktop-b")).toHaveLength(0);
    } finally { stream.close(); await sending; runtime.dispose(); }
  });

  it("stops A without sending a stop for locally queued B", async () => {
    const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
    const signals: AbortSignal[] = [];
    const stops: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      const path = new URL(input).pathname;
      if (path === "/api/history") return Response.json({ messages: [] });
      if (path === "/api/stream/active") return new Response(null, { status: 204 });
      if (path === "/health") return new Response("OK fixture");
      if (path === "/api/stop") { stops.push(JSON.parse(init!.body as string)); return Response.json({ ok: true }); }
      if (path === "/api/chat/stream") return new Response(new ReadableStream({ start(c) {
        const index = streams.length;
        streams.push(c); signals.push(init!.signal!);
        init!.signal!.addEventListener("abort", () => c.error(new DOMException("Aborted", "AbortError")));
        c.enqueue(new TextEncoder().encode(`event: meta\ndata: ${JSON.stringify({ stream_id: index ? "stream-b" : "stream-a", scene_id: index ? "desktop-b" : "desktop-test" })}\n\n`));
      } }));
      return Response.json({ sbs_enabled: false });
    }));
    const state = new ChatState(), runtime = createChatRuntime(state);
    state.subagentReady = true;
    await runtime.start();
    const a = runtime.send("A 输入");
    await vi.advanceTimersByTimeAsync(20);
    await runtime.selectScene({ sceneId: "desktop-b", strict: true });
    const b = runtime.send("B 输入");
    await vi.advanceTimersByTimeAsync(20);
    try {
      await runtime.stopCurrentTurn(); await b;
      expect(stops).toEqual([]);
      expect(streams).toHaveLength(1);
      expect(signals[0].aborted).toBe(false);
      streams[0].enqueue(new TextEncoder().encode('event: content_block_delta\ndata: {"scene_id":"desktop-test","delta":{"text":"A 仍继续"}}\n\n'));
      await vi.advanceTimersByTimeAsync(20);
      expect(state.items.some(i => i.kind === "message" && i.text === "A 仍继续")).toBe(true);
      await runtime.selectScene({ sceneId: "desktop-test", strict: true });
      await runtime.stopCurrentTurn();
      expect(stops).toEqual([{ stream_id: "stream-a" }]);
      expect(signals[0].aborted).toBe(true);
    } finally { try { streams[0].close(); } catch {} await a; runtime.dispose(); }
  });

  it("keeps local C queued until server-accepted B receives its history reply", async () => {
    const history: object[] = [];
    const requests: { message: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      const path = new URL(input).pathname;
      if (path === "/api/history") return Response.json({ messages: history });
      if (path === "/api/stream/active") return new Response(null, { status: 204 });
      if (path === "/health") return new Response("OK fixture");
      if (path === "/api/chat/stream") {
        requests.push(JSON.parse(String(init?.body)));
        return Response.json({ queued: true }, { status: 202 });
      }
      return Response.json({ sbs_enabled: false });
    }));
    const state = new ChatState(), runtime = createChatRuntime(state);
    try {
      await runtime.start();
      await runtime.selectScene({ sceneId: "desktop-b", strict: true });
      await runtime.send("B 输入");
      await vi.advanceTimersByTimeAsync(20);
      await runtime.selectScene({ sceneId: "desktop-c", strict: true });
      await runtime.send("C 输入");
      expect(requests.map(r => r.message)).toEqual(["B 输入"]);
      expect(state.items.find(i => i.kind === "run" && i.sceneId === "desktop-b"))
        .toMatchObject({ label: "已排队，等待回复" });
      expect(state.items.find(i => i.kind === "message" && i.text === "C 输入"))
        .toMatchObject({ queued: true });
      history.push({ seq: 1, role: "user", content: "B 输入", scene_id: "desktop-b" },
        { seq: 2, role: "being", content: "B 排队回复", scene_id: "desktop-b" });
      await vi.advanceTimersByTimeAsync(4100);
      expect(requests.map(r => r.message)).toEqual([
        "B 输入", "【新消息来自 scene「ID: desktop-c」】\n\nC 输入",
      ]);
      expect(state.items.filter(i => i.kind === "message" && i.text === "B 输入")).toHaveLength(1);
      expect(state.items.filter(i => i.kind === "message" && i.text === "B 排队回复")).toHaveLength(1);
      expect(state.items.find(i => i.kind === "run" && i.sceneId === "desktop-b")).toMatchObject({ outcome: "done" });
      expect(state.items.find(i => i.kind === "run" && i.sceneId === "desktop-c"))
        .toMatchObject({ label: "已排队，等待回复" });
    } finally { runtime.dispose(); }
  });

  it.each([
    { replyScene: undefined, strict: false }, { replyScene: "loom-legacy", strict: false },
    { replyScene: undefined, strict: true }, { replyScene: "loom-legacy", strict: true },
  ])("settles compatible history replies without crossing strict scenes ($replyScene, strict=$strict)", async ({ replyScene, strict }) => {
    const history: object[] = [];
    const requests: { message: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      const path = new URL(input).pathname;
      if (path === "/api/history") return Response.json({ messages: history });
      if (path === "/api/stream/active") return new Response(null, { status: 204 });
      if (path === "/health") return new Response("OK fixture");
      if (path === "/api/chat/stream") {
        requests.push(JSON.parse(String(init?.body)));
        return Response.json({ queued: true }, { status: 202 });
      }
      return Response.json({ sbs_enabled: false });
    }));
    const state = new ChatState();
    state.currentScene = { ...state.currentScene, legacySceneId: "loom-legacy", strict };
    const runtime = createChatRuntime(state);
    try {
      await runtime.start();
      await runtime.send("A 输入");
      await vi.advanceTimersByTimeAsync(20);
      await runtime.selectScene({ sceneId: "desktop-b", strict: true });
      await runtime.send("B 输入");
      expect(requests.map(r => r.message)).toEqual(["A 输入"]);
      history.push({ seq: 1, role: "being", content: "A 旧格式回复", ...(replyScene ? { scene_id: replyScene } : {}) });
      await vi.advanceTimersByTimeAsync(4100);
      expect(state.items.some(item => item.kind === "message" && item.text === "A 旧格式回复")).toBe(true);
      if (strict) {
        expect(requests.map(r => r.message)).toEqual(["A 输入"]);
        expect(state.items.find(item => item.kind === "run" && item.sceneId === "desktop-test")).toMatchObject({ label: "已排队，等待回复", waitingForReply: true });
        history.push({ seq: 2, role: "being", content: "A 场景回复", scene_id: "desktop-test" });
        await vi.advanceTimersByTimeAsync(4100);
      }
      expect(state.items.find(item => item.kind === "run" && item.sceneId === "desktop-test")).toMatchObject({ outcome: "done", label: "已回复" });
      expect(requests.map(r => r.message)).toEqual([
        "A 输入",
        replyScene || strict ? "【新消息来自 scene「ID: desktop-b」】\n\nB 输入" : "B 输入",
      ]);
    } finally { runtime.dispose(); }
  });

  it("keeps an accepted A request pending when Heart emits an empty stop then switches to B", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const emit = (event: string, scene: string, data: object = {}) => stream.enqueue(new TextEncoder().encode(
      `event: ${event}\ndata: ${JSON.stringify({scene_id:scene,...data})}\n\n`));
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const path = new URL(input).pathname;
      if (path === "/api/history") return Response.json({ messages: [] });
      if (path === "/api/stream/active") return new Response(null, { status: 204 });
      if (path === "/health") return new Response("OK fixture");
      if (path === "/api/chat/stream") return new Response(new ReadableStream({start(c) {stream=c;}}));
      return Response.json({sbs_enabled:false});
    }));
    const state = new ChatState(), runtime = createChatRuntime(state);
    state.subagentReady = true;
    await runtime.start(); const sending = runtime.send("A request");
    await vi.advanceTimersByTimeAsync(20);
    try {
      emit("reasoning","desktop-test",{text:"progress"});
      emit("message_stop","desktop-test");
      emit("content_block_delta","desktop-b",{delta:{text:"B response"}});
      emit("message_stop","desktop-b");
      await vi.advanceTimersByTimeAsync(2000);
      const runs = state.items.filter((i): i is Extract<ChatItem, {kind:"run"}> => i.kind==="run" && i.sceneId==="desktop-test");
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({label:"等待处理中",waitingForReply:true});
      expect(runs[0].end).toBeUndefined();
      emit("content_block_delta","desktop-test",{delta:{text:"A response"}});
      emit("message_stop","desktop-test");
      await vi.advanceTimersByTimeAsync(20);
    } finally {stream.close(); await sending; runtime.dispose();}
    expect(state.items.filter((i): i is Extract<ChatItem, {kind:"run"}> => i.kind==="run" && i.sceneId==="desktop-test")).toHaveLength(1);
    expect(state.items.find(i=>i.kind==="message" && i.text==="A response")).toMatchObject({sceneId:"desktop-test",streaming:false});
  });

  it("counts scene continuation meta in the recovery replay cursor", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    let recovering = false;
    const cursors: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === "/api/history") return Response.json({messages:[]});
      if (url.pathname === "/health") return new Response("OK fixture");
      if (url.pathname === "/api/stream/active") {
        if (!recovering) return new Response(null,{status:204});
        if (url.searchParams.has("after")) cursors.push(url.searchParams.get("after")!);
        return Response.json({stream_id:"shared-r2",next_seq:9,finished:url.searchParams.has("after"),events:[]});
      }
      if (url.pathname === "/api/chat/stream") return new Response(new ReadableStream({start(c){stream=c;}}));
      return Response.json({sbs_enabled:false});
    }));
    const state = new ChatState(), runtime = createChatRuntime(state);
    state.subagentReady = true;
    await runtime.start(); const sending = runtime.send("A cursor test");
    await vi.advanceTimersByTimeAsync(20);
    try {
      const events = [
        ["meta",{stream_id:"shared-r2",scene_id:"desktop-test"}],
        ["reasoning",{scene_id:"desktop-test",text:"working"}],
        ["message_stop",{scene_id:"desktop-test"}],
        ["meta",{continuation:true,scene_id:"desktop-b"}],
        ["reasoning",{scene_id:"desktop-b",text:"working"}],
        ["message_stop",{scene_id:"desktop-b"}],
        ["meta",{continuation:true,scene_id:"desktop-c"}],
        ["content_block_delta",{scene_id:"desktop-c",delta:{text:"C"}}],
      ];
      for (const [event,data] of events) stream.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      await vi.advanceTimersByTimeAsync(20);
      recovering = true; stream.error(new TypeError("connection lost")); await sending;
      await vi.advanceTimersByTimeAsync(1000);
      expect(cursors[0]).toBe("7");
    } finally {runtime.dispose();}
  });

  it("does not call an empty SSE response completed and reports a waiting timeout", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const path = new URL(input).pathname;
      if (path === "/api/history") return Response.json({ messages: [] });
      if (path === "/api/stream/active") return new Response(null, { status: 204 });
      if (path === "/health") return new Response("OK fixture");
      if (path === "/api/chat/stream") return new Response("");
      return Response.json({ sbs_enabled: false });
    }));
    const state = new ChatState(), runtime = createChatRuntime(state);
    state.subagentReady = true;
    try {
      await runtime.start(); await runtime.send("空流测试");
      await vi.advanceTimersByTimeAsync(0);
      const runs = state.items.filter(i => i.kind === "run");
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ label: "等待回复", waitingForReply: true });
      expect(runs[0].end).toBeUndefined();
      await vi.advanceTimersByTimeAsync(300_100);
      expect(runs[0]).toMatchObject({ label: "等待回复超时", outcome: "error" });
      expect(state.items.filter(i => i.kind === "run")).toHaveLength(1);
    } finally { runtime.dispose(); }
  });

  it("starts a fresh read after initialization and every queued switch, using the latest cursor", async () => {
    const history = [{ seq: 1, role: "user", content: "初始记录", scene_id: "desktop-test" }];
    const reads: { after: number; finish(): void }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === "/api/history") {
        const after = Number(url.searchParams.get("after") || 0);
        const messages = history.filter(row => row.seq > after);
        return new Promise<Response>(resolve => reads.push({ after, finish: () => resolve(Response.json({ messages })) }));
      }
      if (url.pathname === "/api/stream/active") return new Response(null, { status: 204 });
      if (url.pathname === "/health") return new Response("OK fixture");
      return Response.json({ sbs_enabled: false });
    }));
    const state = new ChatState(), runtime = createChatRuntime(state);
    state.subagentReady = true;
    try {
      const starting = runtime.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(reads).toHaveLength(1);
      const firstSwitch = runtime.refreshHistory();
      history.push({ seq: 2, role: "being", content: "网页最新记录", scene_id: "loom-Willow" });
      reads[0].finish();
      await vi.advanceTimersByTimeAsync(20);
      await starting;
      expect(reads.map(read => read.after)).toEqual([0, 1]);
      state.historyScope = "current";
      const secondSwitch = runtime.refreshHistory();
      history.push({ seq: 3, role: "being", content: "桌面最新记录", scene_id: "desktop-test" });
      reads[1].finish();
      await firstSwitch;
      await vi.advanceTimersByTimeAsync(0);
      expect(reads.map(read => read.after)).toEqual([0, 1, 2]);
      reads[2].finish();
      await secondSwitch;
      expect(state.items.filter(item => item.kind === "message").map(item => item.text)).toEqual(["初始记录", "网页最新记录", "桌面最新记录"]);
      expect(sceneItems(state.items, state.historyScope, current).filter(item => item.kind === "message").map(item => item.text)).toEqual(["初始记录", "桌面最新记录"]);
    } finally { runtime.dispose(); }
  });
});

describe("chat scene scopes", () => {
  it("adds an idempotent wire-only cue only when consecutive scene IDs differ", () => {
    const text = "保留自定义正文\n和格式";
    const changed = withSceneTransition(text, { sceneId: "b", sceneLabel: "讨论 B" }, { sceneId: "a" });
    expect(changed).toBe("【新消息来自 scene「讨论 B · ID: b」】\n\n" + text);
    expect(sceneTransitionNotice(changed)).toBe("【新消息来自 scene「讨论 B · ID: b」】");
    expect(stripSceneTransition(changed)).toBe(text);
    expect(withSceneTransition(changed, { sceneId: "b", sceneLabel: "讨论 B" }, { sceneId: "a" })).toBe(changed);
    expect(withSceneTransition(text, { sceneId: "b" }, { sceneId: "b" })).toBe(text);
    expect(withSceneTransition(text, { sceneId: "b" }, {})).toBe(text);
  });

  it("shares Loom's legacy-message rule while preserving all scenes", () => {
    const items: ChatItem[] = [
      { kind: "separator", id: "local", text: "local", ...current },
      { kind: "separator", id: "web", text: "web", sceneId: "loom-Willow" },
      { kind: "separator", id: "legacy", text: "legacy" },
      { kind: "separator", id: "autonomous", text: "breath", marker: true },
    ];
    expect(sceneItems(items, "current", current).map(item => item.id)).toEqual(["local", "legacy", "autonomous"]);
    expect(sceneItems(items, "all", current)).toBe(items);
    expect(sceneItems(items, "current", {})).toBe(items);
    expect(inCurrentScene({ sceneId: "desktop-test-other" }, current)).toBe(false);
    expect(inCurrentScene(messageScene({ scene_id: "desktop-test " }), current)).toBe(false);
  });

  it("reads only scene identity and display labels from protocol metadata", () => {
    expect(messageScene({ scene_id: "loom-Willow", scene_meta: { scene_label: "Loom", token: "secret" }, trace_id: "trace" }))
      .toEqual({ sceneId: "loom-Willow", sceneLabel: "Loom" });
    expect(messageScene({ scene_id: null, scene_label: "not an identity" })).toEqual({});
    expect(sceneName({ sceneId: "desktop-test" }, current)).toBe("桌面·测试机");
    expect(sceneName({}, current)).toBe("未标记场景");
  });

  it("defaults to the supplied current room and keeps unconfigured clients in all scenes", () => {
    vi.stubGlobal("location", new URL("beings://chat/?scene_id=desktop-test&scene_label=桌面·测试机"));
    expect(new ChatState().currentScene).toEqual(current);
    expect(new ChatState().historyScope).toBe("current");
    vi.stubGlobal("location", new URL("beings://chat/?scene_id=desktop-test&scene_scope=all"));
    expect(new ChatState().historyScope).toBe("all");
    vi.stubGlobal("location", new URL("beings://chat/?scene_id=desktop-test&scene_scope=current"));
    expect(new ChatState().historyScope).toBe("current");
    vi.stubGlobal("location", new URL("beings://chat/?scene_scope=current"));
    expect(new ChatState().historyScope).toBe("all");
    vi.stubGlobal("location", new URL("https://fixture.test/loom.html"));
    expect(new ChatState().historyScope).toBe("all");
  });

  it("retains history from other scenes and never merges cross-scene live continuations", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("location", new URL("https://fixture.test/loom.html?scene_id=desktop-test&scene_label=桌面·测试机"));
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("requestAnimationFrame", (fn: () => void) => setTimeout(fn, 16));
    vi.stubGlobal("cancelAnimationFrame", clearTimeout);
    const history = [
      { seq: 1, role: "user", content: "桌面对话", scene_id: "desktop-test" },
      { seq: 2, role: "being", content: "网页对话", scene_id: "loom-Willow", scene_meta: { scene_label: "Loom" } },
      { seq: 3, role: "being", content: "旧消息" },
    ];
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const event = (name: string, data: unknown) => stream.enqueue(new TextEncoder().encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`));
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === "/api/history") return Response.json({ messages: history.filter(m => m.seq > Number(url.searchParams.get("after") || 0)) });
      if (url.pathname === "/api/stream/active") return new Response(null, { status: 204 });
      if (url.pathname === "/health") return new Response("OK fixture");
      if (url.pathname === "/api/chat/stream") {
        history.push({ seq: 4, role: "user", content: "相同输入", scene_id: "loom-Willow" });
        history.push({ seq: 5, role: "user", content: "相同输入", scene_id: "desktop-test" });
        return new Response(new ReadableStream({ start(controller) {
          stream = controller;
          event("meta", { stream_id: "mixed", scene_id: "desktop-test" });
          event("thinking", { text: "桌面思考", scene_id: "desktop-test" });
          event("content_block_delta", { delta: { text: "桌面回复" }, scene_id: "desktop-test" });
        } }), { headers: { "Content-Type": "text/event-stream" } });
      }
      return Response.json({ sbs_enabled: false });
    }));
    const state = new ChatState(), runtime = createChatRuntime(state);
    state.subagentReady = true;
    try {
      const starting = runtime.start();
      await vi.advanceTimersByTimeAsync(50); await starting;
      expect(sceneItems(state.items, "current", current).filter(item => item.kind === "message").map(item => item.text)).toEqual(["桌面对话", "旧消息"]);
      expect(state.items.find(item => item.kind === "message" && item.text === "网页对话")?.sceneLabel).toBe("Loom");
      const sending = runtime.send("相同输入");
      await vi.advanceTimersByTimeAsync(50);
      expect(state.items.filter(item => item.kind === "message" && item.text === "相同输入").map(item => item.sceneId).sort()).toEqual(["desktop-test", "loom-Willow"]);
      event("usage", { scene_id: null, input_tokens: 10 });
      await vi.advanceTimersByTimeAsync(20);
      expect(state.activeScene.sceneId).toBe("desktop-test");
      // A scene change without an intervening stop must still split the bubble and activity.
      event("meta", { scene_id: "loom-Willow" });
      event("thinking", { text: "网页思考", scene_id: "loom-Willow" });
      event("content_block_delta", { delta: { text: "其他场景回复" }, scene_id: "loom-Willow" });
      event("message_stop", { scene_id: "loom-Willow" });
      event("content_block_delta", { delta: { text: "共享自主消息" }, scene_id: null });
      event("message_stop", { scene_id: null });
      stream.close();
      await sending; await vi.advanceTimersByTimeAsync(50);
      const replies = state.items.filter(item => item.kind === "message");
      expect(replies.find(item => item.text === "桌面回复")?.sceneId).toBe("desktop-test");
      expect(replies.find(item => item.text === "其他场景回复")?.sceneId).toBe("loom-Willow");
      expect(replies.find(item => item.text === "共享自主消息")?.sceneId).toBeUndefined();
      expect(replies.some(item => item.text.includes("桌面回复其他场景"))).toBe(false);
      expect(state.items.filter(item => item.kind === "run").map(item => item.sceneId)).toContain("loom-Willow");
      expect(sceneItems(state.items, "current", current).filter(item => item.kind === "message").map(item => item.text)).not.toContain("其他场景回复");
    } finally { runtime.dispose(); }
  });

  it("retains scene boundaries when replaying a shared stream", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("location", new URL("https://fixture.test/loom.html?scene_id=desktop-test"));
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("requestAnimationFrame", (fn: () => void) => setTimeout(fn, 16));
    vi.stubGlobal("cancelAnimationFrame", clearTimeout);
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const path = new URL(input).pathname;
      if (path === "/api/history") return Response.json({ messages: [] });
      if (path === "/health") return new Response("OK fixture");
      if (path === "/api/stream/active") return Response.json({
        stream_id: "replay-scenes", origin: "human", finished: false,
        events: [
          { seq: 1, event: "content_block_delta", data: { scene_id: "desktop-test", delta: { text: "桌面重放" } } },
          { seq: 2, event: "content_block_delta", data: { scene_id: "loom-Willow", delta: { text: "网页重放" } } },
          { seq: 3, event: "message_stop", data: { scene_id: "loom-Willow" } },
          { seq: 4, event: "content_block_delta", data: { scene_id: null, delta: { text: "共享重放" } } },
        ],
      });
      return Response.json({ sbs_enabled: false });
    }));
    const state = new ChatState(), runtime = createChatRuntime(state);
    state.subagentReady = true;
    try {
      await runtime.start();
      expect(state.items.filter(item => item.kind === "message").map(item => [item.text, item.sceneId])).toEqual([
        ["桌面重放", "desktop-test"], ["网页重放", "loom-Willow"], ["共享重放", undefined],
      ]);
      expect(sceneItems(state.items, "current", current).filter(item => item.kind === "message").map(item => item.text)).toEqual(["桌面重放", "共享重放"]);
    } finally { runtime.dispose(); }
  });
});
