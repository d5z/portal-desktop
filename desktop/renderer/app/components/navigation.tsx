import { useLayoutEffect, useRef } from "react";
import { definitions } from "../../town/models/town";
import { NavigationControls } from "../../shared/components/navigation-controls";

const places = [
  ["bonfire", "篝火"], ["firesides", "围炉"], ["mail", "私信"],
  ["seeds", "花园"], ["embers", "书架"], ["scrolls", "卷轴"],
  ["kits", "工具库"], ["town", "广场"],
] as const;

export function PlaceHeading({ view, navigate, onBack, onForward, onClose = () => navigate("chat") }: {
  view: string;
  navigate: (view: string) => void;
  onBack?: () => void;
  onForward?: () => void;
  onClose?: () => void;
}) {
  const nav = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const menu = nav.current;
    const selected = menu?.querySelector<HTMLButtonElement>('[aria-current="page"]');
    if (!menu || !selected) return;
    const left = selected.offsetLeft, right = left + selected.offsetWidth;
    if (left < menu.scrollLeft) menu.scrollLeft = left;
    else if (right > menu.scrollLeft + menu.clientWidth) menu.scrollLeft = right - menu.clientWidth;
  }, [view]);
  return (
    <header className="place-sheet-heading">
      <div className="place-sheet-title-row">
        <div className="place-sheet-title-main">
          <h1 id="view-title">{definitions[view]?.title || (view === "portal" ? "Portal 设置" : "对话")}</h1>
          <NavigationControls back={onBack} forward={onForward} />
        </div>
        <button id="back-to-chat" className="icon-button close" aria-label="回到对话" title="回到对话"
          onClick={onClose} />
      </div>
      <nav className="place-switcher" aria-label="小镇功能切换" ref={nav}>
        {places.map(([target, label]) => (
          <button type="button" key={target} aria-current={view === target ? "page" : undefined}
            onClick={() => navigate(target)}>{label}</button>
        ))}
      </nav>
    </header>
  );
}
