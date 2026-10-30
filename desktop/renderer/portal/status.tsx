import type { PortalState } from '../../shared/types';

const phases = {
  running: {label:'运行中', tone:'healthy'},
  connected: {label:'已连接', tone:'healthy'},
  stopped: {label:'未启动', tone:'neutral'},
  starting: {label:'启动中', tone:'pending'},
  reconnecting: {label:'重连中', tone:'pending'},
  stopping: {label:'停止中', tone:'pending'},
  external: {label:'实例冲突', tone:'error'},
  error: {label:'启动失败', tone:'error'},
} as const;

export function portalStatus(state?: PortalState) {
  return state ? phases[state.phase] : {label:'读取中', tone:'neutral'};
}

export function PortalStatus({state, id}: {state?: PortalState; id?: string}) {
  const status = portalStatus(state);
  return <span id={id} className="portal-status" data-tone={status.tone}>
    <span className="portal-status-dot" aria-hidden="true" />{status.label}
  </span>;
}
