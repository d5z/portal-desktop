import { useEffect, useMemo, useState } from "react";
import type { ChatItem, Message, ChatRuntime, Run } from "../models/chat";
const duration = (seconds: number) =>
  seconds < 60
    ? `${seconds} 秒`
    : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
const icons = {
  check: <path d="m3.5 8 3 3 6-6" />,
  think: <path d="M6 11h4M6.5 13h3M5.5 9.5a4.5 4.5 0 1 1 5 0L10 11H6Z" />,
  tool: <path d="m3.5 5 3 3-3 3M9 11h3.5" />,
  error: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 4.5v4M8 11h.01" />
    </>
  ),
  stop: <path d="M4 8h8" />,
  chevron: <path d="m6 4 4 4-4 4" />,
};
function Icon({ name }: { name: keyof typeof icons }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icons[name]}
    </svg>
  );
}
export function ChatActivity({
  run,
  runtime,
  stopping,
  sceneLabel,
  canStop = true,
}: {
  run: Run;
  runtime: ChatRuntime;
  stopping: boolean;
  sceneLabel?: string;
  canStop?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (run.end) {
      setOpen(false);
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [run.end]);
  const tools = run.entries.filter((entry) => entry.type === "tool");
  return (
    <details
      className={`run-activity${run.end ? "" : " running"}`}
      data-outcome={run.outcome}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="run-icon">
          <Icon
            name={
              run.outcome === "stopped"
                ? "stop"
                : run.outcome === "error"
                  ? "error"
                  : "check"
            }
          />
        </span>
        <span className="run-caption">
          <span className="run-label" title={run.arg}>
            {run.label}
          </span>
          {sceneLabel && <span className="message-scene" title={run.sceneId}>{sceneLabel}</span>}
          <span className="run-elapsed">
            {duration(
              Math.max(0, Math.floor(((run.end || now) - run.start) / 1000)),
            )}
          </span>
          <span className="run-count">
            {tools.length ? `· ${tools.length} 次工具调用` : ""}
            {run.end && tools.some((entry) => entry.error) ? " · 含失败项" : ""}
          </span>
        </span>
        <span className="run-chevron">
          <Icon name="chevron" />
        </span>
        <button
          className="run-stop"
          type="button"
          title="停止生成"
          aria-label="停止生成"
          hidden={!canStop || !!run.end || run.waitingForReply}
          disabled={stopping}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void runtime.stopCurrentTurn();
          }}
        />
      </summary>
      <p className="run-hint" hidden={!run.hint}>
        {run.hint}
      </p>
      <div className="run-list">
        {run.entries.map((entry, i) => {
          const detail =
            entry.type === "think"
              ? (
                  entry.text ||
                  entry.preview ||
                  "等待服务端返回思考内容…"
                ).slice(0, 20000)
              : [entry.arg, entry.result].filter(Boolean).join("\n");
          return (
            <div className="run-entry" key={i}>
              <div className="run-entry-heading">
                <span
                  className={`run-entry-icon${entry.error ? " error" : ""}`}
                >
                  <Icon
                    name={
                      entry.error
                        ? "error"
                        : entry.type === "think"
                          ? "think"
                          : "tool"
                    }
                  />
                </span>
                <div className="run-entry-caption">
                  <span className="run-entry-title">
                    {entry.type === "think"
                      ? `思考${entry.duration ? ` · ${duration(entry.duration)}` : ""}`
                      : entry.name || entry.label || "工具"}
                  </span>
                  <small>
                    {entry.error
                      ? "失败"
                      : entry.done
                        ? "已完成"
                        : run.end
                          ? "未完成"
                          : "进行中"}
                  </small>
                </div>
              </div>
              {detail && <p>{detail}</p>}
            </div>
          );
        })}
        {!run.entries.length && (
          <p className="run-empty">
            {run.end ? "本轮未返回额外的过程记录。" : "正在等待响应…"}
          </p>
        )}
      </div>
    </details>
  );
}

const keywords = {
  warm: [
    "❤",
    "🌸",
    "😊",
    "感谢",
    "谢谢",
    "爱",
    "亲",
    "温暖",
    "开心",
    "幸福",
    "抱",
    "love",
    "喜欢",
    "美",
    "感动",
    "陪",
    "一起",
  ],
  cool: [
    "代码",
    "code",
    "bug",
    "error",
    "config",
    "deploy",
    "server",
    "port",
    "api",
    "curl",
    "ssh",
    "debug",
    "修",
    "报错",
  ],
  deep: [
    "意识",
    "存在",
    "灵魂",
    "自由",
    "连接",
    "本源",
    "觉察",
    "感受",
    "活着",
    "consciousness",
    "缝隙",
    "呼吸",
    "梦",
  ],
  bright: ["哈哈", "😂", "🤣", "笑", "牛逼", "nb", "爽", "振奋", "！！", "666"],
};
const colors = {
  warm: "rgba(255,140,80,0.08)",
  cool: "rgba(88,166,255,0.06)",
  deep: "rgba(188,140,255,0.08)",
  bright: "rgba(255,210,80,0.07)",
  neutral: "transparent",
};
export function TemperatureGlow({ items }: { items: ChatItem[] }) {
  const texts = items
    .filter(
      (item): item is Message =>
        item.kind === "message" && item.role === "being" && !item.streaming,
    )
    .slice(-6)
    .map((item) => item.text)
    .join("\u0000");
  const mood = useMemo(() => {
    const counts = new Map<keyof typeof colors, number>();
    for (const text of texts.split("\u0000")) {
      let best: keyof typeof colors = "neutral",
        score = 0;
      for (const [name, words] of Object.entries(keywords)) {
        const hits = words.filter((word) =>
          text.toLowerCase().includes(word),
        ).length;
        if (hits > score) {
          score = hits;
          best = name as keyof typeof keywords;
        }
      }
      counts.set(best, (counts.get(best) || 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || "neutral";
  }, [texts]);
  return (
    <div
      id="temperature-glow"
      aria-hidden="true"
      style={{
        opacity: mood === "neutral" ? 0 : 1,
        background: `radial-gradient(ellipse at 50% 100%, ${colors[mood]} 0%, transparent 70%)`,
      }}
    />
  );
}
