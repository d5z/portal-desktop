import { SceneScheduling } from './scheduling';
import { LocalFileLink } from '../../shared/components/local-file-link';
import { useEffect, useMemo, useState } from "react";
import type { ActivityEntry, ChatItem, Message, Run } from "../models/chat";
import { CHAT_SCENE_ACTIVITY_LABELS } from "../../../shared/types";
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
  wait: <><circle cx="8" cy="8" r="5.5" /><path d="M8 4.5V8l2 1.5" /></>,
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
function ToolDetails({ entry, expanded }: { entry: ActivityEntry; expanded: boolean }) {
  const [open, setOpen] = useState(false);
  const hasDetails = !!(entry.inputDetail || entry.resultDetail || entry.exitCode !== undefined || entry.durationMs !== undefined || entry.totalOutputBytes !== undefined);
  return <>
    {(entry.arg || entry.result) && <p>{[entry.arg, entry.result].filter(Boolean).join('\n')}</p>}
    {hasDetails && <details className="run-tool-details" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>执行详情</summary>
      {open && expanded && <div>
        <dl>
          {entry.exitCode !== undefined && <><dt>退出码</dt><dd>{entry.exitCode}</dd></>}
          {entry.durationMs !== undefined && <><dt>耗时</dt><dd>{(entry.durationMs / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} 秒</dd></>}
          {entry.totalOutputBytes !== undefined && <><dt>输出大小</dt><dd>{entry.totalOutputBytes.toLocaleString()} 字节</dd></>}
        </dl>
        {entry.inputDetail && <><h5>参数</h5><pre>{entry.inputDetail}</pre></>}
        {entry.resultDetail && <><h5>{entry.error ? '错误详情' : '返回结果'}</h5><pre>{entry.resultDetail}</pre></>}
        {entry.outputTruncated && <p role="note">输出已截断，仅展示保留的内容。</p>}
      </div>}
    </details>}
  </>;
}
export function ChatActivity({ run, sceneLabel, showDetails = true, showProgress = true }: { run: Run; sceneLabel?: string; showDetails?: boolean; showProgress?: boolean }) {
  if (showDetails) return <DetailedChatActivity run={run} sceneLabel={sceneLabel} />;
  const status = run.status || run.outcome || "thinking";
  const attention = ["error", "timeout", "stopped"].includes(status) && (status !== "stopped" || !run.stopHistorySeq);
  const artifacts = [...new Set(run.entries.flatMap(entry => entry.artifactPath ? [entry.artifactPath] : []))];
  return <>
    {((!run.end && showProgress) || attention) && <div className={`quiet-activity${attention ? " needs-attention" : ""}`} data-status={status}>
      {!attention && sceneLabel && <span className="quiet-activity-scene">{sceneLabel}</span>}
      <div className={attention ? "quiet-activity-status-icon" : "thinking-bubble"} role="status" aria-label={CHAT_SCENE_ACTIVITY_LABELS[status]}>
        {attention ? <Icon name={status === "stopped" ? "stop" : "error"} /> : <span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span>}
      </div>
      {attention && sceneLabel && <span className="quiet-activity-scene">{sceneLabel}</span>}
      {attention && <span className="quiet-activity-notice">{run.hint || run.label}</span>}
    </div>}
    {artifacts.length > 0 && <div className="run-artifacts" aria-label="生成的文件">
      {artifacts.map(path => <LocalFileLink key={path} path={path} card={/\.html?$/i.test(path)}>{path.split(/[\\/]/).pop() || path}</LocalFileLink>)}
    </div>}
  </>;
}

function DetailedChatActivity({
  run,
  sceneLabel,
}: {
  run: Run;
  sceneLabel?: string;
}) {
  const [open, setOpen] = useState(false),
    [now, setNow] = useState(Date.now);
  const passive = run.waitingForReply && !run.scheduling?.tasks.some(task => task.status === 'running' || task.status === 'queued');
  const status = run.status || run.outcome || (passive ? "waiting" : "thinking");
  useEffect(() => {
    if (run.end) {
      setOpen(false);
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [run.end]);
  const tools = run.entries.filter((entry) => entry.type === "tool");
  const failed = tools.filter(entry => entry.error).length;
  const unconfirmed = tools.filter(entry => !entry.done && !entry.error).length;
  const artifacts = [...new Set(tools.flatMap(entry => entry.artifactPath ? [entry.artifactPath] : []))];
  return (
    <>
    <details
      className={`run-activity${run.end || passive ? "" : " running"}`}
      data-outcome={run.outcome}
      data-status={status}
      data-autonomous-origin={run.autonomousOrigin}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="run-icon" role="img" aria-label={status === "queued" && run.waitingForReply ? "消息已接收" : CHAT_SCENE_ACTIVITY_LABELS[status]}>
          <Icon
            name={
              run.outcome === "stopped"
                ? "stop"
                : run.outcome === "error"
                  ? "error"
                  : status === "timeout" || passive ? "wait"
                    : run.end ? "check" : status === "working" ? "tool" : "think"
            }
          />
        </span>
        <span className="run-caption">
          <span className="run-label" title={run.hint || run.arg}>
            {run.label}
          </span>
          {run.autonomousOrigin
            ? <span className="message-scene" title="后台自主活动，与当前场景对话分别显示">{run.autonomousOrigin === 'callback' ? 'SBS 自主回调' : 'SBS 自主活动'}</span>
            : sceneLabel && <span className="message-scene" title={run.sceneId}>{sceneLabel}</span>}
          <span className="run-elapsed" hidden={passive}>
            总耗时 {" "}
            {duration(
              Math.max(0, Math.floor(((run.end || now) - run.start) / 1000)),
            )}
          </span>
          <span className="run-count">
            {tools.length ? `· ${tools.length} 次工具调用` : ""}
            {failed > 0 && <span className="run-failures">{` · ${failed} 次失败`}</span>}
            {unconfirmed > 0 ? ` · ${unconfirmed} 次${run.end ? "结果未确认" : "进行中"}` : ""}
          </span>
          {!run.end && run.context && <span className="run-context">{run.context}</span>}
        </span>
        <span className="run-chevron">
          <Icon name="chevron" />
        </span>
      </summary>
      {open && <><p className="run-hint" hidden={!run.hint}>
        {run.hint}
      </p>
      {run.scheduling && <SceneScheduling {...run.scheduling} />}
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
            <div className="run-entry" key={entry.id || i}>
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
                          ? "结果未确认"
                          : "进行中"}
                  </small>
                </div>
              </div>
              {entry.type === 'tool' ? <ToolDetails entry={entry} expanded={open} /> : open && detail && <p>{detail}</p>}
            </div>
          );
        })}
        {!run.entries.length && !run.scheduling && (
          <p className="run-empty">
            {run.end ? "本轮未返回额外的过程记录。" : "正在等待响应…"}
          </p>
        )}
      </div></>}
    </details>
    {artifacts.length > 0 && <div className="run-artifacts" aria-label="生成的文件">
      {artifacts.map(path => <LocalFileLink key={path} path={path} card={/\.html?$/i.test(path)}>{path.split(/[\\/]/).pop() || path}</LocalFileLink>)}
    </div>}
    </>
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
