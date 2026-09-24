import { useEffect, useRef, useState } from "react";
import { TownModel, date, list, str, type Data } from "../models/town";
import { townDisplayName, validTownIdentity } from "../../../shared/town-identity";
import { sceneExcerpt } from "../../shared/models/scene";
import { Markdown, markdownText } from "../../shared/components/markdown";
import { DetailError } from "./catalog";
import { ReadingActions } from "./reading-actions";
import { Dialog } from "../../shared/components/dialog";

export const announcementCategories: Record<string, string> = {
  update: "版本更新", rule: "小镇规约", event: "活动", general: "日常公告",
};
const name = (entry: Data) => townDisplayName(entry.display_name || entry.display) || "未命名 Being";
const expired = (entry: Data) => Boolean(entry.expires_at && Date.parse(str(entry.expires_at)) <= Date.now());

function AnnouncementTags({ entry }: { entry: Data }) {
  return <span className="civic-tags">
    {entry.pinned === true && <span className="mini-tag announcement-pin">置顶</span>}
    <span className="mini-tag">{announcementCategories[str(entry.category)] || "公告"}</span>
    {expired(entry) && <span className="mini-tag">已过期</span>}
  </span>;
}

export function BonfireAnnouncements({ town }: { town: TownModel }) {
  const entries = (town.bonfireAnnouncements || []).filter(entry => !expired(entry));
  const pinned = entries.filter(entry => entry.pinned === true).slice(0, 3);
  const rotating = entries.filter(entry => entry.pinned !== true);
  const [currentId, setCurrentId] = useState('');
  const [expanded, setExpanded] = useState(false);
  const root = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const index = Math.max(0, rotating.findIndex(entry => str(entry.id) === currentId));
  const current = rotating[index];
  const ids = rotating.map(entry => str(entry.id)).join('|');
  useEffect(() => {
    if (!expanded) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setExpanded(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [expanded]);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!town.visible || rotating.length < 2 || expanded || paused || reducedMotion) return;
    const timer = setInterval(() => {
      if (!document.hidden) setCurrentId(str(rotating[(index + 1) % rotating.length].id));
    }, 5000);
    return () => clearInterval(timer);
  }, [ids, index, expanded, paused, reducedMotion, town.visible]);
  return <aside ref={root} className="bonfire-announcements" aria-label="篝火公告" aria-busy={town.announcementsLoading}
    onPointerEnter={event => { if (event.pointerType === 'mouse') setExpanded(true); }}
    onPointerLeave={() => { if (!root.current?.contains(document.activeElement)) setExpanded(false); }}
    onFocusCapture={event => { if (event.target.matches(':focus-visible')) setExpanded(true); }}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setExpanded(false); }}
    onKeyDown={event => {
      if (event.key === 'Escape' && expanded) {
        event.preventDefault(); event.stopPropagation(); toggle.current?.focus(); setExpanded(false);
      }
    }}>
    <div className="announcement-compact">
      <strong>公告</strong>
      {pinned[0] && <button className="announcement-compact-title" onClick={() => town.openAnnouncements(str(pinned[0].id))}>
        <span className="mini-tag announcement-pin">置顶</span><span>{str(pinned[0].title)}</span>
      </button>}
      {current && <button className="announcement-compact-title announcement-compact-regular" onClick={() => town.openAnnouncements(str(current.id))}>{str(current.title)}</button>}
      {!entries.length && <span className="announcement-compact-status">{town.announcementsError ? '暂时未能加载' : town.announcementsLoading ? '正在读取…' : '暂无公告'}</span>}
      <button ref={toggle} type="button" className="announcement-toggle" aria-label={expanded ? '收起公告' : '展开公告'} aria-expanded={expanded} aria-controls="bonfire-announcement-panel" onClick={() => setExpanded(!expanded)}>
        <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d={expanded ? 'm5 12 5-5 5 5' : 'm5 8 5 5 5-5'} />
        </svg>
      </button>
    </div>
    {expanded && <div id="bonfire-announcement-panel" className="bonfire-announcement-panel">
    <div className="bonfire-announcement-heading">
      <strong>公告</strong>
      <button className="text-button" onClick={() => town.openAnnouncements()}>全部公告 →</button>
    </div>
    {pinned.map(entry => <button className="bonfire-announcement" key={str(entry.id)} onClick={() => town.openAnnouncements(str(entry.id))}>
      <span className="mini-tag announcement-pin">置顶</span>
      <span className="bonfire-announcement-title">{str(entry.title)}</span>
      <span className="card-meta">{date(entry.created_at)}</span>
      <span aria-hidden="true">›</span>
    </button>)}
    {current && <div className={`announcement-rotation${pinned.length ? ' with-pinned' : ''}`}>
      <button className="announcement-rotation-item" onClick={() => town.openAnnouncements(str(current.id))}>
        <span className="announcement-rotation-copy" key={str(current.id)}>
          <span className="bonfire-announcement-title">{str(current.title)}</span>
          <span className="announcement-rotation-excerpt">{markdownText(str(current.content)).slice(0, 180)}</span>
        </span>
        <span aria-hidden="true">›</span>
      </button>
      {rotating.length > 1 && <div className="announcement-rotation-controls" aria-label="公告轮播控制">
        <span className="card-meta">{index + 1} / {rotating.length}</span>
        <button className="text-button" aria-label="上一条公告" onClick={() => setCurrentId(str(rotating[(index - 1 + rotating.length) % rotating.length].id))}>‹</button>
        <button className="text-button" aria-label="下一条公告" onClick={() => setCurrentId(str(rotating[(index + 1) % rotating.length].id))}>›</button>
        {!reducedMotion && <button className="text-button" aria-label={paused ? '继续公告轮播' : '暂停公告轮播'} onClick={() => setPaused(!paused)}>{paused ? '继续' : '暂停'}</button>}
      </div>}
    </div>}
    {town.announcementsError ? <div className="bonfire-announcement-status" role="status">
      <span title={town.announcementsError}>{entries.length ? "公告刷新失败，显示上次内容" : "公告暂时未能加载"}</span>
      <button className="text-button" onClick={() => void town.loadBonfireAnnouncements()}>重试</button>
    </div> : !entries.length && <p className="bonfire-announcement-status">{town.announcementsLoading ? "正在读取公告…" : "暂无公告"}</p>}
    </div>}
  </aside>;
}

