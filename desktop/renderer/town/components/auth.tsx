import type { TownModel } from "../models/town";
import { useModel } from "../../shared/hooks/use-model";
import { Dialog } from "../../shared/components/dialog";
import { NavigationControls } from "../../shared/components/navigation-controls";
import { townPairPrompt } from '../../../shared/town-pairing';
export function TownAuth({ model, pairPrompt = townPairPrompt, returnToSettings = false, onReturnToSettings = () => {}, onDismissSettingsRoute = () => {} }: {
  model: TownModel;
  pairPrompt?: string;
  returnToSettings?: boolean;
  onReturnToSettings?: () => void;
  onDismissSettingsRoute?: () => void;
}) {
  const town = useModel(model);
  const close = async (back: boolean) => {
    await town.closeAuth();
    if (town.authOpen) return;
    if (back) onReturnToSettings();
    else onDismissSettingsRoute();
  };

  return (
    <Dialog
      open={town.authOpen}
      busy={town.authBusy && !town.autoPairId}
      onClose={() => void close(false)}
      id="town-auth-dialog"
    >
      <form
        id="town-auth-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (town.authManual) void town.saveToken(false, true);
          else void town.autoPair();
        }}
      >
        <div className="dialog-heading">
          <div className="dialog-heading-main">
            <h2>连接 Beings Town</h2>
            <NavigationControls back={returnToSettings && (!town.authBusy || Boolean(town.autoPairId)) ? () => void close(true) : undefined} />
          </div>
          <button
            type="button"
            id="close-town-auth"
            className="close"
            aria-label="关闭 Town 连接"
            disabled={town.authBusy && !town.autoPairId}
            onClick={() => void close(false)}
          ></button>
        </div>
        <div className="dialog-body">
        <p className="connection-description">
          {town.authLoading ? '正在读取连接信息…' : town.authManual
            ? '输入 Town ID 或 Being 名和配对码，连接篝火、围炉和私信。'
            : `将通过当前对话向 ${town.authChatBeing} 发送一条配对请求，自动获取配对码并完成连接。`}
        </p>
        {!town.authLoading && !town.authManual && <p className="field-help">无需手动复制配对码。自动连接最多等待 90 秒，你可以随时取消。</p>}
        <div hidden={!town.authManual}>
        <label htmlFor="town-being">Town ID 或 Being 名</label>
        <input
          id="town-being"
          autoComplete="username"
          spellCheck={false}
          maxLength={64}
          placeholder="例如 t_pX4Dut 或 weiguo_being"
          value={town.authBeing}
          disabled={town.authBusy}
          onChange={(event) => {
            town.authBeing = event.target.value;
            town.changed();
          }}
        />
        <label htmlFor="town-pair-code">配对码</label>
        <input
          id="town-pair-code"
          type="password"
          autoComplete="one-time-code"
          spellCheck={false}
          maxLength={6}
          placeholder="6 位字母或数字"
          value={town.pairCode}
          disabled={town.authBusy}
          onChange={(event) => {
            town.pairCode = event.target.value;
            town.changed();
          }}
        />
        <p className="field-help">
          {!town.authChatBeing ? '尚未连接 Being 对话，可先连接对话以使用自动配对，或继续手动配对。' : '也可以把下面这段请求发给 Being，再填写它返回的配对码。'}
        </p>
        <details className="town-manual-prompt"><summary>获取配对码的请求</summary><p>{pairPrompt}</p>
          <button type="button" className="text-button" onClick={() => void town.api.copyText(pairPrompt).catch(error => town.toast(error))}>复制请求</button>
        </details>
        </div>
        {!town.authLoading && <button id="town-pair-mode" type="button" className="text-button" disabled={town.authBusy || town.authManual && !town.authChatBeing}
          onClick={() => { town.authManual = !town.authManual; town.authError = ''; town.changed(); }}>
          {town.authManual ? '使用自动配对' : '改用手动配对'}
        </button>}
        <details className="town-advanced-auth">
          <summary>高级：使用已有 Town 凭据</summary>
          <label htmlFor="town-token">Town 专用凭据</label>
          <input
            id="town-token"
            type="password"
            autoComplete="off"
            placeholder="Town 客户端 token"
            value={town.token}
            disabled={town.authBusy}
            onChange={(event) => {
              town.token = event.target.value;
              town.changed();
            }}
          />
          <button
            type="button"
            id="save-town-token"
            className="secondary"
            disabled={town.authBusy}
            onClick={() => void town.saveToken(false)}
          >
            保存已有凭据
          </button>
          <p className="field-help">
            这里接受 Town 凭据，不是 Loom 对话链接中的 token。
          </p>
        </details>
        <p id="town-auth-state" className="field-help" role="status" aria-live="polite">
          {town.authState}
        </p>
        <p id="town-auth-error" className="form-error" role="alert">
          {town.authError}
        </p>
        </div>
        <div className="dialog-footer">
          <button
            type="button"
            id="clear-town-token"
            className="text-button"
            disabled={town.authBusy || !town.authConfigured}
            onClick={() => void town.saveToken(true)}
          >
            断开本机配对
          </button>
          {town.autoPairId && <button id="cancel-town-pair" type="button" className="secondary" onClick={() => void town.cancelAutoPair()}>取消自动配对</button>}
          <button type="submit" disabled={town.authBusy || town.authLoading} className="primary">
            {town.autoPairId ? '正在连接…' : town.authManual ? '确认配对' : '自动连接 Town'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
