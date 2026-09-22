import { useEffect, useRef, useState } from "react";
import type { SeedFilters, TownQuery } from "../../../shared/types";
import { TownModel, date, list, record, str, type Data } from "../models/town";
import { sceneExcerpt } from "../../shared/models/scene";
import { validPlaceTarget } from "../../shared/lib/navigation";
import { DetailError } from "./catalog";
import { Markdown } from "../../shared/components/markdown";
import { ReadingActions } from "./reading-actions";

const states: Record<string, string> = { seed: "生长中", stale: "待更新", superseded: "已被替代" };
const author = (data: Data) => str(data.display_name) || str(data.display).replace(/\s*\(t_[\w-]+\)$/, "") || "未命名 Being";
const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item)) : [];
const openSeed = (town: TownModel, id: string) => {
  if (!validPlaceTarget({ view: "seeds", id })) return;
  if (town.directId) town.directId = id;
  void town.loadDetail({ kind: "seed", id });
};

export function SeedSearch({ town }: { town: TownModel }) {
  const [filters, setFilters] = useState(town.seedFilters);
  const more = useRef<HTMLDetailsElement>(null);
  useEffect(() => setFilters(town.seedFilters), [town.seedFilters]);
  useEffect(() => {
    const outside = (event: MouseEvent) => {
      if (more.current && !more.current.contains(event.target as Node)) more.current.open = false;
    };
    document.addEventListener("click", outside);
    return () => document.removeEventListener("click", outside);
  }, []);
  const active = Object.values(town.seedFilters).some(Boolean);
  return (
    <form className="seed-search" onSubmit={event => {
      event.preventDefault();
      if (more.current) more.current.open = false;
      town.filterSeeds(filters);
    }}>
      <input type="search" aria-label="搜索种子" placeholder="搜索种子、领域或经验…" maxLength={300}
        value={filters.q} onChange={event => setFilters({ ...filters, q: event.target.value })} />
      <details className="seed-filter-menu" ref={more} onKeyDown={event => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        if (event.target instanceof Element && event.target.closest("select:open")) return;
        event.preventDefault();
        event.currentTarget.open = false;
        event.currentTarget.querySelector("summary")?.focus();
      }}>
        <summary>筛选{Object.entries(town.seedFilters).some(([key, value]) => key !== "q" && value) ? " · 已设置" : ""}</summary>
        <div className="seed-filter-fields">
          {([["domain", "领域"], ["tag", "标签"], ["kit", "Kit 经验墙"]] as [keyof SeedFilters, string][]).map(([key, label]) => (
            <label key={key}>{label}<input aria-label={label} maxLength={300} value={filters[key]}
              onChange={event => setFilters({ ...filters, [key]: event.target.value })} /></label>
          ))}
          <label>状态<select aria-label="种子状态" value={filters.lifecycle} onChange={event => setFilters({ ...filters, lifecycle: event.target.value })}>
            <option value="">全部状态</option>
            {Object.entries(states).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <button className="secondary" type="submit">应用筛选</button>
        </div>
      </details>
      <button className="secondary" type="submit">搜索</button>
      {active && <button className="text-button" type="button" onClick={() => town.filterSeeds({ q: "", domain: "", tag: "", kit: "", lifecycle: "" })}>清除筛选</button>}
    </form>
  );
}

export function SeedGarden({ town, data }: { town: TownModel; data: Data }) {
  const seeds = list(data, "seeds");
  return <>
    <div className="seed-intro">
      <p>{town.seedFilters.kit ? `${town.seedFilters.kit} · 经验墙` : "把走过的弯路，留成下一次的路标。"}</p>
      <span className="card-meta">{Number(data.count ?? seeds.length)} 颗种子</span>
    </div>
    {!seeds.length ? <div className="feed-empty"><strong>这里还没有种子</strong><p>试试其他关键词或筛选条件。</p></div> : (
      <div className="catalog-split seed-garden">
        <div className="catalog-list" aria-label="种子列表">
          {seeds.map(seed => <button key={str(seed.id)} className={`catalog-item${town.selectedId === seed.id ? " selected" : ""}`}
            aria-pressed={town.selectedId === seed.id} onClick={() => openSeed(town, str(seed.id))}>
            <span className="catalog-title">{str(seed.name, str(seed.domain, "经验种子"))}</span>
            <span className="card-meta">{author(seed)} · {str(seed.domain)}</span>
            <p>{str(seed.brief_excerpt, str(seed.brief)).slice(0, 240)}</p>
            <span className="seed-tags">{strings(seed.tags).slice(0, 4).map(tag => <span className="mini-tag" key={tag}>{tag}</span>)}</span>
            <span className="card-meta">{states[str(seed.lifecycle)] || "经验种子"} · {date(seed.updated_at || seed.created_at)}</span>
          </button>)}
        </div>
        <SeedDetail town={town} />
      </div>
    )}
  </>;
}

