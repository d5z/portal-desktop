export type ListPrefix = {
  indent: string;
  type: "ordered" | "unordered";
  number: number;
  marker: string;
};

type MatchedListPrefix = ListPrefix & { length: number };

function matchListPrefix(line: string): MatchedListPrefix | null {
  const ordered = /^(\s*)(\d+)([.)])(\s+)/.exec(line);
  if (ordered) {
    return {
      indent: ordered[1],
      type: "ordered",
      number: Number(ordered[2]),
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
  let fences = 0;
  let index = 0;
  while (index < pos) {
    const next = text.indexOf("```", index);
    if (next === -1 || next >= pos) break;
    fences += 1;
    index = next + 3;
  }
  return fences % 2 === 1;
}

function lineBounds(text: string, pos: number) {
  const start = text.lastIndexOf("\n", pos - 1) + 1;
  const nextBreak = text.indexOf("\n", pos);
  const end = nextBreak === -1 ? text.length : nextBreak;
  return { start, end };
}

function findPreviousListLineWithIndent(
  text: string,
  lineStart: number,
  indent: string,
): string | null {
  let cursor = lineStart - 1;
  while (cursor >= 0) {
    const start = text.lastIndexOf("\n", cursor) + 1;
    const end = text.indexOf("\n", start);
    const line = text.slice(start, end === -1 ? text.length : end);
    const prefix = matchListPrefix(line);
    if (prefix && prefix.indent === indent) return line;
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
  if (indentLen >= 2) {
    const targetIndent = matched.indent.slice(2);
    const parentLine = findPreviousListLineWithIndent(text, lineStart, targetIndent);
    const parent = parentLine ? matchListPrefix(parentLine) : null;
    if (parent) {
      const newLine = `${targetIndent}${parent.number}${parent.marker} `;
      const textAfter = text.slice(lineEnd);
      return {
        text: text.slice(0, lineStart) + newLine + textAfter,
        selection: lineStart + newLine.length,
      };
    }
  }
  const remainder = line.slice(matched.length).trimEnd();
  return {
    text: text.slice(0, lineStart) + remainder + text.slice(lineEnd),
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
    return emptyListShiftEnter(text, lineStart, lineEnd, line, matched);
  }

  let insertAt = start;
  while (insertAt > lineStart && text[insertAt - 1] === " ") insertAt -= 1;
  const insert = `\n${continuation}`;
  return {
    text: text.slice(0, insertAt) + insert + text.slice(start),
    selection: insertAt + insert.length,
  };
}

function atLineStartTabPoint(line: string, cursorInLine: number): boolean {
  if (cursorInLine === 0) return true;
  const matched = matchListPrefix(line);
  return matched !== null && cursorInLine <= matched.length;
}

function atLineStartShiftTabPoint(line: string, cursorInLine: number): boolean {
  if (cursorInLine === 0) return true;
  const matched = matchListPrefix(line);
  return matched !== null && cursorInLine <= matched.indent.length;
}

export function applyLineStartTab(
  text: string,
  start: number,
  end: number,
): { text: string; selection: number } | null {
  if (start !== end) return null;
  const { start: lineStart } = lineBounds(text, start);
  const line = text.slice(lineStart, lineBounds(text, start).end);
  if (!atLineStartTabPoint(line, start - lineStart)) return null;
  const insert = "  ";
  return {
    text: text.slice(0, lineStart) + insert + text.slice(lineStart),
    selection: start + insert.length,
  };
}

export function applyLineStartShiftTab(
  text: string,
  start: number,
  end: number,
): { text: string; selection: number } | null {
  if (start !== end) return null;
  const { start: lineStart } = lineBounds(text, start);
  const cursorInLine = start - lineStart;
  const line = text.slice(lineStart, lineBounds(text, start).end);
  if (!atLineStartShiftTabPoint(line, cursorInLine)) return null;
  if (!line.startsWith("  ")) return null;
  const { end: lineEnd } = lineBounds(text, start);
  const newLine = line.slice(2);
  return {
    text: text.slice(0, lineStart) + newLine + text.slice(lineEnd),
    selection: Math.max(lineStart, start - 2),
  };
}
