import { messageScene } from "../models/scenes";

/** One stream machine per scene; the transcript and history cursor remain shared. */
export function createSceneRuntime(state, options, createRuntime) {
  const sessions = new Map();
  let selected, owner, disposed = false, counter = 0;
  let lastActivity = "";
  const localKeys = new Set(["currentScene", "activeScene", "draft", "files", "queued", "thinking", "streaming", "stopping", "dotClass"]);
  function publish() {
    if (disposed || !selected) return;
    for (const key of localKeys) {
      if (key !== "currentScene" && key !== "draft") state[key] = selected.local[key];
    }
    // The transcript may contain an active background run in the all-scenes view.
    state.streaming = [...sessions.values()].some(session => session.local.streaming);
    const activity = Object.fromEntries([...sessions.entries()].flatMap(([id, session]) => {
      const status = session.runtime?.sceneActivity();
      return id && status ? [[id, status]] : [];
    }));
    const signature = JSON.stringify(activity);
    if (signature !== lastActivity) {
      lastActivity = signature;
      options.onSceneActivity?.(activity);
    }
    state.changed();
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
        if (scene.sceneId === local.currentScene.sceneId) return false;
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
        if (scene.sceneId === local.currentScene.sceneId) return false;
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
    start: () => owner.runtime.start(),
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
      for (const session of sessions.values()) session.runtime.dispose();
    },
    refreshHistory: () => owner.runtime.refreshHistory(),
    refreshOnRegainedAttention: () => Promise.all([...sessions.values()].map(s => s.runtime.refreshOnRegainedAttention())),
  };
  for (const method of ["send", "stopCurrentTurn", "handleFiles", "removePending"])
    runtime[method] = (...args) => {
      if (state.currentScene.strict && state.historyScope === "all") return Promise.resolve();
      selected.local.files = state.files;
      return selected.runtime[method](...args);
    };
  for (const method of ["loadLlmConfig", "applyConfigChange", "toggleSbs", "loadSbsState", "request"])
    runtime[method] = (...args) => owner.runtime[method](...args);
  return runtime;
}
