import { useEffect, useRef, useState } from "react";
import type { ChatRuntime, ChatState, Preset } from "../models/chat";
import { useModel } from "../../shared/hooks/use-model";
import { NavigationControls } from "../../shared/components/navigation-controls";

const baseUrls: Record<string, string> = {
  anthropic: "https://api.anthropic.com",
  "openai-responses": "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com",
  kimi: "https://api.moonshot.cn/v1",
  google: "https://generativelanguage.googleapis.com",
  // Canonical self-hosted endpoint from loom-local a18812c (inferBaseUrl).
  "self-hosted": "http://115.190.110.33:7860/v1",
};
const providerNames: Record<string, string> = {
  anthropic: "Anthropic",
  "openai-responses": "OpenAI",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  kimi: "Kimi",
  google: "Google",
  gemini: "Google Gemini",
  groq: "Groq",
  xai: "xAI",
  glm: "智谱",
  openrouter: "OpenRouter",
  "self-hosted": "自部署",
  "portal-custom": "自定义接口",
};
const thinkingOptions = [
  ["off", "关闭"],
  ["low", "低"],
  ["medium", "中"],
  ["high", "高"],
];
interface ModelDraft {
  preset: Preset;
  route: "official" | "openrouter";
  model: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  api?: string;
}

export function ChatSettings({
  state,
  runtime,
  open,
  close,
  back,
  target = "Heart",
  onTarget,
  staged = false,
  contentOnly = false,
  onBusy,
  copyPreset,
  catalogHint,
  mobilePage = false,
}: {
  state: ChatState;
  runtime: Pick<ChatRuntime, "loadLlmConfig" | "applyConfigChange">;
  open: boolean;
  close: () => void;
  back?: () => void;
  target?: "Heart" | "subagent";
  onTarget?: (target: "Heart" | "subagent") => void;
  staged?: boolean;
  contentOnly?: boolean;
  onBusy?: (busy: boolean) => void;
  copyPreset?: Preset;
  catalogHint?: string;
  mobilePage?: boolean;
}) {
  useModel(state);
  const subagent = target === "subagent";
  const fieldId = (name: string) => contentOnly ? `${target}-${name}` : name;
  const [thinking, setThinking] = useState("medium");
  const [draft, setDraft] = useState<ModelDraft | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(""),
    [temperature, setTemperature] = useState(1);
  const keyInput = useRef<HTMLInputElement>(null),
    closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) {
      void runtime.loadLlmConfig();
      closeButton.current?.focus();
    } else {
      setDraft(null);
      setError("");
      setQuery("");
    }
  }, [open, runtime]);
  useEffect(
    () => setTemperature(state.config.temperature ?? 1),
    [state.config.temperature],
  );
  const presets = Array.isArray(state.config.presets)
    ? state.config.presets
    : [];
  const current = state.config.model ? presets.find(
    (p) =>
      p.model === state.config.model &&
      (!state.config.provider || p.provider === state.config.provider),
  ) : undefined;
  const provider = state.config.provider || current?.provider;
  const search = query.trim().toLocaleLowerCase();
  const groups = new Map<string, Preset[]>();
  for (const preset of presets.filter(
    (p) =>
      p !== current &&
      [p.label, p.model, p.provider, providerNames[p.provider] || ""]
        .join(" ")
        .toLocaleLowerCase()
        .includes(search),
  )) {
    groups.set(preset.provider, [
      ...(groups.get(preset.provider) || []),
      preset,
    ]);
  }
  const disabled = busy || state.configLoading;
  useEffect(() => { onBusy?.(busy); }, [busy, onBusy]);
  const Root = contentOnly ? "section" : "aside";
  function select(preset: Preset) {
    if (disabled) return;
    if (preset.provider === "self-hosted" && !subagent) {
      void selectSelfHosted(preset);
      return;
    }
    setError("");
    setThinking(state.config.thinking || "medium");
    setDraft({
      preset,
      model: preset.model,
      provider: subagent && preset.base_url ? "portal-custom" : preset.provider,
      baseUrl: preset.base_url || baseUrls[preset.provider] || "",
      api: preset.api || "openai-completions",
      apiKey: "",
      route: "official",
    });
  }
  async function selectSelfHosted(preset: Preset) {
    setBusy(true);
    setDraft(null);
    setError("");
    try {
      await runtime.applyConfigChange({
        model: preset.model,
        provider: preset.provider,
        base_url: baseUrls["self-hosted"],
      });
      // applyConfigChange owns the confirmed config and error status.
      // Never promote a failed or rolled-back switch to the current model.
    } finally {
      setBusy(false);
    }
  }
  const custom = draft?.preset.id === "__custom";
  const update = (patch: Partial<ModelDraft>) =>
    setDraft((value) => (value ? { ...value, ...patch } : value));
  async function apply() {
    if (!draft || disabled) return;
    const model = (
      draft.route === "openrouter"
        ? `${draft.preset.provider}/${draft.preset.model}`
        : draft.model
    ).trim();
    if (!model || (subagent && !draft.provider)) {
      setError(subagent ? "请选择服务商并填写模型名称。" : "请填写模型名称。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await runtime.applyConfigChange({
        model,
        ...(draft.provider.trim() ? { provider: draft.provider.trim() } : {}),
        ...((!subagent || draft.provider === "portal-custom") && draft.baseUrl.trim() ? { base_url: draft.baseUrl.trim() } : {}),
        ...(subagent && draft.provider === "portal-custom" ? { api: draft.api || "openai-completions" } : {}),
        ...(subagent ? { thinking } : {}),
        ...(draft.apiKey.trim() ? { api_key: draft.apiKey.trim() } : {}),
      });
      if (result?.needs_key) {
        setError(result.error || "请填写该服务商的 API 密钥。");
        keyInput.current?.focus();
      } else if (result?.ok) setDraft(null);
      else setError(state.configStatus || "切换失败，请检查连接设置后重试。");
    } finally {
      setBusy(false);
    }
  }
  async function patch(value: Record<string, string | number>) {
    if (disabled) return;
    setBusy(true);
    try {
      await runtime.applyConfigChange(value);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Root
      id={contentOnly ? undefined : "settings-panel"}
      className={contentOnly ? "model-settings-content" : `side-panel${open ? " active" : ""}`}
      inert={!open}
      aria-hidden={!open}
      aria-label="模型设置"
      data-mobile-page={mobilePage || undefined}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          if (!disabled) close();
        }
      }}
    >
      {!contentOnly && <div className="settings-header panel-header">
        <div className="settings-heading-copy">
          <div className="settings-title-line">
            <h2 id={fieldId("settings-title")} >模型设置</h2>
            {!mobilePage && <NavigationControls back={disabled ? undefined : back} />}
          </div>
          <p>{subagent ? (staged ? "选择 subagent 模型，随连接一起安装与配置" : "配置本机 subagent 使用的模型") : "选择当前 Being 使用的模型"}</p>
        </div>
        <button
          ref={closeButton}
          className="btn-close"
          type="button"
          aria-label={mobilePage ? '返回对话' : '关闭模型设置'}
          onClick={close}
          disabled={disabled}
        >
          {mobilePage ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m15 5-7 7 7 7" /></svg> : '✕'}
        </button>
      </div>
      }
      <div className="settings-body" aria-busy={disabled}>
        {onTarget && <div className="toggle-group model-targets" role="group" aria-label="模型配置对象">
          {(["Heart", "subagent"] as const).map(value => <button key={value} type="button" className={target === value ? "active" : ""} aria-pressed={target === value} disabled={disabled || (staged && value === "Heart")} title={staged && value === "Heart" ? "完成连接后可配置 Being 模型" : undefined} onClick={() => { if (value !== target) onTarget(value); }}>{value === "Heart" ? "Being 模型" : value}</button>)}
        </div>}
        {subagent && state.config.enabled === false && <div className="subagent-disabled-notice" role="status">
          <strong>subagent 尚未启用</strong>
          <p>可先配置模型。请在连接设置中打开「启用 subagent」并保存，启用后 Being 才能委派后台任务。</p>
        </div>}
        <div id={fieldId("llm-step1")}  hidden={!!draft}>
          {subagent && <div className="subagent-copy-being">
            <button type="button" className="btn-apply" disabled={disabled || !copyPreset} onClick={() => { if (copyPreset) select(copyPreset); }}>使用 Being 当前模型</button>
            {catalogHint && <p className="hint">{catalogHint}</p>}
          </div>}
          <section
            id={fieldId("llm-current")}
            className={`llm-current${subagent && state.config.enabled === false ? " is-disabled" : ""}`}
            aria-label="当前模型"
          >
            <div className="current-model-caption">
              <span className="model-indicator" />
              {subagent && state.config.enabled === false ? "未启用" : staged ? "待保存配置" : "当前使用"}
            </div>
            <h3 className="model-name">
              {current?.label ||
                state.config.model ||
                (state.configLoading ? "正在读取模型…" : "尚未配置模型")}
            </h3>
            {state.config.model && (
              <div className="model-detail">
                {providerNames[provider || ""] || provider || "自定义"}
                <span> / </span>
                {state.config.model}
              </div>
            )}
            {subagent && state.config.model && <button type="button" className="llm-custom-link" disabled={disabled} onClick={() => select({ id: "__custom", provider: state.config.provider || "", model: state.config.model || "", base_url: state.config.base_url, api: state.config.api, label: "编辑 subagent 模型" })}>编辑配置</button>}
          </section>

          <section
            className="model-catalog"
            aria-labelledby={fieldId("model-catalog-title")}
          >
            <div className="settings-section-heading">
              <h3 id={fieldId("model-catalog-title")} >切换模型</h3>
              <button
                className="llm-custom-link"
                type="button"
                disabled={disabled}
                onClick={() =>
                  select({
                    id: "__custom",
                    label: "自定义模型",
                    model: "",
                    provider: "",
                  })
                }
              >
                <span aria-hidden="true">＋</span> 自定义
              </button>
            </div>
            <div className="model-search">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                aria-hidden="true"
              >
                <circle cx="10.5" cy="10.5" r="6.5" />
                <path d="m16 16 4.5 4.5" />
              </svg>
              <input
                type="search"
                aria-label="搜索模型"
                placeholder="搜索模型或服务商"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div id={fieldId("llm-preset-list")}  className="llm-list">
              {[...groups].sort(([a], [b]) => a === b ? 0 : a === "self-hosted" ? -1 : b === "self-hosted" ? 1 : 0).map(([name, items]) => (
                <div className="provider-group" key={name}>
                  <div className="provider-group-label">
                    {providerNames[name] || name}
                  </div>
                  <div className="provider-items">
                    {items.map((preset) => (
                      <button
                        key={preset.id}
                        className="llm-item"
                        type="button"
                        disabled={disabled}
                        onClick={() => select(preset)}
                      >
                        <span className="model-option-name">
                          {preset.label}
                        </span>
                        <span className="model-option-detail">
                          {subagent ? "选择此模型" : preset.provider === "self-hosted"
                            ? "无需密钥 · 点击切换"
                            : preset.has_key === false
                            ? "需配置密钥"
                            : "选择此模型"}
                          <span aria-hidden="true">↗</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {!groups.size && (
                <p className="model-empty">
                  {state.configLoading
                    ? "正在读取可用模型…"
                    : search
                      ? "没有匹配的模型，试试其他名称。"
                      : "暂无其他预设，可添加自定义模型。"}
                </p>
              )}
            </div>
          </section>

          {!subagent && <details className="model-parameters">
            <summary>
              <span>生成参数</span>
              <span className="parameter-summary">
                思考 ·{" "}
                {thinkingOptions.find(
                  ([value]) => value === (state.config.thinking || "medium"),
                )?.[1] || state.config.thinking}
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <path d="m7 10 5 5 5-5" />
                </svg>
              </span>
            </summary>
            <div className="model-parameter">
              <div className="parameter-heading">
                <span>思考强度</span>
                <span className="parameter-hint">平衡响应速度与思考深度</span>
              </div>
              <div
                className="toggle-group"
                id={fieldId("cfg-thinking")}
                role="group"
                aria-label="思考强度"
              >
                {thinkingOptions.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    data-val={value}
                    className={
                      (state.config.thinking || "medium") === value
                        ? "active"
                        : ""
                    }
                    aria-pressed={(state.config.thinking || "medium") === value}
                    disabled={disabled}
                    onClick={() => void patch({ thinking: value })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="model-parameter">
              <div className="parameter-heading">
                <label htmlFor={fieldId("cfg-temperature")} >回答随机性</label>
                <output id={fieldId("cfg-temperature-val")}  htmlFor={fieldId("cfg-temperature")} >
                  {temperature.toFixed(1)}
                </output>
              </div>
              <div className="slider-row">
                <input
                  type="range"
                  id={fieldId("cfg-temperature")}
                  min="0"
                  max="1"
                  step="0.1"
                  value={temperature}
                  disabled={disabled}
                  onChange={(event) =>
                    setTemperature(Number(event.target.value))
                  }
                  onPointerUp={(event) =>
                    void patch({
                      temperature: Number(event.currentTarget.value),
                    })
                  }
                  onKeyUp={(event) => {
                    if (
                      [
                        "ArrowLeft",
                        "ArrowRight",
                        "ArrowUp",
                        "ArrowDown",
                        "Home",
                        "End",
                      ].includes(event.key)
                    )
                      void patch({
                        temperature: Number(event.currentTarget.value),
                      });
                  }}
                />
              </div>
              <div className="parameter-scale">
                <span>更稳定</span>
                <span>更多变化</span>
              </div>
            </div>
          </details>}
          {!subagent && <button
            className="btn-rollback"
            type="button"
            disabled={disabled}
            onClick={() => void patch({ rollback: "true" })}
          >
            <span aria-hidden="true">↶</span> 恢复上次可用配置
          </button>}
        </div>

        {draft && (
          <div
            id={fieldId("llm-step2")}
            aria-labelledby={fieldId("step2-title")}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                event.target instanceof HTMLInputElement &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void apply();
              }
            }}
          >
            <button
              className="step2-back"
              type="button"
              disabled={busy}
              onClick={() => {
                setDraft(null);
                setError("");
              }}
              aria-label="返回模型列表"
            >
              ← 返回模型列表
            </button>
            <div className="model-form-heading">
              <h3 id={fieldId("step2-title")} >{draft.preset.label}</h3>
              <p>
                {subagent ? "模型与接口已带入。需要认证时请填写密钥；仅同一接口的本机已有密钥可留空沿用。" : custom
                  ? "填写模型名称及服务商的连接信息。"
                  : "确认连接方式后，应用到当前 Being。"}
              </p>
            </div>
            <div
              className="settings-section"
              id={fieldId("s2-model-section")}
              hidden={!custom && !subagent}
            >
              <label className="field-label" htmlFor={fieldId("s2-model")} >
                模型名称
              </label>
              <input
                id={fieldId("s2-model")}
                className="field-input"
                placeholder="服务商提供的模型 ID"
                value={draft.model}
                onChange={(event) => update({ model: event.target.value })}
                disabled={disabled}
                autoComplete="off"
              />
            </div>
            <div
              className="settings-section"
              id={fieldId("s2-route-section")}
              hidden={custom || subagent}
            >
              <span className="field-label">连接方式</span>
              <div
                className="toggle-group"
                id={fieldId("s2-route")}
                role="group"
                aria-label="连接方式"
              >
                {(["official", "openrouter"] as const).map((route) => (
                  <button
                    type="button"
                    key={route}
                    data-val={route}
                    className={draft.route === route ? "active" : ""}
                    aria-pressed={draft.route === route}
                    disabled={disabled}
                    onClick={() =>
                      update({
                        route,
                        apiKey: route === draft.route ? draft.apiKey : "",
                        provider:
                          route === "openrouter"
                            ? "openrouter"
                            : draft.preset.provider,
                        baseUrl:
                          route === "openrouter"
                            ? "https://openrouter.ai/api/v1"
                            : baseUrls[draft.preset.provider] || "",
                      })
                    }
                  >
                    {route === "official" ? "服务商直连" : "OpenRouter"}
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-section">
              <label className="field-label" htmlFor={fieldId("s2-provider")} >
                服务商
              </label>
              {subagent ? <select id={fieldId("s2-provider")}  className="field-input" value={draft.provider} disabled={disabled} onChange={event => update({ provider: event.target.value, apiKey: "" })}>
                <option value="" disabled>选择服务商</option>
                {["anthropic", "openai", "openrouter", "gemini", "groq", "xai", "portal-custom"].map(value => <option key={value} value={value}>{value === "portal-custom" ? "自定义接口" : providerNames[value] || value}</option>)}
              </select> : <input
                id={fieldId("s2-provider")}
                className="field-input"
                placeholder="例如 openai-responses"
                readOnly={!custom}
                value={draft.provider}
                disabled={disabled}
                onChange={(event) => update({ provider: event.target.value })}
                autoComplete="off"
              />}
            </div>
            <div className="settings-section" hidden={subagent && draft.provider !== "portal-custom"}>
              <label className="field-label" htmlFor={fieldId("s2-base-url")} >
                接口地址
              </label>
              <input
                id={fieldId("s2-base-url")}
                className="field-input"
                placeholder="https://…"
                readOnly={!custom && !subagent}
                value={draft.baseUrl}
                disabled={disabled}
                onChange={(event) => update({ baseUrl: event.target.value })}
                spellCheck={false}
                autoComplete="off"
              />
            </div>
            <div className="settings-section">
              <label className="field-label" htmlFor={fieldId("s2-api-key")} >
                API 密钥
              </label>
              <input
                ref={keyInput}
                id={fieldId("s2-api-key")}
                className="field-input"
                type="password"
                autoComplete="off"
                placeholder="输入 API 密钥"
                value={draft.apiKey}
                disabled={disabled}
                onChange={(event) => update({ apiKey: event.target.value })}
              />
              <p id={fieldId("s2-key-hint")}  className="hint">
                {subagent ? "Being 服务端密钥不会自动复制。同一接口的本机已有密钥可留空沿用；无认证接口可不填。" : custom || draft.route === "openrouter"
                  ? "填写服务商提供的密钥；已有密钥时可留空。"
                  : draft.preset.has_key === false
                    ? "此服务商尚未配置密钥，请填写后应用。"
                    : draft.preset.has_key
                      ? "已配置密钥，留空则继续使用。"
                      : "如需更新密钥，可在此填写。"}
              </p>
            </div>
            {subagent && draft.provider === 'portal-custom' && <div className="settings-section">
              <label className="field-label" htmlFor={fieldId('s2-api')}>接口协议</label>
              <select id={fieldId('s2-api')} className="field-input" value={draft.api} disabled={disabled} onChange={event => update({ api: event.target.value })}>
                {['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'].map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </div>}
            {subagent && <div className="settings-section">
              <label className="field-label" htmlFor={fieldId("subagent-thinking")} >思考强度</label>
              <select id={fieldId("subagent-thinking")}  className="field-input" value={thinking} disabled={disabled} onChange={event => setThinking(event.target.value)}>
                {["off", "minimal", "low", "medium", "high", "xhigh", "max"].map(value => <option key={value} value={value}>{value}</option>)}
              </select>
              <p className="hint">{staged ? "返回后点击保存、连接并启动，才会安装并保存配置。" : "保存后自动重启 Portal，无需重启 Desktop；运行中的任务可能中断。"}安装需要本机 npm。</p>
            </div>}
            {error && (
              <div id={fieldId("s2-error")}  className="step2-error" role="alert">
                {error}
              </div>
            )}
            <button
              id={fieldId("s2-apply")}
              type="button"
              className="btn-apply"
              disabled={disabled}
              onClick={() => void apply()}
            >
              {busy ? "正在应用…" : subagent && staged ? "使用此配置并返回" : "保存并使用"}
            </button>
          </div>
        )}
        {state.configStatus && !draft && (
          <div
            id={fieldId("cfg-status")}
            className={state.configStatusClass}
            role="status"
          >
            {state.configStatus}
          </div>
        )}
      </div>
    </Root>
  );
}
