import { useEffect, useRef, useState } from "react";
import { installWebViewport } from "./viewport";
import { Town } from "../desktop/renderer/town/page";
import { TownModel, definitions } from "../desktop/renderer/town/models/town";
import { TownAuth } from "../desktop/renderer/town/components/auth";
import { TownComposer } from "../desktop/renderer/town/components/composer";
import { SceneStore } from "../desktop/renderer/shared/models/scene";
import { Dialog } from "../desktop/renderer/shared/components/dialog";
import { useModel } from "../desktop/renderer/shared/hooks/use-model";
import { createTownAPI } from "./town-api";
import {
  saveConnection,
  parseWebConnection,
  readConnection,
  deploymentConnection,
  type WebConnection,
} from "./connection";
import { Icon } from "./icons";
import {
  loadScenes,
  saveScenes,
  changeScene,
  type WebScenes,
  type SceneOperation,
} from "./scenes";
import { ScenePicker } from "./scene-picker";
import {
  CHAT_SCENE_ACTIVITY_LABELS,
  type ChatSceneActivity,
} from "../desktop/shared/types";
import {
  tabs,
  primaryTab,
  TabNavigation,
  ChatWelcome,
  TownHome,
  DiscoverHome,
  SettingsPage,
} from "./screens";
import logo from "../resources/branding/logo.png";
import logoWhite from "../resources/branding/logo-white.png";
import type { InstallController } from "./install";
import { loadTownConnection, pairingPrompt } from "./town-connection";

