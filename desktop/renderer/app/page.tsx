import { useEffect, useLayoutEffect, useRef } from "react";
import type { AppModel } from "./models/app";
import { useModel } from "../shared/hooks/use-model";
import { useChatBridge } from "./hooks/use-chat-bridge";
import { WorkspaceNavigation, BeingInfo } from "./components/workspace-navigation";
import { PanelResizeHandle, usePanelWidth } from "../shared/components/panel-resize";
import { Topbar } from "./components/topbar";
import { SceneRibbon, Companion } from "./components/workspace";
import { Browser } from "../browser/page";
import { Portal } from "../portal/page";
import { Town } from "../town/page";
import { TownAuth } from "../town/components/auth";
import { TownComposer } from "../town/components/composer";
import { KitInstall } from "../town/components/kit-install";
import { ChatSearch } from "./components/search";
import { ConnectionSettings, ClientSettings } from "./components/settings";
import { SubagentModelSettings } from "./components/subagent-model-settings";
import { Diagnostics } from "./components/diagnostics";
import { EditContextMenu } from "../shared/components/context-menu";
import { PlaceHeading } from "./components/navigation";
import { Plugins, PluginCommands, PluginSlots, PluginSidebar } from '../plugins/page';
import logo from "../../../resources/branding/logo.png";
import logoWhite from "../../../resources/branding/logo-white.png";
export function App({ model }: { model: AppModel }) {
  const app = useModel(model),
    frame = useRef<HTMLIFrameElement>(null);
  const chatPanel = useRef<HTMLElement>(null);
  const [chatWidth, setChatWidth] = usePanelWidth("chat", 640);
  const themedLogo = app.theme === "dark" ? logoWhite : logo;
  useChatBridge(app, frame);
  useEffect(() => app.start(), [app]);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = app.theme;
    document.documentElement.dataset.platform = app.api?.platform || "";
    document.documentElement.style.setProperty(
      "--reading-size",
      app.readingSize + "px",
    );
    document.body.dataset.view = app.view;
  }, [app.theme, app.view, app.readingSize, app.api]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const dialog = document.querySelector("dialog[open]");
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault(); app.plugins.showCommands(true); return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "f" &&
        !dialog
      ) {
        event.preventDefault();
        app.openSearch();
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "1") {
        event.preventDefault();
        app.navigate("chat");
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "," && !dialog) {
        event.preventDefault();
        void app.openClientSettings();
      }
      if (event.key === "Escape" && !dialog && app.workspace.open)
        app.workspace.toggle(false);
    };
    // Capture before focused controls can consume app-level shortcuts.
    document.addEventListener("keydown", keyboard, true);
    return () => document.removeEventListener("keydown", keyboard, true);
  }, [app]);
  return (
    <>
      <section
        id="startup-screen"
        className="startup-screen"
        aria-busy={app.startup === "loading"}
        aria-label="客户端启动"
        hidden={app.startup === "ready"}
      >
        <div className="startup-content">
          <img src={themedLogo} alt="Portal Desktop" width={56} height={56} />
          <span
            id="startup-spinner"
            className="startup-spinner"
            aria-hidden="true"
            hidden={app.startup !== "loading"}
          />
          <p id="startup-message" role="status">
            {app.startup === "error"
              ? "配置加载未完成，请重试。原配置不会被覆盖。"
              : "正在加载配置并恢复连接…"}
          </p>
          <button
            id="startup-retry"
            className="secondary"
            hidden={app.startup !== "error"}
            onClick={() => void app.initialize()}
          >
            重试
          </button>
        </div>
      </section>
      <main id="client-main" hidden={app.startup !== "ready"}>
        <div className="workspace-body">
          <WorkspaceNavigation app={app} />
          <div className="workspace-stage">
            <Topbar model={app} />
            <p
              id="startup-notice"
              className="startup-notice"
              role="status"
              hidden={!app.snapshot?.notice}
            >
              {app.snapshot?.notice || ""}
            </p>
            <SceneRibbon model={app.workspace} />
            <div className={`workspace-content${app.view !== "chat" && app.chatSplitOpen ? " split-chat" : ""}`}>
            <section ref={chatPanel} id="chat-view" className="view" hidden={app.view !== "chat" && !app.chatSplitOpen}
              style={{ "--chat-pane-width": `${chatWidth}px` } as import("react").CSSProperties}>
              <PanelResizeHandle panel={chatPanel} label="调整并排对话宽度" edge="right" width={chatWidth} onResize={setChatWidth} initial={640} min={300} max={1000} disabled={app.view === "chat" || !app.chatSplitOpen} />
              {app.view !== "chat" && <header className="split-chat-heading"><span>与你的 Being 对话</span><button className="close" aria-label="收起并排对话" onClick={app.toggleChatSplit} /></header>}
              <div
                id="welcome"
                hidden={!app.snapshot || app.snapshot.settings.hasToken}
              >
                <div className="welcome-intro">
                  <img
                    className="welcome-logo"
                    src={themedLogo}
                    alt="Portal Desktop"
                    width={88}
                    height={88}
                  />
                  <h1>从一个想法开始</h1>
                  <p>连接你的 Being，继续对话。</p>
                </div>
                <button
                  className="welcome-connect"
                  id="connect-button"
                  onClick={() => app.showSettings()}
                >
                  <span>连接我的 Being</span>
                  <span className="welcome-connect-arrow" aria-hidden="true">
                    ↗
                  </span>
                </button>
              </div>
              <iframe
                id="chat-frame"
                ref={frame}
                title="Being 对话"
                hidden={!app.snapshot?.settings.hasToken}
                sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads"
                src={app.chatSource || undefined}
                onLoad={() => {
                  if (app.chatSource) app.frameLoaded();
                }}
              />
            </section>
            {app.view !== "chat" && <section id="place-panel" className="place-surface central-place" aria-labelledby="view-title">
              <PlaceContent app={app} />
            </section>}
            </div>
          </div>
          {!app.subagentSettingsOpen && <BeingInfo app={app} />}
          {app.subagentSettingsOpen && <SubagentModelSettings app={app} />}
          <Companion model={app.workspace} />
          {app.view === "chat" && !app.subagentSettingsOpen && <PluginSidebar model={app.plugins} theme={app.theme} contextKey={`${app.chatSource}:${JSON.stringify(app.snapshot?.chatScene)}:${app.town.live?.generation}`} />}
          <Browser model={app} />
        </div>
      </main>
      <Diagnostics model={app} />
      <ChatSearch model={app} />
      <PluginCommands model={app.plugins} />
      <TownComposer model={app.town} />
      <TownAuth model={app.town} returnToSettings={app.settingsRoute === "town"}
        onReturnToSettings={app.returnToClientSettings} onDismissSettingsRoute={app.dismissSettingsRoute} />
      <ClientSettings model={app} />
      <ConnectionSettings model={app} />
      <KitInstall model={app.town} />
      <Toast message={app.toastMessage} />
      <EditContextMenu edit={app.api.editSelection} rootSelector="#client-main, dialog[open]"
        selectionSelector=".reading-text, .dialog-body, #town-body" />
    </>
  );
}

