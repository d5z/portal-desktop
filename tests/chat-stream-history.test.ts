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
      if (url.pathname === "/api/chat/stream" && stream) return Response.json({ queued: true }, { status: 202 });
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

  it.each(["before", "after", "rendered-before"])("merges differing history text arriving %s persisted", async order => {
    const f = fixture();
    try {
      await f.runtime.start();
      await f.runtime.send("hello");
      await vi.advanceTimersByTimeAsync(0);
      f.event("content_block_delta", { delta: { text: "流式内容更多一些" } });
      await vi.advanceTimersByTimeAsync(20);
      const bubble = f.replies()[0];
      const row = { seq: 13317, role: "assistant", scene_id: order === "rendered-before" ? "canonical-scene" : "desktop-test", content: "落库内容" };
      if (order !== "after") {
        f.history.push(row);
        await f.runtime.refreshHistory();
        if (order === "rendered-before") expect(f.replies()).toHaveLength(2);
      }
      const persisted = { from: "final", kind: "self", seq: 13317, stream_id: "stream-test" };
      f.event("meta", { persisted });
      f.event("meta", { persisted });
      f.event("message_stop", {});
      f.close();
      await vi.advanceTimersByTimeAsync(20);
      if (order === "after") f.history.push(
        { seq: 13316, role: "user", scene_id: "other-scene", content: "并发用户消息" }, row);

      await f.runtime.refreshHistory();
      expect(f.replies()).toHaveLength(1);
      if (order === "after") expect(f.state.items.some(item => item.kind === "message" && item.text === "并发用户消息")).toBe(true);
      expect(f.replies()[0]).toBe(bubble);
      expect(bubble).toMatchObject({ historySeq: 13317, text: "落库内容", streaming: false });
      // Identical text with a different durable identity remains a new message.
      f.history.push({ ...row, seq: 13318 });
      await f.runtime.refreshHistory();
      expect(f.replies()).toHaveLength(2);
    } finally { f.runtime.dispose(); }
  });

  it.each(["act_talk", "partial"])("binds %s and final independently in one stream", async from => {
    const f = fixture();
    try {
      await f.runtime.start();
      await f.runtime.send("check");
      await vi.advanceTimersByTimeAsync(0);
      f.event("content_block_delta", { delta: { text: "过程" } });
      f.event("tool_use", { name: "read", input: {} });
      f.event("meta", { persisted: { from, kind: "self", seq: 10, stream_id: "one-stream" } });
      f.event("content_block_delta", { delta: { text: "终稿" } });
      f.event("meta", { persisted: { from: "final", kind: "self", seq: 11, stream_id: "one-stream" } });
      f.event("message_stop", {});
      f.close();
      await vi.advanceTimersByTimeAsync(20);
      f.history.push({ seq: 10, role: "assistant", scene_id: "desktop-test", content: "过程落库" },
        { seq: 11, role: "assistant", scene_id: "desktop-test", content: "终稿落库" });
      await f.runtime.refreshHistory();
      expect(f.replies()).toMatchObject([
        { historySeq: 10, text: "过程落库", persistedFrom: from, interim: true },
        { historySeq: 11, text: "终稿落库", persistedFrom: "final" },
      ]);
    } finally { f.runtime.dispose(); }
  });

  // DevTools sample: partial 13349 -> stop -> continuation -> final 13352.
  // Heart persists all four tool-separated speech fragments as one partial row.
  it.each([
    ["before-meta", "stream"], ["after-stop", "stream"], ["after-final", "stream"],
    ["before-meta", "history"], ["after-stop", "history"], ["after-final", "history"],
    ["before-meta", "truncated"], ["after-stop", "truncated"], ["after-final", "truncated"],
  ])("collapses a combined interrupted reply with history %s and separators in %s", async (order, separators) => {
    const f = fixture();
    const parts = ["收到修复通报。", "三个初步结果。", "现在检查安装链路。", "客户端已有兼容识别逻辑。"]
      .map((text, index) => text + (separators === "stream" && index < 3 ? "\n\n" : ""));
    const partial = { seq: 13349, role: "assistant", scene_id: "desktop-test", content: (separators === "truncated" ? "好，我开始做 E2E 测试。\n\n先检查环境。\n\n链路清楚了：" : "") + parts.join(separators !== "stream" ? "\n\n" : "") };
    try {
      await f.runtime.start();
      await f.runtime.send("review plugin support");
      await vi.advanceTimersByTimeAsync(0);
      f.event("meta", { stream_id: "interrupted-stream" });
      for (const text of parts) {
        f.event("content_block_delta", { delta: { text } });
        f.event("tool_use", { name: "read", input: {} });
      }
      await vi.advanceTimersByTimeAsync(20);
      expect(f.replies()).toHaveLength(4);
      const first = f.replies()[0];
      await f.runtime.send("不用验证了");
      const interrupt = f.state.items.find(item => item.kind === "message" && item.role === "user" && item.text === "不用验证了")!;
      expect(interrupt).toBeDefined();
      if (order === "before-meta") {
        f.history.push(partial);
        await f.runtime.refreshHistory();
      }
      const persisted = { from: "partial", kind: "self", seq: 13349, stream_id: "interrupted-stream" };
      f.event("meta", { persisted });
      f.event("meta", { persisted });
      f.event("message_stop", {});
      f.event("meta", { continuation: true });
      await vi.advanceTimersByTimeAsync(20);
      if (order === "after-stop") {
        f.history.push(partial);
        await f.runtime.refreshHistory();
      }
      f.event("content_block_delta", { delta: { text: "收到，就此收手。" } });
      f.event("meta", { persisted: { from: "final", kind: "self", seq: 13352, stream_id: "interrupted-stream" } });
      f.event("message_stop", {});
      f.close();
      await vi.advanceTimersByTimeAsync(20);
      if (order === "after-final") f.history.push(partial);
      f.history.push({ seq: 13352, role: "assistant", scene_id: "desktop-test", content: "收到，就此收手。" });
      await f.runtime.refreshHistory();
      expect(f.replies()).toHaveLength(2);
      expect(f.replies()[0]).toBe(first);
      expect(f.state.items.indexOf(first)).toBeLessThan(f.state.items.indexOf(interrupt));
      expect(f.state.items.indexOf(interrupt)).toBeLessThan(f.state.items.indexOf(f.replies()[1]));
      expect(f.replies()).toMatchObject([
        { historySeq: 13349, text: partial.content, persistedFrom: "partial", streaming: false },
        { historySeq: 13352, text: "收到，就此收手。", persistedFrom: "final", streaming: false },
      ]);
      // Neither continuation nor fallback may reuse the consumed fragments.
      f.history.push({ ...partial, seq: 13353 });
      await f.runtime.refreshHistory();
      expect(f.replies()).toHaveLength(3);
    } finally { f.runtime.dispose(); }
  });

  it.each(["al ready checked\n\nsecond paragraph", "already checked\nmissing middle\nsecond paragraph", "already checked\n\nsecond paragraph and unobserved ending"])("does not merge incompatible partial coverage: %s", async content => {
    const f = fixture();
    try {
      await f.runtime.start();
      await f.runtime.send("check");
      await vi.advanceTimersByTimeAsync(0);
      for (const text of ["already checked", "second paragraph"]) {
        f.event("content_block_delta", { delta: { text } });
        f.event("tool_use", { name: "read", input: {} });
      }
      f.event("meta", { persisted: { from: "partial", kind: "self", seq: 10, stream_id: "stream" } });
      f.event("message_stop", {});
      f.close();
      await vi.advanceTimersByTimeAsync(20);
      f.history.push({ seq: 10, role: "assistant", scene_id: "desktop-test", content });
      await f.runtime.refreshHistory();
      expect(f.replies().map(message => message.text)).toEqual([
        "already checked", "second paragraph", content,
      ]);
      expect(f.replies().slice(0, 2).every(message => !message.historySeq)).toBe(true);
    } finally { f.runtime.dispose(); }
  });

  it.each([
    { seq: -1 }, { seq: "10" }, { kind: "user" }, { from: "unknown" }, { stream_id: "other-stream" },
  ])("ignores invalid or unrelated persisted metadata: %j", async override => {
    const f = fixture();
    try {
      await f.runtime.start();
      await f.runtime.send("hello");
      await vi.advanceTimersByTimeAsync(0);
      f.event("meta", { stream_id: "one-stream" });
      f.event("content_block_delta", { delta: { text: "reply" } });
      f.event("meta", { persisted: { from: "final", kind: "self", seq: 10, stream_id: "one-stream", ...override } });
      f.event("message_stop", {});
      f.close();
      await vi.advanceTimersByTimeAsync(20);
      expect(f.replies()[0].historySeq).toBeUndefined();
      f.history.push({ seq: 10, role: "assistant", scene_id: "desktop-test", content: "reply" });
      await f.runtime.refreshHistory();
      expect(f.replies()).toHaveLength(1);
      expect(f.replies()[0].historySeq).toBe(10);
    } finally { f.runtime.dispose(); }
  });

  it("does not guess which progress bubble an ambiguous acknowledgement belongs to", async () => {
    const f = fixture();
    try {
      await f.runtime.start();
      await f.runtime.send("check");
      await vi.advanceTimersByTimeAsync(0);
      for (const text of ["第一段", "第二段"]) {
        f.event("content_block_delta", { delta: { text } });
        f.event("tool_use", { name: "read", input: {} });
      }
      f.event("meta", { persisted: { from: "act_talk", kind: "self", seq: 10, stream_id: "one-stream" } });
      f.event("message_stop", {});
      f.close();
      await vi.advanceTimersByTimeAsync(20);
      expect(f.replies().every(m => !m.historySeq)).toBe(true);
      f.history.push({ seq: 10, role: "assistant", scene_id: "desktop-test", content: "第二段" });
      await f.runtime.refreshHistory();
      expect(f.replies()).toHaveLength(2);
      expect(f.replies()[1].historySeq).toBe(10);
    } finally { f.runtime.dispose(); }
  });

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

  it.each(["final", "combined", "persisted", "partial", "truncated"])("reconciles %s history after replaying tool-separated text in another scene", async persistence => {
    const history: any[] = [];
    const scene = "other-scene";
    const events = [
      { seq: 1, event: "content_block_delta", data: { scene_id: scene, delta: { text: "检查中。" } } },
      { seq: 2, event: "tool_use", data: { scene_id: scene, name: "read", input: {} } },
      { seq: 3, event: "tool_result", data: { scene_id: scene, name: "read", summary: "done" } },
      { seq: 4, event: "content_block_delta", data: { scene_id: scene, delta: { text: "检查完成。" } } },
      { seq: 5, event: "message_stop", data: { scene_id: scene } },
    ];
    if (persistence === "persisted") {
      events.splice(4, 0, { seq: 5, event: "meta", data: { scene_id: scene,
        persisted: { from: "final", kind: "self", seq: 1, stream_id: "replay-progress" } } } as any);
      events[5].seq = 6;
    }
    if ((persistence === "partial" || persistence === "truncated")) {
      events.splice(4, 0, { seq: 5, event: "meta", data: { scene_id: scene,
        persisted: { from: "partial", kind: "self", seq: 1, stream_id: "replay-progress" } } } as any);
      events[5].seq = 6;
      events.push(
        { seq: 7, event: "meta", data: { scene_id: scene, continuation: true } } as any,
        { seq: 8, event: "content_block_delta", data: { scene_id: scene, delta: { text: "收到，就此收手。" } } },
        { seq: 9, event: "meta", data: { scene_id: scene,
          persisted: { from: "final", kind: "self", seq: 2, stream_id: "replay-progress" } } } as any,
        { seq: 10, event: "message_stop", data: { scene_id: scene } },
      );
    }
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
            content: (persistence === "partial" || persistence === "truncated") ? (persistence === "truncated" ? "恢复前已经说出的开头。\n\n检查中。\n\n检查完成。" : "检查中。\n\n检查完成。") : persistence === "combined" ? "检查中。检查完成。" : persistence === "persisted" ? "落库终稿。" : "检查完成。" });
          if ((persistence === "partial" || persistence === "truncated")) history.push({ seq: 2, role: "assistant", scene_id: scene, content: "收到，就此收手。" });
        }
        return Response.json({ stream_id: "replay-progress", origin: "human", finished: completed,
          events: completed ? events.slice(2) : events.slice(0, 2), next_seq: completed ? events.at(-1)!.seq + 1 : 3 });
      }
      return Response.json({ sbs_enabled: false });
    }));
    const state = new ChatState(), runtime = createChatRuntime(state);
    try {
      await runtime.start();
      await vi.advanceTimersByTimeAsync(600);
      await runtime.refreshHistory();
      const replies = state.items.filter((i): i is Message => i.kind === "message" && i.role === "being");
      expect(replies.map(i => i.text)).toEqual((persistence === "partial" || persistence === "truncated") ?
        [(persistence === "truncated" ? "恢复前已经说出的开头。\n\n检查中。\n\n检查完成。" : "检查中。\n\n检查完成。"), "收到，就此收手。"] : ["检查中。", persistence === "persisted" ? "落库终稿。" : "检查完成。"]);
      expect(replies[1]).toMatchObject({ sceneId: scene, historySeq: (persistence === "partial" || persistence === "truncated") ? 2 : 1, streaming: false });
      if ((persistence === "partial" || persistence === "truncated")) expect(replies[0]).toMatchObject({ historySeq: 1, persistedFrom: "partial", streaming: false });
      expect(state.streaming).toBe(false);
    } finally { runtime.dispose(); }
  });
});
