import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { processIdentity, replacementProcess } from './support/windows-processes.mjs';

it.skipIf(process.platform !== 'win32')('waits through stale connected status after a real process exits, then accepts its replacement', async () => {
  const child = spawn(process.execPath, ['-e', 'process.stdin.resume()'], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
  try {
    const previous = await processIdentity(child.pid!);
    expect(previous).not.toBeNull();
    expect(await replacementProcess(child.pid!, previous!)).toBeNull();
    const exited = once(child, 'exit');
    child.stdin.end();
    await exited;
    // Reproduce CI: the file still says connected with the now-dead PID.
    expect(await replacementProcess(child.pid!, previous!)).toBeNull();
    expect(await replacementProcess(process.pid, previous!)).toEqual(await processIdentity(process.pid));
    // A recycled PID is distinguished by creation time, not PID alone.
    const current = (await processIdentity(process.pid))!;
    expect(await replacementProcess(process.pid, { ...current, created: '0' })).toEqual(current);
  } finally {
    if (child.exitCode === null) child.kill();
  }
}, 30_000);
