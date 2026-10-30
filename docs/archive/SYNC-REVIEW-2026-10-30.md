# 2026-10-30 同步与整体改动审查

## 同步结果

| 仓库 | 同步前 | 同步后 | 分支 |
| --- | --- | --- | --- |
| Town-Client | `d1ea384` | `6c8a6b1` | `main` |
| heart-portal | `8487e1e` | `ec5befb` | `codex/portal-desktop-compat` |

两个仓库均已 fetch 并快进到对应远端分支，ahead/behind 均为 0。主仓库记录的子模块提交与实际 HEAD 一致，无嵌套子模块需要更新。

同步前的本地修改和未跟踪文件保存在 stash `46e7e86971c90f47c1a4700261cbba7da58dfcb4`，同步后已恢复。11 个重叠文件自动合并，没有文本冲突；备份中的 91 个文件均仍存在。备份保留。本次没有提交、推送或替换已安装客户端。

## 审查发现与处理

1. **P2，已修复：Portal 追加文件过早报告成功。** `portal/src/tools/file.rs` 的 append 路径只等待 Tokio `write_all`；底层阻塞写入可能尚未完成，立即读取仍得到旧内容，且路径锁会提前释放。现增加 `flush().await`，写入完成后再返回。首次全量 Rust 测试中 `supervised_append_cannot_modify_a_hard_link_target` 实际读到 `first`，期望 `firstsecond`；修复后全量通过。这里保证待完成的写入已完成，不声明断电持久性。
2. **P2，已修复：上游后台引擎测试夹具没有执行权限。** `tests/background.test.ts` 新增测试写入的 `source-engine` 默认不可执行，生产代码的可执行性检查因此返回 EACCES，无法进入要验证的旧引擎替换流程。为夹具明确设置 `0o700`，保留生产检查；全量复验通过。
3. **配套构建问题，已处理：本地旧引擎不支持新的 `auto-review` 默认模式。** 首次 `portal-orphan.test.ts` 启动替代引擎失败。重新构建包含本次修复的 macOS arm64 Portal，并运行 `prepare:desktop` 更新配套资源及运行时清单后，该测试及全量单测通过。

Portal 的 `file.rs` 修复目前是子模块内的未提交修改；其他原有 UI/性能改动也继续保留在工作区。后续提交需先在子模块提交修复，再由主仓库记录对应 gitlink。

## 审查范围

检查上游主仓库 34 个文件、子模块 15 个文件的变化，以及本地累计 UI/性能修改。重点检查：

- 新默认权限模式、历史权限保留、单次授权、沙箱与显式主机执行、受保护路径、MCP 启动门控、网页抓取边界。
- 本机 Portal 启动与后台引擎替换、旧资源兼容检查、日志广播合并。
- React 事件监听生命周期、流式更新与重放、历史窗口、阅读位置补偿、消息计数与回到底部。
- 共享设置容器、草稿与保存状态、键盘和焦点、内联配置、隐藏浏览器 IPC、按需文件预览。
- 消息菜单作用域、纯文字添加及撤销、时间分组、发送按钮、Town 布局与窄屏适配。

在已审查代码和以下测试覆盖范围内，没有发现其他可确认的阻塞问题。这不是完整安全认证或全部平台的发布验收。

## 验证结果

| 验证 | 结果 |
| --- | --- |
| `npm run typecheck`、`npm run lint:chat-hooks`、`npm run build:chat` | 通过 |
| `npx vitest run --maxWorkers=2` | 145 文件通过，10 文件跳过；1,168 测试通过，33 跳过，0 失败 |
| `cargo test --manifest-path portal/Cargo.toml --jobs 2`（子模块） | 382 通过，4 忽略，0 失败 |
| `npm run build:portal`、`npm run prepare:desktop` | 通过，macOS arm64 配套资源已重建 |
| `portal-permissions-native.mjs` | 通过：真实 macOS 沙箱、外部文件单次授权、显式主机执行、拒绝与授权不复用、MCP 门控 |
| `PORTAL_LAYOUT_MUSE_ONLY=1 node tests/workspace-layout.mjs` | 通过：三种尺寸、统一设置、草稿与保存/重试、键盘焦点、菜单、深色；关闭设置后 20 次全局更新引起的设置 DOM mutation 为 0 |
| `chat-hooks.mjs` | 通过：StrictMode、稳定订阅、最新回调、目标替换、菜单/拖拽清理、帧取消 |
| `chat-message-flow.mjs`、`chat-surface-interaction.mjs` | 通过：时间分组、菜单、复制、纯文字添加、草稿、空白鼠标/触摸点击、菜单关闭、按钮状态、窄屏与深色 |
| `chat-scroll.mjs`、`chat-history-window.mjs` | 通过：阅读位置、长回复锚定、恢复跟随、增量历史与 DOM 保留 |
| `settings-navigation.mjs` | 通过：草稿导航/丢弃、就地展开、键盘 tabs、关闭浏览器零 IPC、模态可见性 |
| `town-feed-layout.mjs` | 通过：篝火/围炉/私信、引用展开/复制/筛选、发出消息对齐、435–1920px 布局与粘性标题 |
| `chat-react.mjs` | 通过：历史/索引、模型配置、附件、实时/拼接流、停止/错误清理、场景草稿、重放 |
| `pdf-preview.mjs`、`chat-lazy-resources.mjs` | 通过：PDF 按需加载/渲染/损坏回退/重开、音频和消息资源按需加载 |
| `chat-render-performance.mjs` | 通过脚本阈值，具体测量及限制见下 |
| 主仓库与子模块 `git diff --check` | 通过 |

日志在本地 `test-results/sync-review-*.log`，不要求将测试产物提交入库。

## 保留的验证缺口

- 本次 headless Chrome 的流式测试测得 P95 帧间隔 **33.4ms**，同页面空闲 P95 **16.8ms**，未观测到长任务；1,000 条缓存只挂载当前窗口的 41 条消息。脚本通过不代表稳定 60fps，更不能证明已安装客户端在拖窗、空闲或 GPU/WindowServer 层面的卡顿已消失。
- 用户此前反馈的“未打开弹窗，直接点击就出现灰色蒙层”在此次隔离鼠标/触摸、菜单开关及主题/尺寸矩阵中没有复现，不能据此声明根因已解决。
- Windows 原生行为、安装/升级、真实常驻服务接管以及跳过的测试不计为通过；本次没有向真实 Being/Town 发送内容，也没有重新做竞品实机对比。
- Rust 构建仍有既有警告；workspace fixture 的 IIFE 打包仍输出 XLSX Worker `import.meta` 提示。生产 ESM 构建通过；该提示不作为 XLSX 实机验收通过的依据。
