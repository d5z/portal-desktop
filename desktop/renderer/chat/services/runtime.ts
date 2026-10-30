import { withComposerCommandContext, usesIntelligentUICommand } from './composer-command-context';
import { newToolActivity, completeToolActivity } from '../models/tool-activity';
import { stripLocalFileContext, stripClientMessageContext } from './local-file-context';
import {registerAttachmentSource} from './attachment-source';
import { MAX_ATTACHMENT_BYTES, LEGACY_WEB_ATTACHMENT_BYTES } from '../../../shared/attachment-limits';
import { messageReferences } from './attachment-messages';
import { validateIntelligentUIContext } from "../../shared/intelligent-ui/context";
import { createSceneRuntime } from "./scene-runtime";
import { HistoryCache, normalizeHistoryRows } from "./history-cache";
import { chatHistoryLimit } from '../../../shared/chat-history';
import { inCurrentScene, messageScene, sceneItems, sceneTransitionNotice, stripSceneTransition, type MessageScene } from "../models/scenes";
import type { ChatRuntime, ChatState, RuntimeOptions } from "../models/chat";

/**
 * Loom's streaming, replay and history protocol, independent of rendering.
 * Message references below are domain objects. React is the sole owner of their DOM.
 * Each mounted chat owns one runtime; disposal aborts requests and releases all timers.
 */
export function createChatRuntime(state: ChatState, options: RuntimeOptions = {}): ChatRuntime {
  return createSceneRuntime(state, options, createStreamRuntime);
}

