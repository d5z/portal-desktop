import type { ChatScene } from "../desktop/shared/types";
export interface WebScenes {
  active: string;
  scope: "current" | "all";
  scenes: ChatScene[];
}
export type SceneOperation = "create" | "select" | "rename" | "delete" | "bind";
const key = (endpoint: string) => "town-web:scenes:" + endpoint;
const validId = (id: unknown): id is string =>
  typeof id === "string" &&
  id.length > 0 &&
  id.length <= 256 &&
  !/[\u0000-\u0020]/.test(id);
const make = (name: string): ChatScene => ({
  scene_id: "web-" + crypto.randomUUID(),
  scene_meta: { client: "town-web", scene_label: name },
});
export function loadScenes(
  endpoint: string,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): WebScenes {
  const raw = storage.getItem(key(endpoint));
  if (raw === null) {
    const scene = make("日常对话");
    const group: WebScenes = {
      active: scene.scene_id,
      scope: "all",
      scenes: [scene],
    };
    saveScenes(endpoint, group, storage);
    return group;
  }
  const group = JSON.parse(raw) as WebScenes;
  if (
    !group ||
    !["current", "all"].includes(group.scope) ||
    !Array.isArray(group.scenes) ||
    !group.scenes.length ||
    group.scenes.length > 500 ||
    group.scenes.some(
      (scene) =>
        !validId(scene?.scene_id) ||
        typeof scene.scene_meta?.scene_label !== "string" ||
        !scene.scene_meta.scene_label.trim() ||
        scene.scene_meta.scene_label.length > 128,
    ) ||
    !group.scenes.some((scene) => scene.scene_id === group.active) ||
    new Set(group.scenes.map((scene) => scene.scene_id)).size !==
      group.scenes.length
  )
    throw new Error("无法读取此 Being 的场景目录，请检查浏览器存储后重试。");
  return group;
}
export function saveScenes(
  endpoint: string,
  group: WebScenes,
  storage: Pick<Storage, "setItem"> = localStorage,
) {
  storage.setItem(key(endpoint), JSON.stringify(group));
}
export function changeScene(
  group: WebScenes,
  operation: SceneOperation,
  value: string,
  id?: string,
): WebScenes {
  const next = structuredClone(group);
  if (operation === "select") {
    if (!next.scenes.some((scene) => scene.scene_id === value))
      throw new Error("场景不存在。");
    next.active = value;
  } else if (operation === "delete") {
    if (!next.scenes.some((scene) => scene.scene_id === value))
      throw new Error("场景不存在。");
    next.scenes = next.scenes.filter((scene) => scene.scene_id !== value);
    if (!next.scenes.length) next.scenes = [make("日常对话")];
    if (next.active === value) next.active = next.scenes[0].scene_id;
  } else {
    const label = value.trim();
    if (!label || label.length > 128 || /[\u0000-\u001f]/.test(label))
      throw new Error("场景名称需为 1–128 个字符。");
    if (operation === "rename") {
      const scene = next.scenes.find(
        (scene) => scene.scene_id === (id || next.active),
      );
      if (!scene) throw new Error("场景不存在。");
      scene.scene_meta.scene_label = label;
    } else {
      if (next.scenes.length >= 500) throw new Error("场景数量已达上限。");
      if (operation === "bind" && !validId(id))
        throw new Error("请输入有效的场景 ID。");
      const scene =
        operation === "bind"
          ? {
              scene_id: id!,
              scene_meta: { client: "town-web", scene_label: label },
            }
          : make(label);
      if (!next.scenes.some((saved) => saved.scene_id === scene.scene_id))
        next.scenes.push(scene);
      next.active = scene.scene_id;
    }
  }
  next.scope = "current";
  return next;
}
