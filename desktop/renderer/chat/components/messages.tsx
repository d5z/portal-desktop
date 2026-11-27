import { ConnectorWorkspaceFile } from '../../shared/components/connector-workspace-file';
import type { SceneTask } from '../../../shared/types';
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
    : `${Math.floor(seconds / 60)} 分钟 ${seconds % 60} 秒`;

function ActivityStep({ entry, finished, initiallyOpen = false }: { entry: ActivityEntry; finished: boolean; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const thought = entry.type === 'think';
  const title = thought ? '思考' : entry.error ? entry.name || entry.label || '工具' : entry.label || entry.name || '工具';
  const detail = thought ? (entry.text || entry.preview || '等待服务端返回思考内容…').slice(0, 20000) : '';
  const summary = thought ? (entry.preview || entry.text || '') : (entry.arg || entry.result || '');
  const preview = summary.trim().split(/\r?\n/, 1)[0].slice(0, 240);
  const toolStatus = entry.type === 'tool' ? (entry.error ? 'failed' : entry.done ? 'done' : finished ? undefined : 'running') : undefined;
  const state = thought ? '' : entry.error ? '失败' : entry.done ? '' : finished ? '结果未确认' : '进行中';
  return <details className="run-entry" data-tool={!thought || undefined} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="run-entry-heading">
      <span className={`run-entry-icon${entry.error ? ' error' : ''}`} aria-hidden="true">
        {toolStatus
          ? <StatusMark className="run-tool-mark" status={toolStatus} size={16} color="currentColor" doneColor="currentColor" errorColor="currentColor" fillOpacity={0} />
          : <Icon name={entry.error ? 'chat-error' : thought ? 'chat-clock' : 'chat-wrench'} />}
        <span className="run-entry-disclosure"><Icon name="chat-chevron-right" /></span>
      </span>
      <span className="run-entry-title" title={title}>{title}</span>
      {preview && <span className="run-entry-chip">{preview}</span>}
      {state && <small className={entry.error ? 'run-failures' : undefined}>{state}</small>}
    </summary>
    {open && <div className="run-entry-detail">
      {thought ? <><p>{detail}</p>{entry.duration ? <small>{duration(entry.duration)}</small> : null}</> : <div className="run-tool-details">
        {(entry.arg || entry.result) && <p>{[entry.arg, entry.result].filter(Boolean).join('\n')}</p>}
        {entry.nextAction && <p role="note">{entry.nextAction}</p>}
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
function SubagentActivity({ tasks, onOpen }: { tasks?: SceneTask[]; onOpen?: (taskIds: string[], selectedId?: string) => void }) {
  if (!tasks?.length || !onOpen) return null;
  const running = tasks.filter(task => task.status === 'running').length;
  const queued = tasks.filter(task => task.status === 'queued').length;
  const failed = tasks.filter(task => ['failed', 'budget_exhausted', 'timeout'].includes(task.status));
  const stopped = tasks.filter(task => task.status === 'cancelled' || task.status === 'interrupted').length;
  const status = running ? 'running' : queued ? 'queued'
    : failed.length ? (failed.every(task => task.status === failed[0].status) ? failed[0].status : 'failed')
    : stopped ? 'stopped' : 'done';
  const label = running ? `${running} 项运行中${queued ? ` · ${queued} 项排队` : ''}`
    : queued ? `${queued} 项排队中`
    : failed.length ? `${failed.length} 项${status === 'timeout' ? '超时' : status === 'budget_exhausted' ? '预算用尽' : '失败'}`
    : stopped ? `${stopped} 项已停止` : '全部完成';
  return <button type="button" className="run-subagent-activity" data-status={status}
    aria-label="查看子智能体执行详情" onClick={() => onOpen(tasks.map(task => task.id))}>
    <span className="run-subagent-mark" aria-hidden="true">
      {status === 'running' ? <StatusMark status="running" size={14} color="currentColor" fillOpacity={0} />
        : <Icon name={status === 'queued' ? 'chat-clock' : status === 'stopped' ? 'chat-stop' : status === 'done' ? 'chat-check' : 'chat-error'} />}
    </span>
    <span>子智能体 · {tasks.length} 项</span>
    <span className="run-subagent-status">{label}</span>
    <Icon name="chat-chevron-right" />
  </button>;
}
export function ChatActivity({ run, sceneLabel, showDetails = true, showProgress = true, onOpenSubagents, errorAlreadyShown = false, superseded = false }: {
  run: Run; sceneLabel?: string; showDetails?: boolean; showProgress?: boolean; errorAlreadyShown?: boolean; superseded?: boolean; onOpenSubagents?: (taskIds: string[], selectedId?: string) => void;
}) {
  const status = run.status || run.outcome || "thinking";
  const repeatError = status === 'error' && errorAlreadyShown;
  if (run.end && status === 'stopped' && !run.entries.length && !run.scheduling?.tasks.length) {
    if (superseded) return null;
    return <div className="chat-run"><ChatStatusRow
      title={`${run.label || '已停止'} · 用时 ${duration(Math.max(0, Math.floor((run.end - run.start) / 1000)))}`}
      tone="stopped" detail={sceneLabel} /></div>;
  }
  if (run.end && status === 'done' && !run.entries.length && !run.scheduling?.tasks.length) {
    if (!showDetails) return null;
    return <div className="chat-run"><div className="run-activity"><div className="run-summary" role="status">
      <span className="run-icon" aria-hidden="true" />
      <span className="run-label">用时 {duration(Math.max(0, Math.floor((run.end - run.start) / 1000)))}</span>
    </div></div></div>;
  }
  if (showDetails || (onOpenSubagents && run.scheduling?.tasks.length) || (run.end && run.entries.some(entry => entry.type === 'tool' && entry.error))) {
    return <DetailedChatActivity run={run} sceneLabel={sceneLabel} repeatError={repeatError} superseded={superseded} onOpenSubagents={onOpenSubagents} showTrace={showDetails} />;
  }
  const attention = !superseded && !repeatError && ["error", "timeout", "stopped"].includes(status);
  const artifacts = [...new Set(run.entries.flatMap(entry => entry.artifactPath ? [entry.artifactPath] : []))];
  const progress = !run.end && showProgress;
  if (!attention && !progress && !artifacts.length && !run.entries.some(entry => entry.workspaceFile || entry.workspaceError)) return null;
  return <div className="chat-run">
    {attention ? <ChatStatusRow title={CHAT_SCENE_ACTIVITY_LABELS[status]}
      detail={[sceneLabel, run.hint || (run.label !== CHAT_SCENE_ACTIVITY_LABELS[status] ? run.label : '')].filter(Boolean).join(' · ')}
      tone={status === 'stopped' ? 'stopped' : 'error'} />
    : progress && (status === 'queued' || status === 'waiting' || status === 'reconnecting')
      ? <ChatStatusRow title={run.label || CHAT_SCENE_ACTIVITY_LABELS[status]} detail={sceneLabel} />
    : progress && <div className="quiet-activity" data-status={status}>
      {sceneLabel && <span className="quiet-activity-scene">{sceneLabel}</span>}
      <div className="thinking-bubble" role="status" aria-label={CHAT_SCENE_ACTIVITY_LABELS[status]}>
        <span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span>
      </div>
    </div>}
    {[...new Map(run.entries.flatMap(entry => entry.workspaceFile ? [[entry.workspaceFile.import_id, entry.workspaceFile] as const] : [])).values()].map(file => <ConnectorWorkspaceFile key={file.import_id} initial={file} />)}
    {run.entries.filter(entry => entry.workspaceError).map((entry, index) => <p role="alert" key={`workspace-error-${index}`}>第三方调用已返回，但工作区保存登记失败：{entry.workspaceError}</p>)}
    {artifacts.length > 0 && <div className="run-artifacts" aria-label="生成的文件">
      {artifacts.map(path => <LocalFileLink key={path} path={path} card>{path.split(/[\\/]/).pop() || path}</LocalFileLink>)}
    </div>}
  </div>;
}

function DetailedChatActivity({
  run,
  sceneLabel,
  repeatError,
  superseded,
  onOpenSubagents,
  showTrace = true,
}: {
  run: Run;
  sceneLabel?: string;
  repeatError: boolean;
  superseded: boolean;
  showTrace?: boolean;
  onOpenSubagents?: (taskIds: string[], selectedId?: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [now, setNow] = useState(Date.now);
  const passive = run.waitingForReply && !run.scheduling?.tasks.some(task => task.status === 'running' || task.status === 'queued');
  const status = run.status || run.outcome || (passive ? "waiting" : "thinking");
  const settledSummary = !!run.end && (status === 'done' || superseded);
  const showElapsed = !passive && status !== 'reconnecting';
  const showHint = run.hint && !(status === 'working' && run.hint.trim() === CHAT_SCENE_ACTIVITY_LABELS.working);
  useEffect(() => {
    if (run.end || !showElapsed) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [run.end, showElapsed]);
  const tools = run.entries.filter((entry) => entry.type === "tool");
  const failedTools = tools.filter(entry => entry.error);
  const failed = failedTools.length;
  const unconfirmed = tools.filter(entry => !entry.done && !entry.error).length;
  const artifacts = [...new Set(tools.flatMap(entry => entry.artifactPath ? [entry.artifactPath] : []))];
  const activeTool = tools.filter(entry => !entry.done && !entry.error).at(-1);
  const activeLabel = activeTool?.label?.trim();
  const summary = settledSummary ? `用时 ${duration(Math.max(0, Math.floor((run.end! - run.start) / 1000)))}`
    : repeatError ? '执行过程'
    : status === 'working' && activeLabel ? activeLabel
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
        {settledSummary ? <span className="run-icon" aria-hidden="true" /> : <span className="run-icon" role="img" aria-label={repeatError ? "执行过程" : run.label || CHAT_SCENE_ACTIVITY_LABELS[status]}>
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
        </span>}
        <span className="run-caption">
          <span className={settledSummary ? "run-label run-elapsed" : "run-label"} title={settledSummary ? summary : run.hint || run.arg || summary}>
            {settledSummary || showTrace ? summary : run.end ? '思考过程' : run.label}
          </span>
          {!settledSummary && showElapsed && <span className="run-elapsed">{`· ${duration(Math.max(0, Math.floor(((run.end || now) - run.start) / 1000)))}`}</span>}
          {run.autonomousOrigin
            ? <span className="message-scene" title="后台自主活动，与当前场景对话分别显示">{run.autonomousOrigin === 'callback' ? 'SBS 自主回调' : 'SBS 自主活动'}</span>
            : sceneLabel && <span className="message-scene" title={run.sceneId}>{sceneLabel}</span>}
        </span>
        {failed > 0 && <span className="run-failures">{failed} 次工具调用失败</span>}
        {showTrace && run.end && unconfirmed > 0 && <span>{unconfirmed} 次结果未确认</span>}
        <span className="run-chevron" aria-hidden="true">
          <Icon name="chat-chevron-right" />
        </span>
      </summary>
      <div className="run-body">
        <SubagentActivity tasks={run.scheduling?.tasks} onOpen={onOpenSubagents} />
        {open && !showTrace && failed > 0 && <div className="run-list">
          {failedTools.map((entry, i) => <ActivityStep key={entry.id || entry.toolCallId || i}
            entry={entry} finished={!!run.end} initiallyOpen />)}
        </div>}
        {open && showTrace && <>
        {tools.length > 0 && !run.scheduling?.tasks.length && <div className="run-metrics">
          {tools.length > 0 && <span>{tools.length} 次工具调用</span>}
          {failed > 0 && <span className="run-failures">{failed} 次失败</span>}
          {unconfirmed > 0 && <span>{unconfirmed} 次{run.end ? '结果未确认' : '进行中'}</span>}
        </div>}
        {showHint && <p className="run-hint">{run.hint}</p>}
        {!run.end && run.context && <p className="run-hint">{run.context}</p>}
        {run.scheduling && !onOpenSubagents && <SceneScheduling {...run.scheduling} />}
        <div className="run-list">
          {run.entries.map((entry, i) => <ActivityStep key={entry.id || entry.toolCallId || i}
            entry={entry} finished={!!run.end} />)}
          {!run.entries.length && !run.scheduling && (
            <p className="run-empty">
              {run.end ? "本轮未返回额外的过程记录。" : "正在等待响应…"}
            </p>
          )}
        </div>
        </>}
      </div>
    </details>
    {[...new Map(run.entries.flatMap(entry => entry.workspaceFile ? [[entry.workspaceFile.import_id, entry.workspaceFile] as const] : [])).values()].map(file => <ConnectorWorkspaceFile key={file.import_id} initial={file} />)}
    {run.entries.filter(entry => entry.workspaceError).map((entry, index) => <p role="alert" key={`workspace-error-${index}`}>第三方调用已返回，但工作区保存登记失败：{entry.workspaceError}</p>)}
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
