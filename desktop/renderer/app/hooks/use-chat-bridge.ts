import { useEffect, useLayoutEffect, type RefObject } from "react";
import type { AppModel } from "../models/app";
import { validPlaceTarget } from "../../shared/lib/navigation";
import { CHAT_SCENE_ACTIVITY_LABELS, type ChatSceneActivity } from "../../../shared/types";

/** This is the only shell bridge into the separate, sandboxed Loom document. */
export function useChatBridge(
  app: AppModel,
  frame: RefObject<HTMLIFrameElement | null>,
) {
  useEffect(() => {
    const dismissIndex = () => {
      const target = frame.current;
      if (target?.getAttribute("src")) app.post({ type: "beings:search-preview-dismiss",
        revision: new URL(target.src).searchParams.get("revision") });
    };
    window.addEventListener("beings:sidebar-peek", dismissIndex);
    return () => window.removeEventListener("beings:sidebar-peek", dismissIndex);
  }, [app, frame]);
  useLayoutEffect(() => {
    app.post = (data) => {
      if (frame.current?.getAttribute("src"))
        frame.current.contentWindow?.postMessage(data, "beings://chat");
    };
    return () => {
      app.post = () => {};
    };
  }, [app, frame]);
  useEffect(() => {
    let disposed = false;
    const forward = (snapshot: import('../../../shared/types').SceneTaskSnapshot) => {
      if (!disposed && snapshot.endpoint === app.snapshot?.settings.endpoint) app.post({ type: 'beings:scene-tasks', ...snapshot,
        revision: new URL(frame.current?.src || 'https://invalid').searchParams.get('revision') });
    };
    const refresh = () => { void app.api.sceneTasks?.().then(forward).catch(() => {}); };
    const stop = app.api.onSceneTasks?.(forward);
    const target = frame.current;
    target?.addEventListener('load', refresh);
    refresh();
    return () => { disposed = true; stop?.(); target?.removeEventListener('load', refresh); };
  }, [app, frame, app.snapshot?.settings.endpoint, app.snapshot?.settings.portalConfigPath, app.snapshot?.portal.phase, app.snapshot?.portal.pid, app.chatSource, app.snapshot?.chatSessions?.map(scene => scene.scene_id).join('|')]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const target = frame.current;
      if (
        !target?.getAttribute("src") ||
        event.origin !== "beings://chat" ||
        event.source !== target.contentWindow
      )
        return;
      const message = event.data;
      if (!message || typeof message !== "object") return;
      if (
        message.type === "beings:connection" &&
        [
          "online",
          "connecting",
          "reconnecting",
          "degraded",
          "offline",
        ].includes(message.state)
      ) {
        app.connection = message.state;
        app.workspace.connection(message.state === "online");
        app.changed();
        return;
      }
      if (message.revision !== new URL(target.src).searchParams.get("revision"))
        return;
      if (message.type === "beings:sidebar-dismiss" || message.type === "beings:sidebar-pointer-away") {
        window.dispatchEvent(new Event(message.type));
        return;
      }
      if (app.town.receiveContactDraft(message)) return;
      if (message.type === 'beings:scene-tasks-request') {
        void app.api.sceneTasks?.().then(snapshot => {
          if (snapshot.endpoint === app.snapshot?.settings.endpoint && frame.current === target && new URL(target.src).searchParams.get('revision') === message.revision)
            app.post({ type: 'beings:scene-tasks', ...snapshot, revision: message.revision });
        }).catch(() => {});
        return;
      }
      if (message.type === "beings:session-create") {
        if (app.chatHistoryScope !== "all" || !app.snapshot?.settings.hasToken || document.querySelector("dialog[open]")) return;
        app.chatSessionCreateRequest++;
        app.changed();
        return;
      }
      if (message.type === "beings:scene-activity") {
        const activity = message.activity;
        if (!activity || typeof activity !== "object" || Array.isArray(activity)) return;
        const entries = Object.entries(activity);
        if (entries.length > 500 || !entries.every(([id, status]) => id.length > 0 && id.length <= 256 &&
          typeof status === "string" && Object.hasOwn(CHAT_SCENE_ACTIVITY_LABELS, status))) return;
        app.setChatSceneActivity(Object.fromEntries(entries) as Record<string, ChatSceneActivity>);
        return;
      }
      if (message.type === 'beings:chat-copy' && typeof message.id === 'string' && message.id.length <= 64 &&
          typeof message.text === 'string' && message.text.length <= 200000) {
        const reply = (ok: boolean) => {
          if (frame.current === target && new URL(target.src).searchParams.get('revision') === message.revision)
            app.post({ type: 'beings:chat-edit-result', id: message.id, revision: message.revision, ok });
        };
        void app.api.copyText(message.text).then(() => reply(true), () => reply(false));
        return;
      }
      if (message.type === "beings:chat-edit" && typeof message.id === "string" && message.id.length <= 64 &&
          ["cut", "copy", "paste"].includes(message.command)) {
        const reply = (ok: boolean) => {
          if (frame.current === target && new URL(target.src).searchParams.get("revision") === message.revision)
            app.post({ type: "beings:chat-edit-result", id: message.id, revision: message.revision, ok });
        };
        void app.api.editChat(message.command).then(reply, () => reply(false));
        return;
      }
      if (message.type === "beings:history-scope-state") {
        if (message.scope === "current" || message.scope === "all") app.setChatHistoryScope(message.scope);
        return;
      }
      if (message.type === "beings:sbs-state") {
        if (typeof message.enabled === "boolean") app.setSbsEnabled(message.enabled);
        else if (message.known === false) app.setSbsEnabled();
        return;
      }
      if (
        message.type === "beings:open-settings" &&
        !document.querySelector("dialog[open]")
      ) {
        void app.openClientSettings();
        return;
      }
      if (message.type === "beings:model-settings") {
        app.openModelSettings();
        return;
      }
      if (message.type === "beings:subagent-settings") {
        app.openSubagentSettings();
        return;
      }
      if (message.type === "beings:chat-search") {
        app.openSearch();
        return;
      }
      if (message.type === "beings:return-settings" && app.settingsRoute === "model") {
        app.returnToClientSettings();
        return;
      }
      if (message.type === "beings:settings-route-dismissed" && app.settingsRoute === "model") {
        app.dismissSettingsRoute();
        return;
      }
      if (message.type === "beings:open-place" && validPlaceTarget(message)) {
        app.navigate(message.view, message.id);
        return;
      }
      if (message.type === "beings:search-index") {
        const entries = message.entries;
        if (
          !Array.isArray(entries) ||
          entries.length > 2000 ||
          !entries.every(
            (entry) =>
              entry &&
              typeof entry.id === "string" &&
              /^turn-\d+$/.test(entry.id) &&
              typeof entry.text === "string" &&
              entry.text.length <= 240,
          )
        )
          return;
        app.searchEntries = entries;
        app.changed();
        return;
      }
      app.workspace.receive(message);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [app, frame]);
}
