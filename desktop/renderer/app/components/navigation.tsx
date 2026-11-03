import type { ReactNode } from "react";
import { definitions } from "../../town/models/town";
import { NavigationControls } from "../../shared/components/navigation-controls";

export function PlaceHeading({ view, title, actions, navigate, onBack, onForward, chatExpanded, onToggleChat, onClose = () => navigate("chat") }: {
  title?: string;
  actions?: ReactNode;
  chatExpanded?: boolean;
  onToggleChat?: () => void;
  view: string;
  navigate: (view: string) => void;
  onBack?: () => void;
  onForward?: () => void;
  onClose?: () => void;
}) {
  return (
    <header className="place-sheet-heading">
      <div className="place-sheet-title-row">
        <div className="place-sheet-title-main">
          {onToggleChat && <SplitChatToggle expanded={!!chatExpanded} onToggle={onToggleChat} />}
          <h1 id="view-title">{title || definitions[view]?.title || (view === "plugins" ? "客户端插件" : view === "portal" ? "Portal 设置" : "对话")}</h1>
          <NavigationControls back={onBack} forward={onForward} />
        </div>
        <div className="place-sheet-actions">
          {actions}
          <button id="back-to-chat" className="icon-button close" aria-label="回到对话" title="回到对话"
            onClick={onClose} />
        </div>
      </div>

    </header>
  );
}

/** Shared by place panels and the cloud computer. */
export function SplitChatToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return <button id="toggle-split-chat" className="split-chat-toggle" aria-label={expanded ? "收起对话" : "展开对话"} title={expanded ? "收起对话" : "展开对话"} aria-expanded={expanded} aria-controls="chat-view" onClick={onToggle}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /></svg>
  </button>;
}
