import { useLayoutEffect, useRef } from "react";
import { useModel } from "../shared/hooks/use-model";
import type { AppModel } from "../app/models/app";
const labels = {
  running: "运行中",
  stopped: "未启动",
  starting: "启动中",
  connected: "已连接",
  reconnecting: "重连中",
  stopping: "停止中",
  external: "实例冲突",
  error: "启动失败",
};
export function Portal({ model }: { model: AppModel }) {
  const app = useModel(model),
    snapshot = app.snapshot,
    state = snapshot?.portal;
  const log = useRef<HTMLPreElement>(null),
    atBottom = useRef(true);
  useLayoutEffect(() => {
    if (atBottom.current && log.current)
      log.current.scrollTop = log.current.scrollHeight;
  }, [state?.logs]);
  const stopped =
    !state || ["stopped", "error", "external"].includes(state.phase);
  return (
    <section id="portal-view" className="view" hidden={app.view !== "portal"}>
      <div className="portal-content">
        <div className="section-heading">
          <div>
            <h1>Portal 设置</h1>
            <p>连接这台电脑，供 Being 使用文件、命令和工具。</p>
          </div>
        </div>
        <div className="portal-card">
          <div className="portal-card-top">
            <span className="portal-symbol">⌘</span>
            <div>
              <h2 id="portal-name">
                {snapshot?.settings.portalName || "Heart Portal"}
              </h2>
              <span id="portal-message">
                {state?.message || "本机 Portal 尚未启动"}
              </span>
            </div>
            <span className="status-pill" id="portal-phase">
              {state ? labels[state.phase] : "未启动"}
            </span>
          </div>
          <div className="portal-details">
            <div>
              <small>工作目录</small>
              <span id="workspace-label">
                {snapshot?.settings.workspace || "—"}
              </span>
            </div>
            <div>
              <small>运行进程</small>
              <span id="portal-pid" title={state?.runtimePath || ""}>
                {state?.pid
                  ? `PID ${state.pid}${state.managed === false ? " · 外部管理" : ""}`
                  : "—"}
              </span>
            </div>
          </div>
          <div className="portal-actions">
            <button
              className="primary"
              id="start-portal"
              disabled={
                Boolean(app.portalAction) ||
                !snapshot?.settings.hasToken ||
                (!stopped && state?.managed !== false)
              }
              onClick={() => void app.changePortal("start")}
            >
              {app.portalAction === "start"
                ? "正在启动…"
                : state?.managed === false
                  ? "使用客户端 Portal"
                  : "启动 Portal"}
            </button>
            <button
              className="secondary"
              id="stop-portal"
              disabled={
                Boolean(app.portalAction) ||
                (stopped && !snapshot?.background?.enabled) ||
                state?.phase === "stopping" ||
                state?.managed === false
              }
              onClick={() => void app.changePortal("stop")}
            >
              {app.portalAction === "stop" ? "正在停止…" : "停止"}
            </button>
            <button
              className="secondary"
              id="restart-portal"
              disabled={Boolean(app.portalAction) || !snapshot?.settings.hasToken ||
                !state || state.phase === "stopped" || state.phase === "stopping" || state.managed === false}
              onClick={() => void app.changePortal("restart")}
              title="重启客户端管理的引擎并重建连接，会中断当前工具任务"
            >
              {app.portalAction === "restart" ? "正在重启…" : "重启 Portal"}
            </button>
            <button
              className="text-button"
              id="portal-settings"
              onClick={() => app.showSettings()}
            >
              本机设置 ↗
            </button>
          </div>
          <p
            id="portal-action-error"
            className="form-error"
            role="alert"
            hidden={!app.portalError}
          >
            {app.portalError}
          </p>
        </div>
        <div className="capabilities">
          <div>
            <span>▱</span>
            <strong>文件与搜索</strong>
            <small>读写选定的工作目录</small>
          </div>
          <div>
            <span>⌘</span>
            <strong>命令执行</strong>
            <small id="exec-label">
              {snapshot?.settings.allowExec ? "已允许本机命令" : "未启用"}
            </small>
          </div>
          <div>
            <span>◇</span>
            <strong>扩展工具</strong>
            <small id="kits-label">
              {snapshot?.settings.kitsEnabled
                ? "Kits 与自定义工具已启用"
                : "未启用"}
            </small>
          </div>
        </div>
        <div className="log-heading">
          <h2>运行日志</h2>
          <div className="portal-actions">
            <button type="button" onClick={() => void app.run(() => app.api.openLogs())}>打开日志文件夹</button>
            <button type="button" disabled={app.logsLoading || !snapshot?.settings.hasToken}
              onClick={() => void app.sharePortalLogs()}>{app.logsLoading ? "正在读取…" : "一起看日志"}</button>
          </div>
        </div>
        <details>
          <summary>查看最近运行日志 · 凭据已脱敏</summary>
        <pre
          ref={log}
          id="portal-logs"
          role="log"
          aria-label="Portal 运行日志"
          onScroll={(event) => {
            const node = event.currentTarget;
            atBottom.current =
              node.scrollTop + node.clientHeight >= node.scrollHeight - 32;
          }}
        >
          {state?.logs.join("\n") ||
            "启动 Portal 后，连接与工具运行状态会显示在这里。"}
        </pre>
        </details>
        <p className="portal-foot" id="background-status">
          {state?.managed === false
            ? "客户端 Portal 尚未启动；请处理上方错误后重试。"
            : snapshot?.background?.enabled
              ? `${snapshot.background.message}。点击“停止”会同时停用登录自启。`
              : "后台常驻与登录自启未开启；退出客户端时 Portal 会停止。"}
        </p>
      </div>
    </section>
  );
}
