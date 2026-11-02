import { randomUUID } from 'node:crypto';
import type { ApprovalPrompt } from './tool-approval';
import type { ToolApprovalView } from '../../shared/security';

/** Only the source-checked top-level shell can resolve these one-shot requests. */
export class ApprovalDialogs {
  private pending?: { view: ToolApprovalView; finish: (allowed: boolean) => void };
  constructor(private publish: (request: ToolApprovalView | null) => void) {}
  current() { return this.pending?.view ?? null; }
  request(input: ApprovalPrompt): Promise<boolean> {
    if (input.signal.aborted || this.pending) return Promise.resolve(false);
    return new Promise(resolve => {
      const view = { id: randomUUID(), title: input.title, message: input.message, detail: input.detail, rememberScope: input.rememberScope, expiresAt: Date.now() + 120000 };
      const abort = () => finish(false);
      const finish = (allowed: boolean) => {
        clearTimeout(timer); input.signal.removeEventListener('abort', abort);
        if (this.pending?.view.id !== view.id) return;
        this.pending = undefined; this.publish(null); resolve(allowed && !input.signal.aborted);
      };
      const timer = setTimeout(abort, 120000);
      this.pending = { view, finish };
      input.signal.addEventListener('abort', abort, { once: true });
      this.publish(view);
    });
  }
  answer(id: unknown, allowed: unknown) {
    if (typeof id !== 'string' || typeof allowed !== 'boolean' || this.pending?.view.id !== id) throw new Error('审批已过期或不存在');
    this.pending.finish(allowed);
  }
  cancel() { this.pending?.finish(false); }
}
