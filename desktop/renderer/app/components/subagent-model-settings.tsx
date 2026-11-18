import { WorkspaceDrawer } from '../../shared/components/workspace-drawer';
import type { SettingsDetail } from '../../shared/components/settings-surface';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanelResizeHandle, usePanelWidth } from '../../shared/components/panel-resize';
import { ChatSettings } from '../../chat/components/settings';
import { ChatState, type ChatRuntime, type ConfigResult, type LlmConfig } from '../../chat/models/chat';
import { errorText } from '../../shared/models/store';
import type { SubagentSetup, SubagentStatus } from '../../../shared/types';
import type { AppModel } from '../models/app';
import { beingModelRequest } from '../services/being-model-network';

export function SubagentModelSettings({ app, embedded = false, onBusyChange, onDetailChange, detailOpen: _detailOpen = false }: {
  app: AppModel;
  embedded?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onDetailChange?: (detail: SettingsDetail | null) => void;
  detailOpen?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = usePanelWidth('being', 320);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<'Heart' | 'subagent'>('Heart');
  const [mode, setMode] = useState<'inherit' | 'custom'>('inherit');
  const [status, setStatus] = useState<SubagentStatus | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [custom, setCustom] = useState<SubagentSetup>({ provider: 'portal-custom', model: '', base_url: '', api: 'openai-completions', api_key: '', thinking: 'medium' });
  useEffect(() => { closeButton.current?.focus(); }, []);
  useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  const refreshStatus = useCallback(async () => {
    if (!app.api.subagentStatus) throw new Error('状态接口尚未加载，请重启客户端以加载更新。');
    const next = await app.api.subagentStatus();
    setStatus(next);
    return next;
  }, [app]);
  useEffect(() => {
    let active = true;
    void Promise.all([app.api.subagentConfig(), refreshStatus()]).then(([config, next]) => {
      if (!active) return;
      setMode(next.inheritModel ? 'inherit' : 'custom');
      setCustom({ ...config, provider: config.provider || 'portal-custom', api: config.api || 'openai-completions', api_key: '' });
    }).catch(error => { if (active) setError(errorText(error)); });
    const refresh = () => { void refreshStatus().catch(error => { if (active) setError(errorText(error)); }); };
    const unsubscribeTasks = app.api.onSceneTasks?.(refresh);
    const unsubscribePortal = app.api.onPortal?.(refresh);
    return () => { active = false; unsubscribeTasks?.(); unsubscribePortal?.(); };
  }, [app, refreshStatus]);

  const endpoint = app.snapshot?.settings.endpoint;
  const being = useMemo(() => {
    const state = new ChatState();
    let revision = 0;
    const runtime: Pick<ChatRuntime, 'loadLlmConfig' | 'applyConfigChange'> & Partial<Pick<ChatRuntime, 'request'>> = {
      request: async (path: string, init?: RequestInit) => {
        const url = new URL(path, 'https://local.invalid');
        const kind = url.pathname.split('/').pop() as 'routes' | 'models' | 'keys';
        if (!['routes', 'models', 'keys'].includes(kind)) throw new Error('不支持的模型接口。');
        const query = kind === 'models' && url.searchParams.get('route') ? `?route=${encodeURIComponent(url.searchParams.get('route')!)}` : '';
        return beingModelRequest(endpoint, `/api/llm/${kind}${query}`, { ...init, method: kind === 'keys' ? 'POST' : 'GET' });
      },
      async loadLlmConfig() {
        const request = ++revision;
        state.configLoading = true;
        state.configStatus = '';
        state.changed();
        try {
          if (!app.snapshot?.settings.hasToken) throw new Error('请先保存 Being 连接。');
          const response = await beingModelRequest(endpoint, '/api/llm/config');
          const config = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(config.error || '无法读取 Being 模型配置。');
          if (request === revision) state.config = config as LlmConfig;
        } catch (error) {
          if (request === revision) { state.configStatus = errorText(error); state.configStatusClass = 'error'; }
        } finally {
          if (request === revision) { state.configLoading = false; state.changed(); }
        }
      },
      async applyConfigChange(patch) {
        try {
          if (!app.snapshot?.settings.hasToken) throw new Error('请先保存 Being 连接。');
          const response = await beingModelRequest(endpoint, '/api/llm/config', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
          });
          const data = await response.json().catch(() => ({}));
          const result = { ...data, ...(!response.ok ? { ok: false, http_status: data.http_status || response.status } : {}) } as ConfigResult;
          if (result.config) state.config = result.config;
          state.configStatus = result.ok ? (result.rolled_back ? '已恢复上次可用配置' : 'Being 模型已更新') : result.error || '设置未能保存';
          state.configStatusClass = result.ok ? 'success' : 'error';
          return result;
        } catch (error) {
          state.configStatus = errorText(error);
          state.configStatusClass = 'error';
          return { ok: false };
        } finally { state.changed(); }
      },
    };
    return { state, runtime, dispose: () => { ++revision; } };
  }, [app, endpoint]);

  useEffect(() => () => being.dispose(), [being]);
  const close = () => { if (!busy) app.closeSubagentSettings(); };
  const save = async () => {
    if (busy || !app.snapshot) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const next = await app.api.save({ ...app.snapshot.settings,
        ...(mode === 'custom' ? { subagentSetup: custom, subagentInherit: false } : { subagentInherit: true }) });
      app.applySnapshot(next, true);
      setCustom(current => ({ ...current, api_key: '' }));
      await refreshStatus();
      setNotice('模型验证成功，已应用并重启 Portal。');
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  };
  const updateCustom = (patch: Partial<SubagentSetup>) => setCustom(current => ({ ...current, ...patch }));
  const Panel = embedded ? 'div' : WorkspaceDrawer;
  return <Panel id="subagent-model-panel" ref={panel} className={embedded ? 'embedded-model-settings' : undefined} style={embedded ? undefined : { width, flexBasis: width }}>
    {!embedded && <PanelResizeHandle panel={panel} label="调整模型设置宽度" width={width} onResize={setWidth} initial={320} min={240} max={640} reserve={396} />}
    <aside id="settings-panel" aria-label="模型设置" onKeyDown={event => { if (!embedded && event.key === 'Escape') { event.stopPropagation(); close(); } }}>
      <div className="settings-header panel-header" hidden={embedded}>
        <div><div className="settings-title-line"><h2>模型设置</h2></div><p>Being 与 subagent 模型</p></div>
        <button ref={closeButton} type="button" className="btn-close" aria-label="关闭模型设置" disabled={busy} onClick={close}>✕</button>
      </div>
      {(error || status && status.health !== 'ok') && <section className="subagent-health-status error" aria-label="subagent 状态" role="alert">
        <strong>{error ? 'subagent 配置未应用' : 'subagent 配置出错'}</strong>
        <p>{error || status?.message}</p>
        <button type="button" className="text-button" disabled={busy} onClick={() => setTarget('subagent')}>重新配置</button>
      </section>}
      <div className="toggle-group model-targets" role="group" aria-label="模型配置对象">
        <button type="button" className={target === 'Heart' ? 'active' : ''} aria-pressed={target === 'Heart'} disabled={busy} onClick={() => setTarget('Heart')}>Being 模型</button>
        <button type="button" className={target === 'subagent' ? 'active' : ''} aria-pressed={target === 'subagent'} disabled={busy} onClick={() => setTarget('subagent')}>subagent</button>
      </div>
      <div hidden={target !== 'Heart'}><ChatSettings state={being.state} runtime={being.runtime} onDetailChange={target === 'Heart' ? onDetailChange : undefined}
        open contentOnly target="Heart" staged={false} pending={false} close={close} onBusy={setBusy} /></div>
      <form hidden={target !== 'subagent'} className="subagent-custom-editor" aria-label="subagent 配置" onSubmit={event => { event.preventDefault(); void save(); }}>
        <label className="field-label" htmlFor="subagent-source">模型来源</label>
        <select id="subagent-source" className="field-input" value={mode} onChange={event => { setMode(event.target.value as typeof mode); setNotice(''); }} disabled={busy}>
          <option value="inherit">自部署模型（默认）</option><option value="custom">自定义 subagent</option>
        </select>
        <p className="field-help">{mode === 'inherit' ? '使用 glm5.3flash，通过当前 Being 连接自动认证，无需填写模型密钥。' : '只影响 subagent，不改动 Being 模型。密钥留空时，沿用本机为同一 Being、同一接口保存的密钥。'}</p>
        {mode === 'custom' && <>
          <label className="field-label" htmlFor="subagent-custom-provider">服务商</label>
          <select id="subagent-custom-provider" className="field-input" value={custom.provider || 'portal-custom'} onChange={event => updateCustom({ provider: event.target.value, api_key: '' })} disabled={busy}>
            {['portal-custom', 'openrouter', 'openai', 'anthropic', 'google', 'groq', 'xai'].map(value => <option key={value} value={value}>{value === 'portal-custom' ? '自定义接口' : value}</option>)}
          </select>
          <label className="field-label" htmlFor="subagent-custom-model">模型名称</label>
          <input id="subagent-custom-model" className="field-input" required value={custom.model} onChange={event => updateCustom({ model: event.target.value })} disabled={busy} />
          {custom.provider === 'portal-custom' && <>
            <label className="field-label" htmlFor="subagent-custom-url">接口地址</label>
            <input id="subagent-custom-url" className="field-input" required type="url" value={custom.base_url || ''} onChange={event => updateCustom({ base_url: event.target.value, api_key: '' })} disabled={busy} spellCheck={false} />
            <label className="field-label" htmlFor="subagent-custom-api">接口协议</label>
            <select id="subagent-custom-api" className="field-input" value={custom.api || 'openai-completions'} onChange={event => updateCustom({ api: event.target.value })} disabled={busy}>
              {['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'].map(value => <option key={value}>{value}</option>)}
            </select>
          </>}
          <label className="field-label" htmlFor="subagent-custom-key">API 密钥</label>
          <input id="subagent-custom-key" className="field-input" type="password" autoComplete="off" placeholder="输入新密钥；留空沿用同接口凭据" value={custom.api_key} onChange={event => updateCustom({ api_key: event.target.value })} disabled={busy} />
          <label className="field-label" htmlFor="subagent-custom-thinking">思考强度</label>
          <select id="subagent-custom-thinking" className="field-input" value={custom.thinking} onChange={event => updateCustom({ thinking: event.target.value })} disabled={busy}>
            {['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map(value => <option key={value}>{value}</option>)}
          </select>
        </>}
        <p className="field-help">先验证模型调用，成功后应用并重启 Portal；失败时保留原配置。运行中的任务可能中断。</p>
        <div className="settings-actions"><button type="submit" className="btn-apply" disabled={busy || !status}>{busy ? '正在验证并应用…' : '验证并应用 subagent 配置'}</button></div>
        {notice && <p role="status">{notice}</p>}
      </form>
    </aside>
  </Panel>;
}
