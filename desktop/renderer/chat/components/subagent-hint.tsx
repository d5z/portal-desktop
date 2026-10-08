export type SubagentHintMode = 'configure' | 'enable';

export function SubagentSetupHint({ mode, enabling = false, enableFailed = false, onConfigure, onEnable, onClose }: {
  mode: SubagentHintMode | null;
  enabling?: boolean;
  enableFailed?: boolean;
  onConfigure(): void;
  onEnable(): void;
  onClose(): void;
}) {
  if (!mode) return null;
  return <aside id="subagent-setup-hint" aria-label="subagent 提示">
    <span className="subagent-hint-text">
      {enableFailed ? '开启失败，请重试' : mode === 'enable' ? 'subagent 已配置但未开启' : '用 subagent 并行处理任务'}
    </span>
    <button
      className="subagent-hint-action"
      type="button"
      disabled={enabling}
      onClick={mode === 'enable' ? onEnable : onConfigure}
    >{mode === 'enable' ? (enabling ? '开启中…' : '一键开启') : '去配置'}</button>
    <button className="subagent-hint-close" type="button" aria-label="关闭 subagent 提示" onClick={onClose}>×</button>
  </aside>;
}
