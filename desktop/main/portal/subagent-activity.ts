import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { SubagentStep, SubagentTaskDetail } from '../../shared/types';
import { redact } from '../chat/connection';

/** Read task-owned records only; callers resolve the selected engine and authorize IDs. */
export async function readSubagentActivity(directory: string, taskId: string, secrets: string[] = []): Promise<SubagentTaskDetail> {
  const text = await readFile(path.join(directory, `task-${taskId}.jsonl`), 'utf8').catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (text === null) return { taskId, steps: [] };
  const clean = (value: string) => redact(value, secrets)
    .replace(/((?:authorization|x-relay-secret)\s*[":=]+\s*["']?)(?:bearer\s+)?[^\s,"'}]+/gi, '$1[redacted]')
    .replace(/(["']?(?:token|secret|password|api[_-]?key|access[_-]?token)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[redacted]')
    .replace(/\bsk-[a-zA-Z0-9_-]+/g, '[redacted]');
  const steps: SubagentStep[] = [];
  // A writer's last partial line is picked up by the next directory notification.
  for (const line of text.split('\n').slice(0, -1)) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row || !Number.isFinite(row.at) || !['started','thinking','tool','tool-result','message','turn-end','finished'].includes(row.kind)) continue;
    const step: SubagentStep = { at: row.at, kind: row.kind };
    for (const key of ['callId', 'name', 'input', 'output'] as const) if (typeof row[key] === 'string') step[key] = clean(row[key]);
    if (typeof row.failed === 'boolean') step.failed = row.failed;
    steps.push(step);
  }
  return { taskId, steps };
}
