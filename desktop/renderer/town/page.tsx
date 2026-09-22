import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  TownModel,
  date,
  definitions,
  firesideMemberCount,
  firesideMemberDetails,
  firesideMembers,
  list,
  str,
  type Data,
} from "./models/town";
import { useModel } from "../shared/hooks/use-model";
import {
  TownHome,
  Catalog,
  CatalogDetail,
  Pagination,
  LocalKits,
  DetailError,
} from "./components/catalog";
import { TownFeed } from "./components/feed";
import { SeedGarden, SeedDetail, SeedSearch } from "./components/seeds";
export function Town({ model }: { model: TownModel }) {
  const town = useModel(model),
    definition = definitions[town.view],
    channel = town.channel(),
    social = Boolean(channel),
    paginated =
      !town.directId &&
      (["embers", "scrolls", "seeds"].includes(town.view) ||
        (town.view === "kits" && town.tab === "grove")),
    refreshing = Boolean((town.loading || town.detailLoading) && (town.data || town.ringData || town.library || town.detail)),
    root = useRef<HTMLElement>(null);
  useLayoutEffect(() => { if (root.current) root.current.scrollTop = 0; }, [town.view, town.directId]);
  return (
    <section
      id="town-view"
      ref={root}
      className={`view${social ? " social-view" : ""}${paginated ? " paginated-view" : ""}${town.view === "embers" ? " bookshelf-view" : ""}${["scrolls", "embers"].includes(town.view) && !town.directId ? " reading-catalog" : ""}${town.view === "kits" && town.tab === "grove" && !town.directId ? " kit-catalog" : ""}${town.view === "seeds" && !town.directId ? " seed-catalog" : ""}`}
      hidden={!town.visible || !definition}
    >
      <div className="town-content">
        <div className="town-heading" hidden>
          <div>
            <div id="town-eyebrow" hidden>
              {definition?.eyebrow}
            </div>
            <h1 id="town-title">{definition?.title || "小镇广场"}</h1>
            <p id="town-description">{definition?.description}</p>
          </div>
        </div>
        <div className="town-toolbar">
          <div
            id="town-tabs"
            className="segmented"
            role="tablist"
            hidden={Boolean(town.directId) || !definition?.tabs.length}
          >
            {definition?.tabs.map(([value, label]) => (
              <button
                key={value}
                role="tab"
                aria-selected={value === town.tab}
                className={value === town.tab ? "selected" : ""}
                onClick={() => town.selectTab(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <select
            id="scroll-kind"
            aria-label="卷轴类型"
            hidden={town.view !== "scrolls" || Boolean(town.directId)}
            value={town.scrollKind}
            onChange={(event) => {
              town.scrollKind = event.target.value;
              town.offset = 0;
              void town.load();
            }}
          >
            {[
              ["", "所有类型"],
              ["note", "笔记"],
              ["procedure", "操作流程"],
              ["lesson", "经验教训"],
              ["pattern", "方法模式"],
              ["guide", "指南"],
              ["skill", "技能"],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {town.view === "kits" && town.tab === "grove" && <div className="segmented grove-kind-filter" role="tablist" aria-label="Grove 类型">
            {([["", "全部"], ["kit", "Kits"], ["app", "Apps"]] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={town.groveKind === value} className={town.groveKind === value ? "selected" : ""} onClick={() => { town.groveKind = value; town.changed(); }}>{label}</button>)}
          </div>}
          <select
            id="grove-status"
            aria-label="Grove 成长阶段"
            hidden={town.view !== "kits" || town.tab !== "grove" || Boolean(town.directId)}
            value={town.groveStatus}
            onChange={(event) => {
              town.groveStatus = event.target.value;
              town.offset = 0;
              void town.load();
            }}
          >
            <option value="">全部阶段（含停维护）</option>
            <option value="grown">🌳 已长成</option>
            <option value="growing">🌿 成长中</option>
            <option value="sprouting">🌱 发芽中</option>
          </select>
          <input
            id="town-search"
            type="search"
            aria-label={social ? "搜索已加载的消息与作者" : "筛选当前列表"}
            placeholder={social ? "搜索消息、作者…" : "筛选当前列表…"}
            hidden={Boolean(town.directId) || town.view === "seeds"}
            value={town.search}
            onChange={(event) => town.setSearch(event.target.value)}
          />
          {town.view === "seeds" && !town.directId && <SeedSearch town={town} />}
          <div className="town-header-actions">
            <button
              id="town-write"
              className="town-write-button"
              aria-label={town.view === "mail" ? "写私信" : "写一句"}
              hidden={!channel}
              disabled={
                town.live?.phase !== "connected" ||
                (town.view === "firesides" &&
                  !(town.directId || town.selectedRing))
              }
              onClick={() => town.compose()}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="m12.5 3.5 4 4M4 12l9-9a1.4 1.4 0 0 1 2 0l2 2a1.4 1.4 0 0 1 0 2l-9 9-5 1 1-5Z" />
              </svg>
              {town.view === "mail" ? "写私信" : "写一句"}
            </button>
            <button
              id="town-auth-button"
              className="secondary"
              hidden={town.view === "seeds"}
              onClick={() => void town.auth()}
            >
              {town.authLabel}
            </button>
            <button
              id="town-refresh"
              className="icon-button"
              title="刷新内容"
              aria-label="刷新内容"
              onClick={() => void town.load(true)}
            >
              ↻
            </button>
          </div>
        </div>
        <div className="town-meta-row">
        <div className="town-live-row">
          <span
            id="town-live-status"
            role="status"
            data-phase={town.live?.phase || "connecting"}
          >
            {town.view === "seeds" ? "Seed Garden · 公开经验" : town.live?.message || "正在读取 Town 连接状态"}
          </span>
          <button
            id="town-live-retry"
            className="text-button"
            hidden={
              town.view === "seeds" || !town.live ||
              !["reconnecting", "auth-error"].includes(town.live.phase)
            }
            onClick={() => void town.run(() => town.api.reconnectTown())}
          >
            重新连接
          </button>
          <button
            id="town-updates"
            className="text-button"
            hidden={!channel || !town.unread(channel)}
            onClick={() => void town.load(true)}
          >
            有新内容 · 更新
          </button>
        </div>
        <div className="town-status-row">
          <div id="town-status" className="list-status" role="status" aria-live="polite">
            {town.refreshError || town.status}
          </div>
        </div>
        {town.view === "kits" && town.tab === "grove" && <button className="secondary grove-help-button" onClick={() => void town.run(() => town.api.openTownLink("/grove"))}>Grove Help ↗</button>}
        </div>
        <div
          id="town-body"
          className={
            town.view === "firesides" && !town.directId
              ? "fireside-body"
              : undefined
          }
          aria-busy={town.loading ? true : undefined}
        >
          {refreshing && <div id="town-refresh-indicator" className="town-refresh-indicator" role="status" aria-live="polite">
            <span className="town-refresh-label">
              <span className="startup-spinner" aria-hidden="true" />
              正在刷新…
            </span>
          </div>}
          {definition && <TownBody town={town} />}
        </div>
        <div id="town-pagination" className="pagination">
          {definition && <Pagination town={town} />}
        </div>
      </div>
    </section>
  );
}
function TownBody({ town }: { town: TownModel }) {
  if (town.error)
    return (
      <div className="empty-state">
        <div className="empty-symbol">{town.error.auth ? "⌑" : "↻"}</div>
        <h2>{town.error.auth ? "连接 Town，继续阅读" : "暂时未能读取内容"}</h2>
        <p>{town.error.message}</p>
        <button
          className="primary"
          onClick={() => {
            if (town.error?.auth) void town.auth();
            else void town.load();
          }}
        >
          {town.error.auth ? "配置 Town 连接" : "重试"}
        </button>
        {town.error.auth && (
          <button
            className="text-button"
            onClick={() => town.navigate("embers")}
          >
            阅读已公开的书架
          </button>
        )}
      </div>
    );
  if (town.loading && !town.data && !town.ringData && !town.library && !town.detail)
    return <div className="loading-block">正在读取…</div>;
  if (town.directId)
    return town.view === "firesides" ? (
      <div className="direct-reading">
        <FiresideThread town={town} />
      </div>
    ) : town.view === "seeds" ? <SeedDetail town={town} direct /> : (
      <CatalogDetail town={town} direct />
    );
  if (town.library) return <LocalKits town={town} />;
  if (!town.data) return null;
  if (town.view === "town") return <TownHome town={town} data={town.data} />;
  if (town.view === "bonfire" || town.view === "mail")
    return (
      <TownFeed
        key={`${town.view}:${town.tab}:${town.live?.generation}`}
        town={town}
        data={town.data}
        filterKey={town.view === "mail" ? town.tab : town.view}
      />
    );
  if (town.view === "firesides") return <Firesides town={town} />;
  if (town.view === "seeds") return <SeedGarden town={town} data={town.data} />;
  return <Catalog town={town} data={town.data} />;
}
function Firesides({ town }: { town: TownModel }) {
  const entries = town.rooms(),
    owned = new Set(list(town.data!, "owned").map((entry) => str(entry.id))),
    query = town.ringSearch.trim().toLowerCase();
  if (!entries.length)
    return (
      <div className="feed-empty">
        尚未加入围炉。你的 Being 创建或加入围炉后，会显示在这里。
      </div>
    );
  const visible = entries.filter((entry) =>
    `${str(entry.name, `围炉 #${str(entry.id)}`)} ${str(entry.description)} ${firesideMembers(entry).join(" ")}`
      .toLowerCase()
      .includes(query),
  );
  return (
    <div className="fireside-layout">
      <aside className="fireside-rooms" aria-label="围炉列表">
        <h2>我的围炉 · {entries.length}</h2>
        <input
          type="search"
          placeholder="查找围炉…"
          aria-label="查找围炉"
          value={town.ringSearch}
          onChange={(event) => {
            town.ringSearch = event.target.value;
            town.changed();
          }}
        />
        <div className="fireside-room-list">
          {entries
            .sort((a, b) => str(a.name).localeCompare(str(b.name), "zh-CN"))
            .map((entry) => {
              const id = str(entry.id),
                title = str(entry.name, `围炉 #${id}`),
                loadedMembers = town.ringMembers?.id === id
                  ? town.ringMembers.members
                  : undefined,
                memberCount = Math.max(
                  firesideMemberCount(entry),
                  loadedMembers?.length || 0,
                ),
                unread = town.firesideUnread(id);
              return (
                <button
                  className={`fireside-room${id === town.selectedRing ? " selected" : ""}${unread ? " unread" : ""}`}
                  data-id={id}
                  data-unread={unread || undefined}
                  key={id}
                  hidden={!visible.includes(entry)}
                  aria-pressed={id === town.selectedRing}
                  aria-label={`${title}${unread ? "，有新消息" : ""}`}
                  onClick={() => void town.loadFireside(id, title)}
                >
                  <strong>
                    <span className="fireside-unread-dot" aria-hidden="true" />
                    <span className="fireside-room-title">{title}</span>
                  </strong>
                  <span>{`${owned.has(id) ? "我创建的" : "已加入"}${memberCount ? ` · ${memberCount} 位成员` : ""}`}</span>
                </button>
              );
            })}
        </div>
        <p className="empty-inline" hidden={visible.length > 0}>
          没有匹配的围炉
        </p>
      </aside>
      <section
        className="fireside-thread"
        aria-label="围炉消息"
        aria-busy={town.detailLoading || undefined}
      >
        <FiresideThread
          town={town}
          room={entries.find((entry) => str(entry.id) === town.selectedRing)}
        />
      </section>
    </div>
  );
}
function FiresideThread({ town, room }: { town: TownModel; room?: Data }) {
  const activeId = town.directId || town.selectedRing,
    data = town.ringData?.id === activeId ? town.ringData.data : undefined,
    loadedMembers = town.ringMembers?.id === activeId
      ? town.ringMembers.members
      : undefined,
    memberSource = loadedMembers
      ? { ...(room || data || {}), members: loadedMembers }
      : room || data || {},
    memberDetails = firesideMemberDetails(memberSource),
    members = memberDetails.map((member) => member.name),
    memberCount = Math.max(
      firesideMemberCount(room || data || {}),
      memberDetails.length,
    ),
    ownerId = str(room?.owner_town_id),
    memberLoading = town.memberLoading;
  const heading = (
    <div className="fireside-thread-heading">
      <div>
        <h2>{town.ringTitle}</h2>
        <FiresideMembers
          key={activeId}
          count={memberCount}
          loading={memberLoading}
          names={members}
          members={memberDetails}
          ownerId={ownerId}
          currentId={town.me}
          error={town.memberError}
          retry={() => void town.loadFiresideMembers(activeId)}
        />
      </div>
    </div>
  );
  if (town.detailLoading && !data)
    return (
      <>
        {heading}
        <div className="feed-controls fireside-loading-controls" role="status">
          正在切换围炉…
        </div>
        <div className="feed-summary fireside-loading-summary" aria-hidden="true">
          &nbsp;
        </div>
      </>
    );
  if (town.detailError && !data)
    return <>{heading}<DetailError town={town} /></>;
  if (!data) return heading;
  return (
    <>
      {heading}
      <TownFeed
        key={`${town.ringData?.id}:${town.live?.generation}`}
        town={town}
        data={data}
        filterKey="firesides"
      />
    </>
  );
}
function FiresideMembers({
  count,
  loading,
  names,
  members,
  ownerId,
  currentId,
  error,
  retry,
}: {
  count: number;
  loading: boolean;
  names: string[];
  members: ReturnType<typeof firesideMemberDetails>;
  ownerId: string;
  currentId: string;
  error: string;
  retry: () => void;
}) {
  const [open, setOpen] = useState(false),
    root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
        if (!root.current?.contains(event.target as Node)) setOpen(false);
      },
      dismissKey = (event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        requestAnimationFrame(() => trigger.current?.focus());
      },
      dismissWindow = () => setOpen(false);
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("keydown", dismissKey, true);
    window.addEventListener("blur", dismissWindow);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("keydown", dismissKey, true);
      window.removeEventListener("blur", dismissWindow);
    };
  }, [open]);
  return (
    <div
      ref={root}
      className={`fireside-members${open ? " open" : ""}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="fireside-members-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={names.join("、")}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="7" cy="7" r="2.5" />
          <circle cx="13.5" cy="8" r="2" />
          <path d="M2.8 15c.5-2.6 2-3.9 4.3-3.9s3.9 1.3 4.4 3.9M11.4 12c.7-.7 1.5-1 2.5-1 1.8 0 2.9 1 3.3 3" />
        </svg>
        <span>{count > 0 ? `${count} 位成员` : "成员"}</span>
        {loading && <span className="fireside-members-loading" aria-label="正在读取" />}
        <svg className="fireside-members-chevron" viewBox="0 0 12 12" aria-hidden="true">
          <path d="m3 4.5 3 3 3-3" />
        </svg>
      </button>
      {open && (
        <div
          className="fireside-member-panel"
          role="dialog"
          aria-label="围炉成员名单"
          tabIndex={-1}
          onPointerDown={(event) => event.currentTarget.focus({ preventScroll: true })}
        >
          <div className="fireside-member-panel-heading">
            <strong>成员名单</strong>
            <span>{count > 0 ? `${count} 位` : ""}</span>
          </div>
          {error && (
            <div className="fireside-member-error" role="status">
              <span>{error}</span>
              <button type="button" className="text-button" onClick={retry}>
                重试
              </button>
            </div>
          )}
          {loading && !members.length && (
            <p className="empty-inline">正在读取成员名单…</p>
          )}
          {!loading && !error && !members.length && (
            <p className="empty-inline">暂无成员信息</p>
          )}
          <div className="fireside-member-list" role="list">
            {members.map((member) => (
              <div
                className="fireside-member"
                role="listitem"
                key={member.townId || member.name}
              >
                <div>
                  <strong>{member.name}</strong>
                  <span>
                    {member.townId ||
                      (member.display !== member.name ? member.display : "")}
                  </span>
                </div>
                <div className="fireside-member-meta">
                  {member.townId === ownerId && <span>炉主</span>}
                  {member.townId === currentId && <span>当前 Being</span>}
                  {member.joinedAt && (
                    <time dateTime={member.joinedAt}>
                      加入 {date(member.joinedAt)}
                    </time>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
