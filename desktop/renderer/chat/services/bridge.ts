import type { ChatRuntime, ChatState, ChatPanel } from "../models/chat";
import type { HistoryScope } from "../models/scenes";
import type { ChatEditCommand } from "../../../shared/types";
import { validChatHistoryLimit } from '../../../shared/chat-history';
import { HistoryCache } from './history-cache';
import { localActivityHistory } from './activity-history';

/** Source-checked desktop transport. It never reads or mutates rendered UI. */
export function createChatBridge(state: ChatState) {
  const revision = new URLSearchParams(location.search).get("revision");
  const embedded = parent !== window;
  const historyEndpoint = new URLSearchParams(location.search).get('history_scope') || location.origin;
  let activityCache: HistoryCache | undefined;
  // The isolated frame can have either the packaged shell or the Vite shell as its parent.
  // Only bounded, non-secret UI observations cross this channel.
  const targetOrigin = location.protocol === "beings:" ? "*" : location.origin;
  const send = (data: Record<string, unknown>) => {
    if (embedded) parent.postMessage({ ...data, revision }, targetOrigin);
  };
  let draftPrefix = "",
    selectionRequest = 0,
    sbsRequest = 0,
    disposed = false;
  const waiting = new Map<string, () => void>();
  const edits = new Map<string, (ok: boolean) => void>();
  const subagentEnables = new Map<string, (ok: boolean) => void>();
  function edit(command: ChatEditCommand): Promise<boolean> {
    if (!embedded || location.protocol !== "beings:") return Promise.resolve(document.execCommand(command));
    if (disposed) return Promise.resolve(false);
    const id = crypto.randomUUID();
    return new Promise(resolve => {
      const finish = (ok: boolean) => { clearTimeout(timer); edits.delete(id); resolve(ok); };
      const timer = setTimeout(() => finish(false), 3000);
      edits.set(id, finish);
      send({ type: "beings:chat-edit", id, command });
    });
  }
  let removeListener = () => {};
  let lastActivity: string | null | undefined;
  const publishActivity = () => {
    const origin = state.sbsStreamingOrigin || null;
    const phase = origin ? state.sbsActivityPhase || null : null;
    const activity = JSON.stringify([origin, phase]);
    if (disposed || activity === lastActivity) return;
    lastActivity = activity;
    send({type:'beings:sbs-activity', origin, phase});
  };
  const unsubscribeActivity = state.subscribe(publishActivity);
  async function copyText(text: string): Promise<void> {
    if (!embedded || location.protocol !== 'beings:') return navigator.clipboard.writeText(text);
    if (disposed) throw new Error('Chat closed');
    const id = crypto.randomUUID();
    const ok = await new Promise<boolean>(resolve => {
      const finish = (ok: boolean) => { clearTimeout(timer); edits.delete(id); resolve(ok); };
      const timer = setTimeout(() => finish(false), 3000);
      edits.set(id, finish);
      send({ type: 'beings:chat-copy', id, text });
    });
    if (!ok) throw new Error('Copy failed');
  }
  function enableSubagent(): Promise<boolean> {
    if (!embedded || location.protocol !== 'beings:' || disposed) return Promise.resolve(false);
    const id = crypto.randomUUID();
    return new Promise(resolve => {
      const finish = (ok: boolean) => { clearTimeout(timer); subagentEnables.delete(id); resolve(ok); };
      const timer = setTimeout(() => finish(false), 60000);
      subagentEnables.set(id, finish);
      send({ type: 'beings:subagent-enable', id });
    });
  }
  function onSbs(enabled: boolean) {
    ++sbsRequest;
    state.sbsKnown = true;
    send({ type: "beings:sbs-state", enabled });
  }
  async function beforeSend(text: string) {
    if (!embedded || disposed) return;
    const id = crypto.randomUUID();
    const hasSceneDraft = Boolean(draftPrefix && text.startsWith(draftPrefix));
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        waiting.delete(id);
        resolve();
      };
      const timer = setTimeout(finish, 250);
      waiting.set(id, finish);
      send({ type: "beings:scene-capture", id, hasSceneDraft });
    });
    return (ok: boolean) => {
      if (disposed) return;
      send({ type: "beings:scene-result", id, hasSceneDraft, ok });
      if (hasSceneDraft && ok) draftPrefix = "";
    };
  }
  function start(
    runtime: ChatRuntime,
    ui: {
      panel(value: ChatPanel, returnToSettings?: boolean): void;
      theme(value: "light" | "dark"): void;
      reading(value: number): void;
      search(query: string): void;
      jump(id: string): void;
      reveal(seq: number, sceneId: string): void;
      focus(): void;
      scope(value: HistoryScope): void;
    },
  ) {
    const refreshSbs = async () => {
      const request = ++sbsRequest;
      let enabled: boolean | undefined;
      try {
        enabled = await runtime.loadSbsState();
      } catch {
        /* Unknown state remains unknown. */
      }
      if (disposed || request !== sbsRequest) return;
      send(
        typeof enabled === "boolean"
          ? { type: "beings:sbs-state", enabled }
          : { type: "beings:sbs-state", known: false },
      );
    };
    const receive = (event: MessageEvent) => {
      if (!embedded || event.source !== parent) return;
      // Development shell uses Vite's HTTP origin; packaged shell uses beings://desktop.
      if (location.protocol !== "beings:" && event.origin !== location.origin)
        return;
      if (
        location.protocol === "beings:" &&
        event.origin !== "beings://desktop" &&
        !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(event.origin)
      )
        return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      switch (data.type) {
        case 'beings:local-history-request':
          if (data.revision !== revision || data.endpoint !== historyEndpoint || typeof data.id !== 'string' || data.id.length > 64) return;
          activityCache ||= new HistoryCache(historyEndpoint);
          void localActivityHistory(activityCache, state).then(
            rows => { if (!disposed) send({ type: 'beings:local-history-result', id: data.id, endpoint: historyEndpoint, rows, ok: true }); },
            () => { if (!disposed) send({ type: 'beings:local-history-result', id: data.id, endpoint: historyEndpoint, ok: false }); },
          );
          return;
        case 'beings:history-limit':
          if (data.revision !== revision || !validChatHistoryLimit(data.limit)) return;
          state.historyLimit = data.limit;
          state.changed();
          return;
        case "beings:chat-refresh":
          if (data.revision !== revision || typeof data.id !== "string" || data.id.length > 64) return;
          void runtime.refreshHistory().then(
            () => { if (!disposed) send({ type: "beings:chat-refreshed", id: data.id, ok: true }); },
            () => { if (!disposed) send({ type: "beings:chat-refreshed", id: data.id, ok: false }); },
          );
          return;
        case 'beings:scene-tasks':
          if (data.revision !== revision || data.endpoint !== new URLSearchParams(location.search).get('history_scope') || !Array.isArray(data.tasks) || data.tasks.length > 200) return;
          if (!data.tasks.every((t: any) => t && typeof t.id === 'string' && typeof t.sceneId === 'string' && Number.isFinite(t.createdAt) && ['queued','running','done','failed','cancelled','interrupted','budget_exhausted','timeout'].includes(t.status))) return;
          if (typeof data.subagentConfigured === 'boolean') state.subagentConfigured = data.subagentConfigured;
          if (typeof data.subagentEnabled === 'boolean') state.subagentEnabled = data.subagentEnabled;
          runtime.updateSceneTasks(data.tasks, data.subagentReady === true);
          return;
        case 'beings:permission-state':
          if (data.revision !== revision || !['read-only', 'supervised', 'auto-review', 'full-access'].includes(data.mode)) return;
          state.permissionMode = data.mode;
          state.permissionMenuOpen = data.open === true;
          state.changed();
          return;
        case 'beings:subagent-enable-result':
          if (data.revision === revision && typeof data.id === 'string') subagentEnables.get(data.id)?.(data.ok === true);
          return;
        case "beings:chat-edit-result":
          if (data.revision === revision && typeof data.id === "string") edits.get(data.id)?.(data.ok === true);
          return;
        case "beings:session-select": {
          if (data.revision !== revision || typeof data.scene?.scene_id !== "string" || typeof data.scene?.scene_meta?.scene_label !== "string") return;
          if (Array.isArray(data.scenes) && data.scenes.length <= 500 && data.scenes.every((scene: unknown) => {
            const value = scene as { scene_id?: unknown; scene_meta?: { scene_label?: unknown } } | null;
            return typeof value?.scene_id === "string" && value.scene_id.length <= 256 &&
              typeof value.scene_meta?.scene_label === "string" && value.scene_meta.scene_label.length <= 128;
          })) {
            state.sceneNames = Object.fromEntries(data.scenes.map((scene: { scene_id: string; scene_meta: { scene_label: string } }) =>
              [scene.scene_id, scene.scene_meta.scene_label]));
            state.changed();
          }
          draftPrefix = "";
          const request = ++selectionRequest;
          const sceneId = data.scene.scene_id;
          const current = () => !disposed && request === selectionRequest && state.currentScene.sceneId === sceneId;
          void runtime.selectScene({ sceneId, sceneLabel: data.scene.scene_meta.scene_label, strict: true }).then(async () => {
            if (!current()) return;
            ui.scope(data.scope === "all" ? "all" : "current");
            send({ type: "beings:history-scope-state", scope: state.historyScope });
            send({ type: 'beings:session-selected', sceneId: state.currentScene.sceneId });
            send({ type: 'beings:scene-sbs-state', sceneId: state.currentScene.sceneId, show: state.showSbsMessages });
            if (Number.isSafeInteger(data.historySeq) && data.historySeq > 0) {
              const ok = await runtime.loadHistoryTarget(data.historySeq, sceneId);
              if (!current()) return;
              if (ok) ui.reveal(data.historySeq, sceneId);
              else send({ type: 'beings:history-target-result', sceneId, seq: data.historySeq, ok: false });
            }
          }).catch(() => {
            if (current() && Number.isSafeInteger(data.historySeq)) send({ type: 'beings:history-target-result', sceneId, seq: data.historySeq, ok: false });
          });
          return;
        }
        case "beings:history-scope":
          if (data.revision !== revision || !["current", "all"].includes(data.scope)) return;
          ui.scope(data.scope);
          send({ type: "beings:history-scope-state", scope: state.historyScope });
          return;
        case "beings:history-scope-request":
          if (data.revision === revision) send({ type: "beings:history-scope-state", scope: state.historyScope });
          return;
        case "beings:scene-sbs":
          if (data.revision !== revision || data.sceneId !== state.currentScene.sceneId || typeof data.show !== "boolean") return;
          state.setShowSbsMessages(data.show);
          send({ type: "beings:scene-sbs-state", sceneId: state.currentScene.sceneId, show: state.showSbsMessages });
          return;
        case "beings:scene-sbs-request":
          if (data.revision === revision) send({ type: "beings:scene-sbs-state", sceneId: state.currentScene.sceneId, show: state.showSbsMessages });
          return;
        case "beings:sbs-toggle":
          void runtime
            .toggleSbs()
            .finally(refreshSbs)
            .catch(() => {});
          return;
        case "beings:sbs-request":
          void refreshSbs();
          return;
        case "beings:appearance":
          if (data.theme === "light" || data.theme === "dark")
            ui.theme(data.theme);
          return;
        case "beings:reading":
          if (Number.isInteger(data.size) && data.size >= 13 && data.size <= 21)
            ui.reading(data.size);
          return;
        case "beings:chat-action":
          if (data.action === "model" && embedded && location.protocol === "beings:") { send({ type: "beings:model-settings" }); return; }
          if (["model", "being", "privacy"].includes(data.action))
            ui.panel(data.action, data.returnToSettings === true);
          else if (data.action === "close") ui.panel(null);
          return;
        case "beings:search-request":
          ui.search(typeof data.query === "string" ? data.query.slice(0,500) : "");
          return;
        case "beings:search-jump":
          if (typeof data.id === "string") ui.jump(data.id);
          return;
        case "beings:scene-captured":
          if (typeof data.id === "string") waiting.get(data.id)?.();
          return;
        case 'beings:ui-examples-return': {
          if (data.revision !== revision || (data.text !== undefined && (typeof data.text !== 'string' || data.text.length > 100000))) return;
          if (data.text?.trim()) {
            state.draft = state.draft.trim() ? state.draft.trimEnd() + '\n\n' + data.text : data.text;
            state.changed();
          }
          requestAnimationFrame(() => ui.focus());
          return;
        }
        case "beings:scene-draft": {
          if (
            typeof data.id !== "string" ||
            typeof data.text !== "string" ||
            data.text.length > 16000 ||
            typeof data.expiresAt !== "number" ||
            Date.now() > data.expiresAt
          )
            return;
          const ok = !state.draft.trim() && !state.files.length && (data.sceneId === undefined || data.sceneId === state.currentScene.sceneId);
          if (ok) {
            state.draft = data.text;
            draftPrefix = data.text.split("以下是引用内容：")[0];
            state.changed();
            ui.focus();
          }
          send({ type: "beings:scene-draft-result", id: data.id, ok });
          return;
        }
        case "beings:town-reply": {
          if (
            typeof data.id !== "string" ||
            typeof data.text !== "string" ||
            !data.text.trim() ||
            data.text.length > 33000 ||
            typeof data.expiresAt !== "number" ||
            Date.now() > data.expiresAt
          )
            return;
          // This explicit action sends its own bounded text. Passing an empty
          // attachment list keeps any draft and pending files in the visible
          // composer untouched.
          void runtime.send(data.text, []);
          ui.focus();
          return;
        }
      }
    };
    removeListener();
    window.addEventListener("message", receive);
    // Native popover light-dismiss does not cross the sandboxed iframe boundary.
    // This message may only dismiss the shell menu; it cannot change permissions.
    const dismissPermissions = (event: PointerEvent) => {
      if (state.permissionMenuOpen && !(event.target instanceof Element && event.target.closest('.permission-quick-trigger')))
        send({ type: 'beings:permission-dismiss' });
    };
    const scrollPermissions = () => { if (state.permissionMenuOpen) send({ type: 'beings:permission-dismiss' }); };
    window.addEventListener('pointerdown', dismissPermissions, true);
    window.addEventListener('scroll', scrollPermissions, true);
    removeListener = () => {
      window.removeEventListener("message", receive);
      window.removeEventListener('pointerdown', dismissPermissions, true);
      window.removeEventListener('scroll', scrollPermissions, true);
    };
    void refreshSbs();
    publishActivity();
    send({ type: 'beings:scene-tasks-request' });
    send({ type: 'beings:permission-state-request' });
  }
  return {
    send,
    edit,
    copyText,
    enableSubagent,
    onSbs,
    beforeSend,
    start,
    dispose() {
      disposed = true;
      activityCache?.close();
      unsubscribeActivity();
      removeListener();
      waiting.forEach((finish) => finish());
      waiting.clear();
      edits.forEach(finish => finish(false));
      edits.clear();
      subagentEnables.forEach(finish => finish(false));
      subagentEnables.clear();
    },
  };
}
export type ChatBridge = ReturnType<typeof createChatBridge>;
