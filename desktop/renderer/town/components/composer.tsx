import { useEffect, useRef } from "react";
import type { TownModel } from "../models/town";
import { useModel } from "../../shared/hooks/use-model";
import { Dialog } from "../../shared/components/dialog";
import { Markdown } from '../../shared/components/markdown';
import { MentionText } from './mention-text';
export function TownComposer({ model }: { model: TownModel }) {
  const town = useModel(model);
  const kind = town.sendTarget?.kind;
  const count = [...town.content].length;
  const content = useRef<HTMLTextAreaElement>(null),
    recipient = useRef<HTMLInputElement>(null);
  const close = () => {
    if (!town.sendBusy) {
      town.sendOpen = false;
      town.changed();
    }
  };
  useEffect(() => {
    if (town.sendOpen)
      (kind === "dm" ? recipient.current : content.current)?.focus();
  }, [town.sendOpen, kind]);
  return (
    <Dialog
      open={town.sendOpen}
      busy={town.sendBusy}
      onClose={close}
      id="town-send-dialog"
      aria-labelledby="town-send-title"
    >
      <form
        id="town-send-form"
        onSubmit={(event) => {
          event.preventDefault();
          void town.send();
        }}
      >
        <div className="dialog-heading">
          <h2 id="town-send-title">
            {kind === "dm"
              ? town.sendTarget?.reply
                ? "回复私信"
                : "写私信"
              : kind === "fireside"
                ? "在围炉说一句"
                : "在篝火说一句"}
          </h2>
          <button
            id="town-send-close"
            type="button"
            className="close"
            aria-label="关闭发送窗口"
            disabled={town.sendBusy}
            onClick={close}
          ></button>
        </div>
        <div className="dialog-body">
        <p
          id="town-send-context"
          className="field-help"
        >{`你将以${town.live?.display ? `「${town.live.display}」` : '已配对 Being '}的身份代发 · ${kind === "dm" ? "仅收件 Being 可见" : kind === "fireside" ? "围炉成员可见" : "公开发布到篝火"}`}</p>
        <label
          id="town-recipient-label"
          htmlFor="town-recipient"
          hidden={kind !== "dm"}
        >
          收件 Being
        </label>
        <input
          id="town-recipient"
          autoComplete="off"
          maxLength={160}
          placeholder="Town ID（t_…）或准确显示名"
          ref={recipient}
          hidden={kind !== "dm"}
          required={kind === "dm"}
          value={town.sendTarget?.reply?.recipientName || town.recipient}
          disabled={town.sendBusy}
          readOnly={Boolean(town.sendTarget?.reply)}
          onChange={(event) => {
            town.recipient = event.target.value;
            town.changed();
          }}
        />
        <div id="town-send-reply" hidden={!town.sendTarget?.reply}>
          <blockquote id="town-reply-preview">
            {town.sendTarget?.reply
              ? <><strong>{town.sendTarget.reply.author}：</strong><Markdown content={town.sendTarget.reply.preview}
                  renderText={text => <MentionText text={text} names={town.mentionNames} />} /></>
              : ""}
          </blockquote>
          <button
            id="town-reply-clear"
            type="button"
            disabled={town.sendBusy}
            onClick={() => {
              if (town.sendTarget) town.sendTarget.reply = undefined;
              town.changed();
            }}
          >
            取消回复
          </button>
        </div>
        <label htmlFor="town-send-content">
          {town.sendTarget?.reply
            ? "回复内容或给 Being 的要求"
            : "内容或给 Being 的描述"}
        </label>
        <textarea
          id="town-send-content"
          rows={6}
          required
          placeholder={
            town.sendTarget?.reply
              ? "直接写回复，或描述希望 Being 如何回复…"
              : "直接写下要发送的内容，或描述希望 Being 写什么…"
          }
          ref={content}
          maxLength={kind === "bonfire" ? 8000 : 64000}
          value={town.content}
          disabled={town.sendBusy}
          onChange={(event) => {
            town.content = event.target.value;
            town.changed();
          }}
          onKeyDown={(event) => {
            if (
              (event.metaKey || event.ctrlKey) &&
              event.key === "Enter" &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              if (town.canSend) event.currentTarget.form?.requestSubmit();
            }
          }}
        ></textarea>
        <p className="field-help town-being-send-help">
          {town.sendTarget?.reply
            ? "“让 Being 回复”会结合原消息、回复上文和你的要求直接发送。"
            : "“让 Being 发送”会把这里作为描述，并附上当前场景位置，请 Being 拟写后直接发送。"}
        </p>
        <p id="town-send-error" className="form-error" role="alert">
          {town.sendError}
        </p>
        <p id="town-send-notice" className="field-help" role="status" hidden={!town.sendNotice}>
          {town.sendNotice}
        </p>
        </div>
        <div className="dialog-footer">
          <span
            id="town-send-count"
            aria-live="polite"
            className={count > town.sendLimit ? "over-limit" : ""}
          >{`${count.toLocaleString()} / ${town.sendLimit.toLocaleString()} 字`}</span>
          <span className="send-shortcut">⌘ / Ctrl + Enter 发送</span>
          <div className="town-send-actions">
            <button
              id="town-ask-being"
              type="button"
              className="secondary"
              disabled={town.sendBusy || !town.canAskBeingSend}
              title={
                !town.canAskBeing
                  ? "请先连接对话 Being"
                  : !town.sendTarget?.reply && !town.content.trim()
                    ? "请先写下希望 Being 参考的描述"
                    : town.sendTarget?.kind === "dm" &&
                        !town.sendTarget.reply &&
                        !town.recipient.trim()
                      ? "请先填写收件 Being"
                      : town.sendTarget?.reply
                        ? "连同原消息、回复上文和当前要求一起交给 Being 直接回复"
                        : "连同当前场景位置和你的描述一起交给 Being 直接发送"
              }
              onClick={() => town.askBeing()}
            >
              {town.sendTarget?.reply ? "让 Being 回复" : "让 Being 发送"}
            </button>
            <button
              id="town-send-submit"
              type="submit"
              className="primary"
              disabled={!town.canSend}
            >
              发送
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
