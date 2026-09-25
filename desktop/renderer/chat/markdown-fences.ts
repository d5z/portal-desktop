export type CodeFence = { marker: "`" | "~"; length: number } | null;

/** Treat only Markdown fence lines as delimiters; inline ticks stay ordinary text. */
export function advanceCodeFence(line: string, fence: CodeFence): { fence: CodeFence; codeLine: boolean } {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (fence) {
    const closes = Boolean(match && match[1][0] === fence.marker && match[1].length >= fence.length && !match[2].trim());
    return { fence: closes ? null : fence, codeLine: true };
  }
  const opens = Boolean(match && (match[1][0] !== "`" || !match[2].includes("`")));
  return {
    fence: opens ? { marker: match![1][0] as "`" | "~", length: match![1].length } : null,
    codeLine: opens,
  };
}

export function codeFenceLines(lines: string[]): boolean[] {
  let fence: CodeFence = null;
  return lines.map((line) => {
    const next = advanceCodeFence(line, fence);
    fence = next.fence;
    return next.codeLine;
  });
}
