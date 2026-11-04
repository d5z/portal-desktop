import { createContext, useContext, type ReactNode } from 'react';
import type { BeingFiles } from '../../../shared/being-files';
import { Icon } from '../icons/icon';
import { formatBytes } from '../lib/format-bytes';
import styles from './being-files.module.scss';

export const HomeFileAction = createContext<((path: string) => void) | undefined>(undefined);

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
    {receipt.files!.map((file, index) => <button key={`${file.path}:${index}`} type="button" className={`${styles.file} ${styles.open}`} disabled={!open} aria-label={`预览文件：${file.name}`}
        onClick={() => open?.(file.path)}>
        <span className={styles.summary}><Icon name="file" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <span className={styles.details}><strong>{file.name}</strong><span className={styles.metadata}>
          {file.path.split('/').pop()}{file.size !== undefined && ` · ${formatBytes(file.size)}`}
        </span></span>
        <span className={styles.action}>预览</span></span>
      {file.caption && <span className={styles.caption}>{file.caption}</span>}
    </button>)}
    <p className={styles.privacy}>{open ? '仅自己可访问 · 支持下载' : '仅自己可访问 · 请在桌面客户端打开'}</p>
  </div>;
}
