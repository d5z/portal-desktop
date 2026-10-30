# Town-Client 全局 UI 与交互审查

代码审查日期：2026-10-29；实机竞品交互补充：2026-10-30（Asia/Shanghai）。对象：当前工作区源码，包含此前尚未提交的 UI 与性能改动。初次审查只复现和记录；用户随后要求优化，10 月 30 日已完成下列修复。后文问题详情与评分保留为修复前记录，行号可能随修改移动。

## 10 月 30 日补充：当前设置与全局交互

设置现已改为分类内直接显示/就地展开，原审查中的二级设置导航和“返回”路径作为历史记录保留。实现与最新验证见 [当前交互规范](UI-SKILLS-AND-INTERACTION.md#2026-10-30设置原地展开与全局交互统一)。

本次按下方功能清单复查入口、关闭/返回、焦点、滚动、加载/失败、保存与窄窗口行为，覆盖设置、菜单、对话、文件预览、浏览器、Town 各模块、工具与插件等组件。新增修复：快速切换设置分类被旧状态拉回、模型立即保存可能覆盖其他分类草稿、Town 成功配对后的状态未更新、工作簿键盘切换及更换文件时残留标签索引、通讯录登记短窗口操作可达性，以及全局键盘焦点缺失。普通弹窗与菜单的短动效已共用。

验证等级仍区分源码检查、模拟服务浏览器回归与真实原生验收：本次全量单元测试通过 1156 项、跳过 33 项；主要入口和设置的浏览器回归通过。原生通知/授权、安装包升级、真实供应商连接、大文件极限与整窗拖动性能仍属于下表列出的实机验收缺口，不把源码审查等同于每项真实服务已验收。

## 10 月 30 日修复状态

| 问题 | 当前修复与证据 |
|---|---|
| F1 返回叠窗 | 嵌入页不再挂载旧标题导航；手势跳过隐藏控件和已处理事件。subagent 横向返回只退一层，保留一个原生弹窗 |
| F2 连接草稿丢失 | 在内存中按连接身份保留草稿；分类切换、返回、前进不重置；显示尚未保存与放弃修改，关闭时在原框内确认。切换 Being 不复用旧草稿，关闭清除暂存凭据。此策略针对连接表单，不代表所有模型编辑器的未保存状态均已统一 |
| F3 Town 入口分裂 | Town 页面及鉴权恢复的 `auth()` 统一进入设置容器；离开时沿用配对取消机制。带连接草稿进入 Town 后，继续编辑与放弃关闭均经过正确清理 |
| F4 隐藏浏览器冗余更新 | 关闭时停止布局观察；打开时过滤无关 DOM 变更、去重相同 bounds。隔离夹具 20 轮无关 DOM 更新产生 0 次关闭浏览器布局 IPC；弹窗打开/关闭仍正确隐藏/恢复原生浏览器 |
| F5 Town 标签键盘操作 | 设置与 Town 共用方向键、Home/End 和 roving tabindex；添加页签与面板关联 |
| F6 首屏重依赖 | PDF 引擎首次预览才加载；高亮从 192 种语法收敛至 36 种常用语法，其他代码仍完整展示为纯文本。独立 PDF 回归验证真实像素、错误恢复和重新打开 |

另修复原生 dialog 在连续 Escape 后被关闭、而受控状态仍要求保留的边界；未保存提示与忙碌状态继续保持可见。正式 workspace-layout 夹具补齐插件显式启用的 `visibleSidebarSlots`，完整工作区脚本已通过。

同一 App 入口、相同 esbuild 分包/压缩参数下，通过内存转换仅恢复旧 PDF 与高亮导入做对照：初始 JavaScript **2,535,070 → 1,182,808 bytes（减少约 53.3%）**；高亮代码 **1,080,400 → 161,649 bytes**，初始 PDF 代码降为 0。此为未 gzip 的依赖分析，不是应用安装包大小。生产 Vite 构建也成功生成独立 PDF chunk；主包仍有超过 500 kB 的构建提示，优化并未消除全部首屏工作。

本轮全量单元测试 **1,156 通过、33 跳过**，类型检查、聊天构建、设置导航、Muse 布局专项、完整工作区、chat-react 和 PDF 预览验证通过。新增可复现入口：`npm run test:settings-navigation`、`npm run test:pdf-preview`。截图检查覆盖 1440 × 960 与 435 × 746 的草稿提示，原 Muse 专项另覆盖 760 × 500。

最终追加验证：连续 Escape、带草稿进入 Town 后继续编辑/放弃关闭、原生菜单键盘测试通过；修复通用 Dialog 后重新执行完整工作区通过。关闭本轮预览服务与其他 UI 测试后，独立执行 1,000 条历史流式测试：138 帧样本，P95 **18.5 ms**，同次空闲 P95 **18.5 ms**，未观察到超过 50 ms 的 Long Task，挂载 81 条消息。该测试的通过阈值为 100 ms，不能当作稳定 60/120 Hz 的证明。

未替换已安装客户端。真实 macOS 整窗拖动、长期空闲、GPU/WindowServer 的瓶颈仍未完成定量定位；后文两项历史原生 E2E 缺口和尚未实现的系统主题/设置搜索等建议不因本次修复而自动完成。证据：`test-results/optimization-*`。

## 结论与范围

**统一尚未完成。** 主要页面已有共同视觉方向，但设置导航、草稿生命周期和键盘行为仍不一致。确认 6 项问题：P1 两项、P2 四项；没有在本轮发现 P0。不能将这个结论理解为不存在其他问题。

最先应修复的是设置横向返回叠出双弹窗，以及切换设置分类时静默丢失草稿。两者都出现在上轮统一设置的实现中，之前“单层弹窗”“草稿保留”的测试只覆盖了部分路径，结论需要收窄。

覆盖方式：梳理所有主导航、设置项和用户可见功能入口，阅读对应组件、关键状态与 IPC 路径；执行全量单元测试、21 个原有专项脚本，以及新增的隔离复现。**这不是逐行审计全部源码，也不是每个功能都连接真实服务执行了一遍。** 下文明确区分本轮执行、源码审查和仍待验证。

使用 Impeccable audit、Vercel React best practices 与 [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md)。没有使用自动检测结果代替实际判断。

## 已确认问题

### F1 · P1：一次返回手势打开两个设置弹窗

- **位置**：[隐藏的旧返回控件](../../desktop/renderer/app/components/settings.tsx#L421)、[新容器返回分支](../../desktop/renderer/app/components/settings.tsx#L47)、[原生 wheel 监听](../../desktop/renderer/shared/components/navigation-controls.tsx#L45)、[隐藏旧标题的 CSS](../../desktop/renderer/app/styles.css#L1233)。
- **触发**：进入 Being 与本机 → subagent 配置，在设置标题区域横向返回。隔离 Chromium fixture 使用 macOS 平台标记、`deltaX=-100` 的 pixel wheel 事件复现；不是物理触控板实测。
- **实际**：`settingsRoute=""`、`settingsOpen=true`、`clientSettingsOpen=true`，DOM 同时存在 `dialog#client-settings-dialog[open]` 和 `dialog#settings-dialog[open]`。画面显示旧连接弹窗覆盖在新设置弹窗上。
- **原因**：旧 ConnectionSettings 标题只用 CSS 隐藏，其 NavigationControls 仍向同一个 dialog 注册手势。旧处理器退回设置首页，新处理器按闭包中的 staged 状态重新打开连接表单。各自的手势锁互不共享。
- **影响**：返回层级错乱、遮罩叠加、焦点进入第二个弹窗，后续关闭行为不再与用户看到的层级对应。
- **建议**：嵌入模式只保留一个导航控制器；路由返回由统一状态转换处理，隐藏子视图不注册手势。补充横向手势、Escape、点击返回、分类切换的同等路径测试。
- **证据**：`test-results/review-swipe-dialogs.json`、`review-swipe-dialogs.png`、`review-repro.mjs`。

### F2 · P1：切换设置分类静默丢失未保存的连接配置

- **位置**：[分类切换](../../desktop/renderer/app/components/settings.tsx#L94)、[退出子页清理](../../desktop/renderer/app/models/app.ts#L556)、[重新创建表单](../../desktop/renderer/app/models/app.ts#L757)。
- **触发**：修改工作目录为 `/fixture/unsaved-directory` → 外观与阅读 → 连接与 Being → Being 连接与本机配置。
- **实际**：输入恢复为已保存的 `/Users/example/Projects`，没有保留草稿，也没有提示放弃。前进到同一设置页同样会调用重建表单的入口。连接地址和 staged subagent 配置还会在离开时被主动清空。
- **影响**：普通导航操作就会丢失多字段配置，用户可能误以为切换开关已保存。连接页底部有“修改后保存生效”的说明，但不能替代离开时的草稿保护。
- **建议**：明确分开即时偏好与需提交的配置。需提交表单保留会话内草稿，或在离开脏表单时提供保存/放弃/继续编辑；凭据不应为了保留草稿而写入普通持久化存储。模型编辑表单也要纳入相同生命周期规则。
- **证据**：`test-results/review-repro.json` 中 `draftAfterTabRoundtrip`。

### F3 · P2：Town 配对仍存在两套不同的设置容器

- **位置**：[Town 页面入口](../../desktop/renderer/town/page.tsx#L160)、[统一设置入口](../../desktop/renderer/app/models/app.ts#L532)、[根组件独立 TownAuth 分支](../../desktop/renderer/app/page.tsx#L180)。详情错误重试还会从 `town/components/catalog.tsx` 直接调用 `town.auth()`。
- **触发**：分别从篝火页面的 Town 连接按钮、设置 → Town 配对与身份进入。
- **实际**：前者打开 `town-auth-dialog`，约 580 × 576 px；后者打开约 820 × 680 px 的统一设置容器，有分类栏。尺寸取自 fixture，动画中读数可能略有偏差，关键是两个不同 dialog 和导航结构。
- **影响**：同一功能的标题、宽度、关闭位置、返回路径不同；用户之前指出的问题仍可复现。
- **建议**：将所有配对入口、鉴权失败恢复入口都交给统一设置导航；业务模型只管理认证状态，不自行决定弹窗形态。
- **证据**：`test-results/review-town-standalone.png`、`review-town-embedded.png`。

### F4 · P2：内置浏览器关闭后仍发送不必要的布局 IPC

- **位置**：[读取布局并发送](../../desktop/renderer/browser/page.tsx#L26)、[全页 MutationObserver](../../desktop/renderer/browser/page.tsx#L80)、[主进程设置布局](../../desktop/main/browser/browser.ts#L88)。
- **复现**：浏览器面板保持 hidden，执行 20 轮 DOM 插入/移除，并跨动画帧让观察器处理。`browserBounds` 被调用 20 次。
- **原因**：观察器始终订阅整个 body 的 subtree/childList；每次调度读取 bounds，再发送 IPC。没有关闭状态短路，也没有相同 bounds 去重。主进程也直接进入 layout。
- **影响**：设置、Town 等外层页面变化会产生与隐藏浏览器无关的工作。这是已确认的冗余，不代表完全空闲时它自己产生循环，也不能据此认定它是整窗卡顿的唯一原因。聊天 iframe 内的 DOM 变化不属于此观察器的 subtree。
- **建议**：关闭时停止观察并只发送一次隐藏状态；打开时仅订阅必要的布局源；对相同边界去重。保留原生 WebContentsView 在弹窗打开时隐藏的功能。

### F5 · P2：Town 分页标签缺少统一的键盘操作

- **位置**：[Town tabs](../../desktop/renderer/town/page.tsx#L43)、同文件 Grove 类型 tabs；对照 [设置分类的 roving tabindex](../../desktop/renderer/app/components/settings.tsx#L121)。
- **复现**：私信收件箱 tab 获焦后按 ArrowRight，仍为第一个选中，第二个未选中。
- **原因**：声明了 `role=tablist/tab`，但没有方向键处理、选中项单一 tab stop 和对应 tabpanel 关联；设置页已实现方向键切换。
- **影响**：键盘操作在不同页面表现不同。Tab 后 Enter 仍可操作，因此不是功能完全不可达。
- **建议**：复用同一个 Tabs 组件，统一方向键、Home/End、焦点和 aria-controls；审查 Grove 与 Being 侧栏同类控件。不能仅凭这一项宣称整个应用符合或违反完整 WCAG 标准。

### F6 · P2：首屏同步依赖仍偏重，尚有明确拆分空间

- **位置**：[完整 highlight.js 导入](../../desktop/renderer/shared/components/markdown.tsx#L6)、[PDF 同步导入](../../desktop/renderer/app/components/pdf-preview.tsx#L2)、[文件预览组件静态依赖](../../desktop/renderer/app/components/attachment-file-viewer.tsx#L7)。
- **证据**：对 App 入口做 production-like esbuild 模块统计，图片使用独立文件输出。JS 约 2.53 MB，其中完整高亮库约 1.08 MB，包含 192 个语言模块；PDF 约 432 KB。该数字是分析构建的未压缩输出，**不是正式 Vite 安装包体积或实际启动耗时**。
- **影响**：首次解析与初始化成本偏高；PDF 页按需绘制已经做了，但解析器代码仍随主入口进入。完整语法高亮也被共享 Markdown 路径引入。
- **建议**：PDF 预览按首次打开拆包，高亮使用 core + 常用语言，其他语言按需注册并保留纯文本回退。量化冷启动/首次预览后再判断收益，不要将拆包等同于解决拖窗卡顿。
- **证据**：`test-results/review-bundle-summary.json`。

## 功能覆盖清单

“未见新增失败”只指本轮执行的路径，不等于所有异常分支和真实服务均已验证。

| 功能 | 本轮检查与结果 | 仍需补充 |
|---|---|---|
| 欢迎页、Being 首次连接 | 入口/默认值/保存状态源码；workspace-layout 相关路径已执行 | 真实首次安装、无网络、凭据失效完整旅程 |
| 主导航、更多、固定入口、拖动排序 | workspace-layout；键盘菜单；窄屏与深色 fixture | 触屏排序、系统缩放、真实拖窗帧时间 |
| 左下角菜单、帮助、日志、退出 | topbar 源码、menu-keyboard、update-progress | 操作系统真实退出/后台运行组合 |
| 设置首页与五个子页 | 三尺寸布局检查；F1/F2/F3 隔离复现 | 修复后覆盖全部入口与所有返回方式 |
| 连接地址、Portal 名称、工作目录 | 表单与保存生命周期、失败/忙碌逻辑 | F2 草稿保护；真实目录授权 |
| Portal 常驻、自启、命令、Kit、权限模式 | 连接页各开关、PermissionPicker、保存契约；对应单元测试 | 真实后台服务、Windows/macOS 权限切换 |
| subagent 开关与 staged 配置 | 源码、模型适配器；F1 实际复现 | 跨页脏表单及物理手势 |
| Being 模型线路、模型、密钥、推理等级 | model-catalog-ui 与模型单元测试通过；legacy/new 路径源码 | 真实供应商连接及切换时服务端回滚 |
| 自主醒来 SBS | 状态桥接、禁用规则、chat-sbs-activity 通过 | 真实服务后台持续工作 |
| 主题、字号预览、恢复默认 | 设置源码、布局 fixture | 系统跟随主题目前未提供；全局 200% 文字缩放 |
| 思考显示与三点气泡 | 默认关闭/错误保留/文件保留源码、单元测试、chat-sbs-activity | 长时间真实工具链的状态辨识度 |
| 历史每次加载条数 | 验证/保存源码、单元测试、布局 fixture | 与即时偏好区分保存反馈；离开草稿策略 |
| 下载位置 | 选择/取消/失败反馈源码与布局 fixture | 原生保存对话框、磁盘满、权限变更 |
| 桌面通知总开关及四分类 | 全量单元、设置 fixture、busy/error 源码 | 操作系统权限、通知点击唤起，不宣称实机验收 |
| 客户端开机自启 | 设置与状态处理源码、单元测试 | 登录/注销/睡眠唤醒、原生安装包 |
| 连接诊断、导出 | 加载/失败/迟到响应源码、布局 fixture | 长日志真实导出、原生文件选择 |
| Portal 状态、启停、重启、日志、一起看日志 | 组件动作与错误处理、日志按需挂载、supervisor 单元测试 | 真引擎重连/实例接管/常驻；不能据 fixture 判定真实可用性 |
| 对话输入、流式输出、排队、停止、历史跟随 | 全量单元；chat-send-queue、chat-scroll、chat-history-window 通过 | 真实长会话、断网重连、系统 IME 综合回归 |
| 场景切换、最近提问、搜索 | recent-chat-history-ui；状态单元；搜索键盘及桥接源码 | 搜索大数据集与屏幕阅读器；跨设备场景状态 |
| 附件、音频、图片生成、图库、下载 | attachments-electron、image-generations-browser、image-gallery-shell-browser 通过；相关单元 | 真实大文件、录音设备、媒体编解码 |
| 本地 HTML/文本/JSON/CSV/PDF/XLSX/PPTX 预览 | 各组件源码、相关单元；HTML 原生脚本部分通过后失败，见验收缺口 | 完整原生预览回归；大 PDF/工作簿/演示文稿 |
| 智能交互界面、工具选择、工具授权 | intelligent-ui-surfaces、tool-selection-browser、相关单元通过；审批组件源码 | 真实工具审批排队与超时、原生权限模式 |
| 篝火、围炉、房间/成员、私信、草稿、回复 | town-names、workspace-layout、chat-sbs-activity；feed/composer 模型源码 | 真实 SSE 未读、多人同时更新、发送失败重试 |
| 种子花园、书架、卷轴、关联阅读 | seed-garden、workspace-layout；catalog/seeds/reading-actions 源码 | 远端写入/吸收/派生不在本轮执行范围 |
| 公告、通讯录、同名 Being、私信引用 | town-civic、town-names 通过 | 真实联系人状态与权限变化 |
| 工具库、App 关联、Kit 安装/删除、Plugin | 源码和对应单元；tool-selection；修正 fixture 后插件布局通过 | 真实安装/依赖脚本/权限；正式包插件运行 |
| 插件导航、侧栏、资源操作、命令 | 插件 model/page/IPC 审查，fixture 缺口见下 | 修复正式测试数据并回归插件 SDK/原生网络 |
| 内置浏览器、分栏、外部打开 | renderer/main、URL/lifecycle 单元；F4 复现 | 最新构建原生 WebContentsView 与弹窗遮挡 |
| 更新下载/取消/校验/安装、恢复窗口 | update-progress 通过；更新/生命周期单元与源码 | 签名包升级、旧版本迁移、Windows、崩溃恢复 |

## 与 Muse / Grok Bot 的差距

**比较证据边界（10 月 30 日更新）**：用户解锁后，已通过 Computer Use 操作本机 Muse（通用页显示版本 8.0）和 Grok Bot。下方新增记录来自可访问性树与截图观察；没有访问竞品内部代码，没有执行授权、发送消息或更改偏好。截图含有用户背景对话，因此没有写入仓库。此前的 [对照记录](UI-SKILLS-AND-INTERACTION.md#Muse--Grok-Bot-的可借鉴之处) 保留作为历史背景。此次不是同机帧率基准，工具调用耗时不能当作应用响应耗时。

### 10 月 30 日实机操作与结果

| 应用与操作 | 实际观察 | 对 Town-Client 的启示 |
|---|---|---|
| Muse：通用 → 连接器 → 电脑使用 → 通用 | 分类列表持续保留，右侧按功能分组；标题、说明、控件有明确层级。电脑使用将系统权限、运行偏好、权限策略、屏蔽应用分组 | 连接配置不要把身份、系统服务与工具权限平铺成一个长表单；共用外框内仍需清晰分组 |
| Muse：通用 → 语言 → 返回 | 语言偏好替换右侧内容，左侧分类保留；独立返回按钮回到通用页，选中语言有单选状态 | 普通设置子页适合在同一容器导航；返回目的地必须确定 |
| Muse：连接器 → Gmail 说明 → Escape | Gmail 说明使用二级弹层；Escape 仅关闭该说明，回到连接器列表。未点击连接或授权 | **Muse 并非完全禁止二级弹层。** 应区分有意的临时确认/授权说明和 F1 那种返回竞争导致的误叠窗 |
| Muse：通用外观、通知 | 有浅色/深色/系统三种模式；系统通知被关闭时显示原因与“打开系统设置”入口 | 补齐跟随系统主题；不可用状态要说明原因并给恢复入口 |
| Muse：关闭设置、Command+, 重新打开 | 快捷键可重新打开设置窗口，恢复至通用页 | 对话获得焦点时，全局快捷键仍应可靠；Town-Client 的 iframe 设置快捷键在源码 fixture 已通过 |
| Grok Bot：左下角账户菜单 → 设置 | 菜单收纳更新、用量、支持、设置和账户操作；设置打开有分类栏、单一关闭入口的容器 | 菜单只保留常用全局入口，详细运行信息进入设置，不必全部挤在左下角 |
| Grok Bot：通用 → 电脑 → 权限 | 相同设置容器中切换内容；设置项通常由名称、说明、右侧控件组成；设备状态与风险操作分组，重置有明确影响说明 | 统一 SettingRow、Section、错误/状态行，并对启停/重启说明影响 |
| Grok Bot：通用设置 | 主题当前显示跟随系统；可访问性树提供分区和具体设置项的“复制链接”按钮；有硬件加速开关 | 跟随系统和设置深链接值得增加。仅看到硬件加速开关，不能推断本项目的卡顿由 GPU 设置造成 |
| Grok Bot：权限 → Escape | 设置关闭后回到原对话，未出现重复设置容器 | 将关闭与返回区分，测试背景对话保留、单层退出与焦点恢复 |

本次没有编辑两款应用的配置表单，因此**没有证实竞品的未保存草稿策略**；也未触发新对话来验证实时三点指示。Muse 左下角菜单点击未得到可靠展开状态，不能宣称该菜单完成验收。操作结束时 Muse 回到原来的设置通用页，Grok Bot 回到原对话。

| 参考交互原则 | 当前已具备 | 还欠缺什么 |
|---|---|---|
| 稳定的设置外框、关闭位置、内部滚动 | 设置主入口已有固定容器与窄屏适配 | 所有入口收敛、单一返回栈、草稿策略；F1–F3 优先于继续调间距 |
| 小幅度、短时、响应操作的动画 | 菜单 opacity/transform、减少动态效果、三点气泡 | 首次打开/返回/刷新全过程的时间预算与实测；动效无法掩盖状态跳变 |
| 已显示信息保持稳定 | 模型名称刷新保留、历史缓存、分页与消息锚定 | 表单跨页保持；异步失败统一呈现；设置内前进/返回不重建不必要状态 |
| 主次清晰、低频功能收纳 | 浏览器已退出左下角顶层，Portal 移入设置，详细思考默认收起 | 连接页仍混合 Being 地址、系统服务与工具权限；新用户需要更短的首次连接路径 |
| 各处控件行为一致 | 设置/模型已有键盘 tabs，通用 Dialog/开关 | Town tabs、旧独立弹窗、保存方式继续收敛成共享组件和规范 |

可直接参考的已观察能力：两者的跟随系统主题、Grok Bot 的设置项定位链接、Muse 的不可用状态原因与恢复入口。其他建议仍属于本项目的体验完善，不能当作竞品已具备的已证实事实：设置搜索；明确的“已保存/尚未保存”反馈；在仍显示三点气泡时清楚表达排队、执行、重连、失败的差别；新手先完成 Being 连接，再渐进配置 Portal/Town/subagent。

## 性能判断

本轮 1,000 条历史 fixture 的流式测试通过：137 帧样本，P95 约 18.4 ms，无观测到超过 50 ms 的 Long Task，挂载 81 条消息。该测试运行期间有其他测试任务，不能作为严格的独占基准，也不能代表 120 Hz 流畅度、真实长期空闲 CPU 或 macOS 窗口拖动帧率；现有测试阈值为 100 ms，本身不是“稳定 60 fps”验收线。

源码中已经存在文本增量合并、历史窗口、附件懒加载、Portal 重复状态抑制等措施。没有证据支持“整个聊天实现必须重写”。下一步优先处理 F4/F6，并测量 AppModel 广播导致的 React commit 范围；广泛 useModel 订阅是待量化的结构性风险，不能仅从 DOM 无变更推断 React 完全没重渲染。

要定位用户所说“连拖窗口、空闲时也卡”，还缺最新正式构建下的主进程/renderer/GPU/WindowServer 时间线，至少分开记录空闲、拖窗、流式回复、打开设置、切换页面。测量平均 CPU、事件循环阻塞、P95/P99 帧时间、长任务、IPC 数量及退出后的后台资源。10 月 30 日解锁后的交互观察以及隔离 headless fixture 均不能替代此项性能采样。此前没有替换已安装客户端，不能把源码优化后的指标当作用户正在运行版本的指标。

## 自动化结果与验收缺口

- `npm run typecheck`、`npm run build:chat`：通过。
- `npm test`：1,153 通过，33 跳过，0 失败。跳过主要包括原生后台服务/接管、安装与升级、macOS 包和 Windows 平台专属项，不将跳过算作通过。
- 原有专项脚本 21 个：18 通过，3 未通过（见下）。此外针对设置问题运行隔离复现；对修正测试数据的 workspace-layout 副本额外执行通过。
- 通过的 18 个脚本：town-civic、seed-garden、town-names、recent-chat-history-ui、menu-keyboard、model-catalog-ui、chat-scroll、chat-send-queue、chat-history-window、chat-lazy-resources、chat-sbs-activity、intelligent-ui-surfaces、update-progress、attachments-electron、tool-selection-browser、image-generations-browser、image-gallery-shell-browser、chat-render-performance。

| 未通过脚本 | 定位与结论 | 后续处理 |
|---|---|---|
| workspace-layout | fixture 插件未设置 `visibleSidebarSlots:['details']`，但 `PluginsModel.slots()` 明确按其过滤。只补齐 fixture 的临时副本完整通过。不能将其报告成插件侧栏产品故障 | 更新正式测试数据，并明确默认隐藏/用户启用的契约 |
| chat-context-menu | 在测试 UI 操作前，清空剪贴板的前置断言仍读到 `electron application/findtext` 格式 | 修复/适配原生剪贴板 fixture；本轮未完成右键菜单端到端验收 |
| local-file-preview-electron | HTML 加载、沙箱、源码、刷新、最大化、文件夹入口等先通过；第 115 行 Escape 后，第 116 行无法找到“关闭文件预览” | 需继续隔离焦点/菜单/预览关闭顺序。当前证据不足以判定产品缺陷还是测试假设不符，不能写成全部文件预览已通过 |

日志与机器可读证据位于 `test-results/review-*`；该目录是本地验收产物，不依赖其进入版本控制。测试数据使用示例身份和临时 profile，没有向真实 Being/Town 发送内容。

## 技术审查评分与检测器复核

这是 Impeccable audit 的本次抽样技术评分，不是正式可访问性认证或竞品评分。因缺少最新实机/native 检查，不能用于发布放行。

| 维度 | 0–4 分 | 依据 |
|---|---:|---|
| 可访问性 | 2 | 设置/菜单键盘能力已有基础，Town tabs 不一致；未做全量屏幕阅读器/像素对比度验收 |
| 性能 | 2 | 流式/按需资源测试通过，隐藏浏览器 IPC 与同步重依赖仍存在；实机空闲与拖窗未测 |
| 主题 | 3 | 已有共享变量、深色与设置布局覆盖；历史覆盖规则较多，未作全部组件像素认证 |
| 响应布局 | 3 | 工作区与设置尺寸矩阵通过；未测物理触屏、200% 文字缩放 |
| 实现一致性 | 2 | 双弹窗、丢草稿、配对入口分裂是可复现缺口 |
| 合计 | **12/20** | 仍需明显改进，优先行为一致性 |

源码 detector 返回 9 条 side-tab 边框警告。逐条复核后，绝大多数是 Markdown 引用、回复预览、引用来源或历史样式覆盖，不能把边框本身当作 UI 缺陷；篝火公告强调边框属于可选视觉取舍，不列为阻塞问题。没有进行 native CDP 的 rendered contrast 检测。实现一致性判定“不通过”来自 F1–F3 等行为证据，而非检测器风格偏好。

## 建议实施顺序与验收标准

1. **先修交互正确性**：F1/F2/F3；所有入口共用容器；一次返回只退一层；任何时刻同一设置旅程最多一个原生 dialog；未保存字段不被普通导航静默丢弃。
2. **再处理性能冗余**：F4/F6；关闭浏览器时无持续布局 IPC，静止 bounds 不重复发送；首次主入口不需要 PDF 和全部语言；分别记录首屏与首次预览成本。
3. **统一行为与组件**：F5，统一 Tabs、设置行、表单保存反馈和错误恢复；随后收敛 CSS 历史覆盖，避免继续通过末尾规则叠加设计。
4. **补齐验收**：修复测试 fixture，调查两项未完成 E2E；竞品基本设置导航已于 10 月 30 日实机补查，仍需最新本地构建的真实拖窗/空闲性能采样，以及一致负载下的比较。真实安装/升级、Windows、通知、后台常驻仍使用对应原生测试矩阵。
