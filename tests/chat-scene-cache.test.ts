import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatState } from "../desktop/renderer/chat/models/chat";
import { sceneItems } from "../desktop/renderer/chat/models/scenes";
import { createChatRuntime } from "../desktop/renderer/chat/services/runtime";
import { HistoryCache, type HistoryMessage } from "../desktop/renderer/chat/services/history-cache";

const oldScene = { sceneId: "old-room", strict: true };
const old: HistoryMessage[] = [
  { seq: 1, role: "user", content: "几天前的问题", scene_id: "old-room", at: "2026-10-01T01:00:00Z" },
  { seq: 2, role: "being", content: "几天前的回复", scene_id: "old-room", at: "2026-10-01T01:00:01Z" },
  { seq: 3, role: "being", content: "[breath yielded]", type: "marker", scene_id: "old-room" },
];
const recent: HistoryMessage[] = Array.from({ length: 300 }, (_, i) => ({
  seq: i + 101, role: "being", content: `其他场景 ${i}`, scene_id: "recent-room", at: "2026-10-08T01:00:00Z",
}));
let network: HistoryMessage[], unavailable: boolean, queries: URL[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("location", new URL("https://fixture.test/loom.html?scene_id=old-room&scene_strict=1"));
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => setTimeout(fn, 16));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  vi.spyOn(HistoryCache.prototype, "read").mockResolvedValue({ messages: recent, lastSeq: 400 });
  vi.spyOn(HistoryCache.prototype, "readScene").mockImplementation(async id => id === "old-room" ? old : recent);
  vi.spyOn(HistoryCache.prototype, "write").mockResolvedValue();
  network = []; unavailable = false; queries = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = new URL(input);
    if (url.pathname === "/api/history") {
      queries.push(url);
      if (unavailable) return Response.json({ error: "offline" }, { status: 503 });
      return Response.json({ messages: network.filter(m => m.seq > Number(url.searchParams.get("after") || 0)) });
    }
    if (url.pathname === "/api/stream/active") return new Response(null, { status: 204 });
    if (url.pathname === "/api/chat/stream") return Response.json({ accepted: true }, { status: 202 });
    if (url.pathname === "/health") return new Response("OK fixture");
    return Response.json({ sbs_enabled: false });
  }));
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const visible = (state: ChatState) => sceneItems(state.items, "current", state.currentScene);
async function start(runtime: ReturnType<typeof createChatRuntime>) {
  const starting = runtime.start();
  await vi.advanceTimersByTimeAsync(600);
  await starting;
}

describe("scene history cache fallback", () => {
  it("does not treat a delayed cached reply as completion of a newly queued request", async () => {
    vi.mocked(HistoryCache.prototype.readScene).mockResolvedValueOnce([]);
    const activity = vi.fn();
    const state = new ChatState(), runtime = createChatRuntime(state, { onSceneActivity: activity });
    try {
      await start(runtime);
      await runtime.send("今天的新问题");
      await vi.advanceTimersByTimeAsync(0);
      await runtime.refreshHistory();
      await vi.advanceTimersByTimeAsync(2200);
      expect(visible(state).filter(m => m.kind === "message").map(m => m.text))
        .toEqual([old[0].content, old[1].content, "今天的新问题"]);
      expect(activity.mock.calls.at(-1)?.[0]["old-room"]).toBe("waiting");
      network.push({ seq: 401, role: "being", content: "今天的新回复", scene_id: "old-room" });
      await vi.advanceTimersByTimeAsync(4000);
      expect(activity.mock.calls.at(-1)?.[0]["old-room"]).toBe("done");
    } finally { runtime.dispose(); }
  });

  it.each([false, true])("restores an old scene outside the global window when history is empty or unavailable (%s)", async offline => {
    unavailable = offline;
    const state = new ChatState(), runtime = createChatRuntime(state);
    try {
      await start(runtime);
      expect(visible(state).filter(m => m.kind === "message").map(m => m.text)).toEqual(["几天前的问题", "几天前的回复"]);
      expect(state.items.filter(m => m.kind === "message").slice(0, 3).map(m => m.historySeq)).toEqual([1, 2, 101]);
      await runtime.refreshHistory();
      expect(visible(state).filter(m => m.kind === "separator" && m.marker)).toHaveLength(1);
      expect(visible(state).filter(m => m.kind === "message")).toHaveLength(2);
      expect(queries.filter(url => url.searchParams.has("after")).every(url => url.searchParams.get("after") === "400")).toBe(true);
    } finally { runtime.dispose(); }
  });

  it("restores switched scenes without duplicating overlaps, clearing live objects, or skipping new messages", async () => {
    const state = new ChatState();
    state.currentScene = { sceneId: "recent-room", strict: true };
    const runtime = createChatRuntime(state);
    try {
      await start(runtime);
      const live = { kind: "message" as const, id: "live", role: "being" as const, text: "正在生成", streaming: true,
        timestamp: "", createdAt: Date.now(), sceneId: "recent-room", label: "being", consecutive: false };
      state.items.push(live);
      state.draft = "保留草稿";
      await runtime.selectScene(oldScene);
      expect(visible(state).filter(m => m.kind === "message").map(m => m.text)).toEqual([old[0].content, old[1].content]);
      await runtime.selectScene({ sceneId: "recent-room", strict: true });
      expect(state.items).toContain(live);
      expect(live.streaming).toBe(true);
      expect(state.draft).toBe("保留草稿");
      expect(visible(state).filter(m => m.kind === "message")).toHaveLength(301);
      network.push({ seq: 401, role: "being", content: "新消息", scene_id: "old-room" });
      await runtime.selectScene(oldScene);
      await runtime.refreshHistory();
      await runtime.refreshHistory();
      expect(visible(state).filter(m => m.kind === "message").map(m => m.text)).toEqual([old[0].content, old[1].content, "新消息"]);
      expect(queries.at(-1)?.searchParams.get("after")).toBe("401");
    } finally { runtime.dispose(); }
  });
});
