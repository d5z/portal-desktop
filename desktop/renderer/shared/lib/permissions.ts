import type { PermissionMode } from '../../../shared/security';

export const permissionChoices: { value: PermissionMode; title: string; detail: string }[] = [
  { value: 'full-access', title: '始终允许', detail: '允许 Being 和子代理在此电脑上执行命令、修改文件及调用工具，不再询问' },
  { value: 'supervised', title: '每次询问', detail: 'Being 和子代理执行每条命令、修改文件或调用外部工具前，都先征求你的同意' },
];
