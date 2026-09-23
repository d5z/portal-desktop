import { useState } from "react";
import { Dialog } from "../desktop/renderer/shared/components/dialog";
import {
  CHAT_SCENE_ACTIVITY_LABELS,
  type ChatSceneActivity,
} from "../desktop/shared/types";
import type { SceneOperation, WebScenes } from "./scenes";
import { Icon } from "./icons";

export function ScenePicker({
  open,
  close,
  group,
  activity,
  change,
}: {
  open: boolean;
  close(): void;
  group: WebScenes;
  activity: Record<string, ChatSceneActivity>;
  change(operation: SceneOperation, value: string, id?: string): void;
}) {
  const [editor, setEditor] = useState<{
    operation: "create" | "rename" | "bind";
    id?: string;
  }>();
  const [name, setName] = useState(""),
    [id, setId] = useState(""),
    [error, setError] = useState("");
  const [deleting, setDeleting] = useState<string>();
  const dismiss = () => {
    setEditor(undefined);
    setDeleting(undefined);
    setError("");
    close();
  };
  const perform = (
    operation: SceneOperation,
    value: string,
    target?: string,
  ) => {
    try {
      change(operation, value, target);
      setError("");
      setEditor(undefined);
      setDeleting(undefined);
      if (
        operation === "select" ||
        operation === "create" ||
        operation === "bind"
      )
        close();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "场景保存失败，请检查浏览器存储。",
      );
    }
  };
  return (
    <Dialog
      open={open}
      onClose={dismiss}
      id="web-scenes"
      aria-labelledby="web-scenes-title"
    >
      <div className="dialog-heading">
        <h2 id="web-scenes-title">
          {editor
            ? editor.operation === "rename"
              ? "重命名场景"
              : editor.operation === "bind"
                ? "添加已有场景"
                : "新建场景"
            : "对话场景"}
        </h2>
        <button className="close" aria-label="关闭场景管理" onClick={dismiss} />
      </div>
      <div className="dialog-body">
        {editor ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              perform(
                editor.operation,
                name,
                editor.operation === "bind" ? id : editor.id,
              );
            }}
          >
            <label htmlFor="web-scene-name">场景名称</label>
            <input
              id="web-scene-name"
              autoFocus
              value={name}
              maxLength={128}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：日常、工作、旅行计划"
              required
            />
            {editor.operation === "bind" && (
              <>
                <label htmlFor="web-scene-id">已有场景 ID</label>
                <input
                  id="web-scene-id"
                  value={id}
                  onChange={(event) => setId(event.target.value)}
                  required
                  maxLength={256}
                />
                <p className="field-help">
                  可粘贴桌面客户端中的场景 ID，继续同一场景。
                </p>
              </>
            )}
            <div className="web-scene-editor-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setEditor(undefined)}
              >
                返回
              </button>
              <button className="primary">保存</button>
            </div>
          </form>
        ) : (
          <>
            <p className="field-help">
              切换场景会保留当前草稿和正在进行的回复。
            </p>
            <div className="web-scene-list">
              {group.scenes.map((scene) => (
                <div
                  className={`web-scene-row ${group.active === scene.scene_id ? "selected" : ""}`}
                  key={scene.scene_id}
                >
                  <button
                    className="web-scene-select"
                    aria-pressed={group.active === scene.scene_id}
                    onClick={() => perform("select", scene.scene_id)}
                  >
                    <Icon name="chat" size={19} />
                    <span>
                      <strong>{scene.scene_meta.scene_label}</strong>
                      {activity[scene.scene_id] && (
                        <small>
                          {CHAT_SCENE_ACTIVITY_LABELS[activity[scene.scene_id]]}
                        </small>
                      )}
                    </span>
                    {group.active === scene.scene_id && (
                      <span aria-label="当前场景">✓</span>
                    )}
                  </button>
                  <button
                    className="web-scene-edit"
                    aria-label={`重命名 ${scene.scene_meta.scene_label}`}
                    onClick={() => {
                      setEditor({ operation: "rename", id: scene.scene_id });
                      setName(scene.scene_meta.scene_label);
                    }}
                  >
                    编辑
                  </button>
                  <button
                    className="web-scene-edit"
                    aria-label={`移除 ${scene.scene_meta.scene_label}`}
                    disabled={[
                      "queued",
                      "thinking",
                      "replying",
                      "working",
                      "waiting",
                    ].includes(activity[scene.scene_id])}
                    onClick={() => setDeleting(scene.scene_id)}
                  >
                    移除
                  </button>
                </div>
              ))}
            </div>
            <div className="web-scene-editor-actions">
              <button
                className="secondary"
                onClick={() => {
                  setName("");
                  setId("");
                  setEditor({ operation: "bind" });
                }}
              >
                添加已有场景
              </button>
              <button
                className="primary"
                onClick={() => {
                  setName("");
                  setEditor({ operation: "create" });
                }}
              >
                新建场景
              </button>
            </div>
            {deleting && (
              <div className="web-scene-delete" role="alert">
                <p>从此浏览器的场景列表中移除？服务端的历史消息仍会保留。</p>
                <button
                  className="secondary"
                  onClick={() => setDeleting(undefined)}
                >
                  取消
                </button>
                <button
                  className="secondary"
                  onClick={() => perform("delete", deleting)}
                >
                  确认移除
                </button>
              </div>
            )}
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
