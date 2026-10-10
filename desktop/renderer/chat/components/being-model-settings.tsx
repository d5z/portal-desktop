import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ChatRuntime, ChatState, ConfigResult } from "../models/chat";
import { useModel } from "../../shared/hooks/use-model";
import { NavigationControls } from "../../shared/components/navigation-controls";

interface Route {
  id: string;
  name?: string;
  base_url?: string;
  has_key?: boolean;
  keyless_in_loom?: boolean;
  key_hint?: string;
}
interface Model {
  id: string;
  name?: string;
  context?: number;
  reasoning?: boolean;
  tool_call?: boolean;
  release_date?: string;
  source?: string;
}
interface ModelList {
  models: Model[];
  reason?: string;
}
const thinkingOptions = [
  ["off", "关闭"],
  ["low", "低"],
  ["medium", "中"],
  ["high", "高"],
];
function capabilities(model?: Model) {
  if (!model) return "";
  const context = model.context
    ? (model.context >= 1048576
        ? Math.round(model.context / 1048576) + "M"
        : Math.round(model.context / 1024) + "K") + " 上下文"
    : "";
  return [
    model.reasoning === true && "推理",
    context,
    model.tool_call === true && "工具调用",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function BeingModelSettings({
  state,
  runtime,
  open,
  close,
  back,
  contentOnly = false,
  onBusy,
  mobilePage = false,
  fallback,
}: {
  state: ChatState;
  runtime: Pick<ChatRuntime, "loadLlmConfig" | "applyConfigChange"> &
    Partial<Pick<ChatRuntime, "request">>;
  open: boolean;
  close: () => void;
  back?: () => void;
  contentOnly?: boolean;
  onBusy?: (busy: boolean) => void;
  mobilePage?: boolean;
  fallback: ReactNode;
}) {
  useModel(state);
  const [legacy, setLegacy] = useState(false);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [picker, setPicker] = useState(false);
  const [routeId, setRouteId] = useState("");
  const [list, setList] = useState<ModelList>({ models: [] });
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Model | null>(null);
  const [key, setKey] = useState("");
  const [needsKey, setNeedsKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ConfigResult | null>(null);
  const [custom, setCustom] = useState({
    base_url: "",
    model: "",
    provider: "openai",
  });
  const [reload, setReload] = useState(0);
  const cache = useRef(new Map<string, ModelList>());
  const keyInput = useRef<HTMLInputElement>(null),
    searchInput = useRef<HTMLInputElement>(null),
    closeButton = useRef<HTMLButtonElement>(null),
    changeButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const id = (name: string) => `${contentOnly ? "Heart-" : ""}${name}`;
  const route = routes.find((item) => item.id === routeId);
  const currentRoute = routes.find((item) => item.id === state.config.provider);
  const current = cache.current
    .get(state.config.provider || "")
    ?.models.find((item) => item.id === state.config.model);
  const disabled = busy || state.configLoading;
  const showKey =
    routeId !== "custom" &&
    route &&
    (needsKey || (!route.has_key && !route.keyless_in_loom));
  useEffect(() => {
    onBusy?.(busy);
  }, [busy, onBusy]);
  useEffect(() => {
    if (!open || legacy) return;
    void runtime.loadLlmConfig();
    closeButton.current?.focus();
  }, [open, runtime, legacy]);
  useEffect(() => {
    if (!open) {
      setPicker(false);
      setKey("");
      setFailure(null);
      cache.current.clear();
    }
  }, [open]);
  useEffect(() => {
    if (!open || legacy) return;
    let cancelled = false;
    setRouteLoading(true);
    setRouteError("");
    runtime.request!("/api/llm/routes", { cache: "no-store" })
      .then(async (response) => {
        if (cancelled) return;
        if ([404, 405, 501].includes(response.status)) {
          setLegacy(true);
          return;
        }
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(data.error || "无法读取线路。");
        if (!Array.isArray(data.routes))
          throw new Error("线路列表格式不正确，请重试。");
        setRoutes(data.routes);
      })
      .catch((error) => {
        if (!cancelled) setRouteError(error.message);
      })
      .finally(() => {
        if (!cancelled) setRouteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, runtime, legacy, reload]);
  useEffect(() => {
    if (!open || !picker || routeId === "custom" || !routeId) return;
    let cancelled = false;
    const cached = cache.current.get(routeId);
    setList(cached || { models: [] });
    if (cached) {
      setLoading(false);
      return;
    }
    setLoading(true);
    runtime.request!("/api/llm/models?route=" + encodeURIComponent(routeId), {
      cache: "no-store",
    })
      .then(async (response) => {
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(data.error || "无法读取模型列表。");
        const value: ModelList = {
          models: (Array.isArray(data.models) ? data.models : [])
            .slice()
            .sort(
              (a: Model, b: Model) =>
                (b.release_date || "").localeCompare(a.release_date || "") ||
                a.id.localeCompare(b.id),
            ),
          reason: data.reason,
        };
        cache.current.set(routeId, value);
        setList(value);
      })
      .catch((error) => {
        if (!cancelled) setList({ models: [], reason: error.message });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, picker, routeId, runtime, reload]);
  useEffect(() => {
    if (picker && routeId !== "custom") searchInput.current?.focus();
  }, [picker, routeId]);
  useEffect(() => {
    if (!picker && !disabled && !routeLoading && restoreFocus.current) {
      const frame = requestAnimationFrame(() => {
        const button = changeButton.current;
        if (!button || button.disabled) return;
        button.focus();
        restoreFocus.current = false;
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [picker, disabled, routeLoading]);
  function chooseRoute(value: string) {
    setRouteId(value);
    setQuery("");
    setSelected(null);
    setKey("");
    setNeedsKey(false);
    setFailure(null);
  }
  function showPicker() {
    chooseRoute(
      routes.find((item) => item.id === state.config.provider)?.id ||
        routes[0]?.id ||
        "custom",
    );
    setPicker(true);
  }
  function leavePicker() {
    restoreFocus.current = true;
    setPicker(false);
    setSelected(null);
    setKey("");
    setFailure(null);
  }
  async function saveKey() {
    if (disabled || !key.trim() || !route) return;
    setBusy(true);
    setFailure(null);
    try {
      const response = await runtime.request!("/api/llm/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ route: route.id, api_key: key.trim() }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok)
        throw new Error(data.error || "密钥保存失败。");
      if (!mounted.current) return;
      setKey("");
      setNeedsKey(false);
      setRoutes((items) =>
        items.map((item) =>
          item.id === route.id ? { ...item, has_key: true } : item,
        ),
      );
      cache.current.delete(route.id);
      setReload((value) => value + 1);
    } catch (error) {
      if (mounted.current)
        setFailure({
          error: error instanceof Error ? error.message : "密钥保存失败。",
        });
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function apply(modelId = selected?.id) {
    if (disabled) return;
    const patch =
      routeId === "custom"
        ? {
            ...custom,
            base_url: custom.base_url.trim(),
            model: custom.model.trim(),
            ...(key.trim() ? { api_key: key.trim() } : {}),
          }
        : route && modelId
          ? {
              provider: route.id,
              model: modelId,
              ...(route.base_url !== undefined
                ? { base_url: route.base_url }
                : {}),
            }
          : null;
    if (!patch) return;
    if (!patch.model || (routeId === "custom" && !patch.base_url)) {
      setFailure({ error: "接口地址和模型 ID 都要填写。" });
      return;
    }
    if (routeId === "custom") {
      try {
        if (!["https:", "http:"].includes(new URL(patch.base_url!).protocol))
          throw new Error();
      } catch {
        setFailure({ error: "请填写有效的 HTTP(S) 接口地址。" });
        return;
      }
    }
    setBusy(true);
    setFailure(null);
    try {
      const result = await runtime.applyConfigChange(patch);
      if (!mounted.current) return;
      if (result?.ok && !result.rolled_back && result.config) {
        leavePicker();
        setReload((value) => value + 1);
      } else {
        setFailure(
          result?.rolled_back
            ? { error: "试连失败，已恢复上次可用配置。" }
            : result || { error: state.configStatus || "试连失败，请重试。" },
        );
        if (
          result?.needs_key ||
          result?.http_status === 401 ||
          result?.http_status === 403
        ) {
          setNeedsKey(true);
          requestAnimationFrame(() => keyInput.current?.focus());
        }
      }
    } catch (error) {
      if (mounted.current)
        setFailure({
          error: error instanceof Error ? error.message : "试连失败。",
        });
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function changeThinking(thinking: string) {
    if (disabled) return;
    setBusy(true);
    try {
      await runtime.applyConfigChange({ thinking });
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = list.models.filter((model) =>
    tokens.every((token) =>
      `${model.id} ${model.name || ""}`.toLocaleLowerCase().includes(token),
    ),
  );
  const recentIds = [
    ...new Set(
      (state.config.history || [])
        .filter((item) => item.provider === routeId)
        .map((item) => item.model),
    ),
  ].slice(0, 3);
  const recent = recentIds.flatMap(
    (modelId) => matches.find((item) => item.id === modelId) || [],
  );
  const rest = matches.filter((item) => !recent.includes(item));
  const modelId = routeId === "custom" ? custom.model : selected?.id;
  const status = failure?.http_status;
  const routeName = route?.name || routeId;
  const humanError =
    status === 400 || status === 404
      ? `${routeName} 上没有 ${modelId || "这个模型"}`
      : status === 401 || status === 403
        ? `${routeName} 拒绝了这个密钥（HTTP ${status}）`
        : status && status >= 500
          ? `${routeName} 暂时不可用（HTTP ${status}）`
          : "";
  const failureText = failure?.needs_key
    ? "这条线路还没有可用密钥，请填写后重试。"
    : humanError || failure?.error || (failure ? "试连失败，请重试。" : "");
  const errorView = failure && (
    <div className="llm-switch-error" role="alert">
      <p>{failureText}</p>
      {!!failure.candidates?.length && (
        <div className="llm-candidates">
          <span>你是不是想要：</span>
          {failure.candidates.slice(0, 3).map((candidate) => (
            <button
              type="button"
              key={candidate}
              disabled={disabled}
              onClick={() => {
                if (routeId === "custom")
                  setCustom((value) => ({ ...value, model: candidate }));
                else
                  setSelected(
                    list.models.find((item) => item.id === candidate) || {
                      id: candidate,
                    },
                  );
                setFailure(null);
              }}
            >
              {candidate}
            </button>
          ))}
        </div>
      )}
      {!failure.needs_key && status && (
        <details>
          <summary>技术细节</summary>
          <pre>{`HTTP ${status}\n线路：${routeId}\n模型：${modelId || ""}\n${failure.error || ""}`}</pre>
        </details>
      )}
    </div>
  );
  if (legacy) return fallback;
  const Root = contentOnly ? "section" : "aside";
  return (
    <Root
      id={contentOnly ? undefined : "settings-panel"}
      className={
        contentOnly
          ? "model-settings-content"
          : `side-panel${open ? " active" : ""}`
      }
      inert={!open}
      aria-hidden={!open}
      aria-label="模型设置"
      data-mobile-page={mobilePage || undefined}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          if (disabled) return;
          if (selected) {
            setSelected(null);
            setFailure(null);
          } else if (picker) leavePicker();
          else close();
        }
      }}
    >
      {!contentOnly && (
        <div className="settings-header panel-header">
          <div className="settings-heading-copy">
            <div className="settings-title-line">
              <h2 id={id("settings-title")}>模型设置</h2>
              {!mobilePage && (
                <NavigationControls back={disabled ? undefined : back} />
              )}
            </div>
            <p>选择当前 Being 使用的模型</p>
          </div>
          <button
            ref={closeButton}
            className="btn-close"
            type="button"
            aria-label={mobilePage ? "返回对话" : "关闭模型设置"}
            disabled={disabled}
            onClick={close}
          >
            {mobilePage ? "‹" : "✕"}
          </button>
        </div>
      )}
      <div className="settings-body llm-route-settings" aria-busy={disabled}>
        {!picker ? (
          <div id={id("llm-overview")}>
            <div className="settings-section-heading">
              <h3>模型</h3>
            </div>
            <section
              id={id("llm-current")}
              className="llm-current"
              aria-label="当前模型"
            >
              <div className="llm-current-top">
                <div className="current-model-caption">
                  <span
                    className={`model-indicator${currentRoute && !currentRoute.has_key && !currentRoute.keyless_in_loom ? " missing-key" : ""}`}
                  />
                  当前使用
                </div>
                <button
                  ref={changeButton}
                  type="button"
                  className="llm-custom-link"
                  disabled={disabled || (routeLoading && !routes.length)}
                  onClick={showPicker}
                >
                  更换
                </button>
              </div>
              <h3 className="model-name">
                {current?.name ||
                  state.config.model ||
                  (state.configLoading ? "正在读取模型…" : "尚未配置模型")}
              </h3>
              {state.config.model && (
                <div className="model-detail">
                  {currentRoute?.name || state.config.provider || "自定义"} ·{" "}
                  {state.config.model}
                </div>
              )}
              {capabilities(current) && (
                <p className="hint">{capabilities(current)}</p>
              )}
            </section>
            <div className="model-parameter">
              <div className="parameter-heading">思考深度</div>
              <div
                className="toggle-group"
                id={id("cfg-thinking")}
                role="group"
                aria-label="思考深度"
              >
                {thinkingOptions.map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    data-val={value}
                    className={
                      (state.config.thinking || "medium") === value
                        ? "active"
                        : ""
                    }
                    aria-pressed={(state.config.thinking || "medium") === value}
                    disabled={disabled}
                    onClick={() => void changeThinking(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div id={id("llm-picker")}>
            <button
              type="button"
              className="step2-back"
              disabled={disabled}
              onClick={leavePicker}
            >
              ← 返回模型
            </button>
            <div className="settings-section-heading">
              <h3>线路</h3>
            </div>
            <div className="llm-route-list" role="group" aria-label="模型线路">
              {routes.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-label={item.name || item.id}
                  className={item.id === routeId ? "active" : ""}
                  aria-pressed={item.id === routeId}
                  disabled={disabled}
                  onClick={() => chooseRoute(item.id)}
                >
                  <span
                    className={`model-indicator${item.has_key || item.keyless_in_loom ? "" : " missing-key"}`}
                    title={
                      item.keyless_in_loom
                        ? "无需密钥"
                        : item.has_key
                          ? "已有密钥"
                          : "缺少密钥"
                    }
                  />
                  {item.name || item.id}
                </button>
              ))}
              <button
                type="button"
                className={routeId === "custom" ? "active" : ""}
                aria-pressed={routeId === "custom"}
                disabled={disabled}
                onClick={() => chooseRoute("custom")}
              >
                自定义
              </button>
            </div>
            {showKey && (
              <div className="llm-key-card">
                <strong>{route.name || route.id} 还没有可用密钥</strong>
                <label className="field-label" htmlFor={id("llm-key-input")}>
                  API 密钥
                </label>
                <input
                  ref={keyInput}
                  id={id("llm-key-input")}
                  type="password"
                  className="field-input"
                  autoComplete="off"
                  placeholder={
                    route.key_hint ? route.key_hint + "…" : "输入 API 密钥"
                  }
                  value={key}
                  disabled={disabled}
                  onChange={(event) => setKey(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void saveKey();
                    }
                  }}
                />
                <p className="hint">
                  密钥仅保存在当前 Being 中，保存后不会回显。
                </p>
                <button
                  type="button"
                  className="btn-apply"
                  disabled={disabled || !key.trim()}
                  onClick={() => void saveKey()}
                >
                  {busy ? "正在保存…" : "保存并加载模型"}
                </button>
              </div>
            )}
            {routeId === "custom" ? (
              <div className="llm-custom-form">
                {(
                  [
                    ["base_url", "接口地址", "https://…/v1"],
                    ["model", "模型 ID", "填写线路上的原样 ID"],
                  ] as const
                ).map(([field, label, placeholder]) => (
                  <div className="settings-section" key={field}>
                    <label
                      className="field-label"
                      htmlFor={id("llm-custom-" + field)}
                    >
                      {label}
                    </label>
                    <input
                      id={id("llm-custom-" + field)}
                      className="field-input"
                      type={field === "base_url" ? "url" : "text"}
                      placeholder={placeholder}
                      autoComplete="off"
                      spellCheck={false}
                      disabled={disabled}
                      value={custom[field]}
                      onChange={(event) => {
                        setCustom((value) => ({
                          ...value,
                          [field]: event.target.value,
                        }));
                        setFailure(null);
                      }}
                    />
                  </div>
                ))}
                <div className="settings-section">
                  <label
                    className="field-label"
                    htmlFor={id("llm-custom-protocol")}
                  >
                    协议
                  </label>
                  <select
                    id={id("llm-custom-protocol")}
                    className="field-input"
                    disabled={disabled}
                    value={custom.provider}
                    onChange={(event) =>
                      setCustom((value) => ({
                        ...value,
                        provider: event.target.value,
                      }))
                    }
                  >
                    {[
                      ["openai", "OpenAI 兼容"],
                      ["anthropic", "Anthropic"],
                      ["google", "Google"],
                      ["openai-responses", "OpenAI Responses"],
                    ].map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settings-section">
                  <label className="field-label" htmlFor={id("llm-custom-key")}>
                    API 密钥
                  </label>
                  <input
                    ref={keyInput}
                    id={id("llm-custom-key")}
                    type="password"
                    className="field-input"
                    autoComplete="off"
                    value={key}
                    disabled={disabled}
                    onChange={(event) => setKey(event.target.value)}
                  />
                  <p className="hint">
                    已有密钥时可留空沿用，无认证接口可不填。
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-apply"
                  disabled={disabled}
                  onClick={() => void apply()}
                >
                  {busy ? "正在试连…" : "试连并切换"}
                </button>
              </div>
            ) : (
              <>
                <input
                  ref={searchInput}
                  type="search"
                  className="field-input"
                  aria-label="搜索模型"
                  placeholder="搜索模型名称或 ID"
                  value={query}
                  disabled={busy}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setSelected(null);
                    setFailure(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      document
                        .getElementById(id("llm-model-list"))
                        ?.querySelector<HTMLButtonElement>(".llm-model-row")
                        ?.focus();
                    }
                  }}
                />
                {list.reason && (
                  <p className="hint" role="status">
                    {list.reason}
                  </p>
                )}
                <div
                  id={id("llm-model-list")}
                  className="llm-model-list"
                  aria-label="模型列表"
                  aria-busy={loading}
                  onKeyDown={(event) => {
                    if (
                      !["ArrowDown", "ArrowUp"].includes(event.key) ||
                      !(event.target instanceof HTMLElement) ||
                      !event.target.classList.contains("llm-model-row")
                    )
                      return;
                    event.preventDefault();
                    const rows = Array.from(
                      event.currentTarget.querySelectorAll<HTMLButtonElement>(
                        ".llm-model-row",
                      ),
                    );
                    const index = rows.indexOf(
                      event.target as HTMLButtonElement,
                    );
                    rows[
                      Math.max(
                        0,
                        Math.min(
                          rows.length - 1,
                          index + (event.key === "ArrowDown" ? 1 : -1),
                        ),
                      )
                    ]?.focus();
                  }}
                >
                  {loading ? (
                    <p className="model-empty" role="status">
                      正在读取模型…
                    </p>
                  ) : !matches.length ? (
                    <div className="model-empty">
                      {tokens.length && list.models.length
                        ? "没有匹配的模型，试试其他名称。"
                        : "这条线路没有返回模型。"}
                      <button
                        type="button"
                        className="llm-custom-link"
                        disabled={disabled}
                        onClick={() => {
                          cache.current.delete(routeId);
                          setReload((value) => value + 1);
                        }}
                      >
                        重试
                      </button>
                    </div>
                  ) : (
                    [
                      ["最近", recent],
                      ["全部", rest],
                    ].map(([label, models]) => (
                      <div key={label as string}>
                        {(models as Model[]).length > 0 &&
                          recent.length > 0 && (
                            <div className="provider-group-label">
                              {label as string}
                            </div>
                          )}
                        {(models as Model[]).map((model) => (
                          <div key={model.id}>
                            <button
                              type="button"
                              className={`llm-model-row${selected?.id === model.id ? " selected" : ""}`}
                              disabled={disabled}
                              aria-pressed={selected?.id === model.id}
                              onClick={() => {
                                setSelected(model);
                                setFailure(null);
                              }}
                            >
                              <span className="model-option-name">
                                {model.name || model.id}
                              </span>
                              {capabilities(model) && (
                                <span className="llm-model-caps">
                                  {capabilities(model)}
                                </span>
                              )}
                              <span className="llm-model-meta">
                                <span>{model.id}</span>
                                <span>
                                  {model.release_date?.slice(0, 7)}
                                  {model.source === "catalog"
                                    ? " · 未验证"
                                    : ""}
                                </span>
                              </span>
                            </button>
                            {selected?.id === model.id && (
                              <div className="llm-confirm">
                                <p>
                                  切换到 {model.name || model.id} ·{" "}
                                  {route?.name || routeId}
                                </p>
                                <button
                                  type="button"
                                  className="btn-apply"
                                  disabled={disabled || !!showKey}
                                  onClick={() => void apply()}
                                >
                                  {busy ? "正在试连…" : "试连并切换"}
                                </button>
                                {errorView}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ))
                  )}
                </div>
                {selected &&
                  !matches.some((model) => model.id === selected.id) && (
                    <div className="llm-confirm">
                      <p>切换到 {selected.name || selected.id}</p>
                      <button
                        type="button"
                        className="btn-apply"
                        disabled={disabled || !!showKey}
                        onClick={() => void apply()}
                      >
                        试连并切换
                      </button>
                      {errorView}
                    </div>
                  )}
              </>
            )}
            {(routeId === "custom" || !selected) && errorView}
          </div>
        )}
        {routeError && (
          <div role="alert" className="llm-switch-error">
            {routeError}
            <button
              type="button"
              className="llm-custom-link"
              disabled={disabled || routeLoading}
              onClick={() => setReload((value) => value + 1)}
            >
              重试线路
            </button>
          </div>
        )}
        {!picker && state.configStatus && (
          <div
            id={id("cfg-status")}
            role="status"
            className={state.configStatusClass}
          >
            {state.configStatus}
          </div>
        )}
      </div>
    </Root>
  );
}
