import { connectorImport, isConnectorImportId } from '../../../shared/connector-resources';
import type { ActivityEntry } from './chat';
import { localFileReference } from '../../../shared/local-file';

const DETAIL_LIMIT = 20_000;
type Payload = Record<string, unknown>;
const object = (value: unknown): Payload => value && typeof value === 'object' && !Array.isArray(value) ? value as Payload : {};
const finite = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const nonnegative = (value: unknown) => { const n = finite(value); return n !== undefined && n >= 0 ? n : undefined; };
const callId = (data: Payload) => [data.tool_call_id, data.tool_use_id, data.call_id, data.toolCallId, data.id]
  .find((id): id is string => typeof id === 'string' && id.length > 0);
const homeActSuccess = /^\[being-home(?:-dev)?\] \[act ✓ 1step completed\]\s+/;

function jsonObject(text: string): Payload {
  if (!text.trimStart().startsWith('{')) return {};
  try { return object(JSON.parse(text)); } catch { return {}; }
}

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

/** Prefer exact identities. A missing identity on either side requires a unique pending match. */
export function completeToolActivity(entries: ActivityEntry[], data: Payload): ActivityEntry | undefined {
  const id = callId(data);
  const exact = id && entries.find(entry => entry.type === 'tool' && entry.toolCallId === id);
  const candidates = exact ? [exact] : entries.filter(entry =>
    entry.type === 'tool' && !entry.done && (!data.name || entry.name === data.name));
  if (candidates.length !== 1 || candidates[0].done) return;
  const entry = candidates[0];
  if (id && entry.toolCallId && entry.toolCallId !== id) return;
  if (id) entry.toolCallId = id;
  const result = object(data.result);
  let detail = contentText(data.content) || contentText(result.content) ||
    (typeof data.result === 'string' ? data.result : '') ||
    [data.stdout ?? result.stdout, data.stderr ?? result.stderr].filter(value => typeof value === 'string' && value).join('\n') ||
    contentText(data.summary);
  const metadata = { ...result, ...data };
  const structured = object(data.structuredContent || result.structuredContent);
  const actInput = entry.name === 'act' ? jsonObject(entry.inputDetail || '').body : undefined;
  const actCommand = typeof actInput === 'string' ? actInput.trim() : '';
  const name = entry.name?.split('.').at(-1);
  const statusCommand = actCommand.match(/^connector_workspace_import_status\s+import_id="([a-zA-Z0-9_-]+)"$/);
  const statusCall = name === 'connector_workspace_import_status' || statusCommand !== null;
  const homeAct = !!actCommand && homeActSuccess.test(detail);
  const output = jsonObject(actCommand ? detail.replace(/^\[being-home(?:-dev)?\] \[act [^\]\r\n]+\]\s+/, '') : detail);
  const workspaceError = metadata.workspace_error ?? structured.workspace_error ?? output.workspace_error;
  const workspaceCode = typeof workspaceError === 'string' ? workspaceError : object(workspaceError).error_code || object(workspaceError).code;
  if (workspaceError) entry.workspaceError = typeof workspaceCode === 'string' && /^[a-zA-Z0-9_.-]{1,160}$/.test(workspaceCode) ? workspaceCode : '转存登记未完成，请查看工具返回详情';
  const downloadReference = name === 'workspace_file_download_reference' || /^workspace_file_download_reference(?:\s|$)/.test(actCommand);
  if (downloadReference) detail = '短期下载引用不显示在工具记录中。';
  entry.done = true;
  entry.exitCode = finite(metadata.exit_code);
  // Explicit flags win; stderr alone is not failure (e.g. PowerShell progress).
  entry.error = typeof metadata.is_error === 'boolean' ? metadata.is_error
    : typeof metadata.isError === 'boolean' ? metadata.isError : entry.exitCode !== undefined && entry.exitCode !== 0;
  entry.resultDetail = bounded(detail);
  entry.nextAction = entry.error ? typeof metadata.next_action === 'string' ? bounded(metadata.next_action)
    : '查看错误详情，修正命令、输入文件或授权问题后再试。' : undefined;
  const errorCode = metadata.error_code || object(metadata.error).code || structured.error_code || object(structured.error).code || output.error_code || object(output.error).code;
  if (errorCode === 'weixin_cursor_reset_required') {
    entry.error = true; entry.nextAction = '微信连接已更新。请重新发现工具，清除旧游标，首次不带 cursor 读取，再原样使用新的 nextCursor。不要自动重发消息。';
  }
  if ([errorCode, metadata.error, structured.error, output.error].includes('weixin_auto_receive_enabled')) {
    entry.error = true; entry.nextAction = '消息由自动收发服务管理。请停止手动读取，避免争用消息游标。';
  }
  if (errorCode === 'connection_reauth_required') {
    entry.error = true; entry.nextAction = '微信授权已失效，请到应用设置重新连接所选账户，再刷新工具。不要自动重发消息。';
  }
  if (!entry.error) {
    const workspaceFile = connectorImport(metadata.workspace_file ?? structured.workspace_file ?? output.workspace_file);
    if (statusCall) {
      const status = workspaceFile ?? connectorImport(structured) ?? connectorImport(metadata) ?? connectorImport(output);
      const requestedId = statusCommand?.[1] ?? jsonObject(entry.inputDetail || '').import_id;
      if (status && status.import_id === requestedId) entry.workspaceFile = status;
      // Older Heart streams send only a truncated act summary. The successful
      // status call still identifies its task. Home confirms ownership and state.
      else if (!status && homeAct && isConnectorImportId(requestedId)) entry.workspaceFile = { import_id: requestedId };
    } else entry.workspaceFile = workspaceFile;
  }
  const summary = (downloadReference ? detail : contentText(data.summary) || detail).trim().replace(/\s+/g, ' ');
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
