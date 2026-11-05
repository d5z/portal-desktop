import { createContext, useContext, type ReactNode } from 'react';
import type { BeingFiles } from '../../../shared/being-files';
import { Icon } from '../icons/icon';
import { IconButton } from './icon-button';
import { formatBytes } from '../lib/format-bytes';
import { FileTypeIcon } from './file-type-icon';
import styles from './being-files.module.scss';

export const HomeFileAction = createContext<((path: string, action?: 'preview' | 'download') => void) | undefined>(undefined);

export function HomeFileLink({ path, children }: { path?: string; children: ReactNode }) {
  const open = useContext(HomeFileAction);
  return <button type="button" className={styles.link} disabled={!path || !open}
    title={!path ? '文件地址无效' : !open ? '请在桌面客户端打开' : '在客户端预览，仅自己可访问'}
    onClick={() => path && open?.(path)}>{children}</button>;
}

export function BeingFilesMessage({ receipt, streaming, source }: { receipt: BeingFiles; streaming: boolean; source: string }) {
  const open = useContext(HomeFileAction);
  if (streaming) return <div className={styles.status} role="status">正在接收文件信息…</div>;
  if (receipt.error) return <div className={styles.status}><p role="alert">{receipt.error}</p><details><summary>查看原始信息</summary><pre>{source}</pre></details></div>;
  return <div className={styles.files} aria-label="交付文件">
    {receipt.files!.map((file, index) => {
      const extension = file.path.split('/').pop()!.split('.').slice(1).pop()?.toLowerCase() || '';
      return <div key={`${file.path}:${index}`} className={styles.file}>
        <button type="button" className={styles.open} disabled={!open} aria-label={`预览文件：${file.name}`}
          title={[file.path, file.caption, open ? '点击预览' : '请在桌面客户端打开'].filter(Boolean).join('\n')}
          onClick={() => open?.(file.path)}>
          <FileTypeIcon path={file.path} />
          <span className={styles.details}>
            <strong>{file.name}</strong>
            <span className={styles.metadata}>{extension.toUpperCase() || '文件'}{file.size !== undefined && ` · ${formatBytes(file.size)}`}</span>
          </span>
        </button>
        {open && <IconButton className={styles.download} label={`下载文件：${file.name}`} title="下载文件" onClick={() => open(file.path, 'download')}>
          <Icon name="download-wide" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </IconButton>}
      </div>;
    })}
    {!open && <p className={styles.unavailable}>请在桌面客户端打开</p>}
  </div>;
}
