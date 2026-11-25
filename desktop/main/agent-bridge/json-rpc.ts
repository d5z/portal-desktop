import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { AgentError } from './types';

type Frame = { id?: number | string; method?: string; params?: any; result?: unknown; error?: { code: number; message: string } };
/** Process lifetime and request correlation shared by stdio agent protocols. */
export class JsonRpcProcess {
  private child?: ChildProcessWithoutNullStreams;
  private nextId = 0;
  private pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  closed: () => void = () => {};
  notification: (method: string, params: any) => void = () => {};
  serverRequest: (method: string, params: any) => Promise<unknown> = async method => { throw new AgentError(`Unsupported agent request: ${method}`); };
  start(command: string, args: string[]) {
    const child = this.child = spawn(command, args, { stdio: 'pipe', windowsHide: true });
    // Credentials or model payloads can occur on stderr; never forward it to UI/logs.
    child.stderr.resume();
    createInterface({ input: child.stdout }).on('line', line => {
      if (this.child !== child) return;
      let frame: Frame;
      try { frame = JSON.parse(line); } catch { this.fail(new AgentError('Agent returned invalid JSON-RPC.')); this.close(); return; }
      if (frame.method && frame.id !== undefined) {
        void this.serverRequest(frame.method, frame.params).then(result => { if (this.child === child) this.write({ id: frame.id, result }); },
          error => { if (this.child === child) this.write({ id: frame.id, error: { code: -32603, message: (error as Error).message } }); });
      } else if (frame.method) this.notification(frame.method, frame.params);
      else if (typeof frame.id === 'number') {
        const pending = this.pending.get(frame.id);
        if (!pending) return;
        clearTimeout(pending.timer); this.pending.delete(frame.id);
        if (frame.error) pending.reject(new AgentError(frame.error.message, 502, JSON.stringify(frame.error)));
        else pending.resolve(frame.result);
      }
    });
    child.once('error', error => { if (this.child === child) { this.fail(error); this.close(); } });
    child.once('exit', () => { if (this.child !== child) return; this.child = undefined; this.fail(new AgentError('Agent connection closed.')); this.closed(); });
  }
  private write(frame: object) { this.child?.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...frame }) + '\n'); }
  notify(method: string, params?: unknown) { this.write({ method, params }); }
  request<T>(method: string, params: unknown): Promise<T> {
    if (!this.child) return Promise.reject(new AgentError('Agent is not connected.', 503));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new AgentError(`Agent request timed out: ${method}`, 504)); }, 30000);
      this.pending.set(id, { resolve, reject, timer }); this.write({ id, method, params });
    });
  }
  private fail(error: Error) { for (const value of this.pending.values()) { clearTimeout(value.timer); value.reject(error); } this.pending.clear(); }
  close() { const child = this.child; this.child = undefined; child?.kill(); this.fail(new AgentError('Agent connection closed.')); this.closed(); }
}