function createStreamRuntime(state: any, options: any): any {
  const lifetime = new AbortController();
  let disposed = false;
  const timeouts = new Set<ReturnType<typeof globalThis.setTimeout>>(),
    intervals = new Set<ReturnType<typeof globalThis.setInterval>>(),
    frames = new Set<number>(),
    cleanups: any[] = [];
  const setTimeout = (fn: any, ms: any) => {
    if (disposed) return null;
    const id = globalThis.setTimeout(() => {
      timeouts.delete(id);
      if (!disposed) fn();
    }, ms);
    timeouts.add(id);
    return id;
  };
  const clearTimeout = (id: any) => {
    globalThis.clearTimeout(id);
    timeouts.delete(id);
  };
  const setInterval = (fn: any, ms: any) => {
    if (disposed) return null;
    const id = globalThis.setInterval(() => {
      if (!disposed) fn();
    }, ms);
    intervals.add(id);
    return id;
  };
  const clearInterval = (id: any) => {
    globalThis.clearInterval(id);
    intervals.delete(id);
  };
  const requestAnimationFrame = (fn: any) => {
    if (disposed) return null;
    const id = globalThis.requestAnimationFrame(() => {
      frames.delete(id);
      if (!disposed) fn();
    });
    frames.add(id);
    return id;
  };
  const cancelAnimationFrame = (id: any) => {
    globalThis.cancelAnimationFrame(id);
    frames.delete(id);
  };
  function listen(target: any, event: any, handler: any) {
    if (!target?.addEventListener) return;
    target.addEventListener(event, handler);
    cleanups.push(() => target.removeEventListener(event, handler));
  }
  function visibilityState() {
    // Tests and non-browser consumers can remove the global document while a
    // previously scheduled health check is still settling. Treat that as a
    // visible page so the health monitor keeps its normal retry semantics.
    return globalThis.document?.visibilityState || "visible";
  }
  let publishQueued = false;
  function changed() {
    if (disposed || publishQueued) return;
    publishQueued = true;
    queueMicrotask(() => {
      publishQueued = false;
      if (!disposed) state.changed();
    });
  }
  const params = new URL(location.href).searchParams;
  const API_URL =
    location.protocol === "beings:"
      ? "beings://chat"
      : options.connection?.api || params.get("api") || location.origin;
  const LOOM_TOKEN =
    location.protocol === "beings:" ? "" : options.connection?.token ?? params.get("token") ?? "";
  const RELAY_SECRET =
    location.protocol === "beings:"
      ? ""
      : options.connection?.relaySecret || params.get("relay_secret") || params.get("secret") || LOOM_TOKEN;
  function apiUrl(path: any) {
    return `${API_URL}${path}${LOOM_TOKEN ? (path.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(LOOM_TOKEN) : ""}`;
  }
  let chatRequestRevision = 0, chatRequestsInFlight = 0;
  function traceNetwork(event: string, details: Record<string, unknown>) {
    // Metadata only: never log URLs with credentials, message bodies or tool arguments.
    console.info('[chat-network]', JSON.stringify({event, at: new Date().toISOString(), sceneId: state.currentScene.sceneId || null, ...details}));
  }
  const fetch = async (input: any, init: any = {}) => {
    lifetime.signal.throwIfAborted();
    const signal = init.signal
      ? AbortSignal.any([init.signal, lifetime.signal])
      : lifetime.signal;
    const requestScene = new Headers(init.headers).get("X-Portal-Scene-Id") || state.currentScene.sceneId;
    const report =
      init.method === "POST" &&
      new URL(input, location.href).pathname === "/api/chat/stream"
        ? await options.beforeSend?.(JSON.parse(init.body).message || "")
        : undefined;
    // Keep a queued send bound to this frame's Being if settings change before
    // it reaches the main-process proxy (including diagnostic sends).
    if (location.protocol === "beings:" && init.method === "POST" && params.get("history_scope")) {
      const headers = new Headers(init.headers);
      headers.set("X-Portal-Being-Endpoint", params.get("history_scope")!);
      if (new URL(input, location.href).pathname === "/api/chat/stream" && requestScene)
        headers.set("X-Portal-Scene-Id", requestScene);
      init = { ...init, headers };
    }
    const path = new URL(input, location.href).pathname;
    const chatSend = path.endsWith('/api/chat/stream') && init.method === 'POST';
    const traced = chatSend || path.endsWith('/api/stream/active');
    const startedAt = Date.now();
    if (chatSend) { chatRequestRevision++; chatRequestsInFlight++; }
    if (traced) traceNetwork('request', {path, method: init.method || 'GET', after: new URL(input, location.href).searchParams.get('after')});
    try {
      const response = await globalThis.fetch(input, { ...init, signal });
      if (traced) traceNetwork('response', {path, status: response.status, durationMs: Date.now() - startedAt});
      report?.(response.ok);
      return response;
    } catch (error: any) {
      if (traced) traceNetwork('network-error', {path, kind: error?.name});
      report?.(false);
      throw error;
    } finally {
      if (chatSend) chatRequestsInFlight--;
    }
  };
  const prefetch: Record<string, any> = {};
  async function takePrefetch(key: any) {
    const pending = prefetch[key];
    delete prefetch[key];
    try {
      return pending ? await pending : null;
    } catch {
      return null;
    }
  }
  function configHeaders() {
    return {
      "Content-Type": "application/json",
      ...(RELAY_SECRET ? { "X-Relay-Secret": RELAY_SECRET } : {}),
    };
  }
  async function readJsonResponse(res: any) {
    const text = await res.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return { error: text };
    }
  }
  let configStatusTimer: any = null,
    configReadRevision = 0;
  function setConfigStatus(text: any, className = "") {
    clearTimeout(configStatusTimer);
    state.configStatus = text;
    state.configStatusClass = className;
    changed();
  }
  async function loadLlmConfig() {
    const revision = ++configReadRevision,
      sbsRevision = sbsConfigRevision;
    state.configLoading = true;
    changed();
    try {
      const res = await fetch(apiUrl("/api/llm/config"), { cache: "no-store" });
      const cfg = await readJsonResponse(res);
      if (!res.ok) throw new Error(cfg.error || "无法读取模型设置，请检查 Being 连接。");
      if (revision !== configReadRevision) return;
      state.config = cfg;
      if (
        sbsRevision === sbsConfigRevision &&
        typeof cfg.sbs_enabled === "boolean"
      )
        setSbsEnabled(cfg.sbs_enabled, false);
    } catch (e: any) {
      if (!disposed && revision === configReadRevision)
        setConfigStatus(e.message, "error");
    } finally {
      if (revision === configReadRevision) {
        state.configLoading = false;
        changed();
      }
    }
  }
  async function applyConfigChange(patch: any) {
    ++configReadRevision;
    state.configLoading = false;
    setConfigStatus("正在应用设置…", "applying");
    try {
      const res = await fetch(apiUrl("/api/llm/config"), {
        method: "PATCH",
        headers: configHeaders(),
        body: JSON.stringify(patch),
      });
      const data = await readJsonResponse(res);
      if (data.needs_key) {
        setConfigStatus(data.error || "请填写该服务商的 API 密钥。", "error");
        return data;
      }
      if (!res.ok || !data.ok) {
        setConfigStatus(data.error || "设置未能保存，请稍后重试。", "error");
        return { ...data, ok: false, http_status: data.http_status || res.status };
      }
      if (data.config) state.config = data.config;
      setConfigStatus(
        data.rolled_back ? "已恢复上次可用配置" : "设置已更新",
        "success",
      );
      configStatusTimer = setTimeout(() => setConfigStatus(""), 3000);
      return data;
    } catch (e: any) {
      if (!disposed) setConfigStatus(e.message, "error");
      return null;
    }
  }
  let currentRun: any = null;
  type PendingReply = { baseline: Set<any>; submittedAt: number; phase: "queued" | "processing" | "reply"; autonomousOrigin?: string; interrupted?: boolean; idleSince?: number; idleObservedAt?: number };
  let pendingReply: PendingReply | null = null;
  let replyRunSettled = false;
  let replayTransportOnly = false;
  let autonomousStream = false;
  let autonomousOrigin: string | undefined;
  let autonomousHandedOff = false;
  let replayingSettledReply = false;
  let replayingInitialEvents = false;
  let replayRunStartedAt: number | undefined;
  function setStreamScene(scene: any) {
    state.activeScene = {
      ...scene,
      sceneLabel: scene.sceneLabel || (scene.sceneId === state.currentScene.sceneId ? state.currentScene.sceneLabel : undefined),
    };
    changed();
  }
  function updateMessage(message: any, text: any) {
    if (!message) return;
    message.text = !message.streaming && message.persistedText !== undefined ? message.persistedText : text;
    changed();
  }
  function setMessageStreaming(message: any, streaming: any) {
    if (!message) return;
    message.streaming = streaming;
    if (!streaming && message.persistedText !== undefined) message.text = message.persistedText;
    changed();
  }
  type SpeechFragment = { message: any; text: string };
  let progressBubbles: SpeechFragment[] = [];
  const handledPersisted = new Set<number>();
  const pendingPersistedGroups = new Map<number, { fragments: SpeechFragment[]; persisted: any }>();
  function splitStreamProgress(type: string, data: any) {
    const reasoning = (type === "thinking" || type === "reasoning") &&
      typeof (data.text || data.delta?.text || data.delta) === "string" &&
      (data.text || data.delta?.text || data.delta).trim();
    if (!streamMessage || !streamText || (type !== "tool_use" && !reasoning)) return;
    if (renderTimer) {
      cancelAnimationFrame(renderTimer);
      renderTimer = null;
    }
    const visible = cleanContent(streamText);
    if (visible) {
      updateMessage(streamMessage, visible);
      streamMessage.interim = true;
      progressBubbles.push({ message: streamMessage, text: streamText });
      setMessageStreaming(streamMessage, false);
      noteLocalEcho("being", streamText, state.activeScene, streamMessage);
    } else removeMessage(streamMessage);
    streamReplyPrefix += streamText;
    streamMessage = null;
    streamText = "";
  }
  function noteStreamEcho() {
    noteLocalEcho("being", streamText, state.activeScene, streamMessage,
      streamReplyPrefix ? [streamReplyPrefix + streamText] : []);
    streamReplyPrefix = "";
    progressBubbles = [];
  }
  function removeMessage(message: any) {
    if (!message) return;
    state.items = state.items.filter((item: any) => item !== message);
    changed();
  }
  function moveRun() {
    // The aggregate callback summary stays at its original position. Moving it
    // on each continuation can jump past newer room messages and history anchors.
    if (currentRun?.autonomousOrigin) return;
    if (currentRun && !currentRun.end && state.items.at(-1) !== currentRun) {
      state.items = state.items.filter((item: any) => item !== currentRun);
      state.items.push(currentRun);
    }
  }
  function updateRun(finished = false) {
    if (replayingSettledReply) return;
    if (replayTransportOnly && !pendingReply) return;
    if (replyRunSettled) return;
    if (!currentRun || currentRun.end) {
      if ((!isStreaming && !pendingReply) || finished) return;
      currentRun = {
        ...state.activeScene,
        kind: "run",
        autonomousOrigin: autonomousStream ? autonomousOrigin : undefined,
        streamId: currentStreamId || undefined,
        id: `run-${options.nextId()}`,
        entries: [],
        start: replayRunStartedAt ?? Date.now(),
        label: "思考中",
        hint: "",
        context: turnContext,
        arg: "",
      };
      state.items.push(currentRun);
      replayRunStartedAt = undefined;
    }
    const run = currentRun;
    moveRun();
    if (actionLog.length || !run.entries.length || isStreaming)
      run.entries = actionLog.map((entry) => ({ ...entry }));
    const waiting = (pendingReply && pendingReply.phase !== "processing") || (!isStreaming && Boolean(pendingRecovery || pendingReply));
    const lastTool = [...run.entries]
      .reverse()
      .find((entry) => entry.type === "tool" && !entry.done);
    run.waitingForReply = !!pendingReply && waiting;
    run.arg = tuiCurrentArg;
    run.hint = tuiHintText;
    if (finished || (!isStreaming && !waiting)) {
      run.end = Date.now();
      run.outcome = userStoppedStream
        ? "stopped"
        : streamStatus === "error"
          ? "error"
          : "done";
      run.label = userStoppedStream
        ? "已停止"
        : streamStatus === "error"
          ? "运行中断"
          : finished
            ? "已处理"
            : "已结束";
      run.hint = "";
      run.status = run.outcome;
    } else {
      run.status = waiting
        ? pendingReply ? pendingReply.phase === "queued" ? "queued" : "waiting" : "reconnecting"
        : livePhase === "tool" && lastTool ? "working" : livePhase === "text" ? "replying" : "thinking";
      run.label = waiting
        ? pendingReply ? pendingReply.phase === "queued"
          ? pendingReply.interrupted && !pendingReply.autonomousOrigin ? '消息已接收，正在调整回复方向…' : `${pendingReply.autonomousOrigin === 'callback' ? 'SBS 自主回调进行中；' : pendingReply.autonomousOrigin ? 'SBS 自主处理进行中；' : ''}消息已接收，正在切换到当前对话…`
          : "等待最终回复" : "正在恢复连接"
        : livePhase === "tool" && lastTool
          ? `正在运行 ${lastTool.name || "工具"}`
          : livePhase === "text"
            ? "正在回复"
            : tuiCurrentState && tuiCurrentState !== "在思考"
              ? tuiCurrentState
              : "思考中";
    }
  }
  // Config（_pathBase / API_URL / LOOM_TOKEN / RELAY_SECRET / apiUrl 见文件顶部预取 script）
  let sessionId: any = null;
  let isStreaming = false,
    streamMessage: any = null,
    streamText = "";
  // Exact text of completed progress segments in this reply, used only to
  // reconcile servers that persist progress and the final answer as one row.
  let streamReplyPrefix = "";
  let renderTimer: any = null;
  let beingName = state.name;

  // ---- Connection state machine (P1-4) ----
  // 替换原来的 `connected` 布尔 + 散落的 setStatus 调用。
  // 'connecting' | 'online' | 'degraded' | 'reconnecting' | 'offline'
  let connState = state.connection || "connecting";
  let streamStatus = "connected"; // 由 setStatus 维护的"流状态"：connected / thinking / error
  let healthTimer: any = null;
  let healthBackoff = 0;
  let healthInFlight = false;
  let serverCommit: any = null;
  const HEALTH_BACKOFF_MS = [1000, 2000, 4000, 8000, 15000, 30000, 60000];
  const HEALTH_OK_INTERVAL_MS = 15000;
  const jitter = (ms: any) => Math.round(ms * (0.75 + Math.random() * 0.5)); // ±25%，防惊群
  let pendingFiles: any[] = [];
  const pendingFileReads = new Set();
  let preparingSend = false;
  let toolCount = 0,
    connectTime: any = null;
  let lastMessageTime: any = null;
  let currentAbortController: any = null;
  let currentStreamId: any = null;
  let lastStreamId: any = null; // 断线恢复需要它——currentStreamId 会在收尾时被清掉
  // F1: 外部（非 watchdog）发起的 cutover 会 abort 正在跑的 live reader。
  // reader 的 catch 靠这个槽把 AbortError 认成"已经交接给 replay 通道"，
  // 而不是走 handleStreamError → finalizeSendCleanup（那会把 isStreaming 打回 false，
  // 连刚起来的 poller 一起杀掉）。
  let externalCutover = null;
  // F2: 写者所有权令牌。streamMessage / streamText 同一时刻只允许一个写者。
  // 每个 reader / poller 启动时 ++writerEpoch 并记住自己的号；写之前对一次号，
  // 对不上就静默丢弃。任何路径上的重叠都因此变得无害。
  let writerEpoch = 0;

  let activeStreamPollTimer: any = null;

  // ---- Live stream progress (P1-2) ----
  // liveSeq counts replay events, including continuation/persisted meta, excluding transport meta.
  let liveSeq = 0;
  let streamWatchdogAborted = false;
  let userStoppedStream = false;

  // ---- Status dot ----
  // setStatus 表达"流状态"，setConnState 表达"连接状态"。连接不健康时连接状态优先，
  // 这样流里的 setStatus('thinking') 不会把重连中的黄点冲掉。
  function effectiveDotClass() {
    if (connState === "offline") return "error";
    if (
      connState === "reconnecting" ||
      connState === "degraded" ||
      connState === "connecting"
    ) {
      return "reconnecting";
    }
    return streamStatus || "connected";
  }

  // ── SBS switch: the dot is the switch ──
  // The dot already carries the connection state (colour); SBS rides on top of it
  // as liveliness — breathing when the being's own heartbeat runs, dim and still
  // when it only wakes for you. applyDotClass publishes both layers together.
  let sbsEnabled = state.sbsEnabled;
  let sbsTransition = ""; // '' | 'waking' | 'sleeping'
  let sbsTransitionTimer: any = null;
  let sbsToggling = false;
  let sbsConfigRevision = 0;
  let sbsLoading: any = null;

  function applyDotClass() {
    if (options.historyOwner?.()) sbsEnabled = state.sbsEnabled;
    state.sbsEnabled = sbsEnabled;
    state.dotClass = [
      effectiveDotClass(),
      sbsTransition ||
        (!sbsEnabled && effectiveDotClass() !== "thinking" ? "sbs-off" : ""),
    ]
      .filter(Boolean)
      .join(" ");
    changed();
  }

  // `animate` is false on load — a dot that ripples every time you open Loom
  // would be announcing a state change that did not happen.
  function setSbsEnabled(enabled: any, animate: any) {
    const changed = enabled !== sbsEnabled;
    sbsEnabled = enabled;
    sbsConfigRevision++;
    state.sbsKnown = true;
    options.onSbs?.(enabled);
    clearTimeout(sbsTransitionTimer);
    if (!animate || !changed) {
      sbsTransition = "";
      applyDotClass();
      return;
    }
    sbsTransition = enabled ? "waking" : "sleeping";
    applyDotClass();
    // Keyframe durations live in CSS (#status-dot.waking / .sleeping); these must
    // match, otherwise the class is dropped mid-animation and the dot snaps.
    sbsTransitionTimer = setTimeout(
      () => {
        sbsTransition = "";
        applyDotClass();
      },
      enabled ? 600 : 800,
    );
  }

  async function toggleSbs() {
    if (sbsToggling) return;
    sbsToggling = true;
    try {
      const next = !sbsEnabled;
      const data = await applyConfigChange({
        sbs_enabled: next ? "on" : "off",
      });
      // Trust the server's echo, not our optimistic guess: a rejected patch must
      // leave the dot showing what the being is actually doing.
      if (data && data.ok && typeof data.config?.sbs_enabled === "boolean") {
        setSbsEnabled(data.config.sbs_enabled, true);
      }
    } finally {
      sbsToggling = false;
    }
  }

  function loadSbsState() {
    const owner = options.historyOwner?.();
    if (owner) return owner.loadSbsState();
    // Initial loading and the desktop refresh can ask together. Share that read,
    // and never let an older response undo a newer confirmed config change.
    if (sbsLoading) return sbsLoading;
    const revision = sbsConfigRevision;
    sbsLoading = (async () => {
      try {
        const res = await fetch(apiUrl("/api/llm/config"), {
          cache: "no-store",
        });
        if (!res.ok) return;
        const cfg = await readJsonResponse(res);
        if (revision !== sbsConfigRevision) return sbsEnabled;
        if (typeof cfg.sbs_enabled !== "boolean") return;
        setSbsEnabled(cfg.sbs_enabled, false);
        return cfg.sbs_enabled;
      } catch (_: any) {
        return undefined;
      } finally {
        sbsLoading = null;
      }
    })();
    return sbsLoading;
  }

  function setStatus(state: any) {
    streamStatus = state;
    applyDotClass();
    updateSendButton();
  }

  const CONN_BANNER: Record<string, string | null> = {
    connecting: null,
    online: null,
    degraded: "连接不稳定，正在重试…",
    reconnecting: "重连中…",
    offline: "已离线，恢复网络后会自动继续",
  };

  function setConnState(next: any, detail: any = null) {
    if (connState === next) return;
    connState = next;
    state.connection = next;
    state.banner = CONN_BANNER[next]
      ? CONN_BANNER[next] + (detail ? `（${detail}）` : "")
      : "";
    options.onConnection?.(next);
    applyDotClass();
    updateSendButton();
  }

  // ═══ TUI Activity Bar ═══
  let tuiTimer: any = null;
  let tuiElapsedTimer: any = null;

  const tuiLabels: Record<string, string> = {
    thinking: "在思考",
    remember: "在回忆",
    learn: "在反思",
    search_web: "在搜索",
    browse_web: "在浏览",
    read_file: "在阅读",
    write_file: "在编写",
    run_command: "在执行",
    list_files: "在查看",
    portal_exec: "在执行",
    act: "在行动",
  };

  let tuiCurrentState: any = null;
  let tuiCurrentArg = "";
  let turnContext = "";

  // ── Per-breath activity log ─────────────────────────────────
  // Entries:
  //   { type: 'think', preview: string, ts: number, done?: boolean, duration?: number }
  //   { type: 'tool',  name, label, arg, ts, result?, error?, done? }
  let actionLog: any[] = [];
  const ACTION_LOG_MAX = 50;
  let activityLogClearTimer: any = null;
  let renderActivityLogTimer: any = null;
  let renderActivityLogPending = false;

  function truncate(s: any, n: any) {
    if (!s) return "";
    s = String(s);
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  function basename(p: any) {
    if (!p) return "";
    const s = String(p);
    const idx = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
    return idx >= 0 ? s.slice(idx + 1) : s;
  }

  function extractKeyArg(input: any) {
    if (!input || typeof input !== "object") return "";
    // Prefer well-known keys per tool shape; fall back to first string value.
    if (typeof input.query === "string") return truncate(input.query, 60);
    if (typeof input.path === "string") return basename(input.path);
    if (typeof input.file_path === "string") return basename(input.file_path);
    if (typeof input.command === "string") return truncate(input.command, 50);
    if (typeof input.url === "string") {
      try {
        return new URL(input.url).hostname;
      } catch (_: any) {
        return truncate(input.url, 40);
      }
    }
    if (typeof input.topic === "string") return truncate(input.topic, 40);
    if (typeof input.content === "string") return truncate(input.content, 40);
    for (const v of Object.values(input)) {
      if (typeof v === "string" && v) return truncate(v, 40);
      if (typeof v === "number" || typeof v === "boolean") return String(v);
    }
    return "";
  }

  function parseToolInput(raw: any) {
    if (raw == null) return {};
    if (typeof raw === "object") return raw;
    if (typeof raw !== "string") return {};
    try {
      return JSON.parse(raw);
    } catch (_: any) {
      return {};
    }
  }

  function actionLogPush(entry: any) {
    entry.ts = entry.ts || Date.now();
    actionLog.push(entry);
    // Never evict an in-flight call that still needs its result paired.
    while (actionLog.length > ACTION_LOG_MAX) {
      const completed = actionLog.findIndex(item => item.done);
      if (completed < 0) break;
      actionLog.splice(completed, 1);
    }
    scheduleRenderActivityLog();
  }

  // Live SSE, routed events and replay share tool identity and result semantics.
  function recordToolStart(data: any) {
    const entry = newToolActivity(actionLog, data, `tool-${options.nextId()}`, Date.now());
    if (!entry) return;
    removeThinkingIndicator();
    toolCount++;
    const prev = actionLog.at(-1);
    if (prev?.type === "think" && !prev.done) {
      prev.done = true;
      prev.duration = Math.max(1, Math.round((Date.now() - prev.ts) / 1000));
    }
    entry.arg = extractKeyArg(parseToolInput(data.input));
    entry.label = tuiLabels[entry.name!] || "在行动";
    actionLogPush(entry);
    tuiSet(entry.name, null, { arg: entry.arg });
    setStatus("thinking");
  }

  function recordToolResult(data: any) {
    const entry = completeToolActivity(actionLog, data);
    const pending = actionLog.find(item => item.type === "tool" && !item.done);
    // A completed parallel tool must not shorten the watchdog budget for its peers.
    livePhase = pending ? "tool" : "reasoning";
    livePendingTool = pending?.name || null;
    if (pending) tuiSet(pending.name, null, { arg: pending.arg });
    else if (entry?.error) {
      tuiSet("error", (tuiLabels[entry.name!] || entry.name || "行动") + " ✗");
      tuiTimer = setTimeout(() => tuiSet("thinking"), 1500);
    } else tuiSet("thinking");
    scheduleRenderActivityLog();
  }

  function actionLogFinalizePending() {
    // A reply boundary is not a tool result. Leave unresolved tools unconfirmed.
    const now = Date.now();
    for (const a of actionLog) {
      if (!a.done && a.type === "think") {
        a.done = true;
        if (a.type === "think")
          a.duration = Math.max(1, Math.round((now - a.ts) / 1000));
      }
    }
  }

  function actionLogClear() {
    actionLog = [];
    if (activityLogClearTimer) {
      clearTimeout(activityLogClearTimer);
      activityLogClearTimer = null;
    }
    if (renderActivityLogTimer) {
      clearTimeout(renderActivityLogTimer);
      renderActivityLogTimer = null;
    }
    renderActivityLogPending = false;
    changed();
  }

  function scheduleRenderActivityLog() {
    if (renderActivityLogTimer) {
      renderActivityLogPending = true;
      return;
    }
    renderActivityLog();
    renderActivityLogTimer = setTimeout(() => {
      renderActivityLogTimer = null;
      if (renderActivityLogPending) {
        renderActivityLogPending = false;
        // Render once and start another cooldown window.
        scheduleRenderActivityLog();
      }
    }, 200);
  }

  function renderActivityLog() {
    updateRun();
    changed();
  }

  function tuiSet(stateName: any, label: any = null, opts: any = {}) {
    tuiCurrentState = label || tuiLabels[stateName] || "在行动";
    tuiCurrentArg = opts.arg || "";
    clearTimeout(tuiTimer);
    clearInterval(tuiElapsedTimer);
    tuiElapsedTimer = setInterval(() => {
      if (isStreaming) updateStallHint(stalledForMs());
      updateRun();
      changed();
    }, 1000);
    updateRun();
    changed();
  }

  // ---- Stall hints (P1-7) -----------------------------------------------------
  // 分级提示：先什么都不说，超过预算 60% 才轻声解释，probe 判定 stalled 才明确告知在做什么。
  let tuiHintText = "";

  function setTuiHint(text: any) {
    const next = text || "";
    if (tuiHintText === next) return;
    tuiHintText = next;
    updateRun();
    changed();
  }

  function clearTuiHint() {
    setTuiHint("");
  }

  // 由 watchdog 和 tui 计时器共同驱动的"温和升级"提示
  function updateStallHint(stalledFor: any) {
    if (!isStreaming) return;
    const budget = stallBudgetMs();
    if (stalledFor < budget * 0.6) {
      clearTuiHint();
      return;
    }
    const secs = Math.round(stalledFor / 1000);
    if (livePhase === "tool") {
      setTuiHint(`${livePendingTool || "工具"} 执行中（${secs}s）…`);
    } else if (livePhase === "awaiting_first") {
      setTuiHint(`还没收到第一个回应（${secs}s），正在检查连接…`);
    } else {
      setTuiHint(`还在等待回应（${secs}s），正在检查连接…`);
    }
  }

  function tuiClear() {
    if (!tuiElapsedTimer && tuiCurrentState === null && !tuiCurrentArg && !tuiHintText) return;
    clearInterval(tuiElapsedTimer);
    tuiElapsedTimer = null;
    tuiCurrentState = null;
    tuiCurrentArg = "";
    tuiHintText = "";
    updateRun();
    changed();
  }

  function tuiDone() {
    actionLogFinalizePending();
    updateRun(!isStreaming && !pendingReply);
    clearInterval(tuiElapsedTimer);
    tuiElapsedTimer = null;
    clearTimeout(tuiTimer);
    tuiTimer = setTimeout(tuiClear, 1500);
    // Keep the completed snapshot with its turn; clear live entries only after completion.
    actionLogFinalizePending();
    scheduleRenderActivityLog();
    if (activityLogClearTimer) clearTimeout(activityLogClearTimer);
    if (!isStreaming) activityLogClearTimer = setTimeout(actionLogClear, 3000);
  }

  // ---- Messages ----
  let lastRole: any = null;
  let lastSceneId: any;
  function addMessage(
    role: any,
    text: any,
    streaming = false,
    timestamp: any = null,
    isoTime: any = null,
    scene: any = role === "being" ? state.activeScene : state.currentScene,
  ) {
    if (disposed) return null;
    if (!streaming && role !== "system") text = cleanContent(role === "user" ? stripSceneTransition(stripClientMessageContext(text)) : text);
    if (!text && !streaming) return null; // skip empty after cleaning

    const ts = timestamp || formatTime();
    const label = role === "user" ? "you" : beingName;

    // Resolve message epoch for gap detection
    const msgTime = isoTime
      ? new Date(isoTime).getTime()
      : timestamp
        ? null
        : Date.now();
    // A global SBS reply may have been added by a different runtime. Include
    // the visible timeline so its newer timestamp breaks an old scene gap.
    const prevMessageTime = sceneItems(state.items, state.historyScope, state.currentScene, state.showSbsMessages)
      .reduce((latest: number, item: any) => item.kind === 'message' && Number.isFinite(item.createdAt)
        ? Math.max(latest, item.createdAt) : latest, lastMessageTime || 0);

    // Time gap if >5min since last message — applies to both live and history
    let hasTimeGap = false;
    let breaksRoleGroup = false;
    if (prevMessageTime && msgTime) {
      const gap = msgTime - prevMessageTime;
      breaksRoleGroup = gap > 60000;
      if (gap > 300000) {
        hasTimeGap = true;
      }
    }
    if (msgTime) lastMessageTime = Math.max(lastMessageTime || 0, msgTime);

    // Break consecutive grouping if there's a time gap (being's moments should be separate)
    const consecutive =
      role === lastRole && scene.sceneId === lastSceneId && role !== "system" && !hasTimeGap && !breaksRoleGroup;
    lastRole = role;
    lastSceneId = scene.sceneId;

    const messageId = `message-${options.nextId()}`;
    const message = {
      ...scene,
      kind: "message",
      id: messageId,
      replyId: role === "being" && streaming ? (progressBubbles[0]?.message.replyId || messageId) : undefined,
      turnId: role === "user" ? `turn-${options.nextId()}` : undefined,
      role,
      text,
      streaming,
      timestamp: ts,
      createdAt: msgTime || undefined,
      label,
      consecutive,
    };
    state.items.push(message);
    moveRun();
    changed();
    return message;
  }

  // History markers describe an autonomous breath transition; render them as a
  // separator so SBS activity is visible without pretending it was a chat bubble.
  function isHistoryMarker(m: any) {
    return !!m && (m.from === "system" || m.type === "marker");
  }
  const BREATH_MARKER_LABELS: Array<[RegExp, string]> = [
    [/^\[breath yielded/i, "放下手头的事，转向你"],
    [/^\[breath interrupted/i, "已停止"],
    [/^\[breath superseded/i, "被新的对话取代"],
  ];
  function breathMarkerLabel(text: any) {
    const raw = (text || "").trim();
    for (const [re, label] of BREATH_MARKER_LABELS)
      if (re.test(raw)) return label;
    return raw.replace(/^\[|\]$/g, "");
  }
  function mergeContinuationMarker(text: any, scene: any) {
    if (!/^\[breath yielded/i.test(text || "") || !Number.isFinite(scene.createdAt)) return false;
    const marker = state.items.find((item: any) => item.continuationMarker && !item.historySeq &&
      echoScenesMatch(item, scene) && scene.createdAt >= item.interruptStartedAt &&
      scene.createdAt <= item.createdAt);
    if (!marker) return false;
    Object.assign(marker, scene);
    orderHistoryItem(marker);
    changed();
    return true;
  }
  function showContinuationMarker(data: any) {
    if (data?.continuation !== true) return;
    const scene = Object.prototype.hasOwnProperty.call(data, "scene_id") ? messageScene(data) : state.activeScene;
    const user = [...state.items].reverse().find((item: any) =>
      item.kind === "message" && item.role === "user" && echoScenesMatch(item, scene));
    // A continuation can be replayed after refresh. Anchor it to the user turn,
    // rather than requiring the ephemeral pendingReply to survive the reload.
    if (!user) return;
    if (replayingInitialEvents && Number.isFinite(user.createdAt)) replayRunStartedAt = Math.min(Date.now(), user.createdAt);
    const key = user.id;
    if (state.items.some((item: any) => item.continuationTurn === key ||
      (item.marker && item.historySeq && item.text.includes("转向你") &&
       echoScenesMatch(item, scene) && (item.createdAt >= user.createdAt ||
         // Heart persists the yield marker immediately BEFORE the inserted user row.
         (user.historySeq && item.historySeq === user.historySeq - 1))))) return;
    const now = Date.now();
    state.items.push({ ...scene, kind: "separator", id: `marker-${options.nextId()}`,
      marker: true, handoffMarker: true, continuationMarker: true, continuationTurn: key,
      interruptStartedAt: user.createdAt, createdAt: now,
      text: `· 放下手头的事，转向你 · ${formatTime()} ·` });
    changed();
  }
  function addBreathMarker(text: any, timestamp: any = null, scene: any = {}) {
    if (mergeContinuationMarker(text, scene)) return;
    const marker = {
      ...scene,
      kind: "separator",
      id: `marker-${options.nextId()}`,
      marker: true,
      handoffMarker: /^\[breath yielded/i.test(text || ''),
      text: `· ${breathMarkerLabel(text)} · ${timestamp || formatTime()} ·`,
    };
    const index = Number.isFinite(scene.createdAt) ? state.items.findIndex((item: any) =>
      (item.createdAt ?? item.start ?? -Infinity) > scene.createdAt) : -1;
    state.items.splice(index < 0 ? state.items.length : index, 0, marker);
    orderHistoryItem(marker);
    lastRole = "system";
    changed();
  }

  /** Both SSE and replay share one visual writer. After the first bubble,
   * token bursts update the store only once per animation frame. */
  function appendStreamText(text: string) {
    removeThinkingIndicator();
    tuiClear();
    // A final answer can resume after the waiting indicators already cleared.
    // Refresh the phase once without copying the tool log for every token.
    if (currentRun?.status !== 'replying') updateRun();
    streamText += text;
    if (!streamMessage) {
      const visible = cleanContent(streamText);
      if (visible) streamMessage = addMessage("being", visible, true);
    } else if (!renderTimer) {
      const rafEpoch = writerEpoch;
      renderTimer = requestAnimationFrame(() => {
        renderTimer = null;
        if (rafEpoch !== writerEpoch) return;
        if (streamMessage && streamText) {
          const visible = cleanContent(streamText);
          if (visible) updateMessage(streamMessage, visible);
        }
      });
    }
  }

  function showThinkingIndicator() {
    if (state.thinking) return;
    state.thinking = true;
    changed();
  }

  function removeThinkingIndicator() {
    if (!state.thinking) return;
    state.thinking = false;
    changed();
  }

  function formatTime() {
    return formatMessageTime(new Date());
  }
  function formatHistoryTime(iso: any) {
    return formatMessageTime(new Date(iso), iso);
  }
  function formatMessageTime(date: any, fallback = "") {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return fallback;
    const pad = (value: any) => String(value).padStart(2, "0");
    const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    const today = new Date();
    if (date.getFullYear() === today.getFullYear() &&
        date.getMonth() === today.getMonth() &&
        date.getDate() === today.getDate()) return time;
    return `${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日 ${time}`;
  }
  // Filter out DSML/tool_call raw content
  function cleanContent(text: any) {
    if (!text) return "";
    const fences: any[] = [];
    text = text.replace(/```[\s\S]*?```/g, (block: any) => {
      const key = `@@FENCE_${fences.length}@@`;
      fences.push(block);
      return key;
    });
    const trimmed = text.trim();
    const rawToolJson =
      /"name"\s*:\s*"(?:act|remember|learn)"\s*,\s*"args"\s*:/;
    if (/^[\[{]/.test(trimmed) && rawToolJson.test(trimmed)) return "";
    // Remove DSML lines — both half-width | and full-width ｜
    text = text.replace(/^.*[|｜] *DSML *[|｜].*$/gm, "");
    // Remove raw tool_calls XML blocks (both formats)
    text = text.replace(
      /<tool_(?:calls|use|result)[\s\S]*?<\/tool_(?:calls|use|result)>/gi,
      "",
    );
    text = text.replace(/<\/?tool_calls>/gm, "");
    text = text.replace(/<[｜|][｜|]DSML[｜|][｜|]tool_calls>/gm, "");
    // Remove </invoke> style closers
    text = text.replace(/<\/[｜|][｜|]DSML[｜|][｜|]invoke>/gm, "");
    // Remove single-line raw JSON tool calls that sometimes leak from the stream.
    text = text.replace(
      /^\s*\{.*"name"\s*:\s*"(?:act|remember|learn)".*"args"\s*:.*\}\s*,?\s*$/gm,
      "",
    );
    // Remove explicit system wrapper noise without touching normal prose or code fences.
    text = text.replace(/<system[\s\S]*?<\/system>/gi, "");
    text = text.replace(
      /^\s*(?:\[system\]|system:)\s*(?:internal|debug|tool|prompt|instruction).*/gim,
      "",
    );
    text = text.replace(/@@FENCE_(\d+)@@/g, (_: any, i: any) => fences[Number(i)] || "");
    // Clean up excessive blank lines left behind
    text = text.replace(/\n{3,}/g, "\n\n").trim();
    return text;
  }

  // ---- Files ----
  function handleFiles(fileList: any) {
    for (const file of fileList) {
      if (pendingFiles.length >= 100) { addMessage('system', '每条消息最多添加 100 个附件'); break; }
      if (!file.size) { addMessage('system', '不能添加空文件：' + file.name); continue; }
      const desktop = location.protocol === 'beings:';
      const maxBytes = desktop ? MAX_ATTACHMENT_BYTES : LEGACY_WEB_ATTACHMENT_BYTES;
      if (file.size > maxBytes) {
        addMessage('system', `每个附件最大 ${maxBytes / 1024 / 1024} MiB：${file.name}`);
        continue;
      }
      if (desktop) {
        const pending = {name:file.name, type:file.type, size:file.size, base64:'', blob:file, previewUrl:undefined as string | undefined,sourceToken:undefined as string | undefined};
        if (/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
          pending.previewUrl = URL.createObjectURL(file);
          const url = pending.previewUrl; cleanups.push(() => URL.revokeObjectURL(url));
        }
        const reading=registerAttachmentSource(file).then(token=>{pending.sourceToken=token;}).catch(()=>{});
        pendingFileReads.add(reading);void reading.finally(()=>pendingFileReads.delete(reading));
        pendingFiles.push(pending); renderPendingFiles(); continue;
      }
      const pending = {
        name: file.name,
        type: file.type,
        size: file.size,
        base64: "",
        loading: true,
      };
      pendingFiles.push(pending);
      renderPendingFiles();
      const reader = new FileReader();
      let fail = () => {};
      const reading = new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        reader.onload = () => {
          if (!disposed && pendingFiles.includes(pending)) {
            const result = typeof reader.result === "string" ? reader.result : "";
            pending.base64 = result.split(",")[1] || result;
            pending.loading = false;
            renderPendingFiles();
          }
          finish();
        };
        fail = () => {
          if (!disposed) {
            pendingFiles = pendingFiles.filter((item) => item !== pending);
            renderPendingFiles();
            addMessage("system", "⚠ 无法读取附件：" + file.name);
          }
          finish();
        };
        reader.onerror = fail;
        reader.onabort = finish;
      });
      pendingFileReads.add(reading);
      reading.finally(() => pendingFileReads.delete(reading));
      cleanups.push(() => {
        if (reader.readyState === FileReader.LOADING) reader.abort();
      });
      try { reader.readAsDataURL(file); }
      catch { fail(); }
    }
  }
  async function waitForPendingFiles() {
    while (pendingFileReads.size)
      await Promise.allSettled([...pendingFileReads]);
  }
  async function prepareSend(filesOverride: any, snapshot: any = null) {
    if (Array.isArray(filesOverride) || !pendingFileReads.size) return true;
    const draftBeforeRead = snapshot?.draft ?? state.draft;
    const filesBeforeRead = snapshot?.files ?? [...pendingFiles];
    await waitForPendingFiles();
    if (state.draft !== draftBeforeRead || pendingFiles.length !== filesBeforeRead.length ||
        filesBeforeRead.some((file: any, index: any) => pendingFiles[index] !== file)) {
      addMessage("system", "草稿或附件已变更，请确认后重新发送。");
      return false;
    }
    return true;
  }
  function renderPendingFiles() {
    state.files = [...pendingFiles];
    updateSendButton();
  }
  function removePending(idx: any) {
    const [removed] = pendingFiles.splice(idx, 1);
    if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
    renderPendingFiles();
  }

  // ---- Send ----
  function clearComposer() {
    state.draft = "";
    state.intelligentUIForMessage = false;
    for (const file of pendingFiles) if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
    pendingFiles = [];
    renderPendingFiles();
  }

  function sleepAbortable(ms: any, signal: any) {
    if (signal?.aborted)
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    return new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      if (signal) {
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(t);
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      }
    });
  }

  /**
   * @param {string | URL | Request} url
   * @param {() => RequestInit} makeOptions
   * @param {{ maxNetworkRetries?: number; maxServerRetries?: number; onRetry?: (details: { attempt: number; type: "server" | "network"; status?: number; error?: unknown }) => void | Promise<void> }} retryOptions
   */
  async function fetchWithRetry(
    url: any,
    makeOptions: any,
    { maxNetworkRetries = 3, maxServerRetries = 1, onRetry }: any = {},
  ) {
    let networkRetries = 0;
    let serverRetries = 0;
    while (true) {
      const opts = makeOptions();
      try {
        const res = await fetch(url, opts);
        if (
          res.status >= 500 &&
          res.status < 600 &&
          serverRetries < maxServerRetries
        ) {
          serverRetries++;
          if (onRetry)
            await onRetry({
              attempt: serverRetries,
              type: "server",
              status: res.status,
            });
          await sleepAbortable(1000, opts.signal);
          continue;
        }
        return res;
      } catch (e: any) {
        if (e.name === "AbortError") throw e;
        if (!(e instanceof TypeError) || networkRetries >= maxNetworkRetries)
          throw e;
        networkRetries++;
        if (onRetry)
          await onRetry({ attempt: networkRetries, type: "network", error: e });
        await sleepAbortable(
          1000 * Math.pow(2, networkRetries - 1),
          opts.signal,
        );
      }
    }
  }

  let fetchRetryMessage: any = null;

  function showFetchRetryStatus() {
    setStatus("reconnecting");
    if (!fetchRetryMessage) {
      const message = addMessage("system", "连接中，正在重试...");
      fetchRetryMessage = message;
    }
  }

  function clearFetchRetryStatus() {
    if (fetchRetryMessage) {
      removeMessage(fetchRetryMessage);
      fetchRetryMessage = null;
    }
  }

  function addNetworkFailureMessage(text: any, files: any, requestMessage: any) {
    const scene = { ...state.activeScene };
    const message = addMessage("system", "⚠ 网络连接失败，请检查网络后重试", false, undefined, undefined, scene);
    message.retry = () => {
      if (state.currentScene.sceneId !== scene.sceneId) {
        message.text = "请切换回这条消息所属的场景后重试。"; changed(); return;
      }
      removeMessage(message);
      return send(text, files?.length ? files : null, { isManualRetry: true, requestMessage });
    };
    message.retryLabel = "重试";
    changed();
  }

  function addTimeoutRetryMessage() {
    const message = addMessage(
      "system",
      "等了很久都没有新进展，可能是执行时间较长",
    );
    message.retryLabel = "检查一下";
    message.retry = async () => {
      removeMessage(message);
      const sid = currentStreamId || lastStreamId;
      if (sid) {
        const action = await applyProbeVerdict(
          await probeStream(sid, liveSeq),
          sid,
          liveSeq,
        );
        if (action === "cutover" || action === "recovered") return;
      }
      await reconcileHistory();
      await checkActiveStream();
    };
    changed();
  }

  // addStreamDisconnectMessage 已删除：断流不再弹"重新发送"按钮。
  // 服务端此刻 breath 还在跑、事件正往 replay 缓冲里写，前端手上有 stream_id 和
  // /api/stream/active?after= 这个断点续传接口——该自己拿回来，而不是让用户点。
  // 见 queueDisconnectRecovery / runPendingRecovery。

  // ---- Progress-based watchdog (P1-2) -----------------------------------------
  // 旧实现在**字节层**测量进展：reader.read() 一 resolve 就重置计时器。
  // 服务端每 15s 发一次 axum keepalive（`:\n\n`），字节流永远不空 → watchdog 永不触发。
  // 现在只认解析出来的 SSE 事件，keepalive 不再续命。
  const PROGRESS_EVENTS = new Set([
    "content_block_delta",
    "thinking",
    "reasoning",
    "tool_use",
    "tool_result",
    "message_stop",
    "error",
  ]);
  // 'usage' 故意不算进展——它可能在流末尾单独出现

  // 按相位分档的静默预算。宁可慢一点也不要误杀正常的慢工具。
  const STALL_MS: Record<string, number> = {
    awaiting_first: 75000, // POST 已 200，但一个 SSE 事件都没有（TTFT 上限 + 余量）
    reasoning: 90000, // reasoning delta 之间；部分 provider 只给汇总
    text: 45000, // 文本 delta 之间断 45s = 几乎必然异常
    tool: 300000, // run_command / browse_web 跑 5 分钟是合法的，不能杀
  };
  // probe 判定 stalled 后的重试退避，以及硬中止的累计预算
  const STALL_BACKOFF_MS = [30000, 60000, 120000];
  const STALL_GIVEUP_MS = 900000; // 15 min

  let livePhase = "awaiting_first"; // awaiting_first | text | tool | reasoning
  let livePendingTool: any = null;
  let lastProgressTime = Date.now();
  let hiddenAt: any = null; // 页面转入后台的时刻，用于"暂停计时"而不是"续命"

  function resetLiveProgress() {
    liveSeq = 0;
    livePhase = "awaiting_first";
    livePendingTool = null;
    lastProgressTime = Date.now();
    hiddenAt = visibilityState() === "hidden" ? Date.now() : null;
    clearTuiHint();
  }

  function markProgress(type: any, data: any) {
    if (type === "meta") showContinuationMarker(data);
    if (!PROGRESS_EVENTS.has(type)) return;
    const active = type !== "message_stop" && type !== "error";
    if (active) {
      // Empty deltas and transport boundaries do not resume processing.
      if (type === "content_block_delta" && !data?.delta?.text) return;
      if ((type === "thinking" || type === "reasoning") &&
          !(data?.text || data?.delta?.text || (typeof data?.delta === "string" && data.delta))) return;
      replayTransportOnly = false;
      autonomousHandedOff = false;
      if (currentRun?.end) {
        // A reply boundary is not a new autonomous callback. Resume its single
        // activity record, retaining the full tool log and original start time.
        if (autonomousStream && currentStreamId && currentRun.streamId === currentStreamId &&
            currentRun.autonomousOrigin === autonomousOrigin) {
          actionLog = currentRun.entries.map((entry: any) => ({ ...entry }));
          currentRun.end = undefined;
          currentRun.outcome = undefined;
          currentRun.status = undefined;
          currentRun.waitingForReply = false;
        } else {
          actionLog = [];
          currentRun = null;
        }
        userStoppedStream = false;
        tuiCurrentState = "思考中";
        tuiCurrentArg = "";
      }
      replyRunSettled = false;
      if (pendingReply && pendingReply.phase !== "processing") {
        logReplyWait("progress");
        pendingReply.phase = "processing";
        stopCatchUpWatcher();
      }
    }
    lastProgressTime = Date.now();
    clearTuiHint();
    if (type === "tool_use") {
      livePhase = "tool";
      livePendingTool = (data && data.name) || "tool";
    } else if (type === "tool_result") {
      livePhase = "reasoning";
      livePendingTool = null;
    } else if (type === "content_block_delta") livePhase = "text";
    else if (type === "thinking" || type === "reasoning")
      livePhase = "reasoning";
  }

  function stallBudgetMs() {
    return STALL_MS[livePhase] || STALL_MS.awaiting_first;
  }
  function stalledForMs() {
    // 后台期间不计时：hiddenAt 之后的时间不算"前台无进展时长"
    const now = hiddenAt || Date.now();
    return Math.max(0, now - lastProgressTime);
  }

  // 每条流一个：记录 stalled 起点、probe 退避、硬中止预算
  function makeStallTracker() {
    return {
      firstStalledAt: null,
      nextProbeAt: 0,
      backoffIdx: 0,
      reset() {
        this.firstStalledAt = null;
        this.nextProbeAt = 0;
        this.backoffIdx = 0;
      },
      dueForProbe() {
        return Date.now() >= this.nextProbeAt;
      },
      onStalled() {
        const now = Date.now();
        if (!this.firstStalledAt) this.firstStalledAt = now;
        const delay =
          STALL_BACKOFF_MS[
            Math.min(this.backoffIdx, STALL_BACKOFF_MS.length - 1)
          ];
        this.backoffIdx++;
        this.nextProbeAt = now + delay;
        return { totalMs: now - this.firstStalledAt, nextInMs: delay };
      },
    } as any;
  }

  // AbortSignal.timeout 在老 Safari 上没有，做个降级
  function timeoutSignal(ms: any) {
    if (
      typeof AbortSignal !== "undefined" &&
      typeof AbortSignal.timeout === "function"
    ) {
      return AbortSignal.timeout(ms);
    }
    const ac = new AbortController();
    setTimeout(() => ac.abort(), ms);
    return ac.signal;
  }

  // 后台 tab：**暂停计时**而不是续命。回到前台时把挂起时长补给 lastProgressTime，
  // 等价于"只统计前台的无进展时长"，锁屏 5 分钟不会被误判为超时。
  listen(globalThis.document, "visibilitychange", () => {
    if (visibilityState() === "hidden") {
      if (!hiddenAt) hiddenAt = Date.now();
    } else if (hiddenAt) {
      lastProgressTime += Date.now() - hiddenAt;
      hiddenAt = null;
    }
  });

  // ---- Probe before abort (P1-3) ----------------------------------------------
  // 服务端把整条 breath 都缓冲在 /api/stream/active 里（环形缓冲 2000 条，seq 单调递增），
  // 且客户端断开**不会**中断 breath。所以 watchdog 到期时正确的动作不是 abort + 报错，
  // 而是先问一句服务端到底有没有进展，再决定换哪条路继续读。
  //
  // 返回 { verdict: 'progressing'|'finished'|'gone'|'superseded'|'stalled'|'unreachable', serverSeq? }
  async function probeStream(streamId: any, localSeq: any) {
    try {
      const r = await fetch(apiUrl("/api/stream/active"), {
        cache: "no-store",
        signal: timeoutSignal(8000),
      });
      if (r.status === 204) return { verdict: "gone" };
      if (!r.ok) return { verdict: "unreachable" };
      const d = await r.json();
      if (streamId && d.stream_id !== streamId)
        return { verdict: "superseded", data: d };
      const serverSeq = Math.max(0, (Number(d.next_seq) || 1) - 1);
      if (d.finished) return { verdict: "finished", serverSeq, data: d };
      if (serverSeq > localSeq)
        return { verdict: "progressing", serverSeq, data: d };
      return { verdict: "stalled", serverSeq, data: d };
    } catch (_: any) {
      return { verdict: "unreachable" };
    }
  }

  // 无缝 cutover：**不能**走 replayStream()，它会把 streamText 清空重来。
  // processReplayEvent 是追加语义，会复用现有的 streamMessage / streamText，
  // 从 after=localSeq 接上去文字严丝合缝，一个字不重不漏。
  function cutoverToReplay(streamId: any, fromSeq: any) {
    if (activeStreamPollTimer) {
      clearTimeout(activeStreamPollTimer);
      activeStreamPollTimer = null;
    }
    // F1: live reader 还活着就必须先杀掉它。
    // 只把 currentAbortController 置 null 不会停下 reader——它握着自己的 res.body，
    // 会继续和下面起的 poller 同时往 streamMessage / streamText 写：文字重复、交错，
    // 偶尔还会多冒一个 typing 气泡（"两个线程同时在想"）。
    // watchdog 内部路径进来时 signal 已经 aborted，不重复记 externalCutover。
    const liveReader = currentAbortController;
    currentAbortController = null;
    if (liveReader && !liveReader.signal?.aborted) {
      externalCutover = { streamId, localSeq: fromSeq };
      try {
        liveReader.abort();
      } catch (_: any) {}
    }
    pendingRecovery = null;
    isStreaming = true;
    currentStreamId = streamId;
    lastStreamId = streamId;
    liveSeq = fromSeq;
    lastProgressTime = Date.now();
    if (streamMessage) setMessageStreaming(streamMessage, true);
    setStatus("thinking");
    updateSendButton();
    pollActiveStream(streamId, fromSeq);
  }

  // 流已经从服务端消失（10s 清理）或被别的 tab 覆盖 → 回落到 /api/history 拿落盘内容。
  // assistant moment 先落盘后发 Done，所以这条路一定能拿到完整回复。
  async function recoverViaHistory() {
    if (activeStreamPollTimer) {
      clearTimeout(activeStreamPollTimer);
      activeStreamPollTimer = null;
    }
    const recoveryEpoch = ++writerEpoch; // Invalidate every older reader.
    const recoveryRequest = chatRequestRevision;
    const reader = currentAbortController;
    if (reader && !reader.signal.aborted) {
      externalCutover = { streamId: currentStreamId, localSeq: liveSeq };
      reader.abort();
    }
    const partialMessage = streamMessage;
    const partialText = streamText;
    streamMessage = null;
    streamText = "";
    streamReplyPrefix = "";
    progressBubbles = [];
    isStreaming = false;
    routedStreaming = false;
    if (currentStreamId) lastStreamId = currentStreamId;
    currentStreamId = null;
    currentAbortController = null;
    pendingRecovery = null;
    removeThinkingIndicator();

    const previousItems = new Set(state.items);
    await reconcileHistory();
    if (disposed || writerEpoch !== recoveryEpoch || chatRequestRevision !== recoveryRequest) return false;
    const recovered = state.items.some((item: any) => item.kind === "message" && item.role === "being"
      && !previousItems.has(item) && inCurrentScene(item, partialMessage || state.activeScene));
    if (recovered) {
      // 历史里已有权威版本 → 扔掉屏幕上的半截内容，避免重复
      removeMessage(partialMessage);
    } else if (partialMessage) {
      setMessageStreaming(partialMessage, false);
      const visible = cleanContent(partialText);
      if (visible) updateMessage(partialMessage, visible);
      else removeMessage(partialMessage);
    }

    setStatus("connected");
    tuiDone();
    clearTuiHint();
    settleReplyBoundary();
    updateSendButton();
    return recovered;
  }

  // 非 SSE 上下文（重连后、replay 轮询中）复用的决策表
  async function applyProbeVerdict(p: any, streamId: any, localSeq: any) {
    switch (p.verdict) {
      case "progressing":
      case "finished":
        cutoverToReplay(streamId, localSeq);
        return "cutover";
      case "gone":
      case "superseded":
        await recoverViaHistory();
        return "recovered";
      case "stalled":
        setTuiHint("服务端还没有新进展，正在继续等待…");
        return "stalled";
      case "unreachable":
      default:
        setConnState(navigator.onLine === false ? "offline" : "reconnecting");
        return "unreachable";
    }
  }

  // 断线时记下恢复意图，由连接状态机在重连后兑现（P1-E：不再弹按钮让用户点）
  let pendingRecovery: any = null;

  function queueDisconnectRecovery(streamId: any, localSeq: any) {
    pendingRecovery = { streamId, localSeq };
    setConnState(navigator.onLine === false ? "offline" : "reconnecting");
    setTuiHint("连接中断了，正在自动恢复…");
    runPendingRecovery().catch((err) =>
      console.warn("recovery probe failed:", err),
    );
  }

  async function runPendingRecovery() {
    const r = pendingRecovery;
    if (!r) return "idle";
    const epoch = writerEpoch, request = chatRequestRevision;
    const p = await probeStream(r.streamId, r.localSeq);
    if (disposed || pendingRecovery !== r || writerEpoch !== epoch || chatRequestRevision !== request) return "idle";
    if (p.verdict === "unreachable") {
      setConnState(navigator.onLine === false ? "offline" : "reconnecting");
      return "unreachable"; // 保留 pendingRecovery，等 checkHealth 恢复后再试
    }
    pendingRecovery = null;
    const action = await applyProbeVerdict(p, r.streamId, r.localSeq);
    if (action === "stalled") pendingRecovery = r; // 还没好，下次重连再问
    return action;
  }

  // ---- SSE stream consumption -------------------------------------------------
  // 从 send() 里抽出来的读取循环。可被 send() 和 splice 分支（脏 isStreaming 收到 200）复用，
  // 也是 watchdog probe 热切换到 replay 通道的落点。
  // 返回 { outcome: 'done' | 'switch_to_replay' | 'aborted' | 'server_error', streamId, localSeq }
  // 异常（AbortError / TypeError / 其它）向上抛给调用方统一处理。
  async function consumeChatStream(res: any) {
    routedStreaming = false;
    let streamTimeoutId: any = null;
    let watchdogAborted = false;
    streamWatchdogAborted = false;
    userStoppedStream = false;
    let readerEpoch = writerEpoch;
    let sawServerError = false;
    let sawSceneEvent = false;
    let cutoverRequest: any = null; // probe 判定 progressing/finished → 热切换到 replay
    let historyRecoveryRequested = false; // probe 判定 gone/superseded → 回落历史对账
    externalCutover = null; // 新流开始，清掉上一条流可能残留的交接意图

    const killWatchdog = () => {
      if (streamTimeoutId) {
        clearInterval(streamTimeoutId);
        streamTimeoutId = null;
      }
    };
    const abortReader = () => {
      killWatchdog();
      try {
        currentAbortController?.abort();
      } catch (_: any) {}
    };
    const hardTimeout = () => {
      watchdogAborted = true;
      streamWatchdogAborted = true;
      abortReader();
    };

    // watchdog 到期 → **不直接 abort**，先 probe 服务端有没有进展。
    // 决策表见 probeStream 上方注释。
    async function onWatchdogExpired(tracker: any) {
      const sid = currentStreamId || lastStreamId;
      if (!sid) {
        hardTimeout();
        return;
      } // 连 meta 都没到，没法 probe

      const p = await probeStream(sid, liveSeq);
      if (cutoverRequest || historyRecoveryRequested) return; // 已经在切换了

      switch (p.verdict) {
        case "progressing":
        case "finished":
          cutoverRequest = { streamId: sid, localSeq: liveSeq };
          abortReader();
          return;
        case "gone":
        case "superseded":
          historyRecoveryRequested = true;
          abortReader();
          return;
        case "stalled": {
          const { totalMs, nextInMs } = tracker.onStalled();
          if (totalMs >= STALL_GIVEUP_MS) {
            hardTimeout();
            return;
          }
          setTuiHint(
            `服务端也没有新进展，${Math.round(nextInMs / 1000)} 秒后再检查一次`,
          );
          return;
        }
        case "unreachable":
        default: {
          const { totalMs } = tracker.onStalled();
          setConnState(navigator.onLine === false ? "offline" : "reconnecting");
          if (totalMs >= STALL_GIVEUP_MS) hardTimeout();
          return;
        }
      }
    }

    try {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const myEpoch = ++writerEpoch; // F2: 我是当前唯一合法写者
      readerEpoch = myEpoch;
      streamMessage = null;
      streamText = "";
      streamReplyPrefix = "";
      progressBubbles = [];
      toolCount = 0;
      let eventType = "";
      resetLiveProgress();

      const stall = makeStallTracker();
      let watchdogBusy = false;

      streamTimeoutId = setInterval(() => {
        // 后台时只是不判断（计时已经在 stalledForMs 里冻住了），绝不重置计时器
        if (visibilityState() === "hidden") return;
        if (watchdogBusy || userStoppedStream) return;
        const stalledFor = stalledForMs();
        updateStallHint(stalledFor);
        if (stalledFor < stallBudgetMs()) return;
        if (!stall.dueForProbe()) return;
        watchdogBusy = true;
        onWatchdogExpired(stall)
          .catch((err) => console.warn("watchdog probe failed:", err))
          .finally(() => {
            watchdogBusy = false;
          });
      }, 5000);

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          clearInterval(streamTimeoutId);
          streamTimeoutId = null;
          break;
        }
        // ⚠️ 这里**故意不更新任何计时器**：reader.read() 是字节层的，
        // 服务端 15s 一次的 keepalive（`:\n\n`）也会让它 resolve。
        // 进展只由下面解析出来的真 SSE 事件（markProgress）来标记。

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
            continue;
          }
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));

            // Initial transport meta has no replay sequence. Continuation and
            // persistence acknowledgements belong to the replay event log.
            if (eventType && (eventType !== "meta" || data.continuation === true || data.persisted)) {
              liveSeq++;
              if (PROGRESS_EVENTS.has(eventType)) lastProgressTime = Date.now();
            }

            if (myEpoch !== writerEpoch) continue;
            traceStreamEvent('sse', eventType, data, liveSeq);
            if (options.routeEvent?.(eventType, data)) continue;
            splitStreamProgress(eventType, data);
            markProgress(eventType, data);
            if (["content_block_delta", "thinking", "reasoning", "tool_use", "tool_result", "message_stop", "error"].includes(eventType)) sawSceneEvent = true;

            if (eventType === "meta") {
              acceptPersisted(data);
              if (data.stream_id) {
                currentStreamId = data.stream_id;
                lastStreamId = data.stream_id;
                syncHistoryCursor(); // 用户 moment 此时已落盘，推进游标避免对账时重复渲染
              }
            }

            if (eventType === "content_block_delta") {
              const text = data.delta?.text || "";
              if (!text) continue;
              if (myEpoch !== writerEpoch) continue; // F2: 已被 poller 接管，静默丢弃
              appendStreamText(text);
            }

            if (eventType === "thinking" || eventType === "reasoning") {
              setStatus("thinking");
              // Accumulate thinking text into the current think entry.
              const delta =
                (data && (data.text || data.delta?.text || data.delta)) || "";
              const last = actionLog[actionLog.length - 1];
              let entry;
              if (last && last.type === "think" && !last.done) {
                entry = last;
              } else {
                entry = { type: "think", preview: "", text: "" };
                actionLogPush(entry);
              }
              if (delta && typeof delta === "string") {
                entry.text = (entry.text || "") + delta;
                entry.preview = truncate(entry.text.trim(), 100);
                scheduleRenderActivityLog();
              }
              tuiSet("thinking");
            }

            if (eventType === "tool_use") recordToolStart(data);
            if (eventType === "tool_result") recordToolResult(data);

            if (eventType === "message_stop") {
              if (myEpoch !== writerEpoch) continue; // F2
              // F3: message_stop = end-of-reply，**不是** end-of-turn。
              // 被 yield 打断的呼吸会在同一条 SSE 上继续发续写 delta；
              // 旧实现留着 streamMessage 不放，续写就被粘进用户第二条消息**上面**那个旧气泡里。
              // 这里把气泡定稿并交出去，续写会自然拿到一个新气泡。
              // isStreaming 保持 true —— 真正的 end-of-turn 是 SSE 关闭（reader 循环结束）。
              if (renderTimer) {
                cancelAnimationFrame(renderTimer);
                renderTimer = null;
              }
              removeThinkingIndicator();
              if (streamMessage) {
                setMessageStreaming(streamMessage, false);
                const visibleText = cleanContent(streamText);
                if (visibleText) updateMessage(streamMessage, visibleText);
                else removeMessage(streamMessage);
              }
              noteStreamEcho();
              settleReplyBoundary();
              streamMessage = null;
              streamText = "";
              if (data.session_id) sessionId = data.session_id;
              setStatus("connected");
              tuiDone();
              clearTuiHint();
              syncHistoryCursor(); // 推进游标，避免之后的增量对账重画这条回复
            }

            if (eventType === "error") {
              if (myEpoch !== writerEpoch) continue; // F2: poller 会从缓冲里拿到同一条 error
              sawServerError = true;
              pendingReply = null;
              stopCatchUpWatcher();
              removeThinkingIndicator();
              addMessage("system", "⚠ " + (data.message || "unknown error"));
              isStreaming = false;
              setStatus("error");
              tuiClear();
              actionLogClear();
            }
          } catch (parseErr: any) {
            // data 行以 { 或 [ 开头说明是真的 JSON 格式错误，值得记录
            const rawData = line.slice(6).trim();
            if (rawData.startsWith("{") || rawData.startsWith("[")) {
              console.error(
                "SSE JSON parse error:",
                parseErr.message,
                "| raw:",
                rawData.slice(0, 200),
              );
            }
            // 其他情况（空行、keepalive 等）静默忽略
          } finally {
            eventType = ""; // 每次 data 行处理完后重置
          }
        }
      }

      // SSE 关闭 = end-of-turn。走到这里说明流末尾还有没被 message_stop 定稿的文字
      // （断在续写中途等），补一次定稿。
      if (streamText && myEpoch === writerEpoch) {
        if (renderTimer) {
          cancelAnimationFrame(renderTimer);
          renderTimer = null;
        }
        removeThinkingIndicator();
        const visibleText = cleanContent(streamText);
        if (streamMessage && visibleText) {
          setMessageStreaming(streamMessage, false);
          updateMessage(streamMessage, visibleText);
        } else if (streamMessage) {
          removeMessage(streamMessage);
          streamMessage = null;
        } else if (visibleText) {
          streamMessage = addMessage("being", visibleText);
        }
        // EOF can finalize a reply without message_stop. Retain its echo before
        // releasing the live scene so a later history read does not append it again.
        noteStreamEcho();
        setStatus("connected");
        tuiDone();
      }

      // 走到这里我可能已经被 cutover 接管了（abort 和"字节流刚好读完"赛跑，
      // reader 有可能不抛 AbortError 就正常结束）。这种情况下收尾归新写者管，
      // 绝不能让 finalizeSendCleanup 把 isStreaming 打回 false —— 那会顺手杀掉 poller。
      if (myEpoch === writerEpoch && pendingReplyArrived()) finishPendingReply();
      const staleWriter = myEpoch !== writerEpoch;
      if (staleWriter) externalCutover = null;
      return {
        outcome: sawServerError ? "server_error" : "done",
        empty: !sawSceneEvent,
        handled: staleWriter,
        streamId: currentStreamId || lastStreamId,
        localSeq: liveSeq,
      };
    } catch (e: any) {
      if (readerEpoch !== writerEpoch) return {outcome: 'done', handled: true, empty: false};
      // F1: cutoverToReplay 从外部（重连 probe / 超时按钮）把我 abort 掉了。
      // 那边已经起好 poller 并把 isStreaming 置 true，这里只需要安静退场：
      // handled:true 让 driveChatStream 跳过 finalizeSendCleanup。
      if (e.name === "AbortError" && externalCutover) {
        const ext = externalCutover;
        externalCutover = null;
        return {
          outcome: "switch_to_replay",
          handled: true,
          streamId: ext.streamId,
          localSeq: ext.localSeq,
        };
      }
      // watchdog 主动 abort 的两条自愈路径：调用方不该把它们当成错误
      if (e.name === "AbortError" && cutoverRequest) {
        return {
          outcome: "switch_to_replay",
          streamId: cutoverRequest.streamId,
          localSeq: cutoverRequest.localSeq,
        };
      }
      if (e.name === "AbortError" && historyRecoveryRequested) {
        await recoverViaHistory();
        return {
          outcome: "done",
          handled: true,
          streamId: currentStreamId || lastStreamId,
          localSeq: liveSeq,
        };
      }
      throw e;
    } finally {
      killWatchdog();
      streamWatchdogAborted = watchdogAborted;
    }
  }

  // 统一的 send/stream 收尾。任何提前 return 的分支都必须走它，
  // 否则 isStreaming / 发送按钮 / 发送队列会卡住。
  function finalizeSendCleanup() {
    if (renderTimer) {
      cancelAnimationFrame(renderTimer);
      renderTimer = null;
    }
    currentAbortController = null;
    externalCutover = null;
    if (currentStreamId) lastStreamId = currentStreamId;
    currentStreamId = null;
    isStreaming = false;
    updateSendButton();
  }

  // splice 分支：isStreaming 为 true 时发消息。
  // 服务端只有真的在 breath 中才回 202；如果本地 isStreaming 是脏的，
  // 服务端会起一条新 breath 并回 200 + 真 SSE 流。那种情况下**绝不能**把 body 扔着不管
  // ——浏览器 fetch 内部队列填满后会施加 TCP 背压，把服务端的 SSE 转发任务
  // 阻塞在 tx.send().await 上，连 /api/stream/active 的 replay 缓冲都会停止推进。
  function browserScenePayload(scene = state.currentScene) {
    // Desktop's trusted proxy supplies its persisted scene and client version.
    if (location.protocol === "beings:") return {};
    // loom-local b113faa: display names are not identities. Older servers may
    // only return a name; retain that fallback and explicit browser room IDs.
    const identity = [state.soul.being_id, state.soul.id, beingName]
      .find(value => typeof value === "string" && value.length > 0);
    return {
      scene_id: scene.sceneId || (identity ? `loom-${identity}` : null),
      scene_meta: { client: "loom/1.8.2", scene_label: scene.sceneLabel || "Loom" },
    };
  }

  function ensureUserMessage(queuedMessage: any, text: string) {
    if (!queuedMessage) return addMessage("user", text);
    // A history read may have completed while this send was being prepared.
    if (!state.items.includes(queuedMessage)) state.items.push(queuedMessage);
    changed();
    return queuedMessage;
  }

  async function spliceSend(text: any, files = pendingFiles, sendOptions: any = {}) {
    const replyBaseline = new Set(state.items);
    const submittedAt = Date.now();
    const interruptedOrigin = options.activeAutonomousOrigin?.();
    let spliceMsg = (text || "").trim();
    if (!spliceMsg && !files.length) return;
    spliceMsg = options.prepareMessage?.(spliceMsg || `[${files.length} file(s)]`) ?? spliceMsg;
    const requestMessage = stripLocalFileContext(withComposerCommandContext((sendOptions.requestMessage ?? spliceMsg) || `[${files.length} file(s)]`, !!sendOptions.uiAction || (!!state.intelligentUIEnabled && (sendOptions.intelligentUI ?? state.intelligentUIForMessage)), sendOptions.uiSnapshot ?? state.intelligentUISnapshots?.[state.currentScene.sceneId || 'global'], sendOptions.uiAction));
    const localMessage = ensureUserMessage(sendOptions.queuedMessage, spliceMsg || `[${files.length} file(s)]`);
    noteLocalEcho("user", requestMessage, state.currentScene, localMessage, [spliceMsg]);
    if (!sendOptions.uiAction && !sendOptions.queuedMessage) clearComposer();
    let res;
    try {
      if (sendOptions.attachmentDelivery) await sendOptions.attachmentDelivery('sending');
      res = await fetch(apiUrl("/api/chat/stream"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: requestMessage,
          session_id: sessionId,
          ...browserScenePayload(),
          ...(files.length
            ? {
                attachments: files.map((f) => ({
                  media_type: f.type || "application/octet-stream",
                  data: f.base64,
                })),
              }
            : {}),
        }),
      });
    } catch (e: any) {
      if (sendOptions.attachmentDelivery) await sendOptions.attachmentDelivery('unknown');
      console.warn("splice send failed:", e);
      addMessage("system", "⚠️ 发送失败，稍后重试");
      return;
    }
    if (sendOptions.attachmentDelivery) await sendOptions.attachmentDelivery(res.ok ? 'accepted' : res.status >= 500 ? 'unknown' : 'failed');
    if (res.status === 202 || (res.ok && res.body)) {
      // A reply can finish while its transport remains open. Accepted follow-ups
      // need their own visible wait, without inheriting the completed tool log.
      if (currentRun?.end) actionLogClear();
      replyRunSettled = false;
      pendingReply = { baseline: replyBaseline, submittedAt, phase: res.status === 202 ? "queued" : "processing",
        autonomousOrigin: interruptedOrigin, interrupted: true };
    }
    if (res.status === 202) {
      // Heart accepted this input for splice/yield. The Being decides whether
      // to resume, switch scene or delegate; 202 is not task completion.
      updateSendButton();
      startCatchUpWatcher();
      return;
    }
    if (res.ok && res.body) {
      console.warn("splice 收到 200，本地 isStreaming 状态已脏，转入流读取");
      currentStreamId = lastStreamId = null;
      isStreaming = false;
      setStatus("thinking");
      actionLogClear();
      tuiSet("thinking");
      showThinkingIndicator();
      isStreaming = true;
      updateSendButton();
      await driveChatStream(res, spliceMsg, [], requestMessage, !!sendOptions.attachmentDelivery);
      return;
    }
    // 非 200/202：主动排空 body，别让连接挂着
    res.body?.cancel().catch(() => {});
    addMessage("system", "⚠️ 发送失败，稍后重试");
  }

  async function send(text: any, filesOverride: any = null, sendOptions: any = {}) {
    if (disposed || preparingSend) return;
    try { validateIntelligentUIContext(usesIntelligentUICommand(text || "") || !!sendOptions.uiAction || (!!state.intelligentUIEnabled && (sendOptions.intelligentUI ?? state.intelligentUIForMessage)), sendOptions.uiSnapshot ?? state.intelligentUISnapshots?.[state.currentScene.sceneId || 'global'], sendOptions.uiAction); }
    catch (error) { addMessage('system', error instanceof Error ? error.message : '智能 UI 上下文无效，未发送'); return; }

    if (!Array.isArray(filesOverride) && pendingFileReads.size) {
      preparingSend = true;
      try {
        if (!await prepareSend(filesOverride)) return;
      } finally {
        preparingSend = false;
      }
      if (disposed) return;
    }
    if (location.protocol === "beings:" && !state.currentScene.sceneId) {
      addMessage("system", "客户端场景不可用，暂时无法发送消息。请检查启动提示并重启客户端。");
      return;
    }
    if (isStreaming) {
      await spliceSend(text, filesOverride || [...pendingFiles], sendOptions);
      return;
    }
    const replyBaseline = new Set(state.items);
    const submittedAt = Date.now();
    const sendingScene = { ...state.currentScene };
    const interruptedOrigin = options.activeAutonomousOrigin?.();
    userStoppedStream = false;
    const { isManualRetry = false } = sendOptions;
    let msg = (text || "").trim();
    const fromQueue = Array.isArray(filesOverride) && !isManualRetry;
    const filesToSend = Array.isArray(filesOverride)
      ? filesOverride
      : [...pendingFiles];
    if (!msg && !filesToSend.length) return;
    if (!isManualRetry) msg = options.prepareMessage?.(msg || `[${filesToSend.length} file(s)]`) ?? msg;
    const requestMessage = stripLocalFileContext(isManualRetry && typeof sendOptions.requestMessage === "string" ? sendOptions.requestMessage : withComposerCommandContext(sendOptions.requestMessage ??
      options.prepareRequestMessage?.(msg || `[${filesToSend.length} file(s)]`, sendingScene, sendOptions) ?? msg, !!sendOptions.uiAction || (!!state.intelligentUIEnabled && (sendOptions.intelligentUI ?? state.intelligentUIForMessage)), sendOptions.uiSnapshot ?? state.intelligentUISnapshots?.[state.currentScene.sceneId || 'global'], sendOptions.uiAction));
    turnContext = sceneTransitionNotice(requestMessage);
    // Recovery identities belong to one request. A failed new POST (or reader
    // before its first meta event) must not probe the previous completed turn.
    currentStreamId = lastStreamId = null;
    replyRunSettled = false;
    pendingReply = { baseline: replyBaseline, submittedAt, phase: "processing" };
    autonomousStream = false;
    autonomousOrigin = undefined;
    replayTransportOnly = false;
    setStreamScene(state.currentScene);

    if (!isManualRetry) {
      const localMessage = ensureUserMessage(sendOptions.queuedMessage, msg || `[${filesToSend.length} file(s)]`);
      // Servers may persist the user body without the transport-only scene cue.
      noteLocalEcho("user", requestMessage || `[${filesToSend.length} file(s)]`, sendingScene, localMessage, [stripSceneTransition(stripClientMessageContext(requestMessage))]);
      if (!fromQueue) clearComposer();
    }
    setStatus("thinking");
    actionLogClear();
    tuiSet("thinking");
    showThinkingIndicator();
    isStreaming = true;
    updateSendButton();

    const body: any = { message: requestMessage || `[Sent ${filesToSend.length} file(s)]`, ...browserScenePayload(sendingScene) };
    if (sessionId) body.session_id = sessionId;
    if (filesToSend.length) {
      body.attachments = filesToSend.map((f) => ({
        media_type: f.type || "application/octet-stream",
        data: f.base64,
      }));
    }

    // POST 阶段：只负责把请求打出去。读取循环在 consumeChatStream 里。
    let res;
    currentAbortController = new AbortController();
    const sendController = currentAbortController;
    try {
      if (sendOptions.attachmentDelivery) await sendOptions.attachmentDelivery('sending');
      const sendRequest = sendOptions.attachmentDelivery
        ? (url: string, init: () => RequestInit, _options: unknown) => fetch(url, init())
        : fetchWithRetry;
      res = await sendRequest(
        apiUrl("/api/chat/stream"),
        () => {
          return {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(location.protocol === "beings:" && sendingScene.sceneId ? { "X-Portal-Scene-Id": sendingScene.sceneId } : {}) },
            body: JSON.stringify(body),
            signal: sendController.signal,
          };
        },
        {
          onRetry: async () => {
            removeThinkingIndicator();
            showFetchRetryStatus();
          },
        },
      );
    } catch (e: any) {
      if (sendOptions.attachmentDelivery) {
        await sendOptions.attachmentDelivery('unknown');
        pendingReply = null; removeThinkingIndicator(); tuiClear();
        addMessage('system', '附件消息发送结果不确定，请先核对历史；不会自动重发。');
      } else handleStreamError(e, msg, filesToSend, requestMessage);
      finalizeSendCleanup();
      return;
    }

    if (sendOptions.attachmentDelivery) await sendOptions.attachmentDelivery(res.ok ? 'accepted' : res.status >= 500 ? 'unknown' : 'failed');
    clearFetchRetryStatus();
    setStatus("thinking");

    if (res.status === 202) {
      try { await res.json(); } catch (_: any) {}
      // Accepted is not completed: release the POST reader, retain this scene's run.
      pendingReply = { baseline: replyBaseline, submittedAt, phase: "queued", autonomousOrigin: interruptedOrigin };
      removeThinkingIndicator();
      tuiClear();
      finalizeSendCleanup();
      startCatchUpWatcher();
      return;
    }

    if (!res.ok) {
      pendingReply = null;
      stopCatchUpWatcher();
      const err = await res.text();
      addMessage("system", "⚠ " + err);
      setStatus("error");
      removeThinkingIndicator();
      tuiClear();
      finalizeSendCleanup();
      return;
    }

    await driveChatStream(res, msg, filesToSend, requestMessage, !!sendOptions.attachmentDelivery);
  }

  // 读取循环 + 统一的异常处理 + 统一的收尾。
  // send() 和 spliceSend() 都走这里，保证 isStreaming / 队列 / 按钮在任何路径上都能复位。
  async function driveChatStream(res: any, msg: any, filesToSend: any, requestMessage = msg, attachmentAccepted = false) {
    let handedOff = false;
    try {
      const result = await consumeChatStream(res);
      if (result.outcome === "done" && !result.handled && pendingReply) {
        // Reasoning/tool events are not a final reply. Every unresolved EOF
        // needs a bounded wait, retaining any newer splice request's baseline.
        removeThinkingIndicator();
        settleReplyBoundary();
      }
      if (result.outcome === "switch_to_replay") {
        // watchdog probe 判定服务端仍在推进：SSE 管道死了但 breath 活着。
        // 保留 streamMessage / streamText，从 localSeq 处热切换到 replay 通道。
        // handled:true = 外部已经 cutover 过了（F1），再切一次会起第二个 poller。
        handedOff = true;
        if (!result.handled) cutoverToReplay(result.streamId, result.localSeq);
      } else if (result.handled) {
        handedOff = true; // gone / superseded：recoverViaHistory 已经做完收尾
      }
      return result;
    } catch (e: any) {
      if (attachmentAccepted) { addMessage('system', '附件消息已被接受，回复连接中断，请刷新历史查看后续回复。'); }
      else handleStreamError(e, msg, filesToSend, requestMessage);
      return { outcome: "aborted", streamId: lastStreamId, localSeq: liveSeq };
    } finally {
      if (renderTimer) {
        cancelAnimationFrame(renderTimer);
        renderTimer = null;
      }
      if (!handedOff) {
        options.finishRoutes?.();
        finalizeSendCleanup();
      }
    }
  }

  // 把当前 streamMessage 上的流式内容固化下来（去掉光标、做最终 markdown 渲染）。
  function finalizePartialBubble() {
    if (!streamMessage) return;
    setMessageStreaming(streamMessage, false);
    const visibleText = cleanContent(streamText);
    if (visibleText) updateMessage(streamMessage, visibleText);
    else {
      removeMessage(streamMessage);
      streamMessage = null;
    }
  }

  // 统一的流异常处理。注意它**总是**让调用方走 finalizeSendCleanup()：
  // 断线恢复路径靠 pendingRecovery 让 finalizeSendCleanup 跳过队列 flush，
  // 而不是靠"不收尾"——isStreaming 卡在 true 是这次修复要根除的东西。
  function handleStreamError(e: any, msg: any, filesToSend: any, requestMessage = msg) {
    pendingReply = null;
    stopCatchUpWatcher();
    clearFetchRetryStatus();
    removeThinkingIndicator();
    if (e.name === "AbortError") {
      const wasTimeout = streamWatchdogAborted;
      finalizePartialBubble();
      if (wasTimeout) {
        addTimeoutRetryMessage();
        setStatus("error");
      } else if (userStoppedStream) {
        // 用户手动停止：内容已在屏幕上，只需推进历史游标避免下次对账重复渲染
        noteStreamEcho();
        syncHistoryCursor();
        setStatus("connected");
      }
      tuiClear();
    } else if (e instanceof TypeError) {
      const sid = currentStreamId || lastStreamId;
      if (sid) {
        // 服务端此刻 breath 还在跑，事件正往 replay 缓冲里写。
        // 不弹"重新发送"按钮——记下恢复意图，交给连接状态机在重连后 probe。
        finalizePartialBubble();
        queueDisconnectRecovery(sid, liveSeq);
        tuiClear();
      } else {
        // 初始连接就失败，消息根本没送出去 → 保留手动重试按钮
        addNetworkFailureMessage(msg, filesToSend, requestMessage);
        setStatus("error");
        tuiClear();
      }
    } else {
      addMessage("system", "⚠ " + e.message);
      setStatus("error");
      tuiClear();
    }
    isStreaming = false;
  }

  // ---- Health & Reconnect (P1-4) ----------------------------------------------
  // 旧实现是"边沿触发器"：只在 connected 状态跳变时做事，/health 一直 200 就什么都不干；
  // 没有超时、没有 in-flight 守卫、setInterval 会堆叠并发请求，还把 /health 的响应体扔了。
  // 现在：自调度 + 指数退避 + jitter + AbortSignal 超时 + 用 commit hash 探测服务端重启。
  let healthForcePending = false;

  async function checkHealth({ force = false } = {}) {
    // in-flight 守卫：force 的语义是"不等退避立刻探一次"，不是"允许并发请求"。
    // （旧实现用 setInterval 不 await，弱网下请求会叠加。）
    if (healthInFlight) {
      if (force) healthForcePending = true;
      return;
    }
    healthInFlight = true;
    clearTimeout(healthTimer);
    try {
      const r = await fetch(apiUrl("/health"), {
        method: "GET",
        cache: "no-store",
        signal: timeoutSignal(6000),
      });
      if (!r.ok) throw new Error("health " + r.status);

      // /health 返回 "OK <commit_hash>"（http.rs:793-797）——免费的进程重启探测信号
      let commit = "";
      try {
        commit = (await r.text()).trim().split(/\s+/)[1] || "";
      } catch (_: any) {}
      const restarted = !!(serverCommit && commit && commit !== serverCommit);
      if (commit) serverCommit = commit;

      const wasDown = connState !== "online";
      healthBackoff = 0;
      if (!connectTime) connectTime = Date.now();
      setConnState("online");
      if (wasDown || restarted) {
        // 恢复动作自己出错不代表连接不健康——别让它把状态又打回 reconnecting
        try {
          await options.recoverScenes?.({ restarted });
          await onReconnected({ restarted });
        } catch (err: any) {
          console.warn("onReconnected failed:", err);
        }
      }
    } catch (_: any) {
      setConnState(
        navigator.onLine === false
          ? "offline"
          : connState === "online"
            ? "degraded"
            : "reconnecting",
      );
      healthBackoff = Math.min(healthBackoff + 1, HEALTH_BACKOFF_MS.length - 1);
    } finally {
      healthInFlight = false;
      if (healthForcePending) {
        healthForcePending = false;
        setTimeout(() => checkHealth({ force: true }), 0);
      } else {
        scheduleHealth();
      }
    }
  }

  function scheduleHealth() {
    clearTimeout(healthTimer);
    // 后台且健康 → 停轮询（回前台的钩子会立刻 force 一次）
    if (
      visibilityState() === "hidden" &&
      connState === "online" &&
      !isStreaming
    )
      return;
    const base =
      connState === "online"
        ? HEALTH_OK_INTERVAL_MS
        : HEALTH_BACKOFF_MS[healthBackoff];
    healthTimer = setTimeout(() => checkHealth(), jitter(base));
  }

  // 重连之后的恢复——不再无脑 loadHistory() 清屏重渲染
  async function onReconnected({ restarted = false } = {}) {
    void loadSbsState();
    if (restarted) {
      // 进程重启 → 在途 stream 必死，本地状态全部作废
      console.warn(
        "server restarted (commit changed), abandoning in-flight stream",
      );
      abandonLiveStream();
      await reconcileHistory({ full: true });
      return;
    }

    if (pendingRecovery) {
      const action = await runPendingRecovery();
      if (action === "cutover" || action === "recovered") return;
    }

    const sid = currentStreamId || lastStreamId;
    if (isStreaming && sid) {
      const epoch = writerEpoch, seq = liveSeq, request = chatRequestRevision;
      const p = await probeStream(sid, seq);
      // Replay may finish or a newer reader may take over while this query is
      // in flight. A late "finished" verdict must not reopen the old run with
      // its already completed tool entries.
      if (disposed || !isStreaming || writerEpoch !== epoch || liveSeq !== seq ||
          chatRequestRevision !== request || (currentStreamId || lastStreamId) !== sid) return;
      await applyProbeVerdict(p, sid, seq);
      return;
    }

    if (!options.historyOwner?.() && !isStreaming && !activeStreamPollTimer) await checkActiveStream();
    if (!isStreaming) await reconcileHistory();
  }

  // 放弃在途的 live 流（服务端重启等场景），但保留已经渲染出来的内容
  function abandonLiveStream() {
    if (activeStreamPollTimer) {
      clearTimeout(activeStreamPollTimer);
      activeStreamPollTimer = null;
    }
    try {
      currentAbortController?.abort();
    } catch (_: any) {}
    currentAbortController = null;
    externalCutover = null;
    writerEpoch++; // F2: 作废在途写者
    pendingRecovery = null;
    if (currentStreamId) lastStreamId = currentStreamId;
    currentStreamId = null;
    isStreaming = false;
    streamMessage = null;
    streamText = "";
    streamReplyPrefix = "";
    progressBubbles = [];
    removeThinkingIndicator();
    tuiClear();
    clearTuiHint();
    setStatus("connected");
    updateSendButton();
  }

  let lastRefreshAt = 0;
  async function refreshOnRegainedAttention() {
    const now = Date.now();
    if (now - lastRefreshAt < 1500) return;
    lastRefreshAt = now;
    void loadSbsState();
    if (isStreaming || pendingRecovery) return;
    await reconcileHistory();
    if (!isStreaming) await checkActiveStream();
  }

  // 生命周期钩子：把"什么时候该重新探一次"这件事交给浏览器告诉我们，
  // 而不是靠一个 15s 的定时器猜。
  function installLifecycleHooks() {
    listen(globalThis.document, "visibilitychange", () => {
      if (visibilityState() !== "visible") {
        clearTimeout(healthTimer);
        return;
      }
      healthBackoff = 0;
      checkHealth({ force: true });
      refreshOnRegainedAttention().catch((err) =>
        console.warn("refresh on visible failed:", err),
      );
    });
    listen(globalThis.window, "online", () => {
      healthBackoff = 0;
      if (connState === "offline") setConnState("reconnecting");
      checkHealth({ force: true });
    });
    listen(globalThis.window, "offline", () => setConnState("offline"));
    listen(globalThis.window, "pageshow", (e: any) => {
      // iOS Safari 从 bfcache 恢复时 visibilitychange 不保证触发
      if (e.persisted) {
        healthBackoff = 0;
        checkHealth({ force: true });
      }
    });
    listen(globalThis.window, "focus", () => {
      if (connState !== "online") checkHealth({ force: true });
      refreshOnRegainedAttention().catch((err) =>
        console.warn("refresh on focus failed:", err),
      );
    });
  }

  function updateSendButton() {
    state.streaming = isStreaming;
    updateRun();
    changed();
  }

  // ---- Stop turn ----
  let stopNotice: { streamId: string | null; message: any } | undefined;
  async function stopCurrentTurn() {
    if (!isStreaming || state.stopping) return;
    const targetStreamId = currentStreamId;
    const targetReader = currentAbortController;
    const targetRequest = chatRequestRevision;
    const targetRun = currentRun;
    const markStoppedRun = () => {
      if (!targetRun || !state.items.includes(targetRun)) return;
      targetRun.end = targetRun.end || Date.now();
      targetRun.outcome = 'stopped';
      targetRun.status = 'stopped';
      targetRun.label = targetStreamId ? '已停止' : '已取消等待';
      targetRun.hint = '';
      targetRun.waitingForReply = false;
    };
    const sameTurn = () => !disposed && isStreaming && (targetStreamId
      ? currentStreamId === targetStreamId
      : !currentStreamId && currentAbortController === targetReader && chatRequestRevision === targetRequest);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    state.stopping = true;
    changed();
    try {
      if (targetStreamId) {
        const response = await fetch(apiUrl("/api/stop"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stream_id: targetStreamId }),
          signal: controller.signal,
        });
        // 202 is only admission, not confirmation. Keep observing the live turn.
        if (!response.ok || response.status === 202) {
          await response.body?.cancel();
          throw new Error('Stop not confirmed');
        }
        if (response.status !== 204) {
          const receipt = await response.json();
          if (!receipt || (receipt.ok !== true && receipt.stopped !== true) || receipt.ok === false || receipt.stopped === false ||
              (receipt.stream_id && receipt.stream_id !== targetStreamId)) throw new Error('Invalid stop receipt');
        }
      }
      if (stopNotice && stopNotice.streamId === targetStreamId) {
        stopNotice.message.text = "服务端已确认停止本轮处理。";
        stopNotice.message.retry = undefined;
        stopNotice = undefined;
      }
      // A late acknowledgement must not abort a newer reader/turn.
      const endedTarget = !disposed && targetStreamId && !isStreaming &&
        chatRequestRevision === targetRequest && currentRun === targetRun;
      if (!sameTurn() && !endedTarget) {
        // Servers may close SSE before delivering the HTTP stop receipt. Update
        // only the captured run, even if another turn is already streaming.
        if (!disposed && targetStreamId && targetRun?.end && targetRun.outcome === 'done' && state.items.includes(targetRun)) {
          markStoppedRun();
        }
        return;
      }
      userStoppedStream = true;
      pendingReply = null;
      stopCatchUpWatcher();
      pendingRecovery = null;
      clearTuiHint();
      if (activeStreamPollTimer) {
        clearTimeout(activeStreamPollTimer);
        activeStreamPollTimer = null;
      }
      if (currentAbortController) currentAbortController.abort();
      else {
        finalizePartialBubble();
        isStreaming = false;
        tuiDone();
        updateSendButton();
      }
      markStoppedRun();
      if (!targetStreamId) {
        addMessage("system", "已取消本次等待；尚未取得执行标识，服务端是否已接收消息仍待核对。");
      }
    } catch {
      if (sameTurn()) {
        const notice = stopNotice && stopNotice.streamId === targetStreamId ? stopNotice.message
          : addMessage("system", "停止未确认，任务可能仍在执行。你可以再次停止；客户端将继续接收进展。");
        stopNotice = { streamId: targetStreamId, message: notice };
        notice.retryLabel = "再次停止";
        notice.retry = async () => {
          if (sameTurn()) await stopCurrentTurn();
          else { notice.retry = undefined; notice.text = "本轮处理已结束，无需再次停止。"; changed(); }
        };
      }
    } finally {
      clearTimeout(timeout);
      state.stopping = false;
      changed();
    }
  }

  // ---- History ----
  function resetMessages() {
    // Delivery and history acknowledgement are separate: a dequeued user
    // bubble must survive until its persisted row can take over its identity.
    state.items = state.items.filter((item: any) => item.queued ||
      (item.kind === "message" && item.role === "user" && !item.historySeq));
    localEchoes = localEchoes.filter(echo => state.items.includes(echo.message));
    currentRun = null;
    state.thinking = false;
    lastRole = null;
    lastSceneId = undefined;
    lastMessageTime = null;
    state.resetScroll++;
    changed();
  }

  // ---- History reconciliation (P1-5) ------------------------------------------
  // 旧的 loadHistory() 是破坏性的：每条恢复路径都 resetMessages() + 重渲染 100 条，
  // 滚动位置跳变、正在流的 streamMessage 被抹掉、移动端每次切 tab 回来都闪一下。
  // /api/history 的 HistoryMessage 是带 seq 的（http.rs:419-425），有 seq 就能增量对账。
  let lastHistorySeq = 0;
  let reconcileInFlight: any = null;
  const cacheEndpoint = location.protocol === "beings:"
    ? params.get("history_scope") || ""
    : params.get("history_scope") || API_URL;
  const historyCache = new HistoryCache(cacheEndpoint);
  let historyCacheSeeded = false;
  let historyCachePending: any[] = [];
  const recentHistory = new Map<number, any>();
  function cacheHistory(messages: any, cursor: any) {
    for (const message of messages) recentHistory.set(Number(message.seq), message);
    while (recentHistory.size > 1000) recentHistory.delete(recentHistory.keys().next().value!);
    if (disposed) return;
    if (!historyCacheSeeded) {
      if (historyCachePending.length >= 200) historyCachePending.shift();
      historyCachePending.push({ messages, cursor });
      return;
    }
    void historyCache.write(messages, cursor);
    for (const batch of historyCachePending) void historyCache.write(batch.messages, batch.cursor);
    historyCachePending = [];
  }

  // 本地已经渲染、但还没被历史游标覆盖的消息。用于避免"本地回显 + 历史对账"渲染两遍。
  let localEchoes: any[] = [];
  const ECHO_SCENE_FALLBACK_MS = 2 * 60 * 1000;
  function normalizeEcho(text: any) {
    return (cleanContent(text || "") || "").replace(/\s+/g, " ").trim();
  }
  function echoScene(echo: any) {
    return echo.message || echo.scene || {};
  }
  function echoTimesMatch(message: any, history: any) {
    const localTime = Number(message?.createdAt);
    const historyTime = Number(history?.createdAt);
    return !Number.isFinite(localTime) || !Number.isFinite(historyTime) ||
      Math.abs(localTime - historyTime) <= ECHO_SCENE_FALLBACK_MS;
  }
  // A persistence acknowledgement identifies a row, not the whole breath.
  // Ambiguous progress boundaries deliberately retain the legacy text fallback.
  function acceptPersisted(data: any) {
    const p = data.persisted;
    if (!p || p.kind !== "self" || !Number.isSafeInteger(p.seq) || p.seq <= 0 ||
        typeof p.stream_id !== "string" || !p.stream_id ||
        !["final", "act_talk", "partial"].includes(p.from) || handledPersisted.has(p.seq)) return;
    if (currentStreamId && currentStreamId !== p.stream_id) return;
    const progress = progressBubbles.filter(({ message }) =>
      (!message.historySeq || message.historySeq === p.seq) && state.items.includes(message));
    const current = streamMessage && (!streamMessage.historySeq || streamMessage.historySeq === p.seq) ? streamMessage : null;
    const fragments = [...progress, ...(current ? [{ message: current, text: streamText }] : [])];
    // A yielded partial can contain every speech fragment since the preceding
    // stop, even when the last tool/reasoning event already released the bubble.
    // Keep the exact raw fragments until history verifies this seq's coverage.
    if (p.from === "partial" && fragments.length > 1) {
      registerPersistedGroup(fragments, p);
      rememberPersisted(p.seq);
      return;
    }
    const candidates = p.from === "final" ? [current].filter(Boolean) : fragments.map(fragment => fragment.message);
    if (candidates.length !== 1) return;
    const message = candidates[0];
    message.persistedFrom = p.from;
    message.persistedStreamId = p.stream_id;
    if (p.from !== "final") message.interim = true;
    bindPersisted(message, p.seq);
    rememberPersisted(p.seq);
  }
  function rememberPersisted(seq: number) {
    handledPersisted.add(seq);
    while (handledPersisted.size > 1000) handledPersisted.delete(handledPersisted.values().next().value!);
  }
  function registerPersistedGroup(fragments: SpeechFragment[], persisted: any) {
    const owner = options.historyOwner?.();
    if (owner) return owner.registerPersistedGroup(fragments, persisted);
    pendingPersistedGroups.set(persisted.seq, { fragments, persisted });
    while (pendingPersistedGroups.size > 40) pendingPersistedGroups.delete(pendingPersistedGroups.keys().next().value!);
    // History may already have advanced past this seq, including rows skipped
    // while the scene was live. Resolve now rather than waiting for another page.
    const existing = state.items.find((item: any) => item.kind === "message" && item.historySeq === persisted.seq);
    const row = recentHistory.get(persisted.seq) || (existing && {
      seq: persisted.seq, role: "assistant", content: existing.text,
    });
    if (row) mergePersistedHistory(row);
  }
  function persistedGroupTextMatches(fragments: SpeechFragment[], content: string) {
    const body = normalizeEcho(content);
    const texts = fragments.map(fragment => normalizeEcho(fragment.text));
    if (!texts.length || texts.some(text => !text)) return false;
    // Active-stream replay can start halfway through a reply (even halfway
    // through its first visible paragraph). The acknowledgement already pins
    // this group to one durable seq: verify the visible suffix, not an absent
    // prefix. Still require every fragment, in order, through the end of the row.
    for (let start = body.indexOf(texts[0]); start >= 0; start = body.indexOf(texts[0], start + 1)) {
      let remaining = body.slice(start);
      let matches = true;
      for (const text of texts) {
        remaining = remaining.trimStart();
        if (!remaining.startsWith(text)) { matches = false; break; }
        remaining = remaining.slice(text.length);
      }
      if (matches && !remaining.trim()) return true;
    }
    return false;
  }
  function resolvePersistedGroup(row: any) {
    const group = pendingPersistedGroups.get(Number(row.seq));
    if (!group || row.role === "user") return;
    const { fragments, persisted } = group;
    // Do not erase independently persisted speech, other scenes, or a group
    // whose boundaries cannot be confirmed from this exact history row.
    if (fragments.some(({ message }) => !state.items.includes(message) ||
        (message.historySeq && message.historySeq !== persisted.seq)) ||
        !persistedGroupTextMatches(fragments, row.content)) return;
    pendingPersistedGroups.delete(persisted.seq);
    const first = fragments[0].message;
    const members = new Set(fragments.map(fragment => fragment.message));
    for (const message of members) {
      // Detached references can still be touched by the pending animation/stop;
      // give them their identity too so they cannot register another local echo.
      message.historySeq = persisted.seq;
      message.persistedStreamId = persisted.stream_id;
      message.persistedFrom = persisted.from;
      message.interim = true;
      message.streaming = false;
    }
    state.items = state.items.filter((item: any) => item === first ||
      (!members.has(item) && item.historySeq !== persisted.seq));
    localEchoes = localEchoes.filter(echo => !members.has(echo.message));
  }
  function bindPersisted(message: any, seq: number) {
    const owner = options.historyOwner?.();
    if (owner) return owner.bindPersisted(message, seq);
    const existing = state.items.find((item: any) => item !== message && item.kind === "message" && item.historySeq === seq);
    message.historySeq = seq;
    if (existing) state.items = state.items.filter((item: any) => item !== existing);
    const row = recentHistory.get(seq);
    if (row) mergePersistedHistory(row);
    else if (existing) {
      applyHistoryIdentity(message, existing);
      message.persistedText = existing.text;
      if (!message.streaming) message.text = existing.text;
    }
    localEchoes = localEchoes.filter(echo => echo.message !== message && echo.message !== existing);
    orderHistoryItem(message);
    changed();
  }
  function mergePersistedHistory(row: any) {
    resolvePersistedGroup(row);
    const message = state.items.find((item: any) => item.kind === "message" &&
      item.historySeq === Number(row.seq) && item.role === (row.role === "user" ? "user" : "being"));
    if (!message) return false;
    applyHistoryIdentity(message, historyIdentity(row));
    message.persistedText = cleanContent(row.role === "user" ? stripSceneTransition(stripClientMessageContext(row.content)) : row.content);
    if (!message.streaming) message.text = message.persistedText;
    changed();
    return true;
  }
  function historyEchoFor(role: any, texts: string[], scene: any, message: any) {
    // A previous reply may have identical text. Only a row added after this
    // live fragment can be its history echo; never steal an older reply's row.
    const localIndex = state.items.indexOf(message);
    const candidates = state.items.map((item: any, index: any) => ({ item, index })).filter(({ item, index }: any) =>
      index > localIndex && item !== message && item.kind === "message" && item.historySeq && !item.persistedStreamId &&
      item.role === role && texts.includes(normalizeEcho(item.text)));
    const exact = [...candidates].reverse().find(({ item }: any) => echoScenesMatch(item, message || scene));
    if (exact) return exact.item;
    if (role !== "being" || !message) return null;

    // A server can assign the canonical scene id while a reply is still live.
    // Only relax scene matching for the one persisted row appended after this
    // exact recent bubble; never collapse arbitrary equal text across scenes.
    const fallback = candidates.filter(({ item, index }: any) =>
      index > localIndex && echoTimesMatch(message, item));
    return fallback.length === 1 ? fallback[0].item : null;
  }
  function noteLocalEcho(role: any, text: any, scene: any = state.activeScene, localMessage: any = null, aliases: string[] = []) {
    const owner = options.historyOwner?.();
    if (owner) return owner.noteLocalEcho(role, text, scene, localMessage, aliases);
    if (localMessage?.historySeq) return;
    const t = normalizeEcho(text);
    if (!t) return;
    const texts = [t, ...aliases.map(normalizeEcho).filter(Boolean)];
    const message = localMessage || [...state.items].reverse().find(item => item.kind === "message" && item.role === role && item.sceneId === scene.sceneId && normalizeEcho(item.text) === t);
    // History can win the race against message_stop. In that order the normal
    // history -> local echo matcher has not been registered yet, so reconcile
    // the already-rendered persisted row back into the live bubble here.
    const history = historyEchoFor(role, texts, scene, message);
    if (history && message) {
      applyHistoryIdentity(message, history);
      state.items = state.items.filter((item: any) => item !== history);
      changed();
      return;
    }
    localEchoes.push({ role, texts, scene: { ...scene }, message, notedAt: Date.now(), historyFloor: lastHistorySeq });
    if (localEchoes.length > 40) localEchoes.shift();
  }
  function echoScenesMatch(a: any = {}, b: any = {}) {
    if (!a.sceneId || !b.sceneId || a.sceneId === b.sceneId) return true;
    return a.legacySceneId === b.sceneId || b.legacySceneId === a.sceneId;
  }
  function applyHistoryIdentity(message: any, history: any) {
    if (!message || !history) return;
    if (history.historySeq) message.historySeq = history.historySeq;
    if (history.interim) message.interim = true;
    if (history.timestamp) message.timestamp = history.timestamp;
    if (Number.isFinite(history.createdAt)) message.createdAt = history.createdAt;
    // Keep the live canonical scene when the server row uses its known legacy
    // alias. A missing live scene can safely adopt the persisted one.
    if (!message.sceneId && history.sceneId) {
      message.sceneId = history.sceneId;
      message.sceneLabel = history.sceneLabel;
    } else if (message.sceneId && history.sceneId && message.sceneId !== history.sceneId && !message.legacySceneId) {
      message.legacySceneId = history.sceneId;
    }
    orderHistoryItem(message);
  }
  // Durable seq is the ordering authority. Only move a confirmed item when its
  // neighbours contradict that order; preserve live objects and tool runs.
  function orderHistoryItem(message: any) {
    const index = state.items.indexOf(message);
    if (index < 0 || !message.historySeq) return;
    const misplaced = state.items.some((item: any, i: number) => item.historySeq &&
      (i < index ? item.historySeq > message.historySeq : i > index && item.historySeq < message.historySeq));
    if (!misplaced) return;
    state.items.splice(index, 1);
    const next = state.items.findIndex((item: any) => item.historySeq > message.historySeq);
    if (next >= 0) state.items.splice(next, 0, message);
    else {
      const previous = state.items.findLastIndex((item: any) => item.historySeq < message.historySeq);
      state.items.splice(previous + 1, 0, message);
    }
  }
  function consumeLocalEcho(role: any, text: any, scene: any, history: any) {
    if (role === 'user') {
      text = stripSceneTransition(stripClientMessageContext(text || ''));
      const ids = messageReferences(text);
      if (ids.length) {
        const matching = state.items.filter((item: any) => item.kind === 'message' && item.role === 'user' && !item.historySeq &&
          item.attachmentViews?.some((view: any) => ids.includes(view.message_id)));
        if (matching.length) {
          const item = matching[0]; item.text = text; item.queued = false;
          item.attachmentViews = ids.flatMap(id => matching.flatMap((m: any) => m.attachmentViews || []).filter((v: any) => v.message_id === id)).filter((v: any, i: number, all: any[]) => all.findIndex(x => x.message_id === v.message_id) === i);
          applyHistoryIdentity(item, history);
          state.items = state.items.filter((other: any) => other === item || !matching.includes(other));
          changed(); return true;
        }
      }
    }
    const t = normalizeEcho(text);
    if (!t) return false;
    const candidates = localEchoes.map((echo, index) => ({ echo, index })).filter(({ echo }) =>
      !echo.message?.historySeq && state.items.includes(echo.message) && echo.role === role && echo.texts.includes(t) &&
      // Full rebuilds also revisit old identical user text. It cannot confirm a
      // submission made after that history cursor was already observed.
      (role !== "user" || !history.historySeq || history.historySeq > echo.historyFloor));
    // A progress update and the final answer can legitimately have equal text.
    candidates.sort((a, b) => Number(!!a.echo.message?.interim) - Number(!!b.echo.message?.interim));
    const exact = candidates.find(({ echo }) => echoScenesMatch(scene, echoScene(echo)));
    let match = exact;
    if (!match && role === "being") {
      const fallback = candidates.filter(({ echo }) =>
        echo.message && !echo.message.historySeq &&
        Date.now() - echo.notedAt <= ECHO_SCENE_FALLBACK_MS &&
        echoTimesMatch(echo.message, history));
      if (fallback.length === 1) match = fallback[0];
    }
    if (!match) return false;
    const { echo, index } = match;
    if (echo.message) {
      if (scene.sceneId && !echo.message.sceneId) Object.assign(echo.message, scene);
      applyHistoryIdentity(echo.message, history);
      changed();
    }
    localEchoes.splice(index, 1);
    return true;
  }

  function historyIdentity(message: any, scene = messageScene(message)) {
    const time = message.at ? new Date(message.at).getTime() : undefined;
    return {
      ...scene,
      interim: message.from === "partial" || message.from === "act_talk",
      historySeq: Number(message.seq) || undefined,
      timestamp: formatHistoryTime(message.at),
      createdAt: Number.isFinite(time) ? time : undefined,
    };
  }

  function addHistoryMessage(message: any) {
    const scene = messageScene(message);
    const rendered = addMessage(
      message.role === "user" ? "user" : "being",
      message.content,
      false,
      formatHistoryTime(message.at),
      message.at,
      scene,
    );
    if (rendered) applyHistoryIdentity(rendered, historyIdentity(message, scene));
    return rendered;
  }

  async function restoreSceneHistory(scene: MessageScene) {
    if (!scene.sceneId || !historyCacheSeeded || disposed) return;
    const ids = [scene.sceneId, ...(!scene.strict && scene.legacySceneId ? [scene.legacySceneId] : [])];
    const cached = (await Promise.all(ids.map(id => historyCache.readScene(id,60)))).flat().sort((a, b) => a.seq - b.seq);
    if (disposed) return;
    insertCachedHistory(cached);
  }

  function insertCachedHistory(cached: any[]) {
    const present = new Set(state.items.map((item: any) => item.historySeq).filter(Boolean));
    let added = false;
    for (const message of normalizeHistoryRows(cached)) {
      // Cache rows can fill gaps anywhere in the timeline. Preserve live bubbles
      // using the same identity/echo reconciliation as network history.
      if (present.has(message.seq)) {
        if (!isHistoryMarker(message)) mergePersistedHistory(message);
        continue;
      }
      const identity = historyIdentity(message);
      if (isHistoryMarker(message) && mergeContinuationMarker(message.content, identity)) continue;
      const role = message.role === "user" ? "user" : "being";
      if (!isHistoryMarker(message) && (mergePersistedHistory(message) ||
          consumeLocalEcho(role, message.content, messageScene(message), identity))) continue;
      const text = isHistoryMarker(message)
        ? `· ${breathMarkerLabel(message.content)} · ${identity.timestamp} ·`
        : cleanContent(role === "user" ? stripSceneTransition(stripClientMessageContext(message.content)) : message.content);
      if (!text) continue;
      const item = isHistoryMarker(message)
        ? { ...identity, kind: "separator", id: `marker-${options.nextId()}`, marker: true, handoffMarker: /^\[breath yielded/i.test(message.content || ''), text }
        : { ...identity, kind: "message", id: `message-${options.nextId()}`, role, text,
            streaming: false, label: role === "user" ? "you" : beingName, consecutive: false };
      // Insert old records in sequence order without rebuilding live bubbles,
      // moving their tool runs, or changing the current stream's grouping state.
      const index = state.items.findIndex((existing: any) => existing.historySeq
        ? existing.historySeq > message.seq
        : existing.kind !== "separator" && (!identity.createdAt ||
            (existing.createdAt ?? existing.start ?? Infinity) >= identity.createdAt));
      state.items.splice(index < 0 ? state.items.length : index, 0, item);
      orderHistoryItem(item);
      options.restoredHistory?.add(item);
      present.add(message.seq);
      added = true;
    }
    if (added) changed();
  }

  // Publish one coherent snapshot. The view windows the DOM itself; publishing
  // ten rows per frame made it anchor to an incomplete first page and flash.
  async function renderHistoryBatched(messages: any[]) {
    if (!messages?.length || disposed) return;
    insertCachedHistory(messages);
    state.items.push({ kind: "separator", id: `gap-${options.nextId()}`, text: "· · ·" });
    changed();
  }

  // 返回新追加的消息条数。full=true 才清屏（首次加载 / 服务端重启）。
  function reconcileHistory(opts: any = {}) {
    // Ordinary refreshes must retain pending runs even before the first history seq.
    opts = { ...opts, preserve: opts.preserve ?? !opts.full };
    const owner = options.historyOwner?.();
    if (owner) return owner.reconcileHistory({ ...opts, preserve: true });
    if (reconcileInFlight) return reconcileInFlight;
    reconcileInFlight = reconcileHistoryOnce(opts).finally(() => {
      reconcileInFlight = null;
    });
    return reconcileInFlight;
  }

  async function refreshHistory() {
    const owner = options.historyOwner?.();
    if (owner) return owner.refreshHistory();
    // Wait for older reads instead of reusing them, so a later call still
    // observes the latest shared cursor. Scope changes filter locally and
    // must not go through this path.
    while (reconcileInFlight || cursorSyncInFlight) {
      await Promise.all([reconcileInFlight, cursorSyncInFlight]);
    }
    if (!disposed) await reconcileHistory({ preserve: true });
  }

  async function fetchHistory(incremental: any, prefetched = null) {
    let cursor = lastHistorySeq;
    const limit = chatHistoryLimit(state.historyLimit);
    const messages = [];
    while (!disposed) {
      const path = `/api/history?limit=${limit}${incremental ? `&after=${cursor}` : ''}`;
      let data;
      try {
        const res = prefetched || await fetch(apiUrl(path), { cache: "no-store", signal: timeoutSignal(8000) });
        prefetched = null;
        if (!res.ok) return messages.length ? normalizeHistoryRows(messages) : null;
        data = await res.json();
      } catch (error) {
        // Retain successfully fetched pages if a later page loses connection.
        if (messages.length) return normalizeHistoryRows(messages);
        throw error;
      }
      const page = normalizeHistoryRows(data.messages);
      // Keep overlap too: a cursor says where to request next, not which rows
      // the local cache contains (old versions may have left holes).
      messages.push(...page);
      const next = Math.max(cursor, ...page.map((m: any) => Number(m.seq) || 0));
      // Servers that ignore after= cannot cause an endless pagination loop.
      // The server may cap a page below the requested limit. Continue until
      // the cursor stops advancing so a larger preference cannot skip a gap.
      if (!incremental || next <= cursor) return normalizeHistoryRows(messages);
      cursor = next;
    }
    return null;
  }

  async function reconcileHistoryOnce({ full = false, preserve = false } = {}) {
    preserve = preserve || state.items.some((item: {kind:string;historySeq?:number}) => item.kind === "message" && !!item.historySeq);
    try {
      let hydrated = false;
      // The shell can select/refresh a scene before start() finishes reading
      // the outbox. That request uses preserve=true and may own the shared
      // reconciliation. Cache hydration must not depend on which caller wins.
      if (!historyCacheSeeded || (!preserve && (full || lastHistorySeq === 0))) {
        const cached = await historyCache.read(60);
        if (disposed) return 0;
        if (cached) {
          if (!preserve) resetMessages();
          await renderHistoryBatched(cached.messages);
          lastHistorySeq = Math.max(lastHistorySeq, cached.lastSeq);
          historyCacheSeeded = true;
          hydrated = true;
          if (state.historyScope === "current") await restoreSceneHistory(options.selectedScene?.() || state.currentScene);
          // A larger initial page can recover older rows not yet cached. Do not
          // advance the saved cursor: after= must still fill any offline gap.
          // Render the cache first so a slow network cannot hide offline history.
          const recent = await takePrefetch('history');
          try {
            if (recent?.ok) {
              const data = await recent.json();
              const older = normalizeHistoryRows(data.messages).filter(m => m.seq <= cached.lastSeq);
              if (older.length) {
                await historyCache.write(older, cached.lastSeq);
                if (!disposed) insertCachedHistory(older.sort((a: any, b: any) => a.seq - b.seq));
              }
            } else await recent?.body?.cancel();
          } catch { /* A failed recent-page read must not hide cached history. */ }
          if (disposed) return 0;
        }
      }
      if (!hydrated && state.historyScope === "current") await restoreSceneHistory(options.selectedScene?.() || state.currentScene);
      const incremental = hydrated || (!full && lastHistorySeq > 0);
      // A cached cursor needs after=, not only the prefetched latest page:
      // an offline gap may contain more than one page of messages.
      if (hydrated) {
        prefetch.history?.then((res: any) => res.body?.cancel()).catch(() => {});
        delete prefetch.history;
      }
      const msgs = await fetchHistory(incremental, await takePrefetch("history"));
      if (!msgs) return 0;
      let added = 0;
      let toCache = [];
      if (disposed) return 0;

      if (!incremental && !preserve) {
        resetMessages();
        toCache = msgs;
        await renderHistoryBatched(toCache);
        added = toCache.length;
      } else {
        if (cursorSyncInFlight) await cursorSyncInFlight;
        const fresh = msgs.filter((m) => (Number(m.seq) || 0) > lastHistorySeq);
        insertCachedHistory(msgs.filter(m => m.seq <= lastHistorySeq));
        toCache = msgs;
        for (const m of fresh) {
          if (isHistoryMarker(m)) {
            addBreathMarker(m.content, formatHistoryTime(m.at), historyIdentity(m));
            added++;
            continue;
          }
          const role = m.role === "user" ? "user" : "being";
          const scene = messageScene(m);
          if (mergePersistedHistory(m) || consumeLocalEcho(role, m.content, scene, historyIdentity(m, scene))) continue; // 本地已经渲染过了
          addHistoryMessage(m);
          added++;
        }
        if (added) changed();
      }

      if (msgs.length) {
        lastHistorySeq = Math.max(
          lastHistorySeq,
          ...msgs.map((m) => Number(m.seq) || 0),
        );
      }
      if (!incremental) historyCacheSeeded = true;
      cacheHistory(toCache, lastHistorySeq);
      return added;
    } catch (e: any) {
      console.warn("reconcileHistory failed:", e);
      return 0;
    }
  }

  // Reconcile persisted local echoes and retain simultaneous messages from other scenes.
  let cursorSyncInFlight: any = null;
  function syncHistoryCursor() {
    const owner = options.historyOwner?.();
    if (owner) return owner.syncHistoryCursor();
    // Serialize metadata/reply syncs: a second stop must still fetch history
    // after an earlier in-flight metadata request completes.
    const pending = (cursorSyncInFlight || Promise.resolve()).then(syncHistoryCursorOnce);
    cursorSyncInFlight = pending;
    void pending.finally(() => {
      if (cursorSyncInFlight === pending) cursorSyncInFlight = null;
    });
    return pending;
  }
  async function syncHistoryCursorOnce() {
    if (disposed) return;
    try {
      const msgs = await fetchHistory(lastHistorySeq > 0 && historyCacheSeeded);
      if (!msgs) return;
      if (disposed) return;
      if (msgs.length) {
        const fresh = msgs.filter(m => (Number(m.seq) || 0) > lastHistorySeq);
        insertCachedHistory(msgs.filter(m => m.seq <= lastHistorySeq));
        lastHistorySeq = Math.max(
          lastHistorySeq,
          ...msgs.map((m) => Number(m.seq) || 0),
        );
        for (const m of fresh) {
          const scene = messageScene(m);
          if (isHistoryMarker(m)) addBreathMarker(m.content, formatHistoryTime(m.at), historyIdentity(m));
          else {
            const role = m.role === "user" ? "user" : "being";
            // Only an exact persisted identity or a matched local echo can consume
            // history. A live scene may also contain older, unseen replies.
            if (!mergePersistedHistory(m) && !consumeLocalEcho(role, m.content, scene, historyIdentity(m, scene))) {
              addHistoryMessage(m);
            }
          }
        }
        changed();
        cacheHistory(msgs, lastHistorySeq);
      }
    } catch (_: any) {}
  }

  // A 202 response means the message was queued for a later SBS breath. Poll
  // history until that autonomous reply is persisted and render it incrementally.
  const CATCH_UP_INITIAL_MS = 2000;
  const CATCH_UP_MAX_INTERVAL_MS = 30000;
  const CATCH_UP_ABSOLUTE_MAX_MS = 5 * 60 * 1000;
  let catchUpTimer: any = null;
  let catchUpGeneration = 0;
  function logReplyWait(event: string) {
    console.info("[chat-reply-wait]", JSON.stringify({ event, at: new Date().toISOString(),
      sceneId: state.currentScene.sceneId, streamId: currentStreamId || lastStreamId,
      runId: currentRun?.id, phase: pendingReply?.phase, lastProgressAt: lastProgressTime,
      toolCount: actionLog.filter(entry => entry.type === "tool").length }));
  }
  function stopCatchUpWatcher() {
    // Invalidate history reads already in flight, not just scheduled ticks.
    catchUpGeneration++;
    if (catchUpTimer) {
      clearTimeout(catchUpTimer);
      catchUpTimer = null;
    }
  }
  function settleReplyBoundary() {
    if (!pendingReply) return;
    if (pendingReplyArrived()) { finishPendingReply(); return; }
    // Heart can end a breath during a scene switch without emitting a reply.
    // Keep the submitted request unresolved instead of showing a success check.
    pendingReply.phase = "reply";
    startCatchUpWatcher();
    updateSendButton();
  }
  function finishPendingReply(failed = false, idle = false) {
    if (!pendingReply) return;
    logReplyWait(failed ? "timeout" : "replied");
    pendingReply = null;
    stopCatchUpWatcher();
    actionLogFinalizePending();
    if (currentRun && !currentRun.end) {
      currentRun.entries = actionLog.map(entry => ({ ...entry }));
      currentRun.end = Date.now();
      currentRun.waitingForReply = false;
      currentRun.outcome = failed ? "timeout" : "done";
      currentRun.status = currentRun.outcome;
      currentRun.label = failed ? "等待超时，结果待确认" : "已回复";
      currentRun.hint = idle ? "服务端持续空闲 60 秒，仍未收到这条已接收消息的回复。已释放本地等待状态，可重试；未自动重发或停止后台任务。" : failed ? "连续等待 5 分钟仍未确认最终回复。后台任务可能仍在运行，本次等待超时未发送停止指令；可刷新查看最新结果。" : "";
    }
    replyRunSettled = true;
    changed();
  }
  function pendingReplyArrived() {
    const reply = pendingReply;
    return reply && state.items.some((item: any) => item.kind === "message" && item.role === "being"
      && inCurrentScene(item, state.currentScene) && !item.streaming && !item.interim && !reply.baseline.has(item)
      && !options.restoredHistory?.has(item)
      && (!Number.isFinite(item.createdAt) || item.createdAt >= Math.floor(reply.submittedAt / 1000) * 1000));
  }
  function startCatchUpWatcher() {
    stopCatchUpWatcher();
    if (!pendingReply || pendingReply.phase === "processing") return;
    const generation = catchUpGeneration;
    const reply = pendingReply;
    logReplyWait("started");
    const deadline = Date.now() + CATCH_UP_ABSOLUTE_MAX_MS;
    let delay = CATCH_UP_INITIAL_MS;
    const tick = async () => {
      catchUpTimer = null;
      if (generation !== catchUpGeneration || pendingReply !== reply) return;
      await reconcileHistory({ preserve: true });
      // Progress, cancellation, or a new wait may arrive while history loads.
      if (generation !== catchUpGeneration || pendingReply !== reply) return;
      if (pendingReplyArrived()) { finishPendingReply(); return; }
      await checkActiveStream();
      if (generation !== catchUpGeneration || pendingReply !== reply) return;
      if (!pendingReply || catchUpTimer) return;
      if (Date.now() >= deadline) { finishPendingReply(true); return; }
      // A live stream may belong to an earlier turn; keep watching queued work.
      delay = Math.min(delay * 2, CATCH_UP_MAX_INTERVAL_MS);
      catchUpTimer = setTimeout(tick, Math.min(delay, Math.max(0, deadline - Date.now())));
    };
    catchUpTimer = setTimeout(tick, delay);
    void checkActiveStream();
  }

  async function checkActiveStream() {
    const epoch = writerEpoch;
    try {
      const res =
        (await takePrefetch("active")) ||
        (await fetch(apiUrl("/api/stream/active"), {
          cache: "no-store",
          signal: timeoutSignal(8000),
        }));
      if (!res || res.status === 204 || !res.ok) return;
      const data = await res.json();
      // A local send or another recovery may have taken ownership while the
      // discovery request was in flight. Do not replace that newer transport.
      if (disposed || epoch !== writerEpoch || isStreaming) return;
      discoverActiveStream(data);
    } catch (e: any) {
      console.warn("checkActiveStream failed:", e);
    }
  }

  function discoverActiveStream(data: any) {
    if (disposed || isStreaming || chatRequestsInFlight || !data?.stream_id) return;
    traceNetwork('active', {streamId: data.stream_id, origin: data.origin, activeSceneId: data.scene_id ?? null,
      finished: data.finished, nextSeq: data.next_seq, eventCount: data.events?.length || 0});
    if (data.finished) return;
    // Autonomous events without a scene stay global even when a room is selected.
    const replay = data.origin && data.origin !== 'human' && !Object.hasOwn(data, 'scene_id')
      ? {...data, scene_id: null} : data;
    replayStream(replay);
  }

  function captureActivity() {
    return {epoch: writerEpoch, request: chatRequestRevision, reply: pendingReply, seq: liveSeq,
      progress: lastProgressTime, streamId: currentStreamId, busy: chatRequestsInFlight > 0};
  }
  async function reconcileActivity(data: any, snapshot: ReturnType<typeof captureActivity>) {
    // An old idle response must never reset a newer POST, reader or live event.
    if (disposed || snapshot.busy || chatRequestsInFlight || snapshot.epoch !== writerEpoch ||
        snapshot.request !== chatRequestRevision || snapshot.reply !== pendingReply ||
        snapshot.streamId !== currentStreamId || snapshot.seq !== liveSeq || snapshot.progress !== lastProgressTime) return;
    const id = currentStreamId || pendingRecovery?.streamId;
    const terminal = !data || data.finished === true || (id && data.stream_id !== id);
    if (terminal && (isStreaming || pendingRecovery) &&
        (id || (routedStreaming && Date.now() - lastProgressTime >= 30000))) {
      traceNetwork('reset-stale-stream', {streamId: id || null, reason: !data ? 'gone' : data.finished ? 'finished' : 'superseded'});
      await recoverViaHistory();
    } else if (pendingReplyArrived()) {
      finishPendingReply();
    }
    const reply = pendingReply;
    if (!reply || reply.phase !== 'queued' || isStreaming || pendingRecovery) return;
    if (data && data.finished !== true) { reply.idleSince = reply.idleObservedAt = undefined; return; }
    const now = Date.now();
    // Only consecutive, successful idle observations count. A failed poll or
    // any active stream must not turn a legitimate queue into a timeout.
    if (!reply.idleObservedAt || now - reply.idleObservedAt > 20000) reply.idleSince = now;
    reply.idleObservedAt = now;
    if (now - (reply.idleSince ?? now) < 60000) return;
    await reconcileHistory({preserve: true});
    if (disposed || pendingReply !== reply || writerEpoch !== snapshot.epoch ||
        chatRequestRevision !== snapshot.request || isStreaming || chatRequestsInFlight) return;
    if (pendingReplyArrived()) { finishPendingReply(); return; }
    traceNetwork('reset-orphaned-wait', {reason: 'server-idle-without-reply', idleMs: now - reply.idleSince!});
    finishPendingReply(true, true);
    updateSendButton();
  }

  function replayStream(data: any) {
    if (options.routeReplay?.(data)) return;
    if (disposed || chatRequestsInFlight || isStreaming) return;
    // If the stream already finished, its content is in history — skip replay to avoid duplicates
    if (data.finished) return;
    // This runtime may only own the replay transport. Event scene IDs, not
    // the selected desktop scene, determine which runtime has actual work.
    replayTransportOnly = true;
    autonomousStream = !!data.origin && data.origin !== 'human' && !messageScene(data).sceneId;
    autonomousOrigin = autonomousStream ? data.origin : undefined;
    autonomousHandedOff = false;
    replyRunSettled = false;
    if (Object.hasOwn(data, "scene_id")) setStreamScene(messageScene(data));

    if (activeStreamPollTimer) {
      clearTimeout(activeStreamPollTimer);
      activeStreamPollTimer = null;
    }

    isStreaming = true;
    currentStreamId = data.stream_id || null;
    if (currentStreamId) lastStreamId = currentStreamId;
    writerEpoch++; // F2: 接管写权
    streamMessage = null;
    streamText = "";
    streamReplyPrefix = "";
    progressBubbles = [];
    toolCount = 0;
    actionLogClear();
    removeThinkingIndicator();
    resetLiveProgress();
    updateSendButton();

    const events = Array.isArray(data.events) ? data.events : [];
    // A fresh replay buffer contains already-settled replies too. Restore their
    // prose/acknowledgements, but do not time old tool logs as brand-new activity.
    const settledThrough = new Map<string | undefined, number>();
    let eventScene = state.activeScene.sceneId;
    const eventScenes = events.map((item: any) => {
      if (Object.hasOwn(item.data || {}, 'scene_id')) eventScene = messageScene(item.data).sceneId;
      return eventScene;
    });
    if (!autonomousStream) events.forEach((item: any, index: number) => {
      // Only a later continuation proves these events belong to an older turn.
      // A stop without a continuation can be the reply a local 202 still awaits.
      if (item.event === 'meta' && item.data?.continuation === true) settledThrough.set(eventScenes[index], index - 1);
    });
    replayRunStartedAt = undefined;
    replayingInitialEvents = true;
    try {
      events.forEach((item: any, index: number) => processReplayEvent(item.event, item.data || {}, Number(item.seq) || undefined,
        index <= (settledThrough.get(eventScenes[index]) ?? -1)));
    } finally { replayingInitialEvents = false; replayRunStartedAt = undefined; }

    if (data.finished) {
      // 先渲染已累积的文字，再 finalize
      const replayText = cleanContent(streamText);
      if (replayText) streamMessage = addMessage("being", replayText, false);
      finalizeReplayStream();
      return;
    }

    const visibleText = cleanContent(streamText);
    if (visibleText && !streamMessage) streamMessage = addMessage("being", visibleText, true);

    setStatus("thinking");
    if (toolCount > 0) {
      tuiSet("act");
    } else if (visibleText) {
      tuiSet("thinking");
    } else {
      showThinkingIndicator();
      tuiSet("thinking");
    }

    const lastSeq = events.length
      ? Number(events[events.length - 1].seq) || 0
      : Math.max(0, (Number(data.next_seq) || 1) - 1);
    liveSeq = lastSeq;
    pollActiveStream(data.stream_id, lastSeq);
  }

  // ---- Replay polling (P1-8) --------------------------------------------------
  // 旧实现：没有绝对截止、没有空转计数、网络异常时只是静默退避重试。
  // provider fallback / stub 部署下 ActiveStream 永远 finished:false + 空 events，
  // 会让 UI 永久"思考中"且 isStreaming 卡死。
  const POLL_ABSOLUTE_MAX_MS = 1800000; // 30 min — 兜底硬截止
  const POLL_MAX_NET_FAILS = 6;

  function pollActiveStream(streamId: any, lastSeq: any) {
    let interval = 500;
    const MAX_INTERVAL = 5000;
    let cursor = lastSeq;
    let netFails = 0;
    const stall = makeStallTracker();
    const deadline = Date.now() + POLL_ABSOLUTE_MAX_MS;
    const myEpoch = ++writerEpoch; // F2: 接管写权，作废可能还活着的 live reader

    const reschedule = () => {
      if (isStreaming && myEpoch === writerEpoch)
        activeStreamPollTimer = setTimeout(poll, interval);
    };

    const poll = async () => {
      activeStreamPollTimer = null;
      if (!isStreaming) return;
      if (myEpoch !== writerEpoch) return; // F2: 已经被更新的写者接管
      if (currentStreamId && currentStreamId !== streamId) return; // 已经被别的流接管

      if (Date.now() > deadline) {
        console.warn(
          "pollActiveStream: absolute deadline reached, falling back to history",
        );
        await recoverViaHistory();
        return;
      }

      let events = [];
      let sawResponse = false;
      try {
        const res = await fetch(apiUrl(`/api/stream/active?after=${cursor}`), {
          cache: "no-store",
          signal: timeoutSignal(15000),
        });
        if (disposed || !isStreaming || myEpoch !== writerEpoch) return;
        sawResponse = true;
        netFails = 0;
        if (connState === "reconnecting" || connState === "offline")
          setConnState("online");

        if (res.status === 204) {
          // 流已被清理（10s 后台清理）→ 内容一定已经落盘
          await recoverViaHistory();
          return;
        }
        if (!res.ok) {
          interval = Math.min(interval * 1.5, MAX_INTERVAL);
          reschedule();
          return;
        }

        const data = await res.json();
        if (disposed || !isStreaming || myEpoch !== writerEpoch) return;
        traceNetwork('active-poll', {streamId: data.stream_id, origin: data.origin,
          activeSceneId: data.scene_id ?? null, finished: data.finished,
          nextSeq: data.next_seq, after: cursor, eventCount: data.events?.length || 0});
        if (data.stream_id !== streamId) {
          // 别的 tab 起了新流 → 对齐内容而不是静默 finalize
          await recoverViaHistory();
          return;
        }

        events = Array.isArray(data.events) ? data.events : [];
        for (const item of events) {
          const seq = Number(item.seq);
          if (Number.isFinite(seq) && seq <= cursor) continue;
          processReplayEvent(item.event, item.data || {}, Number(item.seq) || undefined);
          if (Number.isFinite(seq)) {
            cursor = Math.max(cursor, seq);
            liveSeq = cursor;
          }
          if (!isStreaming || myEpoch !== writerEpoch) return;
        }

        if (data.finished) {
          finalizeReplayStream();
          return;
        }
      } catch (e: any) {
        if (disposed || !isStreaming || myEpoch !== writerEpoch) return;
        netFails++;
        console.warn("pollActiveStream error:", e);
        if (netFails >= 2) {
          setConnState(navigator.onLine === false ? "offline" : "reconnecting");
        }
        if (netFails >= POLL_MAX_NET_FAILS) {
          // 连续失败太多次：交给连接状态机，恢复后 onReconnected 会 probe 回来
          console.warn(
            "pollActiveStream: giving up polling, handing off to connection state machine",
          );
          queueDisconnectRecovery(streamId, cursor);
          isStreaming = false;
          updateSendButton();
          return;
        }
      }

      if (events.length > 0) {
        interval = 500; // got data, poll fast
        stall.reset();
      } else {
        interval = Math.min(interval * 1.5, MAX_INTERVAL); // no data, slow down
        // 空转：既没有事件也没有 finished。可能是 provider/stub 路径（永远不写缓冲），
        // 也可能是真卡住。按相位预算升级提示，超过总预算就回落历史对账。
        if (sawResponse) {
          const stalledFor = stalledForMs();
          updateStallHint(stalledFor);
          if (stalledFor >= stallBudgetMs() && stall.dueForProbe()) {
            const { totalMs, nextInMs } = stall.onStalled();
            if (totalMs >= STALL_GIVEUP_MS) {
              console.warn(
                "pollActiveStream: stalled past budget, falling back to history",
              );
              await recoverViaHistory();
              return;
            }
            setTuiHint(
              `服务端也没有新进展，${Math.round(nextInMs / 1000)} 秒后再检查一次`,
            );
          }
        }
      }

      reschedule();
    };

    activeStreamPollTimer = setTimeout(poll, interval);
  }

  function traceStreamEvent(transport: string, type: string, data: any, seq?: number) {
    if (!['meta', 'message_stop', 'error', 'tool_use', 'tool_result', 'content_block_delta'].includes(type)) return;
    traceNetwork('stream-event', {transport, type, streamId: data.stream_id || currentStreamId,
      eventSceneId: data.scene_id ?? null, seq, persistedSeq: data.persisted?.seq,
      persistedFrom: data.persisted?.from, continuation: data.continuation === true,
      ...(type === 'content_block_delta' ? {textLength: typeof data.delta?.text === 'string' ? data.delta.text.length : 0} : {})});
  }
  function processReplayEvent(eventType: any, eventData: any, seq?: number, settled = false) {
    const previous = replayingSettledReply;
    replayingSettledReply = settled;
    try { applyReplayEvent(eventType, eventData, seq); }
    finally { replayingSettledReply = previous; }
  }
  function applyReplayEvent(eventType: any, eventData: any, seq?: number) {
    traceStreamEvent(seq === undefined ? 'routed' : 'replay', eventType, eventData, seq);
    if (options.routeEvent?.(eventType, eventData, replayingSettledReply)) {
      // SBS may hand the same transport to a room. Close the previous activity
      // segment without stopping the shared reader or the room's pending reply.
      if (autonomousStream && !autonomousHandedOff && PROGRESS_EVENTS.has(eventType) && eventType !== 'message_stop' && eventType !== 'error' &&
          (eventType !== 'content_block_delta' || eventData.delta?.text)) {
        solidifyReplayBubble();
        noteStreamEcho();
        streamMessage = null;
        streamText = '';
        // Keep this segment before the newly routed room's activity. updateRun
        // moves live runs to the tail and would reorder the history boundary.
        if (currentRun && !currentRun.end) {
          currentRun.entries = actionLog.map(entry => ({ ...entry }));
          currentRun.end = Date.now();
          currentRun.outcome = 'done';
          currentRun.status = 'done';
          currentRun.label = '已切换到场景对话';
          currentRun.hint = 'SBS 本段活动已结束，后续进展显示在对应场景。';
        }
        replayTransportOnly = true;
        autonomousHandedOff = true;
        changed();
      }
      return;
    }
    splitStreamProgress(eventType, eventData);
    if (replayingSettledReply && ['thinking', 'reasoning', 'tool_use', 'tool_result'].includes(eventType)) return;
    if (!replayingSettledReply) markProgress(eventType, eventData);
    switch (eventType) {
      case "meta":
        acceptPersisted(eventData);
        break;
      case "content_block_delta": {
        const text = eventData.delta?.text || "";
        if (!text) break;
        appendStreamText(text);
        break;
      }
      case "thinking":
      case "reasoning": {
        setStatus("thinking");
        const delta =
          (eventData &&
            (eventData.text || eventData.delta?.text || eventData.delta)) ||
          "";
        const last = actionLog[actionLog.length - 1];
        let entry;
        if (last && last.type === "think" && !last.done) {
          entry = last;
        } else {
          entry = { type: "think", preview: "", text: "" };
          actionLogPush(entry);
        }
        if (delta && typeof delta === "string") {
          entry.text = (entry.text || "") + delta;
          entry.preview = truncate(entry.text.trim(), 100);
          scheduleRenderActivityLog();
        }
        tuiSet("thinking");
        break;
      }
      case "tool_use":
        recordToolStart(eventData);
        break;
      case "tool_result":
        recordToolResult(eventData);
        break;
      case "message_stop":
        // F3: 和 live 通道同一套语义——message_stop 只结束一次回复。
        // 整条 breath 是否结束由服务端的 finished 说了算（F4 之后它只在
        // engine task 真正跑完时才置位），yield 续写会继续往同一条流里写。
        finalizeReplayReply();
        break;
      case "error":
        pendingReply = null;
        stopCatchUpWatcher();
        finalizePartialBubble();
        if (activeStreamPollTimer) clearTimeout(activeStreamPollTimer);
        activeStreamPollTimer = null;
        isStreaming = false;
        currentStreamId = null;
        removeThinkingIndicator();
        addMessage("system", "⚠ " + (eventData.message || "unknown error"));
        setStatus("error");
        tuiClear();
        actionLogClear();
        updateSendButton();
        clearTuiHint();
        reconcileHistory();
        break;
    }
  }

  // 一次回复收尾（end-of-reply）：把当前气泡定稿并交出去，但**不**结束轮询。
  // 续写会拿到一个全新的气泡。
  function finalizeReplayReply() {
    if (renderTimer) {
      cancelAnimationFrame(renderTimer);
      renderTimer = null;
    }
    solidifyReplayBubble();
    if (!replayingSettledReply) settleReplyBoundary();
    if (!pendingReply && !replayingSettledReply) {
      updateRun(true);
      replyRunSettled = true;
    }
    noteStreamEcho();
    streamMessage = null;
    streamText = "";
    removeThinkingIndicator();
    setStatus("connected");
    tuiDone();
    clearTuiHint();
    syncHistoryCursor();
  }

  function solidifyReplayBubble() {
    if (!streamMessage) return;
    setMessageStreaming(streamMessage, false);
    const finalText = cleanContent(streamText);
    if (finalText) updateMessage(streamMessage, finalText);
    else removeMessage(streamMessage);
  }

  function finalizeReplayStream() {
    options.finishRoutes?.();
    if (activeStreamPollTimer) clearTimeout(activeStreamPollTimer);
    activeStreamPollTimer = null;

    // 先把 streamText 固化为正式消息（如果还没渲染）
    solidifyReplayBubble();
    noteStreamEcho();
    settleReplyBoundary();

    isStreaming = false;
    if (currentStreamId) lastStreamId = currentStreamId;
    currentStreamId = null;
    streamMessage = null;
    streamText = "";
    pendingRecovery = null;
    setStatus("connected");
    tuiDone();
    clearTuiHint();
    removeThinkingIndicator();
    updateSendButton();
    // 不做历史渲染 — 内容已经在屏幕上了，只推进游标，
    // 这样之后的增量对账不会把刚流出来的回复再画一遍
    syncHistoryCursor();
  }

  let routedStreaming = false;
  let started = false;
  async function start() {
    if (started || disposed) return;
    started = true;
    for (const [key, path] of Object.entries({
      history: `/api/history?limit=${chatHistoryLimit(state.historyLimit)}`,
      status: "/api/status",
      active: "/api/stream/active",
    })) {
      prefetch[key] = fetch(apiUrl(path), { cache: "no-store", signal: timeoutSignal(8000) });
      prefetch[key].catch(() => {});
    }
    void (async () => {
      try {
        const res = await takePrefetch("status");
        if (!res?.ok || disposed) return;
        const data = await res.json();
        beingName = data.being_name || data.name || beingName;
        state.name = beingName;
        state.soul = {
          ...data,
          name: beingName,
          role: data.role || "BEING",
          quote: data.description || data.tagline || data.quote || "",
          born: data.created || data.born || "—",
          status: data.status || "connected",
        };
        if (location.protocol !== "beings:" && !isStreaming) {
          options.resolveDefaultScene?.({
            ...messageScene(browserScenePayload()),
            legacySceneId: `loom-${beingName}`,
          });
        }
        changed();
      } catch {
        /* The health monitor owns connectivity errors. */
      }
    })();
    await reconcileHistory({ full: true });
    if (disposed) return;
    // Avoid a second full history reconciliation on the first health probe.
    setConnState("online");
    setStatus("connected");
    void loadSbsState();
    installLifecycleHooks();
    await checkActiveStream();
    if (!disposed) {
      void checkHealth({ force: true });
      performance.mark("loom:ready");
    }
  }
  function dispose() {
    disposed = true;
    historyCache.close();
    historyCachePending = [];
    writerEpoch++;
    lifetime.abort();
    currentAbortController?.abort();
    timeouts.forEach(globalThis.clearTimeout);
    intervals.forEach(globalThis.clearInterval);
    frames.forEach(globalThis.cancelAnimationFrame);
    timeouts.clear();
    intervals.clear();
    frames.clear();
    cleanups.forEach((fn) => fn());
  }
  return {
    start,
    waitForPendingFiles,
    captureSendSnapshot: () => ({ draft: state.draft, files: [...pendingFiles] }),
    prepareSend,
    isBusy: () => (isStreaming && !replayTransportOnly && !autonomousStream) || !!pendingReply || !!pendingRecovery || preparingSend,
    isSceneStreaming: () => isStreaming && !autonomousStream && !replayTransportOnly && !replyRunSettled,
    activeAutonomousOrigin: () => isStreaming && !autonomousHandedOff ? autonomousOrigin : undefined,
    autonomousPhase: () => livePhase === "tool" ? "working" : livePhase === "text" ? "replying" : "thinking",
    settleHistoryReply: () => { if (pendingReplyArrived()) finishPendingReply(); },
    captureActivity,
    reconcileActivity,
    discoverActiveStream,
    stageQueuedSend(text: any, filesOverride = null, sendOptions: any = {}) {
    try { validateIntelligentUIContext(usesIntelligentUICommand(text || "") || !!sendOptions.uiAction || (!!state.intelligentUIEnabled && (sendOptions.intelligentUI ?? state.intelligentUIForMessage)), sendOptions.uiSnapshot ?? state.intelligentUISnapshots?.[state.currentScene.sceneId || 'global'], sendOptions.uiAction); }
    catch (error) { addMessage('system', error instanceof Error ? error.message : '智能 UI 上下文无效，未发送'); return null; }

      const msg = (text || "").trim();
      const files = Array.isArray(filesOverride) ? [...filesOverride] : [...pendingFiles];
      if (!msg && !files.length) return null;
      // An unsent draft must not change the active turn's grouping or run position.
      const message = { ...state.currentScene, kind: "message", id: `message-${options.nextId()}`,
        turnId: `turn-${options.nextId()}`, role: "user", text: msg || `[发送了 ${files.length} 个文件: ${files.map(f => f.name).join(", ")}]`,
        streaming: false, timestamp: formatTime(), createdAt: Date.now(), label: "you", consecutive: false, queued: true };
      state.items.push(message);
      const entry = { text: msg, files, message, sendOptions: { intelligentUI: sendOptions.intelligentUI ?? (state.intelligentUIEnabled && state.intelligentUIForMessage), uiAction: sendOptions.uiAction, uiSnapshot: sendOptions.uiSnapshot ?? state.intelligentUISnapshots?.[state.currentScene.sceneId || 'global'] } };
      if (!Array.isArray(filesOverride)) clearComposer();
      return entry;
    },
    noteLocalEcho,
    bindPersisted,
    registerPersistedGroup,
    revealHistory: (rows: any[]) => insertCachedHistory(rows),
    async loadHistoryTarget(seq: number, sceneId: string) {
      if (!Number.isSafeInteger(seq) || seq <= 0 || !sceneId || disposed) return false;
      const found = () => state.items.some((item: any) => item.kind === 'message' && item.historySeq === seq && item.sceneId === sceneId);
      if (found()) return true;
      const cached = await historyCache.readAround(seq, sceneId);
      if (disposed) return false;
      insertCachedHistory(cached);
      if (found()) return true;
      // A targeted read must not advance the global incremental sync cursor.
      try {
        const response = await fetch(apiUrl(`/api/history?after=${seq - 1}&limit=21`), { cache: 'no-store', signal: timeoutSignal(8000) });
        if (!response.ok || disposed) return false;
        const data = await response.json();
        const rows = normalizeHistoryRows(data.messages).filter(row => messageScene(row).sceneId === sceneId && row.seq >= seq).slice(0, 21);
        if (disposed) return false;
        insertCachedHistory(rows);
        await historyCache.write(rows, 0);
        return found();
      } catch { return false; }
    },
    async loadOlderHistory(before?: number) {
      const scene=options.selectedScene?.() || state.currentScene;
      const scope=state.historyScope, showSbsMessages=state.showSbsMessages;
      const include=(row:any)=>{const identity=row.kind ? row : messageScene(row);return scope==='all' || inCurrentScene(identity,scene) || (!identity.sceneId && row.role!=='user' && showSbsMessages);};
      const seqs=state.items.filter((item:any)=>item.historySeq && include(item)).map((item:any)=>item.historySeq);
      // Search and scene restoration can insert disjoint ranges. Read missing
      // rows below the newest loaded row so those gaps remain pageable.
      const present=new Set(seqs);
      const rows=await historyCache.readBefore(before ?? (seqs.length?Math.max(...seqs):Infinity),40,
        row=>!present.has(row.seq) && include(row));
      if(!disposed)insertCachedHistory(rows);
      return rows.length;
    },
    restoreSceneHistory,
    reconcileHistory,
    syncHistoryCursor,
    replyCompletedAt: () => currentRun?.label === "已回复" ? currentRun.end || 0 : 0,
    sceneActivity: () => {
      if (replayTransportOnly && !pendingReply) return null;
      if (pendingRecovery) return "reconnecting";
      if (pendingReply && (pendingReply.phase !== "processing" || !isStreaming))
        return pendingReply.phase === "queued" ? "queued" : "waiting";
      if (isStreaming && !replyRunSettled)
        return livePhase === "tool" ? "working" : livePhase === "text" ? "replying" : "thinking";
      if (currentRun?.end) {
        if (currentRun.outcome === "error" || currentRun.outcome === "timeout") return currentRun.outcome;
        if (currentRun.outcome === "stopped") return "stopped";
        // A bare reasoning/stop boundary does not establish that a reply arrived.
        return currentRun.label === "已回复" ? "done" : null;
      }
      return null;
    },
    hasStream: (id: any) => isStreaming && currentStreamId === id,
    recoverConnection: onReconnected,
    syncConnection: (next: any) => { connState = next; applyDotClass(); },
    acceptReplay: replayStream,
    acceptSceneEvent: (type: any, data: any, settled = false) => {
      if ((type === "meta" && !data.persisted) || type === "usage") return;
      // A boundary is not the start of another run. Shared streams may replay
      // stops for idle scenes; opening a run here creates a phantom "已结束 0 秒".
      if (!settled && !isStreaming && PROGRESS_EVENTS.has(type) && type !== "message_stop" && type !== "error") {
        routedStreaming = true;
        isStreaming = true;
        updateSendButton();
      }
      if (type === "message_stop" && data.session_id) sessionId = data.session_id;
      processReplayEvent(type, data, undefined, settled);
      if (!settled && routedStreaming && (type === "message_stop" || type === "error")) {
        routedStreaming = false;
        isStreaming = false;
        updateSendButton();
      }
    },
    finishRoutedStream: () => {
      if (!routedStreaming) return;
      routedStreaming = false;
      finalizeReplayStream();
    },
    dispose,
    send,
    stopCurrentTurn,
    handleFiles,
    removePending,
    loadLlmConfig,
    applyConfigChange,
    toggleSbs,
    loadSbsState,
    refreshHistory,
    refreshOnRegainedAttention,
    request: (path: any, init: any = {}) =>
      fetch(apiUrl(path), {
        ...init,
        headers: { ...configHeaders(), ...init.headers },
      }),
  };
}
