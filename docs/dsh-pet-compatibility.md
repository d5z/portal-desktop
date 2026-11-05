# dsh-pet：通用 DSH 宿主的回归样本

2026-11-04，原版 npm 包 `dsh-pet@0.4.1`，未修改插件源码。参考 [插件页面](https://dshopen.org/zh/plugins/dsh-pet/) 和 [通用兼容层说明](../plugins/DSH-COMPATIBILITY.md)。本文件记录样本行为，不定义宿主中的特殊分支。

## 接入方式

在「设置 → 插件 → 管理第三方插件」安装原版包。Town 使用 Cordis Loader 加载 Host/Client、依赖注入、路由和界面贡献；桌宠设置中的「仅桌面」「仅浏览器」「两者都显示」由插件自己解释。

独立透明窗口由原版插件的辅助 Electron 进程创建。Town 提供其依赖的通用 `webServer.port/getOrigin` 和 `connection.authenticatedUrl`；不加载插件内部窗口模块、不注册其私有协议、不注入 `DSH_PET_*` 或 `__dshPetRebuildUi`，不为插件实现菜单/碰撞/截图 IPC。辅助进程的运行时下载、权限、用户数据目录及退出逻辑均由原版插件管理。

模型与图片通过通用服务接入。先检查 Being 当前模型；其现有接口不支持插件独立生成时，回退到客户端已有 subagent 配置，不提供额外 DeepSeek 模型设置。当前支持 OpenAI Chat Completions 兼容协议；其他协议、OAuth、工具调用与语音转写明确提示未适配。请求可能产生现有模型 API 费用。服务提供者插件优先于 Town 默认实现。

右侧栏、命令 UI 和快捷键使用通用注册接口。原版 Cmd/Ctrl+Shift+P 与 Town 命令面板冲突，管理页会提示未启用该组合；不会按插件 ID 改成另一个组合，可从「桌宠对话」按钮进入。

## 原版行为与限制

| 功能 | 当前范围 |
| --- | --- |
| 配置、资源、动画、待办、命令、右栏 | 通过共享 Host/Client 服务加载，原版逻辑处理 |
| 独立透明窗口、托盘、拖动、碰撞 | 原版辅助进程提供；停用/退出依靠插件的 Cordis disposer。Town 不接管任意插件子进程 |
| 模型文字/图片对话、自动碎碎念 | 通用 OpenAI-compatible 流式服务；需配置并由供应商支持 |
| 图片保存与语音转写 | 通用 attachments / speechToText；真实设备授权和供应商能力另计 |
| 余额 | 可供原版官方 API Key 模式使用；不读取 Harness 登录账号或免费额度 |
| Town 工作状态 | 公开 townActivity 快照/事件及最小完成/失败映射；不再向桌宠私有 work-status 路由写入数据。原版只消费自己识别的公开事件，不保证全部 Being 状态逐档映射 |
| 通知、打开主程序 | 主页面通过 uiWorkspace 跳转 Town 场景；原生 helper 硬编码 `dsh://open` 时仍按系统关联处理，可能打开 Harness，不能声明已映射到 Town |
| 其他 Harness 能力 | 完整 Session/Agent、工具/审批、MCP、终端、自动化、其他私有桌面 IPC 尚未等价桥接，缺失依赖/调用明确报告 |

独立 helper 的窗口权限、通知偏好和存储遵循插件自身实现，不受 Town 主页面通知开关统一控制。其系统应用数据目录可能与其他宿主运行的同一插件共享；Town 不改写第三方路径来伪装隔离。

## 验证

详细结果及尚未完成的检查见[2026-11-04 对照验收](dsh-pet-verification-2026-11-04.md)和[2026-11-05 原生补验](dsh-native-verification-2026-11-05.md)。解锁后已恢复 Harness 桌宠、验证四种显示模式与历史恢复，并修复附件引用缺少 `sha256:` 前缀导致原版插件取图失败的问题。全量单元测试 1350 项通过、33 项按环境跳过；不能将跳过项目或未完成的人工检查计为通过。

- 先前通过 computer use 对照 DeepSeek Harness 的原版动画、菜单、待办和显示位置，已恢复其配置。
- 通用机制重构后，computer use 已确认从安装包的原始 `file://.../electron-helper/index.html` 创建独立窗口，动画和原版右键菜单可用；启动日志确认由插件创建辅助进程，而非 Town 内部原生模块；从管理页停用后原版辅助窗口退出，重新启用后恢复。
- API 集成测试使用原版包与本地模拟服务，覆盖配置、命令、加密密钥、文字/图片对话、失败恢复、历史、睡眠/唤醒、四种显示配置、转写、资源、待办、启停和冷启动持久化。HTTP-only 测试显式关闭样本 GUI，避免 CI 下载/启动窗口；此开关仅在测试，不在产品代码。
- computer use 已验证配置保存即时更新、睡眠/点击唤醒、两者都显示、两端待办与对话共享、桌面图片输入、模型失败提示与恢复；后续 UI 重启、完整模式切换和配置恢复被 Mac 锁屏阻断。
- 通用契约测试使用不同名称的辅助进程插件验证真实端口、认证链接、cookie、来源检查、令牌轮换和停用清理；无需更改宿主代码。
- 真实付费 API、账户余额、麦克风、截图、多屏、Windows/Linux 和真实 Being 会话端到端联动未实测。拖动曾遇到 computer use 坐标错误，不计为通过。

```sh
npm run typecheck
npm run test:dsh-contract
DSH_PET_SOURCE=/path/to/dsh-pet-0.4.1.tgz npm run test:dsh-pet-host
```

SDK 类型：[dsh.d.ts](../plugins/sdk/dsh.d.ts)。使用说明以通用宿主契约为准，不能从此样本推断所有 DSH 插件完整兼容。

2026-11-05 更新：原版 dsh-pet 0.4.1 在隔离 Town 中复用 subagent 配置，computer use 验证独立透明窗口的「配图 → 吃白饭的大肥鱼」成功显示图片和文字。使用本地 SSE 测试接口，不等于真实付费模型验收。缺失模型、停用 subagent 和 HTTP 503 的失败路径由宿主集成测试覆盖。
