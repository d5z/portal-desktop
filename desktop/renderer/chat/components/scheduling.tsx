import { IntelligentAnswer } from "../../shared/intelligent-ui/answer";
import type { UIActions } from "../../shared/intelligent-ui/view";
import type { ComponentProps } from 'react';
import type { SceneTask } from '../../../shared/types';
import { splitSchedulingHint } from '../models/scheduling';
import { Markdown } from '../../shared/components/markdown';
import { CommandMessageMarkdown } from './command-message';

export function ScheduledMessage({ text, streaming, chat, onPlace, intelligentUI = false, commandLabels = false, storageKey, onContinue, onSnapshot, onEdit, messageId }: UIActions & { text: string; streaming: boolean; messageId?: string; chat?: boolean; intelligentUI?: boolean; commandLabels?: boolean; onPlace?: ComponentProps<typeof Markdown>['onPlace'] }) {
  const content = splitSchedulingHint(text);
  if (intelligentUI) return <IntelligentAnswer messageId={messageId} text={content.text} streaming={streaming} onPlace={onPlace} storageKey={storageKey} onContinue={onContinue} onSnapshot={onSnapshot} onEdit={onEdit} />;
  if (commandLabels) return <CommandMessageMarkdown content={content.text} className="content" chat={chat} onPlace={onPlace} />;
  return <>
    <Markdown content={content.text} className={`content${streaming ? ' stream-cursor' : ''}`} chat={chat} onPlace={onPlace} intelligentUI={intelligentUI} streaming={streaming} />

  </>;
}
const labels: Record<SceneTask['status'], string> = { queued: '等待执行', running: '后台执行中', done: '执行完成', failed: '执行失败', cancelled: '已取消', interrupted: '已中断', budget_exhausted: '达到任务限额', timeout: '执行超时' };
export function SceneScheduling({ tasks, hint }: { tasks: SceneTask[]; hint: string }) {
  if (!tasks.length && !hint) return null;
  const active = tasks.filter(t => t.status === 'running' || t.status === 'queued').length;
  const failed = tasks.filter(t => ['failed', 'cancelled', 'interrupted', 'budget_exhausted', 'timeout'].includes(t.status)).length;
  const completed = tasks.filter(t => t.status === 'done').length;
  const summary = active ? `${active} 项进行中` : failed ? `${failed} 项未完成` : tasks.length ? `${completed}/${tasks.length} 项完成` : '等待状态同步';
  return <section className="scene-scheduling scene-task-list" aria-label="场景调度">
    <header className="scene-task-header">
      <h4><span className={active ? 'scene-task-spinner' : ''} aria-hidden="true" />后台任务</h4>
      <span className={`scene-task-summary${failed ? ' has-failures' : ''}`} role="status">
        {summary}
      </span>
    </header>
    {hint && <pre>{hint}</pre>}
    {tasks.length > 0 && <p className="scene-task-note">任务在后台独立执行，结果会回到对应场景。</p>}
    <ul>{[...tasks].reverse().slice(0, 30).map(task => <li key={task.id} data-status={task.status}>
      <div className="scene-task-row">
        <span className="scene-task-status">{labels[task.status]}</span>
        <strong className="scene-task-brief">{task.brief || '后台子任务'}</strong>
        <time dateTime={new Date(task.createdAt).toISOString()}>{new Date(task.createdAt).toLocaleString()} · {task.id}{task.turns ? ` · ${task.turns} 轮` : ''}</time>
      </div>
      {task.error && <p className="scene-task-error">{task.error}</p>}
    </li>)}</ul>
  </section>;
}
