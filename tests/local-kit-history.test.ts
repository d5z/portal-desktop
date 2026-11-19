import { describe, expect, it, vi } from 'vitest';
import { TownModel, type TownAPI } from '../desktop/renderer/town/models/town';
import { SceneStore } from '../desktop/renderer/shared/models/scene';

function fixture() {
  let home = { authenticated: true, authenticating: false, sessionVersion: 1 };
  const report = vi.fn().mockResolvedValue({});
  const candidates = vi.fn().mockResolvedValue([{ name: 'Cursor', source_id: 'cursor-town', version: '1.0' }]);
  const api = { home: { state: async () => home, connectors: { reportLocalKitHistory: report } }, localKitHistoryCandidates: candidates } as unknown as TownAPI;
  const model = new TownModel(api, vi.fn(), vi.fn(), new SceneStore(), vi.fn(), vi.fn());
  return { model, report, candidates, setHome: (state: typeof home) => { home = state; } };
}

describe('Home local Kit history session boundaries', () => {
  it('coalesces concurrent backfills and caches successful entries within the session', async () => {
    const { model, candidates, report } = fixture();
    await Promise.all([model.syncLocalKitHistory(), model.syncLocalKitHistory()]);
    expect(candidates).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledExactlyOnceWith({ source_id: 'cursor-town', version: '1.0' }, 1);
    await model.syncLocalKitHistory();
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('retries a failed history entry on refresh and clears its failure message', async () => {
    const { model, report } = fixture();
    report.mockRejectedValueOnce(new Error('offline'));
    await model.syncLocalKitHistory();
    expect(model.localKitHistoryError).toContain('同步失败');
    await model.syncLocalKitHistory();
    expect(report).toHaveBeenCalledTimes(2);
    expect(model.localKitHistoryError).toBe('');
  });

  it('discards metadata arriving after logout and scopes later reports to the new account', async () => {
    const { model, report, candidates, setHome } = fixture();
    let resolve!: (items: { name: string; source_id: string; version: string }[]) => void;
    candidates.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = model.syncLocalKitHistory();
    await Promise.resolve();
    setHome({ authenticated: false, authenticating: false, sessionVersion: 2 });
    await model.syncLocalKitHistory();
    resolve([{ name: 'Cursor', source_id: 'cursor-town', version: '1.0' }]);
    await pending;
    expect(report).not.toHaveBeenCalled();
    setHome({ authenticated: true, authenticating: false, sessionVersion: 3 });
    await model.syncLocalKitHistory();
    expect(report).toHaveBeenCalledExactlyOnceWith({ source_id: 'cursor-town', version: '1.0' }, 3);
  });
});
