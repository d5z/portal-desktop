import { expect, it } from 'vitest';
import { subagentHealth } from '../desktop/main/portal/status';
import type { SubagentConfig, SceneTask } from '../desktop/shared/types';
const config: SubagentConfig = { provider: 'openrouter', model: 'test', thinking: 'medium', inherit_model: true, api_key_configured: false };
it('shows missing credentials independently of the engine ready flag', () => {
  expect(subagentHealth(config, { endpoint: '', tasks: [], subagentReady: true }, 'connected')).toMatchObject({ health: 'warning', apiKeyConfigured: false, ready: true });
});
it('keeps a recent failure visible but clears it after a newer completed task', () => {
  const failed: SceneTask = { id: 'failure', sceneId: 'a', status: 'failed', createdAt: 1, endedAt: 2, error: '模型鉴权失败' };
  const done: SceneTask = { id: 'success', sceneId: 'b', status: 'done', createdAt: 3, endedAt: 4 };
  expect(subagentHealth(config, { endpoint: '', tasks: [failed] }, 'connected')).toMatchObject({ health: 'error', lastTask: failed });
  expect(subagentHealth({ ...config, api_key_configured: true }, { endpoint: '', tasks: [done, failed], subagentReady: true }, 'connected')).toMatchObject({ health: 'ok', lastTask: done });
});
it('shows offline and unavailable runtimes instead of assuming a saved key means ready', () => {
  expect(subagentHealth({ ...config, api_key_configured: true }, { endpoint: '', tasks: [] }, 'error')).toMatchObject({ health: 'error', ready: false });
});

it('does not attribute an old model failure to a newly verified configuration', () => {
  const old: SceneTask = { id: 'old', sceneId: 'a', status: 'failed', createdAt: 1, endedAt: 2 };
  const current = { ...config, api_key_configured: true, validated_at: 3 };
  expect(subagentHealth(current, { endpoint: '', tasks: [old], subagentReady: true }, 'connected')).toMatchObject({ health: 'ok' });
  expect(subagentHealth(current, { endpoint: '', tasks: [{ ...old, id: 'new', createdAt: 4, endedAt: 5 }], subagentReady: true }, 'connected')).toMatchObject({ health: 'error' });
});
