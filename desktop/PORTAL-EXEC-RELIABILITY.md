# Portal 执行与沙箱准备

已构建本机 Portal、内置运行时资源及 macOS 本地测试安装包，尚未安装到系统或发布。macOS 使用真实 Seatbelt 沙箱验证；Windows 改动需要在 Windows 上完成原生验收。

## 异常提示

场景列表区分“消息未发送”“后台任务失败”和本轮“执行异常”。消息未发送表示本地发件箱仍有失败项，并不表示 Being 当前正在执行失败命令。打开场景可在输入框上方直接看到具体原因，选择“重试附件处理”或删除排队消息；删除后对应状态清除。失败原因随队列保存，刷新后保留。

工具过程保留具体错误和下一步处理建议。前台命令超时返回 `failure_code=command_timeout`，保留超时前的 stdout/stderr，并终止进程树。不要原样反复调用；长任务可使用 `background=true`。批准后的宿主命令仍只允许前台执行，需在当前调用中明确设置合适的 `timeout_secs`。

`workdir` 统一以工作区解析相对路径，修复 `.` 或子目录曾按 Portal 进程所在目录解析而触发沙箱拒绝的问题，前台和后台一致。

## 审批结果

并发工具调用按顺序等待各自的审批，不再因为其他弹窗占用而直接拒绝。每项调用仍需自己的批准；排队期间取消或权限变化不会获得授权。旧的单项授权不再复用；客户端仅保留“始终允许”和“每次询问”。

真实对话实测发现云端工具调用在 120 秒截止，会抢先覆盖同为 120 秒的弹窗过期原因。弹窗、客户端 HTTP 通道和 Portal 审批总预算改为 60、65、70 秒，为执行及错误回传留出时间。Portal 内部先排队再建立审批通道，总预算包含排队，避免并行工具无限等候。用户拒绝、等待过期、取消、配置变化和通信失败保留不同的错误原因。Portal 只在收到明确的 `deny` 时记录 `allowed=false, outcome=denied`；通信异常不再伪装成用户拒绝。工具错误保留完整的错误因果链。

前端答复绑定请求 ID，旧 IPC 回调不会关闭新到达的审批弹窗。历史日志只有 `allowed=false` 时，仍无法追溯当时是拒绝还是通信/超时；新日志和回归测试改善此问题的可诊断性，不据此宣称已经复现用户历史故障。

## 常规任务准备

客户端发布包内置锁定版本的 Python 3.12.14 和 Node 24.21.0 作为安装源。首次启动或升级时，客户端将其校验后放入用户目录的 `portal-runtimes/<runtime-id>/`；前台和后台 Portal 共享这一份运行时。任务运行期间不下载安装解释器。Node 发行版自带的 npm/npx 与 Python 自带的 pip 保留；首版不预装文档、绘图库等第三方包。

直接通过 `portal_exec` 使用 `python3`/`python` 或 `node`。执行层统一把内置解释器放在 PATH 前端，并准备 `inputs/`、`outputs/` 和 `.portal-runtime/` 下的 HOME、临时及缓存目录；前台、后台和子代理共用。已移除需要 Being 额外调用的 `portal_environment` 工具。

本机输入文件可使用 `portal_file_copy {"path":"/source/report.pdf","destination":"inputs/report.pdf"}` 复制到工作区，避免模型传递二进制。每次复制均需本次同意，目标限制在普通工作区路径，拒绝覆盖。单文件最多 128 MiB。产物保存到 `outputs/`。

运行时与工作区分离：沙箱可读取及执行内置解释器，不能修改运行时目录；可写缓存保留在工作区内。macOS 使用 Seatbelt，Windows 使用 LPAC，网络和工作区外数据限制保留。始终允许模式也优先使用内置 Python/Node，继续具有用户选择的宿主访问权限。

后台服务及前台 Portal 都引用用户目录中的同一份运行时；升级只在 runtime-id 变化时原子替换并清理旧版本，避免每个服务目录各自复制，也避免依赖应用原安装位置。客户端启动参数、权限模式和工具接口保持不变；版本和路径通过已有 `portal_status.authorization.task_environment` 提供。客户端运行时缺失会报告修复安装，不静默搜索宿主解释器。

## 验证

- TypeScript 类型检查及审批、发件箱、场景调度、工具结果回归测试。
- 实际 HTTP 通道验证“允许一次”返回 `allow-once`。
- Portal Rust 工具、文件复制边界、超时输出和进程清理测试。
- macOS 原生沙箱验证 Python 临时/缓存目录、外部文件和网络限制。
- `npm run build:chat && node tests/portal-reliability-ui.mjs`：真实组件验证连续审批竞态、错误处理建议、窄窗口/深色弹窗、刷新后失败原因及删除。

## 执行层参考

