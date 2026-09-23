import { expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PortalSupervisor } from '../desktop/main/portal/supervisor';
import { parseConnection } from '../desktop/main/chat/connection';

const { WebSocketServer } = createRequire(import.meta.url)('ws');
const data = (result: any) => JSON.parse(result.content.find((item: any) => item.type === 'text').text);

// A local relay and disposable profile exercise the exact bundled engine without
// Electron windows, login registrations or contacting a real Being.
it.skipIf(process.platform !== 'win32').each([
  { environment: 'normal', restricted: false },
  { environment: 'restricted', restricted: true },
])('uses the selected Portal binary for exec, background sessions and workspace screenshots with $environment PATH', async ({ environment, restricted }) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'portal-tools-native-'));
  const workspace = path.join(root, "中文 workspace ' fixture");
  await mkdir(workspace);
  const binary = path.resolve(process.env.PORTAL_TOOLS_TEST_BINARY || 'resources/heart-portal.exe');
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  let relay: any, id = 0;
  let phase = 'start';
  const operations: { id: number; operation: string; milliseconds: number; error?: string }[] = [];
  const diagnostic = () => `${portal.state.phase}: ${portal.state.message}\n${portal.state.logs.slice(-30).join('\n')}`;
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  server.on('connection', (socket: any) => {
    let ready = false;
    socket.on('message', (bytes: Buffer) => {
      const message = JSON.parse(bytes.toString());
      if (!ready) { ready = true; relay = socket; socket.send(JSON.stringify({ ok: true, relay_keepalive: 'text-v1' })); return; }
      if (message.type === 'keepalive') { socket.send(JSON.stringify({ type: 'keepalive_ack' })); return; }
      const request = pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timer); pending.delete(message.id);
      if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result);
    });
    socket.on('close', () => {
      if (relay !== socket) return;
      relay = null;
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error(`Local Portal relay closed\n${diagnostic()}`));
      }
      pending.clear();
    });
  });
  const rpc = async (method: string, params: Record<string, unknown> = {}): Promise<any> => {
    const requestId = ++id;
    const operation = [method, params.name, (params.arguments as { action?: string })?.action].filter(Boolean).join(' ');
    const started = Date.now();
    phase = operation;
    console.info(`[portal-tools] #${requestId} ${operation}: start`);
    let failure: string | undefined;
    try {
      return await new Promise((resolve, reject) => {
        if (relay?.readyState !== 1) { reject(new Error(`Local Portal relay is not open\n${diagnostic()}`)); return; }
        // Exec and screenshot have 30s engine deadlines. The RPC deadline must
        // allow their error response to arrive rather than hide it at 15s.
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`Local Portal RPC #${requestId} ${operation} timed out after ${Date.now() - started}ms\n${diagnostic()}`));
        }, 40_000);
        pending.set(requestId, { resolve, reject, timer });
        relay.send(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }), (error?: Error) => {
          if (!error) return;
          clearTimeout(timer); pending.delete(requestId); reject(error);
        });
      });
    } catch (error) { failure = String(error); throw error; }
    finally {
      const entry = { id: requestId, operation, milliseconds: Date.now() - started, error: failure };
      operations.push(entry);
      console.info('[portal-tools]', JSON.stringify(entry));
    }
  };
  const call = async (name: string, args: unknown) => {
    const result = await rpc('tools/call', { name, arguments: args });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    return result;
  };
  let launched = false;
  const portal = new PortalSupervisor(path.join(root, 'profile'), ((file: string, args: string[], options: any) => {
    expect(file).toBe(binary);
    expect(args).toContain('--config');
    expect(options.env.HEART_PORTAL_CLIENT_MANAGED).toBe('1');
    expect(options.env.PATH).toContain('WindowsPowerShell\\v1.0');
    expect(Object.keys(options.env).filter(key => key.toLowerCase() === 'path')).toEqual(['PATH']);
    launched = true;
    // Also cover ordinary Windows launches. The restricted case separately
    // checks the engine's shell/screenshot discovery without a usable PATH.
    return spawn(file, args, restricted ? { ...options, env: { ...options.env, PATH: workspace } } : options);
  }) as typeof spawn);
  try {
    await new Promise<void>(resolve => server.once('listening', resolve));
    await portal.start({ endpoint: '', being: '', hasToken: true, workspace, portalBinary: binary, portalName: 'native-tools-fixture',
      autoStart: false, allowExec: true, kitsEnabled: false, ...(restricted ? { portalEnvironmentPath: workspace } : {}) },
    parseConnection(`http://127.0.0.1:${server.address().port}/${path.basename(root)}/?token=local-fixture`));
    await vi.waitFor(() => expect(portal.state.phase, portal.state.message).toBe('connected'), { timeout: 15_000 });
    expect(launched).toBe(true);
    const tools = (await rpc('tools/list')).tools.map((tool: any) => tool.name);
    expect(tools).toEqual(expect.arrayContaining(['portal_exec', 'portal_process', 'portal_screenshot', 'portal_file_read']));
    const status = data(await call('portal_status', {}));
    expect(status.portal.build_id).toBe('sha256:' + createHash('sha256').update(await readFile(binary)).digest('hex'));
    expect(JSON.stringify(await call('portal_exec', { command: 'echo client-cmd-ok' }))).toContain('client-cmd-ok');
    expect(JSON.stringify(await call('portal_exec', { shell: 'powershell', command: "Write-Output '中文命令成功'" }))).toContain('中文命令成功');
    const nestedPowerShell = await rpc('tools/call', {
      name: 'portal_exec',
      arguments: { command: 'powershell -Command "Write-Output nested"' },
    });
    expect(nestedPowerShell.isError).toBe(true);
    expect(JSON.stringify(nestedPowerShell)).toContain(
      "PowerShell commands require shell='powershell'; pass the script directly",
    );
    const oemCodePageText = (await call('portal_exec', {
      shell: 'powershell',
      command: 'Write-Output (([System.Globalization.CultureInfo]::CurrentCulture).TextInfo.OEMCodePage)',
    })).content.find((item: any) => item.type === 'text').text.trim();
    const oemCodePageMatch = oemCodePageText.match(/^(\d+)/);
    expect(oemCodePageMatch, oemCodePageText).not.toBeNull();
    const oemCodePage = Number(oemCodePageMatch![1]);
    if (oemCodePage === 936) {
      expect(JSON.stringify(await call('portal_exec', { command: 'echo 中文' }))).toContain('中文');
    } else {
      console.info(`[portal-tools] CP936 assertion skipped on OEM code page ${oemCodePage}`);
    }
    const started = data(await call('portal_exec', { shell: 'powershell', command: "$line = [Console]::ReadLine(); Write-Output $line", background: true }));
    expect(started.output_encoding).toBe('utf8');
    await call('portal_process', { action: 'write', session_id: started.session_id, data: 'background-stdin-ok\n' });
    await vi.waitFor(async () => {
      const log = data(await call('portal_process', { action: 'log', session_id: started.session_id }));
      expect(log.status).toEqual({ kind: 'exited', code: 0 });
      expect(log.output).toContain('background-stdin-ok');
    }, { timeout: 10_000 });
    const capture = await call('portal_screenshot', { path: "截图目录/截图 ' 中文.png", region: '0,0,24,24' });
    const screenshot = data(capture);
    expect(screenshot.dimensions).toEqual({ width: 24, height: 24 });
    expect(path.isAbsolute(screenshot.path)).toBe(false);
    const image = (await call('portal_file_read', { path: screenshot.path })).content.find((item: any) => item.type === 'image');
    expect(image.mimeType).toBe('image/png');
    expect(Buffer.from(image.data, 'base64')).toEqual(await readFile(path.join(workspace, screenshot.path)));
    const outside = path.join(root, 'outside.png');
    expect((await rpc('tools/call', { name: 'portal_screenshot', arguments: { path: outside } })).isError).toBe(true);
    expect((await rpc('tools/call', { name: 'portal_file_read', arguments: { path: outside } })).isError).toBe(true);
    expect(await readFile(outside).catch(() => null)).toBeNull();
    expect(portal.state.phase).toBe('connected');
  } catch (error) {
    await mkdir('test-results', { recursive: true });
    await writeFile(`test-results/portal-tools-native-${environment}-failure.json`, JSON.stringify({ phase, operations, state: portal.state, error: String(error) }, null, 2));
    throw error;
  } finally {
    try { await portal.stop(); }
    finally {
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('Local Portal fixture is closing'));
      }
      pending.clear();
      for (const client of server.clients) client.terminate();
      await new Promise<void>(resolve => server.close(() => resolve()));
      expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
}, 180_000);
