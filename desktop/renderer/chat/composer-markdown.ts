import type { Text } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { advanceCodeFence, type CodeFence } from "./markdown-fences";

class BulletWidget extends WidgetType {
  constructor(private readonly glyph: string, private readonly className = "cm-composer-bullet") { super(); }

  toDOM() {
    const bullet = document.createElement("span");
    bullet.className = this.className;
    bullet.textContent = this.glyph;
    bullet.setAttribute("aria-hidden", "true");
    return bullet;
  }
}

const bulletWidgets = ["•", "◦", "▪"].map((glyph) => new BulletWidget(glyph));
const dotWidget = new BulletWidget(".", "cm-composer-dot");

class IndentWidget extends WidgetType {
  constructor(private readonly depth: number) { super(); }

  toDOM() {
    const indent = document.createElement("span");
    indent.className = "cm-composer-list-indent";
    indent.style.width = `${this.depth * 22}px`;
    indent.setAttribute("aria-hidden", "true");
    return indent;
  }
}

function indentColumns(indent: string): number {
  let column = 0;
  for (const character of indent) column += character === "\t" ? 4 - column % 4 : 1;
  return column;
}

/** Decoration ranges alter only the view; EditorState.doc remains Markdown source. */
function buildDecorationSets(doc: Text): { decorations: DecorationSet; atomics: DecorationSet } {
  const ranges = [];
  const atomicRanges = [];
  let fence: CodeFence = null;
  const listContentColumns: number[] = [];
  for (let number = 1; number <= doc.lines; number++) {
    const line = doc.line(number);
    const source = line.text;
    const next = advanceCodeFence(source, fence);
    fence = next.fence;
    if (next.codeLine) { listContentColumns.length = 0; continue; }

    const heading = /^ {0,3}(#{1,3})([ \t]+)/.exec(source);
    if (heading) {
      listContentColumns.length = 0;
      ranges.push(Decoration.line({ attributes: { class: `cm-composer-heading-${heading[1].length}` } }).range(line.from));
      const replacement = Decoration.replace({}).range(line.from, line.from + heading[0].length);
      ranges.push(replacement);
      atomicRanges.push(replacement);
      continue;
    }

    const list = /^([ \t]*)(\d+[.)]|[-+*])([ \t]+)/.exec(source);
    if (!list) { if (source.trim()) listContentColumns.length = 0; continue; }
    const columns = indentColumns(list[1]);
    while (listContentColumns.length && columns < listContentColumns.at(-1)!) listContentColumns.pop();
    if (columns > (listContentColumns.at(-1) ?? 0) + 3) { listContentColumns.length = 0; continue; }
    const depth = listContentColumns.length;
    listContentColumns.push(columns + list[2].length + 1);
    if (list[1].length) {
      const replacement = Decoration.replace({ widget: new IndentWidget(depth) }).range(line.from, line.from + list[1].length);
      ranges.push(replacement);
      atomicRanges.push(replacement);
    }
    if (/^[-+*]$/.test(list[2])) {
      const from = line.from + list[1].length;
      const replacement = Decoration.replace({ widget: bulletWidgets[Math.min(depth, 2)] }).range(from, from + 1);
      ranges.push(replacement);
      atomicRanges.push(replacement);
    } else {
      const from = line.from + list[1].length;
      ranges.push(Decoration.mark({ class: "cm-composer-ordered" }).range(from, from + list[2].length));
      if (list[2].endsWith(")")) {
        const dot = Decoration.replace({ widget: dotWidget }).range(from + list[2].length - 1, from + list[2].length);
        ranges.push(dot);
        atomicRanges.push(dot);
      }
    }
  }
  return { decorations: Decoration.set(ranges, true), atomics: Decoration.set(atomicRanges, true) };
}

export function buildComposerDecorations(doc: Text): DecorationSet {
  return buildDecorationSets(doc).decorations;
}

const markupPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  atomics: DecorationSet;

  constructor(view: EditorView) {
    ({ decorations: this.decorations, atomics: this.atomics } = buildDecorationSets(view.state.doc));
  }

  update(update: ViewUpdate) {
    if (update.docChanged) ({ decorations: this.decorations, atomics: this.atomics } = buildDecorationSets(update.state.doc));
  }
}, { decorations: (plugin) => plugin.decorations });

export const composerMarkdown = [
  markupPlugin,
  EditorView.atomicRanges.of((view) => view.plugin(markupPlugin)?.atomics ?? Decoration.none),
];
