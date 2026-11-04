import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SecretStorage } from '../app/settings';
import type { ModelProfileInput, ModelProfilesResult, PublicModelProfile } from '../../shared/types';
import { redact } from './connection';

export type PublicProfile = PublicModelProfile;
export interface ModelProfile extends Omit<PublicProfile, 'hasKey'> { key?: string }

// Route ids are provider identifiers in the desktop workflow. Keep this
// explicit so a malformed local file cannot become an arbitrary credential
// namespace.
const providers = new Set([
  'anthropic', 'openai', 'openai-responses', 'openrouter', 'gemini', 'google',
  'groq', 'xai', 'glm', 'deepseek', 'kimi', 'self-hosted', 'portal-custom',
]);
const invalid = () => new Error('无效的模型档案。');
const unavailable = () => new Error('系统密钥库不可用，无法安全保存模型密钥。');
const base64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function validateProvider(value: unknown): value is string {
  return typeof value === 'string' && providers.has(value);
}
function validate(input: unknown): asserts input is ModelProfileInput {
  if (!object(input) ||
    Object.keys(input).some(key => !['provider', 'base_url', 'api', 'model', 'thinking', 'api_key'].includes(key)) ||
    Object.values(input).some(value => value !== undefined && typeof value !== 'string') ||
    Buffer.byteLength(JSON.stringify(input), 'utf8') > 16384 ||
    !validateProvider(input.provider) ||
    typeof input.model !== 'string' || !input.model.trim()) throw invalid();
  if (input.base_url !== undefined) {
    try {
      const url = new URL(String(input.base_url));
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw invalid();
    } catch { throw invalid(); }
  }
}
function validateStored(value: unknown, provider?: string): asserts value is ModelProfile {
  if (!object(value)) throw invalid();
  const { key, ...profile } = value;
  if ('api_key' in profile || (provider !== undefined && profile.provider !== provider)) throw invalid();
  validate(profile);
  if (key !== undefined && (typeof key !== 'string' || !key || !base64.test(key))) throw invalid();
}

export class ModelProfileStore {
  private profiles = new Map<string, ModelProfile>();
  private mutation = Promise.resolve();
  constructor(private directory: string, private storage: SecretStorage) {}

