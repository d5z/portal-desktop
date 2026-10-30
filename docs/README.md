# 文档导航

先阅读[项目介绍](../README_CN.md)。本页按用途组织文档；设计方案和历史验收中的状态以记录日期为准。

## 开发与维护

| 入口 | 内容 |
| --- | --- |
| [桌面代码目录](../desktop/README.md) | 主进程、preload、共享契约与渲染器的职责 |
| [React 界面结构](../desktop/renderer/README.md) | 业务模块、状态、服务与组件的依赖约定 |
| [桌面架构](../desktop/ARCHITECTURE.md) | 连接、代理、消息场景与信任边界 |
| [构建与交付](../desktop/BUILDING.md) | 环境、构建、安装包及平台限制 |
| [测试说明](../desktop/TESTING.md) | 自动化入口、隔离方式和覆盖范围 |
| [Web 开发与部署](../web/README.md)、[OSS 静态部署](../web/OSS.md) | 独立 Web 构建与服务配置 |
| [API / SDK 指南](../DEVELOPER-API-SDK.md)、[插件类型包](../plugins/sdk/README.md) | Heart、Town 与 Grove 插件契约 |
| [Town SDK 接入记录](../desktop/TOWN-SDK.md) | 协议适配及按日期记录的变更 |
| [上游来源](../UPSTREAM.md) | Portal 子模块固定版本与兼容分支维护 |
| [品牌资源](../resources/branding/README.md) | 图标来源与生成约定 |

## 功能与运行

| 入口 | 内容 |
| --- | --- |
| [工具权限](../desktop/TOOL-PERMISSIONS.md) | 审批、命令沙箱与子代理权限 |
| [附件与多模态](../desktop/ATTACHMENTS.md) | 上传、解析、下载与本机文件预览 |
| [本地文件预览](../desktop/LOCAL-ARTIFACTS-AND-PORTAL-HARNESS.md) | 本地路径、预览生命周期与工具协作 |
| [图片生成](../desktop/IMAGE-GENERATION.md)、[生图引导种子](seeds/being-service-image-generation.md) | 异步任务回执及原消息渲染 |
| [Intelligent UI](../desktop/renderer/shared/intelligent-ui/README.md) | 当前渲染协议、状态与验证入口 |
| [Portal 恢复](../desktop/PORTAL-RECOVERY.md) | 启动、旧实例、重连与诊断位置 |
| [Portal 调用排查](../desktop/PORTAL-TROUBLESHOOTING.md) | 截图、路径、命令与后台会话 |
| [配套更新](../desktop/UPDATING.md)、[发布说明](../desktop/RELEASE_NOTES.md) | 客户端与引擎升级及交付记录 |

`heart-portal/` 是独立子模块，其开发和运行文档从 [Portal README](../heart-portal/README.md) 进入；客户端文档只维护接入边界。

## 设计与历史资料

- [交互优化与 UI skills](design/UI-SKILLS-AND-INTERACTION.md)：Muse / Grok 交互参考、性能改动与技能选型。
- [智能 UI 设计](design/INTELLIGENT-UI-DESIGN.md)：设计取舍、演进与验收目标。
- [目标插件设计](design/GOALS-PLUGIN-DESIGN.md)：通用宿主与独立插件的分工。
- [共同工作空间探索](design/SHARED-WORKSPACE.md)：已落地部分与待协商协议。
- [Visualize 接入设计](design/VISUALIZE-INTEGRATION.md)：产物、技能与运行时的后续提案。
- [历史核查与验收](archive/README.md)：保留当时的证据、限制和问题记录。
- [2026-10-30 同步与整体审查](archive/SYNC-REVIEW-2026-10-30.md)：主仓库/子模块同步、修复、回归结果与验证缺口。
- [网关实验原型](../experiments/gateway/README.md)：未接入客户端构建的 Python 原型。

## 维护约定与整理结论

当前功能说明就近维护在所属模块；跨模块设计放 `docs/design/`，带日期的核查和验收放 `docs/archive/`。新增文档在本页登记，同一功能的当前行为只维护一份说明，历史资料链接到当前入口。

2026-10-28 整理确认：

- 原 `runtime.ts` 内部发送队列的唯一入队函数 `queueDraft` 没有调用者，数组始终为空；实际队列由 `scene-runtime.ts` 管理，移除旧队列及其只写不读的状态。
- 删除无引用的 `generationPrompt` 提示词、未被读取的 TUI 预览参数，以及附件状态提前返回后不可达的“思考中”分支。活动记录自身的预览数据和智能 UI 测试样例继续保留。
- 根目录中英文 README 统一链接本页，删除重复维护的文档导航表。
- 清理未使用导入、参数和组件属性，TypeScript 开启 `noUnusedLocals` 与 `noUnusedParameters`，后续随类型检查阻止同类遗留。
- 两个 Python 网关原型没有产品构建、测试或 CI 引用，但可独立运行，不能据此断定无用，移入实验目录保留。历史设计和验收记录同样保留。
- 图标中存在相同字节的文件，但分别服务打包和 Web 静态资源路径，保留各自入口。中英文 README 也属于有意保留的双语说明。
- 聊天 `runtime.ts`、Town 状态模型与主进程入口仍较大，是后续按职责拆分的候选；本次保留这些模块的结构，清理其中已确认的死代码。
