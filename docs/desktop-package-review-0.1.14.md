# Town 0.1.14 客户端依赖审查

以下体积和问题列表记录修复前的本地包。2026-11-06 的修复结果与验证范围见文末；不要将历史问题列表当作当前未解决清单。

范围：本地 macOS arm64 的 DMG、升级 ZIP 与其中的应用，另核对 Windows 安装器配置。下表是 ZIP 内 `.app` 条目的未压缩字节数，不是下载量，也不是 Windows 或 Intel Mac 的实测值。DMG 为 135.28 MiB，ZIP 为 137.71 MiB。

| 应用内容 | MiB | 用途 |
| --- | ---: | --- |
| Frameworks | 285.94 | Electron、Chromium、V8、Node 运行时及辅助进程 |
| Resources/app.asar | 17.03 | 主进程、preload、用户界面、云电脑查看器、插件宿主、PDF/表格/演示文稿预览、字体和许可文件 |
| Resources/heart-portal | 13.18 | 已编译的本机 Portal 引擎（包内清单版本 0.9.2） |
| Resources/npm | 10.50 | npm CLI 及其私有依赖；其中 docs 和 man 合计 2.26 MiB |
| 其余 | 1.99 | 品牌资源、应用入口、签名和运行时清单等 |
| 整个应用 | 328.64 | Electron 约占 87% |

ASAR 顶层只有 `.vite` 和 `package.json`，没有整棵项目的 `node_modules`。Forge 从开发目录复制的是 `node_modules/npm` 这一项；安装后入口是 `Resources/npm/bin/npm-cli.js`。入口把控制交给 npm 的 JS 实现，真正执行它的是 Electron。项目没有直接声明 undici；包内 Node 自带 undici。云电脑 WebSocket 路径用的是打入主进程的 ws，目前它在清单中被标为开发依赖。

## 需要处理的差异

1. **本机验证的包和锁文件不同。** 项目清单、锁文件与按锁文件完整性校验的 npm 归档均为 11.21.1；当前开发目录和实测的 0.1.14 本地包均为 11.11.0。Forge 复制当前安装目录，因此只比较打包前后的文件不能发现这个问题。云端流程运行 npm ci，未在此审查中重新构建。下次本地验证应从同一个提交、用 npm ci 全新安装依赖，并读出成品内版本对照锁文件。
2. **插件的子脚本可能找不到 Node。** 以成品 Electron 启动包内 npm，把 PATH 限制为 /usr/bin:/bin，离线安装只含本地依赖的临时包成功；授权构建后，install 脚本执行 node 时退出 127。用锁定的 11.21.1 重复实验结果相同。缺的是子脚本可调用的 node 命令，与 npm 的版本差异是两个问题。
3. **另外两种功能也使用外部工具。** 第三方 Kit 若声明 JS 依赖，安装走系统 Node/npm；若声明 Python 依赖，走系统 Python 创建虚拟环境。Kit 启动命令本身也可能需要解释器。Portal 首次配置 subagent 且需下载 pi 时从 PATH 查找 npm。二者和 DSH 插件不是同一条安装链路。macOS 识别、接管遗留引擎还通过 /usr/bin/python3 检查进程；解释器不可用时可能跳过候选，不能据此推断普通客户端启动依赖 Python。

## 官方 DeepSeek Harness 桌面版与 Town

对读本地 deepseek-harness 检出版本 dsh-v0.1.6-alpha.2 和与本机安装版对应的 dsh-v0.2.1-rc.5（b830ec950faba0a46dda564be3e2d854afed94f1）。

| | Harness 桌面版 | Town 的 DSH 插件 |
| --- | --- | --- |
| 包管理器 | Electron 运行随包 pnpm 入口 | Electron 运行随包 npm 入口 |
| 依赖放在哪里 | 对当前 profile 执行 pnpm add，维护 profile 的清单和 pnpm 锁文件 | 每次安装在用户数据 third-party-plugins/packages 下新建独立目录，安装宿主库、插件和它的依赖；更新可保留旧目录供恢复 |
| 子脚本调用 node | 将随包的 node 启动脚本目录放在子进程 PATH 最前；脚本转交 Electron，不改系统 PATH | 继承系统 PATH，未给子脚本提供自己的 node 入口 |
| 运行依赖构建脚本 | 将待授权的依赖列名，按包名记录到当前 profile 的 allowBuilds，重试 | 首次安装 --ignore-scripts；勾选后对这一整棵安装目录执行 npm rebuild |

