import { expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, appendFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readSubagentActivity } from '../desktop/main/portal/subagent-activity';

it('streams assistant text in order and replaces deltas with the final message without duplication', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'subagent-stream-'));
  const file = path.join(directory, 'task-sub_test.jsonl');
  try {
    const rows = [
      { kind: 'message-delta', at: 1, output: '先检查。' },
      { kind: 'message', at: 2, output: '先检查。' },
      { kind: 'tool', at: 3, callId: 'a', name: 'bash', input: 'pwd' },
      { kind: 'tool-result', at: 4, callId: 'a', output: '/project' },
      { kind: 'message-delta', at: 5, output: '已完成，' },
      { kind: 'message-delta', at: 6, output: 'selected-secret' },
    ];
    await writeFile(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    const detail = await readSubagentActivity(directory, 'sub_test', ['selected-secret']);
    expect(detail.steps.map(step => step.kind)).toEqual(['message', 'tool', 'tool-result', 'message']);
    expect(detail.steps.at(-1)?.output).toBe('已完成，[redacted]');
    await appendFile(file, JSON.stringify({ kind: 'message', at: 7, output: '已完成。' }) + '\n');
    const final = await readSubagentActivity(directory, 'sub_test');
    expect(final.steps).toHaveLength(4);
    expect(final.steps.at(-1)?.output).toBe('已完成。');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('reads task steps, output and completion while masking credentials and ignoring incomplete writes', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'subagent-steps-'));
  const file = path.join(directory, 'task-sub_test.jsonl');
  try {
    const rows = [
      {kind:'tool',at:1,name:'bash',callId:'one',input:'python3 -V'},
      {kind:'tool-result',at:2,name:'bash',callId:'one',output:'Python 3.12\napi_key=secret-value\nAuthorization: Bearer abc'},
      {kind:'message',at:3,output:'Result: done; selected-secret sk-or-v1-private'},
    ];
    await writeFile(file, rows.map(row=>JSON.stringify(row)).join('\n')+'\n{"kind":"finished"');
    const detail = await readSubagentActivity(directory,'sub_test',['selected-secret']);
    expect(detail.steps.map(step=>step.kind)).toEqual(['tool','tool-result','message']);
    expect(detail.steps[0].input).toBe('python3 -V');
    expect(detail.steps[1].output).toContain('Python 3.12');
    expect(JSON.stringify(detail)).not.toMatch(/secret-value|Bearer abc|selected-secret|sk-or-v1-private/);
    await appendFile(file, ',"at":4}\n');
    expect((await readSubagentActivity(directory,'sub_test')).steps.at(-1)?.kind).toBe('finished');
    expect((await readSubagentActivity(directory,'sub_old')).steps).toEqual([]);
  } finally { await rm(directory,{recursive:true,force:true}); }
});

it('keeps the complete task history and long outputs', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'subagent-steps-'));
  try {
    const rows = Array.from({length:220}, (_,i)=>({kind:'tool-result',at:i,name:'bash',output:'x'.repeat(2000)}));
    rows.push({kind:'message',at:221,name:'',output:'LATEST_RESULT'+'文'.repeat(70000)});
    await writeFile(path.join(directory,'task-sub_test.jsonl'),rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
    const detail = await readSubagentActivity(directory,'sub_test');
    expect(detail.steps).toHaveLength(221);
    expect(detail.steps[0].at).toBe(0);
    expect(detail.steps.at(-1)?.output).toBe('LATEST_RESULT'+'文'.repeat(70000));
  } finally { await rm(directory,{recursive:true,force:true}); }
});

it('merges thousands of deltas, redacts secrets split across chunks, and preserves turn boundaries', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'subagent-deltas-'));
  try {
    const deltas = Array.from({ length: 8000 }, (_, at) => ({ kind: 'message-delta', at, output: '完整中文内容。' }));
    const rows = [...deltas,
      { kind: 'message-delta', at: 8000, output: 'selected-' },
      { kind: 'message-delta', at: 8001, output: 'secret' },
      { kind: 'turn-end', at: 8002, output: '' },
      { kind: 'message-delta', at: 8003, output: '下一轮' },
    ];
    await writeFile(path.join(directory, 'task-sub_test.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    const detail = await readSubagentActivity(directory, 'sub_test', ['selected-secret']);
    expect(detail.steps.map(step => step.kind)).toEqual(['message', 'turn-end', 'message']);
    expect(detail.steps[0].output).toBe('完整中文内容。'.repeat(8000) + '[redacted]');
    expect(detail.steps[2].output).toBe('下一轮');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
