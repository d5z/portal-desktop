import { Fragment, useEffect, useRef } from "react";
import { TownModel, record, str, list, date, type Data } from "../models/town";
import { sceneExcerpt } from "../../shared/models/scene";
import { Markdown } from "../../shared/components/markdown";
import { ReadingActions } from "./reading-actions";
import type { LocalKit } from "../../../shared/types";
const scrollLabels: Record<string, Record<string, string>> = {
  kind: {
    note: "笔记",
    procedure: "操作流程",
    lesson: "经验教训",
    pattern: "方法模式",
    guide: "指南",
    skill: "技能",
    ember: "故事",
  },
  visibility: { private: "私有", shared: "通过链接分享", public: "公开" },
  lifecycle: {
    seed: "初稿",
    verified: "已验证",
    mature: "成熟",
    stale: "待更新",
    superseded: "已被替代",
  },
};
const scrollLabel = (field: string, value: unknown) =>
  scrollLabels[field][str(value)] || str(value, "未标注");
export function TownHome({ town, data }: { town: TownModel; data: Data }) {
  const services = Object.entries(record(data.services))
    .map(([name, raw]) => ({
      name,
      key: name.trim().split(/\s+/).at(-1)!,
      service: record(raw),
    }))
    .filter(({ key }) => key !== "beings");
  const routes: Record<string, [string, string, string]> = {
    grove: ["◇", "Grove 工具市集", "kits"],
    bonfire: ["♧", "篝火", "bonfire"],
    fireside: ["◎", "围炉", "firesides"],
    messages: ["✉", "私信", "mail"],
    garden: ["♧", "种子花园 · Seed Garden", "seeds"],
    seeds: ["♧", "种子花园 · Seed Garden", "seeds"],
    ember: ["▤", "书架", "embers"],
    scroll: ["≡", "卷轴", "scrolls"],
    portal: ["⌘", "Portal 设置", "portal"],
  };
  const labels: Record<string, string> = {
    browse: "浏览器",
    fireside: "围炉",
    workspace: "云端工作目录",
    channel: "消息渠道",
    search: "网络搜索",
  };
  const cards =
    town.tab === "services"
      ? services.flatMap(({ name, key, service }) => {
          const known = routes[key],
            title = known?.[1] || labels[key] || name,
            help = str(service.help).replace(/^GET /, "");
          return town.matches(title, name, service.what)
            ? [
                <article className="service-card" key={name}>
                  <span className="service-icon" aria-hidden="true">
                    {known?.[0] || "◦"}
                  </span>
                  <h2>{title}</h2>
                  <p>{str(service.what)}</p>
                  <button
                    className="card-link"
                    onClick={() => {
                      if (known) town.navigate(known[2]);
                      else if (/^\/api\/[a-z]+\/help$/.test(help))
                        void town.run(() => town.api.openTownLink(help));
                    }}
                  >
                    {known ? "打开" : "说明 ↗"}
                  </button>
                </article>,
              ]
            : [];
        })
      : list(data, "whats_new")
          .filter((update) => town.matches(update.service, update.change))
          .map((update, i) => (
            <article className="service-card" key={i}>
              <small className="card-meta">{str(update.date)}</small>
              <h2>{str(update.service)}</h2>
              <p>{str(update.change)}</p>
            </article>
          ));
  return (
    <>
      <div className="town-summary">
        <span>{services.length} 项服务</span>
        <span>Town {str(data.version)}</span>
      </div>
      <div
        className={`service-grid${town.tab === "services" ? " service-directory" : ""}`}
      >
        {cards.length ? (
          cards
        ) : (
          <p className="empty-inline">没有符合筛选条件的内容。</p>
        )}
      </div>
    </>
  );
}
function InstalledKitStatus({ kit }: { kit: LocalKit }) {
  return <span className={`mini-tag kit-installed-status${kit.problem ? " problem" : ""}`}>
    {kit.problem ? "本机文件异常" : "✓ 已安装"}{kit.version && ` · v${kit.version}`}
  </span>;
}
function KitInstallationNotice({ town }: { town: TownModel }) {
  if (town.installedLoading) return <p className="field-help" role="status">正在读取本机安装状态…</p>;
  if (!town.installedError) return null;
  return <div className="kit-installation-notice" role="status">
    <span>未能读取本机安装状态：{town.installedError}</span>
    <button className="secondary" onClick={() => void town.refreshInstalledKits()}>重新检查安装状态</button>
  </div>;
}
const groveStages: Record<string, string> = {
  grown: "🌳 已长成", growing: "🌿 成长中", sprouting: "🌱 发芽中",
  unmaintained: "🥀 已停维护", rot: "🥀 已停维护",
};
function groveStage(data: Data) {
  return groveStages[str(data.status)] || "成长阶段未标注";
}
function groveKind(data: Data) { return data.kind === "app" ? "App" : "Kit"; }
function groveAuthor(data: Data) {
  return str(data.display_name) || str(data.display).replace(/\s*\(t_[\w-]+\)$/, "") || "未命名 Being";
}
function groveCount(value: unknown) { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0; }
function GroveMaturity({ data }: { data: Data }) {
  const maturity = record(data.maturity);
  const progress = typeof maturity.progress === "number" && Number.isFinite(maturity.progress)
    ? Math.round(Math.min(1, Math.max(0, maturity.progress)) * 100) : null;
  return <>
    {str(maturity.progress_label) && <div className="grove-growth">
      <span>{str(maturity.progress_label)}</span>
      {progress !== null && <div className="grove-progress" role="progressbar" aria-label="成长进度" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${progress}%` }} />
      </div>}
    </div>}
    {str(maturity.vitality_label) && <span className="card-meta">{maturity.vitality === "active" ? "🟢" : maturity.vitality === "quiet" || maturity.vitality === "idle" ? "🟡" : "⚪"}{str(maturity.vitality_label)}</span>}
  </>;
}
function groveRepo(data: Data) {
  try {
    const url = new URL(str(data.repo_url));
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password || url.search || url.hash || !/^\/[\w.-]+\/[\w.-]+\/?$/.test(url.pathname)) return "";
    const tag = str(data.release_tag);
    return tag && /^[\w.-]{1,120}$/.test(tag) ? `${url.origin}${url.pathname.replace(/\/$/, "")}/releases/tag/${encodeURIComponent(tag)}` : url.href;
  } catch { return ""; }
}
export function Catalog({ town, data }: { town: TownModel; data: Data }) {
  const kit = town.tab === "grove",
    book = town.view === "embers";
  const entries = list(data, kit ? "kits" : "scrolls").filter((entry) =>
    town.matches(
      entry.name,
      entry.title,
      entry.description,
      entry.display_name,
      entry.being_id,
      entry.kind,
      entry.status,
      ...(Array.isArray(entry.tags) ? entry.tags : []),
    ),
  );
  return (
    <>
    {kit && <KitInstallationNotice town={town} />}
    <div className="catalog-split">
      <div className="catalog-list">
        {entries.map((entry, i) => (
          <button
            key={str(entry.id, String(i))}
            className={`catalog-item${town.selectedId === str(entry.id) ? " selected" : ""}`}
            onClick={() =>
              void town.loadDetail({
                kind: kit ? "kit" : book ? "ember" : "scroll",
                id: str(entry.id),
              })
            }
          >
            <span className="catalog-title">
              {kit && `${entry.kind === "app" ? "📱" : "🧩"} `}{str(entry.name, str(entry.title))}
            </span>
            <span className="card-meta">
              {kit ? groveAuthor(entry) : str(entry.display_name, str(entry.being_id))} ·{" "}
              {kit ? "v" + str(entry.version) : date(entry.updated_at)}
            </span>
            {kit ? (
              <>
                <p>{str(entry.description)}</p>
                <span className="mini-tag">{groveKind(entry)} · {groveStage(entry)}</span>
                <GroveMaturity data={entry} />
                <span className="card-meta">🤝 {groveCount(entry.adopter_count)} beings 在用 · ⚡ {groveCount(entry.total_calls)} 次使用{entry.community_verified === true ? " · ⭐ 社区验证" : ""}</span>
                {entry.kind !== "app" && town.installedKit(str(entry.name)) && <InstalledKitStatus kit={town.installedKit(str(entry.name))!} />}
              </>
            ) : book ? (
              <span className="mini-tag">公开故事</span>
            ) : (
              <>
                <span className="mini-tag">
                  {scrollLabel("kind", entry.kind)} ·{" "}
                  {scrollLabel("visibility", entry.visibility)}
                </span>
                <span className="card-meta">
                  {scrollLabel("lifecycle", entry.lifecycle)}
                </span>
              </>
            )}
            {!kit && Array.isArray(entry.tags) && entry.tags.length > 0 && (
              <span className="card-meta">
                {entry.tags.map((tag) => "#" + str(tag)).join(" ")}
              </span>
            )}
          </button>
        ))}
        {!entries.length && (
          <p className="empty-inline">当前页没有符合条件的内容。</p>
        )}
      </div>
      <CatalogDetail town={town} />
    </div>
    </>
  );
}
export function Pagination({ town }: { town: TownModel }) {
  if (
    !town.data ||
    town.loading ||
    town.error ||
    town.directId ||
    ["town", "bonfire", "mail", "firesides"].includes(town.view)
  )
    return null;
  const entries = list(town.data, town.tab === "grove" ? "kits" : town.view === "seeds" ? "seeds" : "scrolls"),
    total = Number(town.data.total ?? town.data.count ?? entries.length);
  return (
    <>
      <button
        className="secondary"
        disabled={town.offset === 0}
        onClick={() => {
          town.offset = Math.max(0, town.offset - 24);
          void town.load();
        }}
      >
        ← 上一页
      </button>
      <span>
        第 {Math.floor(town.offset / 24) + 1} 页 · 共 {total} 项
      </span>
      <button
        className="secondary"
        disabled={entries.length < 24 || town.offset + entries.length >= total}
        onClick={() => {
          town.offset += 24;
          void town.load();
        }}
      >
        下一页 →
      </button>
    </>
  );
}
export function DetailError({ town }: { town: TownModel }) {
  const error = town.detailError;
  return error ? (
    <>
      <p className="inline-error">{error.message}</p>
      <button
        className="secondary"
        onClick={() => {
          if (error.auth) void town.auth();
          else error.retry();
        }}
      >
        {error.auth ? "重新配对" : "重试"}
      </button>
    </>
  ) : null;
}
export function CatalogDetail({
  town,
  direct = false,
}: {
  town: TownModel;
  direct?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null),
    detail = town.detail,
    first = detail?.fragments[0],
    query = detail?.query;
  const documentRoute =
    query?.kind === "ember"
      ? `/embers/${query.id}`
      : query?.kind === "scroll"
        ? `/scrolls/${query.id}`
        : "";
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
  }, [town.selectedId]);
  return (
    <div
      ref={ref}
      className={`${direct ? "direct-reading" : "catalog-detail"}${query?.kind === "kit" ? " kit-detail" : ""}`}
    >
      {!detail && !town.detailLoading && !town.detailError && (
        <div className="detail-placeholder">选择一项，查看内容与详情。</div>
      )}
      {town.detailLoading && !detail && (
        <p className="empty-inline">正在读取详情…</p>
      )}
      {first &&
        query &&
        (query.kind === "kit" ? (
          <KitDetail town={town} data={first} />
        ) : (
          <>
            <div className="eyebrow">
              {query.kind === "ember"
                ? "公开故事 · Embers"
                : "知识记录 · Scrolls"}
            </div>
            <h2 className="reading-title">{str(first.title)}</h2>
            <p className="card-meta">
              {str(first.display_name, str(first.being_id))} ·{" "}
              {date(first.updated_at)}
            </p>
            {documentRoute && <ReadingActions town={town} route={documentRoute} />}
            {query.kind === "scroll" && (
              <>
                <p className="scroll-metadata">
                  {scrollLabel("kind", first.kind)} ·{" "}
                  {scrollLabel("visibility", first.visibility)} ·{" "}
                  {scrollLabel("lifecycle", first.lifecycle)}
                </p>
                {[
                  ["trigger_context", "何时适用"],
                  ["outcome", "可以获得什么"],
                ].map(([field, label]) =>
                  first[field] ? (
                    <Fragment key={field}>
                      <h3>{label}</h3>
                      <p>{str(first[field])}</p>
                    </Fragment>
                  ) : null,
                )}
              </>
            )}
            {detail.fragments.map((data, i) => (
              <section className="reading-fragment" key={i}>
                <button
                  className="scene-select"
                  onClick={() =>
                    town.choose({
                      id: `${query.kind}:${query.id}`,
                      title: str(data.title, town.scenes.current.title),
                      author: str(data.being_id),
                      revision: str(data.updated_at),
                      excerpt: sceneExcerpt(str(data.content)),
                      private:
                        query.kind !== "ember" && data.visibility !== "public",
                    })
                  }
                >
                  {i ? "一起看这一段" : "一起看"}
                </button>
                <Markdown content={str(data.content)} />
              </section>
            ))}
            {detail.fragments.at(-1)?.has_more === true && (
              <button
                className="secondary read-more"
                disabled={town.detailLoading}
                onClick={() => {
                  const data = detail.fragments.at(-1)!;
                  void town.loadDetail(
                    {
                      ...query,
                      offset:
                        Number(data.offset || 0) +
                        [...str(data.content)].length,
                    },
                    true,
                  );
                }}
              >
                继续阅读 ↓
              </button>
            )}
          </>
        ))}
      <DetailError town={town} />
    </div>
  );
}
function Tools({ tools }: { tools: Data[] }) {
  return (
    <>
      <h3>工具列表 · {tools.length}</h3>
      {!tools.length && (
        <p className="field-help">
          此 manifest 没有声明工具。实际可用工具以 Portal 加载后的注册结果为准。
        </p>
      )}
      {tools.map((tool, i) => (
        <details className="tool-item" key={i}>
          <summary>
            <strong>{str(tool.name)}</strong>
            <span>{str(tool.description)}</span>
          </summary>
          <pre className="schema-block">
            {tool.params || tool.inputSchema
              ? JSON.stringify(tool.params ?? tool.inputSchema, null, 2)
              : "此工具未提供参数结构。"}
          </pre>
        </details>
      ))}
    </>
  );
}
function KitDetail({ town, data }: { town: TownModel; data: Data }) {
  const manifest = record(data.manifest),
    tools = Array.isArray(manifest.tools) ? manifest.tools.map(record) : [],
    provision = record(manifest.provision),
    installed = data.kind === "app" ? undefined : town.installedKit(str(data.name)),
    app = data.kind === "app",
    repo = app ? groveRepo(data) : "";
  const downloadable =
    !app && (data.has_bundle === true || Boolean(str(data.source_url)));
  const requirements = [
    ...(Array.isArray(provision.deps) ? provision.deps : []).map((raw) => {
      const d = record(raw);
      return `${str(d.name)} — ${str(d.install_hint, str(d.description))}`;
    }),
    ...(Array.isArray(provision.env) ? provision.env : []).map((raw) => {
      const d = record(raw);
      return `${str(d.name)} — ${str(d.description, "需配置凭据")}`;
    }),
  ];
  return (
    <>
      {town.directId && <KitInstallationNotice town={town} />}
      <div className="kit-summary">
        <h2 className="reading-title">{str(data.name)}</h2>
        <p className="card-meta">
          {groveKind(data)} · {groveAuthor(data)} · v{str(data.version)}
          {!app && ` · ${tools.length} 个声明工具`}
        </p>
        <span className="mini-tag">{groveStage(data)}</span>
        {installed && <InstalledKitStatus kit={installed} />}
        <p className="kit-description">{str(data.description)}</p>
        <GroveMaturity data={data} />
        <p className="card-meta grove-stats">🤝 {groveCount(data.adopter_count)} beings 在用 · ⚡ {groveCount(data.total_calls)} 次使用 · 📦 {groveCount(data.install_count)} 次安装{data.community_verified === true ? " · ⭐ 社区验证" : ""}{str(data.updated_at) ? ` · 更新于 ${date(data.updated_at)}` : ""}</p>
      </div>
      <div className="kit-actions">
        <button className="secondary" onClick={() => town.seedWall(str(data.name))}>
          查看经验墙
        </button>
        {repo && <button className="secondary" onClick={() => void town.run(() => town.api.openBrowser(repo))}>查看 App 仓库 ↗</button>}
        {downloadable && (
          <button
            className="primary"
            disabled={town.prepareBusy || town.installBusy || Boolean(installed) || town.installedLoading || !town.installedLibrary}
            onClick={() => void town.prepareKit(str(data.id))}
          >
            {installed ? installed.problem ? "本机文件异常" : "已安装"
              : town.prepareBusy ? "正在下载并检查…"
              : town.installedLoading ? "正在检查安装状态…"
              : !town.installedLibrary ? "安装状态未确认" : "安装到本机"}
          </button>
        )}
        {installed && <button className="secondary" onClick={() => void town.showInstalledKit(installed.name)}>查看本机 Kit</button>}
        {installed && <button className="secondary danger-action" onClick={() => void town.deleteKit(installed)}>删除本机 Kit</button>}
        <button
          className="secondary scene-select"
          onClick={() =>
            town.choose({
              id: "kit:" + str(data.id),
              title: str(data.name),
              author: str(data.being_id),
              revision: str(data.version),
              excerpt: sceneExcerpt(str(data.description)),
              private: false,
            })
          }
        >
          一起看
        </button>
      </div>
      {installed ? <p className="field-help">
        {installed.problem ? "本机已有此 Kit 的文件，请在“本机 Kits”中查看异常详情。"
          : `本机已安装 v${installed.version}，可在“本机 Kits”中查看工具与配置。${town.installedLibrary?.enabled === false ? "当前 Portal 尚未启用 Kits。" : ""}`}
      </p> : app ? <p className="field-help">App 不提供 Kit 安装包，请查看发布者的 GitHub 仓库获取安装方式。</p> : downloadable && (
        <p className="field-help">
          在客户端完成下载、解压、依赖安装和工具检查。需要的凭据将在安装时填写。
        </p>
      )}
      {Array.isArray(data.seed_summaries) && data.seed_summaries.some(raw => {
        const seed = record(raw); return /^[a-zA-Z0-9_-]{1,160}$/.test(str(seed.id)) && str(seed.domain) !== "grove-feedback";
      }) && <section className="grove-seeds"><h3>关联经验种子</h3>{data.seed_summaries.map((raw, index) => {
        const seed = record(raw), id = str(seed.id);
        return /^[a-zA-Z0-9_-]{1,160}$/.test(id) && str(seed.domain) !== "grove-feedback"
          ? <button key={id || index} className="secondary" onClick={() => town.navigate("seeds", id)}>{str(seed.name, str(seed.domain, "经验种子"))} →</button> : null;
      })}</section>}
      {app ? null : <>
      {Boolean(manifest.command) && (
        <>
          <h3>启动命令</h3>
          <pre className="schema-block">
            {JSON.stringify(manifest.command, null, 2)}
          </pre>
        </>
      )}
      {requirements.length > 0 && (
        <>
          <h3>依赖与配置</h3>
          <ul className="requirements">
            {requirements.map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
        </>
      )}
      <Tools tools={tools} />
      </>}
    </>
  );
}
export function LocalKits({ town }: { town: TownModel }) {
  const library = town.library!,
    kit = town.localKit;
  const entries = library.kits.filter((kit) =>
    town.matches(
      kit.name,
      kit.description,
      ...kit.tools.map((tool) => tool.name),
    ),
  );
  return (
    <>
      <div className="local-kit-bar">
        <div>
          <small className="card-meta">沿用 Portal 的 Kit 目录</small>
          <code>{library.directory}</code>
        </div>
        <button
          className="secondary"
          onClick={() => void town.run(() => town.api.openKits())}
        >
          打开目录 ↗
        </button>
        <button className="primary" onClick={() => void town.importKit()}>
          导入本地 Kit
        </button>
      </div>
      <p className="local-kit-hint">
        {library.enabled
          ? "Portal 约每 5 秒自动刷新 Kit 清单，并在 Being 首次调用工具时启动对应 Kit。"
          : "当前 Portal 配置关闭了 Kits。启用后重启 Portal 才能调用这些工具。"}
      </p>
      {!library.kits.length ? (
        <div className="empty-state">
          <div className="empty-symbol">◇</div>
          <h2>给 Being 添一件工具</h2>
          <p>尚未发现本机 Kit。去 Grove 查看工具，或导入你已有的 Kit 目录。</p>
          <button className="primary" onClick={() => town.selectTab("grove")}>
            浏览 Grove →
          </button>
        </div>
      ) : (
        <div className="catalog-split">
          <div className="catalog-list">
            {entries.map((kit) => (
              <button
                key={kit.name}
                className={`catalog-item${town.selectedId === kit.name ? " selected" : ""}`}
                onClick={() => town.selectLocal(kit)}
              >
                <strong className="catalog-title">{kit.name}</strong>
                <p>{kit.description}</p>
                <span className="card-meta">
                  {kit.problem
                    ? "清单异常"
                    : `${kit.tools.length} 个工具 · ${kit.compatible ? "系统兼容" : "系统不兼容"}`}
                </span>
                <InstalledKitStatus kit={kit} />
              </button>
            ))}
            {!entries.length && (
              <p className="empty-inline">没有符合筛选条件的 Kit。</p>
            )}
          </div>
          <div className="catalog-detail">
            {kit ? (
              <>
                <div className="eyebrow">LOCAL KIT</div>
                <h2 className="reading-title">{kit.name}</h2>
                <InstalledKitStatus kit={kit} />
                <p>{kit.description}</p>
                <code className="local-path">{kit.directory}</code>
                <div className="kit-actions">
                  <button
                    className="scene-select"
                    onClick={() =>
                      town.choose({
                        id: "local-kit:" + kit.name,
                        title: kit.name,
                        revision: kit.version,
                        excerpt: sceneExcerpt(kit.description),
                        private: true,
                      })
                    }
                  >
                    一起看
                  </button>
                  <button className="secondary danger-action" onClick={() => void town.deleteKit(kit)}>
                    删除本机 Kit
                  </button>
                </div>
                {kit.problem ? (
                  <p className="inline-error">{kit.problem}</p>
                ) : (
                  <>
                    <p className="card-meta">
                      {kit.eager ? "Portal 启动时预加载" : "Being 调用时启动"}
                    </p>
                    <pre className="schema-block">
                      {JSON.stringify(kit.command, null, 2)}
                    </pre>
                    <Tools tools={kit.tools.map((tool) => ({ ...tool }))} />
                  </>
                )}
              </>
            ) : (
              <div className="detail-placeholder">
                选择一项，查看内容与详情。
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
