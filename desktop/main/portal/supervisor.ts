import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readPortalSample, readPortalReady, portalSampleState } from './status';
import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';
import type { Connection } from '../chat/connection';
import { redact } from '../chat/connection';
import type { PortalState, Settings } from '../../shared/types';
import { windowsEnvironment, windowsExecutable } from './windows';

export function portalConfig(settings: Settings): string {
  // JSON string escaping is compatible with TOML basic strings, including Windows paths.
  return `name = ${JSON.stringify(settings.portalName)}\nworkspace = ${JSON.stringify(settings.workspace)}\nbind = "127.0.0.1:9100"\nkits_enabled = ${settings.kitsEnabled}\n\n[tools]\nexec = ${settings.allowExec}\nfile = true\nscreenshot = true\nweb_fetch = true\nsearch = true\ncustom_tools_enabled = ${settings.kitsEnabled}\n\n[security]\nexec_allowlist = []\nmax_file_size = 10485760\n`;
}

export function portalArguments(config: string, settings: Settings): string[] {
  // Managed desktop settings override legacy TOMLs without rewriting them.
  return ['--config', config, '--name', settings.portalName,
    '--exec-enabled', String(settings.allowExec), '--kits-enabled', String(settings.kitsEnabled)];
}

export class PortalSupervisor extends EventEmitter {
  private child: ChildProcess | null = null;
  private wanted = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private crashes = 0;
  private secrets: string[] = [];
  private stopPromise: Promise<void> | null = null;
  private run: { settings: Settings; connection: Connection; configPath: string; environment: Record<string, string> } | null = null;
  private launchNonce = '';
  state: PortalState = { phase: 'stopped', message: '本机 Portal 尚未启动', logs: [] };

  get managing() { return Boolean(this.child || this.wanted); }

