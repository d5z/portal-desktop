import { Icon } from '../../shared/icons/icon';
import codexLight from '../assets/work-executors/codex-light.png';
import codexDark from '../assets/work-executors/codex-dark.png';
import deepseek from '../assets/work-executors/deepseek.svg';
import styles from './work.module.scss';

// Codex artwork comes from the ChatGPT desktop app's Codex icon resources.
// DeepSeek artwork is ICON.svg from DeepSeek's official brand assets.
const brands = new Map<string, { name: string; image: string; darkImage?: string }>([
  ['codex', { name: 'Codex', image: codexLight, darkImage: codexDark }],
  ['deepseek', { name: 'DeepSeek', image: deepseek }],
]);

export function WorkExecutorMark({ executor, showName = false }: { executor: string; showName?: boolean }) {
  const brand = brands.get(executor);
  const name = brand?.name || (executor === 'internal' ? '内置 Subagent' : executor || '未分配执行器');
  return <span className={styles.executorMark} data-executor={executor || undefined}
    role={showName ? undefined : 'img'} aria-label={showName ? undefined : name} title={name}>
    {brand ? <>
      <img src={brand.image} className={brand.darkImage ? styles.executorLight : undefined} alt="" width="16" height="16" />
      {brand.darkImage && <img src={brand.darkImage} className={styles.executorDark} alt="" width="16" height="16" />}
    </> : <Icon name={executor === 'internal' ? 'composer-subagent' : executor ? 'chat-agent' : 'rail-work'}
      width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}
    {showName && name}
  </span>;
}
