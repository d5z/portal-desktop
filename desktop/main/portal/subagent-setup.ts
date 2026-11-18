import { spawn } from 'node:child_process';
import { writeFile, mkdir, readFile, rename, chmod } from 'node:fs/promises';
import path from 'node:path';
import type { Settings, SubagentSetup, SubagentConfig } from '../../shared/types';
import { portalConfig } from './supervisor';
import type { Connection } from '../chat/connection';
import { probeSubagentModel } from './subagent-probe';
import { windowsEnvironment, windowsExecutable } from './windows';
import { parse, stringify, type TomlTable } from 'smol-toml';

type PrivateSubagent = {
  enabled?: boolean; inherit_model?: boolean; model_source?: string; inherited_from?: string; validated_at?: number;
  model?: { provider?: string; model?: string; base_url?: string; api?: string; thinking?: string; api_key?: string };
};

function defaultConfigPath(directory: string, settings: Settings) {
  return settings.portalConfigPath || path.join(directory, 'desktop-portal.toml');
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
    ? value as Record<string, unknown> : {};
}

// TOML is an external boundary. Validate the fields Desktop consumes once.
function privateSubagent(document: TomlTable): PrivateSubagent {
  const sub = record(document.subagent);
  const model = record(sub.model);
  if (document.subagent !== undefined && sub !== document.subagent || sub.model !== undefined && model !== sub.model ||
      ['enabled', 'inherit_model'].some(key => sub[key] !== undefined && typeof sub[key] !== 'boolean') ||
      ['model_source', 'inherited_from'].some(key => sub[key] !== undefined && typeof sub[key] !== 'string') ||
      sub.validated_at !== undefined && (typeof sub.validated_at !== 'number' || !Number.isFinite(sub.validated_at)) ||
      ['provider', 'model', 'base_url', 'api', 'thinking', 'api_key'].some(key => model[key] !== undefined && typeof model[key] !== 'string'))
    throw new Error('无法读取 subagent 配置，请检查本机 Portal 配置文件。');
  return { ...sub, model } as PrivateSubagent;
}

