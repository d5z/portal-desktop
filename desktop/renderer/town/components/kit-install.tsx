import { Fragment } from "react";
import type { TownModel } from "../models/town";
import { useModel } from "../../shared/hooks/use-model";
import { Dialog } from "../../shared/components/dialog";
export function KitInstall({ model }: { model: TownModel }) {
  const town = useModel(model),
    plan = town.plan;
  return (
    <Dialog
      open={Boolean(plan)}
      busy={town.installBusy}
      onClose={() => town.closeInstall()}
    >
      {plan && (
        <form
          className="kit-install-form"
          onSubmit={(event) => {
            event.preventDefault();
            void town.install();
          }}
        >
          <div className="dialog-heading">
            <h2>安装 {plan.name}</h2>
            <button
              className="close"
              type="button"
              aria-label="取消 Kit 安装"
              disabled={town.installBusy}
              onClick={() => town.closeInstall()}
            />
          </div>
          <div className="dialog-body">
            <p>{plan.description}</p>
            <p className="card-meta">
              v{plan.version} · {plan.tools} 个声明工具
            </p>
            <p className="field-help">
              {plan.dependency === "npm"
                ? "将安装 npm 依赖（包括包内安装脚本），再交给 Portal 管理。"
                : plan.dependency === "python"
                  ? "将创建 Kit 专用 Python 环境并安装 requirements.txt，再交给 Portal 管理。"
                  : "安装完成后由 Portal 自动发现并按需启动。"}
            </p>
            {plan.notes && <p className="field-help">{plan.notes}</p>}
            {plan.environment.map((field) => (
              <Fragment key={field.name}>
                <label htmlFor={"kit-env-" + field.name}>
                  {field.name + (field.required ? " *" : "（可选）")}
                </label>
                <input
                  id={"kit-env-" + field.name}
                  type="password"
                  autoComplete="off"
                  required={field.required}
                  disabled={town.installBusy}
                  value={town.environment[field.name] || ""}
                  onChange={(event) => {
                    town.environment[field.name] = event.target.value;
                    town.changed();
                  }}
                />
                <p className="field-help">{field.description}</p>
              </Fragment>
            ))}
            {plan.environment.length > 0 && (
              <p className="field-help">
                配置写入 Kit 本地 .env，由 Portal 按清单注入。
              </p>
            )}
            <p className="form-error" role="alert">
              {town.installError}
            </p>
          </div>
          <div className="dialog-footer">
            <span>Portal 会自动刷新 Kit 清单</span>
            <button
              className="primary"
              type="submit"
              disabled={town.installBusy}
            >
              {town.installBusy
                ? "正在安装…"
                : town.installRetried
                  ? "重试安装"
                  : "安装到本机"}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
