import { useCallback, useEffect, useRef, useState } from "react";
import type { DiagnosticReport } from "../../../shared/types";
import type { AppModel } from "../models/app";
import { useModel } from "../../shared/hooks/use-model";
import { Dialog } from "../../shared/components/dialog";
import { NavigationControls } from "../../shared/components/navigation-controls";
export function Diagnostics({ model }: { model: AppModel }) {
  const app = useModel(model),
    [state, setState] = useState<DiagnosticReport>(),
    [busy, setBusy] = useState(false),
    [exporting, setExporting] = useState(false),
    [error, setError] = useState("");
  const revision = useRef(0);
  const run = useCallback(async () => {
    const request = ++revision.current;
    setBusy(true);
    setError("");
    try {
      const report = await app.api.diagnostics();
      if (request === revision.current) setState(report);
    } catch (error) {
      if (request === revision.current) {
        setError("检查未完成，请重试。");
        app.toast(error);
      }
    } finally {
      if (request === revision.current) setBusy(false);
    }
  }, [app]);
  useEffect(() => {
    if (app.diagnosticsOpen) void run();
    return () => {
      ++revision.current;
    };
  }, [app.diagnosticsOpen, run]);
  return (
    <Dialog
      id="diagnostics-dialog"
      className="utility-dialog"
      aria-labelledby="diagnostics-heading"
      open={app.diagnosticsOpen}
      onClose={() => {
        app.diagnosticsOpen = false;
        app.dismissSettingsRoute();
        app.changed();
      }}
    >
      <div className="dialog-heading">
        <div className="dialog-heading-main">
          <h2 id="diagnostics-heading">连接诊断</h2>
          <NavigationControls back={app.settingsRoute === "diagnostics" ? app.returnToClientSettings : undefined} />
        </div>
        <button
          id="diagnostics-close"
          className="close"
          aria-label="关闭诊断"
          onClick={() => {
            app.diagnosticsOpen = false;
            app.dismissSettingsRoute();
            app.changed();
          }}
        />
      </div>
      <p id="diagnostics-version" className="utility-subtitle">
        {state
          ? `Portal Desktop ${state.version} · ${state.platform}\n构建 ${state.build}\n主进程 ${state.pid} · 启动 ${new Date(state.startedAt).toLocaleString()}`
          : ""}
      </p>
      <div id="diagnostics-checks" aria-live="polite">
        {busy
          ? "正在检查连接与本机状态…"
          : error ||
            state?.checks.map((check, i) => (
              <div
                className="diagnostic-row"
                data-status={check.status}
                key={i}
              >
                <strong>
                  {check.status === "ok"
                    ? "✓"
                    : check.status === "error"
                      ? "×"
                      : "·"}{" "}
                  {check.name}
                </strong>
                <span>{check.detail}</span>
              </div>
            ))}
      </div>
      <div className="files-footer">
        <button
          id="diagnostics-refresh"
          disabled={busy}
          onClick={() => void run()}
        >
          重新检查
        </button>
        <button
          id="diagnostics-export"
          disabled={exporting}
          onClick={() => {
            setExporting(true);
            void app.run(async () => {
              try {
                if (await app.api.exportDiagnostics())
                  app.toast("已导出诊断，不含聊天内容或连接凭据。");
              } finally {
                setExporting(false);
              }
            });
          }}
        >
          导出诊断…
        </button>
      </div>
    </Dialog>
  );
}
