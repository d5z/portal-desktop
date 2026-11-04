import { IconButton } from '../../shared/components/icon-button';
import { Icon } from '../../shared/icons/icon';
import { SbsControl } from "../../shared/components/sbs-control";
import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AppModel } from "../models/app";
import { useModel } from "../../shared/hooks/use-model";
import { ChatSceneIndicator } from "./chat-scene";
import { UpdateProgress } from "./update-progress";
import { PortalStatus, portalStatus } from '../../portal/status';
import styles from './topbar.module.scss';
export function Topbar({ model }: { model: AppModel }) {
  const app = useModel(model);
  // Body portals escape the hidden startup shell; mount them only when it is ready.
  return app.startup === 'ready' ? <ReadyTopbar model={app} /> : null;
}
function ReadyTopbar({ model: app }: { model: AppModel }) {
  const town = useModel(app.town);
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
  const checkingUpdate = app.updateChecking || app.update?.phase === "checking";
  const updateActivity = app.update?.activity;
  const portal = app.snapshot?.portal;
  const localStatus = portalStatus(portal);
  const downloadUpdate = () => {
    toggle(false, true);
    void app.downloadClientUpdate();
  };
  return (
    <header className={`topbar ${styles.bar}`} data-floating={app.view === 'chat' && !app.snapshot?.notice} hidden={app.view !== "chat" && !app.chatSplitOpen}>
      <ChatSceneIndicator
        createRequest={app.chatSessionCreateRequest}
        visible={app.view === "chat" || app.chatSplitOpen}
        onReveal={() => {
          if (!app.chatSplitOpen) app.navigate("chat");
        }}
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
      <div className="pair-name" hidden={app.view !== "chat" || app.subagentSettingsOpen}>
        <button id="toggle-being-info" type="button" className="conversation-identity"
          hidden={app.view !== "chat" || app.subagentSettingsOpen} aria-label="Being 信息"
          title={`${town.displayName || app.snapshot?.settings.being || 'Being'} · 查看资料`} aria-describedby="conversation-name" aria-controls="being-info" aria-expanded={app.beingInfoOpen}
          onClick={app.toggleBeingInfo}>
          <span className="conversation-avatar" aria-hidden="true">{(town.displayName || app.snapshot?.settings.being || "Being").slice(0, 1).toUpperCase()}</span>
          <span id="conversation-name">{town.displayName || app.snapshot?.settings.being || "Being"}</span>
        </button>
        <SbsControl known={hasToken && app.sbsKnown && !app.chatLoading} enabled={app.sbsEnabled}
          origin={app.chatSbsOrigin} phase={app.chatSbsPhase} showContent={app.chatShowSbsMessages} allScenes={app.chatHistoryScope==='all'}
          visibilityReady={hasToken && !app.chatLoading && !!app.chatSbsSceneId && app.chatSbsSceneId===app.snapshot?.chatScene?.scene_id}
          onVisibility={show=>app.changeChatSbsVisibility(show)} onToggle={()=>app.toggleSbs()} />
      </div>
      <div className="topbar-actions">
        <IconButton
          id="refresh-chat"
          className="topbar-icon-button"
          label="刷新 Being 对话"
          disabled={!hasToken || app.chatLoading}
          aria-busy={app.chatLoading}
          onClick={() => {
            if (app.snapshot) app.applySnapshot(app.snapshot, true);
          }}
        >
          <Icon name="sync" />
        </IconButton>
        {createPortal(<div className="rail-update">
        <UpdateProgress
          state={app.update}
          onDownload={downloadUpdate}
          onCancel={() => void app.run(() => app.api.cancelUpdate())}
          onInstall={() => void app.run(() => app.api.installUpdate())}
        />
        </div>, document.body)}
        {createPortal(<details
          className="rail-settings-menu"
          id="conversation-options"
          ref={options}
          open={visible}
          onClick={(event) => {
            const button = (event.target as Element).closest("button");
            if (
              button &&
              button.id !== "check-updates" &&
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
            aria-label="客户端设置"
            title="客户端设置"
            aria-expanded={expanded}
            onClick={(event) => {
              event.preventDefault();
              toggle(!expanded);
            }}
          >
            <Icon name="sliders" />
          </summary>
          <div className="options-menu" ref={menu} inert={!expanded}>
            <div id="options-home" hidden={help}>
              <button type="button" id="local-portal-status" className="options-portal-status"
                aria-label={`本机 Portal：${localStatus.label}，查看运行状态`}
                title={`${app.snapshot?.settings.portalName || '本机 Portal'} · ${localStatus.label}${portal?.message ? `\n${portal.message}` : ''}`}
                onClick={() => app.openPortalSettings()}>
                <span className="options-portal-copy">
                  <strong>{app.snapshot?.settings.portalName || '本机 Portal'}</strong>
                  <span className="options-portal-meta"><span>本机 Portal</span><PortalStatus state={portal} /></span>
                </span>
                <Icon name="chevron-right-20" className="options-portal-chevron" />
              </button>
              <button
                id="client-settings-button"
                onClick={() => void app.openClientSettings()}
              >
                <Icon name="menu-settings" className="options-icon" /><span>设置</span><small>⌘ ,</small>
              </button>
              <button
                id="options-help"
                ref={helpButton}
                aria-controls="options-secondary"
                aria-expanded={help}
                onClick={() => showHelp(true)}
              >
                <Icon name="menu-help" className="options-icon" /><span>对话与帮助</span><span className="options-trailing" aria-hidden="true">›</span>
              </button>
              <button
                id="check-updates"
                disabled={checkingUpdate || Boolean(updateActivity && updateActivity.phase !== "ready")}
                onClick={() => {
                  if (updateActivity?.phase === "ready") {
                    toggle(false, true);
                    void app.run(() => app.api.installUpdate());
                  } else if (app.update?.phase === "available") {
                    downloadUpdate();
                  } else void app.checkClientUpdates();
                }}
              >
                <Icon name="menu-update" className="options-icon" /><span>{updateActivity?.phase === "ready" ? "安装更新"
                  : updateActivity ? updateActivity.phase === "installing" ? "正在安装…" : "正在下载更新…"
                  : checkingUpdate ? "正在检查更新…"
                  : app.update?.phase === "available" ? "下载更新" : "手动检查更新"}</span>
                {app.update?.phase === "available" && <small>v{app.update.latestVersion}</small>}
              </button>
              <button
                id="collect-logs"
                disabled={app.collectingLogs}
                onClick={() => void app.collectLogs()}
              >
                <Icon name="menu-logs" className="options-icon" /><span>{app.collectingLogs ? '正在收集日志…' : '收集日志'}</span>
              </button>
              <button
                id="quit-client"
                onClick={() => void app.run(() => app.api.quit())}
              >
                <Icon name="menu-exit" className="options-icon" /><span>退出客户端</span>
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
        </details>, document.body)}
      </div>
    </header>
  );
}
