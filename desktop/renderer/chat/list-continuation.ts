import { advanceCodeFence, codeFenceLines, type CodeFence } from "./markdown-fences";

export type ListPrefix = {
  indent: string;
  type: "ordered" | "unordered";
  number: number;
  marker: string;
};

type MatchedListPrefix = ListPrefix & { length: number; numberLength: number };

function matchListPrefix(line: string): MatchedListPrefix | null {
  const ordered = /^(\s*)(\d+)([.)])(\s+)/.exec(line);
  if (ordered) {
    return {
      indent: ordered[1],
      type: "ordered",
      number: Number(ordered[2]),
      numberLength: ordered[2].length,
      marker: ordered[3],
      length: ordered[0].length,
    };
  }
  const bullet = /^(\s*)([-+*])(\s+)/.exec(line);
  if (bullet) {
    return {
      indent: bullet[1],
      type: "unordered",
      number: 0,
      numberLength: 0,
      marker: bullet[2],
      length: bullet[0].length,
    };
  }
  return null;
}

export function parseListPrefix(line: string): ListPrefix | null {
  const matched = matchListPrefix(line);
  if (!matched) return null;
  return {
    indent: matched.indent,
    type: matched.type,
    number: matched.number,
    marker: matched.marker,
  };
}

export function selectedOrderedIndents(text: string, start: number, end: number): string[] {
  let fence: CodeFence = null;
  let lineStart = 0;
  const lastSelected = Math.max(start, end - 1);
  const indents = new Set<string>();
  for (const line of text.split("\n")) {
    if (lineStart > lastSelected) break;
    const next = advanceCodeFence(line, fence);
    fence = next.fence;
    if (!next.codeLine && lineStart + line.length >= start) {
      const prefix = matchListPrefix(line);
      if (prefix?.type === "ordered") indents.add(prefix.indent);
    }
    lineStart += line.length + 1;
  }
  return [...indents];
}

export function buildContinuation(prefix: ListPrefix, line?: string): string {
  if (line !== undefined) {
    const matched = matchListPrefix(line);
    if (matched && !/\S/.test(line.slice(matched.length))) return "";
  }
  if (prefix.type === "ordered") {
    return `${prefix.indent}${prefix.number + 1}${prefix.marker} `;
  }
  return `${prefix.indent}${prefix.marker} `;
}

export function isInCodeFence(text: string, pos: number): boolean {
  let fence: CodeFence = null;
  let start = 0;
  while (start <= text.length) {
    const newline = text.indexOf("\n", start);
    const end = newline === -1 ? text.length : newline;
    const next = advanceCodeFence(text.slice(start, end), fence);
    if (pos <= end) return next.codeLine;
    fence = next.fence;
    if (newline === -1) break;
    start = newline + 1;
  }
  return false;
}

function lineBounds(text: string, pos: number) {
  const start = text.lastIndexOf("\n", pos - 1) + 1;
  const nextBreak = text.indexOf("\n", pos);
  const end = nextBreak === -1 ? text.length : nextBreak;
  return { start, end };
}

function replaceOrderedNumber(line: string, matched: MatchedListPrefix, newNum: number): string {
  const suffix = line.slice(matched.indent.length + matched.numberLength + matched.marker.length);
  return `${matched.indent}${newNum}${matched.marker}${suffix}`;
}

