import type { ReactNode } from 'react';
import { FileTypeIcon } from './file-type-icon';
import { FileName } from './file-name';
import { formatBytes } from '../lib/format-bytes';
import styles from './file-card.module.scss';

/** One visual card; the caller chooses the local or cloud file channel. */
export function FileCard({ path, name, size, title, disabled, localPath, className = '', onOpen, children }: {
  path: string; name: string; size?: number; title: string; disabled?: boolean; localPath?: string;
  className?: string; onOpen: () => void; children?: ReactNode;
}) {
  const extension = path.split(/[\\/]/).pop()!.split('.').slice(1).pop()?.toUpperCase() || '文件';
  return <span className={`${styles.file} ${className}`} data-slot="file-card">
    <button type="button" className={styles.open} data-slot="file-card-open" disabled={disabled} data-local-file={localPath}
      aria-label={`预览文件：${name}`} title={title} onClick={onOpen}>
      <FileTypeIcon path={path} glyph={localPath || document.documentElement.dataset.chatHost === 'desktop' ? 'chat-file' : undefined} />
      <span className={styles.details}>
        <FileName name={name} />
        <span className={styles.metadata}>{extension}{size !== undefined && ` · ${formatBytes(size)}`}</span>
      </span>
    </button>
    {children}
  </span>;
}