参考本地 DeepSeek Harness `fcc0ad4621` 的 `scripts/primary-runtime/prepare.ts`、`apps/desktop/scripts/prepare-primary-runtime.ts` 和 `packages/shell/bash-sandbox/src/index.ts`：构建时准备可重定位解释器，执行器内部构造环境并接入平台沙箱。首版只选用其锁定的 Python/Node 归档，不引入整个 Harness、插件系统或文档依赖。

Codex CLI 的 [shell_environment.rs](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/shell_environment.rs) 和 [unified_exec.rs](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/runtimes/unified_exec.rs) 将环境构造与沙箱执行放在执行层内部。Portal 沿用这个职责划分；这些代码本身不作为“CLI 已内置完整 Python/Node 环境”的依据。

macOS arm64 首版运行时展开约 216 MiB（含 npm/npx）；两份上游压缩归档合计约 78 MB。Python 的相对符号链接保留，避免重复存放解释器。运行时标准库与发行版自带 pip 保留，文档、表格、PDF、绘图第三方库未加入。

## 2026-11-17 执行层 review

- 补齐 Node 发行版自带 npm/npx，验证离线 `npm run`、相对工作目录及后台进程。
- 全权限分支保留执行引擎补齐的系统 PATH，再前置内置解释器，避免丢失 Windows Git/系统工具路径。
- 共享运行时的 runtime-id 纳入升级 bundle 指纹。macOS 打包允许签名导致的原生文件字节变化，验证其签名；脚本和数据仍逐字节比对。
- macOS 本地测试包通过 5,931 个资源及 70 个链接校验；搬移到带空格路径、移除开发机 PATH 后，实际运行 Python、Node、npm 及插件离线安装。该包使用本地 ad-hoc 签名，不是公开发布产物。
- TypeScript 全量：1,403 通过、34 跳过；Rust 全量：396 通过、4 项 Windows 原生测试跳过。审批期限修复另做针对性回归。
- computer use 在源码客户端及最后构建的 macOS 测试包中进行真实 Being 对话，验证包内解释器、工作区临时目录、允许一次、明确拒绝与自然过期。允许日志为 `allowed=true, outcome=allowed`；拒绝日志为 `allowed=false, outcome=denied`。修复前实测撞上云端 120 秒通用超时；修复后真实回执为 `Tool approval did not complete; operation was not executed: 审批等待超过 60 秒，操作未执行；请重新发起并在弹窗中允许`。

当前客户端默认使用 managed runtime；没有新增宿主环境选择 UI。客户端管理的前台和后台 Portal 使用用户目录中的共享 runtime；独立 Portal 若不由客户端准备共享目录，仍需携带相邻 runtime 或明确使用宿主环境，不能仅分发引擎二进制就宣称已内置 Python/Node。

最后测试包对话中，`npm --version && npx --version && python3 ...` 已获单次授权并实际写出 `outputs/ui-runtime-final.json`；独立读回确认 Python 3.12.14 来自 `.app/Contents/Resources/portal-runtime`，中文 UTF-8 内容正确。随后模型服务短暂返回 429；恢复验证后，真实对话完整返回 npm/npx 11.19.0、Python 中文文件产物和后台 Node 日志（`UI_BACKGROUND_OK`，退出码 0，166 字节未截断）。不能把这次模型限流算作 Portal 执行失败。

测试客户端停留在「Portal 1117」回归场景。未提交、推送或发布改动。运行时下载/构建资源继续忽略 Git，锁文件、准备脚本及引擎源码可以提交；`heart-portal` 源码需在子模块中单独提交，再更新主仓库引用。

## 扩展任务与状态验收（2026-11-17）

新增真实引擎回归到 `tests/portal-permissions-native.mjs`，在 macOS arm64 重新构建的安装包上通过。Portal 进程的 PATH 只保留系统目录，避免误用开发机上的 Python/Node。

| 类别 | 已验证的任务或状态 |
| --- | --- |
| 数据处理 | 中文和空格子目录，CSV → SQLite 聚合 → UTF-8 JSON，ZIP 写入/读回，SHA-256 |
| Python 项目 | `python -m venv`、激活后运行 Python、venv 内 pip、离线安装本地 wheel、导入依赖、unittest discovery、线程池、SSL context |
| Node 项目 | npm script、离线本地依赖安装、require、npx 本地命令、`node --test`、worker_threads |
| 输出与失败 | 非零退出码、stdout/stderr 同时保留、中文输出限额不破坏 UTF-8、前台超时保留输出并停止执行 |
| 进程状态 | 前台/后台、stdin 拒绝和允许、后台取消、并发 Node 启动 Python、重启 Portal 后解释器/缓存路径及已安装项目依赖保持一致 |
| 安装状态 | 安装包移动到带空格目录、已有用户配置重开、运行时缺失/平台错误/解释器缺失均返回修复提示且不回退宿主解释器 |

