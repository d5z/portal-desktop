import { describe, expect, it, vi } from "vitest";
import { TownModel } from "../desktop/renderer/town/models/town";
import { SceneStore } from "../desktop/renderer/shared/models/scene";
import { hostPluginContext } from '../desktop/renderer/plugins/context';
import type { DesktopAPI, KitInstallPlan, KitLibrary, LocalKit, TownResult } from "../desktop/shared/types";

const kit = (name: string, version = "1.0"): LocalKit => ({ name, version, directory: "/kits/" + name, description: "Kit", command: ["node", "server.mjs"], tools: [], compatible: true, eager: false });
const library = (...kits: LocalKit[]): KitLibrary => ({ directory: "/kits", enabled: true, kits });
const plan: KitInstallPlan & { sourceId: string } = { ...kit("alpha"), sourceId: "alpha-id", ticket: "ticket", tools: 0, environment: [], dependency: "none", sha256: "fixture", notes: "" };
function fixture(overrides: Partial<DesktopAPI> = {}) {
  const api = {
    localKits: vi.fn(async () => library()),
    townAuth: vi.fn(async () => ({ configured: false })),
    town: vi.fn(async () => ({ ok: true, data: { kits: [{ id: "alpha-id", name: "alpha", version: "1.0" }] }, fetchedAt: "2026-09-15" })),
    installKit: vi.fn(async () => ({ name: "alpha", tools: 0, message: "已安装" })),
    ...overrides,
  } as unknown as DesktopAPI;
  const model = new TownModel(api, vi.fn(), vi.fn(), new SceneStore(), vi.fn(), vi.fn());
  model.view = "kits"; model.tab = "grove";
  return { model, api };
}

