import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SecretStorage } from '../app/settings';
import type { ModelProfileInput } from '../../shared/types';
import { applyRememberedModelConfig, listModelProfiles, ModelProfileStore } from './model-profiles';

let directory: string;
let available: boolean;
let storage: SecretStorage;
let store: ModelProfileStore;
const input: ModelProfileInput = {
  provider: 'portal-custom',
  model: 'company-astra',
  base_url: 'https://models.example.test/v1',
  api: 'openai-completions',
  thinking: 'high',
  api_key: 'unit-test-model-secret',
};

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'portal-model-profiles-'));
  available = true;
  storage = {
    isEncryptionAvailable: () => available,
    encryptString: vi.fn(value => Buffer.from(value, 'utf8')),
    decryptString: vi.fn(value => value.toString('utf8')),
  };
  store = new ModelProfileStore(directory, storage);
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe('ModelProfileStore', () => {
  it('round-trips one encrypted entry per provider without returning a key', async () => {
    await store.load();
    const [profile] = await store.upsert(input);
    expect(profile).toEqual({
      provider: input.provider, model: input.model, base_url: input.base_url,
      api: input.api, thinking: input.thinking, hasKey: true,
    });
    expect(profile).not.toHaveProperty('key');
    expect(profile).not.toHaveProperty('api_key');
    const raw = await readFile(path.join(directory, 'model-profiles.json'), 'utf8');
    expect(raw).not.toContain(input.api_key);
    expect(raw).toContain('"portal-custom"');
    expect(JSON.parse(raw)).toMatchObject({
      version: 1, profiles: { 'portal-custom': { key: Buffer.from(input.api_key!).toString('base64') } },
    });
    const reopened = new ModelProfileStore(directory, storage);
    await reopened.load();
    expect(reopened.list()).toEqual([profile]);
    expect(reopened.keyOf(input.provider)).toBe(input.api_key);
  });

  it('replaces the latest entry for the same provider and retains a blank key', async () => {
    const [original] = await store.upsert(input);
    const [updated] = await store.upsert({ ...input, model: 'company-astra-v2', api_key: '' });
    expect(store.list()).toHaveLength(1);
    expect(updated).toMatchObject({ provider: input.provider, model: 'company-astra-v2', hasKey: true });
    expect(store.keyOf(input.provider)).toBe(input.api_key);
    expect(updated).not.toHaveProperty('name');
    expect(updated).not.toHaveProperty('id');
    expect(original.model).toBe('company-astra');
  });

  it('keeps independent providers and writes atomically under concurrent updates', async () => {
    await Promise.all([
      store.upsert({ provider: 'self-hosted', model: 'glm-5.3', base_url: 'http://127.0.0.1:7860/v1' }),
      store.upsert(input),
      store.upsert({ provider: 'openrouter', model: 'deepseek-v4.1-flash', api_key: 'router-secret' }),
    ]);
    expect(store.list().map(profile => profile.provider)).toEqual(['self-hosted', 'portal-custom', 'openrouter']);
    const reopened = new ModelProfileStore(directory, storage);
    await reopened.load();
    expect(reopened.list()).toEqual(store.list());
    expect(await readFile(path.join(directory, 'model-profiles.json.tmp'), 'utf8').catch(error => error.code)).toBe('ENOENT');
  });

  it('migrates the previous named-profile array by retaining the last entry per provider', async () => {
    await writeFile(path.join(directory, 'model-profiles.json'), JSON.stringify({
      version: 1,
      profiles: [
        { id: 'old-1', name: '旧版 1', provider: 'openrouter', model: 'old-model', key: 'b2xk' },
        { id: 'old-2', name: '旧版 2', provider: 'openrouter', model: 'new-model', key: 'bmV3' },
      ],
    }));
    await store.load();
    expect(store.list()).toEqual([{ provider: 'openrouter', model: 'new-model', hasKey: true }]);
    expect(store.keyOf('openrouter')).toBe('new');
  });

  it.each([
    { provider: 'unknown-provider' },
    { model: ' ' },
    { base_url: 'file:///tmp/models' },
    { base_url: 'not-a-url' },
    { base_url: '' },
    { base_url: 'https://user:password@example.test/v1' },
    { api_key: '密'.repeat(6000) },
  ])('rejects invalid profile fields: %j', async patch => {
    await expect(store.upsert({ ...input, ...patch })).rejects.toThrow('无效的模型档案。');
    expect(store.list()).toEqual([]);
  });

  it('reports the Chinese keychain error on save while list remains usable', async () => {
    await store.upsert(input);
    available = false;
    const reopened = new ModelProfileStore(directory, storage);
    await reopened.load();
    expect(reopened.list()).toMatchObject([{ provider: input.provider, hasKey: true }]);
    await expect(reopened.upsert(input)).rejects.toThrow('系统密钥库不可用，无法安全保存模型密钥。');
    expect(() => reopened.keyOf(input.provider)).toThrow('系统密钥库不可用，无法安全保存模型密钥。');
    expect(() => listModelProfiles({ action: 'list' }, reopened)).not.toThrow();
  });

  it('keeps the previous file and memory when an atomic write fails', async () => {
    const original = await store.upsert(input);
    const raw = await readFile(path.join(directory, 'model-profiles.json'), 'utf8');
    await mkdir(path.join(directory, 'model-profiles.json.tmp'));
    await expect(store.upsert({ ...input, model: 'not-persisted' })).rejects.toThrow();
    expect(store.list()).toEqual(original);
    expect(await readFile(path.join(directory, 'model-profiles.json'), 'utf8')).toBe(raw);
  });
});

