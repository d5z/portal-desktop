# 自动化测试

## 一条命令运行

克隆仓库并安装依赖后执行 `npm run test:all`。需要已安装的 Rust toolchain，仓库内 `heart-portal/` 源码以及操作系统的桌面会话和可用密钥库。使用 `HEART_PORTAL_SOURCE` 可指定其他引擎源码目录。第一次构建会下载 Electron 和 Rust 依赖。

`npm run test:all -- --reuse-package` 使用已有客户端包，仍会执行 Rust 原生测试及所有适用的 E2E。源码改变后应执行默认命令重新构建，避免测试旧包。`PORTAL_DESKTOP_EXECUTABLE` 可指定被测客户端的可执行文件。

## 覆盖与边界

| 测试层 | 自动验证内容 | 命令 |
| --- | --- | --- |
| 类型检查 | 桌面 IPC、设置、渲染器与后台服务的类型契约 | `npm run typecheck` |
| 私信名称与小镇入口 | 真实 React/导航组件，本地 fixture：隐藏 ID、精确回复地址、横向入口展开/收起、键盘、窄屏、草稿保留 | `npm run test:town-names` |
| Seed Garden / 弹窗切换 | 公开阅读、筛选、派生关系、经验墙、卷轴一致的链接栏；弹窗内切换、每次刷新、旧响应隔离、窄屏深色排版 | `npm run test:seed-garden` |
| SBS 状态同步 | 真实 Loom 与桌面桥接、本地配置接口；刷新重新读取、慢响应、外部修改、切换失败、旧响应隔离与重试恢复 | `npm run test:sbs-refresh` |
| Town SDK 协议界面 | 自动取码/确认、取消、鉴权失败转手动、草稿保留、手动配对、真实 SSE hello、三类消息 via 标记、发送身份及自身私信拦截；本地 fixture，不向真实 Being/Town 写入 | `npm run test:town-sdk` |
| 客户端生命周期 | 关闭隐藏、菜单/再次启动恢复原窗口、明确退出；未连接 Being 时操作客户端自启开关（系统登录项 API 使用 fixture，不修改用户登录项） | `npm run test:client-lifecycle` |
| 桌面通知 | 启动实际 Electron 包；总开关/分类设置、重启持久化、真实原生通知请求、SSE 分类与自己发言过滤、模拟系统点击事件后恢复窗口并打开收件箱/围炉 | `npm run test:notifications` |
| Portal 窗口生命周期 | 关闭窗口后仍能调用真实 Portal、恢复原窗口、网络重连不重启引擎、明确停止 | `npm run test:portal-e2e` |
| 客户端单元测试 | 凭据隔离、代理路由、流式请求、Portal 守护、配置失败回滚、Town 认证和 Kit 导入边界 | `npm test` |
| Rust 原生测试 | 配置解析、单实例锁、Relay 握手与退避、进程管理、路径边界、命令策略、Kit 工具及重启协议 | 在 Portal 源码目录执行 `cargo test --locked -p heart-portal -- --test-threads=1` |
| 桌面集成 | 实际 Electron 安装包、本地 HTTP/WebSocket 模拟 Being、真实 Rust Portal、附件与 SSE、文件写入、stdio Kit、模型设置、主题、草稿保留、对话刻度索引/搜索、过程区停止按钮和配置重载 | `npm run test:e2e` |
| 原生后台服务 | 实际 macOS LaunchAgent，关闭客户端后工具调用、SIGKILL 恢复、无界面启动登录项、附着和停用持久化 | 已包含在 macOS 桌面集成中 |
| Town 界面 | 模拟 HTTPS 数据通过真实 IPC/代理，验证篝火、收发件箱、认证、正文净化、分页、Kit 参数及实际导入 | `npm run test:town-ui` |
| macOS 安装包 | DMG 只读挂载、Applications 快捷方式、复制安装后的完整签名、DMG/ZIP 一致性及 ZIP 安装前检查，不启动客户端窗口 | `npm run test:macos-package` |
| macOS 客户端升级 | 从 DMG 安装并全新启动签名包，在独立 profile 中从较低版本测试基线经 Release 请求、ZIP 下载、替换和 LaunchServices 启动新版；保留原配置、工作文件和工具能力，确认运行随包 Portal 且没有重复客户端 | `npm run test:macos-upgrade` |
| Windows 客户端安装升级 | 实际 NSIS Setup 安装较低版本测试基线，通过客户端 Release 检查、摘要校验、Setup 安装及自动打开新版；保留配置、凭据、工作文件和工具能力，验证计划任务运行的 Portal 摘要与客户端随包清单一致 | `npm run make` 后执行 `npm run test:windows-upgrade` |

