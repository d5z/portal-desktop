import { spawn } from 'node:child_process';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Settings, SubagentSetup } from '../../shared/types';
import { portalConfig } from './supervisor';
import { windowsEnvironment, windowsExecutable } from './windows';
import { parse, stringify } from 'smol-toml';

/** Read only the public fields; never return a stored key to a renderer. */
export async function readSubagentConfig(directory: string, settings: Settings) {
  const config = settings.portalConfigPath || path.join(directory, 'subagent-portal.toml');
  try {
    const document = parse(await readFile(config, 'utf8')) as { subagent?: { enabled?: boolean; model?: Record<string, unknown> } };
    const model = document.subagent?.model || {};
    const string = (key: string) => typeof model[key] === 'string' ? model[key] as string : '';
    return { enabled: document.subagent?.enabled !== false, provider: string('provider'), model: string('model'), thinking: string('thinking') || 'medium', ...(string('base_url') ? { base_url: string('base_url'), api: string('api') } : {}) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { enabled: false, provider: '', model: '', thinking: 'medium' };
    throw new Error('无法读取 subagent 配置，请检查本机 Portal 配置文件。');
  }
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

/** Use Portal's installer/config writer; secrets travel only through stdin. */
export async function setupSubagent(directory: string, settings: Settings, input: SubagentSetup): Promise<string> {
  validateSubagentSetup(input);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const config = settings.portalConfigPath || path.join(directory, 'subagent-portal.toml');
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
  const config = settings.portalConfigPath || path.join(directory, 'subagent-portal.toml');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let contents: string;
  try { contents = await readFile(config, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    contents = portalConfig(settings);
  }
  const document = parse(contents);
  const previous = document.subagent;
  document.subagent = { ...(typeof previous === 'object' && previous && !Array.isArray(previous) && !(previous instanceof Date) ? previous : {}), enabled };
  await writeFile(config, stringify(document), { mode: 0o600 });
  return config;
}
