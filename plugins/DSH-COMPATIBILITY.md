# Town 的 DSH 插件兼容层

Town 使用自己的 Electron 外壳、导航、工具库和 Being 聊天界面。兼容层接入 DSH 独立发布的 Cordis Loader、slot renderer、store、配置表单与 UI primitives；不启动 Harness 应用，不调用 Harness 的主界面 mount，不创建虚假的 Being/DSH Session。

对照基线：DSH **0.2.1-rc.5**，源码 commit `b830ec950faba0a46dda564be3e2d854afed94f1`；Cordis **4.0.5**、Loader **1.0.6**、Include **1.0.10**。`engines.dsh` 检查通过只表示版本范围匹配，不表示所有 DSH 服务都存在。

## 安装和设置

入口：**工具库 → Plugin → DeepSeek Harness 插件**，或 **客户端设置 → 插件 → DeepSeek Harness 插件**。Kit 中直接内嵌管理页；从客户端设置进入时使用同一管理界面的浮层。Town 原有接口插件在旁边的「Town 插件」页管理，仍使用原来的 Plugin SDK。

支持 npm 包名/指定版本、Git URL、本地目录和 npm `.tgz`。依赖安装到独立目录，Git 来源需要本机 Git。先下载并读取清单，再确认安装；默认不执行生命周期脚本，确认框可选择允许该包及其依赖执行安装/构建脚本。构建通过 `npm rebuild` 执行；依赖必须适配当前系统和宿主 Node，源码包如只提供独立构建命令仍需先自行构建。第三方宿主具有本机 Node 权限，界面代码运行在 Town 主页面。

安装前会检查清单中的 DSH 版本和平台。确认安装或启用后，若缺少宿主服务或客户端依赖，管理页会直接定位到插件，并列出缺少的能力。首次安装的包会保留，但启动失败时自动停用并保留原因。补齐依赖后可以重新启用。Town 启动时发现插件未能加载，也会提示并停用该插件。

插件设置保留在 **设置 → 插件** 内，官方插件标签排在最前，DeepSeek Harness 插件使用同一设置导航。点击列表行原地展开原版配置，Kit 中的配置入口也定位到这里，不另开管理页。旧命名空间与 bundle 设置席位对同一 key 的重复注册只显示 bundle 入口，自动表单放在「高级配置」中。更新与卸载收进「管理」，搜索和状态筛选保留；自动配置表单在关闭、切换分类或插件时提示未保存更改。

优先显示插件自己注册的设置组件；声明 `Config` 且允许自动配置的命名空间，另外提供 schema 驱动的通用配置表单，支持字段保存、恢复继承值、校验、版本冲突和 secret 脱敏。`settings.configure({ auto: false })` 可隐藏自动页面。Town 不为每个插件硬编码专属设置。

安装、更新、启停、卸载重建独立宿主，前端串行对账：释放被移除或替换的客户端及依赖它的模块，加载新增模块，保留未受影响的客户端实例。通过 Cordis effect 管理的插槽、事件、Remote 方法等随插件清理；停用当前主面板会返回 Town，重新启用恢复入口。新安装的资源按内容去重。移除或替换已注入的全局脚本、样式、HTML，以及客户端清理失败时，仍提示“重新加载页面”；只限制相关插件，其他插件入口与设置保持可用。重新加载前保留草稿。配置表单直接更新对应 Cordis fiber；volatile 引用更新遵循 Cordis 行为。第三方脚本遮挡页面时可按 **Ctrl/Cmd + Alt + Shift + P** 停用全部第三方插件并重新加载。

## 已接入的能力

