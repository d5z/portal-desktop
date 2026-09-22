import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatState } from "../desktop/renderer/chat/models/chat";
import { createChatRuntime } from "../desktop/renderer/chat/services/runtime";
import { historyCacheDatabaseName } from "../desktop/renderer/chat/services/history-cache";
import { inCurrentScene } from "../desktop/renderer/chat/models/scenes";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("location", new URL("https://fixture.test/loom.html"));
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => setTimeout(fn, 16));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each([
  [{ being_id: "alice", id: "ignored", being_name: "Being" }, "", "loom-alice", "Loom"],
  [{ being_id: "bob", being_name: "Being" }, "", "loom-bob", "Loom"],
  [{ id: "legacy-id", being_name: "Being" }, "", "loom-legacy-id", "Loom"],
  [{ being_name: "Willow" }, "", "loom-Willow", "Loom"],
  [{ being_id: "alice", being_name: "Being" }, "?scene_id=shared-room&scene_label=Shared", "shared-room", "Shared"],
] as const)("preserves browser scene identity for ordinary, retry and splice sends: %j", async (status, query, sceneId, label) => {
  vi.stubGlobal("location", new URL("https://fixture.test/loom.html" + query));
  const sent: Record<string, unknown>[] = [];
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const route = new URL(input).pathname;
    if (route === "/api/status") return Response.json(status);
    if (route === "/api/history") return Response.json({ messages: [] });
    if (route === "/api/stream/active") return new Response(null, { status: 204 });
    if (route === "/health") return new Response("OK fixture");
    if (route !== "/api/chat/stream") return Response.json({ sbs_enabled: false });
    sent.push(JSON.parse(String(init?.body)));
    if (sent.length === 1) return new Response(null, { status: 503 });
    if (sent.length === 3) return Response.json({ spliced: true }, { status: 202 });
    return new Response(new ReadableStream({ start(controller) { stream = controller; } }));
  }));
  const activity = vi.fn();
  const state = new ChatState(), runtime = createChatRuntime(state, { onSceneActivity: activity });
  try {
    await runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.currentScene.sceneId).toBe(sceneId);
    if (!query) {
      expect(inCurrentScene({ sceneId: `loom-${status.being_name}` }, state.currentScene)).toBe(true);
      expect(inCurrentScene({ sceneId: "loom-unrelated" }, state.currentScene)).toBe(false);
      expect(inCurrentScene({ sceneId: `loom-${status.being_name}` }, { ...state.currentScene, strict: true }))
        .toBe(sceneId === `loom-${status.being_name}`);
    }
    await runtime.send("first");
    await vi.advanceTimersByTimeAsync(1200);
    expect(sent).toHaveLength(2);
    await runtime.send("follow-up");
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(3);
    for (const request of sent) expect(request).toMatchObject({
      scene_id: sceneId, scene_meta: { client: "loom/1.8.2", scene_label: label },
    });
    expect(sent.map(request => request.message)).toEqual(["first", "first", "follow-up"]);
    expect(state.items.filter(item => item.kind === "message" && item.role === "system")).toEqual([]);
    const replyScene = "id" in status && status.id === "ignored" ? `loom-${status.being_name}` : sceneId;
    stream!.enqueue(new TextEncoder().encode(`event: content_block_delta\ndata: ${JSON.stringify({ scene_id: replyScene, delta: { text: "reply" } })}\n\n`));
    await vi.advanceTimersByTimeAsync(20);
    expect(state.items.filter(item => item.kind === "message" && item.role === "being"))
      .toMatchObject([{ sceneId, text: "reply" }]);
    expect(Object.keys(activity.mock.lastCall?.[0] || {})).toEqual([sceneId]);
  } finally {
    stream?.close();
    await vi.advanceTimersByTimeAsync(0);
    runtime.dispose();
  }
});

it("isolates same-origin Beings by endpoint without using display names or credentials", () => {
  expect(historyCacheDatabaseName("https://fixture.test/alice?token=first"))
    .toBe(historyCacheDatabaseName("https://fixture.test/alice/?token=rotated"));
  expect(historyCacheDatabaseName("https://fixture.test/alice"))
    .not.toBe(historyCacheDatabaseName("https://fixture.test/bob"));
});
