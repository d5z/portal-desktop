import { Store } from "../../shared/models/store";
import {
  SceneStore,
  sceneExcerpt,
  type SceneView,
  type SceneObservation,
} from "../../shared/models/scene";
import type { Snapshot } from "../../../shared/types";
export class WorkspaceModel extends Store {
  readonly scenes = new SceneStore();
  open = false;
  draftRequest = "";
  private timer?: ReturnType<typeof setTimeout>;
  private online = false;
  private pending: SceneObservation | null = null;
  private frozen: SceneObservation | null = null;
  constructor(
    private navigate: (view: string) => void,
    private toast: (message: unknown) => void,
    private post: (data: unknown) => void,
    private hasFrame: () => boolean,
  ) {
    super();
  }
  start() {
    const reset = () => {
      this.open = false;
      this.frozen = null;
      this.pending = null;
      this.draftRequest = "";
      clearTimeout(this.timer);
      this.changed();
    };
    this.scenes.addEventListener("identity-reset", reset);
    this.scenes.addEventListener("change", this.changed);
    return () => {
      clearTimeout(this.timer);
      this.scenes.removeEventListener("identity-reset", reset);
      this.scenes.removeEventListener("change", this.changed);
    };
  }
  toggle(open = !this.open) {
    this.open = open;
    this.changed();
  }
  enter(view: string) {
    this.scenes.enter(view as SceneView);
    if (view === "chat") this.connection(this.online);
    if (view === 'plugins') this.scenes.update({ status: 'ready', scope: '本机插件页面；插件内容不自动发送给 Being', identity: '' });
    if (view === "portal")
      this.scenes.update({
        status: "ready",
        scope: "本机进程与日志观察；工具可用性待 Heart 确认",
        identity: this.scenes.being,
      });
  }
  connection(online: boolean) {
    this.online = online;
    if (this.scenes.current.view === "chat")
      this.scenes.update({
        status: online ? "ready" : "loading",
        scope: "当前对话；场景元信息尚未传给 Heart",
      });
  }
  snapshot(snapshot: Snapshot) {
    this.scenes.configure(snapshot.settings.being, snapshot.settings.endpoint);
    if (this.scenes.current.view === "portal")
      this.scenes.update({
        status: "ready",
        scope: "本机进程与日志观察；工具可用性待 Heart 确认",
        identity: snapshot.settings.being,
      });
    this.changed();
  }
  clear() {
    this.scenes.reference = null;
    this.scenes.update({ selection: undefined });
    this.scenes.event("清除了讨论对象");
    this.toggle(false);
  }
  returnToSource() {
    const ref = this.scenes.reference;
    if (ref) {
      this.navigate(ref.view);
      this.scenes.event("返回来源页面", ref.title, "引用保留发送前版本");
    }
  }
  frameLoaded() {
    this.frozen = null;
  }
  receive(message: Record<string, unknown>) {
    if (
      message.type === "beings:scene-select" &&
      this.scenes.current.view === "chat" &&
      typeof message.id === "string" &&
      /^[a-zA-Z0-9-]{1,80}$/.test(message.id) &&
      typeof message.text === "string" &&
      message.text.trim() &&
      message.text.length <= 2100 &&
      (message.role === "user" || message.role === "being")
    ) {
      const excerpt = sceneExcerpt(message.text.trim());
      this.scenes.select({
        id: `chat:${message.id}`,
        title: excerpt.split("\n")[0].slice(0, 60),
        author: message.role === "user" ? "你" : this.scenes.being,
        excerpt,
        private: true,
      });
      this.scenes.pin();
      this.toggle(true);
    }
    if (
      message.type === "beings:scene-capture" &&
      typeof message.id === "string" &&
      /^[a-zA-Z0-9-]{1,80}$/.test(message.id)
    ) {
      const old = this.scenes.reference;
      this.scenes.reference =
        message.hasSceneDraft && this.frozen ? this.frozen : null;
      this.scenes.capture(message.id);
      this.scenes.reference = old;
      this.changed();
      this.post({ type: "beings:scene-captured", id: message.id });
    }
    if (
      message.type === "beings:scene-result" &&
      typeof message.id === "string"
    ) {
      const envelope = this.scenes.envelopes.find(
        (item) => item.messageId === message.id,
      );
      if (!envelope) return;
      this.scenes.event(
        message.ok === true ? "对话请求已被接受" : "对话请求未确认",
        envelope.environment.title,
        message.ok === true
          ? "页面环境快照仅保存在本机"
          : "请查看对话中的请求结果",
      );
      if (message.ok === true && message.hasSceneDraft) this.frozen = null;
    }
    if (
      message.type === "beings:scene-draft-result" &&
      message.id === this.draftRequest &&
      this.draftRequest
    ) {
      clearTimeout(this.timer);
      this.draftRequest = "";
      if (message.ok) {
        this.frozen = this.pending;
        this.pending = null;
        this.scenes.event(
          "引用已放入对话草稿",
          this.scenes.reference?.title,
          "尚未发送",
        );
        this.navigate("chat");
        this.toggle(false);
      } else {
        this.pending = null;
        this.toast("对话输入框已有草稿，请先处理原草稿，再放入引用。");
      }
      this.changed();
    }
  }
  compose() {
    if (this.draftRequest) return;
    const scene =
      this.scenes.reference ||
      (this.scenes.current.selection
        ? structuredClone(this.scenes.current)
        : null);
    if (!scene?.selection) return;
    if (!this.scenes.being || !this.hasFrame()) {
      this.toast("请先连接对话 Being。");
      return;
    }
    // Explicitly choosing a quotation authorizes placing it in the current
    // chat draft, regardless of Town identity. The user still decides to send.
    this.scenes.reference = structuredClone(scene);
    const resource = scene.selection;
    const text = `一起看看${scene.title}里的这段${resource.author ? `（${resource.author}）` : ""}：\n\n${resource.excerpt
      .split("\n")
      .map((line) => "> " + line)
      .join("\n")}`;
    this.pending = structuredClone(scene);
    this.draftRequest = crypto.randomUUID();
    this.changed();
    this.post({
      type: "beings:scene-draft",
      id: this.draftRequest,
      text,
      expiresAt: Date.now() + 2500,
    });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.draftRequest) {
        this.draftRequest = "";
        this.pending = null;
        this.changed();
        this.toast("对话页面尚未准备好，请稍后重试。");
      }
    }, 3000);
  }
}