| 能力 | Town 实现及验证范围 |
| --- | --- |
| 包清单、客户端模块 | `dsh.client`、`exports["./client"]`、web/all 平台、模块依赖排序、immediately 优先；依赖包内的客户端也可发现。缺少模块或服务会明确报告。 |
| Bundle / Loader | 使用原生 `applyEntryPatches` 和 Loader：insert、id 覆盖、独立行配置、嵌套 group、disabled、inject、isolate、intercept、`!!js` 表达式。表达式在宿主激活时求值。单包最多 100 行。 |
| Cordis 生命周期 | apply、Config、服务注入/提供、事件、effect/dispose、原生 timer；消费者可等待后安装的提供者。 |
| HTTP / Fetch | `webServer.register`、Node req/res、exact 优先及最长 prefix；`connection.fetch.register` 适配 Fetch Request/Response；query、请求体、流式响应和取消。监听回环地址，通过 Town 主进程私有令牌代理；apply 阶段可读真实 host/protocol/port/getOrigin。connection.authenticatedUrl 提供启动链接，根路径兑换 HttpOnly/SameSite cookie，校验 Host/Origin；未认证返回 401，来源不合法返回 403。 |
| 页面注入 | 宿主将 global/style/html/script/script-src/script-preload 合成页面并执行 tapIndex，再统一输出 HTML 与同源 script-src 给前端；保留插件去重逻辑、嵌套脚本及 module 类型。 |
| HTML 与 module | 插件 HTML / srcdoc 的可执行内联脚本转为同源资源；相对静态 import、字符串形式动态 import、import.meta.url 按原文档地址重定位；JSON script 保留为数据。 |
| Slot / store | 原生 renderer、ui-slots、store：注册与注销、children、store/actions、locale、inject、root hooks、过滤、keyed 入口和错误边界。无需复制一套简化的 slot React props。 |
| Town 挂载位置 | settings.section/general.item/plugins.tab/header/action/close/trigger/launcher/onboarding，plugins.bundle.config、settings.plugin.item，main、sidebar/panellist/footer/footer.action、rightbar、shell.overlay/overlay/app.overlay。Town 提供入口、关闭、导航与布局状态。 |
| 布局 | `layout.panelInfo`、selectPanel、beginNavigation、toggleSidebar、openRightbar/closeRightbar。插件的紧凑侧栏入口直接挂载在 Town 左侧主导航，与篝火、围炉共用滚动列表；保留原生插槽上下文与点击行为。Town 主导航始终可见，toggleSidebar 适配为滚动并聚焦插件入口，不折叠整条导航。右栏在宽窗口预留空间，窄窗口作为浮层；提供标题、展开/还原和关闭操作，内容独立占满剩余高度，`rightbar` 的 `owner.width` 随实际容器宽度更新。主面板保留返回 Town。 |
| 配置服务 | 本地 settings 与 `remote.settings`；DSH 原版 configForms/settingsSchema；每个 Loader 行独立命名空间、持久化 revision、冲突拒绝、嵌套继承、secret 脱敏。支持普通 Config 的 Town 扩展，不等同于完整 DSH profile/configEditor。 |
| 本地 Remote | 插件显式装饰的 direct 方法，客户端 `$mount`、JSON 请求/响应、单向结果流与取消、`$on` 事件订阅。同一 namespace 可由多个插件贡献不同方法，按贡献释放并取消其请求；重复方法明确报错。未装饰的方法不可通过此通道调用。 |
| 主题与字体 | 主题注册、light/dark/system、可释放 token 覆盖层、偏好持久化、字体角色与字号边界；提供基线 DSH 颜色/排版/阴影变量。Town 统一呈现明暗模式，阅读字号和导航不切换主题；插件调色板映射到侧栏、弹窗、控件、选中态和聊天 iframe，撤销时清除旧覆盖。`tokens.scss` 仅提取 MIT 许可的主题变量，未引入 Harness 布局和全局 reset。 |
| 国际化 | 字典注册、稳定 bind、插值、公共命名空间回退、语言包 addLanguage、语言链、resolveText、snapshot/subscribe；字典刷新不会错误触发语言切换事件。 |
| 通用组件 | 独立 ui-primitives 按需加载；对应图标、代码高亮、Markdown/公式依赖随客户端打包。 |
| 全局视觉 | 动画、壁纸、浮层作用于 Town 主页面；Being 聊天 iframe 同步颜色与字体变量，共用壁纸背景。插件管理采用可搜索、可筛选的列表；设置嵌在客户端设置页内，复用其分类导航和内容滚动。安装、命令与面板、兼容说明按需展开，没有额外模型设置页。插件设置、主面板、右栏及浮层的复选框不套用 Town 滑动开关样式，保留插件原生控件。 |
| 系统通知 | 主页面浏览器 Notification 权限跟随 Town 通知总开关；其他页面/iframe 不获得权限。实际通知仍取决于操作系统授权。 |
| 命令与客户端交互 | 本地文本 commands、commandUi popupSelect、sidebarRightTabs/sidebarRight、sidebar.right.pane.tab、默认 shortcuts、冲突报告、输入区域/弹窗约束及卸载清理；uiSettings.openSection 与 Town 场景跳转。 |
| 插件模型与语音 | agentDefaultModel、credentials、attachments、llm 子集。先检查 Being 当前模型；当前 Being 仅有主对话接口，无法独立生成，因此回退到现有 subagent 配置。支持 OpenAI Chat Completions 兼容协议的文字/图片流；图片仍要求模型支持视觉。语音转写没有可复用配置，明确提示未适配。 |
| 原生辅助进程 | 与 Harness 一样由插件使用 Node 启动自己的程序，Cordis disposer 负责清理。透明窗口、托盘、IPC 由插件原生程序实现；宿主不加载社区包内部模块、不识别包名。Electron 等运行时由插件声明或自行准备。 |
| Town 状态事件 | 所有插件可读取 townActivity.getSnapshot 并订阅 town/activity；另提供最小完成/失败事件，不传正文、不重放初始状态。没有按插件路由写入工作状态，不模拟完整 DSH 会话。 |
| 故障恢复 | 注入资源失败不中断其他插件启动；管理页显示模块/服务/资源错误。宿主崩溃隔离、日志、升级宿主失败回退、紧急停用快捷键。Town 窗口与主界面不等待插件启动；客户端生命周期总等待上限 15 秒，超时请求 Cordis 清理。入口名称异常和插件根界面错误不会替换 Town 页面，管理入口仍可用。 |