describe('remembered model config', () => {
  it('injects the stored key in the main process and saves the latest successful config', async () => {
    await store.upsert(input);
    const configure = vi.fn().mockResolvedValue({
      ok: true,
      config: { provider: input.provider, model: 'new-model', base_url: input.base_url, api: input.api },
      api_key: input.api_key,
    });
    const result = await applyRememberedModelConfig(
      { provider: input.provider, model: 'new-model', base_url: input.base_url! },
      store,
      configure,
    );
    expect(configure).toHaveBeenCalledWith({
      provider: input.provider, model: 'new-model', base_url: input.base_url, api_key: input.api_key,
    });
    expect(JSON.stringify(result)).not.toContain(input.api_key);
    expect(result).not.toHaveProperty('api_key');
    expect(store.list()).toEqual([{
      provider: input.provider, model: 'new-model', base_url: input.base_url,
      api: input.api, hasKey: true,
    }]);
  });

  it('uses a newly entered key without decrypting the old one and does not remember failures or rollbacks', async () => {
    await store.upsert(input);
    vi.mocked(storage.decryptString).mockClear();
    const configure = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: 'invalid key' })
      .mockResolvedValueOnce({ ok: true, rolled_back: true, config: { provider: input.provider, model: input.model } });
    await applyRememberedModelConfig({ provider: input.provider, model: 'failed', api_key: 'replacement' }, store, configure);
    expect(storage.decryptString).not.toHaveBeenCalled();
    expect(store.keyOf(input.provider)).toBe(input.api_key);
    await applyRememberedModelConfig({ provider: input.provider, model: 'rolled-back' }, store, configure);
    expect(store.keyOf(input.provider)).toBe(input.api_key);
  });

  it('redacts stored keys from thrown errors and keeps remote success when local persistence is unavailable', async () => {
    await store.upsert(input);
    const configure = vi.fn().mockRejectedValue(new Error(`failed for ${input.api_key}`));
    await expect(applyRememberedModelConfig({ provider: input.provider, model: input.model }, store, configure))
      .rejects.toThrow('failed for [redacted]');
    available = false;
    const errors: unknown[] = [];
    const result = await applyRememberedModelConfig(
      { provider: 'openrouter', model: 'deepseek-v4.1-flash' },
      store,
      vi.fn().mockResolvedValue({ ok: true, config: { provider: 'openrouter', model: 'deepseek-v4.1-flash' } }),
      error => errors.push(error),
    );
    expect(result.ok).toBe(true);
    expect(errors).toHaveLength(1);
  });

  it('redacts a newly entered key before returning a remote error', async () => {
    const entered = 'newly-entered-model-secret';
    const result = await applyRememberedModelConfig(
      { provider: 'openrouter', model: 'deepseek-v4.1-flash', api_key: entered },
      store,
      vi.fn().mockResolvedValue({ ok: false, error: `rejected ${entered}` }),
    );
    expect(JSON.stringify(result)).not.toContain(entered);
    expect(result).toEqual({ ok: false, error: 'rejected [redacted]' });
  });

  it.each([null, [], {}, { action: 'save' }, { action: 'list', extra: true }])('rejects malformed list IPC input: %j', input => {
    expect(() => listModelProfiles(input, store)).toThrow('无效的模型档案。');
  });
});
