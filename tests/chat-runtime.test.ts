import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatState } from "../desktop/renderer/chat/models/chat";
import { createChatRuntime } from "../desktop/renderer/chat/services/runtime";
import { ChatProxy } from "../desktop/main/chat/proxy";
import { parseConnection } from "../desktop/main/chat/connection";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Markdown,
  markdownText,
} from "../desktop/renderer/shared/components/markdown";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("location", new URL("https://fixture.test/loom.html"));
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), { visibilityState: "visible" }),
  );
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) =>
    setTimeout(fn, 16),
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const response = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
const flush = () => vi.advanceTimersByTimeAsync(0);

describe("React chat runtime lifecycle", () => {
  it.each(['edit', 'remove', 'read-error'])('does not send stale text or incomplete attachments after %s during file reading', async change => {
    let reader!: { onload(): void; onerror(): void; result: string; readyState: number };
    vi.stubGlobal('FileReader', class {
      static LOADING = 1;
      readyState = 1;
      result = 'data:image/png;base64,YWJj';
      onload = () => {};
      onerror = () => {};
      readAsDataURL() { reader = this; }
    });
    const fetcher = vi.fn(async (url: string) => url.includes('/chat/stream')
      ? new Response('event: message_stop\ndata: {}\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
      : response({ messages: [] }));
    vi.stubGlobal('fetch', fetcher);
    const state = new ChatState(), runtime = createChatRuntime(state);
    state.draft = '原始草稿';
    runtime.handleFiles([new File(['abc'], 'image.png', { type: 'image/png' })]);
    const sending = runtime.send(state.draft);
    expect(fetcher).not.toHaveBeenCalled();
    if (change === 'edit') state.draft = '修改后的草稿';
    if (change === 'remove') runtime.removePending(0);
    reader.readyState = 2;
    if (change === 'read-error') reader.onerror(); else reader.onload();
    try {
      await sending;
      expect(fetcher).not.toHaveBeenCalled();
      expect(state.draft).toBe(change === 'edit' ? '修改后的草稿' : '原始草稿');
      expect(state.files).toHaveLength(change === 'edit' ? 1 : 0);
    } finally { runtime.dispose(); }
  });
  it("binds diagnostic sends to their original Being even if the proxy connection changes", async () => {
    const alice = parseConnection('https://fixture.test/alice/?token=alice-fixture');
    const bob = parseConnection('https://fixture.test/bob/?token=bob-fixture');
    vi.stubGlobal('location', new URL('beings://chat/?history_scope=' + encodeURIComponent(alice.endpoint) + '&scene_id=desktop-diagnostic'));
    const upstream = vi.fn(async () => response({ ok: true }));
    const proxy = new ChatProxy(() => bob, upstream);
    let result = 0;
    vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
      const request = new Request(new URL(input, 'beings://chat'), init);
      const value = await proxy.handle(request); result = value.status; return value;
    });
    const state = new ChatState(), runtime = createChatRuntime(state);
    await runtime.send('Diagnostic fixture', []);
    expect(result).toBe(409);
    expect(upstream).not.toHaveBeenCalled();
    runtime.dispose();
  });
  it("initializes once and aborts requests and every scheduled resource on disposal", async () => {
    const calls: { url: string; signal: AbortSignal }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, signal: init.signal! });
        if (url.includes("/history")) return response({ messages: [] });
        if (url.includes("/stream/active"))
          return new Response(null, { status: 204 });
        if (url.includes("/llm/config"))
          return response({ sbs_enabled: false });
        if (url.endsWith("/health")) return new Response("OK fixture");
        return response({ name: "fixture" });
      }),
    );
    const state = new ChatState(),
      runtime = createChatRuntime(state);
    await runtime.start();
    await flush();
    await runtime.start();
    expect(calls.filter((call) => call.url.includes("/history"))).toHaveLength(
      1,
    );
    expect(state.sbsEnabled).toBe(false);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    runtime.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(calls.every((call) => call.signal.aborted)).toBe(true);
    const count = calls.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(calls).toHaveLength(count);
  });

  it("keeps a retry cancellation signal across POST attempts and stops during backoff", async () => {
    let attempts = 0;
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        if (!url.includes("/chat/stream")) return response({ messages: [] });
        attempts++;
        signals.push(init.signal!);
        throw new TypeError("offline");
      }),
    );
    const state = new ChatState(),
      runtime = createChatRuntime(state);
    const sending = runtime.send("one message");
    await flush();
    expect(attempts).toBe(1);
    await runtime.stopCurrentTurn();
    await sending;
    await vi.advanceTimersByTimeAsync(8000);
    expect(attempts).toBe(1);
    expect(signals[0].aborted).toBe(true);
    expect(state.streaming).toBe(false);
    expect(
      state.items.filter(
        (item) => item.kind === "message" && item.role === "user",
      ),
    ).toHaveLength(1);
    runtime.dispose();
  });

  it("ignores a stale initial SBS read after a confirmed toggle", async () => {
    let finishRead!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        if (init.method === "PATCH")
          return response({ ok: true, config: { sbs_enabled: false } });
        return new Promise<Response>((resolve) => {
          finishRead = resolve;
        });
      }),
    );
    const state = new ChatState(),
      runtime = createChatRuntime(state);
    const read = runtime.loadSbsState();
    await flush();
    await runtime.toggleSbs();
    finishRead(response({ sbs_enabled: true }));
    await read;
    expect(state.sbsEnabled).toBe(false);
    expect(state.sbsKnown).toBe(true);
    runtime.dispose();
  });

  it.each(["current", "all"] as const)("keeps desktop send parameters through scope switches, ordinary sends, retries and splices starting in %s", async initialScope => {
    vi.stubGlobal("location", new URL("beings://chat/loom.html?scene_id=desktop-fixture&scene_label=桌面·PC"));
    const scene = { scene_id: "desktop-fixture", scene_meta: { client: "portal-desktop/0.1.2", scene_label: "桌面·PC" } };
    const sent: Record<string, unknown>[] = [];
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const proxy = new ChatProxy(
      () => parseConnection("https://fixture.test/alice/?token=fixture"),
      async (url, init) => {
        if (!String(url).includes("/chat/stream")) return response({ messages: [] });
        sent.push(await new Request("https://fixture.test", init).json());
        if (sent.length === 1) return new Response('event: content_block_delta\ndata: {"delta":{"text":"第一条回复"}}\n\nevent: message_stop\ndata: {"session_id":"session-fixture"}\n\n', { headers: { "Content-Type": "text/event-stream" } });
        if (sent.length === 2) return new Response(null, { status: 503 });
        if (sent.length === 4) return new Response(null, { status: 202 });
        return new Response(new ReadableStream({
          start(controller) {
            stream = controller;
            controller.enqueue(new TextEncoder().encode('event: meta\ndata: {"stream_id":"stream-fixture","scene_id":"desktop-fixture","trace_id":"trace-fixture"}\n\nevent: content_block_delta\ndata: {"delta":{"text":"正常回复"}}\n\n'));
          },
        }), { headers: { "Content-Type": "text/event-stream" } });
      },
      scene,
    );
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => proxy.handle(new Request(url, init)));
    const state = new ChatState(), runtime = createChatRuntime(state);
    try {
      // An ordinary completed request, then a retrying request held open for a splice.
      state.historyScope = initialScope;
      await runtime.send("第一条");
      // send() resolves after dispatch; SSE completion updates session_id later.
      await flush();
      state.historyScope = initialScope === "current" ? "all" : "current";
      await runtime.refreshHistory(); // Refreshing a different view never changes send identity.
      const sending = runtime.send("继续讨论");
      await flush();
      expect(sent).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1000);
      expect(sent).toHaveLength(3);
      state.historyScope = initialScope;
      await runtime.send("再补充一点", [{ name: "notes.txt", type: "text/plain", size: 3, base64: "YWJj" }]);
      await flush();
      expect(sent).toEqual([
        { message: "第一条", ...scene },
        { message: "继续讨论", session_id: "session-fixture", ...scene },
        { message: "继续讨论", session_id: "session-fixture", ...scene },
        { message: "再补充一点", session_id: "session-fixture", attachments: [{ media_type: "text/plain", data: "YWJj" }], ...scene },
      ]);
      stream.enqueue(new TextEncoder().encode('event: message_stop\ndata: {}\n\n'));
      stream.close();
      await sending;
      expect(state.items.some(item => item.kind === "message" && item.text === "正常回复")).toBe(true);
      expect(JSON.stringify(state.items.map(item => item.kind === "message" ? item.text : ""))).not.toMatch(/desktop-fixture|trace-fixture|scene_meta/);
      expect(state.items.filter(item => item.kind === "message").every(item => item.sceneId === "desktop-fixture")).toBe(true);
    } finally {
      runtime.dispose();
      proxy.abortAll();
    }
  });

  it("preserves the draft and attachments when the desktop scene is unavailable", async () => {
    vi.stubGlobal("location", new URL("beings://chat/"));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const state = new ChatState(), runtime = createChatRuntime(state);
    const files = [{ name: "notes.txt", type: "text/plain", size: 3, base64: "YWJj" }];
    state.draft = "暂存的消息";
    // Populate the composer through its runtime API, not a render-only field.
    vi.stubGlobal('FileReader', class {
      result = 'data:text/plain;base64,YWJj';
      readyState = 2;
      onload = () => {};
      readAsDataURL() { this.onload(); }
    });
    runtime.handleFiles([new File(['abc'], 'notes.txt', { type: 'text/plain' })]);
    await flush();
    try {
      await runtime.send(state.draft, files);
      expect(fetch).not.toHaveBeenCalled();
      expect(state.draft).toBe("暂存的消息");
      expect(state.files).toEqual([expect.objectContaining(files[0])]);
      expect(state.items).toEqual([expect.objectContaining({ role: "system", text: expect.stringContaining("客户端场景不可用") })]);
      expect(state.streaming).toBe(false);
    } finally { runtime.dispose(); }
  });
});

describe("React Markdown boundary", () => {
  it("renders tables, highlighted code and text without executable HTML or unsafe links", () => {
    const content =
      '```javascript\nconst message = "<img onerror=alert(1)>";\n```\n\n| One | Two |\n| --- | --- |\n| A | B |\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n[x](https://user:password@example.com)';
    const html = renderToStaticMarkup(
      createElement(Markdown, { content, chat: true }),
    );
    expect(html).toContain("<table>");
    expect(html).toContain("hljs-keyword");
    expect(html).not.toMatch(
      /<script|<img|href="javascript:|href="https:\/\/user:/,
    );
    expect(html).toContain("&lt;script&gt;");
  });
  it("keeps code references inert and decorates only the first eligible place mention", () => {
    const html = renderToStaticMarkup(
      createElement(Markdown, {
        content: "`seeds`\n\nseeds and seeds",
        chat: true,
        onPlace: () => {},
      }),
    );
    expect(html.match(/class="chat-place-link"/g)).toHaveLength(1);
    expect(html).toContain("<code>seeds</code>");
    expect(markdownText("**标题** &amp; [链接](https://example.com)")).toBe(
      "标题 & 链接",
    );
  });
});
