import { expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, appendFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readSubagentActivity } from '../desktop/main/portal/subagent-activity';

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