扩展测试实际发现 `venv` 的 `ensurepip` 被沙箱阻断：Python `mimetypes` 读取公共系统文件 `/etc/apache2/mime.types` 时得到 `PermissionError`。仅补充该文件的只读权限（规范路径 `/private/etc/apache2/mime.types`），未扩大整个 `/etc` 的访问范围。修复后 venv、离线 pip 和 npm/npx 任务全部通过；11 项 macOS 沙箱测试继续通过，包括工作区外文件、网络、受保护文件和后台子进程取消。

新包位于 `out/runtime-expanded/Portal Desktop-darwin-arm64/Portal Desktop.app`，资源校验 5,931 个文件和 70 个链接通过；安装包搬移及用户配置重开测试通过。computer use 在真实「Portal 1117」对话完成 CSV/SQLite/JSON 跨 Python/Node 任务，并在新包重启后实际创建 `outputs/ui-venv-regression`、激活 venv、运行 pip、创建 SSL context 和执行包内 Node；回执中的 Python base prefix 和 Node 路径均指向 `runtime-expanded` 包内资源。

本轮真实客户端配置检测为“始终允许”，测试未调整此设置；真实对话验证的是全权限执行路径。“每次询问”及真实 Seatbelt 沙箱通过上述隔离工作区自动化验收，不能用全权限对话代替沙箱验收。

这些结果覆盖 macOS arm64 本地测试包；Windows 和其他架构尚未做原生验收。网络包下载和原生扩展编译未计入本轮通过范围。

## 2026-11-19 DeepSeek Harness 对照

对照 `/Users/d5/Desktop/code/deepseek-harness` 的 `dsh-sandbox`、`dsh-subprocess-local`、`bash-sandbox` 和 `tool-execution-pipeline` 后，Town 的权限入口和 macOS/Windows 平台隔离已经满足“受限调用不回退宿主”的核心要求；差异主要在执行生命周期：DeepSeek 将每次调用的沙箱事实、进程范围和输出句柄绑定在同一个 execution handle 上。

本轮修复了两处会影响后台任务可靠性的缺口：

- `portal_process kill` 改为使用创建时的 POSIX process group／Windows Job Object，先对整个 managed range 做优雅终止，再在 grace 超时后强制终止，不再只给 shell leader PID 发信号。
- `portal_process write` 不再持有全局 session map 锁等待 stdin 写完；子进程退出时释放写端。多个后台会话的 shutdown 也并行终止，已结束的会话不会无条件等待完整 grace 时间。

仍保留为明确平台边界的项目：Linux 受限模式目前没有 bwrap/Landlock 后端，会直接失败而不降级；后台输出仍是有界 UTF-8 ring（游标过期会报告 `truncated`），没有引入 DeepSeek 的可选 spill 文件和独立 stdout/stderr reader。它们属于能力扩展，不应在没有 Linux 原生验收或输出持久化需求时私自扩大实现范围。

回归覆盖新增的进程组后代清理和阻塞 stdin 场景；完整 Rust 测试继续作为发布前门槛。`heart-portal` 是子模块，源码改动需在子模块提交后再更新父仓库 gitlink。

## 2026-11-19 实机 MCP 验收

使用当前构建的 `heart-portal` 二进制，在临时 TCP 端口和隔离工作区逐项调用 MCP 工具。`initialize`、`tools/list`、状态、文件读写/编辑/复制/列表、正则搜索、网页抓取、截图、权限查询、工具重载、Kit 状态/设置/重载/用量、OAuth 参数校验和受控重启均得到预期响应。截图实际生成 2940×1912 PNG；网页抓取返回 Example Domain；重启响应返回后进程已退出。

Python/Node 前台命令分别返回 `5`、`42`，并通过 `sys.executable` 与 `process.execPath` 确认路径来自客户端 `resources/portal-runtime`。后台任务完成 stdin 写入、游标读取和取消；另一个任务启动 `sleep` 子进程后被 `portal_process kill` 终止，子 PID 的 `kill -0` 检查确认已清理。受限模式在没有桌面审批处理器时对 exec 和 file write 均返回“未执行”，目标文件不存在。MCP token 错误值返回 JSON-RPC `-32002` 未授权错误，正确值完成认证。

直接从源码调试目录启动且不传 `HEART_PORTAL_RUNTIME_DIR` 时，exec 会按设计返回“Bundled Python/Node runtime is missing”；Town Desktop 的 Portal supervisor 会注入该环境变量（`desktop/main/portal/background.ts`、`desktop/main/updates/runtime.ts`），因此打包客户端链路使用了随包运行时。OAuth 的真实授权需要用户在浏览器完成，本轮只验证了 provider 边界拒绝，不把不可交互的授权流程冒充成功。