本地模拟 Being 能稳定复现协议及客户端行为，不代表真实云端当前可用，也不测试 LLM 回复质量或真实 Town token 的授权情况。登录项测试通过卸载/重新加载临时注册项模拟启动过程，不会重启或注销电脑。睡眠唤醒和 Windows 计划任务全生命周期仍需目标机器补充验收。Windows 专用 Rust 测试在 Mac 上按引擎声明跳过。

自动配对的流解析、总时限、取消和身份变化由 `tests/town-pairing.test.ts` 覆盖，包括拆分 UTF-8/CRLF、工具结果排除、多段回复续写、六字符前缀与多个候选码拒绝、阻塞流中止、取消后确认响应迟到和等待写入期间取消。`tests/renderer-state.test.ts` 覆盖自动默认入口、失败回退与取消/提交竞态。原生 `test:town-sdk` 另保留手动配对回归，截图写入系统临时目录的 `town-auto-pair-review.png` 和 `town-auto-pair-manual-review.png`。

「一起看 → 放入对话」是显式引用，不检查 Town 身份是否与对话 Being 一致，也不要求重新配对。renderer 状态测试覆盖不同来源身份、规范 Town ID、缺失来源身份和未连接对话；`test:town-sdk` 使用规范 `town_id` 响应验证私信、围炉及导入凭据后的引用成功，并验证原草稿保留、未发送引用且没有额外配对请求。

Town 正文提及显示由 `tests/town-mentions.test.ts` 与 `test:town-names` 覆盖：篝火、围炉和私信使用已读取的服务端身份元数据，将完整且大小写一致的 `@Town ID` 显示为名称，悬停保留原 ID。名称缓存仅在当前配对身份内复用；未知 ID、短前缀、代码和链接保持原文。该转换不修改 API 原始正文、回复地址或发送内容，也不代表服务端已成功投递提及。

`test:town-names` 使用无头 Chrome，不打开日常客户端；默认需要本机安装 Google Chrome，也可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定 Chromium。截图写入 `test-results/town-names.png` 和 `test-results/chat-places-*.png`。

`test:seed-garden` 使用相同的无头 Chrome 配置，在本地 fixture 中验证真实组件，截图为 `test-results/seed-garden.png` 与 `test-results/seed-garden-narrow.png`。`tests/seeds.test.ts` 随 `npm test` 检查固定公开路由、筛选参数编码、凭据隔离、深链接和过期详情响应。

`test:sbs-refresh` 会先生成最新 Loom 资源，再用无头 Chrome 加载本地 HTTP fixture。使用真实顶部刷新按钮和 SBS 开关，只读写模拟配置，不连接真实 Being。与其他 Chrome fixture 一样，可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定浏览器路径。

`test:all` 包含私信名称、Seed Garden、SBS 刷新和内置浏览器回归。Windows 安装升级测试单独执行，需要交互式桌面会话和已构建的 Setup。测试使用临时安装目录、独立 profile、本地模拟 Being 和真实计划任务；NSIS 的用户级快捷方式、缓存和卸载登记会在结束时恢复。如果该 Windows 账户已有日常 NSIS 安装，测试会拒绝运行，应换测试账户。旧版本由当前包构造，不代表覆盖所有历史发布版。失败时保留临时目录和 `installation-metadata.json` 供排查。

Windows 的离线升级、坏引擎回滚与独立 Portal 接管另用 PowerShell 执行：`$env:PORTAL_DESKTOP_NATIVE_UPGRADE_TESTS='1'; npx vitest run tests/background-native.test.ts tests/runtime-update-native.test.ts --maxWorkers=1`。这些检查需要真实计划任务权限，不能以普通单元测试中的跳过结果代替。

## CI 接入

`.github/workflows/desktop-tests.yml` 在分支 push、pull request 和手动运行时执行 macOS arm64、macOS x64 和 Windows x64 矩阵，构建并运行客户端和引擎测试，上传测试报告。Intel Mac 使用 `macos-15-intel` runner 原生运行。普通 CI 的 macOS 包仅使用显式本地测试签名，不作为分发包。正式签名、两个 Mac 架构各自的安装包检查和发布由版本 tag 触发的 `.github/workflows/release.yml` 执行；完整图形升级测试需在具备发布证书的已登录 Mac 上单独运行。Portal 源码由客户端仓库的子模块引用锁定。

`tests/release-assets.test.ts` 验证三组发布资产、各自的校验摘要，以及 Intel 产物缺失、
架构错配、引擎损坏和任一 Mac 架构的 DMG/ZIP 缺失或重复时拒绝发布。
更新检查测试覆盖两种 Mac 架构选择各自 ZIP，以及只有另一架构包时不提供安装。

