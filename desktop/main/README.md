# Electron 主进程模块边界

按业务划分目录，模块内区分底层能力、桌面适配与 IPC。文件长度只用于发现问题；拆分依据是状态所有权和变更原因。

## 入口与依赖方向

```text
main.ts                       ready 前：身份、profile、协议声明、单实例与安装控制
└─ app/bootstrap.ts           服务组合、初始化顺序、跨模块回调、清理顺序
   ├─ app/lifecycle.ts        主窗口、第二实例、安装退出请求、退出失败恢复
   ├─ app/ipc.ts              唯一的桌面顶层 shell IPC 信任边界
   ├─ app/mutations.ts        一条共享的配置/Portal/安装变更队列
   ├─ app/configuration.ts   密钥库适配、配置加载、已有 Portal 配置迁移
   ├─ app/appearance.ts      窗口配色的读取、保存与发布
   ├─ app/desktop-notifications.ts  系统主题、通知点击与待跳转目标
   ├─ app/diagnostics.ts     诊断、资源采样、日志快照与归档
   ├─ app/shell-ipc.ts       剪贴板、本地文件、下载目录、浏览器等本机入口
   ├─ chat/desktop.ts        场景加载、代理组合、场景变更与桌面快照
   ├─ chat/desktop-commands.ts     本地命令服务、工具授权及退出清理
   ├─ chat/ipc.ts            模型配置、任务观察、最近历史入口
   ├─ portal/controller.ts   启停、接管、配置保存、升级恢复及安装停机
   ├─ portal/ipc.ts          Portal 用户操作与连接切换回调
   ├─ updates/desktop.ts     更新检查、下载进度、取消与安装交接
   ├─ plugins/desktop.ts     插件服务、窗口、上下文与 IPC 的组合
   └─ home/desktop.ts        Home 凭据、浏览器、文件服务与 IPC 的组合
```

`desktop.ts` 表示该业务的 Electron 集成层，不取代已有的 `client.ts`、`service.ts` 等领域实现。
Town、Kits、DSH 已有自己的 IPC 模块，继续从组合入口接入。业务模块不能反向导入 `main.ts` 或
`app/bootstrap.ts` 获取全局状态；跨模块协作由组合入口注入明确的对象或回调，不引入全局服务容器。

## 状态和启动约束

- `DesktopLifecycle` 持有窗口、浏览器、退出标志和未就绪时到达的安装请求；初始化完成后才能创建主窗口。
- `PortalController` 独占启动提示、恢复阻塞、安装意图和运行时升级状态。客户端更新与外部安装器共用它的 `shutdown`，避免两份恢复逻辑分叉。
- 通知模块持有待打开目标；更新模块持有下载取消句柄与待安装包；诊断模块持有正在生成的日志归档。模块内部状态不提升到入口。
- `MutationQueue` 只有一个实例，提供串行执行、待执行数与版本 Promise。后台观察用它避免迟到读取覆盖用户修改；失败不会阻塞后续操作。
- `createTrustedHandler` 校验主窗口、顶层 frame 和精确 shell URL，并在每次调用时读取退出/恢复状态。各模块只接受该注册函数，不能绕过校验直接注册桌面能力。
- 所有可能被替换的窗口通过 getter 获取；连接、场景与 Town 代次在操作发生时读取。初始化时的快照不能代替活状态。

启动顺序保留为：配置与通知 → Town/Portal 服务 → 聊天/插件/协议 → 本地命令与恢复控制器 →
可信 IPC → 主窗口 → 队列中的启动恢复 → 后台观察。首个 `snapshot` 也进入同一队列，等待启动恢复结束。

退出按 DSH → Kit → Portal → 浏览器/Home → 日志 flush 执行；可失败的清理完成后才结束轮询、销毁托盘并退出。
清理或安装交接失败时保留重试能力。窗口关闭隐藏、进程退出与系统会话结束仍使用各自原有语义。

## Review 结论与维护规则

原来的目录已按进程和业务分层，主要问题在 `main.ts`：大量业务处理藏在 `ready()` 闭包内，
模块间通过外层可变变量联动；新增功能通常只能继续往入口堆代码。重构把业务适配放回对应目录，
让组合入口只描述依赖与启动顺序。Portal 的接管、回滚和安装意图属于同一状态机，集中管理，避免按行数切碎事务。

新增 IPC 放在业务模块，接收统一 `handle`；涉及配置、Portal 或安装的操作使用同一 `exclusive`。
新增服务必须明确清理时机和失败后的恢复方式。增加业务状态前先确定所有者，不在组合入口复制模块状态。
构建常量与资源路径留在 `main.ts`，通过参数传入，便于隔离测试替换资源而不修改业务代码。

仓库已有跨进程依赖规则测试；`tests/desktop-boundaries.test.ts` 补充了 IPC 来源拒绝、运行时门禁、
串行队列失败恢复、提前到达的第二实例、安装请求以及退出失败重试。
`tests/update-recovery-electron.mjs` 编译实际主进程与 preload，在隔离 profile 下验证离线回滚、恢复重试、
下载竞争与安装失败后重试。测试替换网络与安装边界，不安装真实客户端或改动用户配置。