/** Renumber only contiguous lists touched by the edit, including their nearby siblings. */
export function renumberOrderedLists(
  text: string,
  selection: number,
  previousIndent?: string | string[],
  selectionEnd?: number,
): { text: string; selection: number; selectionEnd?: number } {
  const lines = text.split("\n");
  const fencedLines = codeFenceLines(lines);
  const lineAt = (point: number) => {
    let pos = 0;
    for (let i = 0; i < lines.length; i += 1) {
      if (point <= pos + lines[i].length) return i;
      pos += lines[i].length + 1;
    }
    return lines.length - 1;
  };
  const selLine = lineAt(selection);
  const lastSelectedLine = lineAt(Math.max(selection, (selectionEnd ?? selection) - 1));

  const listAt = (i: number) => i >= 0 && i < lines.length && !fencedLines[i] ? matchListPrefix(lines[i]) : null;
  const neighboringList = (i: number, direction: -1 | 1) => {
    let next = i + direction;
    while (next >= 0 && next < lines.length && !lines[next].trim()) next += direction;
    return listAt(next) ? next : -1;
  };
  const centers: number[] = [];
  for (let i = selLine; i <= lastSelectedLine; i += 1) {
    if (listAt(i)?.type === "ordered") centers.push(i);
  }
  if (!centers.length) {
    const nearby = listAt(selLine) ? selLine : neighboringList(selLine, -1) >= 0
      ? neighboringList(selLine, -1) : neighboringList(selLine, 1);
    if (nearby < 0) return { text, selection, ...(selectionEnd === undefined ? {} : { selectionEnd }) };
    centers.push(nearby);
  }

  const affected = new Set(previousIndent === undefined ? [] : Array.isArray(previousIndent) ? previousIndent : [previousIndent]);
  for (const center of centers) affected.add(matchListPrefix(lines[center])!.indent);
  const lineStarts: number[] = [];
  let lineStart = 0;
  for (let i = 0; i < lines.length; i += 1) {
    lineStarts.push(lineStart);
    lineStart += lines[i].length + 1;
  }
  let newSelection = selection;
  let newSelectionEnd = selectionEnd;
  let lastProcessed = -1;
  for (const center of centers) {
    if (center <= lastProcessed) continue;
    let first = center;
    let last = center;
    while (neighboringList(first, -1) >= 0) first = neighboringList(first, -1);
    while (neighboringList(last, 1) >= 0) last = neighboringList(last, 1);
    lastProcessed = last;
    const stack: Array<{ indent: string; type: ListPrefix["type"]; marker: string; number: number }> = [];
    for (let i = first; i <= last; i += 1) {
      const oldLine = lines[i];
      const prefix = listAt(i);
      if (!prefix) continue;
      while (stack.length && stack.at(-1)!.indent.length > prefix.indent.length) stack.pop();
      const previous = stack.at(-1);
      const sameLevel = previous?.indent === prefix.indent;
      const number = prefix.type === "ordered" && sameLevel && previous.type === "ordered" && previous.marker === prefix.marker
        ? previous.number + 1
        : i === first && selection > lineStarts[i] + prefix.indent.length ? prefix.number : 1;
      const level = { indent: prefix.indent, type: prefix.type, marker: prefix.marker, number };
      if (sameLevel) stack[stack.length - 1] = level;
      else stack.push(level);

      if (prefix.type === "ordered" && affected.has(prefix.indent)) {
        const newLine = replaceOrderedNumber(oldLine, prefix, number);
        const delta = newLine.length - oldLine.length;
        const numberEnd = lineStarts[i] + prefix.indent.length + prefix.numberLength;
        const moves = (point: number) => point >= numberEnd;
        if (moves(selection)) newSelection += delta;
        if (selectionEnd !== undefined && moves(selectionEnd)) newSelectionEnd! += delta;
        lines[i] = newLine;
      }
    }
  }
  return { text: lines.join("\n"), selection: newSelection, ...(newSelectionEnd === undefined ? {} : { selectionEnd: newSelectionEnd }) };
}

function findPreviousListLineWithIndent(
  text: string,
  lineStart: number,
  indent: string,
  childIndentLength: number,
): string | null {
  let cursor = lineStart - 1;
  while (cursor >= 0) {
    const start = text.lastIndexOf("\n", cursor) + 1;
    const end = text.indexOf("\n", start);
    const line = text.slice(start, end === -1 ? text.length : end);
    if (!line.trim()) { cursor = start - 2; continue; }
    const prefix = matchListPrefix(line);
    if (!prefix) return null;
    if (prefix.indent === indent && prefix.length <= childIndentLength) return line;
    cursor = start - 2;
  }
  return null;
}

function emptyListShiftEnter(
  text: string,
  lineStart: number,
  lineEnd: number,
  line: string,
  matched: MatchedListPrefix,
): { text: string; selection: number } {
  const indentLen = matched.indent.length;
  if (indentLen > 0) {
    const targetIndent = matched.indent.slice(0, previousShallowerListIndent(text, lineStart, indentLen));
    const parentLine = findPreviousListLineWithIndent(text, lineStart, targetIndent, indentLen);
    const parent = parentLine ? matchListPrefix(parentLine) : null;
    const marker = parent
      ? `${parent.type === "ordered" ? parent.number : ""}${parent.marker}`
      : `${matched.type === "ordered" ? matched.number : ""}${matched.marker}`;
    const newLine = `${targetIndent}${marker} `;
    return {
      text: text.slice(0, lineStart) + newLine + text.slice(lineEnd),
      selection: lineStart + newLine.length,
    };
  }
  const remainder = line.slice(matched.length).trimEnd();
  let textAfter = text.slice(lineEnd);
  if ((lineStart > 0 || matched.type === "unordered") && remainder === "" && textAfter.startsWith("\n")) {
    textAfter = textAfter.slice(1);
  }
  return {
    text: text.slice(0, lineStart) + remainder + textAfter,
    selection: lineStart + remainder.length,
  };
}

