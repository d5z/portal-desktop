import { useState, useSyncExternalStore } from "react";
import { Dialog } from "../desktop/renderer/shared/components/dialog";
import { Icon } from "./icons";
import type { InstallController } from "./install";

export function InstallApp({ controller }: { controller: InstallController }) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const [guide, setGuide] = useState(false);
  const [notice, setNotice] = useState("");
  const ios = controller.platform === "ios";
  const mobile = ios || controller.platform === "android";
  const title = mobile ? "添加到主屏幕" : "添加到桌面";
  const install = async () => {
    setNotice("");
    const result = await controller.install();
    if (result === "guide") setGuide(true);
    if (result === "dismissed")
      setNotice("已取消添加，你可以稍后从浏览器菜单再次添加。");
    if (result === "accepted")
      setNotice("已确认安装，请按浏览器提示完成添加。");
  };
  const steps = ios
    ? [
        "在 Safari 中打开当前网页。",
        "打开浏览器的分享菜单，选择「添加到主屏幕」。",
        "如有「作为网页 App 打开」选项，请保持开启，然后轻点「添加」。",
      ]
    : controller.platform === "mac-safari"
      ? [
          "在 Safari 顶部菜单中选择「文件 → 添加到程序坞」。",
          "确认名称为 Beings Town，然后点「添加」。",
        ]
      : controller.platform === "android"
        ? [
            "在 Chrome 等系统浏览器中打开当前网页。",
            "打开浏览器菜单，选择「安装应用」或「添加到主屏幕」。",
            "确认名称并完成添加。",
          ]
        : [
            "在 Chrome 或 Edge 中打开当前网页。",
            "点击地址栏的安装图标，或在浏览器菜单中找到「安装应用」。",
            "确认安装后，即可从系统应用列表打开 Beings Town。",
          ];
  return (
    <>
      <div className="ios-section-heading">
        <h2>快捷访问</h2>
      </div>
      <div className="ios-group">
        <button
          className="ios-list-row"
          onClick={() => void install()}
          disabled={state.installed || state.busy}
        >
          <span className="ios-icon-tile">
            <Icon name="install" />
          </span>
          <span className="ios-row-copy">
            <strong>{state.installed ? "已添加到设备" : title}</strong>
            <small>
              {state.installed
                ? "可从主屏幕或应用列表打开"
                : state.busy
                  ? "请在浏览器中确认…"
                  : "轻点图标，随时回到小镇"}
            </small>
          </span>
          {state.installed ? (
            <span className="ios-row-value">已添加</span>
          ) : (
            <Icon name="chevron" size={16} />
          )}
        </button>
      </div>
      {notice && !state.installed && (
        <p className="web-install-notice" role="status">
          {notice}
        </p>
      )}
      <Dialog
        open={guide && !state.installed}
        onClose={() => setGuide(false)}
        id="web-install"
        aria-labelledby="web-install-title"
        dismissOnBackdrop
      >
        <div className="dialog-heading">
          <h2 id="web-install-title">{title}</h2>
          <button
            className="close"
            aria-label="关闭添加说明"
            onClick={() => setGuide(false)}
          />
        </div>
        <div className="dialog-body">
          <div className="web-install-preview">
            <img src="./icons/app-192.png" alt="Beings Town 应用图标" />
            <div>
              <strong>Beings Town</strong>
              <p>你的对话与小镇，随手可达。</p>
            </div>
          </div>
          {!controller.secure && (
            <p className="web-install-notice">
              请先使用 HTTPS 地址打开网页，再添加到设备。
            </p>
          )}
          <ol className="web-install-steps">
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="field-help">
            {ios
              ? "如果菜单里没有此选项，可在「编辑操作」中添加；微信等内置浏览器中请先选择在 Safari 中打开。"
              : "未看到安装入口时，可尝试更新浏览器或使用其他支持安装的浏览器。"}
          </p>
          <p className="field-help">
            连接后，此设备会记住 Being 和 Town。首次从主屏幕打开若未继承浏览器连接，连接一次即可。
          </p>
        </div>
        <div className="dialog-footer">
          <button className="primary" onClick={() => setGuide(false)}>
            知道了
          </button>
        </div>
      </Dialog>
    </>
  );
}