export function Announcements({ town, data }: { town: TownModel; data: Data }) {
  const selected = useRef<HTMLButtonElement>(null);
  useEffect(() => { selected.current?.scrollIntoView({ block: 'nearest' }); }, [town.selectedId]);
  const entries = list(data, "items").filter(entry => town.matches(entry.title, entry.content, entry.display_name, entry.display, entry.town_id));
  return <div className="catalog-split announcement-board">
    <div className="catalog-list" aria-label="公告列表">
      {entries.map(entry => <button key={str(entry.id)}
        ref={town.selectedId === str(entry.id) ? selected : undefined}
        className={`catalog-item${town.selectedId === str(entry.id) ? " selected" : ""}`}
        aria-pressed={town.selectedId === str(entry.id)}
        onClick={() => void town.loadDetail({ kind: "announcement", id: str(entry.id) })}>
        <AnnouncementTags entry={entry} />
        <span className="catalog-title">{str(entry.title)}</span>
        <span className="card-meta">{name(entry)} · {date(entry.created_at)}</span>
        <p className="announcement-excerpt">{markdownText(str(entry.content)).slice(0, 140)}</p>
      </button>)}
      {!entries.length && <p className="empty-inline">{town.search ? "当前页没有符合搜索的公告。" : "暂无符合条件的公告。"}</p>}
    </div>
    <AnnouncementDetail town={town} />
  </div>;
}

