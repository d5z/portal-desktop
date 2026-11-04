/** Only complete objects/arrays are inferred; ordinary prose remains Markdown. */
export function detectStructuredText(source: string): 'json' | 'jsonl' | undefined {
  const text = source.trim();
  if (!/^[{[]/.test(text)) return;
  try {
    const value = JSON.parse(text);
    if (value !== null && typeof value === 'object') return 'json';
  } catch { /* It may be a sequence of JSON records. */ }
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return;
  try {
    if (lines.every(line => {
      const value = JSON.parse(line);
      return value !== null && typeof value === 'object';
    })) return 'jsonl';
  } catch { /* Incomplete streams and invalid JSON stay as source. */ }
}

/** Format whitespace only: preserve large numbers, duplicate keys and escapes. */
export function formatJSON(source: string): string | undefined {
  try { JSON.parse(source); } catch { return; }
  let result = '', depth = 0, quoted = false, escaped = false;
  const newline = () => '\n' + '  '.repeat(depth);
  const text = source.trim();
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      result += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') { quoted = true; result += char; }
    else if (/\s/.test(char)) continue;
    else if (char === '{' || char === '[') {
      result += char;
      if (text.slice(i + 1).trimStart()[0] === (char === '{' ? '}' : ']')) {
        while (/\s/.test(text[i + 1])) i++;
        result += text[++i];
      } else { depth++; result += newline(); }
    } else if (char === '}' || char === ']') { depth--; result += newline() + char; }
    else if (char === ',') result += ',' + newline();
    else if (char === ':') result += ': ';
    else result += char;
  }
  return result;
}
