# Being 目标插件：Muse 行为观察与接入方案

2026-10-10。已实现通用插件协作 SDK 与独立目标插件；当前边界见下文。

## Muse 实际观察

通过 computer use 操作本机 Muse，而非根据截图猜测：

- 目标首页分为“追踪”和“创建目标”；创建入口按健康、人际关系、金融、职业、兴趣、效率提升、其他分类。
- 追踪项展示标题、当前状态摘要、完成复选框及操作入口。
- 打开已有目标，详情展示目标说明及按日期排列的活动时间线；观察到一条目标创建记录。
- 点击“效率提升”，先显示说明：在聊天中完善目标，确定后追踪进度。
- 点击“开始吧”，左侧打开聊天，右侧保留目标页，中间有宽度拖动手柄。Muse 自动发送分类引导消息，并追问具体希望改善工作、学习还是生活安排。
- 本次止于引导对话，没有完成新目标创建，也没有修改已有目标。自动更新、定时跟进和完成判定的内部机制未验证，不能据此断言 Muse 如何实现。

可借鉴的关系：对话负责澄清意图，目标页保存持续状态，时间线解释状态为何改变。

## 当前实现边界（按用户后续要求调整）

目标插件源码位于独立 GitHub 项目 [baiye0/being-goals-plugin](https://github.com/baiye0/being-goals-plugin)（本机 `../being-goals-plugin`），不放在客户端仓库。客户端只保留通用 Grove SDK 1.4、插件协作存储、字段验证与 Portal 命令桥。

**不修改 Being 的主体行为：** 没有修改主提示词、普通聊天 payload、工具循环或自主调度。先前设想的自动目标上下文注入已撤销，`desktop/main/chat/proxy.ts` 没有改动。

插件通过 `contributes.agent` 声明自己的任务指导和结构化数据字段。用户选择目标插件后，插件通过 `being.compose()` 生成明确调用该插件的草稿。Being 使用现有 `portal_exec` 的客户端命令 `@plugins` 读取契约与当前数据，再按类型契约操作记录。

```text
目标插件 UI ── grove.agent.snapshot / mutate ──┐
                                             ├─ 通用 PluginRegistry → 本插件、本 Being 的持久化数据
Being ── 已有 Portal @plugins 客户端命令 ──────┘
                                             └─ agent.changed → 插件视图刷新
```

## 通用 SDK

- `grove.agent.snapshot()`：读取插件工作区。
- `grove.agent.mutate()`：创建、版本化更新记录，或调整插件范围内的协作偏好/关注记录。
- `grove.agent.onChange()`：订阅本插件数据的失效通知，收到后重新读取。
- `contributes.agent`：`description`、`instructions`、`fields`、`required`。字段支持字符串、枚举、有限数、布尔和字符串数组。
- `agent.read` / `agent.write`：分别授权 SDK 和 Being 通道的读取/修改能力，安装时显示。

宿主不了解目标分类、目标状态和完成标准；这些都由插件契约和代码声明。因此相同 SDK 也可用于阅读清单、项目追踪等插件。

## Being 调用

```text
@plugins
@plugins {"plugin":"beings.goals","op":"describe"}
@plugins {"plugin":"beings.goals","op":"list"}
```

`describe` 返回插件行为指导和操作格式。`create` 传 `data`，`update` 传记录 ID、`expectedRevision`、`patch`、进展说明；`configure` 修改插件自己的协作偏好和关注记录。

写入统一经过权限检查、字段校验、串行化与原子保存。最近 256 次请求支持幂等重试。每条变更记录来源为用户或 Being，并保留调用场景。事件按插件隔离；停用或卸载后 Being 和旧会话无法继续访问。

## 插件体验

目标列表、详情、验收标准、下一步、时间线、类别引导、当前关注目标、协作偏好、并排对话和独立窗口均由独立项目提供。用户可以直接在插件管理目标，也可以在 Being 对话中创建和修改。

插件偏好只在显式插件协作时提供给 Being；没有自动附加到普通聊天的开关或机制。

## 当前限制

- 复用现有本机 Portal 客户端命令桥；需要兼容 Portal 与桌面客户端运行在同一机器、连接同一 Being。
- UI 页面关闭后，数据通道仍可使用；退出客户端后不可用。
- 不提供后台目标执行、提醒或自主唤醒，不把工具调用成功等同于目标已达成。
- 按 endpoint 隔离本机数据，无跨设备同步。上限 500 条记录、4 MiB 状态、最近 2000 条事件。
- 插件契约是任务指导，不是系统指令，也不是代替用户决策的策略引擎。

## 验证入口

客户端：`tests/plugin-agent.test.ts` 覆盖通用 SDK 合约、双向读写、幂等、并发冲突、身份/插件隔离、权限撤销和持久化。

插件项目：`tests/adapter.test.ts` 验证目标业务到通用 SDK 的映射；`tests/desktop.mjs` 使用临时 Electron 配置与假的 Being 服务，验证真实沙箱/SDK/认证命令通道和界面。普通聊天保持原文是明确验收项。该测试不代表真实模型已执行过工具。


最终验证：客户端类型检查、162 项相关单测、工作区布局测试通过；独立插件类型检查、3 项单测、构建和临时 Electron 集成测试通过；GitHub CI 的干净安装、类型检查、测试及出包通过。插件预览包见独立仓库 v0.1.1 Release。客户端 SDK 改动保留在当前工作区，尚未发布新的客户端二进制。
