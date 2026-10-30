// read-only is retained only for existing profiles; never silently widen their permissions.
export type PermissionMode = 'read-only' | 'supervised' | 'auto-review' | 'full-access';
export interface ToolApprovalView { id: string; title: string; message: string; detail: string; expiresAt: number }
export function permissionMode(value: unknown): PermissionMode {
  if (value === undefined) return 'auto-review';
  if (value === 'read-only' || value === 'supervised' || value === 'auto-review' || value === 'full-access') return value;
  throw new Error('无效的工具权限模式。');
}
