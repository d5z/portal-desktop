import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type RefObject } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { safeLink } from './markdown';
import { EditorState } from '@tiptap/pm/state';
import type { Extensions } from '@tiptap/core';

export interface ComposerHandle { focus: () => void; appendText: (text: string) => void }

export function MarkdownEditor({ value, onChange, inputRef, id, label, placeholder, disabled, suggestions, extensions = [] }: {
  value: string; onChange: (value: string) => void; inputRef: RefObject<ComposerHandle | null>;
  id?: string; label?: string; placeholder?: string; disabled?: boolean;
  suggestions?: { controls?: string; active?: string; autocomplete?: string };
  extensions?: Extensions;
}) {
  const latest = useRef(onChange);
  latest.current = onChange;
  const lastValue = useRef(value);
  const wantsFocus = useRef(false);
  const editor: Editor | null = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, isAllowedUri: url => Boolean(safeLink(url)) }, underline: false, trailingNode: false }),
      TableKit, TaskList, TaskItem.configure({ nested: true }),
      Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
      ...extensions,
    ],
    content: value,
    contentType: 'markdown',
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { id: id || '', class: 'markdown-input', role: 'textbox', 'aria-multiline': 'true',
        'aria-label': label || '输入内容', 'data-placeholder': placeholder || '', spellcheck: 'false', 'data-empty': String(!value) },
      handlePaste: (_view, event) => {
        if (event.clipboardData?.files.length) return false;
        const text = event.clipboardData?.getData('text/plain');
        if (!text || !editor) return false;
        event.preventDefault();
        // Keep pasted source intact until the user edits it; JSON switches to the code editor.
        if (editor.isEmpty) {
          lastValue.current = text;
          editor.commands.setContent(text, { contentType: 'markdown', emitUpdate: false });
          editor.view.dom.dataset.empty = String(editor.isEmpty);
          latest.current(text);
        } else {
          const parsed = editor.markdown!.parse(text);
          // A single paragraph replaces the selection inline, as native paste does.
          // Inserting a whole Markdown document here splits the surrounding paragraph.
          const content = parsed.content;
          editor.commands.insertContent(content?.length === 1 && content[0].type === 'paragraph'
            ? content[0].content || [] : content || []);
        }
        return true;
      },
      handleKeyDown: (_view, event): boolean => {
        if (event.key === 'Enter' && event.shiftKey && !event.isComposing) {
          return editor?.commands.enter() || false;
        }
        return false;
      },
    },
    onCreate: ({ editor }) => { editor.view.dom.dataset.empty = String(editor.isEmpty); },
    onUpdate: ({ editor }) => {
      editor.view.dom.dataset.empty = String(editor.isEmpty);
      const source = editor.isEmpty ? '' : editor.getMarkdown();
      lastValue.current = source;
      latest.current(source);
    },
  });
  useImperativeHandle(inputRef, () => ({
    focus: () => { wantsFocus.current = true; editor?.commands.focus('end'); },
    appendText: (text: string) => {
      if (!editor || !text.trim()) return;
      // Explicit text nodes keep Markdown-looking selections literal and preserve undo history.
      const paragraphs = text.trim().split(/\r?\n(?:[ \t]*\r?\n)+/).map(block => ({
        type: 'paragraph',
        content: block.split(/\r?\n/).flatMap((line, index) => [
          ...(index ? [{ type: 'hardBreak' }] : []),
          ...(line ? [{ type: 'text', text: line }] : []),
        ]),
      }));
      const doc = editor.state.doc, last = doc.lastChild;
      // Reuse the empty input/trailing paragraph instead of surrounding the text
      // with empty blocks. Keep this one transaction so Undo restores the draft.
      const end = doc.content.size;
      const from = last?.type.name === 'paragraph' && last.content.size === 0
        ? end - last.nodeSize : end;
      editor.commands.insertContentAt({ from, to: end }, paragraphs);
    },
  }), [editor]);
  useEffect(() => { if (editor && wantsFocus.current) editor.commands.focus('end'); }, [editor]);
  useLayoutEffect(() => {
    if (!editor || value === lastValue.current) return;
    lastValue.current = value;
    editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
    editor.view.dom.dataset.empty = String(editor.isEmpty);
    // External draft replacement (including send/scene changes) starts fresh undo history.
    editor.view.updateState(EditorState.create({ schema: editor.schema, doc: editor.state.doc, plugins: editor.state.plugins }));
  }, [editor, value]);
  useEffect(() => { editor?.setEditable(!disabled, false); }, [editor, disabled]);
  useEffect(() => {
    if (!editor) return;
    for (const [attribute, value] of Object.entries({ 'aria-controls': suggestions?.controls, 'aria-activedescendant': suggestions?.active, 'aria-autocomplete': suggestions?.autocomplete })) {
      if (value) editor.view.dom.setAttribute(attribute, value);
      else editor.view.dom.removeAttribute(attribute);
    }
  }, [editor, suggestions?.controls, suggestions?.active, suggestions?.autocomplete]);
  return <EditorContent editor={editor} className="markdown-input-host" />;
}
