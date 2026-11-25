// Filter out DSML/tool_call raw content
export function cleanContent(text: string, streaming = false) {
  if (!text) return "";
  const fences: string[] = [];
  text = text.replace(streaming ? /```[\s\S]*?(?:```|$)/g : /```[\s\S]*?```/g, (block: string) => {
    const key = `@@FENCE_${fences.length}@@`;
    fences.push(block);
    return key;
  });
  const trimmed = text.trim();
  const rawToolJson =
    /"name"\s*:\s*"(?:act|remember|learn)"\s*,\s*"args"\s*:/;
  if (/^[\[{]/.test(trimmed) && rawToolJson.test(trimmed)) return "";
  if (streaming) {
    // A tool marker can begin with a delta containing only "<". Hold the
    // ambiguous suffix until the next token identifies it as markup or prose.
    text = text.replace(/<[^<\n]*$/, (tail: string) => {
      const prefix = tail.toLowerCase().replaceAll("｜", "|").replace(/^<\//, "<");
      return ["<|dsml|", "<||dsml||", "<tool_calls", "<tool_use", "<tool_result", "<system"]
        .some(marker => marker.startsWith(prefix)) ? "" : tail;
    });
  }
  // Remove DSML lines — both half-width | and full-width ｜
  text = text.replace(/<\/?[|｜]+ *DSML *[|｜]+[^\n]*/g, "");
  text = text.replace(/^.*[|｜] *DSML *[|｜].*$/gm, "");
  // Remove raw tool_calls XML blocks (both formats)
  text = text.replace(
    /<tool_(?:calls|use|result)[\s\S]*?<\/tool_(?:calls|use|result)>/gi,
    "",
  );
  text = text.replace(/<\/?tool_calls>/gm, "");
  text = text.replace(/<[｜|][｜|]DSML[｜|][｜|]tool_calls>/gm, "");
  // Remove </invoke> style closers
  text = text.replace(/<\/[｜|][｜|]DSML[｜|][｜|]invoke>/gm, "");
  // Remove single-line raw JSON tool calls that sometimes leak from the stream.
  text = text.replace(
    /^\s*\{.*"name"\s*:\s*"(?:act|remember|learn)".*"args"\s*:.*\}\s*,?\s*$/gm,
    "",
  );
  // Remove explicit system wrapper noise without touching normal prose or code fences.
  text = text.replace(/<system[\s\S]*?<\/system>/gi, "");
  text = text.replace(
    /^\s*(?:\[system\]|system:)\s*(?:internal|debug|tool|prompt|instruction).*/gim,
    "",
  );
  text = text.replace(/@@FENCE_(\d+)@@/g, (_: string, i: string) => fences[Number(i)] || "");
  // Clean up excessive blank lines left behind
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  return text;
}
