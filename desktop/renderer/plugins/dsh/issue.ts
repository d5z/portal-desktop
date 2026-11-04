import type { DshPlugin } from '../../../shared/dsh-plugins';

export function pluginIssue(plugin: DshPlugin, clientError?: string) {
  const missing = plugin.missingServices?.join('、');
  const clientDependency = (clientError || plugin.error)?.match(/^(?:缺少客户端|Town 尚未提供客户端)(模块|服务)：(.+)$/);
  const reason = missing ? `当前环境缺少插件需要的服务：${missing}。`
    : clientDependency ? `插件需要的界面${clientDependency[1]}不可用：${clientDependency[2]}。` : undefined;
  if (reason) return { title: '与当前 Town 不适配', reason, detail: undefined };
  const detail = plugin.error || clientError;
  if (detail || (plugin.enabled && ['error', 'blocked'].includes(plugin.status))) {
    return { title: '插件加载失败', reason: '请检查插件配置，或尝试更新插件。', detail: detail?.replace(/^Error:\s*/, '') };
  }
}

export function startupPluginNotice(plugins: DshPlugin[], errors: Record<string, string>) {
  const failures = plugins.filter(p => p.enabled && pluginIssue(p, errors[p.id]));
  if (!failures.length) return;
  const first = failures[0], issue = pluginIssue(first, errors[first.id])!;
  return failures.length === 1 ? `${first.id}：${issue.title}。${issue.reason}`
    : `${failures.length} 个第三方插件未能加载，可在「第三方插件」中查看原因。`;
}
