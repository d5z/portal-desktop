import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { HomeClient } from '../desktop/main/home/client';
import { HomeService } from '../desktop/main/home/service';
import { HomeFiles, workspacePath } from '../desktop/main/home/files';
import { parseConnection } from '../desktop/main/chat/connection';
import { HomeLibrary } from '../desktop/renderer/app/models/home-library';
import { MAX_HOME_PREVIEW, type HomeFilesAPI, type HomeFileList } from '../desktop/shared/home';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-files-')); dirs.push(directory);
  const saved = { version: 1, tokens: { access: 'test-access', refresh: 'test-refresh', expires: Date.now() + 3600_000, subject: 'one' } };
  await writeFile(path.join(directory, 'home-session.json'), JSON.stringify({ credential: Buffer.from(JSON.stringify(saved)).toString('base64') }));
  let connection = parseConnection('https://heart.example/willow/?token=fixture');
  const me = { user: { id: 'one' }, username: 'one', being: { id: 'profile', being_id: 'willow' }, computer_enabled: false, storage_enabled: true, files_enabled: true, storage: { status: 'ready' } };
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    const target = new URL(String(url));
    if (target.pathname === '/v1/me') return json(me);
    if (target.pathname === '/v1/me/heart') return json({ configured: true, heart_being_id: 'willow', origin: 'https://heart.example' });
    if (target.pathname === '/v1/me/files') return json({ entries: [{ name: '报告 #%.txt', path: (target.searchParams.get('path') ? target.searchParams.get('path') + '/' : '') + '报告 #%.txt', type: 'file', size: 5 }] });
    if (target.pathname.endsWith('/content')) return new Response(new Uint8Array([0, 1, 255, 42]), { headers: { 'Content-Type': 'application/octet-stream' } });
    return json({ path: 'saved' });
  });
  const client = new HomeClient(directory, { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString() }, async () => {}, fetcher);
  await client.load();
  const viewer = { close: vi.fn(), open: vi.fn() };
  const service = new HomeService(client, viewer, () => connection, () => {});
  const dialogs = { chooseDownload: vi.fn(async (): Promise<string | undefined> => path.join(directory, 'saved.bin')) };
  const files = new HomeFiles(client, service, dialogs);
  return { files, fetcher, me, client, service, dialogs, directory, switchBeing: () => { connection = parseConnection('https://heart.example/other/?token=fixture'); service.contextChanged(); } };
}
describe('cloud workspace native file boundary', () => {
  it('uses only the current Home login token for file preview and download', async () => {
    const f = await fixture();
    await f.files.preview('artifacts/index.html');
    await f.files.download('artifacts/index.html');
    const calls = f.fetcher.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith('/content'));
    expect(calls).toHaveLength(2);
    for (const [url, init] of calls) {
      expect(new URL(String(url)).origin).toBe('https://home.beings.town');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-access');
      expect(init?.redirect).toBe('error');
      expect(new URL(String(url)).searchParams.get('path')).toBe('artifacts/index.html');
    }
  });

  it('lists and previews while the computer capability is disabled; encodes paths exactly once', async () => {
    const f = await fixture();
    expect((await f.files.list('报告 %')).entries[0].path).toBe('报告 %/报告 #%.txt');
    expect((await f.files.preview('报告 %/报告 #%.txt')).bytes).toEqual(new Uint8Array([0, 1, 255, 42]));
    const urls = f.fetcher.mock.calls.map(([url]) => new URL(String(url)));
    expect(urls.some(url => url.pathname.includes('/computer'))).toBe(false);
    expect(urls.at(-1)!.searchParams.get('path')).toBe('报告 %/报告 #%.txt');
  });
  it.each(['/absolute', '../secret', 'a/../secret', 'a/./b', 'a\\b', 'a//b', 'a/', '\0x', ''])('rejects unsafe nonempty path %j before native dialogs or requests', async value => {
    const f = await fixture();
    await expect(f.files.preview(value)).rejects.toThrow('相对路径');
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(() => workspacePath(value)).toThrow();
  });
  it('refuses disabled/unready storage and a mismatched Being', async () => {
    const f = await fixture(); f.me.files_enabled = false;
    await expect(f.files.list('')).rejects.toThrow('尚未启用');
    f.me.files_enabled = true; f.me.storage.status = 'pending';
    await expect(f.files.list('')).rejects.toThrow('正在准备');
    f.me.storage.status = 'ready'; f.switchBeing();
    await expect(f.files.list('')).rejects.toThrow('关联');
    expect(f.fetcher.mock.calls.some(([url]) => String(url).includes('/files'))).toBe(false);
  });
  it('validates returned entries instead of trusting paths, duplicates or arbitrary metadata', async () => {
    const f = await fixture(), original = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async (url, init) => String(url).includes('/files') ? json({ entries: [{ name: 'secret', path: '../secret', type: 'file', size: 1 }] }) : original(url, init));
    await expect(f.files.list('')).rejects.toThrow('相对路径');
  });
  it('streams exact binary bytes to the selected destination and leaves no temporary files', async () => {
    const f = await fixture(); expect(await f.files.download('docs/file.bin')).toBe(true);
    expect(await readFile(path.join(f.directory, 'saved.bin'))).toEqual(Buffer.from([0, 1, 255, 42]));
    expect(f.dialogs.chooseDownload).toHaveBeenCalledWith('file.bin');
    expect((await readdir(f.directory)).some(name => name.endsWith('.part'))).toBe(false);
  });
  it('cancels the response stream when the selected destination cannot be opened', async () => {
    const f = await fixture(), original = f.fetcher.getMockImplementation()!;
    const cancel = vi.fn();
    f.dialogs.chooseDownload.mockResolvedValue(path.join(f.directory, 'missing', 'file.bin'));
    f.fetcher.mockImplementation(async (url, init) => String(url).includes('/content')
      ? new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); }, cancel }))
      : original(url, init));
    await expect(f.files.download('file.bin')).rejects.toThrow('ENOENT');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(await readdir(f.directory)).toEqual(['home-session.json']);
  });
  it('never saves JSON errors over an existing file', async () => {
    const f = await fixture(), original = f.fetcher.getMockImplementation()!;
    await writeFile(path.join(f.directory, 'saved.bin'), 'original');
    f.fetcher.mockImplementation(async (url, init) => String(url).includes('/content') ? json({ error: 'secret-internal' }, 503) : original(url, init));
    await expect(f.files.download('file.txt')).rejects.toThrow('暂不可用');
    expect(await readFile(path.join(f.directory, 'saved.bin'), 'utf8')).toBe('original');
  });
  it('preserves cancellation and rejects identity changes while a native dialog is open', async () => {
    const f = await fixture(); f.dialogs.chooseDownload.mockResolvedValue(undefined);
    expect(await f.files.download('file.bin')).toBe(false);
    f.dialogs.chooseDownload.mockImplementation(async () => { f.switchBeing(); return path.join(f.directory, 'saved.bin'); });
    await expect(f.files.download('file.bin')).rejects.toThrow('切换');
    expect(f.fetcher.mock.calls.some(([url]) => String(url).includes('/content'))).toBe(false);
  });
  it('removes partial downloads after a read failure or account change', async () => {
    const f = await fixture(), original = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async (url, init) => {
      if (!String(url).includes('/content')) return original(url, init);
      let pulls = 0;
      return new Response(new ReadableStream({ pull(controller) {
        if (++pulls === 1) controller.enqueue(new Uint8Array([1, 2, 3]));
        else { f.switchBeing(); controller.close(); }
      } }));
    });
    await expect(f.files.download('file.bin')).rejects.toThrow();
    expect(await readdir(f.directory)).toEqual(['home-session.json']);
  });
  it('does not refresh credentials for a cancelled request returning a late 401', async () => {
    const f = await fixture(), original = f.fetcher.getMockImplementation()!;
    let finish!: (response: Response) => void;
    f.fetcher.mockImplementation(async (url, init) => String(url).includes('/content') ? new Promise(resolve => { finish = resolve; }) : original(url, init));
    const preview = f.files.preview('file.bin');
    const rejected = expect(preview).rejects.toThrow();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    f.switchBeing(); finish(json({ error: 'expired' }, 401));
    await rejected;
    expect(f.fetcher.mock.calls.some(([url]) => String(url).includes('/token'))).toBe(false);
  });
  it.each([false, true])('keeps progressing transfers alive and aborts stalled ones (stall=%s)', async stall => {
    const f = await fixture(), original = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async (url, init) => {
      if (!String(url).includes('/content')) return original(url, init);
      return new Response(new ReadableStream({ start(controller) {
        init!.signal!.addEventListener('abort', () => controller.error(init!.signal!.reason), { once: true });
        setTimeout(() => controller.enqueue(new Uint8Array([1])), 15_000);
        if (!stall) setTimeout(() => controller.close(), 30_000);
      } }));
    });
    vi.useFakeTimers();
    try {
      const preview = f.files.preview('slow.bin');
      const verdict = stall ? expect(preview).rejects.toThrow('超时') : expect(preview).resolves.toMatchObject({bytes: new Uint8Array([1])});
      await vi.advanceTimersByTimeAsync(36_000);
      await verdict;
    } finally { vi.useRealTimers(); }
  });
  it('bounds preview bytes', async () => {
    const f = await fixture(), original = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async (url, init) => String(url).includes('/content') ? new Response(new Uint8Array(MAX_HOME_PREVIEW + 1)) : original(url, init));
    await expect(f.files.preview('large.bin')).rejects.toThrow('下载后查看');
  });
});
function modelFixture() {
  const api: HomeFilesAPI = { list: vi.fn(async () => ({ entries: [] })), preview: vi.fn(), download: vi.fn() };
  return { api, model: new HomeLibrary(api) };
}
const entry = { name: 'one.txt', path: 'one.txt', type: 'file' as const, size: 1 };
describe('library request ownership', () => {
  it('does not let a late directory response replace the newly selected directory', async () => {
    const { api, model } = modelFixture(); let finish!: (data: HomeFileList) => void;
    vi.mocked(api.list).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const old = model.load('old'); await model.load('new'); finish({ entries: [entry] }); await old;
    expect(model.path).toBe('new'); expect(model.entries).toEqual([]);
  });
  it('keeps known oversized files downloadable without requesting preview bytes', async () => {
    const { api, model } = modelFixture();
    await model.open({ ...entry, size: MAX_HOME_PREVIEW + 1 });
    expect(api.preview).not.toHaveBeenCalled();
    expect(model.previewLoading).toBe(false);
    expect(model.selected?.path).toBe(entry.path);
    await model.download(entry.path);
    expect(api.download).toHaveBeenCalledWith(entry.path);
  });
  it('discards late previews after close and all results after a Being reset', async () => {
    const { api, model } = modelFixture(); let finish!: (data: any) => void;
    vi.mocked(api.preview).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const old = model.open(entry); model.closePreview(); finish({ name: 'one.txt', path: 'one.txt', bytes: new Uint8Array([1]) }); await old;
    expect(model.preview).toBeNull();
    vi.mocked(api.list).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const list = model.load(); model.reset(); finish({ entries: [entry] }); await list;
    expect(model.entries).toEqual([]); expect(model.loaded).toBe(false);
  });
  it('does not claim success for cancelled, failed or stale downloads', async () => {
    const { api, model } = modelFixture();
    vi.mocked(api.download).mockResolvedValue(false);
    expect(await model.download(entry.path)).toBe(false);
    expect(model.notice).toBe('');
    vi.mocked(api.download).mockRejectedValue(new Error('网络中断'));
    expect(await model.download(entry.path)).toBe(false);
    expect(model.error).toBe('网络中断'); expect(model.busy).toBe(false);
    let finish!: (saved: boolean) => void;
    vi.mocked(api.download).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = model.download(entry.path); model.reset(); finish(true);
    expect(await pending).toBe(false); expect(model.notice).toBe('');
    expect(api.list).not.toHaveBeenCalled();
  });
});
