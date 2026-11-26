import { useEffect, useState } from 'react';
import type { WorkAgentConnection } from '../../../shared/work-executor';
import { Icon } from '../../shared/icons/icon';
import { SettingsItem } from '../../shared/components/settings-surface';
import type { AppModel } from '../models/app';
import { WorkExecutorMark } from './work-executor-mark';
import styles from './work-agent-settings.module.scss';

function connectionStatus(agent: WorkAgentConnection) {
  if (agent.diagnostic === 'error') return { label: '连接失败', tone: 'error' };
  if (!agent.available) return { label: '未就绪', tone: 'muted' };
  if (agent.enabled === false) return { label: '已关闭执行', tone: 'muted' };
  if (agent.canExecute === false) return { label: '仅同步', tone: 'muted' };
  return { label: '可执行', tone: 'ready' };
}

async function connectionRequest<T>(endpoint: string, resource = '', options: RequestInit = {}): Promise<T> {
  const response = await fetch(`beings://desktop/api/work/agents${resource}`, {
    ...options, headers: { ...options.headers, 'X-Being-Endpoint': endpoint },
  });
  const result = response.headers.get('Content-Type')?.includes('application/json') ? await response.json() : undefined;
  if (!response.ok) throw new Error(result?.error || `执行器连接请求失败（${response.status}）`);
  return result;
}

export function WorkAgentSettings({ app, endpoint }: { app: AppModel; endpoint: string }) {
  const [agents, setAgents] = useState<WorkAgentConnection[]>([]);
  const [selected, setSelected] = useState('internal');
  const [revision, setRevision] = useState(0);
  const [checking, setChecking] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [notice, setNotice] = useState<{ id: string; text: string }>();
  useEffect(() => {
    const controller = new AbortController();
    setChecking(true);
    void connectionRequest<WorkAgentConnection[]>(endpoint, '', { signal: controller.signal }).then(rows => {
      if (!controller.signal.aborted) setAgents(rows);
    }, error => {
      if (!controller.signal.aborted) app.toastError(error);
    }).finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => controller.abort();
  }, [app, endpoint, revision]);
  const agent = agents.find(row => row.id === selected) || agents[0];
  const status = agent && connectionStatus(agent);
  const busy = checking || updating;
  const update = async (connection: WorkAgentConnection, enabled?: boolean) => {
    setUpdating(true);
    try {
      if (enabled === undefined) {
        await connectionRequest(endpoint, `/${connection.id}/connect`, { method: 'POST' });
        setNotice({ id: connection.id, text: `连接组件已配置。请重启 ${connection.name}，然后重新诊断。` });
      } else {
        await connectionRequest(endpoint, `/${connection.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
        setAgents(current => current.map(row => row.id === connection.id ? { ...row, enabled } : row));
        if (endpoint && app.work.endpoint === endpoint) void app.work.refresh();
      }
      setChecking(true);
      setRevision(value => value + 1);
    } catch (error) { app.toastError(error); }
    finally { setUpdating(false); }
  };
  return <section className={styles.connections} aria-label="本机执行器">
    <div className={styles.toolbar}>
      <h3>本机执行器</h3>
      <button type="button" disabled={busy} onClick={() => { setNotice(undefined); setChecking(true); setRevision(value => value + 1); }}>
        <Icon name="lucide-refresh-cw" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" />
        {checking ? '正在诊断…' : '重新诊断'}
      </button>
    </div>
    {agent && status ? <div className={styles.layout}>
      <div className={styles.list} role="group" aria-label="执行器列表">
        {agents.map(row => {
          const { label, tone } = connectionStatus(row);
          return <button type="button" key={row.id} aria-pressed={row.id === agent.id} onClick={() => setSelected(row.id)}>
            <span aria-hidden="true"><WorkExecutorMark executor={row.id} /></span>
            <strong>{row.name}</strong>
            <span className={styles.status} data-tone={tone}>{label}</span>
          </button>;
        })}
      </div>
      <section className={styles.inspector} aria-labelledby="work-agent-inspector-title">
        <header><h3 id="work-agent-inspector-title">{agent.name}</h3><span className={styles.status} data-tone={status.tone}>{status.label}</span></header>
        {agent.message && (agent.enabled !== false || !agent.available) && <p>{agent.message}</p>}
        {agent.enabled !== undefined && <SettingsItem label="允许执行" description="关闭后仍可同步历史和停止已在运行的任务。" htmlFor="work-agent-enabled" descriptionId="work-agent-effect">
          <input type="checkbox" role="switch" id="work-agent-enabled" aria-label="允许执行" aria-describedby="work-agent-effect" checked={agent.enabled} disabled={busy} onChange={event => void update(agent, event.target.checked)} />
        </SettingsItem>}
        {agent.id === 'internal' && <button className={styles.action} type="button" onClick={() => app.openSubagentSettings()}>配置 Subagent 模型</button>}
        {!agent.available && agent.capabilities?.connect && <button className={styles.action} type="button" disabled={busy} onClick={() => void update(agent)}>配置本机连接</button>}
        {notice?.id === agent.id && <p role="status">{notice.text}</p>}
      </section>
    </div> : <p className={styles.placeholder} role="status">{checking ? '正在检测本机连接…' : '暂时无法读取执行器。'}</p>}
  </section>;
}