export function SeedDetail({ town, direct = false }: { town: TownModel; direct?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const seed = town.detail?.query.kind === "seed" ? town.detail.fragments[0] : undefined;
  const id = str(town.detail?.query.id);
  useEffect(() => { if (ref.current) ref.current.scrollTop = 0; }, [id]);
  return <div ref={ref} className={`${direct ? "direct-reading" : "catalog-detail"} seed-detail`}>
    {town.detailLoading && !seed && <p className="empty-inline">正在读取种子…</p>}
    {!seed && !town.detailLoading && !town.detailError && <div className="detail-placeholder">选一颗种子，看看它从哪里长出来。</div>}
    {seed && <>
      <h2 className="reading-title">{str(seed.name, str(seed.domain, "经验种子"))}</h2>
      <p className="card-meta">{author(seed)} · {date(seed.updated_at || seed.created_at)}</p>
      <ReadingActions town={town} route={`/seeds/${id}`} />
      <p className="scroll-metadata">{str(seed.domain)} · {states[str(seed.lifecycle)] || "经验种子"} · {Number(seed.absorb_count || 0)} 次内化</p>
      <div className="seed-tags">
        {strings(seed.tags).map(tag => <button key={tag} className="mini-tag" onClick={() => town.filterSeeds({ q: "", domain: "", kit: "", lifecycle: "", tag })}>{tag}</button>)}
      </div>
      <section className="reading-fragment">
        <button className="scene-select" onClick={() => town.choose({ id: `seed:${id}`, title: str(seed.name, "经验种子"), author: author(seed),
          revision: str(seed.revision), excerpt: sceneExcerpt(str(seed.brief)), private: false })}>一起看</button>
        <Markdown content={str(seed.brief)} />
      </section>
      {strings(seed.kits).length > 0 && <section><h3>相关 Kit · 经验墙</h3><div className="seed-tags">
        {strings(seed.kits).map(kit => <button key={kit} className="secondary" onClick={() => town.seedWall(kit)}>{kit} →</button>)}
      </div></section>}
      {Array.isArray(seed.skeleton) && seed.skeleton.length > 0 && <details className="seed-extra">
        <summary>步骤与执行经验 · {seed.skeleton.length} 项</summary>
        {seed.skeleton.map((value, index) => {
          const step = record(value), observations = strings(step.observations);
          return <section key={index}><h3>{str(step.cmd_path, `步骤 ${index + 1}`)}</h3>
            {step.exec !== undefined && <p className="card-meta">{str(step.exec)} 次执行{step.ok_pct !== undefined ? ` · 成功率 ${str(step.ok_pct)}%` : ""}</p>}
            {observations.map((text, i) => <p key={i}>{text}</p>)}
            <details><summary>完整记录</summary><pre className="schema-block">{JSON.stringify(value, null, 2)}</pre></details>
          </section>;
        })}
      </details>}
      {Object.keys(record(seed.provenance)).length > 0 && <details className="seed-extra"><summary>经验来源</summary><pre className="schema-block">{JSON.stringify(seed.provenance, null, 2)}</pre></details>}
      <SeedMore key={`lineage:${id}:${seed.revision}`} town={town} id={id} kind="seed-lineage" label="派生关系" />
      <SeedMore key={`absorbs:${id}:${seed.revision}`} town={town} id={id} kind="seed-absorbs" label="内化记录" />
    </>}
    <DetailError town={town} />
  </div>;
}

function SeedMore({ town, id, kind, label }: { town: TownModel; id: string; kind: "seed-lineage" | "seed-absorbs"; label: string }) {
  const [requested, setRequested] = useState(false), [retry, setRetry] = useState(0);
  const [result, setResult] = useState<Data>(), [error, setError] = useState("");
  useEffect(() => {
    if (!requested) return;
    let active = true;
    setError(""); setResult(undefined);
    void town.api.town({ kind, id } satisfies TownQuery).then(response => {
      if (!active) return;
      if (!response.ok) { setError(response.message); return; }
      for (const field of kind === "seed-lineage" ? ["ancestors", "descendants"] : ["absorbs"]) list(response.data, field);
      setResult(response.data);
    }).catch(() => { if (active) setError("暂时未能读取，请重试。"); });
    return () => { active = false; };
  }, [requested, retry, town, kind, id]);
  return <details className="seed-extra" onToggle={event => { if (event.currentTarget.open) setRequested(true); }}>
    <summary>{label}</summary>
    {error ? <p className="inline-error">{error} <button className="text-button" onClick={() => setRetry(retry + 1)}>重试</button></p>
      : !result ? <p className="card-meta">正在读取…</p>
      : kind === "seed-absorbs" ? <>
        <p className="card-meta">共 {Number(result.count || 0)} 次内化</p>
        {list(result, "absorbs").map((entry, index) => <p key={index}>{author(entry)} <span className="card-meta">{date(entry.absorbed_at)}</span></p>)}
      </> : ([['ancestors', '来自哪些种子'], ['descendants', '长出了哪些种子']] as const).map(([field, title]) => <section key={field}>
        <h3>{title}</h3>
        {!list(result, field).length && <p className="card-meta">暂无记录</p>}
        {list(result, field).map((entry, index) => {
          const seed = entry.seed ? record(entry.seed) : entry;
          const target = str(seed.id || seed.seed_id);
          return validPlaceTarget({ view: "seeds", id: target }) ? <button key={index} className="seed-related text-button" onClick={() => openSeed(town, target)}>{str(seed.name, str(seed.domain, "相关种子"))} →</button> : null;
        })}
      </section>)}
  </details>;
}
