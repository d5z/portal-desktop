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
let network: HistoryMessage[], unavailable: boolean, queries: URL[], active: any;

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
  network = []; unavailable = false; queries = []; active = null;
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = new URL(input);
    if (url.pathname === "/api/history") {
      queries.push(url);
      if (unavailable) return Response.json({ error: "offline" }, { status: 503 });
      return Response.json({ messages: network.filter(m => m.seq > Number(url.searchParams.get("after") || 0)) });
    }
    if (url.pathname === "/api/stream/active") return active ? Response.json(active) : new Response(null, { status: 204 });
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
  it('hydrates local history when a preserving refresh wins startup without clearing live messages', async () => {
    const state = new ChatState(), runtime = createChatRuntime(state);
    const live = {kind:'message' as const,id:'pending-local',role:'user' as const,text:'尚未确认的消息',
      sceneId:'old-room',streaming:false,timestamp:'',label:'you',consecutive:false,createdAt:Date.now()};
    state.items.push(live);
    try {
      await runtime.refreshHistory();
      expect(visible(state).filter(m => m.kind === 'message').map(m => m.text))
        .toEqual([old[0].content, old[1].content, live.text]);
      expect(state.items).toContain(live);
      expect(queries[0].searchParams.get('after')).toBe('400');
      await start(runtime);
      expect(HistoryCache.prototype.read).toHaveBeenCalledTimes(1);
      expect(state.items).toContain(live);
      expect(visible(state).filter(m => m.kind === 'message')).toHaveLength(3);
    } finally { runtime.dispose(); }
  });

  it('seeks an older cached target while offline without requesting history', async () => {
    vi.mocked(HistoryCache.prototype.readScene).mockResolvedValue([]);
    vi.spyOn(HistoryCache.prototype, 'readAround').mockResolvedValue(old);
    const state = new ChatState(), runtime = createChatRuntime(state);
    try {
      await start(runtime); unavailable = true;
      const count = queries.length;
      expect(await runtime.loadHistoryTarget(1, 'old-room')).toBe(true);
      expect(queries).toHaveLength(count);
      expect(visible(state).filter(m => m.kind === 'message').map(m => m.historySeq)).toEqual([1,2]);
    } finally { runtime.dispose(); }
  });
  it('fetches an uncached target by seq without advancing the forward sync cursor', async () => {
    vi.mocked(HistoryCache.prototype.readScene).mockResolvedValue([]);
    vi.spyOn(HistoryCache.prototype, 'readAround').mockResolvedValue([]);
    const state = new ChatState(), runtime = createChatRuntime(state);
    try {
      await start(runtime);
      network = [{...old[0],seq:800},{...old[1],seq:801}];
      expect(await runtime.loadHistoryTarget(800,'old-room')).toBe(true);
      expect(queries.at(-1)?.searchParams.get('after')).toBe('799');
      expect(queries.at(-1)?.searchParams.get('limit')).toBe('21');
      network = [];
      await runtime.refreshHistory();
      expect(queries.at(-1)?.searchParams.get('after')).toBe('400');
      expect(await runtime.loadHistoryTarget(999,'old-room')).toBe(false);
    } finally { runtime.dispose(); }
  });
  it('loads older cached rows on demand without moving the forward sync cursor',async()=>{
    vi.mocked(HistoryCache.prototype.readScene).mockResolvedValue([{...old[0],seq:51},{...old[1],seq:52}]);
    const page=vi.spyOn(HistoryCache.prototype,'readBefore').mockResolvedValue([{seq:1,role:'user',content:'更早的问题',scene_id:'old-room'}]);
    const state=new ChatState(),runtime=createChatRuntime(state);
    try{
      await start(runtime);expect(page).not.toHaveBeenCalled();
      expect(await runtime.loadOlderHistory()).toBe(1);
      expect(page).toHaveBeenCalledWith(52,40,expect.any(Function));
      const include=page.mock.calls[0][2]!;
      expect(include({seq:0,role:'user',content:'',scene_id:'other'})).toBe(false);
      expect(visible(state).some((item:any)=>item.text==='更早的问题')).toBe(true);
      await runtime.loadOlderHistory(1);
      expect(page).toHaveBeenLastCalledWith(1,40,expect.any(Function));
      await runtime.refreshHistory();expect(queries.at(-1)?.searchParams.get('after')).toBe('400');
    }finally{runtime.dispose();}
  });

  it("fills cache gaps inside the initial window and merges overlapping network history once", async () => {
    const middle: HistoryMessage = { seq: 150, role: "user", content: "缓存窗口内的旧场景消息", scene_id: "old-room" };
    vi.mocked(HistoryCache.prototype.read).mockResolvedValue({
      messages: recent.filter(message => message.seq !== middle.seq), lastSeq: 400,
    });
    vi.mocked(HistoryCache.prototype.readScene).mockResolvedValue([...old, middle]);
    network = [middle, { seq: 401, role: "being", content: "接口新增回复", scene_id: "old-room" }];
    const state = new ChatState(), runtime = createChatRuntime(state);
    try {
      await start(runtime);
      await runtime.refreshHistory();
      await runtime.selectScene({ sceneId: "recent-room", strict: true });
      await runtime.selectScene(oldScene);
      expect(visible(state).filter(m => m.kind === "message").map(m => m.text))
        .toEqual([old[0].content, old[1].content, middle.content, "接口新增回复"]);
      expect(HistoryCache.prototype.read).toHaveBeenCalledWith(60);
      expect(HistoryCache.prototype.readScene).toHaveBeenCalledWith("old-room",60);
      expect(state.items.filter(item => item.kind === "message" && item.historySeq === 150)).toHaveLength(1);
      expect(state.items.filter(item => item.kind === "message" && item.historySeq === 401)).toHaveLength(1);
    } finally { runtime.dispose(); }
  });

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
      expect(activity.mock.calls.at(-1)?.[0]["old-room"]).toBe("queued");
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
      expect(state.items.filter(m => m.kind === "separator" && m.handoffMarker)).toHaveLength(1);
      expect(visible(state).filter(m => m.kind === "separator" && m.handoffMarker)).toHaveLength(0);
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