// Retain credentials for a route when selecting another one. This stays in the
// same private TOML as the active key and is never returned over IPC.
function modelKey(document: TomlTable, previous: PrivateSubagent, settings: Settings, next: NonNullable<PrivateSubagent['model']>, supplied?: string) {
  const keys: Record<string, string> = {};
  for (const [key, value] of Object.entries(record(document.desktop_model_keys)))
    if (typeof value === 'string') keys[key] = value;
  const endpoints: Record<string, string> = { openrouter: 'https://openrouter.ai/api/v1', openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com', groq: 'https://api.groq.com/openai/v1', xai: 'https://api.x.ai/v1', google: 'https://generativelanguage.googleapis.com', gemini: 'https://generativelanguage.googleapis.com' };
  const route = (being: string, model: NonNullable<PrivateSubagent['model']>) => JSON.stringify([being, (model.base_url || endpoints[model.provider || ''] || model.provider || '').replace(/\/+$/, '')]);
  if (previous?.model_source !== 'loom' && previous?.model?.api_key) keys[route(previous.inherited_from ?? settings.endpoint, previous.model)] = previous.model.api_key;
  const id = route(settings.endpoint, next);
  if (supplied) keys[id] = supplied;
  if (Object.keys(keys).length) document.desktop_model_keys = keys;
  return keys[id];
}

/** Read only the public fields; never return a stored key to a renderer. */
export async function readSubagentConfig(directory: string, settings: Settings): Promise<SubagentConfig> {
  const config = defaultConfigPath(directory, settings);
  try {
    const document = parse(await readFile(config, 'utf8'));
    const subagent = privateSubagent(document);
    const model = subagent.model || {};
    const string = (key: keyof typeof model) => model[key] || '';
    return {
      enabled: subagent?.enabled !== false,
      inherit_model: subagent?.model_source !== 'custom' && subagent?.inherit_model !== false,
      provider: string('provider'), model: string('model'), thinking: string('thinking') || 'medium',
      api_key_configured: Boolean(string('api_key')),
      ...(subagent?.validated_at ? { validated_at: subagent.validated_at } : {}),
      ...(string('base_url') ? { base_url: string('base_url'), api: string('api') } : {}),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { enabled: true, inherit_model: true, provider: '', model: '', thinking: 'medium', api_key_configured: false };
    throw new Error('无法读取 subagent 配置，请检查本机 Portal 配置文件。');
  }
}

/** Desktop owns both modes; the engine reloads the selected model before each task. */
export async function saveSubagentPreferences(directory: string, settings: Settings, custom?: SubagentSetup, connection?: Connection, request: typeof fetch = fetch): Promise<string> {
  return (await writeSubagentPreferences(directory, settings, custom, connection, request)).configPath;
}

async function writeSubagentPreferences(directory: string, settings: Settings, custom?: SubagentSetup, connection?: Connection, request: typeof fetch = fetch, onlyIfChanged = false) {
  const config = defaultConfigPath(directory, settings);
  let contents: string;
  try { contents = await readFile(config, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    contents = portalConfig(settings);
  }
  const document = parse(contents);
  const previous = privateSubagent(document);
  if (!custom && (!connection || !/^[A-Za-z0-9_-]{1,128}$/.test(connection.being))) {
    throw new Error('请先保存有效的 Being 连接，再使用默认 subagent 模型。');
  }
  const model = custom ? {
    provider: custom.provider, model: custom.model.trim(), thinking: custom.thinking,
    ...(custom.provider === 'portal-custom' ? { base_url: custom.base_url!.trim(), api: custom.api! } : {}),
  } : {
    provider: 'portal-custom', model: 'glm5.3flash', thinking: 'off',
    base_url: `https://101.132.86.87/llm/${connection!.being}/v1`, api: 'openai-completions',
  };
  const savedKey = modelKey(document, previous, settings, model, custom?.api_key.trim());
  const key = custom ? savedKey : connection!.token;
  const selected = { ...model, ...(key ? { api_key: key } : {}) };
  if (onlyIfChanged && previous?.enabled !== false && previous?.model_source === 'loom' && previous.validated_at &&
      JSON.stringify(previous.model) === JSON.stringify(selected)) return { configPath: config, changed: false };
  await probeSubagentModel(selected, request);
  document.subagent = {
    ...previous,
    validated_at: Date.now(),
    enabled: true,
    auto_install: true,
    inherit_model: true,
    model_source: custom ? 'custom' : 'loom',
    inherited_from: settings.endpoint,
    model: selected,
  };
  const next = stringify(document);
  if (next !== contents) {
    await mkdir(path.dirname(config), { recursive: true, mode: 0o700 });
    const temporary = config + '.mode.tmp';
    await writeFile(temporary, next, { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, config);
  }
  return { configPath: config, changed: next !== contents };
}

export function validateSubagentSetup(input: SubagentSetup) {
  if (input?.enabled !== undefined && typeof input.enabled !== 'boolean')
    throw new Error('请检查 subagent 启用状态。');
  if (!input || !['anthropic', 'openrouter', 'openai', 'gemini', 'groq', 'xai', 'google', 'portal-custom'].includes(input.provider) ||
    typeof input.model !== 'string' || !input.model.trim() || input.model.length > 256 ||
    typeof input.api_key !== 'string' || input.api_key.length > 8192 || /[\r\n\x00]/.test(input.api_key) ||
    !['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(input.thinking))
    throw new Error('请检查 subagent 的提供商、模型和密钥配置。');
  if (input.provider === 'portal-custom') {
    let url: URL;
    try { url = new URL(input.base_url || ''); } catch { throw new Error('请填写自定义模型的接口地址。'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
      !['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'].includes(input.api || ''))
      throw new Error('请检查自定义模型的接口地址和协议。');
  }
}

/** Refresh the default gateway identity at startup; explicit custom models stay selected. */
export async function syncSubagentModel(directory: string, settings: Settings, connection: Connection, request: typeof fetch = fetch): Promise<boolean> {
  const current = await readSubagentConfig(directory, settings);
  if (!current.inherit_model && current.model) {
    if (current.enabled) return false;
    await setSubagentEnabled(directory, { ...settings, portalConfigPath: settings.portalConfigPath || path.join(directory, 'desktop-portal.toml') }, true);
    return true;
  }
  return (await writeSubagentPreferences(directory, settings, undefined, connection, request, true)).changed;
}

/** Accept input validated by portal/ipc. Secrets travel only through stdin. */
export async function setupSubagent(directory: string, settings: Settings, input: SubagentSetup): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const config = defaultConfigPath(directory, settings);
  if (!settings.portalConfigPath) {
    try { await readFile(config, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await writeFile(config, portalConfig(settings), { mode: 0o600, flag: 'wx' });
    }
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(settings.portalBinary, ['--config', config, 'subagent-setup'], {
      shell: false, windowsHide: true, detached: process.platform !== 'win32',
      env: windowsEnvironment(process.env, ...(settings.portalEnvironmentPath ? [{ PATH: settings.portalEnvironmentPath }] : [])), stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '', tooLarge = false;
    const stop = () => {
      if (!child.pid) { child.kill(); return; }
      if (process.platform === 'win32') {
        const killer = spawn(windowsExecutable('taskkill'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => child.kill());
      } else { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); } }
    };
    child.stdout.setEncoding('utf8');
    const timer = setTimeout(() => { stop(); reject(new Error('subagent 安装超时，请检查 npm 和网络后重试。')); }, 180000);
    child.stdout.on('data', chunk => {
      if (output.length + chunk.length > 1024 * 1024) { tooLarge = true; stop(); return; }
      output += chunk.toString();
    });
    // Never expose installer/config errors that could contain credentials.
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', () => { clearTimeout(timer); reject(new Error('无法启动 subagent 安装，请检查 Portal 程序。')); });
    child.on('close', code => {
      clearTimeout(timer);
      try {
        const line = output.split(/\r?\n/).find(line => line.startsWith('DESKTOP_SUBAGENT_RESULT='));
        if (code !== 0 || tooLarge || !line) throw new Error();
        const response = JSON.parse(line.slice('DESKTOP_SUBAGENT_RESULT='.length));
        if (response.isError) throw new Error();
        const result = JSON.parse(response.content[0].text);
        if (!result.pi_installed || result.install_error || result.ok !== true) throw new Error();
        resolve();
      } catch { reject(new Error('subagent 安装或配置失败。请检查 npm、网络和模型配置；可取消勾选后先连接 Being。')); }
    });
    const { api_key, ...model } = input;
    child.stdin.end(JSON.stringify({ ...model, ...(api_key.trim() ? { api_key: api_key.trim() } : {}) }));
  });
  await setSubagentEnabled(directory, { ...settings, portalConfigPath: config }, input.enabled !== false);
  return config;
}

/** Toggle only the capability; preserve model, credentials and other Portal settings. */
export async function setSubagentEnabled(directory: string, settings: Settings, enabled: boolean): Promise<string> {
  const config = defaultConfigPath(directory, settings);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let contents: string;
  try { contents = await readFile(config, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    contents = portalConfig(settings);
  }
  const document = parse(contents);
  const previous = document.subagent;
  document.subagent = { ...record(previous), enabled };
  const temporary = config + '.enabled.tmp';
  await writeFile(temporary, stringify(document), { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, config);
  return config;
}
