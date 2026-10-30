import type { ClientCommandRequest } from './client-server';
import type { PermissionMode } from '../../shared/security';
import { reviewPortalOperation } from './approval-review';

export interface ApprovalPrompt { title: string; message: string; detail: string; signal: AbortSignal }
/** No reusable grants: the boolean result belongs only to the awaiting request. */
export class ToolApproval {
  private busy = false;
  constructor(private mode: () => PermissionMode,
    private prompt: (input: ApprovalPrompt) => Promise<boolean>) {}

  async request(request: ClientCommandRequest, signal: AbortSignal): Promise<string> {
    const mode = this.mode();
    if (this.busy || signal.aborted || !['supervised', 'auto-review'].includes(mode)) return 'deny';
    const value = JSON.parse(request.args);
    if (!value || typeof value.tool !== 'string' || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(value.tool) ||
        typeof value.workspace !== 'string' || !value.arguments || Array.isArray(value.arguments) || typeof value.arguments !== 'object') {
      throw new Error('无效的工具审批请求');
    }
    const detail = JSON.stringify({ tool: value.tool, arguments: value.arguments, workspace: value.workspace,
      isolation: value.isolation ?? 'host-tool', target: value.target, reason: value.reason,
      endpoint: request.endpoint, scene: request.sceneId ?? null }, null, 2);
    // Do not approve a clipped command. Display controls escaped so text cannot hide its contents.
    if (detail.length > 20000) throw new Error('操作过长，无法完整展示审批内容，请拆分操作');
    if (mode === 'auto-review' && reviewPortalOperation(value) === 'allow') {
      return !signal.aborted && this.mode() === mode ? 'allow-once' : 'deny';
    }
    this.busy = true;
    try {
      const allowed = await this.prompt({ title: '工具操作审批',
        message: `允许 ${value.tool} 执行这一次操作？`,
        detail: (value.isolation === 'windows-lpac-offline' ? 'Windows 沙箱 · 仅授权工作区 · 禁止网络\n\n' :
          value.isolation === 'macos-seatbelt-offline' ? 'macOS 沙箱 · 仅授权工作区及系统运行库 · 禁止网络\n\n' :
          value.isolation === 'file-scope' ? '文件授权 · 仅限下方目标及这一次操作，不开放其他路径\n\n' :
          value.isolation === 'public-web-read' ? '网页读取 · 不携带本机凭据，不允许跳转到其他网站或私网\n\n' :
          '本机工具 · 可能访问网络或工作区外数据\n\n') +
          detail.replace(/[\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`), signal });
      return allowed && !signal.aborted && this.mode() === mode ? 'allow-once' : 'deny';
    } finally { this.busy = false; }
  }
}
