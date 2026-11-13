import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Connector icon CSP', () => {
  it('allows images served by Being Home', async () => {
    const html = await readFile(new URL('../desktop/renderer/index.html', import.meta.url), 'utf8');
    const policy = html.match(/Content-Security-Policy" content="([^"]+)/)?.[1] || '';
    expect(policy).toContain('img-src');
    expect(policy).toMatch(/img-src[^;]*\bhttps:/);
  });
});
