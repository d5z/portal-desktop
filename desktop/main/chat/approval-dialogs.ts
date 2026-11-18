import { randomUUID } from 'node:crypto';
import type { ApprovalPrompt } from './tool-approval';
import { TOOL_APPROVAL_TIMEOUT_MS, type ToolApprovalView } from '../../shared/security';

/** Only the source-checked top-level shell can resolve these one-shot requests. */
export class ApprovalDialogs {
  private pending?: { view: ToolApprovalView; finish: (allowed: boolean, error?: Error) => void };
  constructor(private publish: (request: ToolApprovalView | null) => void) {}
  current() { return this.pending?.view ?? null; }
  request(input: ApprovalPrompt): Promise<boolean> {
    if (input.signal.aborted) return Promise.reject(new Error('审批调用已取消，操作未执行'));
    if (this.pending) return Promise.reject(new Error('另一个操作正在等待审批，请完成后再试'));
    return new Promise((resolve, reject) => {
      const view = { id: randomUUID(), title: input.title, message: input.message, detail: input.detail, expiresAt: Date.now() + TOOL_APPROVAL_TIMEOUT_MS };
      const abort = () => finish(false, new Error('审批调用已取消，操作未执行'));
      const finish = (allowed: boolean, error?: Error) => {
        clearTimeout(timer); input.signal.removeEventListener('abort', abort);
        if (this.pending?.view.id !== view.id) return;
        this.pending = undefined; this.publish(null);
        if (error) reject(error); else resolve(allowed);
      };
      const timer = setTimeout(() => finish(false, new Error('审批等待超过 60 秒，操作未执行；请重新发起并在弹窗中允许')), TOOL_APPROVAL_TIMEOUT_MS);
      this.pending = { view, finish };
      input.signal.addEventListener('abort', abort, { once: true });
      this.publish(view);
    });
  }
  answer(id: unknown, allowed: unknown) {
    if (typeof id !== 'string' || typeof allowed !== 'boolean' || this.pending?.view.id !== id) throw new Error('审批已过期或不存在');
    this.pending.finish(allowed);
  }
  cancel() { this.pending?.finish(false, new Error('客户端关闭或配置已更改，审批已取消，操作未执行')); }
}
