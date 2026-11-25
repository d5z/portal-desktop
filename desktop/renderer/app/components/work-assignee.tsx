import { useEffect, useState } from 'react';
import type { WorkAssignee, WorkItem } from '../../../shared/work';
import { townDisplayName, validTownIdentity } from '../../../shared/town-identity';
import { Dialog } from '../../shared/components/dialog';
import styles from './work.module.scss';

const messageLimit = 15000;

export function WorkAssigneeDialog({ item, self, close, save }: {
  item: WorkItem;
  self?: string;
  close: () => void;
  save: (assignee: WorkAssignee | null, content?: string) => Promise<void>;
}) {
  const [query, setQuery] = useState(item.assignee?.townId || '');
  const [contacts, setContacts] = useState<WorkAssignee[]>([]);
  const [directoryStatus, setDirectoryStatus] = useState('正在查找通讯录…');
  const [content, setContent] = useState(() => [
    `任务：${item.title}`, item.description, item.goal && `任务目标：${item.goal}`, item.specification && `规格：${item.specification}`,
    item.acceptanceCriteria?.length && `验收标准：\n${item.acceptanceCriteria.map(value => `- ${value}`).join('\n')}`,
    item.dueDate && `截止日期：${item.dueDate}`, '请在这封私信中回复是否可以接手，完成后请回传结果。',
  ].filter(Boolean).join('\n\n'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void fetch('beings://desktop/api/contacts', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('无法读取通讯录。');
      const { entries } = await response.json() as { entries?: { town_id?: unknown; display_name?: unknown; display?: unknown }[] };
      if (!Array.isArray(entries)) throw new Error('通讯录格式错误。');
      setContacts(entries.flatMap(({ town_id, display_name, display }) =>
        validTownIdentity(town_id) && town_id.startsWith('t_')
          ? [{ townId: town_id, display: townDisplayName(display_name || display, town_id) }] : []));
      setDirectoryStatus('');
    }).catch(() => { if (!controller.signal.aborted) setDirectoryStatus('通讯录暂不可用，可输入完整 Town ID。'); });
    return () => controller.abort();
  }, []);
  const townId = query.trim();
  const term = townId.toLocaleLowerCase();
  const exact = contacts.find(contact => contact.townId === townId);
  const eligible = townId.startsWith('t_') && validTownIdentity(townId) && townId !== self;
  const matches = eligible ? [] : contacts
    .filter(contact => contact.townId !== self && [contact.display, contact.townId].some(value => value?.toLocaleLowerCase().includes(term)))
    .slice(0, 5);
  const display = exact?.display || (item.assignee?.townId === townId ? item.assignee.display : undefined);
  const canPrepare = eligible && content.trim() && content.length <= messageLimit;
  const submit = async (assignee: WorkAssignee | null) => {
    setBusy(true);
    setError('');
    try {
      await save(assignee, assignee ? content.trim() : undefined);
      close();
    } catch (failure) {
      setError((failure as Error).message);
    } finally { setBusy(false); }
  };

  return <Dialog open busy={busy} onClose={close} className={styles.itemDialog} aria-labelledby="work-assignee-title">
    <form className={`dialog-form ${styles.itemEditor}`} onSubmit={event => {
      event.preventDefault();
      if (canPrepare && !busy) void submit({ townId, display });
    }}>
      <header className="dialog-heading"><h2 id="work-assignee-title">指派给其他 Being</h2></header>
      <div className={`dialog-body ${styles.itemEditorBody} ${styles.assigneeBody}`}>
        <div className={styles.assigneeRecipient}>
          <label>收件 Being
            <input autoFocus autoComplete="off" value={query} maxLength={80} placeholder="搜索显示名或输入完整 Town ID"
              onChange={event => setQuery(event.target.value)} disabled={busy} />
          </label>
          {townId && townId === self ? <p className={styles.hint}>请选择其他 Being。</p>
            : display ? <p className={styles.hint}>{display}</p>
              : directoryStatus && <p role="status" className={styles.hint}>{directoryStatus}</p>}
          {!!matches.length && <ul className={styles.assigneeMatches} aria-label="通讯录匹配项">
            {matches.map(contact => <li key={contact.townId}><button type="button" disabled={busy} onClick={() => setQuery(contact.townId)}>
              <span>{contact.display || contact.townId}</span>{contact.display && <small>{contact.townId}</small>}
            </button></li>)}
          </ul>}
        </div>
        <label>私信正文
          <textarea aria-label="私信正文" rows={6} value={content} onChange={event => setContent(event.target.value)} disabled={busy} />
        </label>
        <p className={styles.hint}>保存指派后，去自己的 Being 对话确认并发送这封私信。</p>
        {content.length > messageLimit && <p className={styles.itemError}>请将正文缩短至 {messageLimit.toLocaleString()} 字符以内。</p>}
      </div>
      <footer className="dialog-footer">
        {error && <p className={styles.itemError} role="alert">{error}</p>}
        <div className={styles.itemActions}>
          {item.assignee && <button className={styles.removeAssignee} type="button" disabled={busy} onClick={() => void submit(null)}>移除指派</button>}
          <button type="button" disabled={busy} onClick={close}>取消</button>
          <button className={styles.saveTask} type="submit" disabled={busy || !canPrepare}>{busy ? '正在保存…' : '保存并准备私信'}</button>
        </div>
      </footer>
    </form>
  </Dialog>;
}
