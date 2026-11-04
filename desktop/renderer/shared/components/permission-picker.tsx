import { choicesFor } from '../lib/permissions';
import { PermissionIcon } from '../icons/permission';
import styles from './permission-picker.module.scss';
import type { PermissionMode } from '../../../shared/security';
export function PermissionPicker({ value, onChange, disabled = false }: { value: PermissionMode; onChange: (mode: PermissionMode) => void; disabled?: boolean }) {
  const choices = choicesFor(value);
  return <div className={styles.picker} role="radiogroup" aria-label="工具权限模式">
    {choices.map((choice, index) => <button key={choice.value} type="button" role="radio" aria-checked={value === choice.value} tabIndex={value === choice.value ? 0 : -1}
      onKeyDown={event => {
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
          : (index + (event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1) + choices.length) % choices.length;
        onChange(choices[next].value);
        (event.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus();
      }}
      disabled={disabled} className={styles.choice} onClick={() => onChange(choice.value)}>
      <span className={styles.icon}><PermissionIcon mode={choice.value}/></span>
      <span className={styles.copy}><span className={styles.title}>{choice.title}{choice.tag && <em>{choice.tag}</em>}</span><span className={styles.detail}>{choice.detail}</span></span>
      <span className={styles.radio} aria-hidden="true">{value === choice.value ? '●' : ''}</span>
    </button>)}
  </div>;
}
