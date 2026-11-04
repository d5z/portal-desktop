import type { PermissionMode } from '../../../shared/security';

export const permissionChoices: { value: PermissionMode; title: string; detail: string; tag?: string }[] = [
  { value: 'supervised', title: '请求批准', detail: '越界编辑、联网和外部工具需批准' },
  { value: 'auto-review', title: '帮我批准', detail: '自动批准可信文档读取，记住已同意的同类操作', tag: '默认' },
  { value: 'full-access', title: '完全访问', detail: '允许文件、网络和工具调用，不再询问' },
];
export const legacyReadOnlyChoice = { value: 'read-only' as const, title: '旧版只读', detail: '保留旧配置限制；选择新的权限模式后生效。', tag: undefined };
export const choicesFor = (value: PermissionMode) => value === 'read-only' ? [legacyReadOnlyChoice, ...permissionChoices] : permissionChoices;
