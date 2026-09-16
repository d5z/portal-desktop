import type { CSSProperties } from 'react';
import type { UpdateState } from '../../../shared/types';

const stages: Record<NonNullable<UpdateState['activity']>['phase'], string> = {
  metadata: '正在读取更新信息…',
  downloading: '正在下载更新…',
  verifying: '正在校验安装包…',
  preparing: '正在准备安装文件…',
  ready: '下载完成，点击安装',
  installing: '正在停止 Portal，准备安装…',
};

export function UpdateProgress({ state, onDownload, onCancel, onInstall }: {
  state?: UpdateState;
  onDownload: () => void;
  onCancel: () => void;
  onInstall: () => void;
}) {
  const activity = state?.activity;
  if (!activity && state?.phase !== 'available') return null;
  const downloading = Boolean(activity && !['ready', 'installing'].includes(activity.phase));
  const ratio = activity?.phase === 'downloading' && activity.total
    ? Math.min(1, (activity.received || 0) / activity.total) : undefined;
  const label = activity
    ? stages[activity.phase]
    : `发现新版本 ${state?.latestVersion}，点击下载`;
  const action = activity?.phase === 'ready'
    ? onInstall
    : downloading
      ? onCancel
      : onDownload;
  return (
    <button
      id="client-update"
      className={`client-update${downloading ? ' is-progress' : ''}${activity?.phase === 'ready' ? ' is-ready' : ''}`}
      type="button"
      aria-label={label}
      title={downloading ? `${label}（点击取消）` : label}
      aria-busy={downloading || activity?.phase === 'installing'}
      disabled={activity?.phase === 'installing'}
      onClick={action}
      style={ratio === undefined ? undefined : { '--update-angle': `${ratio * 360}deg` } as CSSProperties}
    >
      {downloading ? (
        <span className="client-update-progress" aria-hidden="true">
          {ratio === undefined ? null : <span>{Math.floor(ratio * 100)}</span>}
        </span>
      ) : activity?.phase === 'ready' ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 17h10M12 4v9m0 0 3-3m-3 3-3-3" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 18v2h14v-2" />
        </svg>
      )}
    </button>
  );
}
