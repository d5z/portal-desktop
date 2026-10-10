import { useEffect, useRef } from "react";
import { PanelResizeHandle, usePanelWidth } from "../../shared/components/panel-resize";
import { useModel } from "../../shared/hooks/use-model";
import type { WorkspaceModel } from "../models/workspace";
export function SceneRibbon({ model }: { model: WorkspaceModel }) {
  const workspace = useModel(model),
    scene = workspace.scenes.current,
    ref = workspace.scenes.reference || scene;
  const selected = Boolean(ref.selection),
    discussing = scene.view === "chat" && selected;
  useEffect(() => {
    document.body.classList.toggle("has-topic", selected);
    document.body.classList.toggle("companion-open", workspace.open);
  }, [selected, workspace.open]);
  return (
    <div className="scene-ribbon">
      <div className="scene-place">
        <span className="scene-orbit" aria-hidden="true">
          ◉
        </span>
        <div>
          <span id="scene-caption" className="scene-caption">
            {discussing
              ? ref.view === "chat"
                ? "从这段对话继续"
                : `话题来自 · ${ref.title}`
              : "此刻，你在这里"}
          </span>
          <h1 id="scene-location">
            {discussing ? ref.selection!.title : scene.title}
          </h1>
        </div>
      </div>
      <div className="scene-ribbon-end">
        <span
          id="scene-invitation"
          hidden={selected || ["chat", "portal"].includes(scene.view)}
        >
          选中一段内容，邀请 Being 一起看
        </span>
        <button
          id="toggle-companion"
          aria-controls="companion-panel"
          aria-expanded={workspace.open}
          hidden={!selected}
          onClick={() => workspace.toggle()}
        >
          继续这个话题 <span aria-hidden="true">↗</span>
        </button>
      </div>
    </div>
  );
}
export function Companion({ model }: { model: WorkspaceModel }) {
  const workspace = useModel(model),
    ref = workspace.scenes.reference || workspace.scenes.current;
  const panel = useRef<HTMLElement>(null);
  const [width, setWidth] = usePanelWidth("companion", 340);
  useEffect(() => {
    if (!workspace.open && panel.current?.contains(document.activeElement))
      document
        .getElementById(ref.selection ? "toggle-companion" : "options-trigger")
        ?.focus();
  }, [workspace.open, ref.selection]);
  return (
    <aside
      id="companion-panel"
      ref={panel}
      style={{ width }}
      aria-label="一起看"
      hidden={!workspace.open}
    >
      <PanelResizeHandle panel={panel} label="调整一起看面板宽度" width={width} onResize={setWidth} initial={340} reserve={64} disabled={!workspace.open} />
      <div className="companion-heading">
        <div>
          <h2>一起看</h2>
        </div>
        <button
          id="close-companion"
          className="icon-button close"
          aria-label="收起话题"
          onClick={() => workspace.toggle(false)}
        />
      </div>
      <div className="shared-object">
        <h3 id="scene-object-title">{ref.selection?.title}</h3>
        <p id="scene-object-source">
          {ref.selection
            ? `${ref.title} · ${ref.selection.author || ref.identity || "公开内容"} · ${new Date(ref.observedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
            : ""}
        </p>
        <blockquote id="scene-object-text">{ref.selection?.excerpt}</blockquote>
      </div>
      <button
        id="scene-compose"
        className="primary"
        disabled={
          !ref.selection ||
          !workspace.scenes.being ||
          Boolean(workspace.draftRequest)
        }
        onClick={() => workspace.compose()}
      >
        放入对话 <span aria-hidden="true">↗</span>
      </button>
      <p className="scene-disclosure">仅放入引用与出处，由你发送。</p>
      <div className="object-actions">
        <button
          id="scene-return"
          hidden={!workspace.scenes.reference}
          onClick={() => workspace.returnToSource()}
        >
          回到来源
        </button>
        <button id="scene-clear" onClick={() => workspace.clear()}>
          结束这个话题
        </button>
      </div>
    </aside>
  );
}
