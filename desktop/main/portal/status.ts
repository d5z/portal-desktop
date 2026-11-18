import { open, readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { parse } from 'smol-toml';
import type { PortalState, SubagentConfig, SubagentStatus, SceneTaskSnapshot } from '../../shared/types';
import path from 'node:path';

export interface SubagentState { enabled: boolean; configured: boolean; ready: boolean; state_dir: string }

export function subagentHealth(config: SubagentConfig, snapshot: SceneTaskSnapshot, phase: PortalState['phase']): SubagentStatus {
  const lastTask = snapshot.tasks.filter(task => task.status !== 'running' && task.status !== 'queued' &&
    (!config.validated_at || (task.endedAt || task.createdAt) >= config.validated_at))
    .sort((a, b) => (b.endedAt || b.createdAt) - (a.endedAt || a.createdAt))[0];
  const configured = Boolean(config.provider && config.model);
  const ready = snapshot.subagentReady === true;
  let health: SubagentStatus['health'] = 'ok';
  let message = '执行环境已就绪；接口可用性以实际任务结果为准。';
  if (!configured) { health = 'error'; message = '尚未取得可用模型配置，请保存 Being 连接或自定义配置。'; }
  else if (!config.api_key_configured) {
    health = 'warning';
    message = '模型凭据未就绪。默认模型请重新保存 Being 连接；自定义模型请填写对应接口的 API 密钥。';
  } else if (!ready) {
    health = phase === 'error' ? 'error' : 'warning';
    message = phase === 'connected' ? 'subagent 执行环境尚未就绪，请检查 Portal 诊断。' : 'Portal 尚未连接，subagent 暂不能执行任务。';
  }
  if (lastTask && ['failed', 'timeout', 'interrupted', 'budget_exhausted'].includes(lastTask.status)) {
    health = 'error';
    message = '最近一次 subagent 任务未完成。下方保留该次结果；修改配置后需通过新任务验证。';
  }
  return { enabled: config.enabled !== false, inheritModel: config.inherit_model, configured, ready,
    provider: config.provider, model: config.model, thinking: config.thinking, baseUrl: config.base_url, api: config.api,
    apiKeyConfigured: config.api_key_configured, health, message, ...(lastTask ? { lastTask } : {}) };
}

export interface PortalSample {
  schema: 1; pid: number; nonce: string; boot_id: string; sequence: number;
  state: string; updated_at_ms: number;
  native?: true;
}
async function readStatus(file: string) {
  const handle = await open(file, 'r');
  try {
    const bytes = Buffer.alloc(8193);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 8192) return null;
    return JSON.parse(bytes.subarray(0, bytesRead).toString());
  } finally { await handle.close(); }
}

export async function readPortalReady(file: string, pid: number, nonce: string): Promise<boolean> {
  try {
    const ready = await readStatus(file);
    return Boolean(nonce && ready?.pid === pid && ready?.nonce === nonce);
  } catch { return false; }
}

/** Only accept capabilities published by the selected live engine. */
export async function readSubagentState(directory: string, pid: number | undefined, configPath: string, endpoint: string): Promise<SubagentState | null> {
  if (!pid) return null;
  try {
    const [ready, status] = await Promise.all([
      readStatus(path.join(directory, '.portal-ready.json')),
      readStatus(path.join(directory, '.portal-subagent-status.json')),
    ]);
    if (ready?.pid !== pid || status?.pid !== pid || typeof ready.nonce !== 'string' || !ready.nonce || status.nonce !== ready.nonce ||
      typeof status.enabled !== 'boolean' || typeof status.configured !== 'boolean' || typeof status.ready !== 'boolean' ||
      typeof status.state_dir !== 'string' || !path.isAbsolute(status.state_dir)) return null;
    // The status file reports readiness, not permission to select another directory.
    // Match Portal's config-relative override or default per-Being identity hash.
    const document = parse(await readFile(configPath, 'utf8'));
    const subagent = document.subagent as { state_dir?: unknown } | undefined;
    const configured = subagent?.state_dir;
    if (configured !== undefined && typeof configured !== 'string') return null;
    const url = new URL(endpoint);
    const identity = `${url.host.toLowerCase()}/${url.pathname.replaceAll('/', '')}`;
    const portalHome = process.env.HOME || process.env.USERPROFILE || os.homedir();
    const expected = typeof configured === 'string' && configured.trim()
      ? path.resolve(path.dirname(configPath), configured === '~' ? portalHome : configured.startsWith('~/') ? path.join(portalHome, configured.slice(2)) : configured)
      : path.join(portalHome, '.heart-portal/subagent', createHash('sha256').update(identity).digest('hex').slice(0, 16));
    if (path.resolve(status.state_dir) !== path.resolve(expected)) return null;
    // Resolve once before handing the selected directory to the ledger/activity readers.
    const state_dir = await realpath(expected).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return expected;
      throw error;
    });
    return { enabled: status.enabled, configured: status.configured, ready: status.ready, state_dir };
  } catch { return null; }
}
// Telemetry from the selected runtime only; never grants ownership or permissions.
export async function readPortalSample(file: string, pid: number, nonce: string): Promise<PortalSample | null> {
  try {
    const s = await readStatus(file);
    const now = Date.now();
    if (!s || s.pid !== pid || !nonce || s.nonce !== nonce ||
        !['starting', 'connecting', 'connected', 'retrying', 'auth_required', 'invalid', 'local'].includes(s.state)) return null;
    // Upstream publishes state changes with PID + per-launch nonce, without a
    // heartbeat timestamp. Callers first verify the selected process is alive;
    // never apply the legacy heartbeat expiry to this native protocol.
    if (s.schema === undefined) return { schema: 1, pid, nonce, boot_id: nonce,
      sequence: 1, state: s.state, updated_at_ms: now, native: true };
    if (s.schema !== 1 ||
        typeof s.boot_id !== 'string' || !s.boot_id || !Number.isSafeInteger(s.sequence) || s.sequence < 1 ||
        !Number.isSafeInteger(s.updated_at_ms) || s.updated_at_ms > now + 5000 || now - s.updated_at_ms > 120_000) return null;
    return s;
  } catch { return null; }
}

export function portalSampleState(sample: PortalSample | null, ready = false): Pick<PortalState, 'phase' | 'message'> {
  if (!sample && ready) return { phase: 'running', message: 'Portal 本地服务已就绪；当前引擎未提供云端连接状态。' };
  if (!sample) return { phase: 'starting', message: 'Portal 进程正在运行，等待有效连接状态；旧版 Portal 不提供此状态。' };
  switch (sample.state) {
    case 'connected': return { phase: 'connected', message: 'Portal 已连接云端 Being，等待工具调用' };
    case 'retrying': return { phase: 'reconnecting', message: 'Relay 连接断开，Portal 正在自动重连' };
    case 'auth_required': return { phase: 'error', message: '连接凭据已失效或被拒绝，请更新 Being 连接链接。' };
    case 'invalid': return { phase: 'error', message: 'Portal 连接配置无效，请检查连接链接。' };
    default: return { phase: 'starting', message: sample.state === 'local' ? 'Portal 本地服务已就绪' : 'Portal 正在连接…' };
  }
}
