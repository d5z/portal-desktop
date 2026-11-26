// Being 自主切线路 —— 最小版
// 规则（写死在代码里，不靠调用方自觉）：
//   1. 只能切到已记住的 provider/线路，不能新建、不能改地址、不能写密钥。
//   2. 只有「当前配置已被某条线路记住」时才允许切 —— 否则切失败时回滚拿不回密钥。
//   3. 切前记快照，切后核对；核对不过就自动切回原线路。
//   4. 每次尝试（成功/失败/回滚）都写一行审计日志，不写密钥。
// 用法：
//   npx electron scripts/being-model-switch.mjs list
//   npx electron scripts/being-model-switch.mjs activate <provider>
//   npx electron scripts/being-model-switch.mjs audit [n]
import { app, safeStorage } from 'electron';
import { appendFile, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

// 这个脚本用默认 Electron app 跑，userData 会落到 %APPDATA%\Electron，
// 所以显式指到桌面客户端自己的目录（可用 PORTAL_DESKTOP_USERDATA 覆盖）。
const userData = process.env.PORTAL_DESKTOP_USERDATA || path.join(app.getPath('appData'), 'portal-desktop');
app.setPath('userData', userData);
const PROFILES = path.join(userData, 'model-profiles.json');
const CONNECTION = path.join(userData, 'connection.json');
const AUDIT = path.join(userData, 'being-model-audit.jsonl');
const TIMEOUT = 20000;

const out = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
const fail = (code, message, extra = {}) => { out({ ok: false, code, message, ...extra }); return code; };

function redact(text, secrets) {
  let safe = String(text ?? '');
  for (const secret of (secrets || []).filter(Boolean).sort((a, b) => b.length - a.length)) safe = safe.split(secret).join('[redacted]');
  return safe;
}

async function loadConnection() {
  const saved = JSON.parse(await readFile(CONNECTION, 'utf8'));
  if (saved.version !== 1) throw new Error('不支持的客户端配置版本。');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统密钥库不可用，无法读取连接凭据。');
  const secrets = JSON.parse(safeStorage.decryptString(Buffer.from(saved.credential, 'base64')));
  const url = new URL(secrets.link);
  const being = url.pathname.replaceAll('/', '');
  return {
    endpoint: `${url.origin}/${being}`,
    being,
    token: url.searchParams.get('token') || '',
    relaySecret: secrets.relaySecret || url.searchParams.get('token') || '',
  };
}

async function loadProfiles() {
  let raw;
  try { raw = await readFile(PROFILES, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const saved = JSON.parse(raw);
  if (!saved || saved.version !== 1 || !saved.profiles) throw new Error('模型档案文件格式不正确。');
  if (Array.isArray(saved.profiles)) {
    const profiles = new Map();
    for (const profile of saved.profiles) profiles.set(profile.provider, profile);
    return [...profiles.values()];
  }
  if (typeof saved.profiles !== 'object') throw new Error('模型档案文件格式不正确。');
  return Object.values(saved.profiles);
}

function keyOf(profile) {
  if (!profile.key) return undefined;
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统密钥库不可用，无法解密档案密钥。');
  return safeStorage.decryptString(Buffer.from(profile.key, 'base64'));
}

async function api(connection, method, patch) {
  const url = `${connection.endpoint}/api/llm/config?token=${encodeURIComponent(connection.token)}`;
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Relay-Secret': connection.relaySecret, 'Accept': 'application/json' },
    ...(patch === undefined ? {} : { body: JSON.stringify(patch) }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
  return { status: response.status, ok: response.ok, data };
}

// 与客户端线路记忆的 PATCH 保持同一套字段映射
function patchFor(profile, key) {
  return {
    model: profile.model,
    provider: profile.provider,
    base_url: profile.base_url || '',
    ...(key !== undefined ? { api_key: key } : {}),
    ...(profile.thinking !== undefined ? { thinking: profile.thinking } : {}),
    ...(profile.api !== undefined ? { api: profile.api } : {}),
  };
}

const sameRoute = (a, b) => (a.provider || '') === (b.provider || '') && (a.model || '') === (b.model || '') && (a.base_url || '') === (b.base_url || '');

function view(profile, current) {
  return {
    provider: profile.provider, model: profile.model,
    base_url: profile.base_url || '', hasKey: Boolean(profile.key),
    current: current ? sameRoute(profile, current) : false,
  };
}

async function audit(entry) {
  await mkdir(path.dirname(AUDIT), { recursive: true });
  await appendFile(AUDIT, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', 'utf8');
}

async function run() {
  const [command, arg] = process.argv.slice(2).filter(value => value !== '.');
  const connection = await loadConnection();
  const profiles = await loadProfiles();
  const secrets = [];

  if (command === 'list') {
    const current = await api(connection, 'GET');
    const config = current.ok ? (current.data.config || current.data) : undefined;
    out({ ok: current.ok, being: connection.being, current: config ? { provider: config.provider, model: config.model, base_url: config.base_url || '' } : null,
      profiles: profiles.map(profile => view(profile, config)) });
    return 0;
  }

  if (command === 'audit') {
    let lines = [];
    try { lines = (await readFile(AUDIT, 'utf8')).trim().split('\n').filter(Boolean); } catch { lines = []; }
    out({ ok: true, entries: lines.slice(-Number(arg || 20)).map(line => JSON.parse(line)) });
    return 0;
  }

  if (command !== 'activate' || !arg) return fail(2, '用法：list | activate <provider> | audit [n]');

  // 规则 1：只允许切到已有线路记忆
  const target = profiles.find(profile => profile.provider === arg);
  if (!target) return fail(3, `没有记住这条线路：${arg}。只能切到已记住的 provider。`, { available: profiles.map(profile => profile.provider) });

  const key = keyOf(target); if (key) secrets.push(key);

  // 规则 2：当前配置必须已被线路记忆覆盖，否则回滚拿不回密钥
  const before = await api(connection, 'GET');
  if (!before.ok) return fail(4, '读取当前模型配置失败，未做任何改动。', { status: before.status, error: redact(before.data.error || before.data.raw, secrets) });
  const config = before.data.config || before.data;
  const cover = profiles.find(profile => sameRoute(profile, config));
  if (!cover) {
    await audit({ action: 'activate', targetProvider: target.provider, result: 'refused', reason: 'current-uncovered',
      from: { provider: config.provider, model: config.model, base_url: config.base_url || '' } });
    return fail(5, '当前配置没有对应的线路记忆，切走了就回不来（密钥只存在本机记忆里）。请先在客户端成功提交当前线路。',
      { current: { provider: config.provider, model: config.model, base_url: config.base_url || '' } });
  }

  if (sameRoute(target, config)) {
    await audit({ action: 'activate', targetProvider: target.provider, result: 'noop' });
    out({ ok: true, result: 'noop', message: '已经是这条线路的配置，没有改动。', profiles: profiles.map(profile => view(profile, config)) });
    return 0;
  }

  const from = { provider: cover.provider, model: cover.model, base_url: cover.base_url || '' };

  // 切
  const applied = await api(connection, 'PATCH', patchFor(target, key));
  if (!applied.ok || applied.data.ok === false) {
    const reason = redact(applied.data.error || applied.data.raw || '切换被拒绝', secrets);
    await audit({ action: 'activate', targetProvider: target.provider, result: 'failed', from, error: reason });
    return fail(6, '切换失败，配置未改动或已由服务端回滚。', { status: applied.status, error: reason });
  }

  // 规则 3：核对
  const after = await api(connection, 'GET');
  const nowConfig = after.ok ? (after.data.config || after.data) : {};
  if (!after.ok || !sameRoute(target, nowConfig)) {
    const coverKey = keyOf(cover); if (coverKey) secrets.push(coverKey);
    const restored = await api(connection, 'PATCH', patchFor(cover, coverKey));
    const recheck = await api(connection, 'GET');
    const recheckConfig = recheck.ok ? (recheck.data.config || recheck.data) : {};
    await audit({ action: 'activate', targetProvider: target.provider, result: restored.ok && recheck.ok && sameRoute(cover, recheckConfig) ? 'rolled-back' : 'rollback-failed',
      from, after: { provider: nowConfig.provider, model: nowConfig.model } });
    return fail(7, restored.ok && recheck.ok && sameRoute(cover, recheckConfig)
      ? '切换后核对不上，已自动切回原线路。'
      : '切换后核对不上，自动回滚也失败了，请到客户端手动确认。', { status: after.status });
  }

  await audit({ action: 'activate', targetProvider: target.provider, result: 'ok', from,
    to: { provider: target.provider, model: target.model } });
  out({ ok: true, result: 'switched', from, to: { provider: target.provider, model: target.model },
    profiles: profiles.map(profile => view(profile, nowConfig)) });
  return 0;
}

app.whenReady().then(run)
  .then(code => { app.exit(code || 0); })
  .catch(error => {
    out({ ok: false, code: 1, message: String(error && error.message ? error.message : error) });
    app.exit(1);
  });
