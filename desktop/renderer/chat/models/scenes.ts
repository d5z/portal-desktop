import type { ChatItem } from "./chat";

export interface MessageScene {
  sceneId?: string;
  sceneLabel?: string;
  legacySceneId?: string;
  strict?: boolean;
}
export type HistoryScope = "current" | "all";

export function messageScene(value: unknown): MessageScene {
  if (!value || typeof value !== "object") return {};
  const data = value as Record<string, unknown>;
  const meta = data.scene_meta as Record<string, unknown> | undefined;
  const id = typeof data.scene_id === "string" ? data.scene_id : "";
  const label = data.scene_label || meta?.scene_label;
  return id ? {
    sceneId: id,
    sceneLabel: typeof label === "string" ? label.trim().slice(0, 128) || undefined : undefined,
  } : {};
}

export function sceneName(scene: MessageScene, current: MessageScene, names: Record<string, string> = {}): string {
  const localName = scene.sceneId && Object.hasOwn(names, scene.sceneId) ? names[scene.sceneId] : undefined;
  return localName || (scene.sceneId && scene.sceneId === current.sceneId ? current.sceneLabel : undefined) ||
    scene.sceneLabel || scene.sceneId || "未标记场景";
}

export function sceneItems(items: ChatItem[], scope: HistoryScope, current: MessageScene): ChatItem[] {
  return scope === "current" && current.sceneId
    ? items.filter(item => inCurrentScene(item, current))
    : items;
}

// Legacy Loom keeps shared history; managed sessions use strict scene boundaries.
export function inCurrentScene(scene: MessageScene, current: MessageScene): boolean {
  return !current.sceneId || (!scene.sceneId && !current.strict) || scene.sceneId === current.sceneId ||
    (!current.strict && !!current.legacySceneId && scene.sceneId === current.legacySceneId);
}
