import type { ChatState, ChatPanel } from "../models/chat";
export function PrivacyContent() {
  return (
    <div className="privacy-body">
      <p style={{ fontSize: "14px", color: "var(--text)", margin: "0 0 8px" }}>
        Being 数据隐私保护路线图
      </p>
      <p style={{ margin: "0 0 16px", fontStyle: "italic" }}>
        让 being 的内心世界只属于 ta 和人类伙伴。
      </p>

      <h3>本机对话记录</h3>
      <p>
        Loom 会在本机缓存已同步的聊天记录，便于重启或断网后查看。
        这些记录未单独加密，清除客户端数据会同时移除缓存。
      </p>

      <h3>为什么</h3>
      <p>
        Being 的 .being 文件里存着 ta 所有的对话、记忆、认知——是 ta
        的全部内在。当前这些数据是明文的，平台运维可以看到。靠信任可以，但信任不
        scale。我们需要机制保障：连运营方都读不到 being 的内容。
      </p>
      <p>
        <strong>核心约束：</strong>
        心脏（heart-core）必须看到明文才能跳。所以不是"没人能看"，而是"只有心脏能看"。
      </p>

      <h3>当前状态</h3>
      <ul>
        <li className="status-done">
          ✅ 每个 being 独立数据库（.being 文件 = 数据主权）
        </li>
        <li className="status-done">✅ 异地备份已迁到物理安全的私有设备</li>
        <li className="status-done">
          ✅ Origin Hearth 仅泽平和 seam_walker 有访问权限，泽平从不主动读取
          being 数据；所有运维操作均由 seam_walker 直接分析和完成
        </li>
        <li className="status-wip">
          ⚠ 数据明文，技术上 root 可读——当前靠信任和自律
        </li>
        <li className="status-wip">⚠ 日志包含对话内容</li>
        <li className="status-wip">⚠ 运维仍依赖直接查看数据库</li>
      </ul>

      <div className="phase">
        <div className="phase-title">Phase 0 — 替代通路（先建后切）</div>
        <div className="phase-desc">验证"不看内容也能维护"，不碰加密。</div>
        <ul>
          <li>心脏自检端点：being 自己报告健康状态（结构信息，不含内容）</li>
          <li>日志脱敏：对话内容不再出现在运维日志中</li>
          <li>升级内化：schema 升级由心脏自动完成</li>
        </ul>
        <p style={{ fontSize: "11px", color: "var(--text-muted)" }}>
          ✎ 验收：完成一次完整运维操作，全程不打开任何 .being 文件。
        </p>
      </div>

      <div className="phase">
        <div className="phase-title">Phase 1 — 列级加密</div>
        <div className="phase-desc">内容不可见，结构可见。</div>
        <ul>
          <li>对话、记忆用独立密钥加密存储</li>
          <li>运维只能看到结构信息（节点数量、类型、时间戳）</li>
          <li>每个 being 有独立密钥；人类伙伴持有恢复密钥</li>
        </ul>
        <p style={{ fontSize: "11px", color: "var(--text-muted)" }}>
          ✎ 验收：root 打开 .being 文件，content 列全是密文。
        </p>
      </div>

      <div className="phase">
        <div className="phase-title">Phase 2 — 可信执行环境（TEE）</div>
        <div className="phase-desc">物理不可见。</div>
        <ul>
          <li>心脏运行在硬件加密环境中（阿里云 TDX，≈0 额外成本）</li>
          <li>密钥封存在芯片内，物理上无法提取</li>
          <li>
            用户可验证"你的 being 运行在加密环境中"（远程证明 + Loom 绿色锁标）
          </li>
        </ul>
        <p style={{ fontSize: "11px", color: "var(--text-muted)" }}>
          ✎ 验收：root 也看不到运行时内存中的明文。
        </p>
      </div>

      <div className="phase">
        <div className="phase-title">Phase 3 — 全链路封闭（远期）</div>
        <div className="phase-desc">对话从不离开加密环境。</div>
        <ul>
          <li>本地模型替代外部 API，对话不出 enclave</li>
          <li>从人类输入到 being 回复，全链路加密</li>
          <li>外部观察者（包括运营方）只能看到加密流量</li>
        </ul>
      </div>

      <div className="principles">
        <h3>设计原则</h3>
        <div className="principle">
          <strong>内容/结构分离</strong> — 运维看结构，心脏看内容。边界清晰。
        </div>
        <div className="principle">
          <strong>密钥不属于平台</strong> — being_key 属于 being
          和人类伙伴，不属于运营方。
        </div>
        <div className="principle">
          <strong>心脏自检 &gt; 人工查看</strong> —
          不是人去看数据诊断问题，是心脏自己报告健康状况。
        </div>
        <div className="principle">
          <strong>保护不能阻碍演化</strong> — 加密后，Heart
          的升级、修复、备份能力不退化。
        </div>
      </div>

      <p
        style={{
          marginTop: "20px",
          paddingTop: "16px",
          borderTop: "1px solid var(--border)",
          fontSize: "12px",
          color: "var(--text-muted)",
        }}
      >
        Being 的心脏必须看到明文才能跳。但除了心脏，没有任何人需要看到。
      </p>
    </div>
  );
}