图片附件引用遵循 Harness 的 `sha256:<64 位小写 hex>` 格式；`imageHostPath` 将引用映射到本地附件对象。原版 dsh-pet 的图片发送、历史取图和宿主冷启动后再次取图均有集成回归。早期未发布适配产生的无前缀测试引用不属于此契约；宿主不改写第三方插件私有历史。

## 尚未达到等价的部分

以下区分本地兼容层欠缺和必须连接 Being 才能实现的能力；**不能宣称所有 DSH 插件或所有功能都已兼容**。

| 剩余能力 | 原因与当前行为 |
| --- | --- |
| DSH Agent / Session / Turn、消息树、执行钩子、Prompt 上下文 | Being 会话与执行由远端 Being 服务拥有，需要明确协议桥接。root 插槽可用，但指定 DSH session 作用域会明确拒绝，不模拟会话。 |
| Provider 完整协议、工具执行/权限、MCP | 复用 subagent 的 OpenAI Chat Completions 文字/图片流；Anthropic Messages、OpenAI Responses、Google Generative AI、OAuth、工具调用与语音转写尚未接入，不复用 Harness 登录态或 Being 服务端密钥。 |
| 文件/Workspace、终端、任务、自动化等 DSH 域服务 | **本地仍可继续补齐的缺口**。插件自己的 Node 文件/网络/子进程逻辑可运行，但 Town 尚未提供全部对应 DSH 服务及其 UI 插槽。 |
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
- 外观与阅读的明暗指示跟随实际插件主题；点击客户端浅色/深色调用公开 theme.setTheme。插件自行恢复的偏好仍由插件拥有，可能在启动后再次调用 setTheme；Town 不改写第三方私有存储键，也不为特定插件 CSS 类打补丁。

这些是异步失败与界面边界的恢复措施，不是第三方 JavaScript 的沙箱。同步死循环、直接修改 Town DOM 或恶意全局样式仍可能影响整个渲染进程；原生紧急停用快捷键不依赖页面响应。任意插件仍不具备无条件稳定性保证。

## 数据

全部使用 Town 用户目录的 `third-party-plugins/`：`plugins.json`、独立包副本 `packages/`、`DSH_HOME=data/`、配置 `data/config-forms.json`、有大小上限的 `host.log`、历史加密服务配置 `services.enc`（桌面产品不再读取或写入，保留旧文件）和图片附件 `data/attachments/`。宿主不读写已有 `~/.dsh`。插件自行启动的程序可按自身逻辑使用系统应用数据目录，不能据此认为原生辅助进程也受 DSH_HOME 约束。卸载保留配置及包副本；重新安装可恢复配置。

## 测试与复现

当前管理界面的操作与截图见[插件管理优化验收](../docs/dsh-manager-redesign-2026-11-04.md)。

社区插件的版本、实测结果和已知问题保存在[历史验收记录](../docs/archive/DSH-COMMUNITY-VALIDATION.md)。以下命令用于验证当前代码。

```sh
npm run typecheck
npm run test:dsh-contract
npm run test:dsh-pet-host
npm run test:dsh-lifecycle
DSH_THEME_PLUGIN_DIR=/path/to/dsh-vscode-themes2 npm run test:dsh-appearance
DSH_BOOT_SUITE_DIR=/absolute/path/to/dsh-boot-suite npm run test:dsh-ui
DSH_COMMUNITY_DIRS=/path/to/native-theme/plugin:/path/to/vscode-themes:/path/to/pomodoro DSH_TEST_CONTRACTS=1 npm run test:dsh-community
npm run test:settings-navigation
```

