import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AppModel } from "../models/app";
import { useModel } from "../../shared/hooks/use-model";
import { ChatSceneIndicator } from "./chat-scene";
import { UpdateProgress } from "./update-progress";
export function Topbar({ model }: { model: AppModel }) {
  const app = useModel(model);
  const town = useModel(model.town);
  const [expanded, setExpanded] = useState(false),
    [visible, setVisible] = useState(false),
    [help, setHelp] = useState(false);
  const options = useRef<HTMLDetailsElement>(null),
    menu = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLElement>(null);
  const helpButton = useRef<HTMLButtonElement>(null),
    backButton = useRef<HTMLButtonElement>(null);
  const motion = useRef<Animation | null>(null);
  const pendingFocus = useRef<number | null>(null);
  const pendingSectionFocus = useRef<"help" | "back" | null>(null);
  useLayoutEffect(() => {
    // The target is hidden until React commits the new section. Focusing it
    // inside the click/Escape handler fails and leaves the next key on body.
    if (expanded && visible && pendingSectionFocus.current) {
      const target = pendingSectionFocus.current === "back" ? backButton : helpButton;
      target.current?.focus();
    }
    pendingSectionFocus.current = null;
  }, [expanded, visible, help]);
  const showHelp = (open: boolean) => {
    pendingSectionFocus.current = open ? "back" : "help";
    setHelp(open);
  };
  useLayoutEffect(() => {
    if (expanded && visible && pendingFocus.current !== null) {
      const buttons = menu.current?.querySelectorAll<HTMLButtonElement>(
        "#options-home button:not(:disabled)",
      );
      if (buttons?.length)
        buttons[
          (pendingFocus.current + buttons.length) % buttons.length
        ]?.focus();
      pendingFocus.current = null;
    }
  }, [expanded, visible]);
  const toggle = (open: boolean, restore = false) => {
    pendingSectionFocus.current = null;
    if (open) {
      setHelp(false);
      setVisible(true);
    }
    setExpanded(open);
    if (restore) trigger.current?.focus();
  };
  useLayoutEffect(() => {
    if (!visible) {
      motion.current?.cancel();
      motion.current = null;
      return;
    }
    const node = menu.current!;
    const from = motion.current
      ? {
          opacity: getComputedStyle(node).opacity,
          transform: getComputedStyle(node).transform,
        }
      : {
          opacity: expanded ? "0" : "1",
          transform: expanded
            ? "translateY(-5px) scale(.98)"
            : "translateY(0) scale(1)",
        };
    motion.current?.cancel();
    const animation = node.animate(
      [
        from,
        {
          opacity: expanded ? "1" : "0",
          transform: expanded
            ? "translateY(0) scale(1)"
            : "translateY(-5px) scale(.98)",
        },
      ],
      {
        duration: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 0
          : expanded
            ? 180
            : 120,
        easing: "cubic-bezier(.2,.8,.2,1)",
        fill: "forwards",
      },
    );
    motion.current = animation;
    animation.onfinish = () => {
      if (!expanded) {
        // Keep the final transparent frame until React closes <details>.
        // Cancelling here reveals the menu before that render commits.
        setVisible(false);
        return;
      }
      animation.cancel();
      motion.current = null;
    };
    return () => {
      animation.onfinish = null;
    };
  }, [expanded, visible]);
  useEffect(() => {
    const outside = (event: Event) => {
      if (!options.current?.contains(event.target as Node)) setExpanded(false);
    };
    const blur = () => setExpanded(false);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    window.addEventListener("blur", blur);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      window.removeEventListener("blur", blur);
      motion.current?.cancel();
    };
  }, []);
  const hasToken = Boolean(app.snapshot?.settings.hasToken);
  const portal = app.snapshot?.portal;
  const portalLabels = {
    running: "运行中",
    stopped: "未启动",
    starting: "启动中",
    connected: "已连接",
    reconnecting: "重连中",
    stopping: "停止中",
    external: "实例冲突",
    error: "启动失败",
  } as const;
  const portalPhase = portal?.phase || "stopped";
  const portalLabel = portal?.managed === false
    ? "外部运行"
    : portalLabels[portalPhase];
  const portalName = app.snapshot?.settings.portalName?.trim() || "Heart Portal";
  return (
    <header className="topbar">
      <ChatSceneIndicator
        createRequest={app.chatSessionCreateRequest}
        visible={app.view === "chat"}
        onReveal={() => app.navigate("chat")}
        scene={app.snapshot?.chatScene}
        sessions={app.snapshot?.chatSessions}
        activity={app.chatSceneActivity}
        onSession={(operation, value, sceneId) => app.changeChatSession(operation, value, sceneId)}
        connected={hasToken}
        scope={app.chatHistoryScope}
        scopeReady={hasToken && !app.chatLoading && app.chatHistoryScopeKnown}
        onScope={(scope) => app.changeChatHistoryScope(scope)}
        onCopy={(id) => void app.run(async () => {
          await app.api.copyText(id);
          app.toast("场景 ID 已复制");
        })}
      />
      <div className="pair-name">
        <span className="pair-human">你</span>
        <span className="pair-link" aria-hidden="true">
          ·
        </span>
        <span id="conversation-name">
          {town.displayName || app.snapshot?.settings.being || "Being"}
        </span>
        <button
          className={`sbs-header-switch${app.sbsKnown && app.sbsEnabled ? " enabled" : ""}`}
          type="button"
          aria-label="切换 SBS 自主醒来"
          aria-pressed={app.sbsKnown ? app.sbsEnabled : undefined}
          title={app.sbsKnown ? (app.sbsEnabled ? "SBS 自主醒来：开" : "SBS 自主醒来：关") : "SBS 状态未同步，可刷新重试"}
          disabled={!hasToken || !app.sbsKnown || app.chatLoading}
          onClick={() => app.toggleSbs()}
        >
          <span className="sbs-header-dot" aria-hidden="true" />
        </button>
      </div>
      <div className="topbar-actions">
        <button
          id="local-portal-status"
          className="local-portal-status"
          type="button"
          data-phase={portalPhase}
          aria-label={`本机 Portal：${portalName}，${portalLabel}`}
          onClick={() => app.navigate("portal")}
        >
          <span className="local-portal-dot" aria-hidden="true" />
          <span className="local-portal-copy" aria-hidden="true">
            <span className="local-portal-label local-portal-state-label">
              本机 Portal · {portalLabel}
            </span>
            <span className="local-portal-label local-portal-name">
              {portalName}
            </span>
          </span>
        </button>
        <UpdateProgress
          state={app.update}
          onDownload={() => void app.run(() => app.api.downloadUpdate())}
          onCancel={() => void app.run(() => app.api.cancelUpdate())}
          onInstall={() => void app.run(() => app.api.installUpdate())}
        />
        <button
          id="refresh-chat"
          className="topbar-icon-button"
          aria-label="刷新 Being 对话"
          title="刷新 Being 对话"
          disabled={!hasToken || app.chatLoading}
          aria-busy={app.chatLoading}
          onClick={() => {
            if (app.snapshot) app.applySnapshot(app.snapshot, true);
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 11a8 8 0 0 0-14.9-3.9L3 9m0 0V4m0 5h5M4 13a8 8 0 0 0 14.9 3.9L21 15m0 0v5m0-5h-5" />
          </svg>
        </button>
        <details
          id="conversation-options"
          ref={options}
          open={visible}
          onClick={(event) => {
            const button = (event.target as Element).closest("button");
            if (
              button &&
              button !== helpButton.current &&
              button !== backButton.current
            )
              toggle(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              if (help) {
                showHelp(false);
              } else toggle(false, true);
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (!expanded) {
                pendingFocus.current = event.key === "ArrowDown" ? 0 : -1;
                toggle(true);
                return;
              }
              const buttons = [
                ...menu.current!.querySelectorAll<HTMLButtonElement>(
                  `${help ? "#options-secondary" : "#options-home"} button:not(:disabled)`,
                ),
              ];
              const index = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              buttons[
                (index +
                  (event.key === "ArrowDown" ? 1 : index < 0 ? 0 : -1) +
                  buttons.length) %
                  buttons.length
              ]?.focus();
            }
          }}
        >
          <summary
            id="options-trigger"
            ref={trigger}
            aria-label="更多选项"
            title="更多选项"
            aria-expanded={expanded}
            onClick={(event) => {
              event.preventDefault();
              toggle(!expanded);
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="5" cy="12" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="19" cy="12" r="1.5" />
            </svg>
          </summary>
          <div className="options-menu" ref={menu} inert={!expanded}>
            <div id="options-home" hidden={help}>
              <button
                id="toggle-chat-search"
                aria-controls="chat-search-panel"
                aria-expanded={app.searchOpen}
                disabled={!hasToken}
                onClick={() => app.openSearch()}
              >
                查找对话{" "}
                <small>
                  {app.api?.platform === "win32" ? "Ctrl F" : "⌘ F"}
                </small>
              </button>
              <div className="options-divider" />
              <button data-view="town" onClick={() => app.navigate("town")}>
                小镇
              </button>
              <button data-view="kits" onClick={() => app.navigate("kits")}>
                工具
              </button>
              <button
                id="open-browser"
                onClick={() =>
                  void app.run(async () => {
                    await app.api.openBrowser();
                    requestAnimationFrame(() => {
                      document.getElementById("browser-address")?.focus();
                      (
                        document.getElementById(
                          "browser-address",
                        ) as HTMLInputElement
                      )?.select();
                    });
                  })
                }
              >
                浏览器
              </button>
              <div className="options-divider" />
              <button
                id="client-settings-button"
                onClick={() => void app.openClientSettings()}
              >
                设置 <small>⌘ ,</small>
              </button>
              <button
                id="options-help"
                ref={helpButton}
                aria-controls="options-secondary"
                aria-expanded={help}
                onClick={() => showHelp(true)}
              >
                对话与帮助 <span aria-hidden="true">›</span>
              </button>
              <button
                id="quit-client"
                onClick={() => void app.run(() => app.api.quit())}
              >
                退出客户端
              </button>
              <span id="client-version" aria-label="当前客户端版本">
                {app.update?.currentVersion ? `v${app.update.currentVersion}` : "正在读取版本…"}
              </span>
            </div>
            <div id="options-secondary" hidden={!help}>
              <button
                id="options-back"
                ref={backButton}
                onClick={() => showHelp(false)}
              >
                ‹ 返回
              </button>
              <div className="options-divider" />
              <button
                id="open-loom"
                disabled={!hasToken}
                onClick={() => void app.run(() => app.api.openLoom())}
              >
                打开原版 Loom
              </button>
              <button
                data-chat-action="being"
                disabled={!hasToken}
                onClick={() => app.chatAction("being")}
              >
                关于 Being
              </button>
              <button
                id="open-town-guide"
                onClick={() => void app.run(() => app.api.openTownLink("/"))}
              >
                小镇说明
              </button>
              <button
                data-chat-action="privacy"
                disabled={!hasToken}
                onClick={() => app.chatAction("privacy")}
              >
                隐私说明
              </button>
            </div>
          </div>
        </details>
      </div>
    </header>
  );
}
