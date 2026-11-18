import type { ClientCommandRequest } from './client-server';
import type { PermissionMode } from '../../shared/security';

export interface ApprovalPrompt { title: string; message: string; detail: string; signal: AbortSignal }
/** Every requested operation needs its own explicit, single-invocation consent. */
export class ToolApproval {
  private prompts = Promise.resolve();
  constructor(private mode: () => PermissionMode,
    private prompt: (input: ApprovalPrompt) => Promise<boolean>) {}

  async request(request: ClientCommandRequest, signal: AbortSignal): Promise<string> {
    const mode = this.mode();
    if (signal.aborted) throw new Error('审批调用已取消，操作未执行');
    if (mode !== 'supervised') throw new Error('权限模式已更改，请检查电脑操作权限后重新发起操作');
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
    // Parallel tool calls wait for their own consent instead of being denied
    // merely because a different operation currently owns the dialog.
    const previous = this.prompts;
    let release!: () => void;
    const turn = new Promise<void>(resolve => { release = resolve; });
    // Cancelling a queued request settles its caller immediately, while its slot
    // still waits for the active dialog before allowing later requests through.
    this.prompts = previous.then(() => turn);
    let abort!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new Error('审批调用已取消，操作未执行'));
      signal.addEventListener('abort', abort, { once: true });
    });
    try {
      await Promise.race([previous, cancelled]);
      if (signal.aborted) throw new Error('审批调用已取消，操作未执行');
      if (this.mode() !== mode) throw new Error('权限模式已更改，本次审批失效，请重新发起操作');
      const allowed = await this.prompt({ title: '工具操作审批',
        message: `允许 ${value.tool} 执行这一次操作？`,
        detail: (value.isolation === 'windows-lpac-offline' ? 'Windows 沙箱 · 仅授权工作区 · 禁止网络\n\n' :
          value.isolation === 'macos-seatbelt-offline' ? 'macOS 沙箱 · 仅授权工作区及系统运行库 · 禁止网络\n\n' :
          value.isolation === 'file-scope' ? '文件授权 · 仅限下方目标，不开放其他路径\n\n' :
          value.isolation === 'public-web-read' ? '网页读取 · 不携带本机凭据，不允许跳转到其他网站或私网\n\n' :
          '本机工具 · 可能访问网络或工作区外数据\n\n') +
          detail.replace(/[\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`), signal });
      if (signal.aborted) throw new Error('审批调用已取消，操作未执行');
      if (this.mode() !== mode) throw new Error('权限模式已更改，本次审批失效，请重新发起操作');
      return allowed ? 'allow-once' : 'deny';
    } finally {
      signal.removeEventListener('abort', abort);
      release();
    }
  }
}