function PlaceContent({ app }: { app: AppModel }) {
  useModel(app.town);
  return (
    <>
      <PlaceHeading
        view={app.view}
        chatExpanded={app.chatSplitOpen}
        onToggleChat={app.toggleChatSplit}
        navigate={app.navigate}
        onBack={app.settingsRoute === "portal" || app.town.returnView ? app.returnFromPlace : undefined}
        onForward={app.town.forwardView ? app.forwardFromPlace : undefined}
        onClose={app.closePlace}
      />
      <PluginSlots model={app.plugins} />
      <div className="plugin-place-layout">
        <div className="plugin-place-main">
          {app.view === "portal" ? <Portal model={app} /> : app.view !== "plugins" && <Town model={app.town} />}
          {app.view === 'plugins' && <Plugins model={app.plugins} theme={app.theme} contextKey={`${app.chatSource}:${JSON.stringify(app.snapshot?.chatScene)}:${app.town.live?.generation}`} />}
        </div>
        <PluginSidebar model={app.plugins} theme={app.theme} contextKey={`${app.chatSource}:${JSON.stringify(app.snapshot?.chatScene)}:${app.town.live?.generation}`} />
      </div>
    </>
  );
}

function Toast({ message }: { message: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const toast = ref.current;
    if (!toast) return;
    if (message) {
      if (typeof toast.showPopover === "function" && !toast.matches(":popover-open"))
        toast.showPopover();
    } else if (typeof toast.hidePopover === "function" && toast.matches(":popover-open")) {
      toast.hidePopover();
    }
  }, [message]);
  return (
    <div ref={ref} id="toast" popover="manual" role="status" aria-live="polite">
      {message}
    </div>
  );
}
