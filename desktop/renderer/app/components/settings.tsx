import { useEffect, useState } from "react";
import type { AppModel } from "../models/app";
import { useModel } from "../../shared/hooks/use-model";
import { Dialog } from "../../shared/components/dialog";
export function ClientSettings({ model }: { model: AppModel }) {
  const app = useModel(model);
  const [tab, setTab] = useState("connections");
  useEffect(() => {
    if (app.clientSettingsOpen) setTab("connections");
  }, [app.clientSettingsOpen]);
  return (
    <Dialog
      open={app.clientSettingsOpen}
      onClose={() => {
        app.clientSettingsOpen = false;
        app.changed();
      }}
      id="client-settings-dialog"
      aria-labelledby="client-settings-title"
    >
      <div className="client-settings-content">
        <div className="dialog-heading">
          <h2 id="client-settings-title">设置</h2>
          <button
            type="button"
            id="close-client-settings"
            className="close"
            aria-label="关闭客户端设置"
            onClick={() => {
              app.clientSettingsOpen = false;
              app.changed();
            }}
          ></button>
        </div>
        <div className="settings-tabs" role="tablist" aria-label="设置分类">
          <button
            id="settings-tab-connections"
            role="tab"
            aria-controls="settings-panel-connections"
            aria-selected={tab === "connections"}
            tabIndex={tab === "connections" ? 0 : -1}
            onClick={() => setTab("connections")}
            onKeyDown={(event) => {
              const keys = ["connections", "appearance", "general"];
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? 2
                    : event.key === "ArrowRight"
                      ? (0 + 1) % 3
                      : event.key === "ArrowLeft"
                        ? (0 + 2) % 3
                        : -1;
              if (next < 0) return;
              event.preventDefault();
              setTab(keys[next]);
              (
                event.currentTarget.parentElement?.children[next] as HTMLElement
              )?.focus();
            }}
          >
            连接与 Being
          </button>
          <button
            id="settings-tab-appearance"
            role="tab"
            aria-controls="settings-panel-appearance"
            aria-selected={tab === "appearance"}
            tabIndex={tab === "appearance" ? 0 : -1}
            onClick={() => setTab("appearance")}
            onKeyDown={(event) => {
              const keys = ["connections", "appearance", "general"];
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? 2
                    : event.key === "ArrowRight"
                      ? (1 + 1) % 3
                      : event.key === "ArrowLeft"
                        ? (1 + 2) % 3
                        : -1;
              if (next < 0) return;
              event.preventDefault();
              setTab(keys[next]);
              (
                event.currentTarget.parentElement?.children[next] as HTMLElement
              )?.focus();
            }}
          >
            外观与阅读
          </button>
          <button
            id="settings-tab-general"
            role="tab"
            aria-controls="settings-panel-general"
            aria-selected={tab === "general"}
            tabIndex={tab === "general" ? 0 : -1}
            onClick={() => setTab("general")}
            onKeyDown={(event) => {
              const keys = ["connections", "appearance", "general"];
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? 2
                    : event.key === "ArrowRight"
                      ? (2 + 1) % 3
                      : event.key === "ArrowLeft"
                        ? (2 + 2) % 3
                        : -1;
              if (next < 0) return;
              event.preventDefault();
              setTab(keys[next]);
              (
                event.currentTarget.parentElement?.children[next] as HTMLElement
              )?.focus();
            }}
          >
            通用
          </button>
        </div>
        <div className="dialog-body">
        <div
          id="settings-panel-connections"
          role="tabpanel"
          aria-labelledby="settings-tab-connections"
          hidden={tab !== "connections"}
        >
          <section
            className="settings-group"
            aria-labelledby="settings-connections"
          >
            <h3 id="settings-connections">连接与 Being</h3>
            <button
              id="settings-button"
              data-settings-route=""
              onClick={() => app.showSettings()}
            >
              Being 连接与本机配置 <span>›</span>
            </button>
            <button
              id="town-settings-button"
              data-settings-route=""
              onClick={() => {
                app.clientSettingsOpen = false;
                app.changed();
                void app.town.auth();
              }}
            >
              Town 配对与身份 <span>›</span>
            </button>
            <button
              data-chat-action="model"
              disabled={!app.snapshot?.settings.hasToken}
              onClick={() => app.chatAction("model")}
              data-settings-route=""
            >
              模型设置 <span>›</span>
            </button>
            <button
              data-view="portal"
              onClick={() => {
                app.clientSettingsOpen = false;
                app.navigate("portal");
              }}
              data-settings-route=""
            >
              Portal 运行状态 <span>›</span>
            </button>
            <button
              id="open-workspace"
              onClick={() => void app.run(() => app.api.openWorkspace())}
            >
              打开工作目录 <span>↗</span>
            </button>
          </section>
        </div>
        <div
          id="settings-panel-appearance"
          role="tabpanel"
          aria-labelledby="settings-tab-appearance"
          hidden={tab !== "appearance"}
        >
          <section
            className="settings-group"
            aria-labelledby="settings-appearance"
          >
            <h3 id="settings-appearance">外观与阅读</h3>
            <button id="theme-toggle" onClick={() => void app.toggleTheme()}>
              {app.theme === "light"
                ? "配色 · 浅色，点击切换"
                : "配色 · 深色，点击切换"}
            </button>
            <div className="reading-setting">
              <label htmlFor="reading-size">
                阅读字号{" "}
                <output id="reading-size-value" htmlFor="reading-size">
                  {app.readingSize} px
                </output>
              </label>
              <input
                id="reading-size"
                type="range"
                min="13"
                max="21"
                step="1"
                value={app.readingSize}
                onChange={(event) =>
                  app.setReadingSize(Number(event.target.value))
                }
              />
              <button
                id="reading-reset"
                type="button"
                onClick={() => app.setReadingSize(15)}
              >
                恢复默认
              </button>
              <p className="field-help">
                调整对话与 Town 正文字号，立即预览并记住设置。
              </p>
            </div>
          </section>
        </div>
        <div
          id="settings-panel-general"
          role="tabpanel"
          aria-labelledby="settings-tab-general"
          hidden={tab !== "general"}
        >
          <section
            className="settings-group"
            aria-labelledby="settings-startup"
          >
            <h3 id="settings-startup">启动与后台</h3>
            <p className="field-help">
              关闭窗口后，客户端继续运行。点击托盘图标或重新打开应用可恢复窗口；选择「退出客户端」才会结束运行。
            </p>
            <div className="switch-list">
              <label>
                <span>
                  <strong>开机自启客户端</strong>
                  <small id="client-startup-help">
                    {app.clientStartup?.message || "正在读取系统设置…"}
                  </small>
                </span>
                <input
                  id="client-startup-input"
                  type="checkbox"
                  role="switch"
                  checked={Boolean(app.clientStartup?.enabled)}
                  disabled={app.startupBusy || !app.clientStartup?.supported}
                  onChange={(event) =>
                    void app.changeClientStartup(event.target.checked)
                  }
                />
              </label>
            </div>
            <p className="form-error" id="client-settings-error" role="alert">
              {app.clientError}
            </p>
          </section>

          <section
            className="settings-group"
            aria-labelledby="settings-maintenance"
          >
            <h3 id="settings-maintenance">维护</h3>
            <button
              id="open-diagnostics"
              data-settings-route=""
              onClick={() => {
                app.clientSettingsOpen = false;
                app.diagnosticsOpen = true;
                app.changed();
              }}
            >
              连接诊断 <span>›</span>
            </button>
            <button
              id="check-updates"
              disabled={app.update?.phase === "checking"}
              onClick={() => void app.run(async () => {
                const activity = app.update?.activity;
                if (activity) {
                  app.toast(activity.phase === "ready"
                    ? "安装包已就绪，请点击右上角安装。"
                    : "正在处理更新，请稍候。");
                  return;
                }
                const state = await app.api.checkUpdates();
                app.toast(state.message);
              })}
            >
              {app.update?.phase === "checking"
                ? "正在检查更新…"
                : app.update?.phase === "available"
                  ? `重新检查更新 · ${app.update.latestVersion}`
                  : "手动检查更新"}
            </button>
          </section>
        </div>
        </div>
      </div>
    </Dialog>
  );
}

