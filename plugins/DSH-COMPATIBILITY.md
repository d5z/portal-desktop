# Town 的 DSH 插件兼容层

Town 使用自己的 Electron 外壳、导航、工具库和 Being 聊天界面。兼容层接入 DSH 独立发布的 Cordis Loader、slot renderer、store、配置表单与 UI primitives；不启动 Harness 应用，不调用 Harness 的主界面 mount，不创建虚假的 Being/DSH Session。

对照基线：DSH **0.2.1-rc.5**，源码 commit `b830ec950faba0a46dda564be3e2d854afed94f1`；Cordis **4.0.5**、Loader **1.0.6**、Include **1.0.10**。`engines.dsh` 检查通过只表示版本范围匹配，不表示所有 DSH 服务都存在。

## 安装和设置

入口：**工具库 → Plugin → 第三方插件**，或 **客户端设置 → 插件 → 管理第三方插件**。Town 原有接口插件仍使用原来的 Plugin SDK。

支持 npm 包名/指定版本、Git URL、本地目录和 npm `.tgz`。依赖安装到独立目录，Git 来源需要本机 Git。先下载并读取清单，再确认安装；默认不执行生命周期脚本，确认框可选择允许该包及其依赖执行安装/构建脚本。构建通过 `npm rebuild` 执行；依赖必须适配当前系统和宿主 Node，源码包如只提供独立构建命令仍需先自行构建。第三方宿主具有本机 Node 权限，界面代码运行在 Town 主页面。

安装前会检查清单中的 DSH 版本和平台。确认安装或启用后，若缺少宿主服务或客户端依赖，管理页会直接定位到插件，并列出缺少的能力。首次安装的包会保留，但启动失败时自动停用并保留原因。补齐依赖后可以重新启用。Town 启动时发现插件未能加载，也会提示并停用该插件。

优先显示插件自己注册的设置组件；声明 `Config` 且允许自动配置的命名空间，另外提供 schema 驱动的通用配置表单，支持字段保存、恢复继承值、校验、版本冲突和 secret 脱敏。`settings.configure({ auto: false })` 可隐藏自动页面。Town 不为每个插件硬编码专属设置。

安装、更新、启停、卸载重建独立宿主，前端串行对账：释放被移除或替换的客户端及依赖它的模块，加载新增模块，保留未受影响的客户端实例。通过 Cordis effect 管理的插槽、事件、Remote 方法等随插件清理；停用当前主面板会返回 Town，重新启用恢复入口。新安装的资源按内容去重。移除或替换已注入的全局脚本、样式、HTML，以及客户端清理失败时，仍提示“重新加载页面”；只限制相关插件，其他插件入口与设置保持可用。重新加载前保留草稿。配置表单直接更新对应 Cordis fiber；volatile 引用更新遵循 Cordis 行为。第三方脚本遮挡页面时可按 **Ctrl/Cmd + Alt + Shift + P** 停用全部第三方插件并重新加载。

## 已接入的能力

