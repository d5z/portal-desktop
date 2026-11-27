import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { weixinAutoChannelPath, type ConnectorContext, type ConnectorResources, type WeixinAutoChannel, type WeixinAutoChannelSettings } from '../../../shared/connector-resources';
import { publicErrorMessage } from '../../../shared/errors';

const labels: Record<WeixinAutoChannel['state'], string> = {
  starting: '正在启动自动收发', running: '自动收发中', stopped: '自动收发已停止',
  reauth_required: '需重新连接微信', error: '自动收发异常',
};

interface ChannelScope {
  signal: AbortSignal;
  context?: ConnectorContext;
  reading?: Promise<void>;
  writing: boolean;
  initialized: boolean;
  unavailable: boolean;
}

export function WeixinAutoChannelSettingsCard({ resources, connectionId, installationId, profileId, canInitialize, busy, onToolsChanged, onReconnect }: {
  resources: ConnectorResources;
  connectionId: string;
  installationId: string;
  profileId?: string;
  canInitialize: boolean;
  busy: boolean;
  onToolsChanged: () => void;
  onReconnect: () => void;
}) {
  const path = weixinAutoChannelPath(connectionId);
  const scopeRef = useRef<ChannelScope | undefined>(undefined);
  const [channel, setChannel] = useState<WeixinAutoChannel>();
  const [readError, setReadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [saving, setSaving] = useState(false);

  const readStatus = useEffectEvent(async (scope: ChannelScope) => {
    const { signal } = scope;
    try {
      const context = scope.context ??= await resources.context();
      if (signal.aborted) return;
      const next = await resources.request<WeixinAutoChannel>(context, path, 'GET', undefined, signal);
      if (signal.aborted) return;
      setReadError('');
      if (next.state === 'stopped' && !next.binding_id && !scope.initialized && !scope.writing && !busy && canInitialize && profileId) {
        scope.initialized = true;
        const body = { enabled: true, profile_id: profileId, installation_id: installationId, initialize_only: true } satisfies WeixinAutoChannelSettings;
        try {
          const initialized = await resources.request<WeixinAutoChannel>(context, path, 'PUT', body, signal);
          if (!signal.aborted) { setChannel(initialized); onToolsChanged(); }
        } catch (error) {
          if (!signal.aborted) {
            setChannel(next);
            setActionError(`初始化自动收发失败。${publicErrorMessage(error, '可以手动开启。')}`);
          }
        }
      } else setChannel(next);
    } catch (error) {
      if (signal.aborted) return;
      const status = error instanceof Error && 'status' in error ? error.status : undefined;
      if (status === 404 || status === 405) {
        scope.unavailable = true;
        setChannel(undefined);
        setActionError('');
        setReadError('当前客户端或 Home 环境未提供自动收发接口，请确认环境并重启客户端。');
      } else setReadError(`无法读取自动收发状态。${publicErrorMessage(error, '请稍后重试。')}`);
    }
  });

  useEffect(() => {
    const controller = new AbortController();
    const scope: ChannelScope = { signal: controller.signal, initialized: false, writing: false, unavailable: false };
    scopeRef.current = scope;
    const refresh = () => {
      if (scope.signal.aborted || scope.unavailable || scope.reading || scope.writing || document.hidden) return;
      scope.reading = readStatus(scope).finally(() => { scope.reading = undefined; });
    };
    refresh();
    const interval = window.setInterval(refresh, 5000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [resources, connectionId, installationId]);

  const changeEnabled = async (enabled: boolean) => {
    const scope = scopeRef.current;
    if (!scope || scope.signal.aborted || scope.writing || !scope.context || !profileId || !channel) return;
    scope.writing = true;
    scope.initialized = true;
    setSaving(true);
    setActionError('');
    const { context, signal } = scope;
    try {
      await scope.reading;
      if (signal.aborted || scope.unavailable) return;
      const body = { enabled, profile_id: profileId, installation_id: installationId } satisfies WeixinAutoChannelSettings;
      const next = await resources.request<WeixinAutoChannel>(context, path, 'PUT', body, signal);
      if (!signal.aborted) { setChannel(next); setReadError(''); onToolsChanged(); }
    } catch (error) {
      if (!signal.aborted) setActionError(`未能确认自动收发设置。${publicErrorMessage(error, '请稍后查看实际状态。')}`);
    } finally {
      scope.writing = false;
      if (!signal.aborted) setSaving(false);
    }
  };

  if (!channel && !readError) return null;
  return <section className="connector-info-section" aria-label="自动收发">
    <h4>自动收发</h4>
    <div className="connector-app-summary connector-auto-channel">
      <div className="connector-auto-channel-copy">
        {channel && <>
          <strong role="status">{labels[channel.state]}</strong>
          {channel.state === 'running' && <small>可以向此 Bot 发送新消息。关闭客户端后仍会在后台运行。</small>}
          {channel.state === 'starting' && <small>请等待状态变为运行中后再发送测试消息。</small>}
          {channel.state === 'error' && <small>请检查连接和错误详情。自动收发不会从客户端重发旧消息。</small>}
          {channel.error_code && <small>错误代码 {channel.error_code}</small>}
        </>}
        {readError && <p className="form-error" role="alert">{readError}</p>}
        {actionError && <p className="form-error" role="alert">{actionError}</p>}
      </div>
      {channel && <div className="connector-auto-channel-actions">
        {channel.state === 'reauth_required' && <button type="button" disabled={busy || saving} onClick={onReconnect}>重新连接微信</button>}
        <button className={channel.enabled ? 'secondary' : 'primary'} type="button"
          disabled={busy || saving || !profileId || !!readError || (!channel.enabled && channel.state === 'reauth_required')}
          aria-busy={saving} onClick={() => void changeEnabled(!channel.enabled)}>{saving ? '正在保存…' : channel.enabled ? '停止自动收发' : '开启自动收发'}</button>
      </div>}
    </div>
  </section>;
}
