import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { createInterface } from 'node:readline';
import WebSocket from 'ws';
import { AgentError } from './types';

type Frame = { id?: number | string; method?: string; params?: any; result?: unknown; error?: { code: number; message: string } };
type Connection = { write(frame: string): void; close(): void };
/** Request correlation for local stdio and the native app-server control socket. */
export class JsonRpcProcess {
  private connection?: Connection;
  private nextId = 0;
  private pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  closed: () => void = () => {};
  notification: (method: string, params: any) => void = () => {};
  serverRequest: (method: string, params: any) => Promise<unknown> = async method => { throw new AgentError(`Unsupported agent request: ${method}`); };
  start(command: string, args: string[]) {
    const child = spawn(command, args, { stdio: 'pipe', windowsHide: true });
    const connection = this.connection = { write: frame => { child.stdin.write(frame + '\n'); }, close: () => { child.kill(); } };
    // Credentials or model payloads can occur on stderr; never forward it to UI/logs.
    child.stderr.resume();
    createInterface({ input: child.stdout }).on('line', line => this.receive(connection, line));
    child.once('error', error => { if (this.connection === connection) this.close(error); });
    child.once('exit', () => { if (this.connection === connection) this.close(); });
  }
  async openSocket(path: string) {
    const socket = new WebSocket('ws://localhost/rpc', {
      createConnection: () => createConnection(path), handshakeTimeout: 2500, perMessageDeflate: false, maxPayload: 0,
    });
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    const connection = this.connection = { write: frame => socket.send(frame), close: () => socket.close() };
    socket.on('message', data => this.receive(connection, data.toString()));
    socket.on('error', error => { if (this.connection === connection) this.close(error); });
    socket.once('close', () => { if (this.connection === connection) this.close(); });
  }
  private receive(connection: Connection, text: string) {
    if (this.connection !== connection) return;
    let frame: Frame;
    try { frame = JSON.parse(text); } catch { this.close(new AgentError('Agent returned invalid JSON-RPC.')); return; }
    if (frame.method && frame.id !== undefined) {
      void this.serverRequest(frame.method, frame.params).then(result => { if (this.connection === connection) this.write({ id: frame.id, result }); },
        error => { if (this.connection === connection) this.write({ id: frame.id, error: { code: -32603, message: (error as Error).message } }); });
    } else if (frame.method) this.notification(frame.method, frame.params);
    else if (typeof frame.id === 'number') {
      const pending = this.pending.get(frame.id);
      if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(frame.id);
      if (frame.error) pending.reject(new AgentError(frame.error.message, 502, JSON.stringify(frame.error)));
      else pending.resolve(frame.result);
    }
  }
  private write(frame: object) { this.connection?.write(JSON.stringify({ jsonrpc: '2.0', ...frame })); }
  notify(method: string, params?: unknown) { this.write({ method, params }); }
  request<T>(method: string, params: unknown): Promise<T> {
    if (!this.connection) return Promise.reject(new AgentError('Agent is not connected.', 503));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new AgentError(`Agent request timed out: ${method}`, 504)); }, 30000);
      this.pending.set(id, { resolve, reject, timer }); this.write({ id, method, params });
    });
  }
  private fail(error: Error) { for (const value of this.pending.values()) { clearTimeout(value.timer); value.reject(error); } this.pending.clear(); }
  close(error: Error = new AgentError('Agent connection closed.')) {
    const connection = this.connection; this.connection = undefined;
    connection?.close(); this.fail(error); this.closed();
  }
}
