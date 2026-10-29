# 工具权限与命令沙箱

聊天输入区显示当前权限，点击后在按钮旁展开下拉菜单，选择只读、安全协作（默认）、完全信任后立即保存并重启受管 Portal，不再打开详细设置弹窗；这会中断正在执行的本机任务。菜单可用方向键选择、Enter 应用、Escape 或点击外部收起，重复选择当前模式不会重启。连接设置中的权限卡片仍随整体设置保存。审批弹窗的「调整权限…」先拒绝当前审批再打开同一菜单，不将其转换为持久授权。

旧客户端配置迁移为 supervised。前台和后台均显式传入 --permission-mode，旧引擎不认识参数会启动失败，不能静默绕过。发布时须同时重建并打包 Rust 引擎。独立 CLI 的历史配置仍默认 full-access。

| 模式 | 工作区读取 | 工作区编辑 | 命令及外部工具 | 子代理 |
| --- | --- | --- | --- | --- |
| read-only | 允许 | 拒绝 | 拒绝 | 可运行，工具同样只读 |
| supervised | 允许 | 允许，保护配置除外 | 每次审批；Windows 使用 LPAC，macOS 使用 Seatbelt | 同样审批与沙箱 |
| full-access | 允许 | 允许 | 使用本机权限，不询问 | 保留完全信任能力 |

原有 exec、kits 开关及文件路径边界仍然有效。没有客户端审批通道时，需要审批的操作失败。

安全协作模式的文件追加会检查实际打开的文件句柄，拒绝硬链接，防止通过别名改动受保护配置或工作区外文件。覆盖写入和编辑使用原子替换，不改动硬链接指向的原文件。

## 审批

ToolHost::call_with_scene 在内置、Kit、自定义 MCP 分发前判定 allow / ask / deny。只对保留命名空间的内置工具自动允许；第三方的名称、描述和只读提示不构成授权。

请求通过随机本机端口和轮换 bearer capability 到达 Electron 主进程，再由可信顶层窗口展示 React 对话框。聊天 iframe 只能请求打开设置，不能审批。对话框完整展示工具、参数、工作区、隔离方式和会话；超长请求拒绝，控制字符转义。默认焦点为「拒绝」。授权绑定随机请求 ID，仅用于当前调用，不保存白名单，不接受模型的 approved 字段或 @security-approve 命令。

审批 120 秒过期；断开、取消、模式或连接变化不能获得授权；同一时刻只接受一个待审批请求。日志记录工具名、策略和结果，不记录参数或令牌。

## Windows 命令隔离

前台、后台命令统一通过 sandbox::shell_command。安全协作模式为每次命令创建独立 Windows AppContainer，并启用 LPAC，不授予网络能力。只向本次随机 package SID 授予工作区权限。已有 .git、代理目录和 Portal/MCP 配置只读；.env*、SSH 和客户端连接文件不授予访问。存在硬链接的工作区拒绝运行命令，避免修改工作区外同一文件对象的 ACL；符号链接和目录联接不授予目标权限。启动前保存现有对象的 ACL 并隔离继承，再给普通目录授予可继承的本次沙箱权限，使新建文件和子目录可立即读写。受保护对象的祖先目录不可移动；显式指定的配置路径缺失时拒绝启动。互斥锁串行管理临时 ACL；正常结束按文件 ID 恢复原 ACL 和继承设置，清除新对象继承的授权并删除 profile。

为兼容 PowerShell，沙箱进程带有 registryRead、lpacInstrumentation、lpacCom 系统能力。继承句柄限定为标准输入输出；环境变量清空后按系统白名单重建，不继承令牌、代理配置或自定义 PATH。进程挂起创建，加入 kill-on-close Job Object，核验 AppContainer token 后再恢复；最多 32 个子进程。命令结束会终止后代进程。

Windows PowerShell 使用 Workspace:\ 专属 PSDrive，避免给工作区父目录扩大权限。文件命令可用相对路径；调用 .NET 文件 API 时，可用 (Get-Location).ProviderPath 获取本机路径。CMD 使用本机工作区路径。外部开发工具需要位于已授权工作区或系统可访问目录，不继承宿主的 Node/Python/Git 安装路径。

沙箱初始化失败、网络工作区、不支持的平台、超过 20,000 个现有目录项的工作区均报错，不自动回退到宿主执行。目前 Linux 的安全协作命令尚无 OS 后端。完全信任显式跳过命令沙箱。

## macOS 命令隔离

安全协作命令经绝对路径 `/usr/bin/sandbox-exec` 启动 `/bin/sh`，默认拒绝，子进程继承 Seatbelt 策略。允许工作区读写和指定系统、Homebrew 运行库的读取；网络（包括回环连接）不可用。工作区外文件内容不可读写，符号链接不扩大授权范围。只允许同沙箱进程之间发送信号，不授予任意 Mach 服务访问。

