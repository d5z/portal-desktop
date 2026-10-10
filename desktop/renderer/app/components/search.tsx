import { useEffect, useRef } from "react";
import type { AppModel } from "../models/app";
import { useModel } from "../../shared/hooks/use-model";
import { Dialog } from "../../shared/components/dialog";
function MatchText({text,query}:{text:string;query:string}) {
  const index = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  return index < 0 || !query ? <>{text}</> : <>{text.slice(0,index)}<mark>{text.slice(index,index+query.length)}</mark>{text.slice(index+query.length)}</>;
}
export function ChatSearch({ model }: { model: AppModel }) {
  const app = useModel(model),
    input = useRef<HTMLInputElement>(null),
    results = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const query = app.search.trim(), matches = app.searchEntries;
  useEffect(() => {
    if (!app.searchOpen) return;
    app.searchEntries = [];
    app.searchLoading = Boolean(app.search.trim());
    app.searchError = '';
    app.changed();
    const timer = setTimeout(() => app.post({type:'beings:search-request',query:app.search}), 200);
    return () => clearTimeout(timer);
  }, [app.search, app.searchOpen]);
  const close = () => {
    app.searchOpen = false;
    app.changed();
    document.getElementById("toggle-chat-search")?.focus();
  };
  useEffect(() => {
    if (app.searchOpen) input.current?.focus();
    else if (wasOpen.current)
      document.getElementById("toggle-chat-search")?.focus();
    wasOpen.current = app.searchOpen;
  }, [app.searchOpen]);
  return (
    <Dialog
      id="chat-search-panel"
      aria-label="查找对话"
      open={app.searchOpen}
      onClose={close}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
          return;
        }
        const buttons = [
            ...results.current!.querySelectorAll<HTMLButtonElement>("button"),
          ],
          index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (event.target === input.current && event.key === "Enter") {
          event.preventDefault();
          buttons[0]?.click();
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          buttons[Math.min(index + 1, buttons.length - 1)]?.focus();
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          if (index <= 0) input.current?.focus();
          else buttons[index - 1]?.focus();
        }
      }}
    >
      <div className="chat-search-field">
        <svg className="search-symbol" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/></svg>
        <input
          id="chat-search-input"
          ref={input}
          type="search"
          maxLength={500}
          placeholder="搜索所有场景的对话…"
          aria-label="搜索所有场景的对话"
          autoComplete="off"
          value={app.search}
          onChange={(event) => {
            app.search = event.target.value;
            app.changed();
          }}
        />
        <button
          id="close-chat-search"
          className="icon-button close"
          aria-label="关闭查找"
          onClick={close}
        />
      </div>
      <div
        id="chat-search-results"
        ref={results}
        role="list"
        aria-label="对话搜索结果"
      >
        {matches.map((entry) => (
          <div role="listitem" key={entry.id}>
            <button
              className="chat-search-result"
              title={entry.text}
              onClick={() => {
                close();
                app.navigate("chat");
                app.post({ type: "beings:search-jump", id: entry.id });
              }}
            >
              <span className="search-result-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M21 11.5a9 9 0 0 1-9 8.5 10 10 0 0 1-4-.8L3 21l1.7-4.5A8 8 0 0 1 3 11.5a9 9 0 0 1 18 0Z"/></svg></span>
              <span className="search-result-copy">
                <strong>{app.snapshot?.chatSessions?.find(scene=>scene.scene_id===entry.sceneId)?.scene_meta?.scene_label || entry.sceneLabel || entry.sceneId || '未标记场景'}</strong>
                <span>{entry.role === 'user' ? '你' : 'Being'} · <MatchText text={entry.text} query={query}/></span>
                {entry.at && <time>{Number.isNaN(Date.parse(entry.at)) ? '' : new Date(entry.at).toLocaleString('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</time>}
              </span>
            </button>
          </div>
        ))}
      </div>
      <p id="chat-search-status" role="status">
        {!query ? '搜索所有场景中你与 Being 的对话内容' : app.searchError || (app.searchLoading ? `正在搜索全部历史… 已找到 ${matches.length} 条` : matches.length ? `${matches.length === 200 ? '最近 200' : matches.length} 条匹配消息 · 所有场景` : '没有匹配的对话内容')}
        {app.searchError && <button className="text-button" onClick={()=>app.post({type:'beings:search-request',query:app.search})}>重试</button>}
      </p>
    </Dialog>
  );
}
