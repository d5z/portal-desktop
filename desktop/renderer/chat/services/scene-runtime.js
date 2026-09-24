import { SceneQueueStore } from "./scene-queue";
import { inCurrentScene, messageScene, withSceneTransition } from "../models/scenes";

/** One Being coordinator; scene-local state is not a separate agent or breath. */
export function createSceneRuntime(state, options, createRuntime) {
  const sessions = new Map();
  let selected, owner, disposed = false, counter = 0;
  let lastActivity = "";
  const sendQueue = [];
  let drainScheduled = false, dispatching = false;
  let submission = Promise.resolve();
  let queueReady = false, drainTimer;
  const pageLocation = typeof location === 'undefined' ? { search: '', origin: '' } : location;
  const queueStore = new SceneQueueStore(new URLSearchParams(pageLocation.search).get('history_scope') || pageLocation.origin);
  function retryDrain() {
    if (!disposed && !drainTimer) drainTimer = setTimeout(() => { drainTimer = null; scheduleDrain(); }, 2000);
  }
  function attachQueued(target, entry, saved, persisted = true) {
    const queued = { session: target, entry, saved, persisted };
    sendQueue.push(queued);
    target.local.queued++;
    entry.message.queueNotice = saved.phase === 'sending' ? '发送状态待确认，请先查看场景历史；不会自动重发' : undefined;
    entry.message.cancelQueued = async () => {
      if (queued === sendQueue[0] && dispatching) return;
      try { await queueStore.write(saved.id); }
      catch { entry.message.queueNotice = '无法保存取消操作，请重试'; publish(); return; }
      const index = sendQueue.indexOf(queued);
      if (index < 0) return;
      sendQueue.splice(index, 1);
      target.local.queued--;
      state.items = state.items.filter(item => item !== entry.message);
      publish();
    };
    return queued;
  }
  const busy = session => session.runtime?.isBusy?.() ||
    ["thinking", "replying", "working", "waiting"].includes(sceneStatus(session));
  function scheduleDrain() {
    if (disposed || !queueReady || drainTimer || drainScheduled || dispatching || !sendQueue.length) return;
    drainScheduled = true;
    queueMicrotask(async () => {
      drainScheduled = false;
      if (disposed || dispatching || [...sessions.values()].some(busy)) { retryDrain(); return; }
      const next = sendQueue[0];
      if (!next || next.saved.phase === 'sending' || !next.persisted) return;
      dispatching = true;
      try {
        // Refresh can erase local activity flags; check the actual breath first.
        const response = await owner.runtime.request('/api/stream/active', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
        if (response.status !== 204) {
          if (!response.ok) { retryDrain(); return; }
          const active = await response.json();
          if (!active.finished) { retryDrain(); return; }
        }
        if (disposed || [...sessions.values()].some(busy)) { retryDrain(); return; }
        await queueStore.write({ ...next.saved, phase: 'sending' });
        next.saved.phase = 'sending';
        if (disposed) return;
        sendQueue.shift();
        next.session.local.queued--;
        next.entry.message.queued = false;
        next.entry.message.cancelQueued = undefined;
        await next.session.runtime.send(next.entry.text, next.entry.files, { queuedMessage: next.entry.message });
        // If refresh interrupts the request, retain the uncertain record instead
        // of risking a duplicate send on the next page load.
        if (!disposed) await queueStore.write(next.saved.id);
      } catch {
        if (sendQueue.includes(next)) next.entry.message.queueNotice = '等待连接或本地存储恢复';
        retryDrain();
      } finally { dispatching = false; publish(); }
    });
  }
  const localKeys = new Set(["currentScene", "activeScene", "draft", "files", "queued", "thinking", "streaming", "stopping", "dotClass"]);
  const sceneStatus = session => {
    const status = session.runtime?.sceneActivity();
    const tasks = (state.sceneTasks || []).filter(t => t.sceneId === session.local.currentScene.sceneId);
    if (tasks.some(t => t.status === 'running' || t.status === 'queued')) return 'working';
    if (status === 'error' || status === 'stopped') return session.local.queued ? 'queued' : status;
    // Creation order is not completion order: an earlier slow task can finish
    // after a stage reply for a later fast task. Inspect every pending result.
    const currentTasks = tasks.filter(t => !session.submittedAt || t.createdAt >= session.submittedAt);
    const repliedAt = session.runtime?.replyCompletedAt?.() || 0;
    if (!['thinking','replying'].includes(status)) {
      if (session.submittedAt && currentTasks.some(t => t.status === 'done' && t.endedAt > repliedAt)) return 'waiting';
      if (currentTasks.some(t => ['failed','interrupted','budget_exhausted','timeout'].includes(t.status) &&
          (!t.endedAt || t.endedAt > repliedAt))) return 'error';
    }
    return status && ["thinking", "replying", "working", "waiting"].includes(status) ? status :
      session.local.queued ? "queued" : status;
  };
  function publish() {
    if (disposed || !selected) return;
    for (const key of localKeys) {
      if (key !== "currentScene" && key !== "draft") state[key] = selected.local[key];
    }
    // The transcript may contain an active background run in the all-scenes view.
    state.streaming = [...sessions.values()].some(session => session.local.streaming);
    const activity = Object.fromEntries([...sessions.entries()].flatMap(([id, session]) => {
      const status = sceneStatus(session);
      return id && status ? [[id, status]] : [];
    }));
    const signature = JSON.stringify(activity);
    if (signature !== lastActivity) {
      lastActivity = signature;
      options.onSceneActivity?.(activity);
    }
    state.changed();
    scheduleDrain();
  }
  function sessionFor(scene) {
    let session = sessions.get(scene.sceneId);
    if (session) return session;
    const local = { currentScene: { ...scene }, activeScene: { ...scene }, draft: "", files: [], queued: 0,
      thinking: false, streaming: false, stopping: false, dotClass: state.dotClass };
    const routed = new Set();
    const proxy = new Proxy(state, {
      get(target, key) {
        if (key === "changed") return publish;
        if (key === "draft" && selected === session) return state.draft;
        return localKeys.has(key) ? local[key] : target[key];
      },
      set(target, key, value) {
        if (localKeys.has(key)) {
          local[key] = value;
          if (key === "draft" && selected === session) state.draft = value;
        } else target[key] = value;
        return true;
      },
    });
    session = { local, runtime: null };
    sessions.set(scene.sceneId, session);
    session.runtime = createRuntime(proxy, {
      ...options,
      nextId: () => ++counter,
      resolveDefaultScene(scene) {
        if (local.currentScene.sceneId || !scene.sceneId) return;
        // Resolve the existing room in place so replies carrying the new Loom
        // identity do not create a second, background session.
        sessions.delete(local.currentScene.sceneId);
        local.currentScene = { ...scene };
        local.activeScene = { ...scene };
        sessions.set(scene.sceneId, session);
        if (selected === session) state.currentScene = { ...scene };
      },
      prepareMessage(text) {
        // Track submission without changing the editable or locally rendered body.
        session.submittedAt = Date.now();
        return text;
      },
      prepareRequestMessage(text, scene, sendOptions = {}) {
        const previous = [...state.items].reverse().find(item =>
          item !== sendOptions.queuedMessage && item.kind === "message" &&
          (item.role === "user" || item.role === "being") && !item.queued);
        return withSceneTransition(text, scene, previous);
      },
      onConnection(next) {
        for (const other of sessions.values()) if (other !== session) other.runtime?.syncConnection(next);
        options.onConnection?.(next);
      },
      recoverScenes: async details => {
        if (session !== owner) return;
        await Promise.all([...sessions.values()].filter(s => s !== owner).map(s => s.runtime.recoverConnection(details)));
      },
      historyOwner: () => owner && owner !== session ? owner.runtime : null,
      isLiveScene: scene => [...sessions.values()].some(s => s.runtime?.ownsLiveScene(scene)),
      routeEvent(type, data) {
        if (!Object.hasOwn(data, "scene_id")) return false;
        const scene = messageScene(data);
        if (scene.sceneId === local.currentScene.sceneId ||
            (scene.sceneId && local.currentScene.legacySceneId && inCurrentScene(scene, local.currentScene))) return false;
        const target = sessionFor(scene);
        routed.add(target);
        target.runtime.acceptSceneEvent(type, data);
        return true;
      },
      finishRoutes() {
        for (const target of routed) target.runtime.finishRoutedStream();
        routed.clear();
      },
      routeReplay(data) {
        if (data.stream_id && [...sessions.values()].some(s => s !== session && s.runtime?.hasStream(data.stream_id))) return true;
        if (!Object.hasOwn(data, "scene_id")) return false;
        const scene = messageScene(data);
        if (scene.sceneId === local.currentScene.sceneId ||
            (scene.sceneId && local.currentScene.legacySceneId && inCurrentScene(scene, local.currentScene))) return false;
        sessionFor(scene).runtime.acceptReplay(data);
        return true;
      },
    });
    if (owner) session.runtime.syncConnection(state.connection);
    return session;
  }
  owner = selected = sessionFor(state.currentScene);
  selected.local.draft = state.draft;
  let selection = Promise.resolve();
  const runtime = {
    updateSceneTasks(tasks, subagentReady = state.subagentReady) {
      state.subagentReady = subagentReady === true;
      state.sceneTasks = tasks;
      for (const task of tasks) sessionFor({ sceneId: task.sceneId, sceneLabel: state.sceneNames?.[task.sceneId] || '' });
      publish();
    },
    async start() {
      try {
        const saved = await queueStore.read();
        if (disposed) return;
        for (const row of saved) {
          const target = sessionFor(row.scene);
          const entry = target.runtime.stageQueuedSend(row.text, row.files);
          if (entry) { entry.message.createdAt = row.createdAt; attachQueued(target, entry, row); }
        }
        await owner.runtime.start();
        queueReady = true;
      } catch {
        state.items.push({ kind: 'message', id: `queue-error-${++counter}`, role: 'system', text: '无法恢复本地排队记录，已暂停自动发送。请重新打开页面重试。', ...state.currentScene });
        await owner.runtime.start();
      }
      publish();
    },
    send(...args) {
      const target = selected;
      const sendSnapshot = !Array.isArray(args[1])
        ? (typeof target.runtime.captureSendSnapshot === 'function'
          ? target.runtime.captureSendSnapshot()
          : { draft: state.draft, files: Array.isArray(state.files) ? [...state.files] : [] })
        : null;
      // Serialize only capture/dispatch decisions, never wait for a breath here.
      submission = submission.then(async () => {
        const prepared = typeof target.runtime.prepareSend === 'function'
          ? await target.runtime.prepareSend(args[1], sendSnapshot)
          : (await target.runtime.waitForPendingFiles(), true);
        if (!prepared) return;
        if (disposed) return;
        const othersBusy = [...sessions.values()].some(other => other !== target && busy(other));
        if (sendQueue.length || othersBusy) {
          // Older/embedded runtimes may not expose the durable queue hook yet.
          // Keep sending functional while the host is being upgraded; the full
          // Desktop runtime supplies stageQueuedSend and persists the entry.
          if (typeof target.runtime.stageQueuedSend !== 'function') {
            void target.runtime.send(...args);
            return;
          }
          const entry = target.runtime.stageQueuedSend(...args);
          if (!entry) return;
          const saved = { id: crypto.randomUUID(), endpoint: queueStore.endpoint,
            scene: { ...target.local.currentScene }, text: entry.text, files: entry.files,
            createdAt: entry.message.createdAt || Date.now(), phase: 'queued' };
          const queued = attachQueued(target, entry, saved, false);
          try { await queueStore.write(saved); queued.persisted = true; }
          catch { entry.message.queueNotice = '排队内容未能保存，刷新可能丢失；请取消后重试'; }
          publish();
        } else {
          void target.runtime.send(...args);
        }
      });
      return submission;
    },
    selectScene(scene) {
      selection = selection.then(async () => {
        await selected.runtime.waitForPendingFiles();
        if (disposed) return;
        selected.local.draft = state.draft;
        const next = sessionFor(scene);
        if (next !== selected) state.resetScroll++;
        selected = next;
        selected.local.currentScene = { ...scene };
        state.currentScene = scene;
        state.historyScope = "current";
        state.draft = selected.local.draft;
        publish();
        void owner.runtime.refreshHistory();
      });
      return selection;
    },
    dispose() {
      disposed = true;
      clearTimeout(drainTimer);
      queueStore.close();
      for (const session of sessions.values()) session.runtime.dispose();
    },
    refreshHistory: () => owner.runtime.refreshHistory(),
    refreshOnRegainedAttention: () => Promise.all([...sessions.values()].map(s => s.runtime.refreshOnRegainedAttention())),
  };
  for (const method of ["stopCurrentTurn", "handleFiles", "removePending"])
    runtime[method] = (...args) => {
      selected.local.files = state.files;
      return selected.runtime[method](...args);
    };
  for (const method of ["loadLlmConfig", "applyConfigChange", "toggleSbs", "loadSbsState", "request"])
    runtime[method] = (...args) => owner.runtime[method](...args);
  return runtime;
}
