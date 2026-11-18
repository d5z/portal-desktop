import type { ActivityEntry } from './chat';
import { localFileReference } from '../../../shared/local-file';

const DETAIL_LIMIT = 20_000;
type Payload = Record<string, unknown>;
const object = (value: unknown): Payload => value && typeof value === 'object' && !Array.isArray(value) ? value as Payload : {};
const finite = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const nonnegative = (value: unknown) => { const n = finite(value); return n !== undefined && n >= 0 ? n : undefined; };
const callId = (data: Payload) => [data.tool_call_id, data.tool_use_id, data.call_id, data.id]
  .find((id): id is string => typeof id === 'string' && id.length > 0);

function bounded(text: string): string {
  if (text.length <= DETAIL_LIMIT) return text;
  // Retain the final error as well as the beginning of a large output.
  return text.slice(0, DETAIL_LIMIT / 2) + '\n…（内容过长，已省略中间部分）…\n' + text.slice(-DETAIL_LIMIT / 2);
}
function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.flatMap(part => {
    const block = object(part);
    return block.type === 'text' && typeof block.text === 'string' ? [block.text] : [];
  }).join('\n');
}

export function newToolActivity(entries: ActivityEntry[], data: Payload, id: string, now: number): ActivityEntry | undefined {
  const toolCallId = callId(data);
  if (toolCallId && entries.some(entry => entry.type === 'tool' && entry.toolCallId === toolCallId)) return;
  const inputDetail = typeof data.input === 'string' ? data.input : data.input == null ? '' : JSON.stringify(data.input, null, 2);
  return { type: 'tool', id, toolCallId, name: typeof data.name === 'string' ? data.name : 'tool',
    ts: now, inputDetail: bounded(inputDetail) };
}

/** Explicit identities never fall back to position. Legacy events must match uniquely. */
export function completeToolActivity(entries: ActivityEntry[], data: Payload): ActivityEntry | undefined {
  const id = callId(data);
  const candidates = entries.filter(entry => entry.type === 'tool' && (id
    ? entry.toolCallId === id
    : !entry.done && (!data.name || entry.name === data.name)));
  if (candidates.length !== 1 || candidates[0].done) return;
  const entry = candidates[0];
  const result = object(data.result);
  const detail = contentText(data.content) || contentText(result.content) ||
    (typeof data.result === 'string' ? data.result : '') ||
    [data.stdout ?? result.stdout, data.stderr ?? result.stderr].filter(value => typeof value === 'string' && value).join('\n') ||
    contentText(data.summary);
  const metadata = { ...result, ...data };
  entry.done = true;
  entry.exitCode = finite(metadata.exit_code);
  // Explicit flags win; stderr alone is not failure (e.g. PowerShell progress).
  entry.error = typeof metadata.is_error === 'boolean' ? metadata.is_error
    : typeof metadata.isError === 'boolean' ? metadata.isError : entry.exitCode !== undefined && entry.exitCode !== 0;
  entry.resultDetail = bounded(detail);
  entry.nextAction = entry.error ? typeof metadata.next_action === 'string' ? bounded(metadata.next_action)
    : '查看错误详情，修正命令、输入文件或授权问题后再试。' : undefined;
  const summary = (contentText(data.summary) || detail).trim().replace(/\s+/g, ' ');
  entry.result = summary.length > 120 ? summary.slice(0, 119) + '…' : summary || (entry.error ? '工具执行失败，服务端未返回详情' : '');
  entry.durationMs = nonnegative(metadata.duration_ms);
  entry.totalOutputBytes = nonnegative(metadata.total_output_bytes);
  entry.outputTruncated = metadata.truncated === true || detail.length > DETAIL_LIMIT;
  // Only successful file mutations with explicit result paths produce artifacts.
  // LocalFileLink still verifies existence and preview support in the desktop host.
  if (!entry.error && ['portal_file_write', 'portal_file_edit'].includes(entry.name || '') && typeof metadata.path === 'string') {
    entry.artifactPath = localFileReference(metadata.path) || undefined;
  }
  return entry;
}