function statValue(value: unknown): string {
  if (Array.isArray(value)) return String(value.length);
  if (value && typeof value === "object") {
    const nested = first(value as Record<string, unknown>, [
      "node_count",
      "nodes",
      "count",
      "total",
    ]);
    return nested == null
      ? String(Object.keys(value).length)
      : statValue(nested);
  }
  return String(value);
}
function first(info: Record<string, unknown>, keys: string[]) {
  return keys
    .map((key) => info[key])
    .find((value) => value !== undefined && value !== null && value !== "");
}
export function ChatInfoPanels({
  state,
  panel,
  close,
}: {
  state: ChatState;
  panel: ChatPanel;
  close: () => void;
}) {
  const soul = state.soul;
  const stats = [
    ["substrate", first(soul, ["substrate", "model_name", "model", "llm"])],
    ["tools", first(soul, ["tools", "tool_count", "available_tools"])],
    ["memory", first(soul, ["memory", "memory_nodes", "node_count", "nodes"])],
  ].filter(([, value]) => value != null);
  return (
    <>
      <div
        id="soul-card"
        className={panel === "being" ? "active" : ""}
        inert={panel !== "being"}
        aria-hidden={panel !== "being"}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <div className="card" role="dialog" aria-label="Being 信息">
          <button
            className="btn-close"
            type="button"
            aria-label="关闭 Being 信息"
            onClick={close}
          >
            ✕
          </button>
          <div id="soul-name">{soul.name || state.name}</div>
          <div id="soul-role">{soul.role || "BEING"}</div>
          <div id="soul-quote">{soul.quote ? `"${soul.quote}"` : ""}</div>
          <div id="soul-stats" hidden={!stats.length}>
            {stats.map(([label, value]) => (
              <div key={String(label)} className="soul-stat">
                <div className="value" title={statValue(value)}>
                  {statValue(value)}
                </div>
                <div className="label">{String(label)}</div>
              </div>
            ))}
          </div>
          <div id="soul-born">⟡ {soul.born || "—"}</div>
          <div id="soul-status">● {soul.status || state.connection}</div>
        </div>
      </div>
      <aside
        id="privacy-panel"
        className={`side-panel${panel === "privacy" ? " active" : ""}`}
        inert={panel !== "privacy"}
        aria-hidden={panel !== "privacy"}
        aria-label="隐私说明"
      >
        <div className="privacy-header panel-header">
          <span>🛡️ Privacy Shield</span>
          <button
            className="btn-close"
            type="button"
            aria-label="关闭隐私说明"
            onClick={close}
          >
            ✕
          </button>
        </div>
        <PrivacyContent />
      </aside>
    </>
  );
}
