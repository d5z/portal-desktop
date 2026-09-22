import { createSceneRuntime } from "./scene-runtime";
import { HistoryCache } from "./history-cache";
import { inCurrentScene, messageScene } from "../models/scenes";

/**
 * Loom's streaming, replay and history protocol, independent of rendering.
 * Message references below are domain objects. React is the sole owner of their DOM.
 * Each mounted chat owns one runtime; disposal aborts requests and releases all timers.
 */
export function createChatRuntime(state, options = {}) {
  return createSceneRuntime(state, options, createStreamRuntime);
}

function createStreamRuntime(state, options) {
  const lifetime = new AbortController();
  let disposed = false;
  const timeouts = new Set(),
    intervals = new Set(),
    frames = new Set(),
    cleanups = [];
  const setTimeout = (fn, ms) => {
    if (disposed) return null;
    const id = globalThis.setTimeout(() => {
      timeouts.delete(id);
      if (!disposed) fn();
    }, ms);
    timeouts.add(id);
    return id;
  };
  const clearTimeout = (id) => {
    globalThis.clearTimeout(id);
    timeouts.delete(id);
  };
  const setInterval = (fn, ms) => {
    if (disposed) return null;
    const id = globalThis.setInterval(() => {
      if (!disposed) fn();
    }, ms);
    intervals.add(id);
    return id;
  };
  const clearInterval = (id) => {
    globalThis.clearInterval(id);
    intervals.delete(id);
  };
  const requestAnimationFrame = (fn) => {
    if (disposed) return null;
    const id = globalThis.requestAnimationFrame(() => {
      frames.delete(id);
      if (!disposed) fn();
    });
    frames.add(id);
    return id;
  };
  const cancelAnimationFrame = (id) => {
    globalThis.cancelAnimationFrame(id);
    frames.delete(id);
  };
  function listen(target, event, handler) {
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
      : params.get("api") || location.origin;
  const LOOM_TOKEN =
    location.protocol === "beings:" ? "" : params.get("token") || "";
  const RELAY_SECRET =
    location.protocol === "beings:"
      ? ""
      : params.get("relay_secret") || params.get("secret") || LOOM_TOKEN;
  function apiUrl(path) {
    return `${API_URL}${path}${LOOM_TOKEN ? (path.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(LOOM_TOKEN) : ""}`;
  }
  const fetch = async (input, init = {}) => {
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
      headers.set("X-Portal-Being-Endpoint", params.get("history_scope"));
      if (new URL(input, location.href).pathname === "/api/chat/stream" && requestScene)
        headers.set("X-Portal-Scene-Id", requestScene);
      init = { ...init, headers };
    }
    try {
      const response = await globalThis.fetch(input, { ...init, signal });
      report?.(response.ok);
      return response;
    } catch (error) {
      report?.(false);
      throw error;
    }
  };
  const prefetch = {};
  async function takePrefetch(key) {
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
  async function readJsonResponse(res) {
    const text = await res.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return { error: text };
    }
  }
  let configStatusTimer = null,
    configReadRevision = 0;
  function setConfigStatus(text, className = "") {
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
    } catch (e) {
      if (!disposed && revision === configReadRevision)
        setConfigStatus(e.message, "error");
    } finally {
      if (revision === configReadRevision) {
        state.configLoading = false;
        changed();
      }
    }
  }
  async function applyConfigChange(patch) {
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
      if (!res.ok || !data.ok) throw new Error(data.error || "设置未能保存，请稍后重试。");
      if (data.config) state.config = data.config;
      setConfigStatus(
        data.rolled_back ? "已恢复上次可用配置" : "设置已更新",
        "success",
      );
      configStatusTimer = setTimeout(() => setConfigStatus(""), 3000);
      return data;
    } catch (e) {
      if (!disposed) setConfigStatus(e.message, "error");
      return null;
    }
  }
  let currentRun = null;
  let pendingReply = null;
  let replyRunSettled = false;
  let replayTransportOnly = false;
  function setStreamScene(scene) {
    state.activeScene = {
      ...scene,
      sceneLabel: scene.sceneLabel || (scene.sceneId === state.currentScene.sceneId ? state.currentScene.sceneLabel : undefined),
    };
    changed();
  }
  function updateMessage(message, text) {
    if (!message) return;
    message.text = text;
    changed();
  }
  function setMessageStreaming(message, streaming) {
    if (!message) return;
    message.streaming = streaming;
    changed();
  }
  function removeMessage(message) {
    if (!message) return;
    state.items = state.items.filter((item) => item !== message);
    changed();
  }
  function moveRun() {
    if (currentRun && !currentRun.end && state.items.at(-1) !== currentRun) {
      state.items = state.items.filter((item) => item !== currentRun);
      state.items.push(currentRun);
    }
  }
  function updateRun(finished = false) {
    if (replayTransportOnly && !pendingReply) return;
    if (replyRunSettled) return;
    if (!currentRun || currentRun.end) {
      if ((!isStreaming && !pendingReply) || finished) return;
      currentRun = {
        ...state.activeScene,
        kind: "run",
        id: `run-${options.nextId()}`,
        entries: [],
        start: Date.now(),
        label: "思考中",
        hint: "",
        arg: "",
      };
      state.items.push(currentRun);
    }
    const run = currentRun;
    moveRun();
    if (actionLog.length || !run.entries.length || isStreaming)
      run.entries = actionLog.map((entry) => ({ ...entry }));
    const waiting = Boolean(pendingReply?.waiting) || (!isStreaming && Boolean(pendingRecovery || pendingReply));
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
    } else {
      run.label = waiting
        ? pendingReply ? pendingReply.label : "正在恢复连接"
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
  let sessionId = null;
  let isStreaming = false,
    streamMessage = null,
    streamText = "";
  let renderTimer = null;
  let beingName = state.name;

  // ---- Connection state machine (P1-4) ----
  // 替换原来的 `connected` 布尔 + 散落的 setStatus 调用。
  // 'connecting' | 'online' | 'degraded' | 'reconnecting' | 'offline'
  let connState = state.connection || "connecting";
  let streamStatus = "connected"; // 由 setStatus 维护的"流状态"：connected / thinking / error
  let healthTimer = null;
  let healthBackoff = 0;
  let healthInFlight = false;
  let serverCommit = null;
  const HEALTH_BACKOFF_MS = [1000, 2000, 4000, 8000, 15000, 30000, 60000];
  const HEALTH_OK_INTERVAL_MS = 15000;
  const jitter = (ms) => Math.round(ms * (0.75 + Math.random() * 0.5)); // ±25%，防惊群
  let pendingFiles = [];
  const pendingFileReads = new Set();
  let preparingSend = false;
  let toolCount = 0,
    connectTime = null;
  let lastMessageTime = null;
  let currentAbortController = null;
  let currentStreamId = null;
  let lastStreamId = null; // 断线恢复需要它——currentStreamId 会在收尾时被清掉
  // F1: 外部（非 watchdog）发起的 cutover 会 abort 正在跑的 live reader。
  // reader 的 catch 靠这个槽把 AbortError 认成"已经交接给 replay 通道"，
  // 而不是走 handleStreamError → finalizeSendCleanup（那会把 isStreaming 打回 false，
  // 连刚起来的 poller 一起杀掉）。
  let externalCutover = null;
  // F2: 写者所有权令牌。streamMessage / streamText 同一时刻只允许一个写者。
  // 每个 reader / poller 启动时 ++writerEpoch 并记住自己的号；写之前对一次号，
  // 对不上就静默丢弃。任何路径上的重叠都因此变得无害。
  let writerEpoch = 0;
  let sendQueue = [];

  let activeStreamPollTimer = null;

  // ---- Live stream progress (P1-2) ----
  // liveSeq counts replayed events, including continuation meta but excluding initial transport meta.
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
  let sbsTransitionTimer = null;
  let sbsToggling = false;
  let sbsConfigRevision = 0;
  let sbsLoading = null;

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
  function setSbsEnabled(enabled, animate) {
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
      } catch (_) {
        return undefined;
      } finally {
        sbsLoading = null;
      }
    })();
    return sbsLoading;
  }

  function setStatus(state) {
    streamStatus = state;
    applyDotClass();
    updateSendButton();
  }

  const CONN_BANNER = {
    connecting: null,
    online: null,
    degraded: "连接不稳定，正在重试…",
    reconnecting: "重连中…",
    offline: "已离线，恢复网络后会自动继续",
  };

  function setConnState(next, detail) {
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
  let tuiTimer = null;
  let tuiStartTime = null;
  let tuiElapsedTimer = null;

  const tuiLabels = {
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

  let tuiCurrentState = null;
  let tuiCurrentArg = "";
  let tuiCurrentPreview = "";

  // ── Per-breath activity log ─────────────────────────────────
  // Entries:
  //   { type: 'think', preview: string, ts: number, done?: boolean, duration?: number }
  //   { type: 'tool',  name, label, arg, ts, result?, error?, done? }
  let actionLog = [];
  const ACTION_LOG_MAX = 50;
  let activityLogClearTimer = null;
  let renderActivityLogTimer = null;
  let renderActivityLogPending = false;

  function truncate(s, n) {
    if (!s) return "";
    s = String(s);
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  function basename(p) {
    if (!p) return "";
    const s = String(p);
    const idx = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
    return idx >= 0 ? s.slice(idx + 1) : s;
  }

  function extractKeyArg(input) {
    if (!input || typeof input !== "object") return "";
    // Prefer well-known keys per tool shape; fall back to first string value.
    if (typeof input.query === "string") return truncate(input.query, 60);
    if (typeof input.path === "string") return basename(input.path);
    if (typeof input.file_path === "string") return basename(input.file_path);
    if (typeof input.command === "string") return truncate(input.command, 50);
    if (typeof input.url === "string") {
      try {
        return new URL(input.url).hostname;
      } catch (_) {
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

  function summarizeToolResult(data) {
    // data = tool_result event payload. Keep it VERY brief.
    if (!data) return "";
    if (data.is_error) return "出错了";
    // Backend ships `summary` (string) — see http.rs stream mapping.
    let text = "";
    if (typeof data.summary === "string") text = data.summary;
    else if (typeof data.content === "string") text = data.content;
    if (!text) return "";
    const trimmed = text.trim();
    if (!trimmed) return "";
    // Compact single-line preview (drop newlines, truncate)
    const oneLine = trimmed.replace(/\s+/g, " ");
    return truncate(oneLine, 60);
  }

  function parseToolInput(raw) {
    if (raw == null) return {};
    if (typeof raw === "object") return raw;
    if (typeof raw !== "string") return {};
    try {
      return JSON.parse(raw);
    } catch (_) {
      return {};
    }
  }

  function actionLogPush(entry) {
    entry.ts = entry.ts || Date.now();
    actionLog.push(entry);
    if (actionLog.length > ACTION_LOG_MAX) {
      actionLog.splice(0, actionLog.length - ACTION_LOG_MAX);
    }
    scheduleRenderActivityLog();
  }

  function actionLogFinalizePending() {
    // Mark any in-progress entries as done, record duration for thinks.
    const now = Date.now();
    for (const a of actionLog) {
      if (!a.done) {
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
        renderActivityLog();
        // start another cooldown window
        scheduleRenderActivityLog();
      }
    }, 200);
  }

  function renderActivityLog() {
    updateRun();
    changed();
  }

  function tuiSet(stateName, label, opts = {}) {
    tuiCurrentState = label || tuiLabels[stateName] || "在行动";
    tuiCurrentArg = opts.arg || "";
    tuiCurrentPreview = opts.preview || "";
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

  function setTuiHint(text) {
    tuiHintText = text || "";
    updateRun();
    changed();
  }

  function clearTuiHint() {
    setTuiHint("");
  }

  // 由 watchdog 和 tui 计时器共同驱动的"温和升级"提示
  function updateStallHint(stalledFor) {
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

  function updateTuiPreviewInline(preview) {
    tuiCurrentPreview = preview;
    changed();
  }

  function tuiClear() {
    clearInterval(tuiElapsedTimer);
    tuiElapsedTimer = null;
    tuiCurrentState = null;
    tuiCurrentArg = "";
    tuiCurrentPreview = "";
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
  let lastRole = null;
  let lastSceneId;
  function addMessage(
    role,
    text,
    streaming = false,
    timestamp = null,
    isoTime = null,
    scene = role === "being" ? state.activeScene : state.currentScene,
  ) {
    if (!streaming && role !== "system") text = cleanContent(text);
    if (!text && !streaming) return null; // skip empty after cleaning

    const ts = timestamp || formatTime();
    const label = role === "user" ? "you" : beingName;

    // Resolve message epoch for gap detection
    const msgTime = isoTime
      ? new Date(isoTime).getTime()
      : timestamp
        ? null
        : Date.now();
    const prevMessageTime = lastMessageTime;

    // Time gap if >5min since last message — applies to both live and history
    let hasTimeGap = false;
    let breaksRoleGroup = false;
    if (prevMessageTime && msgTime) {
      const gap = Math.abs(msgTime - prevMessageTime);
      breaksRoleGroup = gap > 60000;
      if (gap > 300000) {
        hasTimeGap = true;
        const prev = new Date(prevMessageTime);
        addTimeGap(formatMessageTime(prev), scene);
      }
    }
    if (msgTime) lastMessageTime = msgTime;

    // Break consecutive grouping if there's a time gap (being's moments should be separate)
    const consecutive =
      role === lastRole && scene.sceneId === lastSceneId && role !== "system" && !hasTimeGap && !breaksRoleGroup;
    lastRole = role;
    lastSceneId = scene.sceneId;

    const message = {
      ...scene,
      kind: "message",
      id: `message-${options.nextId()}`,
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

  function addTimeGap(text, scene) {
    state.items.push({
      ...scene,
      kind: "separator",
      id: `gap-${options.nextId()}`,
      text: `— ${text} —`,
    });
    changed();
  }

  // History markers describe an autonomous breath transition; render them as a
  // separator so SBS activity is visible without pretending it was a chat bubble.
  function isHistoryMarker(m) {
    return !!m && (m.from === "system" || m.type === "marker");
  }
  const BREATH_MARKER_LABELS = [
    [/^\[breath yielded/i, "放下手头的事，转向你"],
    [/^\[breath interrupted/i, "已停止"],
    [/^\[breath superseded/i, "被新的对话取代"],
  ];
  function breathMarkerLabel(text) {
    const raw = (text || "").trim();
    for (const [re, label] of BREATH_MARKER_LABELS)
      if (re.test(raw)) return label;
    return raw.replace(/^\[|\]$/g, "");
  }
  function addBreathMarker(text, timestamp = null, scene = {}) {
    state.items.push({
      ...scene,
      kind: "separator",
      id: `marker-${options.nextId()}`,
      marker: true,
      text: `· ${breathMarkerLabel(text)} · ${timestamp || formatTime()} ·`,
    });
    lastRole = "system";
    changed();
  }

  function showThinkingIndicator() {
    state.thinking = true;
    changed();
  }

  function removeThinkingIndicator() {
    state.thinking = false;
    changed();
  }

  function formatTime() {
    return formatMessageTime(new Date());
  }
  function formatHistoryTime(iso) {
    return formatMessageTime(new Date(iso), iso);
  }
  function formatMessageTime(date, fallback = "") {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return fallback;
    const pad = (value) => String(value).padStart(2, "0");
    const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    const today = new Date();
    if (date.getFullYear() === today.getFullYear() &&
        date.getMonth() === today.getMonth() &&
        date.getDate() === today.getDate()) return time;
    return `${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日 ${time}`;
  }
  function formatSize(bytes) {
    return bytes < 1024
      ? bytes + "B"
      : bytes < 1048576
        ? (bytes / 1024).toFixed(1) + "KB"
        : (bytes / 1048576).toFixed(1) + "MB";
  }
  // Filter out DSML/tool_call raw content
  function cleanContent(text) {
    if (!text) return "";
    const fences = [];
    text = text.replace(/```[\s\S]*?```/g, (block) => {
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
    text = text.replace(/@@FENCE_(\d+)@@/g, (_, i) => fences[Number(i)] || "");
    // Clean up excessive blank lines left behind
    text = text.replace(/\n{3,}/g, "\n\n").trim();
    return text;
  }

  // ---- Files ----
  function handleFiles(fileList) {
    for (const file of fileList) {
      if (file.size > 10 * 1024 * 1024) {
        addMessage("system", "⚠ File too large: " + file.name);
        continue;
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
      const reading = new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        reader.onload = () => {
          if (!disposed && pendingFiles.includes(pending)) {
            pending.base64 = reader.result.split(",")[1] || reader.result;
            pending.loading = false;
            renderPendingFiles();
          }
          finish();
        };
        reader.onerror = () => {
          if (!disposed) {
            pendingFiles = pendingFiles.filter((item) => item !== pending);
            renderPendingFiles();
            addMessage("system", "⚠ 无法读取附件：" + file.name);
          }
          finish();
        };
        reader.onabort = finish;
      });
      pendingFileReads.add(reading);
      reading.finally(() => pendingFileReads.delete(reading));
      cleanups.push(() => {
        if (reader.readyState === FileReader.LOADING) reader.abort();
      });
      try { reader.readAsDataURL(file); }
      catch { reader.onerror(); }
    }
  }
  async function waitForPendingFiles() {
    while (pendingFileReads.size)
      await Promise.allSettled([...pendingFileReads]);
  }
  function renderPendingFiles() {
    state.files = [...pendingFiles];
    updateSendButton();
  }
  function removePending(idx) {
    pendingFiles.splice(idx, 1);
    renderPendingFiles();
  }

  // ---- Send ----
  function clearComposer() {
    state.draft = "";
    pendingFiles = [];
    renderPendingFiles();
  }

  function updateQueueIndicator() {
    state.queued = sendQueue.length;
    updateSendButton();
  }

  function queueDraft() {
    const msg = (state.draft || "").trim();
    if (!msg && !pendingFiles.length) return false;
    sendQueue.push({ message: msg, files: [...pendingFiles] });
    clearComposer();
    updateQueueIndicator();
    return true;
  }

  let lastSendFailed = false;

  function flushQueuedMessage() {
    if (isStreaming || !sendQueue.length) return;
    const next = sendQueue.shift();
    updateQueueIndicator();
    send(next.message, next.files);
  }

  function scheduleFlushQueue() {
    if (!sendQueue.length) return;
    if (lastSendFailed) {
      // 失败后等 3 秒再发下一条，给网络恢复时间
      setTimeout(flushQueuedMessage, 3000);
    } else {
      flushQueuedMessage();
    }
  }

  function sleepAbortable(ms, signal) {
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

  async function fetchWithRetry(
    url,
    makeOptions,
    { maxNetworkRetries = 3, maxServerRetries = 1, onRetry } = {},
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
      } catch (e) {
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

  let fetchRetryMessage = null;

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

  function addNetworkFailureMessage(text, files) {
    const scene = { ...state.activeScene };
    const message = addMessage("system", "⚠ 网络连接失败，请检查网络后重试", false, undefined, undefined, scene);
    message.retry = () => {
      if (state.currentScene.sceneId !== scene.sceneId) {
        message.text = "请切换回这条消息所属的场景后重试。"; changed(); return;
      }
      removeMessage(message);
      return send(text, files?.length ? files : null, { isManualRetry: true });
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
  const STALL_MS = {
    awaiting_first: 75000, // POST 已 200，但一个 SSE 事件都没有（TTFT 上限 + 余量）
    reasoning: 90000, // reasoning delta 之间；部分 provider 只给汇总
    text: 45000, // 文本 delta 之间断 45s = 几乎必然异常
    tool: 300000, // run_command / browse_web 跑 5 分钟是合法的，不能杀
  };
  // probe 判定 stalled 后的重试退避，以及硬中止的累计预算
  const STALL_BACKOFF_MS = [30000, 60000, 120000];
  const STALL_GIVEUP_MS = 900000; // 15 min

  let livePhase = "awaiting_first"; // awaiting_first | text | tool | reasoning
  let livePendingTool = null;
  let lastProgressTime = Date.now();
  let hiddenAt = null; // 页面转入后台的时刻，用于"暂停计时"而不是"续命"

  function resetLiveProgress() {
    liveSeq = 0;
    livePhase = "awaiting_first";
    livePendingTool = null;
    lastProgressTime = Date.now();
    hiddenAt = visibilityState() === "hidden" ? Date.now() : null;
    clearTuiHint();
  }

  function markProgress(type, data) {
    if (!PROGRESS_EVENTS.has(type)) return;
    const active = type !== "message_stop" && type !== "error";
    if (active) {
      // Empty deltas and transport boundaries do not resume processing.
      if (type === "content_block_delta" && !data?.delta?.text) return;
      if ((type === "thinking" || type === "reasoning") &&
          !(data?.text || data?.delta?.text || (typeof data?.delta === "string" && data.delta))) return;
      replayTransportOnly = false;
      if (currentRun?.end) {
        // The previous segment remains in the transcript. The new segment must
        // not inherit its tool entries, failure state, or elapsed time.
        actionLog = [];
        currentRun = null;
        userStoppedStream = false;
        tuiCurrentState = "思考中";
        tuiCurrentArg = "";
      }
      replyRunSettled = false;
      if (pendingReply?.waiting) {
        pendingReply.waiting = false;
        pendingReply.label = "等待处理中";
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
    };
  }

  // AbortSignal.timeout 在老 Safari 上没有，做个降级
  function timeoutSignal(ms) {
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
  async function probeStream(streamId, localSeq) {
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
    } catch (_) {
      return { verdict: "unreachable" };
    }
  }

  // 无缝 cutover：**不能**走 replayStream()，它会把 streamText 清空重来。
  // processReplayEvent 是追加语义，会复用现有的 streamMessage / streamText，
  // 从 after=localSeq 接上去文字严丝合缝，一个字不重不漏。
  function cutoverToReplay(streamId, fromSeq) {
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
      } catch (_) {}
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
    writerEpoch++; // F2: 作废所有在途写者，别让残存的 reader 往新屏幕上写
    const partialMessage = streamMessage;
    const partialText = streamText;
    streamMessage = null;
    streamText = "";
    isStreaming = false;
    if (currentStreamId) lastStreamId = currentStreamId;
    currentStreamId = null;
    currentAbortController = null;
    pendingRecovery = null;
    removeThinkingIndicator();

    const previousItems = new Set(state.items);
    await reconcileHistory();
    const recovered = state.items.some(item => item.kind === "message" && item.role === "being"
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
    lastSendFailed = false;
    updateSendButton();
    scheduleFlushQueue();
    return recovered;
  }

  // 非 SSE 上下文（重连后、replay 轮询中）复用的决策表
  async function applyProbeVerdict(p, streamId, localSeq) {
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
  let pendingRecovery = null;

  function queueDisconnectRecovery(streamId, localSeq) {
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
    const p = await probeStream(r.streamId, r.localSeq);
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
  async function consumeChatStream(res, msg, filesToSend) {
    routedStreaming = false;
    let streamTimeoutId = null;
    let watchdogAborted = false;
    streamWatchdogAborted = false;
    userStoppedStream = false;
    let sawServerError = false;
    let sawSceneEvent = false;
    let cutoverRequest = null; // probe 判定 progressing/finished → 热切换到 replay
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
      } catch (_) {}
    };
    const hardTimeout = () => {
      watchdogAborted = true;
      streamWatchdogAborted = true;
      abortReader();
    };

    // watchdog 到期 → **不直接 abort**，先 probe 服务端有没有进展。
    // 决策表见 probeStream 上方注释。
    async function onWatchdogExpired(tracker) {
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
      streamMessage = null;
      streamText = "";
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
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
            continue;
          }
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));

            // Initial transport meta is not persisted, but scene continuation
            // meta is a sequenced replay event (observed on the deployed Heart).
            if (eventType && (eventType !== "meta" || data.continuation === true)) {
              liveSeq++;
              if (PROGRESS_EVENTS.has(eventType)) lastProgressTime = Date.now();
            }

            if (myEpoch !== writerEpoch) continue;
            if (options.routeEvent?.(eventType, data)) continue;
            markProgress(eventType, data);
            if (["content_block_delta", "thinking", "reasoning", "tool_use", "tool_result", "message_stop", "error"].includes(eventType)) sawSceneEvent = true;

            if (eventType === "meta") {
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
              if (pendingReply) pendingReply.waiting = false;
              removeThinkingIndicator();
              tuiClear();
              streamText += text;

              if (!streamMessage) {
                streamMessage = addMessage("being", streamText, true);
              }
              // Smooth streaming: rAF for visual updates, markdown re-parse throttled
              if (!renderTimer) {
                const rafEpoch = writerEpoch;
                renderTimer = requestAnimationFrame(() => {
                  renderTimer = null;
                  if (rafEpoch !== writerEpoch) return; // F2
                  if (streamMessage && streamText) {
                    const visible = cleanContent(streamText);
                    if (visible) {
                      updateMessage(streamMessage, visible);
                      changed();
                    }
                  }
                });
              }
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
              tuiSet("thinking", null, {
                preview: truncate(entry.preview || "", 60),
              });
            }

            if (eventType === "tool_use") {
              removeThinkingIndicator();
              toolCount++;
              const name = data.name || "tool";
              const parsedInput = parseToolInput(data.input);
              const arg = extractKeyArg(parsedInput);
              const label = tuiLabels[name] || "在行动";
              // Finalize the previous thinking entry (record duration).
              const prev = actionLog[actionLog.length - 1];
              if (prev && prev.type === "think" && !prev.done) {
                prev.done = true;
                prev.duration = Math.max(
                  1,
                  Math.round((Date.now() - prev.ts) / 1000),
                );
              }
              actionLogPush({ type: "tool", name, label, arg });
              tuiSet(name, null, { arg, preview: "" });
              setStatus("thinking");
            }

            if (eventType === "tool_result") {
              const isError = data.is_error || false;
              // Update last matching tool entry.
              for (let i = actionLog.length - 1; i >= 0; i--) {
                const a = actionLog[i];
                if (a.type === "tool" && !a.done) {
                  a.done = true;
                  a.error = !!isError;
                  a.result = summarizeToolResult(data);
                  break;
                }
              }
              scheduleRenderActivityLog();
              if (isError) {
                const resultName = tuiLabels[data.name] || data.name || "行动";
                tuiSet("error", resultName + " ✗");
                clearTimeout(tuiTimer);
                tuiTimer = setTimeout(() => tuiSet("thinking"), 1500);
              } else {
                tuiSet("thinking", null, { preview: "" });
              }
            }

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
              noteLocalEcho("being", streamText);
              settleReplyBoundary();
              streamMessage = null;
              streamText = "";
              if (data.session_id) sessionId = data.session_id;
              setStatus("connected");
              tuiDone();
              clearTuiHint();
              lastSendFailed = false;
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
              lastSendFailed = true;
            }
          } catch (parseErr) {
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
          addMessage("being", visibleText);
        }
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
    } catch (e) {
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
    // 恢复流程在途时先不放队列——否则可能在 cutover 之前又起一条新 breath
    if (pendingRecovery) return;
    scheduleFlushQueue();
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

  async function spliceSend(text, files = pendingFiles) {
    const replyBaseline = new Set(state.items);
    let spliceMsg = (text || "").trim();
    if (!spliceMsg && !files.length) return;
    spliceMsg = options.prepareMessage?.(spliceMsg || `[${files.length} file(s)]`) ?? spliceMsg;
    addMessage("user", spliceMsg || `[${files.length} file(s)]`);
    noteLocalEcho("user", spliceMsg);
    clearComposer();
    let res;
    try {
      res = await fetch(apiUrl("/api/chat/stream"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: spliceMsg || `[Sent ${files.length} file(s)]`,
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
    } catch (e) {
      console.warn("splice send failed:", e);
      addMessage("system", "⚠️ 发送失败，稍后重试");
      return;
    }
    if (res.status === 202) {
      // Heart accepted this input for splice/yield. The Being decides whether
      // to resume, switch scene or delegate; 202 is not task completion.
      pendingReply = { baseline: replyBaseline, label: "已排队，等待回复" };
      updateSendButton();
      startCatchUpWatcher();
      return;
    }
    if (res.ok && res.body) {
      console.warn("splice 收到 200，本地 isStreaming 状态已脏，转入流读取");
      isStreaming = false;
      setStatus("thinking");
      actionLogClear();
      tuiSet("thinking");
      showThinkingIndicator();
      isStreaming = true;
      updateSendButton();
      await driveChatStream(res, spliceMsg, [], replyBaseline);
      return;
    }
    // 非 200/202：主动排空 body，别让连接挂着
    res.body?.cancel().catch(() => {});
    addMessage("system", "⚠️ 发送失败，稍后重试");
  }

  async function send(text, filesOverride = null, sendOptions = {}) {
    if (disposed || preparingSend) return;
    if (!Array.isArray(filesOverride) && pendingFileReads.size) {
      const draftBeforeRead = state.draft;
      const filesBeforeRead = [...pendingFiles];
      preparingSend = true;
      try {
        await waitForPendingFiles();
      } finally {
        preparingSend = false;
      }
      if (disposed) return;
      if (state.draft !== draftBeforeRead || pendingFiles.length !== filesBeforeRead.length ||
          filesBeforeRead.some((file, index) => pendingFiles[index] !== file)) {
        addMessage("system", "草稿或附件已变更，请确认后重新发送。");
        return;
      }
    }
    if (location.protocol === "beings:" && !state.currentScene.sceneId) {
      addMessage("system", "客户端场景不可用，暂时无法发送消息。请检查启动提示并重启客户端。");
      return;
    }
    if (isStreaming) {
      await spliceSend(text, filesOverride || [...pendingFiles]);
      return;
    }
    const replyBaseline = new Set(state.items);
    const sendingScene = { ...state.currentScene };
    userStoppedStream = false;
    const { isManualRetry = false } = sendOptions;
    let msg = (text || "").trim();
    const fromQueue = Array.isArray(filesOverride) && !isManualRetry;
    const filesToSend = Array.isArray(filesOverride)
      ? filesOverride
      : [...pendingFiles];
    if (!msg && !filesToSend.length) return;
    if (!isManualRetry) msg = options.prepareMessage?.(msg || `[${filesToSend.length} file(s)]`) ?? msg;
    replyRunSettled = false;
    pendingReply = { baseline: replyBaseline, label: "等待回复", waiting: false };
    replayTransportOnly = false;
    setStreamScene(state.currentScene);

    if (!isManualRetry) {
      if (!sendOptions.queuedMessage) addMessage("user", msg || `[${filesToSend.length} file(s)]`);
      noteLocalEcho("user", msg || `[${filesToSend.length} file(s)]`);
      if (!fromQueue) clearComposer();
    }
    setStatus("thinking");
    actionLogClear();
    tuiSet("thinking");
    showThinkingIndicator();
    isStreaming = true;
    stopAutonomousWatch();
    updateSendButton();

    const body = { message: msg || `[Sent ${filesToSend.length} file(s)]`, ...browserScenePayload(sendingScene) };
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
      res = await fetchWithRetry(
        apiUrl("/api/chat/stream"),
        () => {
          return {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(sendingScene.sceneId ? { "X-Portal-Scene-Id": sendingScene.sceneId } : {}) },
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
    } catch (e) {
      handleStreamError(e, msg, filesToSend);
      finalizeSendCleanup();
      return;
    }

    clearFetchRetryStatus();
    setStatus("thinking");

    if (res.status === 202) {
      try { await res.json(); } catch (_) {}
      // Accepted is not completed: release the POST reader, retain this scene's run.
      pendingReply = { baseline: replyBaseline, label: "已排队，等待回复" };
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

    await driveChatStream(res, msg, filesToSend, replyBaseline);
  }

  // 读取循环 + 统一的异常处理 + 统一的收尾。
  // send() 和 spliceSend() 都走这里，保证 isStreaming / 队列 / 按钮在任何路径上都能复位。
  async function driveChatStream(res, msg, filesToSend, replyBaseline = new Set(state.items)) {
    let handedOff = false;
    try {
      const result = await consumeChatStream(res, msg, filesToSend);
      if (result.outcome === "done" && result.empty && !result.handled) {
        // EOF without any scene response is not evidence that the request completed.
        pendingReply = { baseline: replyBaseline, label: "等待回复" };
        removeThinkingIndicator();
        startCatchUpWatcher();
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
    } catch (e) {
      handleStreamError(e, msg, filesToSend);
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
  function handleStreamError(e, msg, filesToSend) {
    pendingReply = null;
    stopCatchUpWatcher();
    clearFetchRetryStatus();
    removeThinkingIndicator();
    if (e.name === "AbortError") {
      const wasTimeout = streamWatchdogAborted;
      finalizePartialBubble();
      if (wasTimeout) {
        addTimeoutRetryMessage(msg, filesToSend);
        setStatus("error");
        lastSendFailed = true;
      } else if (userStoppedStream) {
        // 用户手动停止：内容已在屏幕上，只需推进历史游标避免下次对账重复渲染
        noteLocalEcho("being", streamText);
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
        addNetworkFailureMessage(msg, filesToSend);
        setStatus("error");
        lastSendFailed = true;
        tuiClear();
      }
    } else {
      addMessage("system", "⚠ " + e.message);
      setStatus("error");
      lastSendFailed = true;
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
      } catch (_) {}
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
        } catch (err) {
          console.warn("onReconnected failed:", err);
        }
      }
    } catch (_) {
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
      scheduleFlushQueue();
      return;
    }

    if (pendingRecovery) {
      const action = await runPendingRecovery();
      if (action === "cutover" || action === "recovered") return;
    }

    const sid = currentStreamId || lastStreamId;
    if (isStreaming && sid) {
      const p = await probeStream(sid, liveSeq);
      await applyProbeVerdict(p, sid, liveSeq);
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
    } catch (_) {}
    currentAbortController = null;
    externalCutover = null;
    writerEpoch++; // F2: 作废在途写者
    pendingRecovery = null;
    if (currentStreamId) lastStreamId = currentStreamId;
    currentStreamId = null;
    isStreaming = false;
    streamMessage = null;
    streamText = "";
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
    listen(globalThis.window, "pageshow", (e) => {
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

  // ---- Send (Sensory Splice: always send, like IM) ----
  function handleSendOrStop() {
    send(state.draft);
  }
  function updateSendButton() {
    state.streaming = isStreaming;
    updateRun();
    changed();
  }

  // ---- Stop turn ----
  async function stopCurrentTurn() {
    if (!isStreaming) return;
    userStoppedStream = true;
    pendingReply = null;
    stopCatchUpWatcher();
    pendingRecovery = null;
    clearTuiHint();
    state.stopping = true;
    changed();
    if (activeStreamPollTimer) {
      clearTimeout(activeStreamPollTimer);
      activeStreamPollTimer = null;
    }
    try {
      if (currentStreamId) {
        await fetch(apiUrl("/api/stop"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stream_id: currentStreamId }),
        });
      }
      if (currentAbortController) currentAbortController.abort();
      else {
        finalizePartialBubble();
        isStreaming = false;
        tuiDone();
        updateSendButton();
      }
    } catch (e) {
      console.warn("stop failed:", e);
    } finally {
      state.stopping = false;
      changed();
    }
  }

  // ---- History ----
  function resetMessages() {
    state.items = state.items.filter(item => item.queued);
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
  let lastReconcileSawBeing = false;
  let lastHistoryReplyScenes = [];
  let reconcileInFlight = null;
  const cacheEndpoint = location.protocol === "beings:"
    ? params.get("history_scope") || ""
    : API_URL;
  const historyCache = new HistoryCache(cacheEndpoint);
  let historyCacheSeeded = false;
  let historyCachePending = [];
  function cacheHistory(messages, cursor) {
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
  let localEchoes = [];
  function normalizeEcho(text) {
    return (cleanContent(text || "") || "").replace(/\s+/g, " ").trim();
  }
  function noteLocalEcho(role, text, scene = state.activeScene) {
    const owner = options.historyOwner?.();
    if (owner) return owner.noteLocalEcho(role, text, scene);
    const t = normalizeEcho(text);
    if (!t) return;
    const message = [...state.items].reverse().find(item => item.kind === "message" && item.role === role && item.sceneId === scene.sceneId && normalizeEcho(item.text) === t);
    localEchoes.push({ role, text: t, message });
    if (localEchoes.length > 40) localEchoes.shift();
  }
  function consumeLocalEcho(role, text, scene) {
    const t = normalizeEcho(text);
    if (!t) return false;
    for (let i = 0; i < localEchoes.length; i++) {
      const echo = localEchoes[i];
      if (echo.role === role && echo.text === t && (!scene.sceneId || !echo.message?.sceneId || scene.sceneId === echo.message.sceneId)) {
        if (echo.message && scene.sceneId) {
          Object.assign(echo.message, scene);
          changed();
        }
        localEchoes.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  // 返回一个在**最后一批渲染完成时**才 resolve 的 Promise（修初始化竞态 P1-G / P2-H）
  function renderHistoryBatched(messages) {
    return new Promise((resolve) => {
      if (!messages || !messages.length) {
        resolve();
        return;
      }
      const BATCH = 10;
      let i = 0;
      const renderBatch = () => {
        const end = Math.min(i + BATCH, messages.length);
        for (; i < end; i++) {
          const msg = messages[i];
          const ts = formatHistoryTime(msg.at);
          if (isHistoryMarker(msg)) {
            addBreathMarker(msg.content, ts, messageScene(msg));
            continue;
          }
          addMessage(
            msg.role === "user" ? "user" : "being",
            msg.content,
            false,
            ts,
            msg.at,
            messageScene(msg),
          );
        }
        if (i < messages.length) {
          // keep scroll locked between batches
          requestAnimationFrame(renderBatch);
        } else {
          state.items.push({
            kind: "separator",
            id: `gap-${options.nextId()}`,
            text: "· · ·",
          });
          changed();

          resolve();
        }
      };
      requestAnimationFrame(renderBatch);
    });
  }

  // 返回新追加的消息条数。full=true 才清屏（首次加载 / 服务端重启）。
  function reconcileHistory(opts = {}) {
    // Ordinary refreshes must retain pending runs even before the first history seq.
    opts = { ...opts, preserve: opts.preserve ?? !opts.full };
    const owner = options.historyOwner?.();
    if (owner) return owner.reconcileHistory({ ...opts, preserve: true }).then(added => {
      lastReconcileSawBeing = owner.lastHistoryReplyIn(state.currentScene);
      return added;
    });
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

  async function fetchHistory(incremental, prefetched = null) {
    let cursor = lastHistorySeq;
    const messages = [];
    while (!disposed) {
      const path = incremental ? `/api/history?limit=100&after=${cursor}` : "/api/history?limit=100";
      const res = prefetched || await fetch(apiUrl(path), { cache: "no-store", signal: timeoutSignal(8000) });
      prefetched = null;
      if (!res.ok) return messages.length ? messages : null;
      const data = await res.json();
      const page = Array.isArray(data.messages) ? data.messages : [];
      messages.push(...page.filter(m => !incremental || (Number(m.seq) || 0) > cursor));
      const next = Math.max(cursor, ...page.map(m => Number(m.seq) || 0));
      // Servers that ignore after= cannot cause an endless pagination loop.
      if (!incremental || page.length < 100 || next <= cursor) return messages;
      cursor = next;
    }
    return null;
  }

  async function reconcileHistoryOnce({ full = false, preserve = false } = {}) {
    lastReconcileSawBeing = false;
    lastHistoryReplyScenes = [];
    try {
      let hydrated = false;
      if (!preserve && (full || lastHistorySeq === 0)) {
        const cached = await historyCache.read();
        if (disposed) return 0;
        if (cached) {
          resetMessages();
          localEchoes = [];
          await renderHistoryBatched(cached.messages);
          lastHistorySeq = Math.max(lastHistorySeq, cached.lastSeq);
          historyCacheSeeded = true;
          hydrated = true;
        }
      }
      const incremental = hydrated || (!full && lastHistorySeq > 0);
      // A cached cursor needs after=, not the prefetched latest 100: an offline
      // gap may contain more than 100 messages.
      if (hydrated) {
        prefetch.history?.then(res => res.body?.cancel()).catch(() => {});
        delete prefetch.history;
      }
      const msgs = await fetchHistory(incremental, await takePrefetch("history"));
      if (!msgs) return 0;
      let added = 0;
      let toCache = [];
      if (disposed) return 0;

      if (!incremental && !preserve) {
        resetMessages();
        localEchoes = [];
        toCache = msgs;
        lastHistoryReplyScenes = msgs.filter(m => !isHistoryMarker(m) && m.role !== "user").map(messageScene);
        await renderHistoryBatched(toCache);
        added = toCache.length;
        lastReconcileSawBeing = toCache.some(
          (m) => !isHistoryMarker(m) && m.role !== "user" && inCurrentScene(messageScene(m), state.currentScene),
        );
      } else {
        if (cursorSyncInFlight) await cursorSyncInFlight;
        const fresh = msgs.filter((m) => (Number(m.seq) || 0) > lastHistorySeq);
        toCache = fresh;
        for (const m of fresh) {
          if (isHistoryMarker(m)) {
            addBreathMarker(m.content, formatHistoryTime(m.at), messageScene(m));
            added++;
            continue;
          }
          const role = m.role === "user" ? "user" : "being";
          const scene = messageScene(m);
          if (consumeLocalEcho(role, m.content, scene) || (role === "being" && options.isLiveScene?.(scene))) continue; // 本地已经渲染过了
          addMessage(role, m.content, false, formatHistoryTime(m.at), m.at, scene);
          if (role === "being") {
            lastHistoryReplyScenes.push(scene);
            if (inCurrentScene(scene, state.currentScene)) lastReconcileSawBeing = true;
          }
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
    } catch (e) {
      console.warn("reconcileHistory failed:", e);
      return 0;
    }
  }

  // Reconcile persisted local echoes and retain simultaneous messages from other scenes.
  let cursorSyncInFlight = null;
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
        lastHistorySeq = Math.max(
          lastHistorySeq,
          ...msgs.map((m) => Number(m.seq) || 0),
        );
        for (const m of fresh) {
          const scene = messageScene(m);
          if (isHistoryMarker(m)) addBreathMarker(m.content, formatHistoryTime(m.at), scene);
          else {
            const role = m.role === "user" ? "user" : "being";
            // Current-room replies are already drawn by live/replay, including
            // continuations that older servers persist as a single combined row.
            if (!consumeLocalEcho(role, m.content, scene) && !options.isLiveScene?.(scene)) {
              addMessage(role, m.content, false, formatHistoryTime(m.at), m.at, scene);
            }
          }
        }
        changed();
        cacheHistory(msgs, lastHistorySeq);
      }
    } catch (_) {}
  }

  // A 202 response means the message was queued for a later SBS breath. Poll
  // history until that autonomous reply is persisted and render it incrementally.
  const CATCH_UP_INITIAL_MS = 2000;
  const CATCH_UP_MAX_INTERVAL_MS = 30000;
  const CATCH_UP_ABSOLUTE_MAX_MS = 5 * 60 * 1000;
  let catchUpTimer = null;
  function stopCatchUpWatcher() {
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
    pendingReply.waiting = true;
    pendingReply.label = "等待处理中";
    startCatchUpWatcher();
    updateSendButton();
  }
  function finishPendingReply(failed = false) {
    if (!pendingReply) return;
    pendingReply = null;
    stopCatchUpWatcher();
    actionLogFinalizePending();
    if (currentRun && !currentRun.end) {
      currentRun.entries = actionLog.map(entry => ({ ...entry }));
      currentRun.end = Date.now();
      currentRun.waitingForReply = false;
      currentRun.outcome = failed ? "error" : "done";
      currentRun.label = failed ? "等待回复超时" : "已回复";
      currentRun.hint = failed ? "等待处理超时，可刷新查看最新结果。" : "";
    }
    replyRunSettled = true;
    changed();
  }
  function pendingReplyArrived() {
    return pendingReply && state.items.some(item => item.kind === "message" && item.role === "being"
      && item.sceneId === state.currentScene.sceneId && !item.streaming && !pendingReply.baseline.has(item));
  }
  function startCatchUpWatcher() {
    stopCatchUpWatcher();
    const deadline = Date.now() + CATCH_UP_ABSOLUTE_MAX_MS;
    let delay = CATCH_UP_INITIAL_MS;
    const tick = async () => {
      catchUpTimer = null;
      if (!pendingReply) return;
      if (!isStreaming || pendingReply.waiting) await reconcileHistory({ preserve: true });
      if (pendingReplyArrived()) { finishPendingReply(); return; }
      if (!pendingReply || catchUpTimer) return;
      if (Date.now() >= deadline) { finishPendingReply(true); return; }
      // A live stream may belong to an earlier turn; keep watching queued work.
      delay = Math.min(delay * 2, CATCH_UP_MAX_INTERVAL_MS);
      catchUpTimer = setTimeout(tick, Math.min(delay, Math.max(0, deadline - Date.now())));
    };
    catchUpTimer = setTimeout(tick, delay);
    checkActiveStream({ autonomousOnly: true });
  }

  const AUTONOMOUS_ORIGIN_LABELS = {
    beating: "being 正在自己想事情…",
    callback: "being 正在处理一条回调…",
    leftover: "being 正在回答排队的消息…",
  };
  let autonomousWatch = null;
  function stopAutonomousWatch() {
    if (!autonomousWatch) return;
    if (autonomousWatch.timer) clearTimeout(autonomousWatch.timer);
    autonomousWatch = null;
    clearTuiHint();
  }
  function watchAutonomousStream(data) {
    if (isStreaming || !data?.stream_id) return;
    if (autonomousWatch?.streamId === data.stream_id) return;
    stopAutonomousWatch();
    const watch = { streamId: data.stream_id, timer: null };
    autonomousWatch = watch;
    let interval = 2000;
    const deadline = Date.now() + POLL_ABSOLUTE_MAX_MS;
    setStatus("thinking");
    setTuiHint(AUTONOMOUS_ORIGIN_LABELS[data.origin] || "being 正在呼吸…");
    const release = () => {
      if (autonomousWatch !== watch) return false;
      autonomousWatch = null;
      clearTuiHint();
      if (!isStreaming) setStatus("connected");
      return true;
    };
    const finish = async () => {
      if (!release()) return;
      await reconcileHistory();
      if (pendingReplyArrived()) finishPendingReply();
    };
    const poll = async () => {
      watch.timer = null;
      if (autonomousWatch !== watch) return;
      if (isStreaming) {
        release();
        return;
      }
      if (Date.now() > deadline) {
        await finish();
        return;
      }
      try {
        const r = await fetch(apiUrl("/api/stream/active"), {
          cache: "no-store",
          signal: timeoutSignal(8000),
        });
        if (r.status === 204) {
          await finish();
          return;
        }
        if (r.ok) {
          const next = await r.json();
          if (next.stream_id !== watch.streamId) {
            await finish();
            if (next.origin && next.origin !== "human" && !next.finished)
              watchAutonomousStream(next);
            return;
          }
          if (next.finished) {
            await finish();
            return;
          }
        }
      } catch (e) {
        console.warn("autonomous stream watch failed:", e);
      }
      interval = Math.min(interval * 1.5, 5000);
      if (autonomousWatch === watch) watch.timer = setTimeout(poll, interval);
    };
    watch.timer = setTimeout(poll, interval);
  }

  async function checkActiveStream({ autonomousOnly = false } = {}) {
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
      if (disposed || epoch !== writerEpoch) return;
      if (data.origin && data.origin !== "human") {
        if (Object.hasOwn(data, "scene_id") && messageScene(data).sceneId !== state.currentScene.sceneId) return;
        if (isStreaming) return;
        if (data.finished) {
          reconcileHistory();
          return;
        }
        watchAutonomousStream(data);
        return;
      }
      if (autonomousOnly) return;
      replayStream(data);
    } catch (e) {
      console.warn("checkActiveStream failed:", e);
    }
  }

  function replayStream(data) {
    if (options.routeReplay?.(data)) return;
    if (isStreaming && currentStreamId === data.stream_id) return;
    // If the stream already finished, its content is in history — skip replay to avoid duplicates
    if (data.finished) return;
    // This runtime may only own the replay transport. Event scene IDs, not
    // the selected desktop scene, determine which runtime has actual work.
    replayTransportOnly = true;
    if (Object.hasOwn(data, "scene_id")) setStreamScene(messageScene(data));

    if (activeStreamPollTimer) {
      clearTimeout(activeStreamPollTimer);
      activeStreamPollTimer = null;
    }

    isStreaming = true;
    stopAutonomousWatch();
    currentStreamId = data.stream_id || null;
    if (currentStreamId) lastStreamId = currentStreamId;
    writerEpoch++; // F2: 接管写权
    streamMessage = null;
    streamText = "";
    toolCount = 0;
    actionLogClear();
    removeThinkingIndicator();
    resetLiveProgress();
    updateSendButton();

    const events = Array.isArray(data.events) ? data.events : [];
    for (const item of events) processReplayEvent(item.event, item.data || {});

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

  function pollActiveStream(streamId, lastSeq) {
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
        if (data.stream_id !== streamId) {
          // 别的 tab 起了新流 → 对齐内容而不是静默 finalize
          await recoverViaHistory();
          return;
        }

        events = Array.isArray(data.events) ? data.events : [];
        for (const item of events) {
          const seq = Number(item.seq);
          if (Number.isFinite(seq) && seq <= cursor) continue;
          processReplayEvent(item.event, item.data || {});
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
      } catch (e) {
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

  function processReplayEvent(eventType, eventData) {
    if (options.routeEvent?.(eventType, eventData)) return;
    markProgress(eventType, eventData);
    switch (eventType) {
      case "content_block_delta": {
        const text = eventData.delta?.text || "";
        if (!text) break;
        if (pendingReply) pendingReply.waiting = false;
        removeThinkingIndicator();
        tuiClear();
        streamText += text;
        if (!streamMessage) {
          const visibleText = cleanContent(streamText);
          if (visibleText)
            streamMessage = addMessage("being", visibleText, true);
        } else if (!renderTimer) {
          const rafEpoch = writerEpoch;
          renderTimer = requestAnimationFrame(() => {
            renderTimer = null;
            if (rafEpoch !== writerEpoch) return; // F2
            if (streamMessage && streamText) {
              const visible = cleanContent(streamText);
              if (visible) {
                updateMessage(streamMessage, visible);
                changed();
              }
            }
          });
        }
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
        tuiSet("thinking", null, {
          preview: truncate(entry.preview || "", 60),
        });
        break;
      }
      case "tool_use": {
        toolCount++;
        const name = eventData.name || "tool";
        const parsedInput = parseToolInput(eventData.input);
        const arg = extractKeyArg(parsedInput);
        const label = tuiLabels[name] || "在行动";
        const prev = actionLog[actionLog.length - 1];
        if (prev && prev.type === "think" && !prev.done) {
          prev.done = true;
          prev.duration = Math.max(
            1,
            Math.round((Date.now() - prev.ts) / 1000),
          );
        }
        actionLogPush({ type: "tool", name, label, arg });
        tuiSet(name, null, { arg, preview: "" });
        break;
      }
      case "tool_result": {
        const isError = !!eventData.is_error;
        for (let i = actionLog.length - 1; i >= 0; i--) {
          const a = actionLog[i];
          if (a.type === "tool" && !a.done) {
            a.done = true;
            a.error = isError;
            a.result = summarizeToolResult(eventData);
            break;
          }
        }
        scheduleRenderActivityLog();
        tuiSet("thinking", null, { preview: "" });
        break;
      }
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
        scheduleFlushQueue();
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
    settleReplyBoundary();
    noteLocalEcho("being", streamText);
    streamMessage = null;
    streamText = "";
    removeThinkingIndicator();
    setStatus("connected");
    tuiDone();
    clearTuiHint();
    lastSendFailed = false;
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
    noteLocalEcho("being", streamText);
    if (activeStreamPollTimer) clearTimeout(activeStreamPollTimer);
    activeStreamPollTimer = null;

    // 先把 streamText 固化为正式消息（如果还没渲染）
    solidifyReplayBubble();
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
    lastSendFailed = false;
    updateSendButton();
    // 不做历史渲染 — 内容已经在屏幕上了，只推进游标，
    // 这样之后的增量对账不会把刚流出来的回复再画一遍
    syncHistoryCursor();
    scheduleFlushQueue();
  }

  let routedStreaming = false;
  let started = false;
  async function start() {
    if (started || disposed) return;
    started = true;
    for (const [key, path] of Object.entries({
      history: "/api/history?limit=100",
      status: "/api/status",
      active: "/api/stream/active",
    })) {
      prefetch[key] = fetch(apiUrl(path), { cache: "no-store" });
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
    isBusy: () => isStreaming || !!pendingReply || !!pendingRecovery || preparingSend,
    stageQueuedSend(text, filesOverride = null) {
      const msg = (text || "").trim();
      const files = Array.isArray(filesOverride) ? [...filesOverride] : [...pendingFiles];
      if (!msg && !files.length) return null;
      const message = addMessage("user", msg || `[发送了 ${files.length} 个文件: ${files.map(f => f.name).join(", ")}]`);
      message.queued = true;
      if (!Array.isArray(filesOverride)) clearComposer();
      return { text: msg, files, message };
    },
    noteLocalEcho,
    reconcileHistory,
    syncHistoryCursor,
    lastHistoryReplyIn: scene => lastHistoryReplyScenes.some(reply => inCurrentScene(reply, scene)),
    replyCompletedAt: () => currentRun?.label === "已回复" ? currentRun.end || 0 : 0,
    sceneActivity: () => {
      if (replayTransportOnly && !pendingReply) return null;
      if (pendingReply && (pendingReply.waiting || !isStreaming)) return "waiting";
      if (isStreaming && !replyRunSettled)
        return livePhase === "tool" ? "working" : livePhase === "text" ? "replying" : "thinking";
      if (currentRun?.end) {
        if (currentRun.outcome === "error") return "error";
        if (currentRun.outcome === "stopped") return "stopped";
        // A bare reasoning/stop boundary does not establish that a reply arrived.
        return currentRun.label === "已回复" ? "done" : null;
      }
      return null;
    },
    hasStream: id => isStreaming && currentStreamId === id,
    recoverConnection: onReconnected,
    syncConnection: next => { connState = next; applyDotClass(); },
    ownsLiveScene: scene => isStreaming && !pendingReply?.waiting && inCurrentScene(scene, state.activeScene),
    acceptReplay: replayStream,
    acceptSceneEvent: (type, data) => {
      if (type === "meta" || type === "usage") return;
      // A boundary is not the start of another run. Shared streams may replay
      // stops for idle scenes; opening a run here creates a phantom "已结束 0 秒".
      if (!isStreaming && PROGRESS_EVENTS.has(type) && type !== "message_stop" && type !== "error") {
        routedStreaming = true;
        isStreaming = true;
        updateSendButton();
      }
      if (type === "message_stop" && data.session_id) sessionId = data.session_id;
      processReplayEvent(type, data);
      if (routedStreaming && (type === "message_stop" || type === "error")) {
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
    request: (path, init = {}) =>
      fetch(apiUrl(path), {
        ...init,
        headers: { ...configHeaders(), ...init.headers },
      }),
  };
}
