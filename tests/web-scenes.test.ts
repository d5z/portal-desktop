import { expect, it } from "vitest";
import { changeScene, loadScenes, saveScenes } from "../web/scenes";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    values,
  };
}
it("isolates scene directories by Being and restores the active scene and scope", () => {
  const store = storage();
  const first = loadScenes("https://loom.test/a", store);
  const work = changeScene(first, "create", "工作");
  saveScenes("https://loom.test/a", work, store);
  expect(loadScenes("https://loom.test/a", store)).toEqual(work);
  expect(loadScenes("https://loom.test/b", store).active).not.toBe(work.active);
  expect(first.scenes).toHaveLength(1);
  expect(work.scope).toBe("current");
});
it("keeps scene identity on rename and supports existing Unicode desktop IDs", () => {
  const initial = loadScenes("a", storage());
  const bound = changeScene(initial, "bind", "桌面对话", "loom-柳树");
  const renamed = changeScene(bound, "rename", "新的名称");
  expect(renamed.active).toBe("loom-柳树");
  expect(renamed.scenes.at(-1)?.scene_meta.scene_label).toBe("新的名称");
  expect(
    changeScene(renamed, "bind", "再次添加", "loom-柳树").scenes,
  ).toHaveLength(2);
});
it("selects a remaining scene on removal and creates a fresh last-scene fallback", () => {
  const initial = loadScenes("a", storage());
  const second = changeScene(initial, "create", "计划");
  const removed = changeScene(second, "delete", second.active);
  expect(removed.active).toBe(initial.active);
  const fresh = changeScene(removed, "delete", removed.active);
  expect(fresh.scenes).toHaveLength(1);
  expect(fresh.active).not.toBe(initial.active);
});
it("does not silently overwrite invalid storage or accept invalid IDs", () => {
  const store = storage();
  store.setItem("town-web:scenes:a", "{bad");
  expect(() => loadScenes("a", store)).toThrow();
  expect(store.getItem("town-web:scenes:a")).toBe("{bad");
  const initial = loadScenes("b", store);
  expect(() => changeScene(initial, "bind", "场景", "bad id")).toThrow();
  expect(() => changeScene(initial, "rename", "")).toThrow();
  expect(() => changeScene(initial, "select", "missing")).toThrow();
});
