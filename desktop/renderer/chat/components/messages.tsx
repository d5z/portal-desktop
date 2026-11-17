import StatusMark from '../../shared/components/react-bits/status-mark/StatusMark';
import { Icon } from '../../shared/icons/icon';
import { SceneScheduling } from './scheduling';
import { LocalFileLink } from '../../shared/components/local-file-link';
import { useEffect, useMemo, useState } from "react";
import type { ActivityEntry, ChatItem, Message, Run } from "../models/chat";
import { CHAT_SCENE_ACTIVITY_LABELS } from "../../../shared/types";
import { ChatStatusRow } from './status-row';
const duration = (seconds: number) =>
  seconds < 60
    ? `${seconds} 秒`
    : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;

function ActivityStep({ entry, finished }: { entry: ActivityEntry; finished: boolean }) {
  const [open, setOpen] = useState(false);
  const thought = entry.type === 'think';
  const title = thought ? '思考' : entry.label || entry.name || '工具';
  const detail = thought ? (entry.text || entry.preview || '等待服务端返回思考内容…').slice(0, 20000) : '';
  const summary = thought ? (entry.preview || entry.text || '') : (entry.arg || entry.result || '');
  const preview = summary.trim().split(/\r?\n/, 1)[0].slice(0, 240);
  const toolStatus = entry.type === 'tool' ? (entry.error ? 'failed' : entry.done ? 'done' : finished ? undefined : 'running') : undefined;
  const state = entry.error ? '失败' : entry.done ? '' : finished ? '结果未确认' : '进行中';
  return <details className="run-entry" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="run-entry-heading">
      <span className={`run-entry-icon${entry.error ? ' error' : ''}`} aria-hidden="true">
        {toolStatus
          ? <StatusMark className="run-tool-mark" status={toolStatus} size={16} color="currentColor" doneColor="currentColor" errorColor="currentColor" fillOpacity={0} />
          : <Icon name={entry.error ? 'chat-error' : thought ? 'chat-clock' : 'chat-wrench'} />}
        <span className="run-entry-disclosure"><Icon name="chat-chevron-right" /></span>
      </span>
      <span className="run-entry-title" title={title}>{title}</span>
      {preview && <span className="run-entry-chip" data-tool={!thought || undefined}>{preview}</span>}
      {state && <small className={entry.error ? 'run-failures' : undefined}>{state}</small>}
    </summary>
    {open && <div className="run-entry-detail">
      {thought ? <><p>{detail}</p>{entry.duration ? <small>{duration(entry.duration)}</small> : null}</> : <div className="run-tool-details">
        {(entry.arg || entry.result) && <p>{[entry.arg, entry.result].filter(Boolean).join('\n')}</p>}
        {(entry.exitCode !== undefined || entry.durationMs !== undefined || entry.totalOutputBytes !== undefined) && <dl>
          {entry.exitCode !== undefined && <><dt>退出码</dt><dd>{entry.exitCode}</dd></>}
          {entry.durationMs !== undefined && <><dt>耗时</dt><dd>{(entry.durationMs / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} 秒</dd></>}
          {entry.totalOutputBytes !== undefined && <><dt>输出大小</dt><dd>{entry.totalOutputBytes.toLocaleString()} 字节</dd></>}
        </dl>}
        {entry.inputDetail && <><h5>参数</h5><pre>{entry.inputDetail}</pre></>}
        {entry.resultDetail && <><h5>{entry.error ? '错误详情' : '返回结果'}</h5><pre>{entry.resultDetail}</pre></>}
        {entry.outputTruncated && <p role="note">输出已截断，仅展示保留的内容。</p>}
      </div>}
    </div>}
  </details>;
}
export function ChatActivity({ run, sceneLabel, showDetails = true, showProgress = true, errorAlreadyShown = false }: {
  run: Run; sceneLabel?: string; showDetails?: boolean; showProgress?: boolean; errorAlreadyShown?: boolean;
}) {
  const status = run.status || run.outcome || "thinking";
  const repeatError = status === 'error' && errorAlreadyShown;
  if (showDetails || (run.end && run.entries.some(entry => entry.type === 'tool' && entry.error))) {
    return <DetailedChatActivity run={run} sceneLabel={sceneLabel} repeatError={repeatError} />;
  }
  const attention = !repeatError && ["error", "timeout", "stopped"].includes(status) && (status !== "stopped" || !run.stopHistorySeq);
  const artifacts = [...new Set(run.entries.flatMap(entry => entry.artifactPath ? [entry.artifactPath] : []))];
  const progress = !run.end && showProgress;
  if (!attention && !progress && !artifacts.length) return null;
  return <div className="chat-run">
    {attention ? <ChatStatusRow title={CHAT_SCENE_ACTIVITY_LABELS[status]}
      detail={[sceneLabel, run.hint || run.label].filter(Boolean).join(' · ')}
      tone={status === 'stopped' ? 'stopped' : 'error'} />
    : progress && <div className="quiet-activity" data-status={status}>
      {sceneLabel && <span className="quiet-activity-scene">{sceneLabel}</span>}
      <div className="thinking-bubble" role="status" aria-label={CHAT_SCENE_ACTIVITY_LABELS[status]}>
        <span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span>
      </div>
    </div>}
    {artifacts.length > 0 && <div className="run-artifacts" aria-label="生成的文件">
      {artifacts.map(path => <LocalFileLink key={path} path={path} card>{path.split(/[\\/]/).pop() || path}</LocalFileLink>)}
    </div>}
  </div>;
}

function DetailedChatActivity({
  run,
  sceneLabel,
  repeatError,
}: {
  run: Run;
  sceneLabel?: string;
  repeatError: boolean;
}) {
  const [open, setOpen] = useState(false),
    [now, setNow] = useState(Date.now);
  const passive = run.waitingForReply && !run.scheduling?.tasks.some(task => task.status === 'running' || task.status === 'queued');
  const status = run.status || run.outcome || (passive ? "waiting" : "thinking");
  const showElapsed = !passive && status !== 'reconnecting';
  useEffect(() => {
    if (run.end || !showElapsed || !open) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [run.end, showElapsed, open]);
  const tools = run.entries.filter((entry) => entry.type === "tool");
  const failed = tools.filter(entry => entry.error).length;
  const unconfirmed = tools.filter(entry => !entry.done && !entry.error).length;
  const artifacts = [...new Set(tools.flatMap(entry => entry.artifactPath ? [entry.artifactPath] : []))];
  const activeTool = tools.filter(entry => !entry.done && !entry.error).at(-1);
  const activeLabel = activeTool?.label?.trim();
  const reads = tools.filter(entry => entry.done && !entry.error && entry.name === 'read_file').length;
  const summary = repeatError ? '执行过程'
    : status === 'working' && activeLabel ? activeLabel
    : status === 'done' && reads > 0 && reads === tools.length && !artifacts.length ? `读取了 ${reads} 次文件`
    : status === 'done' && tools.length > 0 ? tools.at(-1)?.label || run.label
    : run.label;
  return (
    <div className="chat-run">
    <details
      className={`run-activity${run.end || passive ? "" : " running"}`}
      data-outcome={run.outcome}
      data-status={status}
      data-autonomous-origin={run.autonomousOrigin}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="run-icon" role="img" aria-label={repeatError ? "执行过程" : status === "queued" && run.waitingForReply ? "消息已接收" : CHAT_SCENE_ACTIVITY_LABELS[status]}>
          <Icon
            name={
              repeatError ? "chat-wrench" : run.outcome === "stopped"
                ? "chat-stop"
                : run.outcome === "error"
                  ? "chat-error"
                  : status === "timeout" || passive ? "chat-clock"
                    : run.end ? "chat-check" : status === "working" ? "chat-wrench" : "chat-clock"
            }
          />
        </span>
        <span className="run-caption">
          <span className="run-label" title={run.hint || run.arg || summary}>
            {summary}
          </span>
          {run.autonomousOrigin
            ? <span className="message-scene" title="后台自主活动，与当前场景对话分别显示">{run.autonomousOrigin === 'callback' ? 'SBS 自主回调' : 'SBS 自主活动'}</span>
            : sceneLabel && <span className="message-scene" title={run.sceneId}>{sceneLabel}</span>}
        </span>
        <span className="run-chevron" aria-hidden="true">
          <Icon name="chat-chevron-right" />
        </span>
      </summary>
      {open && <div className="run-body">
        {(showElapsed || tools.length > 0) && <div className="run-metrics">
          {showElapsed && <span title="总耗时" aria-label="总耗时">
            {duration(Math.max(0, Math.floor(((run.end || now) - run.start) / 1000)))}
          </span>}
          {tools.length > 0 && <span>{tools.length} 次工具调用</span>}
          {failed > 0 && <span className="run-failures">{failed} 次失败</span>}
          {unconfirmed > 0 && <span>{unconfirmed} 次{run.end ? '结果未确认' : '进行中'}</span>}
        </div>}
        {run.hint && <p className="run-hint">{run.hint}</p>}
        {!run.end && run.context && <p className="run-hint">{run.context}</p>}
        {run.scheduling && <SceneScheduling {...run.scheduling} />}
        <div className="run-list">
          {run.entries.map((entry, i) => <ActivityStep key={entry.id || entry.toolCallId || i}
            entry={entry} finished={!!run.end} />)}
          {!run.entries.length && !run.scheduling && (
            <p className="run-empty">
              {run.end ? "本轮未返回额外的过程记录。" : "正在等待响应…"}
            </p>
          )}
        </div>
      </div>}
    </details>
    {artifacts.length > 0 && <div className="run-artifacts" aria-label="生成的文件">
      {artifacts.map(path => <LocalFileLink key={path} path={path} card>{path.split(/[\\/]/).pop() || path}</LocalFileLink>)}
    </div>}
    </div>
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
