import { Service, type Context } from '@deepseek-ai/cordis';
import type { DshCommand } from '../../../shared/dsh-plugins';

type Command = DshCommand & { handler(input: { rawInput: string }): unknown };

/** Plugin commands execute locally; no synthetic Harness session or agent. */
export class LocalCommands extends Service {
  private entries = new Map<string, Command>();
  constructor(ctx: Context) { super(ctx, 'commands'); }
  register(command: Command) {
    if (!/^[\w-]+$/.test(command.name) || typeof command.handler !== 'function') throw new Error('无效插件命令');
    if (this.entries.has(command.name)) throw new Error(`插件命令重复：${command.name}`);
    this.entries.set(command.name, command);
    return this.ctx.effect(() => () => { this.entries.delete(command.name); });
  }
  list() { return [...this.entries.values()].map(({ name, description, input }) => ({ name, description, input })); }
  async execute(_sessionId: unknown, input: unknown, attachments: unknown = []) {
    if (typeof input !== 'string' || !Array.isArray(attachments) || attachments.length) throw new Error('插件命令仅支持文本输入');
    const match = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(input.trim());
    const command = match && this.entries.get(match[1]);
    if (!command) throw new Error('未知插件命令');
    return command.handler({ rawInput: match?.[2] ?? '' });
  }
}
