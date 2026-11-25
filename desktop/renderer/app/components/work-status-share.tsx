import { useEffect, useState } from 'react';
import { workStages, type WorkAssignee, type WorkItem } from '../../../shared/work';
import { townDisplayName, validTownIdentity } from '../../../shared/town-identity';
import { Dialog } from '../../shared/components/dialog';
import styles from './work.module.scss';

const messageLimit = 15000;

export function WorkStatusShareDialog({ item, self, close, prepare }: {
  item: WorkItem;
  self?: string;
  close: () => void;
  prepare: (recipient: WorkAssignee, content: string) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [contacts, setContacts] = useState<WorkAssignee[]>([]);
  const [directoryStatus, setDirectoryStatus] = useState('正在查找通讯录…');
  const [editedContent, setEditedContent] = useState<string>();
  const acceptedVersion = item.stage === 'done' ? item.acceptedDeliveryVersion : undefined;
  const deliveryVersion = acceptedVersion || item.executions?.filter(run => run.deliveryVersion).at(-1)?.deliveryVersion;
  const content = editedContent ?? [
    `任务：${item.title}`, `当前状态：${workStages[item.stage]}`,
    deliveryVersion && `${acceptedVersion ? '已验收交付' : '最近交付'}：v${deliveryVersion}`,
  ].filter(Boolean).join('\n');
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
  const canPrepare = eligible && content.trim() && content.length <= messageLimit;
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await prepare({ townId, display: exact?.display }, content.trim());
      close();
    } catch (failure) {
      setError((failure as Error).message);
    } finally { setBusy(false); }
  };

  return <Dialog open busy={busy} onClose={close} className={styles.itemDialog} aria-labelledby="work-share-title">
    <form className={`dialog-form ${styles.itemEditor}`} onSubmit={event => {
      event.preventDefault();
      if (canPrepare && !busy) void submit();
    }}>
      <header className="dialog-heading"><h2 id="work-share-title">分享状态给其他 Being</h2></header>
      <div className={`dialog-body ${styles.itemEditorBody} ${styles.shareBody}`}>
        <div className={styles.shareRecipient}>
          <label>收件 Being
            <input autoFocus autoComplete="off" value={query} maxLength={80} placeholder="搜索显示名或输入完整 Town ID"
              onChange={event => setQuery(event.target.value)} disabled={busy} />
          </label>
          {townId && townId === self ? <p className={styles.hint}>请选择其他 Being。</p>
            : exact?.display ? <p className={styles.hint}>{exact.display}</p>
              : directoryStatus && <p role="status" className={styles.hint}>{directoryStatus}</p>}
          {!!matches.length && <ul className={styles.shareMatches} aria-label="通讯录匹配项">
            {matches.map(contact => <li key={contact.townId}><button type="button" disabled={busy} onClick={() => setQuery(contact.townId)}>
              <span>{contact.display || contact.townId}</span>{contact.display && <small>{contact.townId}</small>}
            </button></li>)}
          </ul>}
        </div>
        <label>私信正文
          <textarea aria-label="私信正文" rows={4} value={content} onChange={event => setEditedContent(event.target.value)} disabled={busy} />
        </label>
        <p className={styles.hint}>在自己的 Being 对话里确认发送。</p>
        {content.length > messageLimit && <p className={styles.itemError}>请将正文缩短至 {messageLimit.toLocaleString()} 字符以内。</p>}
      </div>
      <footer className="dialog-footer">
        {error && <p className={styles.itemError} role="alert">{error}</p>}
        <div className={styles.itemActions}>
          <button type="button" disabled={busy} onClick={close}>取消</button>
          <button className={styles.saveTask} type="submit" disabled={busy || !canPrepare}>{busy ? '正在准备…' : '准备私信'}</button>
        </div>
      </footer>
    </form>
  </Dialog>;
}