| 能力 | Town 实现及验证范围 |
| --- | --- |
| 包清单、客户端模块 | `dsh.client`、`exports["./client"]`、web/all 平台、模块依赖排序、immediately 优先；依赖包内的客户端也可发现。缺少模块或服务会明确报告。 |
| Bundle / Loader | 使用原生 `applyEntryPatches` 和 Loader：insert、id 覆盖、独立行配置、嵌套 group、disabled、inject、isolate、intercept、`!!js` 表达式。表达式在宿主激活时求值。单包最多 100 行。 |
| Cordis 生命周期 | apply、Config、服务注入/提供、事件、effect/dispose、原生 timer；消费者可等待后安装的提供者。 |
| HTTP / Fetch | `webServer.register`、Node req/res、exact 优先及最长 prefix；`connection.fetch.register` 适配 Fetch Request/Response；query、请求体、流式响应和取消。监听回环地址，通过 Town 主进程私有令牌代理。 |
| 页面注入 | 宿主将 global/style/html/script/script-src/script-preload 合成页面并执行 tapIndex，再统一输出 HTML 与同源 script-src 给前端；保留插件去重逻辑、嵌套脚本及 module 类型。 |
| HTML 与 module | 插件 HTML / srcdoc 的可执行内联脚本转为同源资源；相对静态 import、字符串形式动态 import、import.meta.url 按原文档地址重定位；JSON script 保留为数据。 |
| Slot / store | 原生 renderer、ui-slots、store：注册与注销、children、store/actions、locale、inject、root hooks、过滤、keyed 入口和错误边界。无需复制一套简化的 slot React props。 |
| Town 挂载位置 | settings.section/general.item/plugins.tab/header/action/close/trigger/launcher/onboarding，plugins.bundle.config、settings.plugin.item，main、sidebar/panellist/footer/footer.action、rightbar、shell.overlay/overlay/app.overlay。Town 提供入口、关闭、导航与布局状态。 |
| 布局 | `layout.panelInfo`、selectPanel、beginNavigation、toggleSidebar、openRightbar/closeRightbar。插件的紧凑侧栏入口直接挂载在 Town 左侧主导航，与篝火、围炉共用滚动列表；保留原生插槽上下文与点击行为。Town 主导航始终可见，toggleSidebar 适配为滚动并聚焦插件入口，不折叠整条导航。右栏在宽窗口预留空间，窄窗口作为浮层；主面板保留返回 Town。 |
| 配置服务 | 本地 settings 与 `remote.settings`；DSH 原版 configForms/settingsSchema；每个 Loader 行独立命名空间、持久化 revision、冲突拒绝、嵌套继承、secret 脱敏。支持普通 Config 的 Town 扩展，不等同于完整 DSH profile/configEditor。 |
| 本地 Remote | 插件显式装饰的 direct 方法，客户端 `$mount`、JSON 请求/响应、单向结果流与取消、`$on` 事件订阅。同一 namespace 可由多个插件贡献不同方法，按贡献释放并取消其请求；重复方法明确报错。未装饰的方法不可通过此通道调用。 |
| 主题与字体 | 主题注册、light/dark/system、可释放 token 覆盖层、偏好持久化、字体角色与字号边界；提供基线 DSH 颜色/排版/阴影变量。Town 统一呈现明暗模式，阅读字号和导航不切换主题；插件调色板映射到侧栏、弹窗、控件、选中态和聊天 iframe，撤销时清除旧覆盖。`tokens.scss` 仅提取 MIT 许可的主题变量，未引入 Harness 布局和全局 reset。 |
| 国际化 | 字典注册、稳定 bind、插值、公共命名空间回退、语言包 addLanguage、语言链、resolveText、snapshot/subscribe；字典刷新不会错误触发语言切换事件。 |
| 通用组件 | 独立 ui-primitives 按需加载；对应图标、代码高亮、Markdown/公式依赖随客户端打包。 |
| 全局视觉 | 动画、壁纸、浮层作用于 Town 主页面；Being 聊天 iframe 同步颜色与字体变量，共用壁纸背景。插件设置控件保留自身样式。 |
| 系统通知 | 主页面浏览器 Notification 权限跟随 Town 通知总开关；其他页面/iframe 不获得权限。实际通知仍取决于操作系统授权。 |
| 故障恢复 | 注入资源失败不中断其他插件启动；管理页显示模块/服务/资源错误。宿主崩溃隔离、日志、升级宿主失败回退、紧急停用快捷键。Town 窗口与主界面不等待插件启动；客户端生命周期总等待上限 15 秒，超时请求 Cordis 清理。入口名称异常和插件根界面错误不会替换 Town 页面，管理入口仍可用。 |

## 尚未达到等价的部分

以下区分本地兼容层欠缺和必须连接 Being 才能实现的能力；**不能宣称所有 DSH 插件或所有功能都已兼容**。

| 剩余能力 | 原因与当前行为 |
| --- | --- |
| DSH Agent / Session / Turn、消息树、执行钩子、Prompt 上下文 | Being 会话与执行由远端 Being 服务拥有，需要明确协议桥接。root 插槽可用，但指定 DSH session 作用域会明确拒绝，不模拟会话。 |
| Provider、模型、工具执行/权限、MCP | Town 的产品功能尚未映射为 DSH 命名服务；注入这些服务的插件会受阻。 |
| 文件/Workspace、终端、任务、自动化、快捷键等 DSH 域服务 | **本地仍可继续补齐的缺口**。插件自己的 Node 文件/网络/子进程逻辑可运行，但 Town 尚未提供全部对应 DSH 服务及其 UI 插槽。 |
| 完整 Connection / Typert | 尚无 DSH WebSocket/连接代际协议、context/lookup/resource 作用域、双向 uplink、二进制投影与完整错误分类。当前仅提供上述本地 direct/事件/单向流子集；不应把它当完整 Gateway。 |
| Profile / configEditor / 插件清单服务 | 未实现 DSH 全局 profile 编辑、原生配置文档格式、任意配置树热编辑、市场搜索和 HMR。Bundle 可配置自己的行，不能 patch 不存在的 Harness 内置行。 |
| 主题完整 API/视觉完全一致 | CSS 变量和常用主题操作可用，但 Town DOM 与排版不同，inspect token 元数据不是原版完整语义目录。语言偏好目前也不改变 Town 自身全部文案。 |
| 私有 DOM、desktop preload / IPC | 硬编码 Harness 页面结构或其桌面私有接口的插件需要适配；Being iframe 不开放任意 DOM 修改。 |
| 任意 HTML 改写/CSP | tapIndex 只接入 head/body 贡献，不替换整个 Town 文档。内联事件、eval、运行时拼接的相对 import、任意外站脚本仍受限制。 |
| 完整升级健康检查 | 宿主启动失败自动回退；仅前端启动失败时会停用新版，不自动恢复旧版。 |

