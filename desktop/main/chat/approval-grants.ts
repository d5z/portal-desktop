import { createHash } from 'node:crypto';
import { renameSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ClientCommandRequest } from './client-server';

interface Operation {
  tool: string; workspace: string; isolation?: unknown; target?: unknown;
  arguments: Record<string, unknown>;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/** Match execution scope, never a shell prefix or an arbitrary tool's claimed permissions. */
export function approvalGrant(request: ClientCommandRequest, value: Operation) {
  const args = { ...value.arguments };
  let scope = '相同工具及参数的操作';
  if (value.tool === 'portal_exec') {
    delete args.justification;
    scope = '相同命令及执行参数的操作';
  } else if (value.isolation === 'file-scope' && typeof value.target === 'string' && value.target &&
      ['portal_file_read', 'portal_file_write', 'portal_file_edit', 'portal_file_list', 'portal_search'].includes(value.tool)) {
    // Portal resolves this canonical target again on every invocation, including symlinks.
    delete args.path;
    if (value.tool === 'portal_file_write') delete args.content;
    if (value.tool === 'portal_file_edit') {
      delete args.old_text; delete args.new_text; delete args.edits; delete args.expected_sha256;
    }
    scope = '对下方同一目标的同类文件操作';
  } else if (value.tool === 'portal_web_fetch' && value.isolation === 'public-web-read' && typeof args.url === 'string') {
    try {
      const url = new URL(args.url);
      if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash &&
          Object.keys(args).every(key => ['url', 'max_chars'].includes(key))) {
        args.url = url.origin;
        delete args.max_chars;
        scope = `读取 ${url.origin} 的网页（不含查询参数和凭据）`;
      }
    } catch { /* Invalid URLs retain exact argument matching. */ }
  }
  const key = createHash('sha256').update(canonical({ version: 1, endpoint: request.endpoint,
    workspace: value.workspace, tool: value.tool, isolation: value.isolation ?? 'host-tool',
    target: value.target ?? null, arguments: args })).digest('hex');
  return { key, scope: `同一 Being、同一工作区内，${scope}将不再询问；重启后仍有效。` };
}

/** Store only fingerprints, keeping command contents and file data out of the grant file. */
export class ApprovalGrants {
  private keys = new Set<string>();
  constructor(private file?: string) {}
  async load() {
    if (!this.file) return;
    this.keys.clear();
    let raw: string;
    try { raw = await readFile(this.file, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    try {
      const data = JSON.parse(raw);
      if (data?.version === 1 && Array.isArray(data.keys) && data.keys.every((key: unknown) => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key))) {
        this.keys = new Set(data.keys);
      }
    } catch { /* Corrupt state grants nothing; the next consent replaces it. */ }
  }
  has(key: string) { return this.keys.has(key); }
  async remember(key: string, valid: () => boolean) {
    const next = new Set(this.keys).add(key);
    if (!valid()) return;
    if (this.file) {
      await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = this.file + '.tmp';
      let committed = false;
      try {
        await writeFile(temporary, JSON.stringify({ version: 1, keys: [...next] }), { mode: 0o600 });
        if (!valid()) return;
        // Only the atomic rename is synchronous: cancellation/mode changes cannot
        // interleave between validation, publishing the file and updating memory.
        renameSync(temporary, this.file);
        this.keys = next;
        committed = true;
      } finally {
        if (!committed) await rm(temporary, { force: true }).catch(() => {});
      }
      return;
    }
    this.keys = next;
  }
}