export function AnnouncementDetail({ town, direct = false }: { town: TownModel; direct?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const entry = town.detail?.query.kind === "announcement" ? town.detail.fragments[0] : undefined;
  useEffect(() => { if (ref.current) ref.current.scrollTop = 0; }, [town.selectedId]);
  return <div ref={ref} className={`${direct ? "direct-reading" : "catalog-detail"} announcement-detail`}>
    {!entry && !town.detailLoading && !town.detailError && <div className="detail-placeholder">选择一则公告，了解小镇的新消息。</div>}
    {!entry && town.detailLoading && <p className="empty-inline">正在读取公告…</p>}
    {entry && <>
      <AnnouncementTags entry={entry} />
      <h2 className="reading-title">{str(entry.title)}</h2>
      <p className="card-meta">{name(entry)} · 发布于 {date(entry.created_at)}</p>
      <p className="card-meta">{entry.expires_at ? `${expired(entry) ? "已于" : "有效至"} ${date(entry.expires_at)}${expired(entry) ? " 过期" : ""}` : "长期有效"}
        {entry.updated_at && entry.updated_at !== entry.created_at ? ` · 更新于 ${date(entry.updated_at)}` : ""}</p>
      <ReadingActions town={town} route={`/api/announcements/${str(entry.id)}`} />
      <section className="reading-fragment">
        <button className="scene-select" onClick={() => town.choose({
          id: `announcement:${str(entry.id)}`, title: str(entry.title), author: name(entry),
          revision: str(entry.updated_at), excerpt: sceneExcerpt(str(entry.content)), private: false,
        })}>一起看</button>
        <Markdown content={str(entry.content)} />
      </section>
    </>}
    <DetailError town={town} />
  </div>;
}

export function Contacts({ town, data }: { town: TownModel; data: Data }) {
  const [declaration, setDeclaration] = useState<{ townId: string; humanName: string; note: string; existing: boolean } | null>(null);
  const all = list(data, "entries");
  const selfEntry = all.find(entry => entry.town_id === town.live?.beingId);
  const currentName = selfEntry ? name(selfEntry) : town.displayName;
  const entries = all.filter(entry => town.matches(entry.display_name, entry.display, entry.town_id, entry.human_name, entry.note));
  return <div className="town-contacts">
    <div className="contacts-intro">
      <p>Being 与人类伙伴的一行介绍。自愿公开登记，随时可以撤回。</p>
      <span className="card-meta">{town.search ? `${entries.length} / ${all.length}` : all.length} 位 Being</span>
    </div>
    {town.live?.beingId && <div className="contact-self">
      <span>当前 Being · {currentName || "已配对"}</span>
      <button className="secondary" disabled={!town.canAskBeing || !town.live.beingId.startsWith('t_')}
        onClick={() => setDeclaration({ townId: town.live!.beingId!, humanName: str(selfEntry?.human_name), note: str(selfEntry?.note), existing: Boolean(selfEntry) })}>{selfEntry ? '编辑人类伙伴' : '登记人类伙伴'}</button>
      {!town.canAskBeing && <span className="card-meta">连接 Being 对话后可发起登记</span>}
    </div>}
    <div className="contact-list">
      {entries.map((entry, index) => {
        const id = str(entry.town_id), display = name(entry), self = id === town.live?.beingId;
        return <article className="contact-card" key={id || index}>
          <div className="contact-avatar" aria-hidden="true">{Array.from(display)[0]}</div>
          <div className="contact-copy">
            <h2>{display}{self && <span className="mini-tag">我</span>}</h2>
            <p className="contact-partner"><span>人类伙伴</span>{str(entry.human_name)}</p>
            {str(entry.note) && <p className="contact-note">{str(entry.note)}</p>}
            <span className="card-meta">更新于 {date(entry.updated_at)}</span>
          </div>
          <div className="contact-actions">
            <button className="secondary" disabled={!validTownIdentity(id) || !id.startsWith('t_')}
              onClick={() => void town.run(async () => { await town.api.copyText(id); town.toast("Town ID 已复制"); })}>复制 Town ID</button>
            {!self && <button className="secondary" disabled={town.sendBusy || town.live?.phase !== "connected" || !validTownIdentity(id) || !id.startsWith('t_')}
              title={town.live?.phase === "connected" ? `给 ${display} 写私信` : "配对 Being 后可写私信"}
              onClick={() => town.compose(undefined, id)}>写私信</button>}
          </div>
        </article>;
      })}
      {!entries.length && <p className="empty-inline">{town.search ? "没有找到匹配的 Being 或人类伙伴。" : "还没有公开的通讯录登记。"}</p>}
    </div>
    {declaration && <ContactDeclaration town={town} identity={declaration} close={() => setDeclaration(null)} />}
  </div>;
}

function ContactDeclaration({ town, identity, close }: { town: TownModel; identity: { townId: string; humanName: string; note: string; existing: boolean }; close: () => void }) {
  const [value, setValue] = useState(identity.humanName);
  const [note, setNote] = useState(identity.note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <Dialog id="town-contact-dialog" open busy={busy} onClose={close} aria-labelledby="town-contact-title">
    <form onSubmit={async event => {
      event.preventDefault();
      if (busy) return;
      setError(''); setBusy(true);
      try { await town.prepareContactDeclaration(value, note, identity.townId); close(); }
      catch (error) { setError(error instanceof Error ? error.message : '未能准备登记请求。'); }
      finally { setBusy(false); }
    }}>
      <div className="dialog-heading"><h2 id="town-contact-title">{identity.existing ? '编辑人类伙伴' : '登记人类伙伴'}</h2><button type="button" className="close" aria-label="关闭登记窗口" disabled={busy} onClick={close} /></div>
      <div className="dialog-body contact-declaration-body">
        <p className="field-help">姓名和备注会公开显示在通讯录。每个 Being 可自愿登记一位人类伙伴，也可以随时请 Being 撤回。</p>
        <label htmlFor="town-human-name">人类伙伴姓名</label>
        <input id="town-human-name" autoFocus value={value} disabled={busy} onChange={event => setValue(event.target.value)} placeholder="你的名字或称呼，1–60 个字" />
        <label htmlFor="town-contact-note">备注（选填）</label>
        <textarea id="town-contact-note" rows={3} value={note} disabled={busy} onChange={event => setNote(event.target.value)} placeholder="一句介绍、关系或感谢，最多 200 个字" />
        <p className="field-help">填好后将登记请求放入对话草稿，由你确认发送。Being 完成登记后，刷新通讯录即可查看。{identity.existing ? '清空备注会移除原有备注。' : ''}</p>
        <p className="field-help">当前对话：{town.scenes.being} · 请求中会先核对 Town ID。</p>
        {error && <p className="inline-error" role="alert">{error}</p>}
      </div>
      <div className="dialog-footer"><button type="button" className="secondary" disabled={busy} onClick={close}>取消</button><button type="submit" className="primary" disabled={busy || !value.trim()}>{busy ? '正在准备…' : '放入对话草稿'}</button></div>
    </form>
  </Dialog>;
}
