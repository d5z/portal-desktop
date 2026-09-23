import { requestTownPairCode } from "../desktop/shared/town-pair-code";
import type { WebConnection } from "./connection";

type Pairing = { token: string; beingId: string; display?: string };
export class WebTownPairing {
  private attempt?: { id: string; controller: AbortController };
  constructor(
    private options: {
      connection(): WebConnection | null;
      resolve(connection: WebConnection): Promise<WebConnection>;
      generation(): number;
      pair(
        input: { beingId: string; code: string },
        signal: AbortSignal,
      ): Promise<Pairing>;
      save(result: Pairing): void;
      fetcher?: typeof fetch;
      timeoutMs?: number;
      prompt?(): Promise<string>;
    },
  ) {}
  cancel(id?: string) {
    if (!this.attempt || (id && this.attempt.id !== id)) return true;
    this.attempt.controller.abort();
    this.attempt = undefined;
    return true;
  }
  async start(input: { requestId: string; beingId: string }) {
    if (!/^[a-zA-Z0-9-]{16,64}$/.test(input?.requestId || ""))
      throw new Error("无效的配对请求。");
    if (this.attempt) throw new Error("正在配对，请等待或取消当前请求。");
    const connection = this.options.connection();
    if (!connection?.token)
      throw new Error("请先连接 Being 对话，或使用手动配对。");
    if (connection.name !== input.beingId)
      throw new Error("当前 Being 已改变，请重新打开 Town 连接。");
    const attempt = { id: input.requestId, controller: new AbortController() };
    this.attempt = attempt;
    const generation = this.options.generation();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      attempt.controller.abort();
    }, this.options.timeoutMs ?? 90000);
    const current = () => {
      attempt.controller.signal.throwIfAborted();
      const next = this.options.connection();
      if (
        this.attempt !== attempt ||
        next?.endpoint !== connection.endpoint ||
        next.token !== connection.token ||
        next.relaySecret !== connection.relaySecret ||
        this.options.generation() !== generation
      )
        throw new Error("连接身份已改变，请重新开始配对。");
    };
    try {
      const resolved = await this.options.resolve(connection);
      const prompt = await this.options.prompt?.();
      current();
      const code = await requestTownPairCode(
        { endpoint: resolved.api, token: connection.token },
        input.requestId,
        attempt.controller.signal,
        this.options.fetcher,
        "town-web",
        prompt,
      );
      current();
      const paired = await this.options.pair(
        { beingId: connection.name, code },
        attempt.controller.signal,
      );
      current();
      // Storage is synchronous: cancellation cannot interrupt a half-save.
      this.options.save(paired);
    } catch (error) {
      if (timedOut) throw new Error("90 秒内未完成自动配对，请使用手动配对。");
      if (attempt.controller.signal.aborted)
        throw new Error("自动配对已取消。");
      throw error;
    } finally {
      clearTimeout(timer);
      attempt.controller.abort();
      if (this.attempt === attempt) this.attempt = undefined;
    }
  }
}