export function applyShiftEnterListContinue(
  text: string,
  start: number,
  end: number,
): { text: string; selection: number } | null {
  if (start !== end) return null;
  if (isInCodeFence(text, start)) return null;

  const { start: lineStart, end: lineEnd } = lineBounds(text, start);
  const line = text.slice(lineStart, lineEnd);
  const matched = matchListPrefix(line);
  if (!matched) return null;

  const continuation = buildContinuation(matched, line);
  if (continuation === "") {
    const exited = emptyListShiftEnter(text, lineStart, lineEnd, line, matched);
    const demotedLine = lineBounds(exited.text, exited.selection);
    const demoted = matchListPrefix(exited.text.slice(demotedLine.start, demotedLine.end));
    return matched.type === "ordered" || (matched.indent.length > 0 && demoted?.type === "ordered")
      ? renumberOrderedLists(exited.text, exited.selection, [matched.indent, demoted?.indent ?? matched.indent])
      : exited;
  }

  if (start === lineStart && matched.type === "ordered") {
    const newItem = `${matched.indent}1${matched.marker} `;
    const insert = `${newItem}\n`;
    const inserted = {
      text: text.slice(0, lineStart) + insert + text.slice(lineStart),
      selection: lineStart + newItem.length,
    };
    return renumberOrderedLists(inserted.text, inserted.selection, matched.indent);
  }

  const minInsert = lineStart + matched.length;
  const textStart = Math.max(start, minInsert);
  let insertAt = textStart;
  while (insertAt > minInsert && text[insertAt - 1] === " ") insertAt -= 1;
  const insert = `\n${continuation}`;
  const continued = {
    text: text.slice(0, insertAt) + insert + text.slice(textStart),
    selection: insertAt + insert.length,
  };
  return matched.type === "ordered"
    ? renumberOrderedLists(continued.text, continued.selection, matched.indent)
    : continued;
}

export function applyLineStartTab(
  text: string,
  start: number,
  end: number,
): { text: string; selection: number; selectionEnd?: number } | null {
  return changeSelectedIndent(text, start, end, false);
}

export function applyLineStartShiftTab(
  text: string,
  start: number,
  end: number,
): { text: string; selection: number; selectionEnd?: number } | null {
  return changeSelectedIndent(text, start, end, true);
}

function changeSelectedIndent(
  text: string, start: number, end: number, outdent: boolean,
): { text: string; selection: number; selectionEnd?: number } {
  const first = lineBounds(text, start).start;
  const last = lineBounds(text, Math.max(start, end - 1)).start;
  const fenced = codeFenceLines(text.split("\n"));
  const previousIndents = selectedOrderedIndents(text, start, end);
  const edits: Array<{ from: number; to: number; insert: string }> = [];
  let lineNumber = text.slice(0, first).split("\n").length;
  for (let at = first; at <= last;) {
    const { end: lineEnd } = lineBounds(text, at);
    const line = text.slice(at, lineEnd);
    const prefix = fenced[lineNumber - 1] ? null : matchListPrefix(line);
    const indent = /^[ \t]*/.exec(line)![0];
    const count = prefix
      ? indent.length - previousShallowerListIndent(text, at, indent.length)
      : Math.min(indent.length, 2);
    if (outdent) {
      edits.push({ from: at, to: at + count, insert: "" });
    } else if (!prefix) {
      edits.push({ from: at, to: at, insert: "  " });
    } else {
      const parent = previousListAtIndent(text, at, indent.length);
      if (parent && parent.length > indent.length) {
        edits.push({ from: at, to: at, insert: " ".repeat(parent.length - indent.length) });
      }
    }
    if (lineEnd === text.length) break;
    at = lineEnd + 1;
    lineNumber += 1;
  }
  if (!edits.some((edit) => edit.insert.length || edit.to > edit.from)) {
    return { text, selection: start, ...(start === end ? {} : { selectionEnd: end }) };
  }
  let nextText = "";
  let cursor = 0;
  for (const edit of edits) {
    nextText += text.slice(cursor, edit.from) + edit.insert;
    cursor = edit.to;
  }
  nextText += text.slice(cursor);
  const mapPoint = (point: number) => {
    let delta = 0;
    for (const edit of edits) {
      if (point < edit.from) break;
      if (point <= edit.to) return edit.from + delta + edit.insert.length;
      delta += edit.insert.length - (edit.to - edit.from);
    }
    return point + delta;
  };
  const selection = mapPoint(start);
  const selectionEnd = start === end ? undefined : mapPoint(end);
  return previousIndents.length
    ? renumberOrderedLists(nextText, selection, previousIndents, selectionEnd)
    : { text: nextText, selection, ...(selectionEnd === undefined ? {} : { selectionEnd }) };
}

function previousListAtIndent(text: string, lineStart: number, indentLength: number): MatchedListPrefix | null {
  let cursor = lineStart - 1;
  while (cursor >= 0) {
    const start = text.lastIndexOf("\n", cursor - 1) + 1;
    const line = text.slice(start, cursor);
    if (!line.trim()) { cursor = start - 1; continue; }
    const prefix = matchListPrefix(line);
    if (!prefix) return null;
    if (prefix.indent.length === indentLength) return prefix;
    cursor = start - 1;
  }
  return null;
}

function previousShallowerListIndent(text: string, lineStart: number, indentLength: number): number {
  let cursor = lineStart - 1;
  while (cursor >= 0) {
    const start = text.lastIndexOf("\n", cursor - 1) + 1;
    const line = text.slice(start, cursor);
    if (!line.trim()) { cursor = start - 1; continue; }
    const prefix = matchListPrefix(line);
    if (!prefix) break;
    if (prefix.indent.length < indentLength) return prefix.indent.length;
    cursor = start - 1;
  }
  return 0;
}
