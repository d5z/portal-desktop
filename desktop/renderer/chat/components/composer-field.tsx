import { memo, useLayoutEffect, useRef, type RefObject } from "react";
import { EditorState, Prec, type Extension } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { composerMarkdown } from "../composer-markdown";
import { parseListPrefix, renumberOrderedLists } from "../list-continuation";
import { codeFenceLines } from "../markdown-fences";

type ComposerFieldProps = {
  editorRef: RefObject<EditorView | null>;
  id: string;
  className?: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent, view: EditorView) => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
};

export const ComposerField = memo(function ComposerField({
  editorRef,
  id,
  className = "",
  value,
  placeholder: placeholderText,
  onChange,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
}: ComposerFieldProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const extensionsRef = useRef<Extension[] | null>(null);
  const callbacks = useRef({ onChange, onKeyDown, onCompositionStart, onCompositionEnd });
  callbacks.current = { onChange, onKeyDown, onCompositionStart, onCompositionEnd };

  useLayoutEffect(() => {
    if (!hostRef.current) return;
    const extensions: Extension[] = [
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ "aria-label": "message input", spellcheck: "false" }),
      placeholder(placeholderText),
      history(),
      keymap.of([...historyKeymap, ...defaultKeymap]),
      composerMarkdown,
      EditorState.transactionFilter.of((transaction) => {
        if (!transaction.docChanged || (!transaction.isUserEvent("delete") && !transaction.isUserEvent("input"))) return transaction;
        const before = transaction.startState.doc;
        let deletedIndent: string | null = null;
        let deletionAt = 0;
        let removedMarkerLine: number | null = null;
        let fencedLines: boolean[] | undefined;
        transaction.changes.iterChanges((from, to, newFrom) => {
          if (deletedIndent !== null) return;
          if (transaction.isUserEvent("input") && before.lines === transaction.newDoc.lines) {
            const oldLine = before.lineAt(from);
            const newLine = transaction.newDoc.line(oldLine.number);
            const newPrefix = parseListPrefix(newLine.text);
            const nextPrefix = oldLine.number < transaction.newDoc.lines
              ? parseListPrefix(transaction.newDoc.line(oldLine.number + 1).text) : null;
            if (parseListPrefix(oldLine.text)?.type !== "ordered" && newPrefix?.type === "ordered"
              && nextPrefix?.type === "ordered" && nextPrefix.indent === newPrefix.indent
              && nextPrefix.marker === newPrefix.marker && nextPrefix.number === newPrefix.number
              && !codeFenceLines(transaction.newDoc.toString().split("\n"))[oldLine.number - 1]) {
              deletedIndent = newPrefix.indent;
              deletionAt = newLine.from;
            }
          }
          if (deletedIndent !== null || !transaction.isUserEvent("delete") || from === to) return;
          for (let number = before.lineAt(from).number; number <= before.lineAt(to).number; number += 1) {
            const line = before.line(number);
            if (line.from < from || line.to > to) continue;
            const prefix = parseListPrefix(line.text);
            if (prefix?.type !== "ordered") continue;
            fencedLines ??= codeFenceLines(before.toString().split("\n"));
            if (fencedLines[number - 1]) continue;
            deletedIndent = prefix.indent;
            deletionAt = newFrom;
            break;
          }
          if (deletedIndent !== null) return;
          if (!before.sliceString(from, to).includes("\n") && before.lines === transaction.newDoc.lines) {
            const oldLine = before.lineAt(from);
            const oldPrefix = parseListPrefix(oldLine.text);
            if (oldPrefix?.type === "ordered"
              && parseListPrefix(transaction.newDoc.line(oldLine.number).text)?.type !== "ordered") {
              fencedLines ??= codeFenceLines(before.toString().split("\n"));
              if (!fencedLines[oldLine.number - 1]) {
                deletedIndent = oldPrefix.indent;
                removedMarkerLine = oldLine.number - 1;
                deletionAt = transaction.newDoc.line(oldLine.number).from;
              }
            }
            return;
          }
          const afterDoc = transaction.newDoc;
          const line = afterDoc.lineAt(newFrom).number;
          for (const number of [line - 1, line]) {
            if (number < 1 || number >= afterDoc.lines) continue;
            const left = parseListPrefix(afterDoc.line(number).text);
            const right = parseListPrefix(afterDoc.line(number + 1).text);
            if (left?.type !== "ordered" || right?.type !== "ordered"
              || left.indent !== right.indent || left.marker !== right.marker) continue;
            const fenced = codeFenceLines(afterDoc.toString().split("\n"));
            if (fenced[number - 1] || fenced[number]) continue;
            deletedIndent = left.indent;
            deletionAt = newFrom;
            break;
          }
        });
        if (deletedIndent === null) return transaction;

        const after = transaction.newDoc.toString();
        const lines = after.split("\n");
        const source = removedMarkerLine === null ? after : lines.filter((_, i) => i !== removedMarkerLine).join("\n");
        const updated = renumberOrderedLists(source, deletionAt, deletedIndent).text.split("\n");
        if (removedMarkerLine !== null) updated.splice(removedMarkerLine, 0, lines[removedMarkerLine]);
        if (updated.join("\n") === after) return transaction;
        const changes = [];
        let lineStart = 0;
        for (let i = 0; i < lines.length; i += 1) {
          if (lines[i] !== updated[i]) {
            const oldNumber = /^(\s*)(\d+)(?=[.)]\s)/.exec(lines[i]);
            const newNumber = /^(\s*)(\d+)(?=[.)]\s)/.exec(updated[i]);
            if (!oldNumber || !newNumber) return transaction;
            const from = lineStart + oldNumber[1].length;
            changes.push({ from, to: from + oldNumber[2].length, insert: newNumber[2] });
          }
          lineStart += lines[i].length + 1;
        }
        return [transaction, { changes, sequential: true }];
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) callbacks.current.onChange(update.state.doc.toString());
      }),
      Prec.highest(EditorView.domEventHandlers({
        keydown(event, currentView) {
          callbacks.current.onKeyDown(event, currentView);
          return event.defaultPrevented;
        },
        compositionstart() {
          callbacks.current.onCompositionStart();
          return false;
        },
        compositionend() {
          callbacks.current.onCompositionEnd();
          return false;
        },
      })),
    ];
    extensionsRef.current = extensions;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({ doc: value, extensions }),
    });
    editorRef.current = view;
    return () => {
      editorRef.current = null;
      extensionsRef.current = null;
      view.destroy();
    };
    // The view owns its DOM and reads live callbacks from the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const view = editorRef.current;
    if (!view || view.state.doc.toString() === value || !extensionsRef.current) return;
    const focused = view.hasFocus;
    view.setState(EditorState.create({
      doc: value,
      selection: { anchor: value.length },
      extensions: extensionsRef.current,
    }));
    if (focused) view.focus();
  }, [editorRef, value]);

  return <div id={id} ref={hostRef} data-has-draft={value.length > 0} className={`composer-editor ${className}`.trim()} />;
});
