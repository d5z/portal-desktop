import { expect, it } from 'vitest';
import { subagentCatalog } from '../desktop/renderer/app/models/subagent-catalog';
it('copies custom Being connection fields and lists model presets without copying server keys', () => {
  const config = { provider: 'custom', model: 'private-model', base_url: 'https://custom.example/v1', api: 'openai-completions', api_key: 'server-secret', presets: [
    { id: 'gpt', provider: 'openai-responses', model: 'gpt-fixture', label: 'GPT fixture', has_key: true },
    { id: 'unknown', provider: 'unknown', model: 'unknown', label: 'Unknown' },
  ] };
  const catalog = subagentCatalog(config);
  expect(catalog.current).toMatchObject({ model: 'private-model', base_url: 'https://custom.example/v1', api: 'openai-completions' });
  expect(catalog.presets).toHaveLength(1);
  expect(catalog.presets[0]).toMatchObject({ model: 'gpt-fixture', api: 'openai-responses' });
  expect(JSON.stringify(catalog)).not.toContain('server-secret');
  expect(catalog.presets[0]).not.toHaveProperty('has_key');
});
it('excludes self-hosted models from copying and the subagent catalog', () => {
  const preset = { id: 'local', provider: 'self-hosted', model: 'glm-fixture', label: '自部署', base_url: 'https://my-server.example/v1' };
  for (const provider of ['self-hosted', undefined]) {
    const catalog = subagentCatalog({ provider, model: preset.model, base_url: preset.base_url, presets: [preset] });
    expect(catalog.current).toBeUndefined();
    expect(catalog.presets).toEqual([]);
    expect(catalog.copyBlockedReason).toContain('不能直接应用到 subagent');
  }
});
it('keeps provider presets selectable and copies a supported Being model', () => {
  const catalog = subagentCatalog({provider:'openai', model:'gpt-fixture'});
  expect(catalog.current).toMatchObject({model:'gpt-fixture',base_url:'https://api.openai.com/v1'});
  expect(catalog.copyBlockedReason).toBeUndefined();
});