  constructor(private directory: string, private spawnProcess: typeof spawn = spawn) { super(); }
  private publish(patch: Partial<PortalState>) {
    this.state = { ...this.state, ...patch };
    this.emit('state', this.state);
  }
  private line(raw: string) {
    const line = redact(raw, this.secrets).slice(0, 4000);
    this.state.logs = [...this.state.logs.slice(-299), line];
    this.publish({});
  }
  async start(settings: Settings, connection: Connection, environment: Record<string, string> = {}) {
    if (this.stopPromise) await this.stopPromise;
    if (this.wanted || this.child) return this.state;
    await access(settings.portalBinary, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const configPath = settings.portalConfigPath || path.join(this.directory, 'desktop-portal.toml');
    if (settings.portalConfigPath) await access(configPath, constants.R_OK);
    else await writeFile(configPath, portalConfig(settings), { mode: 0o600 });
    this.secrets = [connection.token, connection.relaySecret];
    this.run = { settings: { ...settings }, connection: { ...connection }, configPath, environment: { ...environment } };
    this.wanted = true;
    this.crashes = 0;
    this.launch();
    return this.state;
  }
  async waitReady(timeoutMs = 25_000) {
    const child = this.child, nonce = this.launchNonce;
    const deadline = Date.now() + timeoutMs;
    let readySince = 0;
    try {
      while (Date.now() < deadline) {
        if (!child?.pid || this.child !== child || !this.wanted || child.exitCode !== null || child.signalCode !== null) {
          throw new Error('配套 Portal 在启动检查期间退出。');
        }
        if (await readPortalReady(path.join(this.directory, '.portal-ready.json'), child.pid, nonce)) {
          if (!readySince) readySince = Date.now();
          if (Date.now() - readySince >= 2000) return;
        } else readySince = 0;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('配套 Portal 未通过本地启动检查。');
    } catch (error) { await this.stop(); throw error; }
  }
  private launch() {
    if (!this.wanted || !this.run) return;
    const { settings, connection, configPath, environment } = this.run;
    this.publish({ phase: 'starting', message: '正在启动本机 Portal…', pid: undefined, managed: true, runtimePath: undefined, conflict: false });
    const startedAt = Date.now();
    const nonce = randomUUID();
    this.launchNonce = nonce;
    const root = this.directory;
    const statusPath = path.join(root, '.portal-connection-status.json');
    const inherited = [process.env, environment, ...(settings.portalEnvironmentPath ? [{ PATH: settings.portalEnvironmentPath }] : [])];
    const child = this.spawnProcess(settings.portalBinary, portalArguments(configPath, settings), {
      cwd: settings.workspace,
      shell: false, windowsHide: true, detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...(process.platform === 'win32' ? windowsEnvironment(...inherited) : Object.assign({}, ...inherited)), HEART_PORTAL_CLIENT_FILE: path.join(this.directory, '.portal-client.json'), PORTAL_CONNECT_LINK: connection.link, HEART_PORTAL_SUPERVISED: '1', HEART_PORTAL_CLIENT_MANAGED: '1', HEART_PORTAL_STATUS_FILE: statusPath, HEART_PORTAL_STATUS_NONCE: nonce,
        HEART_PORTAL_READY_FILE: path.join(root, '.portal-ready.json'), HEART_PORTAL_READY_NONCE: nonce,
        RUST_LOG: 'info', NO_COLOR: '1' },
    });
    this.child = child;
    this.publish({ pid: child.pid });
    let conflict = false;
    for (const stream of [child.stdout, child.stderr]) {
      const decoder = new StringDecoder('utf8');
      let pending = '';
      stream?.on('data', (chunk: Buffer) => {
        pending += decoder.write(chunk);
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() || '';
        for (const line of lines) {
          if (/another (legacy )?Portal instance is already running/.test(line)) conflict = true;
          this.line(line);
        }
        // Drop oversized incomplete lines, rather than exposing secrets split at chunk boundaries.
        if (pending.length > 64_000) pending = '';
      });
      stream?.on('end', () => { pending += decoder.end(); if (pending) this.line(pending); });
    }
    let finished = false;
    let polling = false;
    let lastSequence = 0;
    let boot: string | undefined;
    const statusTimer = setInterval(async () => {
      if (polling || finished || !child.pid || !this.wanted) return;
      polling = true;
      try {
        const sample = await readPortalSample(statusPath, child.pid, nonce);
        if (finished || this.child !== child || !this.wanted) return;
        if (sample && ((boot && boot !== sample.boot_id) || sample.sequence < lastSequence)) {
          this.publish(portalSampleState(null));
          return;
        }
        if (sample) { boot = sample.boot_id; lastSequence = sample.sequence; }
        const ready = !sample && await readPortalReady(path.join(root, '.portal-ready.json'), child.pid, nonce);
        if (finished || this.child !== child || !this.wanted) return;
        // Reassert launch identity on every verified sample. Main-process
        // observers may temporarily replace the public state while takeover or
        // background discovery runs; a connected foreground Portal must still
        // expose the PID and ownership of the child this supervisor launched.
        this.publish({ ...portalSampleState(sample, Boolean(ready)), pid: child.pid, managed: true, runtimePath: root, conflict: false });
      } finally { polling = false; }
    }, 1000);
    statusTimer.unref?.();
    const finish = (error?: Error, code?: number | null) => {
      if (finished) return;
      finished = true;
      clearInterval(statusTimer);
      if (this.child === child) this.child = null;
      // Tool processes may inherit pipes. Never use the 'close' event to gate recovery.
      child.stdout?.destroy(); child.stderr?.destroy();
      if (error) this.line(error.message);
      if (code === 73 || conflict) {
        this.wanted = false;
        this.publish({ phase: 'external', conflict: true, message: '同一个 Being 已有本机 Portal 在运行，已停止重复启动；正在切换到客户端 Portal。' });
      }
      if (!this.wanted) {
        this.publish({ pid: undefined, ...(this.state.phase === 'external' ? {} : { phase: 'stopped', message: '本机 Portal 已停止' }) });
        return;
      }
      if (Date.now() - startedAt > 60_000) this.crashes = 0;
      if (error || ++this.crashes > 5) {
        this.wanted = false;
        this.publish({ phase: 'error', pid: undefined, message: 'Portal 启动失败或连续退出，请检查文件、权限和日志后重试。' });
        return;
      }
      this.publish({ phase: 'reconnecting', pid: undefined, message: `Portal 已退出（${code ?? 'signal'}），5 秒后重启…` });
      this.retry = setTimeout(() => { this.retry = null; this.launch(); }, 5000);
    };
    child.once('error', error => finish(error));
    child.once('exit', code => finish(undefined, code));
  }
  async stop(): Promise<PortalState> {
    if (this.stopPromise) { await this.stopPromise; return this.state; }
    this.wanted = false;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    const child = this.child;
    if (!child) {
      this.publish({ phase: 'stopped', pid: undefined, message: '客户端管理的 Portal 已停止' });
      return this.state;
    }
    this.publish({ phase: 'stopping', message: '正在停止 Portal 并清理任务…' });
    this.stopPromise = new Promise<void>((resolve, reject) => {
      let done = false;
      const finish = () => { if (done) return; done = true; clearTimeout(timer); clearTimeout(deadline); resolve(); };
      const deadline = setTimeout(() => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        child.removeListener('exit', finish); child.removeListener('error', finish);
        this.publish({ phase: 'error', message: '无法确认 Portal 已停止，请检查进程或系统权限后重试。' });
        reject(new Error('Portal process cleanup was not confirmed'));
      }, 18_000);
      const force = () => {
        if (!child.pid) return;
        if (process.platform === 'win32') {
          const killer = spawn(windowsExecutable('taskkill'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
          killer.on('error', () => { child.kill(); });
        } else {
          try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
        }
      };
      const timer = setTimeout(force, 12_000);
      child.once('exit', finish);
      child.once('error', finish);
      if (process.platform === 'win32') force(); else child.kill('SIGTERM');
      if (child.exitCode !== null || child.signalCode !== null) finish();
    });
    try { await this.stopPromise; } finally { this.stopPromise = null; }
    this.publish({ phase: 'stopped', pid: undefined, message: '本机 Portal 已停止' });
    return this.state;
  }
}