在同一台 Mac 上，用官方安装包自带的 pnpm 和同样不含系统 Node 的 PATH，仅按官方源码加回 runtime/bin：包脚本成功执行 node，并返回 24.21.0。该验证覆盖的是 Node 子命令，不代表含原生扩展的任意插件都不需要编译工具。

建议先保留 Town 的 npm 和按插件隔离的目录，优先补齐包操作的私有 node 入口；用按锁文件安装的干净目录重新出本地包。是否改用 pnpm、是否按包授权构建和是否精简 npm 文档，是可以单独决定的事项。

## 2026-11-06 修复与验证

### 依赖与加载路径

- 保留工作区已有的资源路径修复：开发模式使用构建时确定的 `desktop/generated` 绝对路径；生产模式使用当前应用的 `app.asar/.vite/renderer/main_window`。Portal、npm、品牌文件和 Node 启动脚本放在当前包的 `Resources` 下；原生子进程不从 ASAR 内读取 npm 或 shell 启动脚本。
- 对照 Harness 的 `apps/desktop/src/node-environment.ts` 和 `apps/desktop/scripts/node-bin`，添加私有 `node` / `node.cmd`。仅在 DSH 插件安装及已授权构建的子进程环境里前置其目录，转交当前 Electron 的 Node 模式，不修改系统 PATH。继续保留 npm 和按插件隔离的安装目录。
- 将主进程实际使用的 `ws` 移入运行依赖；直接声明源码导入的 `@deepseek-ai/cosmokit`、`@tiptap/core`。构建/升级测试直接使用的 `@electron/packager`、`@electron/asar`、`app-builder-lib` 也补充为开发依赖，版本沿用现有锁文件，没有升级这些库。
- 执行 `npm ci` 恢复锁定依赖，npm 已是 `11.21.1`。Forge 启动/打包入口检查直接依赖的安装版本和锁文件；检查曾实际拒绝旧的 `11.11.0`，避免继续把旧 npm 打进安装包。成品验证另外检查 npm 实际版本并执行离线安装/构建。
- Forge 打包后继续执行包内文件内容和 HTML/CSS 本地引用检查；新增的运行验证已接入发布 CI 和 `test:all`。云电脑 ASAR 画面测试在发布 CI 的两个 macOS 架构执行，运行时/旧配置测试也覆盖 Windows 发布任务。

### 旧客户端升级兼容性

这次调整改变的是随应用发布的文件定位方式，不改变用户数据路径及文件格式：

- `clientUserData()` 仍沿用原有 `portal-desktop` 或旧 `Beings` 配置目录。
- `SettingsStore.load()` 会把持久化的旧 `portalBinary` 替换为当前应用的随包路径；连接、工作目录、权限及用户选项保留。
- DSH 的 `plugins.json`、包目录、配置与数据仍在原用户数据目录下。新客户端用新包内的插件宿主加载原插件，不迁移或重装原插件。
- 客户端安装意图和 Portal 升级/回滚日志的格式及消费流程未改变。

### 本机验证结果与边界