`DSH_COMMUNITY_DIRS` 按系统路径分隔符拆分（macOS/Linux `:`，Windows `;`）。Electron 测试共用互斥锁，按顺序运行。`DSH_TEST_CONTRACTS=1` 额外安装 Town 测试包，验证 store/actions、国际化、嵌套插槽、主面板、通用配置与单个坏资源不影响其他模块；另包含无效 JSON、未保存离开、焦点/Escape、自定义侧栏、抛错入口/组件、永不结束的启动钩子、连续启停与其他插件入口恢复；这是契约夹具，不算社区插件样本。`DSH_TEST_DEV=1` 可验证开发 HTTP 路径。

`test:dsh-lifecycle` 使用真实 Cordis 和独立 slot renderer，在受控宿主快照上覆盖停用后的侧栏回退、当前面板清理、重新启用、卸载重装、更新、页面重载、正常实例保留、全局注入待重载期间的入口隔离，以及 root 注册竞态。`test:dsh-contract` 自行构建临时宿主，不依赖工作区已有 generated 产物；同时覆盖客户端 Remote namespace 的共同持有和按贡献释放。

`test:dsh-appearance` 在隔离 Electron 配置中安装原版 VS Code Themes，验证 Dracula / GitHub Light、13/21 阅读字号、页面导航、重载、设置选中状态、侧栏/弹窗配色、聊天 iframe 主题同步、恢复内置配色与再次应用插件主题。第三方内部控件和独立持久化行为由插件拥有，不属于宿主修补范围。

宿主测试覆盖真实子进程、鉴权、精确/前缀路由、依赖生命周期、配置与 secret、更新回退、显式构建、混合注入、module 重定位、Remote、group/isolate/表达式，以及超过 30 秒的流与取消。

参考基线：[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.1-rc.5)。

SDK 包 1.6 在 [dsh.d.ts](sdk/dsh.d.ts) 导出 Town 支持的 DSH 服务子集。它们属于 Cordis，不属于 `window.grove`；Grove 运行时版本仍为 1.5。

## 通用扩展原则与原生辅助进程

参考实现：[DSH WebServer](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.5/packages/host/webserver/src/index.ts)、[Connection](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.5/packages/client/connection/src/rpc-host.ts)、[快捷键契约](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.5/packages/client/shortcuts/src/client/types.ts)。

业务包只注册能力，不在宿主添加 `if (plugin.id === ...)` 分支。主程序不加载插件的私有 preload/main 文件，不更改私有环境变量，不代写私有 localStorage，也不调用业务路由。缺失能力由 inject 和实际接口调用暴露，支持范围见 SDK。

插件自身需要原生 UI 时，可沿用 Node 辅助进程方案：

```ts
export const inject = ['webServer', 'connection'];
export function apply(ctx) {
  const origin = ctx.webServer.getOrigin();
  const launchUrl = ctx.connection.authenticatedUrl(origin);
  // 使用已声明/准备的运行时启动插件自己的程序，不把窗口实现交给宿主。
  const helper = startOwnHelper({ launchUrl });
  ctx.effect(() => () => helper.stop());
}
```

`startOwnHelper` 是插件自己的实现，不是 Town SDK 方法。启动链接仅供本地程序使用，不要写入日志；有效期为当前宿主进程。根页面会唤起 Town 主窗口，不向外部浏览器复制整个客户端。硬编码其他应用的自定义协议、调用任意 Electron 私有 IPC、缺少 disposer 的独立进程，均无法仅凭上述公开契约获得相同语义。

回归包含两个不同名称的辅助进程插件，验证 apply 时端口、认证 cookie、跨源拒绝、重启令牌失效、停用清理和另一插件继续工作；社区插件只作为集成样本，不驱动宿主中的名称特判。

### 默认模型选择与配置来源

1. 先读取 Being 当前模型并检查宿主接口是否支持独立生成。当前 Being 合约只有主对话流，不能把插件请求伪装成用户消息。
2. Being 不适配时，读取客户端已有 Portal / subagent 配置；支持 `openai`、`openrouter`、`groq`、`xai` 的 Chat Completions，以及 `portal-custom` + `openai-completions`。沿用配置文件中的 API key 或对应提供商环境变量，凭证仅在本机宿主进程间传递，不回传界面。
3. subagent 停用、未配置、协议不支持或没有可用 API key 时，在设置页与调用提示中说明原因。无需额外配置 DeepSeek 模型。重新打开插件设置会重新读取模型配置，并更新正在运行的宿主；已安装的服务提供者插件仍优先。

以上“支持”指协议适配，不代表已向真实远端模型做付费连通性探测。模型 API 的认证、可用性和视觉能力以实际调用结果为准。
