import { Service, type Context } from '@deepseek-ai/cordis';
/** Local authenticated Town transport for plugin-owned, explicitly decorated Remote methods. */
export class LocalRemote extends Service {
  settings: Record<string, (...args: any[]) => Promise<any>>;
  private ownerContext: Context;
  private mounts = new Map<string, { face: Record<string, any>; dispose: () => unknown }>();
  constructor(ctx: Context) {
    super(ctx, 'remote');
    this.ownerContext = ctx;
    this.settings = { describe: () => this.call('settings', 'describe', []), mutate: (...args) => this.call('settings', 'mutate', args) };
    ctx.provide('remote.settings', this.settings);
  }
  async call(service: string, method: string, args: unknown[], signal?: AbortSignal) {
    const response = await fetch('/@town-dsh/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ service, method, args }), signal });
    if (!response.ok) throw new Error(`插件 RPC HTTP ${response.status}`);
    return response.json();
  }
  stream(service: string, method: string, args: unknown[], codec?: any, signal?: AbortSignal) {
    const controller = new AbortController();
    let disposed = false;
    const stop = () => { disposed = true; controller.abort(); signal?.removeEventListener('abort', stop); };
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    const response = fetch('/@town-dsh/rpc', { method: 'POST', body: JSON.stringify({ service, method, args }), signal: controller.signal });
    void response.catch(() => {});
    const decode = (line: string) => { const result = JSON.parse(line); if (!result.ok) throw new Error(result.error?.message || '插件流失败'); return codec?.create?.().parse(result.value) ?? result.value; };
    const iterator = (async function* () {
      try {
        const incoming = await response;
        if (!incoming.ok || !incoming.body) throw new Error(`插件流 HTTP ${incoming.status}`);
        const reader = incoming.body.getReader(), decoder = new TextDecoder(); let buffered = '';
        try {
          for (;;) {
            const chunk = await reader.read(); buffered += decoder.decode(chunk.value, { stream: !chunk.done });
            const lines = buffered.split('\n'); buffered = lines.pop()!;
            for (const line of lines) if (line.trim()) yield decode(line);
            if (chunk.done) { if (buffered.trim()) yield decode(buffered); break; }
          }
        } finally { await reader.cancel().catch(() => {}); }
      } catch (error) { if (!disposed) throw error; }
      finally { controller.abort(); signal?.removeEventListener('abort', stop); }
    })();
    return { [Symbol.asyncIterator]: () => iterator, dispose: stop, end() {}, send() { throw new Error('Town 尚未支持 Remote 双向 uplink'); } };
  }
  async $mount(contribution: any) {
    if (!Array.isArray(contribution.descriptors)) throw new Error('Remote contribution 缺少 descriptors');
    const releases: (() => void)[] = [];
    try {
      const groups: Record<string, any[]> = {};
      for (const d of contribution.descriptors) (groups[d.namespace] ??= []).push(d);
      for (const [namespace, descriptors] of Object.entries(groups)) {
        let mounted = this.mounts.get(namespace);
        if (!mounted && (!namespace || namespace in this)) throw new Error(`Remote namespace 冲突：${namespace}`);
        const face: Record<string, any> = mounted?.face ?? Object.create(null);
        const methods = new Set<string>();
        // Validate the entire contribution before publishing any of its methods.
        for (const d of descriptors) {
          if (d.uplink) throw new Error('Town 尚未支持 Remote 双向 uplink');
          if (d.invocation?.kind !== 'direct') throw new Error(`Town 未连接 ${d.invocation?.kind} 远端作用域`);
          if (!d.method || methods.has(d.method) || d.method in face) throw new Error(`Remote 方法冲突：${namespace}.${d.method}`);
          methods.add(d.method);
        }
        const abort = new AbortController();
        for (const d of descriptors) {
          const check = () => { if (abort.signal.aborted) throw new Error(`Remote 方法已卸载：${namespace}.${d.method}`); };
          face[d.method] = d.mode === 'stream' ? (...args: any[]) => {
            check(); return this.stream(d.service, d.method, args, d.result, abort.signal);
          } : async (...args: any[]) => {
            check();
            for (let i = 0; i < d.parameters.length; i++) d.parameters[i].codec?.create?.().parse(args[i]);
            const result = await this.call(d.service, d.method, args, abort.signal);
            if (result.ok) d.result?.create?.().parse(result.value);
            return result;
          };
        }
        if (!mounted) {
          try {
            // The namespace belongs to the transport, not its first caller.
            // Otherwise unloading that caller also removes surviving peers.
            const dispose = this.ownerContext.reflect.provide('remote.' + namespace, face);
            mounted = { face, dispose }; this.mounts.set(namespace, mounted);
            Object.defineProperty(this, namespace, { value: face, configurable: true });
          } catch (error) { abort.abort(); throw error; }
        }
        const handle = mounted;
        releases.push(() => {
          abort.abort();
          for (const method of methods) delete face[method];
          if (!Object.keys(face).length) {
            void handle.dispose(); this.mounts.delete(namespace); delete (this as any)[namespace];
          }
        });
      }
    } catch (error) { for (const release of releases.reverse()) release(); throw error; }
    let disposed = false;
    return this.ctx.effect(() => () => { if (disposed) return; disposed = true; for (const release of releases.reverse()) release(); });
  }
  $on(event: string, listener: (...args: any[]) => void) {
    const stream = new EventSource('/@town-dsh/events?event=' + encodeURIComponent(event));
    stream.onmessage = message => { try { listener(...JSON.parse(message.data)); } catch (error) { console.error(error); } };
    return this.ctx.effect(() => () => stream.close());
  }
}
