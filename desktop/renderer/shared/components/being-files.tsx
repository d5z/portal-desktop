import { createContext, useContext, type ReactNode } from 'react';
import type { BeingFiles } from '../../../shared/being-files';
import { Icon } from '../icons/icon';
import { IconButton } from './icon-button';
import { FileCard } from './file-card';
import cardStyles from './file-card.module.scss';
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
    {receipt.files!.map((file, index) => <FileCard key={`${file.path}:${index}`} path={file.path} name={file.name} size={file.size}
      disabled={!open} title={[file.path, file.caption, open ? '点击预览' : '请在桌面客户端打开'].filter(Boolean).join('\n')}
      onOpen={() => open?.(file.path)}>
      {open && <IconButton className={cardStyles.download} label={`下载文件：${file.name}`} title="下载文件" onClick={() => open(file.path, 'download')}>
        <Icon name="download-wide" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </IconButton>}
    </FileCard>)}
    {!open && <p className={styles.unavailable}>请在桌面客户端打开</p>}
  </div>;
}
