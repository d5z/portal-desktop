import { Icon, type IconName } from '../icons/icon';
import styles from './file-type-icon.module.scss';

export function FileTypeIcon({ path, className = '' }: { path: string; className?: string }) {
  const extension = path.split('/').pop()!.split('.').slice(1).pop()?.toLowerCase() || '';
  const kind = ['ppt', 'pptx', 'odp'].includes(extension) ? 'slides'
        : ['xls', 'xlsx', 'csv', 'tsv', 'ods'].includes(extension) ? 'sheet'
        : extension === 'pdf' ? 'pdf'
        : ['doc', 'docx', 'txt', 'md', 'markdown', 'rtf'].includes(extension) ? 'document'
        : ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg'].includes(extension) ? 'image'
        : ['html', 'htm', 'json', 'js', 'ts', 'tsx', 'jsx', 'css', 'py', 'rs', 'sh', 'sql', 'xml', 'yaml', 'yml', 'toml'].includes(extension) ? 'code' : 'generic';
  const icon: IconName = kind === 'slides' ? 'file-slides' : kind === 'sheet' ? 'file-sheet'
        : kind === 'image' ? 'image-rounded' : kind === 'code' ? 'terminal' : 'file';
  return <span className={`${styles.fileIcon} ${styles[kind]} ${className}`} aria-hidden="true"><Icon name={icon} width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" /></span>;
}
