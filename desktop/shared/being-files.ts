/** Public delivery metadata. Credentials are never part of this protocol. */
export interface BeingFile {
  path: string;
  name: string;
  url: string;
  size?: number;
  sha256?: string;
  content_type?: string;
  caption?: string;
}
export type BeingFiles = { files: BeingFile[]; error?: never } | { error: string; files?: never };

export function workspacePath(value: unknown, root = false): string {
  if (typeof value !== 'string' || value.length > 4096 || /[\\\x00-\x1f\x7f]/.test(value) ||
      (!value && !root) || (value && value.split('/').some(part => !part || part === '.' || part === '..')))
    throw new Error('请使用工作区内的相对路径，不能包含空目录、点路径或反斜杠。');
  return value;
}

/** null means an ordinary URL; an empty reference is a malformed private-file URL. */
export function homeFileReference(value: string): { path?: string } | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.hostname !== 'home.beings.town' || url.pathname !== '/v1/me/files/content') return null;
  if (url.origin !== 'https://home.beings.town' || url.username || url.password || url.hash ||
      url.searchParams.size !== 1 || !url.searchParams.has('path')) return {};
  try { return { path: workspacePath(url.searchParams.get('path')) }; } catch { return {}; }
}

/** Validate one receipt object; incomplete streams stay non-actionable. */
export function parseBeingFiles(text: string): BeingFiles | null {
  const source = text.trim();
  if (!source.startsWith('{') || !/"type"\s*:\s*"being\.files"/.test(source)) return null;
  let receipt: unknown;
  try { receipt = JSON.parse(source); } catch { return { error: '文件信息不完整，请让 Being 重新发送。' }; }
  if (!receipt || typeof receipt !== 'object' || !('type' in receipt) || receipt.type !== 'being.files') return null;
  const value = receipt as Record<string, unknown>;
  if (value.version !== 1) return { error: '暂不支持此文件协议版本，请更新客户端。' };
  if (!Array.isArray(value.files) || !value.files.length) return { error: '文件列表为空或格式不正确，请让 Being 重新发送。' };
  const files: BeingFile[] = [];
  for (const raw of value.files) {
    if (!raw || typeof raw !== 'object' || typeof raw.url !== 'string' || typeof raw.name !== 'string' || !raw.name.trim())
      return { error: '文件信息格式不正确，请让 Being 重新发送。' };
    const reference = homeFileReference(raw.url);
    if (!reference?.path || reference.path !== raw.path)
      return { error: '文件地址与工作区路径不匹配，请让 Being 重新发送。' };
    if ((raw.size !== undefined && (!Number.isSafeInteger(raw.size) || raw.size < 0)) ||
        (raw.sha256 !== undefined && (typeof raw.sha256 !== 'string' || !/^[a-f\d]{64}$/i.test(raw.sha256))) ||
        ['content_type', 'caption'].some(key => raw[key] !== undefined && typeof raw[key] !== 'string'))
      return { error: '文件信息格式不正确，请让 Being 重新发送。' };
    files.push({ path: reference.path, name: raw.name, url: raw.url, size: raw.size,
      sha256: raw.sha256, content_type: raw.content_type, caption: raw.caption });
  }
  return { files };
}

export type BeingFileBlock =
  | { kind: 'text'; start: number; text: string }
  | { kind: 'files'; start: number; text: string; receipt: BeingFiles };

/** Extract receipts from prose or JSON fences without interpreting code examples as files. */
export function beingFileBlocks(text: string): BeingFileBlock[] {
  const blocks: BeingFileBlock[] = [];
  if (!text.includes('being.files')) return blocks;
  let cursor = 0, plainStart = 0;
  const append = (start: number, end: number, source: string) => {
    const receipt = parseBeingFiles(source);
    if (!receipt) return;
    if (start > plainStart) blocks.push({ kind: 'text', start: plainStart, text: text.slice(plainStart, start) });
    blocks.push({ kind: 'files', start, text: source, receipt });
    plainStart = end;
  };
  while (cursor < text.length) {
    if (cursor === 0 || text[cursor - 1] === '\n') {
      const lineEnd = text.indexOf('\n', cursor);
      const next = lineEnd < 0 ? text.length : lineEnd + 1;
      const line = text.slice(cursor, lineEnd < 0 ? text.length : lineEnd);
      const fence = /^ {0,3}(`{3,}|~{3,})\s*([^\r]*)\r?$/.exec(line);
      if (fence) {
        let close = next, end = text.length;
        while (close < text.length) {
          const endLine = text.indexOf('\n', close), after = endLine < 0 ? text.length : endLine + 1;
          const candidate = text.slice(close, endLine < 0 ? text.length : endLine).trim();
          if (candidate.length >= fence[1].length && [...candidate].every(char => char === fence[1][0])) { end = after; break; }
          close = after;
        }
        if (['', 'json', 'being.files'].includes(fence[2].trim().toLowerCase())) append(cursor, end, text.slice(next, close));
        cursor = end; continue;
      }
      if (/^\s*>/.test(line)) { cursor = next; continue; }
    }
    if (text[cursor] === '`') {
      const ticks = /^`+/.exec(text.slice(cursor))![0];
      const end = text.indexOf(ticks, cursor + ticks.length);
      cursor = end < 0 ? text.length : end + ticks.length;
      continue;
    }
    if (text[cursor] !== '{') { cursor++; continue; }
    // Braces in captions and escaped quotes must not split the JSON object.
    let end = cursor, depth = 0, quoted = false, escaped = false;
    for (; end < text.length; end++) {
      const char = text[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) { end++; break; }
    }
    append(cursor, end, text.slice(cursor, end));
    cursor = end;
  }
  if (plainStart && plainStart < text.length) blocks.push({ kind: 'text', start: plainStart, text: text.slice(plainStart) });
  return blocks;
}
