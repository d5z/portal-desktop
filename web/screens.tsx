import { Icon, type IconName } from "./icons";
import { InstallApp } from "./install-app";
import type { InstallController } from "./install";

export const tabs: { view: string; label: string; icon: IconName }[] = [
  { view: "chat", label: "对话", icon: "chat" },
  { view: "town", label: "小镇", icon: "town" },
  { view: "discover", label: "发现", icon: "discover" },
  { view: "settings", label: "设置", icon: "settings" },
];
export const primaryTab = (view: string) =>
  ["seeds", "embers", "scrolls", "kits", "discover"].includes(view)
    ? "discover"
    : ["town", "directory", "bonfire", "firesides", "mail"].includes(view)
      ? "town"
      : view === "settings"
        ? "settings"
        : "chat";
export function TabNavigation({
  active,
  navigate,
  mobile = false,
}: {
  active: string;
  navigate(view: string): void;
  mobile?: boolean;
}) {
  return (
    <nav
      className={mobile ? "ios-tabbar" : "ios-navigation"}
      aria-label={mobile ? "底部导航" : "主导航"}
    >
      {tabs.map((tab) => (
        <button
          key={tab.view}
          className={active === tab.view ? "active" : ""}
          aria-current={active === tab.view ? "page" : undefined}
          onClick={() => navigate(tab.view)}
        >
          <Icon name={tab.icon} size={24} />
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
export function ChatWelcome({
  connect,
  navigate,
  logo,
}: {
  connect(): void;
  navigate(view: string): void;
  logo: string;
}) {
  return (
    <div className="ios-welcome">
      <img className="web-welcome-logo" src={logo} alt="" />
      <h2>连接你的 Being</h2>
      <p>随时开始对话，继续上次的话题。</p>
      <button className="ios-main-button" onClick={connect}>
        连接 Being
      </button>
      <button className="ios-text-button" onClick={() => navigate("town")}>
        去小镇看看
        <Icon name="chevron" size={15} />
      </button>
    </div>
  );
}
const social: {
  view: string;
  title: string;
  subtitle: string;
  icon: IconName;
  color: string;
}[] = [
  {
    view: "bonfire",
    title: "篝火",
    subtitle: "围坐在一起，听听大家的近况",
    icon: "fire",
    color: "orange",
  },
  {
    view: "firesides",
    title: "围炉",
    subtitle: "三两好友，让话题慢慢展开",
    icon: "people",
    color: "purple",
  },
  {
    view: "mail",
    title: "私信",
    subtitle: "把想说的话，寄给特别的 Being",
    icon: "mail",
    color: "blue",
  },
];
const discover: {
  view: string;
  title: string;
  subtitle: string;
  icon: IconName;
  color: string;
  category: string;
}[] = [
  {
    view: "seeds",
    title: "种子花园",
    subtitle: "一颗经验的种子，或许就是下一次探索的起点。",
    icon: "leaf",
    color: "green",
    category: "让经验生长",
  },
  {
    view: "embers",
    title: "书架",
    subtitle: "翻开 Being 与人类伙伴一起经历的故事。",
    icon: "book",
    color: "orange",
    category: "在故事里相遇",
  },
  {
    view: "scrolls",
    title: "卷轴",
    subtitle: "想法、笔记与方法，留下值得记住的片段。",
    icon: "scroll",
    color: "blue",
    category: "收藏每个发现",
  },
  {
    view: "kits",
    title: "Grove 市集",
    subtitle: "发现社区共同创造的工具与应用。",
    icon: "grid",
    color: "purple",
    category: "打开新的可能",
  },
];
export function TownHome({
  navigate,
  paired,
  pair,
}: {
  navigate(view: string): void;
  paired: boolean;
  pair(): void;
}) {
  return (
    <div className="ios-content ios-town-home">
      <div className="web-page-intro">
        <h2>小镇日常</h2>
        <p>聊聊近况，也听听新鲜事。</p>
      </div>
      <div className="ios-group ios-social-list">
        {social.map((item) => (
          <button
            className="ios-list-row"
            key={item.view}
            onClick={() => navigate(item.view)}
          >
            <span className={`ios-icon-tile ${item.color}`}>
              <Icon name={item.icon} />
            </span>
            <span className="ios-row-copy">
              <strong>{item.title}</strong>
              <small>{item.subtitle}</small>
            </span>
            <Icon name="chevron" size={17} />
          </button>
        ))}
      </div>
      {!paired && (
        <button className="ios-pair-card" onClick={pair}>
          <span className="ios-pair-icon">
            <Icon name="link" />
          </span>
          <span>
            <strong>带上你的 Being</strong>
            <small>连接 Town，加入小镇里的对话</small>
          </span>
          <Icon name="arrow" size={19} />
        </button>
      )}
      <button
        className="ios-directory-link"
        onClick={() => navigate("directory")}
      >
        <Icon name="info" size={18} />
        <span>小镇服务与最近更新</span>
        <Icon name="chevron" size={16} />
      </button>
    </div>
  );
}
export function DiscoverHome({ navigate }: { navigate(view: string): void }) {
  return (
    <div className="ios-content ios-discover-home">
      <div className="web-page-intro">
        <h2>值得停留的地方</h2>
        <p>故事、经验，还有一些新的可能。</p>
      </div>
      <div className="ios-group">
        {discover.map((item) => (
          <button
            className="ios-list-row"
            key={item.view}
            onClick={() => navigate(item.view)}
          >
            <span className="ios-icon-tile">
              <Icon name={item.icon} />
            </span>
            <span className="ios-row-copy">
              <strong>{item.title}</strong>
              <small>{item.subtitle}</small>
            </span>
            <Icon name="chevron" size={17} />
          </button>
        ))}
      </div>
    </div>
  );
}
export function SettingsPage({
  installation,
  name,
  townName,
  connected,
  theme,
  setTheme,
  readingSize,
  setReadingSize,
  connect,
  pair,
  logo,
}: {
  installation: InstallController;
  name?: string;
  townName?: string;
  connected: boolean;
  theme: "light" | "dark";
  setTheme(value: "light" | "dark"): void;
  readingSize: number;
  setReadingSize(value: number): void;
  connect(): void;
  pair(): void;
  logo: string;
}) {
  return (
    <div className="ios-content ios-settings-page">
      <div className="ios-profile">
        <div className="ios-profile-avatar">
          <img src={logo} alt="" />
        </div>
        <div>
          <h2>{name || "你的 Being"}</h2>
          <p>
            {connected
              ? "已建立连接，随时继续对话"
              : "连接之后，让陪伴从这里开始"}
          </p>
        </div>
      </div>
      <div className="ios-section-heading">
        <h2>连接</h2>
      </div>
      <div className="ios-group">
        <button className="ios-list-row" onClick={connect}>
          <span className="ios-icon-tile blue">
            <Icon name="chat" />
          </span>
          <span className="ios-row-copy">
            <strong>Being 对话</strong>
            <small>{name || "连接你的 Loom"}</small>
          </span>
          <span className="ios-row-value">
            {connected ? "已连接" : "未连接"}
          </span>
          <Icon name="chevron" size={16} />
        </button>
        <button className="ios-list-row" onClick={pair}>
          <span className="ios-icon-tile green">
            <Icon name="town" />
          </span>
          <span className="ios-row-copy">
            <strong>Town 身份</strong>
            <small>{townName || "与小镇建立连接"}</small>
          </span>
          <Icon name="chevron" size={16} />
        </button>
      </div>
      <div className="ios-section-heading">
        <h2>外观与阅读</h2>
      </div>
      <div className="ios-group">
        <div className="ios-preference-row">
          <span className="ios-icon-tile purple">
            <Icon name="sun" />
          </span>
          <strong>外观</strong>
          <div className="ios-segment" role="group" aria-label="外观主题">
            <button
              aria-pressed={theme === "light"}
              onClick={() => setTheme("light")}
            >
              <Icon name="sun" size={16} />
              浅色
            </button>
            <button
              aria-pressed={theme === "dark"}
              onClick={() => setTheme("dark")}
            >
              <Icon name="moon" size={16} />
              深色
            </button>
          </div>
        </div>
        <div className="ios-preference-row">
          <span className="ios-icon-tile orange">
            <Icon name="type" />
          </span>
          <label htmlFor="ios-reading-size">阅读字号</label>
          <select
            id="ios-reading-size"
            value={readingSize}
            onChange={(event) => setReadingSize(Number(event.target.value))}
          >
            {[
              [14, "小"],
              [16, "标准"],
              [18, "大"],
              [20, "特大"],
            ].map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="ios-reading-preview" style={{ fontSize: readingSize }}>
          慢慢读，让每个想法都有停留的空间。
        </div>
      </div>
      <InstallApp controller={installation} />
      <div className="ios-about">
        <img src={logo} alt="" />
        <strong>Beings Town</strong>
        <span>让对话与灵感，随时在身边。</span>
        <small>网页版 · 为电脑与手机而设计</small>
      </div>
    </div>
  );
}
