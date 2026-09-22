import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatState, type ChatItem } from "../desktop/renderer/chat/models/chat";
import { inCurrentScene, messageScene, sceneItems, sceneName } from "../desktop/renderer/chat/models/scenes";
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

  it("adds scheduling context for B while A runs and routes a shared breath back to both scenes", async () => {
    const requests: { message: string }[] = [];
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const emit = (event: string, scene_id: string, data: object = {}) => stream.enqueue(new TextEncoder().encode(
      `event: ${event}\ndata: ${JSON.stringify({ scene_id, ...data })}\n\n`));
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      const path = new URL(input).pathname;
      if (path === "/api/history") return Response.json({ messages: [] });
      if (path === "/api/stream/active") return new Response(null, { status: 204 });
      if (path === "/health") return new Response("OK fixture");
      if (path === "/api/chat/stream") {
        requests.push(JSON.parse(String(init?.body)));
        return requests.length === 1
          ? new Response(new ReadableStream({ start(c) { stream = c; } }))
          : Response.json({ queued: true }, { status: 202 });
      }
      return Response.json({ sbs_enabled: false });
    }));
    const state = new ChatState(), runtime = createChatRuntime(state);
    state.subagentReady = true;
    await runtime.start();
    await runtime.selectScene({ sceneId: "desktop-idle", sceneLabel: "闲置场景", strict: true });
    await runtime.selectScene({ sceneId: "desktop-test", sceneLabel: "测试A", strict: true });
    const sending = runtime.send("A 查找资料并整理报告");
    await vi.advanceTimersByTimeAsync(20);
    try {
      emit("tool_use", "desktop-test", { name: "portal_exec", input: { command: "research" } });
      await vi.advanceTimersByTimeAsync(20);
      state.draft = "不应发送的草稿";
      await runtime.selectScene({ sceneId: "desktop-b", sceneLabel: "测试B", strict: true });
      await runtime.send("B 解释方案");
      expect(requests[0].message).toBe("A 查找资料并整理报告");
      expect(requests[1].message).toContain("B 解释方案\n\n[Desktop 场景调度提示]");
      expect(requests[1].message).toContain('"scene_id":"desktop-test"');
      expect(requests[1].message).toContain("A 查找资料并整理报告");
      expect(requests[1].message).not.toContain("desktop-idle");
      expect(requests[1].message).not.toContain("不应发送的草稿");
      // A yields without a reply; B completes, then A's delegated result returns.
      emit("message_stop", "desktop-test");
      emit("reasoning", "desktop-b", { text: "B 正在分析方案" });
      emit("tool_use", "desktop-b", { name: "portal_exec", input: { command: "B verify" } });
      emit("tool_result", "desktop-b", { content: "B 验证完成" });
      emit("content_block_delta", "desktop-b", { delta: { text: "B 结果" } });
      emit("message_stop", "desktop-b");
      emit("reasoning", "desktop-test", { text: "A 正在整理后台结果" });
      emit("tool_result", "desktop-test", { name: "portal_subagent_spawn", content: "A 后台结果" });
      emit("content_block_delta", "desktop-test", { delta: { text: "A 结果" } });
      emit("message_stop", "desktop-test");
      await vi.advanceTimersByTimeAsync(20);
      expect(state.items.flatMap(i => i.kind === "message" && i.role === "being" ? [[i.sceneId, i.text]] : []))
        .toEqual([["desktop-b", "B 结果"], ["desktop-test", "A 结果"]]);
      expect(state.currentScene.sceneId).toBe("desktop-b");
      const process = (sceneId: string) => JSON.stringify(state.items.filter(i => i.kind === "run" && i.sceneId === sceneId));
      expect(process("desktop-test")).toContain("A 正在整理后台结果");
      expect(process("desktop-test")).not.toContain("B 正在分析方案");
      expect(process("desktop-b")).toContain("B 正在分析方案");
      expect(process("desktop-b")).not.toContain("A 正在整理后台结果");
      await runtime.send("B 新问题");
      expect(requests[2].message).toBe("B 新问题");
    } finally { stream.close(); await sending; runtime.dispose(); }
  });

  it.each([false, true])("keeps independent A/B/C tasks scoped with immediate C=%s", async immediateC => {
    const requests: {message:string}[]=[];
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const emit=(event:string,scene_id:string,data:object={})=>stream.enqueue(new TextEncoder().encode(
      `event: ${event}\ndata: ${JSON.stringify({scene_id,...data})}\n\n`));
    vi.stubGlobal("fetch",vi.fn(async(input:string,init?:RequestInit)=>{
      const route=new URL(input).pathname;
      if(route==="/api/history") return Response.json({messages:[]});
      if(route==="/api/stream/active") return new Response(null,{status:204});
      if(route==="/health") return new Response("OK fixture");
      if(route==="/api/chat/stream") {
        requests.push(JSON.parse(String(init?.body)));
        return requests.length===1 ? new Response(new ReadableStream({start(c){stream=c;}}))
          : Response.json({queued:true},{status:202});
      }
      return Response.json({sbs_enabled:false});
    }));
    const state=new ChatState(), runtime=createChatRuntime(state);
    state.subagentReady = true;
    await runtime.start(); const sending=runtime.send("A 主意识长任务");
    await vi.advanceTimersByTimeAsync(20);
    try {
      emit("tool_use","desktop-test",{name:"portal_exec",input:{command:"A work"}});
      await vi.advanceTimersByTimeAsync(20);
      await runtime.selectScene({sceneId:"desktop-b",strict:true}); await runtime.send("B 独立任务");
      const delegateB=()=>{
        emit("message_stop","desktop-test");
        emit("tool_use","desktop-b",{name:"portal_subagent_spawn",input:{scene_id:"desktop-b",brief:"B 独立任务"}});
        emit("tool_result","desktop-b",{name:"portal_subagent_spawn",content:"B 已委派"});
        runtime.updateSceneTasks([{id:"sub-b",sceneId:"desktop-b",status:"running",createdAt:Date.now()}]);
        emit("message_stop","desktop-b");
      };
      if(!immediateC) {delegateB();await vi.advanceTimersByTimeAsync(20);}
      await runtime.selectScene({sceneId:"desktop-c",strict:true}); await runtime.send("C 独立任务");
      for(const request of requests.slice(1)) {
        expect(request.message).toContain("当前 Portal 已开启 subagent");
        expect(request.message).toContain("各会话是独立任务，可能互不相关");
        expect(request.message).toContain("优先评估将本次新输入委派给 subagent");
        expect(request.message).toContain("随后恢复已有任务");
        expect(request.message).toContain("委派本次输入时使用当前输入的 scene_id");
        expect(request.message).not.toContain("可以考虑将适合后台执行的已有任务交给 subagent");
      }
      expect(requests[2].message).toContain("B 独立任务");
      if(immediateC) {
        expect(requests[2].message).not.toContain('"task_id":"sub-b"');
        delegateB();
      } else expect(requests[2].message).toContain('"task_id":"sub-b"');
      expect(requests[2].message).toContain('scene_id="desktop-c"');
      emit("tool_use","desktop-c",{name:"portal_subagent_spawn",input:{scene_id:"desktop-c",brief:"C 独立任务"}});
      emit("tool_result","desktop-c",{name:"portal_subagent_spawn",content:"C 已委派"});
      emit("message_stop","desktop-c");
      runtime.updateSceneTasks([
        {id:"sub-b",sceneId:"desktop-b",status:"done",createdAt:Date.now(),endedAt:Date.now()},
        {id:"sub-c",sceneId:"desktop-c",status:"done",createdAt:Date.now(),endedAt:Date.now()},
      ]);
      await vi.advanceTimersByTimeAsync(20);
      // The Being serially resumes A, then handles C and B callbacks on one SSE.
      for(const [scene,text] of [["desktop-test","A"],["desktop-c","C"],["desktop-b","B"]]) {
        emit("meta",scene,{continuation:true});
        emit("reasoning",scene,{text:text+" 整理结果"});
        emit("content_block_delta",scene,{delta:{text:text+" 最终答案"}});
        emit("message_stop",scene);
      }
      await vi.advanceTimersByTimeAsync(20);
      expect(state.items.flatMap(i=>i.kind==="message" && i.role==="being" ? [[i.sceneId,i.text]]:[]))
        .toEqual([["desktop-test","A 最终答案"],["desktop-c","C 最终答案"],["desktop-b","B 最终答案"]]);
      for(const [scene,text] of [["desktop-test","A"],["desktop-b","B"],["desktop-c","C"]]) {
        const entries=JSON.stringify(state.items.filter(i=>i.kind==="run" && i.sceneId===scene));
        expect(entries).toContain(text+" 整理结果");
        for(const other of ["A","B","C"].filter(x=>x!==text)) expect(entries).not.toContain(other+" 整理结果");
      }
      const presented=withScheduling(state.items,state.sceneTasks);
      for(const scene of ["desktop-test","desktop-b","desktop-c"]) {
        const runs=presented.filter(i=>i.kind==="run" && i.sceneId===scene);
        expect(runs).toHaveLength(1);
        expect(runs[0]).toMatchObject({outcome:"done"});
        if(scene!=="desktop-test") {
          expect(runs[0].kind==="run" && runs[0].entries.some(e=>e.name==="portal_subagent_spawn")).toBe(true);
          expect(runs[0].kind==="run" && runs[0].scheduling?.tasks).toEqual([expect.objectContaining({sceneId:scene,status:"done"})]);
        }
      }
      expect(state.currentScene.sceneId).toBe("desktop-c");
    } finally {stream.close();await sending;runtime.dispose();}
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

  it("keeps A consuming SSE after a B send returns a separate 200 stream", async () => {
    const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
    const signals: AbortSignal[] = [];
    const emit = (index: number, scene: string, text: string) => streams[index].enqueue(new TextEncoder().encode(
      `event: content_block_delta\ndata: ${JSON.stringify({ scene_id: scene, delta: { text } })}\n\n`));
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      const route = new URL(input).pathname;
      if (route === "/api/history") return Response.json({ messages: [] });
      if (route === "/api/stream/active") return new Response(null, { status: 204 });
      if (route === "/health") return new Response("OK fixture");
      if (route === "/api/chat/stream") {
        signals.push(init!.signal!);
        return new Response(new ReadableStream({ start(controller) { streams.push(controller); } }));
      }
      return Response.json({ sbs_enabled: false });
    }));
    const state = new ChatState(), runtime = createChatRuntime(state);
    state.subagentReady = true;
    await runtime.start();
    const a = runtime.send("A 输入");
    await vi.advanceTimersByTimeAsync(20);
    emit(0, "desktop-test", "A 开始");
    await vi.advanceTimersByTimeAsync(20);
    await runtime.selectScene({ sceneId: "desktop-b", strict: true });
    const b = runtime.send("B 输入");
    await vi.advanceTimersByTimeAsync(20);
    emit(1, "desktop-b", "B 开始");
    emit(0, "desktop-test", " A 继续");
    await vi.advanceTimersByTimeAsync(20);
    try {
      expect(signals.every(signal => !signal.aborted)).toBe(true);
      const messages = () => state.items.filter((item): item is Extract<ChatItem, { kind: "message" }> => item.kind === "message" && item.role === "being");
      expect(messages().find(item => item.sceneId === "desktop-test")?.text).toBe("A 开始 A 继续");
      expect(messages().find(item => item.sceneId === "desktop-b")?.text).toBe("B 开始");
      streams[1].close(); await b;
      emit(0, "desktop-test", " A 完成");
      await vi.advanceTimersByTimeAsync(20);
      expect(messages().find(item => item.sceneId === "desktop-test")?.text).toBe("A 开始 A 继续 A 完成");
    } finally {
      for (const stream of streams) { try { stream.close(); } catch {} }
      await Promise.all([a, b]); runtime.dispose();
    }
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

  it("stops only the selected scene's transport and stream id", async () => {
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
      expect(stops).toEqual([{ stream_id: "stream-b" }]);
      expect(signals.map(s => s.aborted)).toEqual([false, true]);
      streams[0].enqueue(new TextEncoder().encode('event: content_block_delta\ndata: {"scene_id":"desktop-test","delta":{"text":"A 仍继续"}}\n\n'));
      await vi.advanceTimersByTimeAsync(20);
      expect(state.items.some(i => i.kind === "message" && i.text === "A 仍继续")).toBe(true);
    } finally { streams[0].close(); await a; runtime.dispose(); }
  });

  it("keeps B and C queued until their own replies arrive while A streams", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    let sends = 0;
    const history: object[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const path = new URL(input).pathname;
      if (path === "/api/history") return Response.json({ messages: history });
      if (path === "/api/stream/active") return new Response(null, { status: 204 });
      if (path === "/health") return new Response("OK fixture");
      if (path === "/api/chat/stream") {
        if (++sends >= 2) return Response.json({ queued: true }, { status: 202 });
        return new Response(new ReadableStream({ start(c) { stream = c; } }));
      }
      return Response.json({ sbs_enabled: false });
    }));
    const state = new ChatState(), runtime = createChatRuntime(state);
    state.subagentReady = true;
    await runtime.start();
    const a = runtime.send("A 输入");
    await vi.advanceTimersByTimeAsync(20);
    stream.enqueue(new TextEncoder().encode('event: content_block_delta\ndata: {"scene_id":"desktop-test","delta":{"text":"A1"}}\n\n'));
    await vi.advanceTimersByTimeAsync(20);
    await runtime.selectScene({ sceneId: "desktop-b", strict: true });
    await runtime.send("B 输入");
    await runtime.selectScene({ sceneId: "desktop-c", strict: true });
    await runtime.send("C 输入");
    try {
      const runs = () => state.items.filter(i => i.kind === "run");
      expect(runs().filter(i => i.sceneId === "desktop-b")).toHaveLength(1);
      expect(runs().find(i => i.sceneId === "desktop-b")).toMatchObject({ label: "已排队，等待回复" });
      expect(runs().find(i => i.sceneId === "desktop-c")).toMatchObject({ label: "已排队，等待回复" });
      expect(runs().some(i => i.end || i.outcome === "done")).toBe(false);
      history.push({ seq: 1, role: "user", content: "A 输入", scene_id: "desktop-test" },
        { seq: 2, role: "user", content: "B 输入", scene_id: "desktop-b" },
        { seq: 3, role: "being", content: "B 排队回复", scene_id: "desktop-b" });
      await vi.advanceTimersByTimeAsync(2100);
      stream.enqueue(new TextEncoder().encode('event: content_block_delta\ndata: {"scene_id":"desktop-test","delta":{"text":"A2"}}\n\n'));
      await vi.advanceTimersByTimeAsync(20);
      const messages = state.items.filter(i => i.kind === "message");
      expect(messages.filter(i => i.text === "B 排队回复")).toHaveLength(1);
      expect(runs().find(i => i.sceneId === "desktop-b")).toMatchObject({ outcome: "done" });
      expect(runs().find(i => i.sceneId === "desktop-c")).toMatchObject({ label: "已排队，等待回复" });
      expect(runs().find(i => i.sceneId === "desktop-c")?.end).toBeUndefined();
      expect(messages.filter(i => i.text === "B 输入")).toHaveLength(1);
      expect(messages.find(i => i.text === "A1A2")).toMatchObject({ streaming: true, sceneId: "desktop-test" });
    } finally { stream.close(); await a; runtime.dispose(); }
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
      expect(runs[0]).toMatchObject({label:"本轮未返回正文，等待回复",waitingForReply:true});
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