it('fills disjoint cached history after search without duplicates or moving the sync cursor', async () => {
  const rows: HistoryMessage[] = Array.from({length:200},(_,i)=>({seq:i+1,role:'being',content:`row ${i+1}`,scene_id:'old-room'}));
  vi.mocked(HistoryCache.prototype.read).mockResolvedValue({messages:rows.slice(-60),lastSeq:200});
  vi.mocked(HistoryCache.prototype.readScene).mockResolvedValue(rows.slice(-60));
  vi.spyOn(HistoryCache.prototype,'readBefore').mockImplementation(async(before,limit,include)=>
    rows.filter(row=>row.seq<before && (!include || include(row))).slice(-limit));
  const state=new ChatState(),runtime=createChatRuntime(state);
  try {
    await start(runtime);
    runtime.revealHistory(rows.slice(19,40));
    state.historyScope='all';
    const result = state.items.find(item=>item.kind==='message' && item.historySeq===30);
    expect(await runtime.loadOlderHistory()).toBe(40);
    expect(state.items.some(item=>item.kind==='message' && item.historySeq===101)).toBe(true);
    for(let page=0;page<5;page++)await runtime.loadOlderHistory();
    expect(state.items.filter(item=>item.kind==='message').map(item=>item.historySeq)).toEqual(rows.map(row=>row.seq));
    expect(state.items.find(item=>item.kind==='message' && item.historySeq===30)).toBe(result);
    expect(await runtime.loadOlderHistory()).toBe(0);
    await runtime.refreshHistory();
    expect(queries.at(-1)?.searchParams.get('after')).toBe('200');
  }finally{runtime.dispose();}
});


