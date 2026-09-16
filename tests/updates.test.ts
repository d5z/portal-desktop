import { expect, it } from 'vitest';
import { UpdateChecker } from '../desktop/main/updates/checker';
const release = (tag = 'v0.2.0') => ({ tag_name: tag, draft: false, prerelease: false, assets: [
  { name: `portal-desktop-${tag.slice(1)}-macos-arm64.zip` },
  { name: `portal-desktop-${tag.slice(1)}-windows-x64-Setup.exe` },
  { name: `portal-desktop-${tag.slice(1)}-macos-x64.zip` },
  { name: 'SHA256SUMS.txt' },
] });
it('compares semantic versions and constructs release links from the trusted repository', async () => {
  const checker = new UpdateChecker('0.1.9', 'd5z/portal-desktop', (async (url, options) => {
    expect(url).toBe('https://api.github.com/repos/d5z/portal-desktop/releases/latest');
    expect(options?.redirect).toBe('error');
    return Response.json({ ...release('v0.1.10'), html_url: 'https://evil.invalid' });
  }) as typeof fetch);
  expect(await checker.check()).toMatchObject({ phase: 'available', latestVersion: '0.1.10', releaseUrl: 'https://github.com/d5z/portal-desktop/releases/tag/v0.1.10' });
});
it('does not offer installation without exactly one matching platform package and checksum manifest', async () => {
  const metadata = release();
  for (const assets of [metadata.assets.slice(1), metadata.assets.slice(0, 2), [...metadata.assets, metadata.assets[0]], [{ name: 'source.zip' }]]) {
    const checker = new UpdateChecker('0.1.4', 'd5z/portal-desktop', (async () => Response.json({ ...metadata, assets })) as typeof fetch,
      undefined, 'darwin', 'arm64');
    expect(await checker.check()).toMatchObject({ phase: 'unavailable', latestVersion: undefined });
  }
  const unsupported = new UpdateChecker('0.1.4', 'd5z/portal-desktop', (async () => Response.json(metadata)) as typeof fetch, undefined, 'darwin', 'ia32');
  expect((await unsupported.check()).message).toContain('架构');
});
it('handles private/missing releases without claiming that the installed version is current', async () => {
  const checker = new UpdateChecker('0.1.1', 'd5z/portal-desktop', (async () => new Response('', { status: 404 })) as typeof fetch);
  expect((await checker.check()).phase).toBe('unavailable');
});
it('ignores older, incomplete and prerelease releases and bounds metadata', async () => {
  for (const metadata of [release('v0.1.0'), { ...release(), assets: [] }, { ...release(), prerelease: true }, { ...release(), body: 'x'.repeat(260000) }]) {
    const checker = new UpdateChecker('0.1.1', 'd5z/portal-desktop', (async () => Response.json(metadata)) as typeof fetch);
    expect((await checker.check()).phase).toBe(metadata.tag_name === 'v0.1.0' ? 'current' : 'unavailable');
  }
});
it('coalesces overlapping manual and automatic checks', async () => {
  let resolve!: (response: Response) => void; let count = 0;
  const checker = new UpdateChecker('0.1.1', 'd5z/portal-desktop', (() => { count++; return new Promise<Response>(r => { resolve = r; }); }) as typeof fetch);
  const a = checker.check(), b = checker.check();
  resolve(Response.json(release()));
  await Promise.all([a, b]); expect(count).toBe(1);
});

it('runs a fresh check after a completed one and returns a user-facing message', async () => {
  let count = 0;
  const checker = new UpdateChecker('0.1.1', 'd5z/portal-desktop', (async () => {
    count++;
    return Response.json(release(count === 1 ? 'v0.2.0' : 'v0.1.1'));
  }) as typeof fetch);
  expect(await checker.check()).toMatchObject({ phase: 'available', message: expect.stringContaining('发现新版本') });
  expect(await checker.check()).toMatchObject({ phase: 'current', message: expect.stringContaining('最新') });
  expect(count).toBe(2);
});

it('publishes download activity and keeps periodic checks from replacing an active upgrade', async () => {
  let calls = 0;
  const published: import('../desktop/shared/types').UpdateState[] = [];
  const checker = new UpdateChecker('0.1.9', 'd5z/portal-desktop', (async () => {
    calls++; return Response.json(release());
  }) as typeof fetch, state => published.push(state));
  await checker.check();
  checker.setActivity({ phase: 'downloading', version: '0.2.0', received: 12, total: 100 });
  expect((await checker.check()).activity).toMatchObject({ received: 12, total: 100 });
  expect(calls).toBe(1);
  checker.setActivity();
  expect(published.at(-1)?.activity).toBeUndefined();
  await checker.check();
  expect(calls).toBe(2);
});

it.each(['arm64', 'x64'] as const)('uses the matching %s Release ZIP for macOS upgrades and rejects the other architecture', async arch => {
  const metadata = release();
  const zip = `portal-desktop-${metadata.tag_name.slice(1)}-macos-${arch}.zip`;
  const dmg = { name: `portal-desktop-${metadata.tag_name.slice(1)}-macos-${arch}.dmg` };
  const check = (assets: typeof metadata.assets) => new UpdateChecker('0.1.4', 'd5z/portal-desktop',
    (async () => Response.json({ ...metadata, assets })) as typeof fetch, undefined, 'darwin', arch).check();
  expect((await check([...metadata.assets, dmg])).phase).toBe('available');
  expect((await check([dmg, { name: 'SHA256SUMS.txt' }])).phase).toBe('unavailable');
  expect((await check(metadata.assets.filter(asset => asset.name !== zip))).phase).toBe('unavailable');
  expect((await check([...metadata.assets, { name: zip }])).phase).toBe('unavailable');
});
