export const composerCommands = [
  { id: 'image', label: '出图', description: '根据描述生成或编辑图片', aliases: ['出图', '图片', 'imagegen'] },
  { id: 'ui', label: '智能 UI', description: '生成或修改可交互界面', aliases: ['智能UI', '智能ui', '界面'] },
  { id: 'doc', label: '生成文档', description: '生成 HTML 页面或 Markdown 文档', aliases: ['文档', 'html', 'md', 'markdown', 'document'] },
  { id: 'computer', label: '使用云电脑', description: '在云电脑上执行任务、生成并交付文件', aliases: ['云电脑', '电脑', 'cloud'] },
  { id: 'subagent', label: 'Subagent', description: '委派子代理处理任务并汇总结果', aliases: ['子代理', 'agent'] },
] as const;
export type ComposerCommand = typeof composerCommands[number];
export type ComposerCommandId = ComposerCommand['id'];

/** Desktop owns local subagent configuration; remote clients may not expose it. */
export function canUseComposerCommand(command: ComposerCommandId, state: { subagentConfigured?: boolean; subagentEnabled?: boolean }, onConfigureSubagent?: () => void): boolean {
  if (command === 'subagent' && onConfigureSubagent && (state.subagentConfigured !== true || state.subagentEnabled === false)) {
    onConfigureSubagent();
    return false;
  }
  return true;
}

function findCommand(token: string) {
  return composerCommands.find(command => [command.id, ...command.aliases].some(name => name.toLowerCase() === token.toLowerCase()));
}

/** Only leading, complete tokens are commands. Paths, prose and code stay literal. */
export function parseComposerCommands(text: string): { commands: ComposerCommandId[]; rest: string; prefix: string } {
  const commands: ComposerCommandId[] = [];
  let rest = text.trimStart();
  let prefix = text.slice(0, text.length - rest.length);
  while (rest.startsWith('/')) {
    const match = /^\/([^\s/]+)(\s+|$)/u.exec(rest);
    const command = match && findCommand(match[1]);
    if (!match || !command) break;
    if (!commands.includes(command.id)) commands.push(command.id);
    prefix += match[0];
    rest = rest.slice(match[0].length);
  }
  return { commands, rest, prefix };
}

export function composerCommandQuery(text: string): string | null {
  // The final token remains a query until a space commits it.
  const match = /^(.*?)\/([^\s/]*)$/su.exec(text);
  if (!match || parseComposerCommands(match[1]).rest.trim()) return null;
  return match[2].toLowerCase();
}

export function matchingComposerCommands(query: string) {
  return composerCommands.filter(command => [command.id, command.label, ...command.aliases].some(value => value.toLowerCase().includes(query)));
}

export function insertComposerCommand(text: string, id: ComposerCommandId): string {
  const query = composerCommandQuery(text);
  const base = query === null ? text : text.slice(0, text.lastIndexOf('/'));
  const parsed = parseComposerCommands(base);
  if (parsed.commands.includes(id)) return base.trimEnd() + ' ';
  return `${parsed.prefix}${parsed.prefix && !/\s$/.test(parsed.prefix) ? ' ' : ''}/${id} ${parsed.rest}`;
}
