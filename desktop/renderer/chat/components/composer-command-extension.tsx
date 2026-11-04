import { Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { AllSelection, Plugin, Selection, type EditorState } from '@tiptap/pm/state';
import { composerCommands } from '../models/composer-commands';
import { ComposerMenuIcon } from '../../shared/icons/composer-menu';

const nodeName = 'composerCommand';
const commandFor = (token: string) => composerCommands.find(command =>
  [command.id, ...command.aliases].some(name => '/' + name.toLowerCase() === token.toLowerCase()));

/** Keep the draft as slash source; only complete leading commands become atomic labels. */
function normalizeCommands(state: EditorState) {
  const existing: { from: number; to: number; token: string }[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name === nodeName) existing.push({ from: pos, to: pos + node.nodeSize, token: node.attrs.token });
  });
  const desired: { from: number; to: number; token: string; id: string }[] = [];
  const first = state.doc.firstChild;
  if (first?.type.name === 'paragraph') {
    let source = '';
    const positions: number[] = [];
    first.forEach((node, offset) => {
      const from = offset + 1;
      const text = node.marks.length ? '\ufffc' : node.isText ? node.text! : node.type.name === nodeName ? String(node.attrs.token) : '\ufffc';
      for (let i = 0; i < text.length; i++) positions[source.length + i] = from + (node.isText ? i : 0);
      source += text;
      positions[source.length] = from + node.nodeSize;
    });
    const pattern = /\s*(\/[^\s/]+)(\s+|$)/gy;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source))) {
      const token = match[1], command = commandFor(token);
      if (!command) break;
      const start = match.index + match[0].indexOf('/');
      const from = positions[start], to = positions[start + token.length];
      // An unfinished token stays editable while the slash picker is filtering.
      if (!match[2] && !existing.some(node => node.from === from && node.to === to)) break;
      desired.push({ from, to, token, id: command.id });
    }
  }
  const changes = [
    ...existing.filter(node => !desired.some(next => next.from === node.from && next.to === node.to))
      .map(node => ({ ...node, content: state.schema.text(node.token) })),
    ...desired.filter(node => !existing.some(prev => prev.from === node.from && prev.to === node.to))
      .map(node => ({ ...node, content: state.schema.nodes[nodeName].create({ id: node.id, token: node.token }) })),
  ];
  if (!changes.length) return null;
  const tr = state.tr;
  for (const change of changes.sort((a, b) => b.from - a.from)) tr.replaceWith(change.from, change.to, change.content);
  return tr;
}

function CommandLabel({ node, selected }: NodeViewProps) {
  const command = commandFor(node.attrs.token);
  return <NodeViewWrapper as="span" className={`composer-command-token${selected ? ' is-selected' : ''}`}
    style={{ whiteSpace: 'nowrap' }} contentEditable={false} data-command={command?.id} title={node.attrs.token} aria-label={`${command?.label || node.attrs.token} (${node.attrs.token})`}>
    {command && <ComposerMenuIcon kind={command.id}/>}<span>{command?.label || node.attrs.token}</span>
  </NodeViewWrapper>;
}

const ComposerCommandNode = Node.create({
  name: nodeName,
  group: 'inline',
  inline: true,
  atom: true,
  marks: '',
  addAttributes: () => ({ id: { default: '' }, token: { default: '' } }),
  renderHTML: ({ node }) => ['span', { 'data-composer-command': node.attrs.id }, node.attrs.token],
  renderText: ({ node }) => node.attrs.token,
  renderMarkdown: node => node.attrs?.token || '',
  addNodeView: () => ReactNodeViewRenderer(CommandLabel),
  addKeyboardShortcuts() {
    const remove = (direction: 'before' | 'after') => {
      const { selection } = this.editor.state;
      if (!selection.empty) return false;
      const node = direction === 'before' ? selection.$from.nodeBefore : selection.$from.nodeAfter;
      if (node?.type.name !== nodeName) return false;
      const from = selection.from - (direction === 'before' ? node.nodeSize : 0);
      return this.editor.commands.deleteRange({ from, to: from + node.nodeSize });
    };
    const collapseAll = (end: boolean) => {
      const { state, view } = this.editor;
      if (!(state.selection instanceof AllSelection)) return false;
      view.dispatch(state.tr.setSelection(end ? Selection.atEnd(state.doc) : Selection.atStart(state.doc)));
      return true;
    };
    return { Backspace: () => remove('before'), Delete: () => remove('after'),
      ArrowLeft: () => collapseAll(false), ArrowRight: () => collapseAll(true) };
  },
  onCreate() {
    const tr = normalizeCommands(this.editor.state);
    if (tr) this.editor.view.dispatch(tr);
  },
  addProseMirrorPlugins() {
    return [new Plugin({ appendTransaction: (transactions, _oldState, state) =>
      transactions.some(tr => tr.docChanged) ? normalizeCommands(state) : null })];
  },
});

export const composerEditorExtensions = [ComposerCommandNode];