- `npm ci`、依赖版本检查和 TypeScript 检查通过。macOS arm64 的全新测试包成功构建，2,332 个打包文件与 70 个本地资源引用通过校验。
- 将完整 `.app` 复制到源码目录外、带空格的路径，在只包含 `/usr/bin:/bin` 的 PATH 下，使用应用自身的 Electron 执行 npm `11.21.1`，离线安装本地测试依赖并在显式 rebuild 后运行 `node` 成功；实际 Node 版本为 `24.20.0`。ASAR 内的真实 DSH 宿主可以启动和正常关闭。
- 真实打包客户端在临时配置中重新打开旧格式连接设置、旧 Portal 路径与已安装插件记录：连接可读，工作目录和权限保留，Portal 指向新包，原插件激活成功，连接文件、插件记录和插件数据未被改写。
- 云电脑集成测试直接加载成品 ASAR 中的 HTML、JS、CSS 和 preload；本地 TLS/RFB 测试服务验证画面、输入边界、控制权、断线恢复和会话过期。测试主进程使用源码构建的网络适配夹具，不代表线上 Home 服务已实测。
- 112 项相关单元测试通过，覆盖 DSH、Home、云电脑控制、配置兼容、升级与回滚、托盘。另通过生产 main/preload 的四个升级恢复场景：中断安装、离线回滚、回滚重试、并发下载/取消及交接失败后的重试。
- 本机包是 ad-hoc 测试签名，未发布，未执行真实历史安装包到新签名安装包的全流程替换。配置重开测试使用测试密钥库，不验证用户系统密钥库授权。Windows 与 Intel Mac 的新增检查已接入 CI，本次没有在这两个平台运行。
- 第三方 Kit 的系统 Node/npm、Python，以及 Portal subagent 下载 pi 的系统 npm 要求仍是独立链路；本次不改变其执行环境，也不承诺任意原生插件无需编译工具。

## 提交前复审

- 合并远端 `dd2cca4` 的 PDF 解码资源修复。保留 `tests/packaged-resources.mjs` 及其 CI 入口，避免新增运行时测试替代掉生产主进程的 PDF 像素和云电脑首帧回归。
- 补正 `fflate` 为运行依赖；日志导出与表格处理直接使用该库。
- 完整单元测试：161 个文件通过，1,381 项通过；10 个文件、33 项按平台或原生环境条件跳过。
- 合并后的 macOS arm64 包：2,338 个文件、70 个本地链接校验通过。真实生产协议资源访问、CCITT/JBIG2/JPEG 2000 图片像素、生产 Home 打开动作与首帧均通过。
- `v0.1.14` 当时仅有指向 `042996e` 的 tag，尚无 GitHub Release，旧发布任务已取消。按用户明确要求，在本次审查与提交完成后重建未发布 tag；签名和跨平台发布仍须由发布 CI 全部通过后执行。

## Windows CI 后续排查与实机验证（2026-11-06）

- 发布 run `42160180611` 第二次运行的 Windows job `127711908184` 已通过真实 `0.1.12 → 0.1.14` 升级，失败点为随后运行中重装的 Portal 等待阶段。`ab56c53` 将 `rememberPortal()` 的非空断言放进轮询；旧进程退出后，磁盘状态仍可暂时显示旧 PID 为 `connected`，因此正常重启间隙被当成失败。
- 两处重启轮询改为等待存活且身份不同的进程，再登记待清理进程。保留既有超时、安装器非零退出失败、真实安装及自动启动检查。新增原生回归；恢复旧断言时复现相同错误，修复后通过。
- 本机 Windows 普通用户令牌（elevationType 3）正常安装 `0.1.12 → 0.1.14` 成功，Setup 退出 0，已安装 ASAR 与构建一致；随后在客户端和 Portal 运行时再次执行同一个 Setup，也退出 0。重装实测连续五次读取到旧 PID 的 `connected` 状态，然后新进程从 `connecting` 变为 `connected`；旧客户端及引擎退出、单主窗口、设置保留、恢复事务提交均通过。记录在本地 `test-results/local-upgrade/`，不提交用户配置。
- 对已安装目录的生产程序，使用独立测试 profile 验证 CCITT、JBIG2、JPEG 2000 的实际解码像素，以及 Home 首帧，均通过。构建产物另通过 npm 离线安装/构建、无系统 Node 的插件宿主及旧配置重开测试。
- 首次运行 job `127703777206` 的旧版 Setup 曾返回 `0xC0000005`；第二次 CI 已通过该步骤。本机本次未重现此异常，也没有以静默安装或忽略退出码绕过它。本次修复针对第二次运行已定位并在实机复现的轮询错误。
- 完整隔离历史升级脚本未在日常账户重跑；本机直接升级及运行中重装使用真实现有安装。远端 CI 尚未重跑本次修复。遵循用户后续指示，仅本地验证和提交，不创建、重打或推送 tag。