## 桌面适配

插件提供能力，Town 保留桌面布局与恢复入口。全局启动动画与壁纸仍可作用于整个页面；插件侧栏、主面板、右栏则装入 Town 管理的界面，不逐像素复制 Harness。

- 插件入口直接显示在左侧主导航，不再使用“插件工具”抽屉；紧凑模式保留插件图标，纯文字按钮使用统一后备图标，悬停和键盘聚焦显示名称。只有主题、启动动画或设置分区时不占导航位置。安装后即时出现，列表与 Town 导航一起滚动，管理入口保留在设置／工具库。右栏在窗口宽度不足 1100px 时不挤压聊天内容。面板使用不透明背景，避免壁纸插件让设置文字难读。
- 设置关闭按钮始终由 Town 提供；Escape、Tab 循环与焦点恢复可用，背景 Town 暂停接收键盘/鼠标。设置使用普通层，让插件的全屏预览和模板编辑器能够显示在上方；它们保留自己的键盘行为。
- 通用配置表单保护未保存更改，逐字段记录 JSON 错误，不能通过编辑其他字段绕过校验；插件自带设置的草稿策略仍由插件自己实现。
- 暗色主题使用白色 Town 标识；插件标题允许换行，关闭/返回入口不随长表单滚动。
- 外观与阅读的明暗指示跟随实际插件主题；点击客户端浅色/深色会明确切回内置配色。针对 VS Code Themes 1.x 的独立持久化和启动恢复定时器，适配层同步其选择记录，避免旧主题重新覆盖客户端选择。其跨深浅预览卡片的收藏按钮使用独立配套背景，以保持可见性；未改写社区插件包。

这些是异步失败与界面边界的恢复措施，不是第三方 JavaScript 的沙箱。同步死循环、直接修改 Town DOM 或恶意全局样式仍可能影响整个渲染进程；原生紧急停用快捷键不依赖页面响应。任意插件仍不具备无条件稳定性保证。

## 数据

全部使用 Town 用户目录的 `third-party-plugins/`：`plugins.json`、独立包副本 `packages/`、`DSH_HOME=data/`、配置 `data/config-forms.json`、有大小上限的 `host.log`。不读写已有 `~/.dsh`。卸载保留配置及包副本；重新安装可恢复配置。

## 测试与复现

社区插件的版本、实测结果和已知问题保存在[历史验收记录](../docs/archive/DSH-COMMUNITY-VALIDATION.md)。以下命令用于验证当前代码。

```sh
npm run typecheck
npm run test:dsh-contract
npm run test:dsh-lifecycle
DSH_THEME_PLUGIN_DIR=/path/to/dsh-vscode-themes2 npm run test:dsh-appearance
DSH_BOOT_SUITE_DIR=/absolute/path/to/dsh-boot-suite npm run test:dsh-ui
DSH_COMMUNITY_DIRS=/path/to/native-theme/plugin:/path/to/vscode-themes:/path/to/pomodoro DSH_TEST_CONTRACTS=1 npm run test:dsh-community
npm run test:settings-navigation
```

`DSH_COMMUNITY_DIRS` 按系统路径分隔符拆分（macOS/Linux `:`，Windows `;`）。Electron 测试共用互斥锁，按顺序运行。`DSH_TEST_CONTRACTS=1` 额外安装 Town 测试包，验证 store/actions、国际化、嵌套插槽、主面板、通用配置与单个坏资源不影响其他模块；另包含无效 JSON、未保存离开、焦点/Escape、自定义侧栏、抛错入口/组件、永不结束的启动钩子、连续启停与其他插件入口恢复；这是契约夹具，不算社区插件样本。`DSH_TEST_DEV=1` 可验证开发 HTTP 路径。

`test:dsh-lifecycle` 使用真实 Cordis 和独立 slot renderer，在受控宿主快照上覆盖停用后的侧栏回退、当前面板清理、重新启用、卸载重装、更新、页面重载、正常实例保留、全局注入待重载期间的入口隔离，以及 root 注册竞态。`test:dsh-contract` 自行构建临时宿主，不依赖工作区已有 generated 产物；同时覆盖客户端 Remote namespace 的共同持有和按贡献释放。

`test:dsh-appearance` 在隔离 Electron 配置中安装原版 VS Code Themes，验证 Dracula / GitHub Light、13/21 阅读字号、页面导航、重载、设置选中状态、侧栏/弹窗配色、聊天 iframe 主题同步、恢复内置配色与再次应用插件主题，以及收藏图标对比度。

宿主测试覆盖真实子进程、鉴权、精确/前缀路由、依赖生命周期、配置与 secret、更新回退、显式构建、混合注入、module 重定位、Remote、group/isolate/表达式，以及超过 30 秒的流与取消。

参考基线：[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.1-rc.5)。
