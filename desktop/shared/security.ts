export type PermissionMode = 'supervised' | 'full-access';
export interface ToolApprovalView { id: string; title: string; message: string; detail: string; expiresAt: number }
export function permissionMode(value: unknown): PermissionMode {
  if (value === undefined || value === 'auto-review' || value === 'read-only') return 'supervised';
  if (value === 'supervised' || value === 'full-access') return value;
  throw new Error('无效的电脑操作权限。');
}
// Leave room for execution and error delivery within the cloud's 120s tool budget.
export const TOOL_APPROVAL_TIMEOUT_MS = 60_000;
