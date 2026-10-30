import type { PermissionMode } from '../../../shared/security';
export const permissionChoices: { value: PermissionMode; title: string; detail: string; icon: string; tag?: string }[] = [
  { value: 'supervised', title: '请求批准', detail: '越界编辑、联网和外部工具需批准', icon: 'shield' },
  { value: 'auto-review', title: '帮我批准', detail: '自动批准可信文档读取，其他越界操作询问', icon: 'shield', tag: '默认' },
  { value: 'full-access', title: '完全访问', detail: '允许文件、网络和工具调用，不再询问', icon: 'unlock' },
];
export const legacyReadOnlyChoice = { value: 'read-only' as const, title: '旧版只读', detail: '保留旧配置限制；选择新的权限模式后生效。', icon: 'read', tag: undefined };
export const choicesFor = (value: PermissionMode) => value === 'read-only' ? [legacyReadOnlyChoice, ...permissionChoices] : permissionChoices;
export function PermissionIcon({ kind = 'shield' }: { kind?: string }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'read' ? <><rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6M9 12h6M9 16h3"/></> : kind === 'unlock'
      ? <><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M9 10V7a4 4 0 0 1 7-2M12 14v3"/></>
      : <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/></>}
  </svg>;
}
export function PermissionPicker({ value, onChange, disabled = false }: { value: PermissionMode; onChange: (mode: PermissionMode) => void; disabled?: boolean }) {
  const choices = choicesFor(value);
  return <div className="permission-picker" role="radiogroup" aria-label="工具权限模式">
    {choices.map((choice, index) => <button key={choice.value} type="button" role="radio" aria-checked={value === choice.value} tabIndex={value === choice.value ? 0 : -1}
      onKeyDown={event => {
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
          : (index + (event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1) + choices.length) % choices.length;
        onChange(choices[next].value);
        (event.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus();
      }}
      disabled={disabled} className={`permission-choice${value === choice.value ? ' selected' : ''}`} onClick={() => onChange(choice.value)}>
      <span className="permission-choice-icon"><PermissionIcon kind={choice.icon}/></span>
      <span className="permission-choice-copy"><span className="permission-choice-title">{choice.title}{choice.tag && <em>{choice.tag}</em>}</span><span className="permission-choice-detail">{choice.detail}</span></span>
      <span className="permission-radio" aria-hidden="true">{value === choice.value ? '●' : ''}</span>
    </button>)}
  </div>;
}
