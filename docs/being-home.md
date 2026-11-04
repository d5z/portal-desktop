# Being Home 云电脑

接入依据：[Being Home 客户端对接文档](https://d5.feishu.cn/docx/HXjcdWmProQqFkxlvducqR0Jn4g)，2026-11-03 通过 Lark CLI 读取 revision 51，采用第 14 节「客户端直接接入云电脑画面流（新增方案）」。同时核对当前部署的 `/browser-client.js`、`/live-view.js` 和真实浏览器状态。

固定服务为 `https://home.beings.town`，公共桌面客户端 `being-desktop`，OAuth 回调为 `http://127.0.0.1:47831/oauth/callback`。

## 使用流程

点击聊天顶部 Being 名称，进入「电脑」。首次连接通过系统浏览器登录 Home。客户端用 Heart origin 和 heart_being_id 对照当前 Loom 连接；不同账号不能打开当前 Being 的电脑。未初始化或关联时提供对应操作，关联前展示账号和 Being，由用户确认，不覆盖已有绑定。

信息栏保留「详情 / 动态 / 资料库 / 电脑」四个 Tab，场景动态仍为独立页。分栏使用 20px 拖拽热区和细线渐显反馈，原生画面旁留出实际拖拽空间。资料页的刷新按钮只更新状态；需要重建查看会话时，从更多菜单选择「重新连接浏览器」。

休眠时点击「唤醒」。浏览器就绪后，小窗口直接显示实时画面；悬停或键盘聚焦显示遮罩与居中的「放大展示」。点击后进入独立右侧面板，可调整宽度、收起或展开对话，关闭面板后回到原有资料页布局。

面板显示浏览器画面和「仅观看 / 接管浏览器」控件，接管后可点击、滚动、输入中文或粘贴文本，再交还 Being。画面等比适应可用区域，留白随客户端明暗主题变化。连接阶段使用呼吸动画，遵循减少动态效果设置。

单次输入或粘贴超过 4000 字符时提示分段输入，整段不发送，避免静默截断后执行不完整内容。

切换标签或收起面板保留同一个画面会话，同时释放人工控制权。再次显示时默认观看。明确关闭浏览器、退出 Home、切换 Being 或服务端会话失效才清理会话。停止、恢复等操作仍位于资料页更多菜单。

资料库保持空态，留给后续真实生成的 HTML 和文件。本次不接文件列表或任务列表。

2026-11-03 另核对文档 revision 52 的第 7 章：工作空间可通过 `GET /v1/me/files?path=…` 列目录、`GET /v1/me/files/content?path=…` 读取二进制内容，所需权限为 `files:read`。该服务独立于电脑运行；资料库后续应单独接入这些接口与隔离预览，不通过画面流同步文件。当前客户端未申请文件权限。

## 接口与会话

1. Native OAuth 获取身份，核对 Home / Heart 绑定及电脑状态。
2. `POST /v1/me/computer/desktop-ticket` 获取一次性查看票据。
3. 主进程在独立 Electron Session 中请求票据地址 `/desktop/connect?ticket=…`，接收 `bh_desktop` HttpOnly、Secure、SameSite=Strict Cookie，校验重定向目标后停止；不加载远端 Home HTML。
4. Cookie 与固定 Home Origin 用于以下私有桌面接口：

| 接口 | 用途 |
| --- | --- |
| `GET /desktop/{computer_id}/browser/state` | 就绪状态、画面尺寸、控制租约、`live_view` 能力 |
| `WSS /desktop/{computer_id}/browser/stream` | RFB 二进制实时画面 |
| `POST /desktop/{computer_id}/browser/control` | `claim`、`renew`、`release` |
| `POST /desktop/{computer_id}/browser/action` | 校验后的点击、滚动、按键和文本输入 |
| `GET /desktop/{computer_id}/browser/frame` | 仅当旧实例未提供 `live_view` 字段时兼容 JPEG |

画面流使用 noVNC 只读解码，输入通过 JSON action 提交。声明支持 RFB 的实例发生连接错误时重连，不偷偷退回截图轮询。断线不会重放输入或自动接管。401/403/410、Cookie 失效及流关闭码 4001 会清理查看会话。

这套接口是文档新增的桌面 Cookie 协议，不是通用 Bearer WebSocket；已有的 `/v1/me/computer/live-view-session` 属于另一套只读协议。

## 实现边界

- `desktop/main/home/client.ts`：PKCE/OIDC、固定 loopback 回调、签名/nonce/issuer/audience 校验、刷新合并、凭据加密持久化及撤销。与 Loom 凭据分离。
- `service.ts`：归属校验、电脑状态、异步操作、幂等唤醒/停止/恢复；阻止切换 Being 后的迟到响应。
- `transport.ts`：主进程持有 Cookie、HTTP 与 WSS；验证输入、控制租约与队列；串行发送且不重放；有界流缓冲和 IPC ACK 背压。
- `viewer.ts`：同一个本地 WebContentsView 在小窗口、右侧面板和隐藏宿主间移动；保持 Session 与流连接。限制导航、网络、权限和下载；IPC 只接受该本地页面的主 frame。
- `desktop/preload/home-viewer.ts` / `desktop/shared/home-viewer.ts`：专用最小桥，只传状态、帧字节与允许的操作；不暴露 Cookie、票据、URL 或应用通用 API。
- `desktop/renderer/home/`：客户端自己的本地页面、noVNC 只读 canvas、hover 遮罩、加载状态和接管按钮。CSP 禁止 renderer 联网，按真实画面边界映射坐标，拒绝留白区点击。
- `BeingComputer`：原资料布局、独立面板、操作确认、主题与视口尺寸；菜单遮挡时使用内存截图占位。

没有向远端 Home 页面注入 CSS 或 JavaScript，也没有通过裁剪隐藏远端按钮。客户端根本不加载该页面，只显示画面流；画面里的 Chrome 网页内容仍由云端浏览器决定。

`node scripts/build-home-viewer.mjs` 生成本地 viewer、专用 preload 和第三方许可证；桌面准备脚本自动执行该构建。

## 验证

```sh
npm run typecheck
npx vitest run tests/home.test.ts tests/home-stream.test.ts
node tests/home-computer-ui.mjs
node tests/home-viewer-electron.mjs
```

Electron 集成测试使用临时 profile、回环 HTTPS/WSS 和精确测试证书 pin，不改变生产证书校验。覆盖一次票据兑换、Cookie/Origin、零远端 HTML 加载、真实 RFB 多帧解码、原生鼠标坐标、中文输入协议、控制领取/续租/释放、布局切换保留、断线不重放和会话过期清理。

2026-11-03 使用 Computer Use 在真实客户端验证了云端 Chrome 画面、小窗口放大、接管、中文粘贴、Ctrl+A、交还控制和收起对话。生产停机、重建及文件持久化没有在本轮执行；旧实例 JPEG 分支未做真实服务验收。

## 2026-11-03 接入复查

复查覆盖身份与绑定、票据兑换、Cookie 隔离、RFB 展示、输入映射、接管租约、布局切换、断线及关闭清理。

本轮修正：

- 原生视图切换宿主或布局后主动重新适配画面，同时覆盖预览/放大、隐藏恢复与客户端缩放；浏览器面板采用与标题区一致的内边距。
- 布局 effect 清理不再发送一次虚假的隐藏状态。收起/展开对话不释放正在使用的接管权；实际隐藏、切换标签仍交还控制。
- 续租不清空排队输入；隐藏期间才返回的接管请求主动交还；明确关闭查看器会先尝试释放租约，再清理 Cookie（最多等待 3 秒，不阻塞界面）。
- 断线恢复后不自动接管，但本会话仍拥有的服务端租约不再被误标为「其他窗口接管中」，用户可主动重新接管。
- 删除正常预览时每 4 秒的重复截图轮询，仅保留呈现切换时的占位快照；稳定状态下账号/电脑查询降低至 15 秒，操作进行中仍为 3 秒；布局观察合并到每帧一次。

保留现有认证和安全隔离设计，也保留客户端的导航、资料页与聊天布局。未改远端页面，未加入新的全局主题或布局规则。断网或进程被强制结束时，服务端租约最终仍依赖自身超时释放。

## 2026-11-03 云端资料库接入

本节更新前文「资料库保持空态」「当前客户端未申请文件权限」的阶段性记录。实现依据为同一份 [Being Home 客户端对接文档](https://d5.feishu.cn/docx/HXjcdWmProQqFkxlvducqR0Jn4g) revision 52 第 7 节，2026-11-03 经 Lark CLI 读取，并核对生产 OpenAPI schema。

点击聊天顶部 Being 名称，进入「资料库」即可浏览云端工作区。支持目录面包屑、当前文件夹名称搜索、刷新，以及文件夹优先、名称排序；提供加载、操作中、空目录、无匹配结果和错误重试状态。未登录或权限不足时可前往「电脑」栏处理。文件服务独立于电脑电源状态，不需要唤醒电脑。

- 资料库仅展示工作区内容并提供预览、下载，不提供上传、新建目录或其他云端写操作。下载通过原生保存对话框，由主进程流式写入并原子保存。
- OAuth 文件权限仅申请 `files:read`；旧会话可能需要在「电脑」栏退出 Home 后重新登录授权。
- 不超过 8 MiB 的文件可预览文本、栅格图片、PDF、XLSX、PPTX。列表已知文件超限时直接提示下载，不请求预览内容。HTML 提供隔离交互预览与源码切换，允许脚本、外部网页资源和网络请求；不支持的格式可下载查看。
- 主进程核对 Home / Heart 归属并校验路径，凭据不传给 renderer。目录导航和预览关闭会丢弃各自的迟到响应；退出登录或身份切换会清空资料状态并使旧操作结果失效。

界面沿用现有 Being 资料栏与 Tab 布局。组件私有样式放在相邻的 SCSS Module，使用 `_tokens.scss` 的 `--surface`、`--text`、`--secondary`、`--line`、`--hover` 和 `--selected` 适配明暗主题；标题和正文密度延续 `_workspace.scss` 的资料栏层级。预览复用附件与本地文件共用的右侧 `FilePreviewPanel`、关闭按钮和焦点规则，遵循 `desktop/renderer/STYLING.md` 的作用域约定；没有建立新的全局视觉体系。HTML 内容使用独立白色画布，不改变宿主主题。

主要文件：

| 文件 | 职责 |
| --- | --- |
| `desktop/main/home/files.ts` | 文件接口、路径校验、大小限制、原生选择与保存 |
| `desktop/main/home/client.ts` / `service.ts` / `ipc.ts` | 文件权限、身份归属及 IPC 注册 |
| `desktop/preload/preload.ts` / `desktop/shared/home.ts` | 主 frame 文件桥与类型契约 |
| `desktop/renderer/app/models/home-library.ts` | 目录、操作、预览状态及迟到响应丢弃 |
| `desktop/renderer/app/components/home-library.tsx` / `home-library.module.scss` | 资料库交互与局部样式 |
| `desktop/renderer/app/components/home-file-preview.tsx` | 格式分发、已有文档预览组件复用及 HTML 隔离 |

当前实现验证记录：

```sh
npm run typecheck
npx vitest run tests/home-files.test.ts tests/home.test.ts tests/home-stream.test.ts tests/architecture.test.ts
node tests/home-library-ui.mjs
node tests/home-files-electron.mjs
node tests/menu-keyboard.mjs
node tests/settings-navigation.mjs
node tests/update-progress.mjs
npx vite build --config vite.renderer.config.ts
```

上述检查已通过，Vitest 共 45 项。UI 测试使用合成 Chrome fixture，覆盖明暗主题、窄栏、搜索、目录导航、下载、静态 HTML、Escape 与焦点恢复、竞态和退出登录，并确认没有上传、新建目录入口。Electron 测试运行实际 preload 与 IPC，模拟原生对话框和凭据，覆盖二进制保存、子 frame 隔离，确认文件请求均为 GET，且不调用电脑接口。Renderer 构建通过，保留已有 chunk 体积提示。没有使用生产账号执行下载，也未验证真实操作系统保存对话框。

Grok Bot 的资料库交互参考为文件列表、点击预览、HTML 预览/源码切换及下载。Home 文件接口只返回名称、路径、类型和大小，因此目前按文件夹及名称展示，没有虚构 Grok 中的日期分组。

初始化设置入口问题：`Topbar` 的设置菜单和更新入口通过 `createPortal` 挂载到 `document.body`，不受 `#client-main[hidden]` 影响。现在仅在 `startup === 'ready'` 时挂载这些控件；加载、失败及重试期间不显示，应用快捷键也等待初始化完成。菜单与完整 shell 测试覆盖这些状态，并验证恢复后的设置和更新交互。Review 还修复了下载目标无法打开时的响应流释放，并增加回归测试。

可用 `npm run test:home-files` 重跑资料库的单元、浏览器交互与 Electron IPC 测试；两个集成测试已加入 `test:all`。新增 SCSS 的 Stylelint 与格式检查通过。Home 查看器样式也由 SCSS 构建，纳入 `tests/styles-build.test.ts` 的文档入口检查。

## 对话中的文件交付

共用的 Markdown 消息组件识别 `being.files` v1 JSON，包括纯 JSON、说明文字中嵌入的完整对象、JSON 代码块及一条消息中的多份交付；用文件卡片替换整个 JSON 区段，保留前后正文和 Markdown 引用。卡片显示名称、文件名、可选大小和说明。协议参考：[文件交付链路测试](https://beings.town/seeds/8U2i97peLWZSSLJf-QqDg)。流式输出完成前显示接收状态；格式错误、未知版本或 URL 与 path 不一致时显示错误并保留原文，不提供文件操作。

卡片和普通 Markdown 中的 `https://home.beings.town/v1/me/files/content?path=…` 链接都在客户端内打开，不能直接跳转浏览器。只接受固定 HTTPS Home 接口；路径按 URL 查询参数解码一次，并与消息中的相对路径核对。聊天 iframe 只传递路径和当前 revision，宿主核验来源后复用资料库的 Home 文件 API、预览窗口与下载按钮。主进程使用当前 Home 登录 token 添加 `Authorization: Bearer …`，不使用 Heart token，不把凭据传给消息、iframe 或文件内容。

HTML 使用隔离交互预览，可切换源码或下载原文件。登录状态、Home 身份或聊天连接变化时关闭旧预览并丢弃迟到响应。原始交付信息中的 size/sha256 是发送方元数据，不表示客户端已完成完整性校验。

回归验证：`tests/being-files.test.ts`、`tests/being-files-ui.mjs`、`tests/home-files.test.ts`、`tests/home-files-electron.mjs`、`tests/home-library-ui.mjs` 与实际构建的 `tests/chat-react.mjs`。使用合成文件与隔离登录凭据，不读取生产用户文件。


文件交付卡片的标题、大小和说明现在属于同一个按钮，hover、按下与键盘焦点覆盖完整卡片，点击说明也可打开。Home 资料库、聊天交付和本地附件共用 `file-preview-panel.tsx`，默认在对话右侧预览，可拖动宽度、展开全部、恢复对话和关闭；窄窗口使用可用宽度。保留 Home 认证、HTML 权限隔离、源码和下载，同一时间只显示一个文件预览。


## 2026-11-04 文件加载态与 HTML 跳转

文件读取和预览组件加载时使用居中的 22px 进度指示与 13px 次级文字，适配明暗主题；减少动态效果设置下停止旋转。

云端 HTML 改为独立的 `beings://preview/runtime.html` 文档，避免继承客户端 shell 禁止脚本和网络的 CSP。云端及本地 HTML 均允许网页脚本、HTTP(S) 资源、网络请求、表单及弹窗。普通链接、`_blank` / `_top` 链接、`window.open` 和页面跳转通过主进程现有网页打开逻辑处理，保留左侧工作区；页内锚点正常使用。预览仍保持不透明源，无 Node、客户端 IPC 或父页面访问权限。

`tests/html-preview-electron.mjs` 使用实际主窗口导航处理及协议响应验证上述行为；外部资源来自本地测试服务器，外部打开动作被记录，不启动真实浏览器。


浏览器与文件预览统一占用右侧分栏：文件中的链接打开浏览器时关闭文件预览，重新打开文件时关闭浏览器，最多保留左侧工作区与右侧内容两栏；其他辅助栏暂时收起，关闭右侧内容后恢复。浏览器复用 `PanelResizeHandle` 的 20px 拖动区域、键盘调整及双击复位，宽度记忆使用 `usePanelWidth`。拖动期间隐藏原生网页视图，结束后按实际分栏位置更新原生画面，避免原生层截获拖动。`tests/preview-browser-split.mjs` 覆盖最大化文件打开链接、右侧原生网页、鼠标拖动、键盘调整、双击复位、文件/浏览器互换、窄窗口及草稿保留。
