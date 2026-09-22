import { useEffect, useMemo, useState } from 'react';
import { ChatSettings } from '../../chat/components/settings';
import { ChatState, type ChatRuntime, type LlmConfig, type ConfigResult, type Preset } from '../../chat/models/chat';
import { errorText } from '../../shared/models/store';
import type { AppModel } from '../models/app';
import { subagentCatalog } from '../models/subagent-catalog';
import type { SubagentSetup } from '../../../shared/types';

/** Same model page, with a local Portal adapter instead of Heart's HTTP API. */
export function SubagentModelSettings({ app }: { app: AppModel }) {
  const staged = app.subagentFromConnection;
  const [busy, setBusy] = useState(false);
  const [beingPreset, setBeingPreset] = useState<Preset>();
  const [catalogHint, setCatalogHint] = useState('');
  const updateBeingCatalog = (config: LlmConfig) => {
    const catalog = subagentCatalog(config);
    setBeingPreset(catalog.current);
    setCatalogHint(catalog.copyBlockedReason || (catalog.current ? '可使用 Being 当前模型的名称、接口地址和协议；服务端密钥不会自动复制。' : '当前 Being 模型缺少可复用的接口信息，可从列表选择或自定义。'));
    return catalog;
  };
  const [target, setTarget] = useState<"Heart" | "subagent">(app.modelSettingsTarget || "subagent");
  const [visited, setVisited] = useState(() => new Set([app.modelSettingsTarget || "subagent"]));
  const being = useMemo(() => {
    const state = new ChatState();
    let revision = 0;
    const runtime: Pick<ChatRuntime, 'loadLlmConfig' | 'applyConfigChange'> = {
      async loadLlmConfig() {
        const request = ++revision;
        state.configLoading = true;
        state.configStatus = '';
        state.changed();
        try {
          if (!app.snapshot?.settings.hasToken) throw new Error('请先保存 Being 连接，再配置 Being 模型。subagent 可先配置。');
          if (typeof app.api.beingModelConfig !== 'function') throw new Error('客户端接口尚未更新，请重新打开 Desktop。');
          const config = await app.api.beingModelConfig();
          if (request === revision) { state.config = config as LlmConfig; updateBeingCatalog(state.config); }
        } catch (error) { if (request === revision) { state.configStatus = errorText(error); state.configStatusClass = 'error'; } }
        finally { if (request === revision) { state.configLoading = false; state.changed(); } }
      },
      async applyConfigChange(patch) {
        try {
          if (!app.snapshot?.settings.hasToken) throw new Error('请先保存 Being 连接。');
          const result = await app.api.beingModelConfig(patch) as ConfigResult;
          if (result.config) { state.config = result.config; updateBeingCatalog(result.config); }
          state.configStatus = result.ok ? (result.rolled_back ? '已恢复上次可用配置' : '设置已更新') : result.error || '设置未能保存';
          state.configStatusClass = result.ok ? 'success' : 'error';
          return result;
        } catch (error) { state.configStatus = errorText(error); state.configStatusClass = 'error'; return { ok: false }; }
        finally { state.changed(); }
      },
    };
    return { state, runtime, dispose: () => { ++revision; } };
  }, [app]);
  const adapter = useMemo(() => {
    const state = new ChatState();
    let disposed = false, revision = 0, readable = false, configEnabled = false;
    const providers = ['anthropic', 'openai', 'openrouter', 'gemini', 'groq', 'xai', 'portal-custom'];
    let presets: Preset[] = [];
    const runtime: Pick<ChatRuntime, 'loadLlmConfig' | 'applyConfigChange'> = {
      async loadLlmConfig() {
        disposed = false;
        const request = ++revision;
        state.configStatus = "";
        state.configLoading = true;
        state.changed();
        try {
          if (typeof app.api.subagentConfig !== 'function')
            throw new Error('客户端接口尚未更新，请完全退出并重新打开 Desktop 后重试。');
          const config = staged && app.form?.subagentSetup ? app.form.subagentSetup : await app.api.subagentConfig();
          if (disposed || request !== revision) return;
          readable = true;
          configEnabled = staged && typeof app.form?.subagentEnabled === "boolean" ? app.form.subagentEnabled : config.enabled !== false;
          state.config = { enabled: configEnabled, base_url: config.base_url, api: config.api, provider: config.provider === 'google' ? 'gemini' : config.provider, model: config.model, thinking: config.thinking, presets };
          if (app.snapshot?.settings.hasToken) {
            try {
              const beingConfig = await app.api.beingModelConfig() as LlmConfig;
              if (disposed || request !== revision) return;
              const catalog = updateBeingCatalog(beingConfig);
              presets = catalog.presets;
              state.config = { ...state.config, presets };
            } catch { if (!disposed && request === revision) setCatalogHint('暂时无法读取 Being 模型列表，可先添加自定义模型。'); }
          }
        } catch (error) {
          if (!disposed && request === revision) { state.configStatus = errorText(error); state.configStatusClass = 'error'; }
        } finally { if (!disposed && request === revision) { state.configLoading = false; state.changed(); } }
      },
      async applyConfigChange(patch) {
        if (!readable) return { ok: false };
        const input: SubagentSetup = { enabled: typeof patch.enabled === "boolean" ? patch.enabled : (configEnabled || !state.config?.model), ...(patch.base_url ? { base_url: String(patch.base_url), api: String(patch.api || 'openai-completions') } : { base_url: '', api: '' }), provider: patch.base_url ? 'portal-custom' : String(patch.provider || ''), model: String(patch.model || '').trim(), api_key: String(patch.api_key || ''), thinking: String(patch.thinking || 'medium') };
        if (input.enabled !== false && (!providers.includes(input.provider) || !input.model)) {
          state.configStatus = '请选择服务商并填写模型名称。';
          state.changed();
          return { ok: false };
        }
        setBusy(true);
        try {
          if (staged) {
            // Blank means retain an already staged key just as Portal retains a stored key.
            const previous = app.form?.subagentSetup;
            if (!input.api_key && previous?.provider === input.provider && previous?.base_url === input.base_url) input.api_key = previous.api_key;
            app.editForm('subagentSetup', input);
            app.closeSubagentSettings();
          } else {
            if (!app.snapshot) throw new Error('请先连接 Being。');
            const next = await app.api.save({ ...app.snapshot.settings, subagentSetup: input });
            app.applySnapshot(next, true);
            state.config = { enabled: input.enabled !== false, provider: input.provider, model: input.model, thinking: input.thinking, base_url: input.base_url, api: input.api, presets };
            state.configStatus = input.enabled === false ? 'subagent 已关闭，模型配置已保留。' : 'subagent 配置已保存，Portal 已启动。';
            state.configStatusClass = 'success';
            state.changed();
          }
          configEnabled = input.enabled !== false;
          return { ok: true };
        } catch (error) {
          state.configStatus = errorText(error);
          state.configStatusClass = 'error';
          state.changed();
          return { ok: false };
        } finally { if (!disposed) setBusy(false); }
      },
    };
    return { state, runtime, dispose: () => { disposed = true; ++revision; } };
  }, [app, staged]);
  useEffect(() => () => { adapter.dispose(); being.dispose(); }, [adapter, being]);
  const close = () => { if (!busy) app.closeSubagentSettings(); };
  const switchTarget = (value: "Heart" | "subagent") => {
    if (busy) return;
    setTarget(value);
    setVisited(previous => new Set([...previous, value]));
  };
  return <div id="subagent-model-panel">
    <aside id="settings-panel" aria-label="模型设置" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
      <div className="settings-header panel-header">
        <div><div className="settings-title-line"><h2>模型设置</h2></div>
          <p>{target === 'Heart' ? '选择当前 Being 使用的模型' : staged ? '选择 subagent 模型，随连接一起安装与配置' : '配置本机 subagent 使用的模型'}</p>
        </div>
        <button type="button" className="btn-close" aria-label="关闭模型设置" disabled={busy} onClick={close}>✕</button>
      </div>
      <div className="model-target-header"><div className="toggle-group model-targets" role="tablist" aria-label="模型配置对象">
        {(['Heart', 'subagent'] as const).map(value => <button key={value} type="button" role="tab" id={`model-tab-${value}`} aria-controls={`model-content-${value}`} aria-selected={target === value} className={target === value ? 'active' : ''} disabled={busy} onClick={() => switchTarget(value)}>{value === 'Heart' ? 'Being 模型' : 'subagent'}</button>)}
      </div></div>
      {(['Heart', 'subagent'] as const).map(value => <div key={value} id={`model-content-${value}`} role="tabpanel" aria-labelledby={`model-tab-${value}`} className="model-target-content" hidden={target !== value}>
        {visited.has(value) && <ChatSettings state={value === 'Heart' ? being.state : adapter.state} runtime={value === 'Heart' ? being.runtime : adapter.runtime}
          copyPreset={value === 'subagent' ? beingPreset : undefined} catalogHint={value === 'subagent' ? catalogHint : undefined}
          open contentOnly target={value} staged={value === 'subagent' && staged} close={close} onBusy={setBusy} />}
      </div>)}
    </aside>
  </div>;
}
