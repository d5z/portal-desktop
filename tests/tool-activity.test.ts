import { describe, expect, it } from 'vitest';
import { newToolActivity, completeToolActivity } from '../desktop/renderer/chat/models/tool-activity';
import type { ActivityEntry } from '../desktop/renderer/chat/models/chat';

const start = (id?: string, name = 'portal_exec') => newToolActivity([], { call_id: id, name, input: { command: 'echo hello' } }, `row-${id}`, 1)!;

describe('tool activity identity and details', () => {
  it('shows the recovery action returned by Portal for a failed execution', () => {
    const entries=[start('timeout')];
    completeToolActivity(entries,{call_id:'timeout',result:{isError:true,content:[{type:'text',text:'partial output\nCommand timed out'}],next_action:'长任务使用 background=true'}});
    expect(entries[0]).toMatchObject({error:true,resultDetail:'partial output\nCommand timed out',nextAction:'长任务使用 background=true'});
  });
  it('pairs concurrent calls by identity, ignoring duplicates and unknown result ids', () => {
    const entries = [start('a'), start('b')];
    completeToolActivity(entries, { tool_use_id: 'a', content: 'first', is_error: false });
    expect(entries[0]).toMatchObject({ done: true, resultDetail: 'first' });
    expect(entries[1].done).toBeUndefined();
    expect(newToolActivity(entries, { id: 'a' }, 'duplicate', 2)).toBeUndefined();
    expect(completeToolActivity(entries, { call_id: 'a', content: 'duplicate', is_error: true })).toBeUndefined();
    expect(completeToolActivity(entries, { call_id: 'unknown', name: 'portal_exec', content: 'wrong' })).toBeUndefined();
    expect(entries[0].error).toBe(false);
    expect(entries[1].done).toBeUndefined();
  });

  it('matches legacy events only when the pending call is unambiguous', () => {
    const entries = [start(undefined, 'read'), start(undefined, 'write')];
    expect(completeToolActivity(entries, { content: 'ambiguous' })).toBeUndefined();
    completeToolActivity(entries, { name: 'read', content: 'read result' });
    expect(entries[0].resultDetail).toBe('read result');
    expect(entries[1].done).toBeUndefined();
    completeToolActivity(entries, { content: 'only remaining result' });
    expect(entries[1].resultDetail).toBe('only remaining result');
    expect(completeToolActivity([start(), start()], { name: 'portal_exec' })).toBeUndefined();
  });

  it('preserves structured MCP errors and bounds long details without losing the final error', () => {
    const entries = [start('a')];
    completeToolActivity(entries, { call_id: 'a', summary: 'Build failed', result: {
      content: [{ type: 'text', text: 'begin\n' + 'x'.repeat(40_000) + '\nfinal compiler error' }, { type: 'image', data: 'not text' }],
      isError: true, exit_code: 2, duration_ms: 1234, total_output_bytes: 50000,
    } });
    expect(entries[0]).toMatchObject({ error: true, result: 'Build failed', exitCode: 2, durationMs: 1234, totalOutputBytes: 50000, outputTruncated: true });
    expect(entries[0].resultDetail).toMatch(/^begin/);
    expect(entries[0].resultDetail).toMatch(/final compiler error$/);
    expect(entries[0].resultDetail!.length).toBeLessThan(20100);
    expect(entries[0].resultDetail).not.toContain('not text');
  });

  it('respects explicit success with stderr and rejects invalid execution metadata', () => {
    const entries = [start('a')];
    completeToolActivity(entries, { call_id: 'a', stdout: 'ok', stderr: 'PowerShell progress', is_error: false, exit_code: '0', duration_ms: -1, total_output_bytes: NaN });
    expect(entries[0]).toMatchObject({ error: false, resultDetail: 'ok\nPowerShell progress' });
    expect(entries[0].exitCode).toBeUndefined();
    expect(entries[0].durationMs).toBeUndefined();
    expect(entries[0].totalOutputBytes).toBeUndefined();
  });

  it.each([
    ['portal_file_write', false, '/tmp/report.html', '/tmp/report.html'],
    ['portal_file_edit', false, '/tmp/report.html', '/tmp/report.html'],
    ['portal_file_write', true, '/tmp/report.html', undefined],
    ['portal_file_read', false, '/tmp/report.html', undefined],
    ['portal_file_write', false, 'https://example.com/report.html', undefined],
  ])('produces a file reference only for a successful mutation (%s, error=%s, %s)', (name, error, path, expected) => {
    const entries: ActivityEntry[] = [start('a', name as string)];
    completeToolActivity(entries, { call_id: 'a', is_error: error, path });
    expect(entries[0].artifactPath).toBe(expected);
  });
});