  async load() {
    let raw: string;
    try { raw = await readFile(path.join(this.directory, 'model-profiles.json'), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    const saved: unknown = JSON.parse(raw);
    if (!object(saved) || saved.version !== 1 || !('profiles' in saved)) throw invalid();
    const profiles = new Map<string, ModelProfile>();
    if (Array.isArray(saved.profiles)) {
      // Read the previous named-profile format once so an existing local
      // install keeps its most recently written entry for each provider.
      for (const value of saved.profiles) {
        if (!object(value)) throw invalid();
        const { id: _id, name: _name, ...profile } = value;
        if (profile.base_url === '') delete profile.base_url;
        validateStored(profile);
        profiles.set(profile.provider, profile);
      }
    } else if (object(saved.profiles)) {
      for (const [provider, value] of Object.entries(saved.profiles)) {
        validateStored(value, provider);
        profiles.set(provider, value);
      }
    } else throw invalid();
    this.profiles = profiles;
  }

  list(): PublicProfile[] {
    return [...this.profiles.values()].map(({ key, ...profile }) => ({ ...profile, hasKey: !!key }));
  }
  get(provider: string): ModelProfile | undefined {
    return this.profiles.get(provider);
  }
  keyOf(provider: string): string | undefined {
    const key = this.profiles.get(provider)?.key;
    if (!key) return undefined;
    if (!this.storage.isEncryptionAvailable()) throw unavailable();
    return this.storage.decryptString(Buffer.from(key, 'base64'));
  }
  upsert(input: ModelProfileInput): Promise<PublicProfile[]> {
    return this.change(async () => {
      validate(input);
      if (!this.storage.isEncryptionAvailable()) throw unavailable();
      const previous = this.profiles.get(input.provider);
      const apiKey = input.api_key?.trim();
      const profile: ModelProfile = {
        provider: input.provider,
        model: input.model.trim(),
        ...(input.base_url?.trim() ? { base_url: input.base_url.trim() } : {}),
        ...(input.api?.trim() ? { api: input.api.trim() } : {}),
        ...(input.thinking?.trim() ? { thinking: input.thinking.trim() } : {}),
        ...(apiKey ? { key: this.storage.encryptString(apiKey).toString('base64') } : previous?.key ? { key: previous.key } : {}),
      };
      await this.persist(new Map(this.profiles).set(profile.provider, profile));
      return this.list();
    });
  }

  async persist(profiles = this.profiles) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = path.join(this.directory, 'model-profiles.json');
    await writeFile(file + '.tmp', JSON.stringify({ version: 1, profiles: Object.fromEntries(profiles) }), { mode: 0o600 });
    await rename(file + '.tmp', file);
    this.profiles = profiles;
  }

  private change(operation: () => Promise<PublicProfile[]>) {
    const next = this.mutation.then(operation);
    this.mutation = next.then(() => {}, () => {});
    return next;
  }
}

function publicResult(value: unknown, key?: string): unknown {
  if (typeof value === 'string') return key ? redact(value, [key]) : value;
  if (Array.isArray(value)) return value.map(item => publicResult(item, key));
  if (object(value)) return Object.fromEntries(Object.entries(value)
    .filter(([name]) => name !== 'api_key' && name !== 'key')
    .map(([name, item]) => [key ? redact(name, [key]) : name, publicResult(item, key)]));
  return value;
}
export function sanitizeModelConfigResult(value: unknown): Record<string, unknown> {
  return publicResult(value) as Record<string, unknown>;
}

export async function applyRememberedModelConfig(
  patch: Record<string, string | number | boolean>,
  store: ModelProfileStore,
  configure: (patch: Record<string, string | number | boolean>) => Promise<Record<string, unknown>>,
  onStoreError?: (error: unknown) => void,
) {
  const provider = typeof patch.provider === 'string' ? patch.provider : undefined;
  let storedKey: string | undefined;
  const effective = { ...patch };
  if (provider && (typeof effective.api_key !== 'string' || !effective.api_key.trim())) {
    storedKey = store.keyOf(provider);
    if (storedKey) effective.api_key = storedKey;
  }
  const requestKey = typeof effective.api_key === 'string' && effective.api_key.trim()
    ? effective.api_key
    : storedKey;
  let data: Record<string, unknown>;
  try { data = await configure(effective); }
  catch (error) {
    throw new Error(redact(error instanceof Error ? error.message : '模型配置提交失败。', requestKey ? [requestKey] : []));
  }
  const safe = publicResult(data, requestKey) as Record<string, unknown>;
  if (data.ok === true && data.rolled_back !== true) {
    const config = object(data.config) ? data.config : {};
    const rememberedProvider = typeof config.provider === 'string' ? config.provider : provider;
    const model = typeof config.model === 'string' ? config.model : typeof effective.model === 'string' ? effective.model : '';
    if (rememberedProvider && model) {
      try {
        await store.upsert({
          provider: rememberedProvider,
          model,
          ...(typeof config.base_url === 'string' ? { base_url: config.base_url } : typeof effective.base_url === 'string' ? { base_url: effective.base_url } : {}),
          ...(typeof config.api === 'string' ? { api: config.api } : typeof effective.api === 'string' ? { api: effective.api } : {}),
          ...(typeof config.thinking === 'string' ? { thinking: config.thinking } : typeof effective.thinking === 'string' ? { thinking: effective.thinking } : {}),
          ...(typeof effective.api_key === 'string' ? { api_key: effective.api_key } : {}),
        });
      } catch (error) {
        onStoreError?.(error);
      }
    }
  }
  return safe;
}

export function listModelProfiles(input: unknown, store: ModelProfileStore): ModelProfilesResult {
  if (!object(input) || input.action !== 'list' || Object.keys(input).length !== 1) throw invalid();
  return { ok: true, profiles: store.list() };
}
