import { Icon } from '../../shared/icons/icon';
import { useEffect, useRef, useState } from 'react';
import type { RecentChatMessage } from '../../../shared/types';
import type { AppModel } from '../models/app';
import { mergeRecentQuestions, recentQuestionGroups } from '../models/recent-history';

export function RecentHistory({ app, visible = true }: { app: AppModel; visible?: boolean }) {
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const endpoint = app.snapshot?.settings.hasToken ? app.snapshot.settings.endpoint : '';
  const [revision, refresh] = useState(0);
  const [result, setResult] = useState<{ endpoint: string; local: RecentChatMessage[]; remote: RecentChatMessage[] }>({ endpoint: '', local: [], remote: [] });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({ local: '', remote: '' });
  useEffect(() => {
    let active = true, reading = false;
    const abort = new AbortController();
    setErrors({ local: '', remote: '' }); setLoading(!!endpoint);
    if (!endpoint) { setResult({ endpoint: '', local: [], remote: [] }); return; }
    const read = async () => {
      if (reading) return;
      reading = true; setLoading(true);
      const receive = (source: 'local' | 'remote', rows: RecentChatMessage[]) => {
        if (!active) return;
        setResult(previous => ({ ...(previous.endpoint === endpoint ? previous : { endpoint, local: [], remote: [] }), [source]: rows }));
        setErrors(previous => ({ ...previous, [source]: '' }));
      };
      const failed = (source: 'local' | 'remote', error: string) => {
        if (active) setErrors(previous => ({ ...previous, [source]: error }));
      };
      // Independent reads let cached questions appear while history is slow or offline.
      await Promise.allSettled([
        app.chatLoading ? Promise.resolve() : app.localHistory.read(endpoint, abort.signal)
          .then(rows => receive('local', rows), () => failed('local', '本地对话读取失败，请重试。')),
        (async () => {
          if (typeof app.api.recentChatHistory !== 'function') {
            failed('remote', '客户端接口已更新，请重新打开客户端后查看场景动态。');
            return;
          }
          try { receive('remote', await app.api.recentChatHistory(endpoint)); }
          catch { failed('remote', '网络历史读取失败，已保留可用对话。'); }
        })(),
      ]);
      reading = false; if (active) setLoading(false);
    };
    void read();
    const timer = setInterval(() => { if (visibleRef.current && !document.hidden) void read(); }, 30000);
    return () => { active = false; abort.abort(); clearInterval(timer); };
  }, [app, endpoint, revision, app.chatSource, app.chatLoading]);
  const rows = result.endpoint === endpoint ? mergeRecentQuestions(result.local, result.remote) : [];
  const error = [errors.local, errors.remote].filter(Boolean).join(' ');
  const scenes = new Map(app.snapshot?.chatSessions?.map(scene => [scene.scene_id, scene]));
  // Local availability controls navigation, never whether a question can appear.
  const groups = recentQuestionGroups(rows);
  return <div className="being-recent-history">
    <div className="being-history-heading"><h3>场景动态</h3><button type="button" disabled={!endpoint || loading} onClick={() => refresh(value => value + 1)}>{loading ? '读取中…' : '刷新'}</button></div>
    {error && <p className="being-empty" role="status">{error}<button type="button" disabled={loading} onClick={() => refresh(value => value + 1)}>重试</button></p>}
    {!groups.length && !error && <p className="being-empty" role="status">{!endpoint ? '连接 Being 后查看场景动态' : loading ? '正在读取场景动态…' : '暂无对话动态'}</p>}
    <div className="being-history-list" role="region" aria-label="最近提问" aria-busy={loading}>{groups.map(group => <section key={group.day}>
      <h4 className="being-history-date">{group.label}</h4>
      <ol aria-label={group.label + '的提问'}>{group.questions.map(({ message: row, preview, time }) => {
        const scene = scenes.get(row.scene_id);
        const content = <><span className="being-history-icon" aria-hidden="true"><Icon name="chat-history" /></span>
          <span className="being-history-text"><span className="being-history-preview">{preview}</span>
          {time && <time className="being-history-time" dateTime={row.at}>{time}</time>}</span></>;
        return <li key={row.seq}>{scene ? <button type="button" className="being-history-row" title={preview} onClick={() => void app.run(() => app.changeChatSession('select', scene.scene_id, undefined, row.seq))}>{content}</button>
          : <div className="being-history-row" title={preview}>{content}</div>}</li>;
      })}</ol>
    </section>)}</div>
  </div>;
}
