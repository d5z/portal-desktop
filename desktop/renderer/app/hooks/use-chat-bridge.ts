import { useEffect, useLayoutEffect, type RefObject } from "react";
import type { AppModel } from "../models/app";
import { validPlaceTarget } from "../../shared/lib/navigation";

/** This is the only shell bridge into the separate, sandboxed Loom document. */
export function useChatBridge(
  app: AppModel,
  frame: RefObject<HTMLIFrameElement | null>,
) {
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