it('restores cached questions AND replies while an unaddressed SBS stream is active', async () => {
  vi.mocked(HistoryCache.prototype.readScene).mockResolvedValue([]);
  const state = new ChatState(), runtime = createChatRuntime(state);
  try {
    await start(runtime);
    active = { stream_id: 'autonomous', origin: 'callback', scene_id: null, finished: false, next_seq: 2,
      events: [{ seq: 1, event: 'tool_use', data: { scene_id: null, name: 'wait', input: {} } }] };
    await vi.advanceTimersByTimeAsync(10020);
    expect(state.sbsStreamingOrigin).toBe('callback');
    vi.mocked(HistoryCache.prototype.readScene).mockImplementation(async id => id === 'old-room' ? old : []);
    await runtime.refreshHistory();
    expect(visible(state).filter(item => item.kind === 'message').map(item => item.text)).toEqual(['几天前的问题', '几天前的回复']);
    network = [
      { seq: 401, role: 'user', scene_id: 'old-room', content: '历史中的另一个问题' },
      { seq: 402, role: 'being', scene_id: 'old-room', content: '历史中的另一个回复' },
      { seq: 403, role: 'being', scene_id: 'other-room', content: '另一个场景的回复' },
    ];
    await runtime.refreshHistory();
    expect(visible(state).filter(item => item.kind === 'message').map(item => item.text)).toEqual(['几天前的问题', '几天前的回复', '历史中的另一个问题', '历史中的另一个回复']);
    await runtime.selectScene({ sceneId: 'other-room', strict: true });
    expect(visible(state).filter(item => item.kind === 'message').map(item => item.text)).toEqual(['另一个场景的回复']);
    await runtime.selectScene(oldScene);
    await runtime.refreshHistory();
    expect(state.items.filter(item => item.kind === 'message' && item.historySeq === 402)).toHaveLength(1);
  } finally { runtime.dispose(); }
});

it('renders the selected cached scene before a pending history request resolves', async () => {
  const originalFetch = fetch;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    if (new URL(input).pathname === '/api/history') await pending;
    return originalFetch(input, init);
  }));
  const state = new ChatState(), runtime = createChatRuntime(state);
  const starting = runtime.start();
  try {
    await vi.advanceTimersByTimeAsync(50);
    expect(visible(state).filter(item => item.kind === 'message').map(item => item.text))
      .toEqual(['几天前的问题', '几天前的回复']);
  } finally { release(); await starting; runtime.dispose(); }
});

it('unions overlapping and unordered history by seq without deleting cache-only replies', async () => {
  vi.mocked(HistoryCache.prototype.read).mockResolvedValue({ messages: recent.filter(row => row.seq !== 399), lastSeq: 400 });
  const state = new ChatState(), runtime = createChatRuntime(state);
  try {
    await start(runtime);
    const rows: HistoryMessage[] = [
      { seq: 402, role: 'being', content: '新回复', scene_id: 'old-room' },
      { seq: 399, role: 'being', content: '此前缺失的回复', scene_id: 'old-room' },
      { seq: 401, role: 'user', content: '新问题', scene_id: 'old-room' },
    ];
    const originalFetch = fetch;
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      if (new URL(input).pathname === '/api/history') return Response.json({ messages: [...rows, rows[0]] });
      return originalFetch(input, init);
    }));
    await runtime.refreshHistory();
    await runtime.refreshHistory();
    expect(visible(state).filter(item => item.kind === 'message').map(item => [item.historySeq, item.text]))
      .toEqual([[1, '几天前的问题'], [2, '几天前的回复'], [399, '此前缺失的回复'], [401, '新问题'], [402, '新回复']]);
  } finally { runtime.dispose(); }
});

it('retains successful incremental pages when a later page fails, then resumes at the saved seq', async () => {
  const state = new ChatState(), runtime = createChatRuntime(state);
  try {
    await start(runtime);
    const originalFetch = fetch;
    let fail = true;
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      if (url.pathname === '/api/history') {
        const after = Number(url.searchParams.get('after'));
        if (after === 400) return Response.json({ messages: [{ seq: 401, role: 'user', content: '分页提问', scene_id: 'old-room' }] });
        if (fail) throw new Error('lost connection on second page');
        return Response.json({ messages: after === 401 ? [{ seq: 402, role: 'being', content: '分页回复', scene_id: 'old-room' }] : [] });
      }
      return originalFetch(input, init);
    }));
    await runtime.refreshHistory();
    expect(visible(state).filter(item => item.kind === 'message').map(item => item.historySeq)).toEqual([1, 2, 401]);
    expect(HistoryCache.prototype.write).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ seq: 401 })]), 401);
    fail = false;
    await runtime.refreshHistory();
    expect(visible(state).filter(item => item.kind === 'message').map(item => item.historySeq)).toEqual([1, 2, 401, 402]);
  } finally { runtime.dispose(); }
});