describe("Kit installation status", () => {
  it('reports history only after a successful install, not when reading lists or retrying a failure', async () => {
    const reportLocalKitHistory = vi.fn().mockRejectedValue(new Error('接口未上线'));
    const installKit = vi.fn().mockRejectedValueOnce(new Error('安装失败')).mockResolvedValue({ name: 'alpha', message: '已安装', tools: 0 });
    const { model } = fixture({
      prepareKit: vi.fn().mockResolvedValue(plan), installKit,
      home: { state: vi.fn(async () => ({ authenticated: true, sessionVersion: 1 })), connectors: { reportLocalKitHistory } } as unknown as DesktopAPI['home'],
    });
    await model.load();
    await model.refreshInstalledKits();
    await model.prepareKit('town-source-id');
    expect(reportLocalKitHistory).not.toHaveBeenCalled();
    await model.install();
    expect(reportLocalKitHistory).not.toHaveBeenCalled();
    await model.install();
    expect(reportLocalKitHistory).toHaveBeenCalledExactlyOnceWith({ source_id: 'town-source-id', version: plan.version }, 1);
    expect(model.localKitHistoryError).toContain('同步失败');
    expect(model.installError).toBe('');
    expect(model.plan).toBeUndefined();
    await model.load();
    await model.refreshInstalledKits();
    expect(reportLocalKitHistory).toHaveBeenCalledTimes(1);
  });

  it('commits remote selection with its detail request and rejects an older response', async () => {
    const pending = new Map<string, (value: any) => void>();
    const { model } = fixture({ town: vi.fn(query => new Promise<TownResult>(resolve => pending.set(query.id!, resolve))) });
    const entry = (id: string) => ({ key: `grove:${id}`, kind: 'plugin' as const, name: id, description: '', local: false, remote: { id } });
    model.selectTool(entry('goals'));
    model.selectTool(entry('pipeline'));
    expect(model.toolSelection).toBe('grove:pipeline');
    expect(model.selectedId).toBe('pipeline');
    expect(model.detail).toBeUndefined();
    pending.get('pipeline')!({ ok: true, data: { name: '星图流程看板' }, fetchedAt: '' });
    await vi.waitFor(() => expect(model.detail?.fragments[0].name).toBe('星图流程看板'));
    pending.get('goals')!({ ok: true, data: { name: '目标' }, fetchedAt: '' });
    await Promise.resolve();
    expect(model.detail?.query.id).toBe('pipeline');
    expect(model.detail?.fragments[0].name).toBe('星图流程看板');
  });

  it('keeps installed plugin details local even when matched to a Grove entry', () => {
    const { model, api } = fixture();
    model.selectTool({ key: 'plugin:goals', kind: 'plugin', name: '目标', description: '', local: true,
      plugin: { manifest: { id: 'goals' } } as any, remote: { id: 'goals-remote' } });
    expect(model.toolSelection).toBe('plugin:goals');
    expect(api.town).not.toHaveBeenCalled();
    expect(model.detail).toBeUndefined();
  });

  it('clears remote resource context and rejects late details when selecting a local tool', async () => {
    let release!: (value: any) => void;
    const { model } = fixture({ town: vi.fn().mockResolvedValueOnce({ ok: true,
      data: { id: 'remote', name: 'Remote App', description: 'Remote resource' }, fetchedAt: '' })
      .mockImplementationOnce(() => new Promise(resolve => { release = resolve; })) });
    model.scenes.enter('kits');
    model.live = { generation: 1 } as any;
    const context = () => hostPluginContext({ view: 'kits', town: model,
      snapshot: { settings: { endpoint: '' } }, workspace: { scenes: model.scenes } } as any)?.context;
    await model.loadDetail({ kind: 'kit', id: 'remote' });
    expect(context()?.resource?.id).toBe('remote');
    const pending = model.loadDetail({ kind: 'kit', id: 'remote' });
    model.selectTool({ key: 'kit:local', name: 'local', description: '', kind: 'kit', local: true, kit: kit('local') });
    expect(model.detail).toBeUndefined();
    expect(model.detailLoading).toBe(false);
    expect(context()?.resource).toBeUndefined();
    release({ ok: true, data: { id: 'remote', name: 'Late remote' }, fetchedAt: '' });
    await pending;
    expect(model.detail).toBeUndefined();
    expect(context()?.title).toBe('工具间 · local');
    expect(context()?.resource).toBeUndefined();
  });

  it('locates an installed Kit on its page and replaces an older tool selection', async () => {
    const files = Array.from({ length: 26 }, (_, i) => kit(`local-${i}`));
    const { model } = fixture({ localKits: vi.fn(async () => library(...files)) });
    model.toolSelection = 'kit:local-0';
    await model.showInstalledKit('local-25');
    expect(model.offset).toBe(24);
    expect(model.toolSelection).toBe('kit:local-25');
    expect(model.pagination().items.some(item => item.key === model.toolSelection)).toBe(true);
    expect(model.localKit).toBe(files[25]);
    await model.showInstalledKit('local-1');
    expect(model.offset).toBe(0);
    expect(model.toolSelection).toBe('kit:local-1');
  });

  it("reads all local manifests, including old versions and imports, on every Grove visit", async () => {
    const files = [kit("alpha", "0.9"), kit("imported")];
    const { model, api } = fixture({ localKits: vi.fn(async () => library(...files)) });
    await model.load();
    expect(model.installedKit("alpha")?.version).toBe("0.9");
    expect(model.installedKit("imported")).toBe(files[1]);
    expect(model.installedKit("absent")).toBeUndefined();
    files.splice(0, 1);
    await model.load();
    expect(api.localKits).toHaveBeenCalledTimes(2);
    expect(model.installedKit("alpha")).toBeUndefined();
    expect(model.installedKit("imported")).toBe(files[0]);
  });

  it("keeps the selected Grove item and ignores older disk reads after installation", async () => {
    let finishOld!: (value: KitLibrary) => void;
    const localKits = vi.fn().mockImplementationOnce(() => new Promise<KitLibrary>(resolve => { finishOld = resolve; })).mockResolvedValue(library(kit("alpha"), kit("beta")));
    const { model } = fixture({ localKits });
    const older = model.refreshInstalledKits();
    model.plan = plan;
    model.selectedId = "alpha-id";
    model.search = "alpha";
    const detail = { query: { kind: "kit" as const, id: "alpha-id" }, fragments: [{ name: "alpha" }] };
    model.detail = detail;
    await model.install();
    expect(model.installedKit("alpha")?.version).toBe("1.0");
    finishOld(library()); await older;
    expect(model.installedKit("alpha")?.version).toBe("1.0");
    expect(model.installedKit("beta")?.version).toBe("1.0");
    expect(model.tab).toBe("grove");
    expect(model.selectedId).toBe("alpha-id");
    expect(model.detail).toBe(detail);
    expect(model.search).toBe("alpha");
    expect(model.plan).toBeUndefined();
    await model.showInstalledKit("alpha");
    expect(model.tab).toBe("grove");
    expect(model.localOnly).toBe(true);
    expect(model.groveKind).toBe('kit');
    expect(model.localKit?.name).toBe("alpha");
  });

  it("keeps installation success separate from a failed status read, then retries", async () => {
    const localKits = vi.fn().mockRejectedValueOnce(new Error("目录暂时不可读")).mockResolvedValue(library(kit("alpha")));
    const { model, api } = fixture({ localKits });
    model.plan = plan;
    await model.install();
    expect(model.plan).toBeUndefined();
    expect(model.installError).toBe("");
    expect(model.installedError).toBe("目录暂时不可读");
    expect(model.installedLibrary).toBeNull();
    await model.refreshInstalledKits();
    expect(model.installedError).toBe("");
    expect(model.installedKit("alpha")?.version).toBe("1.0");
    expect(api.installKit).toHaveBeenCalledTimes(1);
  });

  it("does not report installation success for a failed install", async () => {
    const { model, api } = fixture({ installKit: vi.fn(async () => { throw new Error("依赖安装失败"); }) });
    await model.refreshInstalledKits();
    model.plan = plan;
    await model.install();
    expect(model.plan).toBe(plan);
    expect(model.installError).toBe("依赖安装失败");
    expect(model.installedKit("alpha")).toBeUndefined();
    expect(api.localKits).toHaveBeenCalledTimes(1);
  });
});