托管 runner 设置 `PORTAL_DESKTOP_TEST_BACKGROUND=0`，报告中显示 **SKIPPED**；普通 Portal 子进程、真实 Relay/工具调用及 Rust 测试仍执行。不能把这个结果当成登录自启验收。

若需要 CI 自动验收真实 macOS 后台服务，准备专用测试 Mac，在已登录图形会话的用户下运行 GitHub runner，并添加 `beings-test` 标签。手动运行 workflow 时勾选 `native_background`，会额外执行原生后台服务 job。不要把未经信任的分支放到日常办公机器上的自托管 runner 执行。该 runner 尚未由本项目自动配置，工作流配置本身不代表云端已经运行成功。

## 报告与隔离

Windows 的 Vitest 测试文件串行执行，避免真实 PowerShell、CIM 与计划任务查询在托管 runner 上竞争冷启动资源；其他平台保持并行。Portal 工具测试分别覆盖普通 Windows PATH 与受限 PATH。原生测试的外层时限大于生产命令的时限：Portal RPC 40 秒（工具内部 30 秒），缺失计划任务检查 100 秒（依次执行三个最多 30 秒的命令）。测试不会自动重试失败用例或跳过真实截图。日志包含每个 RPC 的工具名、阶段和耗时，失败时额外保存 `portal-tools-native-<environment>-failure.json` 或 `background-native-failure.json`。

- `test-results/summary.md`：阶段结果、耗时、平台和后台测试是否适用。
- `test-results/summary.json`：适合其他 CI 系统读取的结构化结果；失败退出码为 1。
- `test-results/unit.xml`：客户端单元测试的 JUnit 报告。
- `test-results/*.log`：各阶段原始日志，包含 Rust 实际通过/忽略计数。
- `test-results/*.png`：界面截图，桌面失败时保存 `failure.png`，Town 失败时保存 `town-failure.png`。
- `test-results/town-trace.zip` 和 `desktop-trace.zip`：通过 `npx playwright show-trace <文件>` 回放 Town 操作和桌面首次启动的主流程。

测试使用随机临时 profile、独立工作和 Kit 目录、模拟 token、本地随机端口。真实后台测试注册名按临时 profile 生成；正常结束、断言失败以及 SIGINT/SIGTERM 时清理自己的 macOS 登录项，不停止用户原有服务。强制杀死测试进程（SIGKILL）或主机断电无法执行 finally 清理；可按测试临时 profile 对应的 `portal-service.json` 定位残留登录项，不能按通用 Portal 进程名批量终止。

`npm run test:browser`：打包客户端中以本地 HTTP fixture 验证内置网页、导航历史、新窗口链接、弹窗层级、独立登录会话、无本机 API 和关闭清理。不会访问真实 Being 或发消息。

`tests/settings.test.ts` 验证重装、升级及保存时固定使用当前客户端引擎，保留连接和配置，以及旧引擎缺失时仍可读取 TOML。`tests/portal-takeover.test.ts` 验证自动停止顺序、忽略旧取消记录、预检期间配置变化、旧守护拒绝停止、新启动失败和中断后的手动恢复。`tests/portal-discovery.test.ts` 验证旧客户端守护、token 轮换、原名称识别及无关服务排除。`PORTAL_DESKTOP_NATIVE_UPGRADE_TESTS=1 npx vitest run tests/portal-takeover-native.test.ts` 使用临时 profile 和本机测试 Being，验证自动停用真实 macOS LaunchAgent、启动客户端版本以及无关 Being 保持运行，不启动 Electron 测试窗口。

桌面 E2E 统一通过 `tests/support/electron-lifecycle.mjs` 启动：同一时间仅允许一个测试实例，单个测试设 5 分钟上限，退出等待最多 8 秒；超时仅清理该次 launch 返回的子进程。原生桌面 E2E 会显示窗口，不在日常使用客户端时自动运行。浏览器生命周期单元测试使用替身验证销毁窗口后不再访问 shell。

原生弹窗关闭后，Intel macOS 上 DOM 就绪可能早于 Electron 画面提交。
`tests/support/desktop.mjs` 的 `clickWhenPointerReady` / `clickChatControl` 先确认目标按钮收到鼠标悬停，
再单次点击；等待期间仅移动鼠标，不重试导航。`town-ui` 覆盖连续关闭弹窗后重开篝火和书架，
`electron-smoke` 覆盖关闭搜索后回到最新消息及连续开关设置。菜单入口等待展开动画完成后再点击，保留原有 15 秒等待上限。

