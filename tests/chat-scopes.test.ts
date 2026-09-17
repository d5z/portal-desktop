import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatState, type ChatItem } from "../desktop/renderer/chat/models/chat";
import { inCurrentScene, messageScene, sceneItems, sceneName } from "../desktop/renderer/chat/models/scenes";
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
    try {
      const starting = runtime.start();
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
    try {
      await runtime.start();
      expect(state.items.filter(item => item.kind === "message").map(item => [item.text, item.sceneId])).toEqual([
        ["桌面重放", "desktop-test"], ["网页重放", "loom-Willow"], ["共享重放", undefined],
      ]);
      expect(sceneItems(state.items, "current", current).filter(item => item.kind === "message").map(item => item.text)).toEqual(["桌面重放", "共享重放"]);
    } finally { runtime.dispose(); }
  });
});
