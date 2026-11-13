import { describe, expect, it, vi } from 'vitest';
import { HomeConnectors } from '../desktop/main/home/connectors';
import { HomeError, homeErrorMessage } from '../desktop/main/home/protocol';
import { connectorNetworkPath } from '../desktop/shared/home';

function transport() {
  return { request: vi.fn() } as unknown as { request: ReturnType<typeof vi.fn> };
}

describe('Home Connector transport', () => {
  it('keeps actionable error codes ahead of generic HTTP messages', () => {
    expect(homeErrorMessage(400, 'invalid_grant')).toContain('登录已过期');
    expect(homeErrorMessage(400, 'invalid_path')).toContain('文件路径无效');
    expect(homeErrorMessage(409, 'connector_account_identity_missing')).toContain('尚未识别第三方账号');
  });

  it('resolves service-relative Connector icons against the Home origin', async () => {
    const client = transport();
    client.request.mockResolvedValueOnce({ enabled: true, items: [{ icon_url: 'assets/connector-icons/github.svg', runtimes: ['local'], local_install_url: 'portal-kit://install?market=grove&release=release' }], next_after: null });
    client.request.mockResolvedValueOnce({ name: 'GitHub', icon_url: 'assets/connector-icons/github.svg', accounts: [], methods: [] });
    const api = new HomeConnectors(client as never, vi.fn());
    await expect(api.catalog()).resolves.toMatchObject({ items: [{ icon_url: 'https://home.beings.town/assets/connector-icons/github.svg', runtimes: ['local'], local_install_url: 'portal-kit://install?market=grove&release=release' }] });
    await expect(api.detail('release')).resolves.toMatchObject({ icon_url: 'https://home.beings.town/assets/connector-icons/github.svg' });
  });

  it('keeps lifecycle request ids stable when a caller retries an operation', async () => {
    const client = transport();
    client.request.mockResolvedValue({});
    const api = new HomeConnectors(client as never, vi.fn());
    await api.lifecycle('installation', 'uninstall', 7, '00000000-0000-4000-8000-000000000001');
    await api.lifecycle('installation', 'uninstall', 7, '00000000-0000-4000-8000-000000000001');
    const bodies = client.request.mock.calls.map(([, init]) => JSON.parse(String(init.body)));
    expect(bodies).toEqual([
      { action: 'uninstall', expected_revision: 7, request_id: '00000000-0000-4000-8000-000000000001' },
      { action: 'uninstall', expected_revision: 7, request_id: '00000000-0000-4000-8000-000000000001' },
    ]);
  });

  it('rejects missing connector route identifiers before constructing a request', () => {
    expect(() => connectorNetworkPath('detail', [])).toThrow('release_id 无效');
    expect(() => connectorNetworkPath('installation', [undefined])).toThrow('installation_id 无效');
  });

  it.each([
    ['kit_operation_changed', '应用状态已变化'],
    ['kit_operation_in_progress', '尚未完成的安装或变更任务'],
    ['kit_installation_removed', '此应用已断开'],
    ['unknown_conflict', '当前状态与此操作冲突'],
  ])('returns a rejected lifecycle result for %s without replaying the request', async (code, message) => {
    const client = transport();
    client.request.mockRejectedValue(new HomeError(409, code));
    const api = new HomeConnectors(client as never, vi.fn());
    await expect(api.lifecycle('installation', 'uninstall', 7, 'request')).resolves.toEqual({ accepted: false, message: expect.stringContaining(message) });
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it.each([0, 500])('keeps an uncertain lifecycle failure at HTTP %s as an error', async status => {
    const client = transport();
    const error = new HomeError(status, status ? 'internal' : 'network');
    client.request.mockRejectedValue(error);
    const api = new HomeConnectors(client as never, vi.fn());
    await expect(api.lifecycle('installation', 'uninstall', 7, 'request')).rejects.toBe(error);
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it('rejects unsafe authorization links before opening the browser', async () => {
    const openExternal = vi.fn();
    const api = new HomeConnectors(transport() as never, openExternal);
    await expect(api.openAuthorization('https://user:pass@example.com/oauth')).rejects.toThrow('授权地址无效');
    expect(openExternal).not.toHaveBeenCalled();
  });
});