const places = [
  ["chat", "对话"],
  ["town", "小镇"],
  ["discover", "发现"],
  ["settings", "设置"],
  ["directory", "小镇服务"],
  ["bonfire", "篝火"],
  ["firesides", "围炉"],
  ["mail", "私信"],
  ["seeds", "种子花园"],
  ["embers", "书架"],
  ["scrolls", "卷轴"],
  ["kits", "Grove 市集"],
];
const readRoute = () => {
  const [view, id] = location.hash.slice(1).split("/");
  return {
    view: places.some(([key]) => key === view) ? view : "chat",
    id: id && /^[\w-]{1,160}$/.test(id) ? id : undefined,
  };
};
export function WebApp({ installation }: { installation: InstallController }) {
  const [connection, setConnection] = useState(readConnection);
  const [route, setRoute] = useState(readRoute);
  const [settings, setSettings] = useState(false);
  const [pairPrompt, setPairPrompt] = useState<string>();
  useEffect(() => {
    void loadTownConnection()
      .then((value) => setPairPrompt(pairingPrompt(value)))
      .catch(() => {});
  }, []);
  const [toast, setToast] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [chatActions, setChatActions] = useState(false);
  const [refreshId, setRefreshId] = useState("");
  const refreshRef = useRef("");
  refreshRef.current = refreshId;
  const [search, setSearch] = useState("");
  const [entries, setEntries] = useState<{ id: string; text: string }[]>([]);
  const [status, setStatus] = useState("connecting");
  const [sceneOpen, setSceneOpen] = useState(false);
  const [sceneGroup, setSceneGroup] = useState<WebScenes>();
  const [sceneError, setSceneError] = useState("");
  const [chatSource, setChatSource] = useState("");
  const [chatPanel, setChatPanel] = useState<string | null>(null);
  const [sceneSwitching, setSceneSwitching] = useState(false);
  const sourceConnection = useRef<WebConnection | null>(null);
  const [activity, setActivity] = useState<Record<string, ChatSceneActivity>>(
    {},
  );
  const sceneRef = useRef<WebScenes | undefined>(undefined);
  const revisionRef = useRef("");
  const activityRef = useRef(activity);
  activityRef.current = activity;
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      return localStorage.getItem("town-web:theme") === "dark"
        ? "dark"
        : "light";
    } catch {
      return "light";
    }
  });
  const [readingSize, setReadingSize] = useState(() => {
    try {
      const size = Number(localStorage.getItem("town-web:reading"));
      return [14, 16, 18, 20].includes(size) ? size : 16;
    } catch {
      return 16;
    }
  });
  const frame = useRef<HTMLIFrameElement>(null);
  const appearanceRef = useRef({ theme, readingSize });
  appearanceRef.current = { theme, readingSize };
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const notify = (message: unknown) =>
    setToast(message instanceof Error ? message.message : String(message));
  const navigate = (view: string, id?: string) => {
    if (!places.some(([key]) => key === view)) return;
    location.hash = view + (id ? "/" + encodeURIComponent(id) : "");
  };
  const post = (message: unknown) =>
    frame.current?.contentWindow?.postMessage(message, location.origin);
  const refreshChat = () => {
    if (!frame.current || refreshRef.current) return;
    const id = crypto.randomUUID();
    refreshRef.current = id;
    setRefreshId(id);
    post({ type: "beings:chat-refresh", id, revision: revisionRef.current });
  };
  useEffect(() => {
    if (!refreshId) return;
    const timer = setTimeout(() => {
      setRefreshId("");
      notify("刷新仍未完成，请检查连接后重试。");
    }, 30000);
    return () => clearTimeout(timer);
  }, [refreshId]);
  const selectScene = (group: WebScenes) => {
    setSceneSwitching(true);
    post({
      type: "beings:session-select",
      revision: revisionRef.current,
      scene: group.scenes.find((scene) => scene.scene_id === group.active),
      scenes: group.scenes,
      scope: group.scope,
    });
  };
  const updateScene = (
    operation: SceneOperation,
    value: string,
    id?: string,
  ) => {
    if (!connection || !sceneRef.current) return;
    if (
      operation === "delete" &&
      ["queued", "thinking", "replying", "working", "waiting"].includes(
        activityRef.current[value],
      )
    )
      throw new Error("此场景正在回复，请结束后再移除。");
    const next = changeScene(sceneRef.current, operation, value, id);
    saveScenes(connection.endpoint, next);
    sceneRef.current = next;
    setSceneGroup(next);
    selectScene(next);
  };
  const updateScope = (scope: "current" | "all") => {
    if (!connection || !sceneRef.current) return;
    try {
      const next = { ...sceneRef.current, scope };
      saveScenes(connection.endpoint, next);
      sceneRef.current = next;
      setSceneGroup(next);
      post({
        type: "beings:history-scope",
        revision: revisionRef.current,
        scope,
      });
    } catch (error) {
      notify(error);
    }
  };
  useEffect(() => {
    setChatSource("");
    setRefreshId("");
    setSceneGroup(undefined);
    sceneRef.current = undefined;
    setSceneError("");
    setActivity({});
    setChatPanel(null);
    setSceneSwitching(false);
    sourceConnection.current = connection;
    if (!connection) return;
    try {
      const group = loadScenes(connection.endpoint);
      sceneRef.current = group;
      setSceneGroup(group);
      revisionRef.current = crypto.randomUUID();
      const scene = group.scenes.find(
        (item) => item.scene_id === group.active,
      )!;
      setChatSource(
        `./chat.html?${new URLSearchParams({ history_scope: connection.endpoint, name: connection.name, scene_id: scene.scene_id, scene_label: scene.scene_meta.scene_label, scene_strict: "1", scene_scope: group.scope, revision: revisionRef.current })}`,
      );
    } catch (error) {
      setSceneError(
        error instanceof Error ? error.message : "场景目录读取失败。",
      );
    }
  }, [connection]);
  const [resources] = useState(() => {
    const transport = createTownAPI();
    const scenes = new SceneStore();
    const town = new TownModel(
      transport.api,
      notify,
      navigate,
      scenes,
      () => {
        if (!connectionRef.current) {
          setSettings(true);
          return;
        }
        const reference = scenes.reference;
        if (!reference?.selection) return;
        navigate("chat");
        post({
          type: "beings:scene-draft",
          id: crypto.randomUUID(),
          expiresAt: Date.now() + 2500,
          text: `一起看看「${reference.selection.title}」。\n来源：${reference.selection.id}\n以下是引用内容：\n${reference.selection.excerpt}`,
        });
      },
      post,
      () => {},
      () => Boolean(connectionRef.current),
    );
    town.supportsLocalKits = false;
    return { transport, town, scenes };
  });
  const town = useModel(resources.town);
  useEffect(() => installWebViewport(), []);
  useEffect(() => {
    const stop = town.start();
    const change = () => setRoute(readRoute());
    window.addEventListener("hashchange", change);
    return () => {
      stop();
      resources.transport.dispose();
      window.removeEventListener("hashchange", change);
    };
  }, [resources, town]);
  useEffect(() => {
    resources.scenes.configure(
      connection?.name || "",
      connection?.endpoint || "",
    );
  }, [resources, connection]);
  useEffect(() => {
    const view =
      route.view === "directory"
        ? "town"
        : ["town", "discover", "settings"].includes(route.view)
          ? "chat"
          : route.view;
    resources.scenes.enter(view as Parameters<SceneStore["enter"]>[0]);
    town.show(view, route.id);
    town.changed();
  }, [route, resources, town]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("town-web:theme", theme);
    } catch {
      /* Theme still works. */
    }
    post({ type: "beings:appearance", theme });
  }, [theme]);
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--reading-size",
      readingSize + "px",
    );
    try {
      localStorage.setItem("town-web:reading", String(readingSize));
    } catch {
      /* In-memory preference. */
    }
    post({ type: "beings:reading", size: readingSize });
  }, [readingSize]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== location.origin ||
        event.source !== frame.current?.contentWindow ||
        !event.data ||
        typeof event.data !== "object"
      )
        return;
      const data = event.data;
      if (
        data.type === "beings:chat-refreshed" &&
        data.revision === revisionRef.current &&
        data.id === refreshRef.current
      ) {
        setRefreshId("");
        if (data.ok === false) notify("刷新失败，请检查连接后重试。");
      }
      if (
        data.type === "beings:session-selected" &&
        data.revision === revisionRef.current &&
        data.sceneId === sceneRef.current?.active
      )
        setSceneSwitching(false);
      if (
        data.type === "beings:chat-panel" &&
        data.revision === revisionRef.current &&
        (data.panel === null ||
          ["model", "being", "privacy"].includes(data.panel))
      )
        setChatPanel(data.panel);
      if (
        data.type === "beings:history-scope-state" &&
        data.revision === revisionRef.current &&
        data.sceneId === sceneRef.current?.active &&
        ["all", "current"].includes(data.scope) &&
        data.scope !== sceneRef.current?.scope
      ) {
        const next = {
          ...sceneRef.current!,
          scope: data.scope as "all" | "current",
        };
        if (connectionRef.current)
          try {
            saveScenes(connectionRef.current.endpoint, next);
            sceneRef.current = next;
            setSceneGroup(next);
          } catch (error) {
            notify(error);
          }
      }
      if (data.type === "beings:scene-tasks-request") {
        if (sceneRef.current) selectScene(sceneRef.current);
        post({ type: "beings:appearance", theme: appearanceRef.current.theme });
        post({
          type: "beings:reading",
          size: appearanceRef.current.readingSize,
        });
      }
      if (
        data.type === "beings:scene-activity" &&
        data.revision === revisionRef.current &&
        data.activity &&
        typeof data.activity === "object"
      ) {
        setActivity(
          Object.fromEntries(
            Object.entries(data.activity).filter(
              ([id, value]) =>
                id.length <= 256 &&
                typeof value === "string" &&
                Object.hasOwn(CHAT_SCENE_ACTIVITY_LABELS, value),
            ),
          ) as Record<string, ChatSceneActivity>,
        );
      }
      if (data.type === "beings:session-create") setSceneOpen(true);
      if (data.type === "beings:open-place" && typeof data.view === "string")
        navigate(data.view, typeof data.id === "string" ? data.id : undefined);
      if (
        data.type === "beings:connection" &&
        [
          "online",
          "connecting",
          "reconnecting",
          "degraded",
          "offline",
        ].includes(data.state)
      )
        setStatus(data.state);
      if (data.type === "beings:open-settings") navigate("settings");
      if (data.type === "beings:chat-search") {
        setSearchOpen(true);
        post({ type: "beings:search-request" });
      }
      if (
        data.type === "beings:search-index" &&
        Array.isArray(data.entries) &&
        data.entries.length <= 2000 &&
        data.entries.every(
          (entry: { id?: unknown; text?: unknown }) =>
            typeof entry?.id === "string" &&
            /^turn-\d+$/.test(entry.id) &&
            typeof entry.text === "string" &&
            entry.text.length <= 240,
        )
      )
        setEntries(data.entries);
      if (data.type === "beings:scene-draft-result")
        notify(
          data.ok ? "引用已放入对话草稿" : "对话中已有草稿，请先处理后再引用",
        );
      if (
        data.type === "beings:scene-select" &&
        typeof data.text === "string" &&
        data.text.length <= 12000
      )
        post({
          type: "beings:scene-draft",
          id: crypto.randomUUID(),
          text: `一起看看这段对话。\n以下是引用内容：\n${data.text}`,
          expiresAt: Date.now() + 2500,
        });
      if (data.type === "beings:scene-capture")
        post({ type: "beings:scene-captured", id: data.id });
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  const title = places.find(([key]) => key === route.view)?.[1] || "对话";
  const activeTab = primaryTab(route.view);
  const home = tabs.some((tab) => tab.view === route.view);
  const themedLogo = theme === "dark" ? logoWhite : logo;
  return (
    <div
      className="web-app"
      data-chat-panel={route.view === "chat" ? chatPanel : undefined}
    >
      <aside className="ios-sidebar">
        <a className="ios-brand" href="#chat">
          <img src={themedLogo} alt="" />
          <span>Beings Town</span>
        </a>
        <TabNavigation active={activeTab} navigate={navigate} />

        <button
          className="ios-sidebar-profile"
          onClick={() => navigate("settings")}
        >
          <span className="ios-sidebar-avatar">
            <img src={themedLogo} alt="" />
          </span>
          <span>
            <strong>{connection?.name || "你的 Being"}</strong>
            <small>
              <span
                className={`web-dot ${connection && status === "online" ? "online" : ""}`}
              />
              {connection
                ? status === "online"
                  ? "已连接"
                  : "正在连接"
                : "尚未连接"}
            </small>
          </span>
          <Icon name="chevron" size={16} />
        </button>
      </aside>
      <main className="web-main">
        <header
          className={`ios-header${route.view === "chat" && connection ? " compact" : ""}`}
        >
          <div>
            {!home && (
              <button
                className="ios-back"
                onClick={() => navigate(route.id ? route.view : activeTab)}
                aria-label={
                  route.id
                    ? "返回列表"
                    : `返回${activeTab === "town" ? "小镇" : "发现"}`
                }
              >
                <Icon name="back" size={23} />
              </button>
            )}
            <div>
              <h1>{title}</h1>
            </div>
          </div>
          <div className="ios-header-actions">
            {route.view === "chat" && connection && (
              <button
                className="ios-round-button web-chat-refresh"
                aria-label={refreshId ? "正在刷新对话" : "刷新对话"}
                title="刷新对话"
                aria-busy={Boolean(refreshId)}
                disabled={Boolean(refreshId) || sceneSwitching || !chatSource}
                onClick={refreshChat}
              >
                <Icon name="refresh" size={21} />
              </button>
            )}
            {route.view === "chat" && connection && (
              <button
                className="ios-round-button ios-mobile-chat-menu"
                aria-label="更多对话操作"
                onClick={() => setChatActions(true)}
              >
                <Icon name="more" />
              </button>
            )}
            {route.view === "chat" ? (
              <button
                className="ios-header-avatar"
                aria-label="Being 连接设置"
                onClick={() => setSettings(true)}
              >
                <img src={themedLogo} alt="" />
                <span
                  className={`web-dot ${connection && status === "online" ? "online" : ""}`}
                />
              </button>
            ) : route.view === "town" ? (
              <button
                className="ios-round-button"
                aria-label="连接 Town"
                onClick={() => void town.auth()}
              >
                <Icon name="link" />
              </button>
            ) : (
              <button
                className="ios-round-button"
                aria-label={theme === "light" ? "切换深色主题" : "切换浅色主题"}
                onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              >
                <Icon name={theme === "light" ? "moon" : "sun"} />
              </button>
            )}
          </div>
        </header>
        <section
          className="web-chat"
          aria-busy={sceneSwitching}
          hidden={route.view !== "chat"}
          aria-label="Being 对话"
        >
          {connection && sceneGroup && (
            <div className="web-scene-toolbar">
              <button
                className="web-current-scene"
                onClick={() => setSceneOpen(true)}
                aria-label="切换对话场景"
              >
                <Icon name="chat" size={18} />
                <span>
                  {
                    sceneGroup.scenes.find(
                      (scene) => scene.scene_id === sceneGroup.active,
                    )?.scene_meta.scene_label
                  }
                </span>
                <Icon name="chevron" size={14} />
              </button>
              <div className="ios-segment" role="group" aria-label="历史范围">
                <button
                  aria-pressed={sceneGroup.scope === "current"}
                  onClick={() => updateScope("current")}
                >
                  当前
                </button>
                <button
                  aria-pressed={sceneGroup.scope === "all"}
                  onClick={() => updateScope("all")}
                >
                  全部
                </button>
              </div>
            </div>
          )}
          {sceneError && (
            <p className="form-error" role="alert">
              {sceneError}
            </p>
          )}
          {connection && (
            <div className="web-chat-tools">
              <button
                onClick={() => {
                  setSearchOpen(true);
                  post({ type: "beings:search-request" });
                }}
              >
                <Icon name="search" size={17} />
                搜索对话
              </button>
              <button
                onClick={() =>
                  post({ type: "beings:chat-action", action: "model" })
                }
              >
                <Icon name="sliders" size={17} />
                模型设置
              </button>
              <button
                onClick={() =>
                  post({ type: "beings:chat-action", action: "being" })
                }
              >
                <Icon name="info" size={17} />
                关于 Being
              </button>
            </div>
          )}
          {connection ? (
            sourceConnection.current === connection &&
            chatSource && (
              <iframe
                inert={sceneSwitching}
                key={
                  connection.endpoint +
                  connection.token +
                  connection.relaySecret
                }
                ref={frame}
                src={chatSource}
                title="Being 对话"
                referrerPolicy="no-referrer"
                sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads"
                onLoad={() => {
                  post({ type: "beings:appearance", theme });
                  post({ type: "beings:reading", size: readingSize });
                }}
              />
            )
          ) : (
            <ChatWelcome
              connect={() => setSettings(true)}
              navigate={navigate}
              logo={themedLogo}
            />
          )}
        </section>
        <section className="ios-scroll-page" hidden={route.view === "chat"}>
          {route.view === "town" && (
            <TownHome
              navigate={navigate}
              paired={town.live?.phase === "connected"}
              pair={() => void town.auth()}
            />
          )}
          {route.view === "discover" && <DiscoverHome navigate={navigate} />}
          {route.view === "settings" && (
            <SettingsPage
              installation={installation}
              name={connection?.name}
              townName={town.live?.display || town.live?.beingId}
              connected={Boolean(connection)}
              theme={theme}
              setTheme={setTheme}
              readingSize={readingSize}
              setReadingSize={setReadingSize}
              connect={() => setSettings(true)}
              pair={() => void town.auth()}
              logo={themedLogo}
            />
          )}
          <div className="web-town" hidden={home}>
            <div className="ios-detail-description">
              {route.view === "kits"
                ? "社区共同创造的工具与应用。"
                : definitions[route.view === "directory" ? "town" : route.view]
                    ?.description}
            </div>
            <Town model={town} />
          </div>
        </section>
        <TabNavigation active={activeTab} navigate={navigate} mobile />
      </main>
      <TownAuth model={town} pairPrompt={pairPrompt} />
      <TownComposer model={town} />
      {sceneGroup && (
        <ScenePicker
          open={sceneOpen}
          close={() => setSceneOpen(false)}
          group={sceneGroup}
          activity={activity}
          change={updateScene}
        />
      )}
      <Dialog
        open={chatActions}
        onClose={() => setChatActions(false)}
        id="ios-chat-actions"
        aria-labelledby="ios-chat-actions-title"
        dismissOnBackdrop
      >
        <div className="dialog-heading">
          <h2 id="ios-chat-actions-title">对话选项</h2>
          <button
            className="close"
            aria-label="关闭对话选项"
            onClick={() => setChatActions(false)}
          />
        </div>
        <div className="ios-action-list">
          <button
            onClick={() => {
              setChatActions(false);
              setSearchOpen(true);
              post({ type: "beings:search-request" });
            }}
          >
            <Icon name="search" />
            搜索对话
          </button>
          <button
            onClick={() => {
              setChatActions(false);
              post({ type: "beings:chat-action", action: "model" });
            }}
          >
            <Icon name="sliders" />
            模型设置
          </button>
          <button
            onClick={() => {
              setChatActions(false);
              post({ type: "beings:chat-action", action: "being" });
            }}
          >
            <Icon name="info" />
            关于 Being
          </button>
        </div>
      </Dialog>
      <Dialog
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        aria-labelledby="web-search-title"
        id="web-search"
      >
        <div className="dialog-heading">
          <h2 id="web-search-title">搜索对话</h2>
          <button
            className="close"
            aria-label="关闭搜索"
            onClick={() => setSearchOpen(false)}
          />
        </div>
        <div className="dialog-body">
          <input
            aria-label="搜索对话内容"
            autoFocus
            placeholder="搜索已加载的对话…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <p className="field-help">
            搜索当前已加载的用户消息；选择后跳转到对应回复。
          </p>
          <div className="web-search-results">
            {entries
              .filter((entry) =>
                entry.text
                  .toLocaleLowerCase()
                  .includes(search.toLocaleLowerCase()),
              )
              .map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => {
                    navigate("chat");
                    setSearchOpen(false);
                    post({ type: "beings:search-jump", id: entry.id });
                  }}
                >
                  {entry.text}
                </button>
              ))}
            {!entries.some((entry) =>
              entry.text
                .toLocaleLowerCase()
                .includes(search.toLocaleLowerCase()),
            ) && <p className="field-help">没有找到匹配的对话。</p>}
          </div>
        </div>
      </Dialog>
      <ConnectionDialog
        open={settings}
        connection={connection}
        close={() => setSettings(false)}
        save={(value) => {
          setConnection(value);
          setEntries([]);
          setStatus("connecting");
          setSettings(false);
          if (value) navigate("chat");
        }}
      />
      {toast && (
        <div className="web-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function ConnectionDialog({
  open,
  connection,
  close,
  save,
}: {
  open: boolean;
  connection: WebConnection | null;
  close(): void;
  save(value: WebConnection | null): void;
}) {
  const [link, setLink] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setLink("");
      setError("");
    }
  }, [open]);
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const parsed = parseWebConnection(link);
      const resolved = await deploymentConnection(parsed);
      const url = new URL(resolved.api + "/api/status");
      url.searchParams.set("token", parsed.token);
      const response = await fetch(url, {
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok)
        throw new Error(
          `连接验证失败（HTTP ${response.status}），请检查 Loom 链接。`,
        );
      const data = await response.json();
      if (!data || typeof data !== "object" || Array.isArray(data))
        throw new Error("Being 返回的数据格式不正确。");
      saveConnection(parsed);
      save(parsed);
    } catch (reason) {
      setError(
        reason instanceof TypeError
          ? "无法连接 Being。请检查网络，并确认服务允许此网页来源（CORS），或配置部署包的 Loom 转发地址。"
          : reason instanceof Error
            ? reason.message
            : "连接失败，请重试。",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      busy={busy}
      aria-labelledby="web-settings-title"
      id="web-settings"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="dialog-heading">
          <h2 id="web-settings-title">连接 Being</h2>
          <button
            type="button"
            className="close"
            aria-label="关闭设置"
            disabled={busy}
            onClick={close}
          />
        </div>
        <div className="dialog-body">
          <h3>连接你的 Being</h3>
          <p className="field-help">
            粘贴包含 token 的完整 Loom
            链接。此设备会记住连接，下次打开可继续对话；断开连接后清除。
          </p>
          {connection && (
            <p className="web-current">当前 Being：{connection.name}</p>
          )}
          <label htmlFor="web-link">Loom 链接</label>
          <input
            id="web-link"
            type="password"
            autoComplete="off"
            placeholder="https://example.com/your-being/?token=…"
            value={link}
            disabled={busy}
            onChange={(event) => setLink(event.target.value)}
            required
          />
          <p className="field-help">
            Town 使用独立身份，可在「设置 → Town 身份」中配对。
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="dialog-footer">
          {connection && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                try {
                  saveConnection(null);
                  save(null);
                } catch (reason) {
                  setError(
                    reason instanceof Error
                      ? reason.message
                      : "清除连接失败，请重试。",
                  );
                }
              }}
            >
              断开 Being
            </button>
          )}
          <button className="primary" disabled={busy || !link.trim()}>
            {busy ? "正在验证…" : "连接 Being"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