export function ConnectionSettings({ model }: { model: AppModel }) {
  const app = useModel(model);
  const form = app.form;
  const imported = Boolean(form?.portalConfigPath);
  return (
    <Dialog
      open={app.settingsOpen}
      busy={app.saving}
      onClose={() => app.closeSettings()}
      id="settings-dialog"
    >
      <form
        id="settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          void app.saveSettings();
        }}
      >
        <div className="dialog-heading">
          <div>
            <h2>连接与设置</h2>
          </div>
          <button
            type="button"
            id="close-settings"
            disabled={app.saving}
            className="close"
            aria-label="关闭设置"
            onClick={() => app.closeSettings()}
          ></button>
        </div>
        <div className="dialog-body">
          <label htmlFor="connection-link">Being 完整连接地址</label>
          <input
            id="connection-link"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={form?.connectionLink || ""}
            onChange={(event) =>
              app.editForm("connectionLink", event.target.value)
            }
            required={!app.snapshot?.settings.hasToken}
            placeholder={
              app.snapshot?.settings.hasToken
                ? `${app.snapshot.settings.endpoint}/ · 已安全保存，留空保留`
                : "https://echo.beings.town/your_being/?token=…"
            }
          />
          <p className="field-help" id="connection-help">
            粘贴包含 token 的完整 Loom 地址，Being
            由地址确定。凭据加密保存在系统密钥库支持的本地配置中。
          </p>
          <div className="field-row">
            <div>
              <label htmlFor="portal-name-input">本机 Portal 名称</label>
              <input
                id="portal-name-input"
                required
                maxLength={80}
                pattern="[a-zA-Z0-9_-]+"
                value={form?.portalName || ""}
                onChange={(event) =>
                  app.editForm("portalName", event.target.value)
                }
              />
            </div>
          </div>
          <p id="portal-name-help" className="field-help">
            {app.portalNameHelp}
          </p>
          <label htmlFor="workspace-input">工作目录</label>
          <div className="picker">
            <input
              id="workspace-input"
              required
              value={form?.workspace || ""}
              onChange={(event) => app.editForm("workspace", event.target.value)}
              readOnly={imported}
            />
            <button
              type="button"
              data-pick="workspace"
              disabled={imported}
              onClick={() =>
                void app.run(async () => {
                  const value = await app.api.choose("workspace");
                  if (value) app.editForm("workspace", value);
                })
              }
            >
              选择…
            </button>
          </div>
          <p className="field-help">
            使用客户端自带的 Portal，安装和升级后自动使用配套版本，沿用已有配置。
          </p>
          <p className="field-help" id="existing-config-note" hidden={!imported}>
            {imported
              ? `沿用现有配置：${form?.portalConfigPath}。工作目录、命令、截图及扩展工具以该文件为准；在原配置中修改后重启 Portal 生效。`
              : ""}
          </p>
          <div className="switch-list">
            <label>
              <span>
                <strong>Portal 后台常驻与登录自启</strong>
                <small>退出客户端后继续运行；连续故障最多重试 5 次</small>
              </span>
              <input
                id="background-input"
                type="checkbox"
                role="switch"
                checked={Boolean(form?.backgroundEnabled)}
                disabled={app.snapshot?.background?.supported === false}
                onChange={(event) =>
                  app.editForm("backgroundEnabled", event.target.checked)
                }
              />
            </label>
            <label>
              <span>
                <strong>仅随客户端启动 Portal</strong>
                <small>未启用后台常驻时生效，退出客户端后停止</small>
              </span>
              <input
                id="autostart-input"
                type="checkbox"
                role="switch"
                checked={Boolean(form?.autoStart)}
                disabled={Boolean(form?.backgroundEnabled)}
                onChange={(event) =>
                  app.editForm("autoStart", event.target.checked)
                }
              />
            </label>
            <label>
              <span>
                <strong>允许命令执行</strong>
                <small>默认开启，与 Portal 一同提供本机命令能力</small>
              </span>
              <input
                id="exec-input"
                type="checkbox"
                role="switch"
                checked={Boolean(form?.allowExec)}
                onChange={(event) =>
                  app.editForm("allowExec", event.target.checked)
                }
              />
            </label>
            <label>
              <span>
                <strong>启用 Kits 与自定义工具</strong>
                <small>默认开启，与 Portal 一同加载已安装的扩展和工具配置</small>
              </span>
              <input
                id="kits-input"
                type="checkbox"
                role="switch"
                checked={Boolean(form?.kitsEnabled)}
                onChange={(event) =>
                  app.editForm("kitsEnabled", event.target.checked)
                }
              />
            </label>
          </div>
          <p className="form-error" id="settings-error" role="alert">
            {app.formError}
          </p>
        </div>
        <div className="dialog-footer">
          <span>验证连接成功后启动 Portal</span>
          <button
            className="primary"
            id="save-settings"
            type="submit"
            disabled={app.saving}
          >
            保存、连接并启动
          </button>
        </div>
      </form>
    </Dialog>
  );
}
