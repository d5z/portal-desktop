import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatState, type Message } from "../desktop/renderer/chat/models/chat";
import { createChatRuntime } from "../desktop/renderer/chat/services/runtime";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("stream progress and persisted replies", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-10-09T06:49:00Z");
    vi.stubGlobal("location", new URL("https://fixture.test/loom.html?scene_id=desktop-test"));
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("requestAnimationFrame", (fn: () => void) => setTimeout(fn, 16));
    vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  });

  function fixture() {
    const history: any[] = [];
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === "/api/history") return Response.json({ messages: history.filter(m => m.seq > Number(url.searchParams.get("after") || 0)) });
      if (url.pathname === "/api/stream/active") return new Response(null, { status: 204 });
      if (url.pathname === "/health") return new Response("OK fixture");
      if (url.pathname === "/api/chat/stream") return new Response(new ReadableStream({ start(controller) { stream = controller; } }));
      return Response.json({ sbs_enabled: false });
    }));
    const state = new ChatState(), runtime = createChatRuntime(state);
    return { state, runtime, history,
      event: (event: string, data: object) => stream.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify({ scene_id: "desktop-test", ...data })}\n\n`)),
      close: () => stream.close(),
      replies: () => state.items.filter((item): item is Message => item.kind === "message" && item.role === "being"),
    };
  }

  it('uses the selected history limit and fills gaps even when the server caps pages', async () => {
    const history = [{ seq: 1, role: 'user', content: 'initial', scene_id: 'desktop-test' }];
    const queries: URL[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === '/api/history') {
        queries.push(url);
        const after = url.searchParams.get('after');
        return Response.json({ messages: after === null ? history.slice(-Number(url.searchParams.get('limit'))) :
          history.filter(m => m.seq > Number(after)).slice(0, 10) });
      }
      if (url.pathname === '/api/stream/active') return new Response(null, { status: 204 });
      if (url.pathname === '/health') return new Response('OK fixture');
      return Response.json({ sbs_enabled: false });
    }));
    const state = new ChatState();
    state.historyLimit = 500;
    const runtime = createChatRuntime(state);
    try {
      const started = runtime.start();
      await vi.advanceTimersByTimeAsync(100);
      await started;
      expect(queries[0].searchParams.get('limit')).toBe('500');
      state.historyLimit = 25;
      for (let seq = 2; seq <= 81; seq++) history.push({ seq, role: 'user', content: `row ${seq}`, scene_id: 'desktop-test' });
      await runtime.refreshHistory();
      const incremental = queries.filter(url => url.searchParams.has('after'));
      expect(incremental.every(url => url.searchParams.get('limit') === '25')).toBe(true);
      expect(incremental.map(url => url.searchParams.get('after'))).toContain('71');
      expect(state.items.filter(item => item.kind === 'message')).toHaveLength(81);
    } finally { runtime.dispose(); }
  });

  it.each([
    ["message_stop", "final"], ["eof", "final"],
    ["message_stop", "combined"], ["eof", "combined"],
  ])("keeps one report after %s when history persists %s text", async (boundary, persistence) => {
    const f = fixture();
    try {
      await f.runtime.start();
      await f.runtime.send("review plugin support");
      await vi.advanceTimersByTimeAsync(0);
      f.event("content_block_delta", { delta: { text: "正在检查列表。" } });
      // The boundary can arrive before the pending animation frame renders.
      f.event("tool_use", { name: "read", input: {} });
      f.event("tool_result", { name: "read", summary: "done" });
      await vi.advanceTimersByTimeAsync(20);
      expect(f.replies().map(m => m.text)).toEqual(["正在检查列表。"]);
      expect(f.replies()[0]).toMatchObject({ streaming: false, interim: true });
      expect(f.state.items.some(i => i.kind === "run" && i.end)).toBe(false);

      // Process updates and the final answer have distinct creation times.
      await vi.advanceTimersByTimeAsync(19000);
      f.event("content_block_delta", { delta: { text: "列表检查完成。" } });
      f.event("reasoning", { text: "继续检查安装" });
      await vi.advanceTimersByTimeAsync(20);
      f.event("content_block_delta", { delta: { text: "Review 完成。\n\n最终报告。" } });
      if (boundary === "message_stop") f.event("message_stop", {});
      f.close();
      await vi.advanceTimersByTimeAsync(20);

      const report = "Review 完成。\n\n最终报告。";
      f.history.push({ seq: 1, role: "assistant", scene_id: "desktop-test", at: new Date().toISOString(),
        content: persistence === "combined" ? "正在检查列表。列表检查完成。" + report : report });
      await f.runtime.refreshHistory();
      await f.runtime.refreshHistory();
      expect(f.replies().map(m => m.text)).toEqual(["正在检查列表。", "列表检查完成。", report]);
      expect(f.replies().at(-1)).toMatchObject({ historySeq: 1, streaming: false });
      expect(f.state.streaming).toBe(false);
      expect(f.state.thinking).toBe(false);
      expect(f.state.items.filter(i => i.kind === "run")).toMatchObject([{ label: "已回复", outcome: "done" }]);

      f.history.push({ seq: 2, role: "assistant", scene_id: "another-scene", content: report },
        { seq: 3, role: "assistant", scene_id: "desktop-test", content: "最终报告。" });
      await f.runtime.refreshHistory();
      expect(f.replies()).toHaveLength(5);
    } finally { f.runtime.dispose(); }
  });

  it("assigns persisted identity to the final answer when progress has identical text", async () => {
    const f = fixture();
    try {
      await f.runtime.start();
      await f.runtime.send("check twice");
      await vi.advanceTimersByTimeAsync(0);
      f.event("content_block_delta", { delta: { text: "检查完成。" } });
      f.event("tool_use", { name: "read", input: {} });
      f.event("tool_result", { name: "read", summary: "done" });
      f.event("content_block_delta", { delta: { text: "检查完成。" } });
      f.event("message_stop", {});
      f.close();
      await vi.advanceTimersByTimeAsync(20);
      f.history.push({ seq: 1, role: "assistant", scene_id: "desktop-test", content: "检查完成。" });
      await f.runtime.refreshHistory();
      expect(f.replies()).toHaveLength(2);
      expect(f.replies()[0]).toMatchObject({ interim: true });
      expect(f.replies()[0].historySeq).toBeUndefined();
      expect(f.replies()[1]).toMatchObject({ historySeq: 1, streaming: false });
    } finally { f.runtime.dispose(); }
  });

  it("does not count a progress bubble as a completed reply", async () => {
    const f = fixture();
    try {
      await f.runtime.start();
      await f.runtime.send("review plugin support");
      await vi.advanceTimersByTimeAsync(0);
      f.event("content_block_delta", { delta: { text: "我先检查一下。" } });
      f.event("tool_use", { name: "read", input: {} });
      f.event("message_stop", {});
      f.close();
      await vi.advanceTimersByTimeAsync(20);
      expect(f.state.items.some(i => i.kind === "run" && i.label === "已回复")).toBe(false);
      expect(f.state.items.some(i => i.kind === "run" && i.waitingForReply)).toBe(true);
    } finally { f.runtime.dispose(); }
  });

  it.each(["final", "combined"])("reconciles %s history after replaying tool-separated text in another scene", async persistence => {
    const history: any[] = [];
    const scene = "other-scene";
    const events = [
      { seq: 1, event: "content_block_delta", data: { scene_id: scene, delta: { text: "检查中。" } } },
      { seq: 2, event: "tool_use", data: { scene_id: scene, name: "read", input: {} } },
      { seq: 3, event: "tool_result", data: { scene_id: scene, name: "read", summary: "done" } },
      { seq: 4, event: "content_block_delta", data: { scene_id: scene, delta: { text: "检查完成。" } } },
      { seq: 5, event: "message_stop", data: { scene_id: scene } },
    ];
    let completed = false;
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === "/api/history") return Response.json({ messages: history.filter(m => m.seq > Number(url.searchParams.get("after") || 0)) });
      if (url.pathname === "/health") return new Response("OK fixture");
      if (url.pathname === "/api/stream/active") {
        if (completed) return new Response(null, { status: 204 });
        if (url.searchParams.has("after")) {
          completed = true;
          history.push({ seq: 1, role: "assistant", scene_id: scene,
            content: persistence === "combined" ? "检查中。检查完成。" : "检查完成。" });
        }
        return Response.json({ stream_id: "replay-progress", origin: "human", finished: completed,
          events: completed ? events.slice(2) : events.slice(0, 2), next_seq: completed ? 6 : 3 });
      }
      return Response.json({ sbs_enabled: false });
    }));
    const state = new ChatState(), runtime = createChatRuntime(state);
    try {
      await runtime.start();
      await vi.advanceTimersByTimeAsync(600);
      await runtime.refreshHistory();
      const replies = state.items.filter((i): i is Message => i.kind === "message" && i.role === "being");
      expect(replies.map(i => i.text)).toEqual(["检查中。", "检查完成。"]);
      expect(replies[1]).toMatchObject({ sceneId: scene, historySeq: 1, streaming: false });
      expect(state.streaming).toBe(false);
    } finally { runtime.dispose(); }
  });
});
