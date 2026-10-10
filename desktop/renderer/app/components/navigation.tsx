import { definitions } from "../../town/models/town";
import { NavigationControls } from "../../shared/components/navigation-controls";

export function PlaceHeading({ view, navigate, onBack, onForward, chatExpanded, onToggleChat, onClose = () => navigate("chat") }: {
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
          {onToggleChat && <button id="toggle-split-chat" className="split-chat-toggle" aria-label={chatExpanded ? "收起对话" : "展开对话"} title={chatExpanded ? "收起对话" : "展开对话"} aria-expanded={chatExpanded} aria-controls="chat-view" onClick={onToggleChat}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /></svg>
          </button>}
          <h1 id="view-title">{definitions[view]?.title || (view === "plugins" ? "客户端插件" : view === "portal" ? "Portal 设置" : "对话")}</h1>
          <NavigationControls back={onBack} forward={onForward} />
        </div>
        <div className="place-sheet-actions">
          <button id="back-to-chat" className="icon-button close" aria-label="回到对话" title="回到对话"
            onClick={onClose} />
        </div>
      </div>

    </header>
  );
}