保留 `.git`、`.codex`、`.agents` 和 Portal/MCP 配置的只读保护；`.env*`、`.ssh`、客户端连接文件及当前配置不可读写。自定义配置的父目录不能被重命名以绕过限制。禁止创建硬链接；存在硬链接或超过 20,000 项的工作区在运行命令前报错，可选择更小的工作区。路径通过 Seatbelt 参数传递，避免把文件名解释为策略。

环境变量清空后仅设置固定 PATH、LANG，以及指向工作区的 HOME/TMPDIR；不继承宿主令牌、代理或 shell 启动配置。宿主安装的开发工具如果依赖其他目录或服务，可能无法运行。同步与后台命令共享这一入口和既有进程组清理机制。缺失 sandbox-exec 或策略初始化失败会报错，不回退到本机执行。

后台服务的配置指纹包含规范化后的权限模式；切换权限会重建 runner/config，旧版本服务在下次启动时更新，避免沿用完全信任配置。

## 子代理

受限模式使用任务专属 Pi stdio 进程，不接管可能具有直接执行权限的旧 daemon。关闭 Pi 内置工具及自动发现的扩展、技能、提示模板，只加载 Portal 生成的工具扩展；子代理本身仍可用。

扩展通过随机令牌认证的回环 socket 调用同一 ToolHost，支持文件、搜索、命令、后台进程和网页工具。白名单不包含递归派生子代理或任意扩展。请求沿用父级权限模式、工作区与审批处理器，携带任务会话。只读子代理不能写入；安全协作子代理执行命令仍需单次批准并进入对应平台的命令沙箱。任务取消会关闭通道并清理进程。

默认固定版本 Pi 0.65.2 已用真实 SDK 验证扩展加载、启用工具集合、认证转发、非白名单阻断和取消。自定义 Pi 命令须兼容此版本的扩展 API。

## 边界与限制

这是工具授权与 **shell 子进程** 的 OS 隔离，不是整个客户端、模型联网进程或第三方 MCP/Kit 的隔离。经批准的外部工具仍可能拥有宿主权限，对话框会说明。Pi 控制器需要连接模型，属于受信任运行时；工具操作经 Portal 执行。

AppContainer 仍可访问 Windows 允许的系统资源和自身 profile 存储。ACL 方案不防御同用户恶意宿主进程并发替换路径；不要把系统目录或用户主目录设为工作区。新建对象继承所在普通目录的本次沙箱授权。强制终止 helper 或系统崩溃可能留下随机 SID 的临时 ACL/profile；这些 SID 不复用，正常退出会回收。权限降低不等于撤销此前完全信任任务启动的所有外部进程。

## 参考

- [Codex tool orchestrator](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/orchestrator.rs)：执行前协调审批与隔离。
- [nanoMuse Sentinel](https://github.com/nano-muse/nanoMuse/blob/main/nanomuse/sentinel/gate.py)：统一策略入口与授权范围。
- [nanoMuse sandbox](https://github.com/nano-muse/nanoMuse/blob/main/nanomuse/sandbox.py)：区分应用策略与系统隔离。
- [Microsoft AppContainer](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer)：LPAC、能力和 ACL 边界。

参考于 2026-10-23；借鉴架构，不宣称与 Codex/Muse 的沙箱完全等价。

## 验证

~~~powershell
npm run typecheck
npm run build:chat
npx vitest run tests/approval-dialogs.test.ts tests/tool-approval.test.ts tests/settings.test.ts tests/portal.test.ts tests/client-commands.test.ts
cargo test --manifest-path heart-portal/Cargo.toml -p heart-portal
cargo build --manifest-path heart-portal/Cargo.toml -p heart-portal
node tests/windows-sandbox-native.mjs
npm install --prefix output/pi-security-check --ignore-scripts --no-audit --no-fund @mariozechner/pi-coding-agent@0.65.2
node tests/pi-tool-bridge.mjs
~~~

scripts/preview-permissions.mjs 使用真实组件和模拟 API，不修改真实配置。Playwright 已检查浅色/深色界面、保存选择、拒绝焦点和审批跳转设置。真实 Windows 测试覆盖 CMD/PowerShell 写入、工作区外读写、配置保护、网络阻断、秘密环境变量过滤、硬链接/目录联接及后代进程终止。

macOS 原生回归（独立临时工作区和 launchd 服务，结束后清理）：

~~~sh
cargo test --manifest-path heart-portal/Cargo.toml -p heart-portal macos_sandbox
npm run build:portal
PORTAL_DESKTOP_NATIVE_PERMISSION_TESTS=1 npx vitest run tests/permissions-macos-background.test.ts
~~~

`tests/permissions-packaged.mjs` 同时支持 macOS 测试包，验证审批后的真实执行、拒绝、工作区外读取阻断及模式切换；通过 `PORTAL_DESKTOP_EXECUTABLE` 选择待测可执行文件。`PORTAL_DESKTOP_TEST_MOCK_KEYCHAIN=1` 仅隔离 UI 测试凭据，不覆盖系统钥匙串授权。
