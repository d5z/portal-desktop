import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { atomic } from './background';
import { portalIdentity, type PortalConflict } from './external';
import { redact, type Connection } from '../chat/connection';

interface Decision { schema: 1; identity: string; phase: 'cancelled' | 'stopping' | 'starting' | 'blocked'; message: string; replacing?: boolean }
interface TakeoverOptions {
  discover(connection: Connection, force?: boolean): Promise<PortalConflict[]>;
  stop(target: PortalConflict, force?: boolean): Promise<void>;
  preflight(targets: PortalConflict[], force?: boolean): Promise<void>;
}
/** Stop verified conflicts before starting the client engine. Failed transactions
 * stay paused across restarts; an old cancellation is no longer a runtime choice. */
export class PortalTakeover {
  readonly file: string;
  holdMessage = '';
  constructor(directory: string, private options: TakeoverOptions) { this.file = path.join(directory, 'portal-takeover.json'); }
  async run(connection: Connection, intent: 'manual' | 'automatic', start: (replacing: boolean) => Promise<void>, requireConflict = false, force = false): Promise<boolean> {
    if (force && intent !== 'manual') throw new Error('强制接管只能手动执行。');
    const identity = portalIdentity(connection);
    let saved: Decision | undefined;
    try { saved = JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Portal 切换记录无法读取，请保留记录并检查后重试。'); }
    if (saved && (saved.schema !== 1 || !['cancelled', 'stopping', 'starting', 'blocked'].includes(saved.phase))) throw new Error('Portal 切换记录无效，已暂停自动启动。');
    if (intent === 'automatic' && saved?.identity === identity && saved.phase !== 'cancelled') {
      this.holdMessage = saved.message || '上次 Portal 切换未完成，请点击启动按钮重试。';
      return false;
    }
    this.holdMessage = '';
    let changing = force || (saved?.identity === identity && saved.replacing === true);
    const remember = async (phase: Decision['phase'], message: string) => {
      this.holdMessage = message;
      await atomic(this.file, JSON.stringify({ schema: 1, identity, phase, message, replacing: changing } satisfies Decision));
    };
    try {
      const targets = await this.options.discover(connection, force);
      if (!targets.length && requireConflict) throw new Error('检测到实例冲突，但无法确认旧守护程序。已停止自动重试，请检查旧 Portal 后手动启动。');
      if (targets.some(item => !item.service)) {
        throw new Error(targets.filter(item => !item.service).map(item => `${item.root}：${item.problem}`).join('\n'));
      }
      if (targets.length || force) {
        await this.options.preflight(targets, force);
        const current = await this.options.discover(connection, force);
        if (current.some(item => !item.service || !targets.some(approved => approved.id === item.id))) throw new Error('旧 Portal 或守护配置在启动检查期间发生变化，未执行切换，请重试。');
        changing = true;
        await remember('stopping', '上次关闭旧 Portal 的过程未完成，已暂停自动启动，请手动重试。');
        for (const target of current) await this.options.stop(target, force);
        if ((await this.options.discover(connection, force)).length) throw new Error('旧 Portal 或守护程序尚未完全停止，未启动新实例。');
        await remember('starting', '上次启动客户端 Portal 的过程未完成，已暂停自动启动，请手动重试。');
      }
      await start(changing);
      await rm(this.file, { force: true });
      this.holdMessage = '';
      return true;
    } catch (error) {
      const message = redact((error as Error).message || String(error), [connection.token, connection.relaySecret]);
      await remember('blocked', `${message}\n已暂停自动切换和重试，请处理后点击启动按钮。`);
      throw new Error(this.holdMessage);
    }
  }
}