macOS 安装包与完整升级测试需要实际 Developer ID 签名包，签发条件见 [BUILDING.md](BUILDING.md)。完整升级测试会打开真实客户端窗口，运行前需退出日常客户端；它使用签名包构造较低版本基线，不代表覆盖所有历史发布版本。签名和升级通过也不代表 Apple 公证或首次下载的 Gatekeeper 检查通过，详见 [UPDATING.md](UPDATING.md#验证)。

Windows 的 `npm run test:windows-upgrade` 通过 `scripts/test-windows-upgrade.ps1` 运行。管理员 CI 会用同一用户的临时 Limited 计划任务执行完整测试，使测试、NSIS 和自动启动的客户端保持普通用户权限及同一隔离配置目录；任务结束后自动注销。测试等待真实窗口和配置目录就绪，再验证退出、升级和重启。发布 CI 始终上传 `test-results/windows-installer/` 中的日志及失败诊断。

## React 迁移回归

`tests/architecture.test.ts` 随单元测试检查进程与模块依赖：renderer 不导入本机实现、
主进程不依赖界面、共享契约不依赖具体功能、模型不反向导入组件或 hooks。

`tests/windows-runner.test.ts` 在 Windows 上直接执行生成的 PowerShell runner，使用临时 DPAPI 凭据和编译的本地 fixture 引擎；验证解密前/工作目录错误留痕、退出码、上一轮错误保留、实例冲突暂停及 6 次快速失败上限，不注册计划任务。`background.test.ts` 覆盖 Windows 显式恢复清除标记和日志脱敏；`runtime-update.test.ts` 覆盖同版本启动恢复且不启用主动停用的服务。`test:portal-e2e` 通过本地 Relay 中断及界面的「重启 Portal」验证新 PID、连接恢复和后台偏好保持。

macOS 临时签名包每次重建后可能等待真实钥匙串授权。仅在界面 fixture 回归时可设置
`PORTAL_DESKTOP_TEST_MOCK_KEYCHAIN=1`，测试启动器将启用 Chromium 的测试钥匙串。
报告会明确显示 `Keychain coverage: MOCK`；它不修改客户端源码中的凭据策略，也不代表
真实钥匙串授权或正式签名已验收。默认测试仍使用系统钥匙串。

`tests/renderer-state.test.ts` 随 `npm test` 运行，覆盖组件重挂载时 IPC 订阅清理、旧启动请求失效、
连接表单异步默认值、Town 页面与身份切换、重复发送拦截、断线核对不替换阅读内容、精确身份
筛选及显式跨身份引用。组件的键盘、焦点、菜单动画、原生弹窗、配对、引用草稿、
Markdown、分页、安装和浏览器隔离由现有 Electron `test:town-sdk`、`test:town-ui`、
`test:browser` 和 `test:e2e` 使用新构建的包验证。

`npm run test:chat-react` 编译并测试完整 React 聊天页，使用本地 HTTP fixture 覆盖历史与索引、
Markdown/高亮与危险链接、模型切换失败和补充密钥、OAuth、附件、流式追加、停止、错误收尾、
引用草稿保护、断点重放，以及明暗主题和窄屏布局。`npm run test:sbs-refresh` 验证配置读取竞争，
`npm run test:town-names` 验证 React 小镇快捷入口的键盘与焦点。

### 2026-09-14 本机验证记录

macOS arm64：类型检查通过；单元测试 179 项通过、9 项按平台或显式开关跳过；
`chat-react`、`sbs-refresh`、`town-names`、`seed-garden` 的 Chrome fixture 均通过。
重组目录后重新打包，并通过 `town-sdk`、`electron-smoke`、`town-ui`、`browser-e2e`。
覆盖真实 Rust Relay、Kit 调用、流式消息、索引搜索、配置恢复、页面导航及浏览器隔离。

该次 Electron 验证使用临时签名包、隔离 profile、模拟钥匙串与本地服务 fixture；
设置 `PORTAL_DESKTOP_TEST_BACKGROUND=0`，没有验收真实钥匙串授权、系统登录服务、
正式发布签名、公证或 Windows 实机行为。

同日合并远程 0.1.6 安装器与启动修复后，类型检查、单元测试（180 项通过、11 项跳过）
及 `chat-react` 再次通过。重新构建客户端包，验证 `town-sdk`、`town-ui` 和
`client-lifecycle`，覆盖三类消息回复提交、聊天初始化后的菜单操作及再次启动恢复窗口。
这些 Electron 回归沿用上述隔离与模拟设置。
