# Scene Session 极简实现 — 交接文档

> Date: 2026-09-17 (Day 275)
> From: 泽平 + seam_walker
> To: 白夜
> PRD: `/Users/sw/heart/docs/feat/scene-session.md` v0.2

## 背景

Being 可以有多个 scene（对话场景）。Heart 侧的 scene-awareness-v2 **已全部 shipped**（schema、§P3 纯净、NFC 标签、SSE 路由）。缺的是 Desktop 侧让 being 能**回看 scene 对话历史**。

## 已完成（Heart 侧）

一行改动：being 进入有场景的呼吸时，感知信号里多一句提示：

```
[场景] 方案讨论 — portal_exec @context 可回看对话历史
```

改动位置：`crates/consciousness/breath/src/adapters/surface.rs` `push_scene_signals()`

## 要做的（Portal Rust + Desktop）

### 1. Portal Rust：portal_exec 的 `@` 分流（~50 行）

`portal_exec(command="@context scene-abc")` 到达 Portal Rust 时，检测 `@` 前缀，不走 shell，路由到 ClientHandler。

```rust
// portal/src/tools/exec.rs 或类似位置
if command.starts_with('@') {
    let (verb, args) = command[1..].split_once(' ').unwrap_or((&command[1..], ""));
    return self.client_handler.handle_client_command(verb, args, meta.scene_id.as_deref()).await;
}
// 否则走正常 shell 执行
```

定义 trait（给第三方打样）：

```rust
pub trait ClientHandler: Send + Sync {
    fn handle_client_command(
        &self,
        verb: &str,
        args: &str,
        scene_id: Option<&str>,
    ) -> Pin<Box<dyn Future<Output = Result<String>> + Send + '_>>;
}
```

Portal Rust 默认实现返回 `"no client handler registered"`。Desktop 覆盖它。

### 2. Desktop：实现 ClientHandler（~100 行 TypeScript）

Desktop 已有 scene 数据（`scenes.ts`、`chat-scene.tsx`）。只需要注册 handler 响应 `@` 命令：

```typescript
// desktop/main/ 或 shared/ 里
function handleClientCommand(verb: string, args: string, sceneId?: string): string {
    switch (verb) {
        case 'context': {
            // args 可以是 scene_id，也可以为空（用当前 scene）
            const targetScene = args.trim() || sceneId;
            const history = getSceneHistory(targetScene, { limit: 20 });
            return formatHistory(history);
        }
        case 'scenes': {
            // 列出所有 scene + 状态
            const scenes = listScenes();
            return formatSceneList(scenes);
        }
        default:
            return `unknown client command: @${verb}`;
    }
}
```

`getSceneHistory()` 从 Desktop 本地的 IndexedDB / 内存里取（chat 消息已经按 scene 分组了）。

### 3. @verb 清单（v0.2 scope）

| verb | 参数 | 返回 |
|------|------|------|
| `@context` | `[scene_id]`（可选，默认当前） | 最近 20 条对话 + 时间戳 |
| `@scenes` | 无 | scene 列表 + 最后活跃时间 + 未读数 |

### Portal↔Desktop 通信

Portal Rust 跑在 Desktop 进程里（child process）。两者通过现有的 IPC 通道通信（portal service 的 stdin/stdout 或 node addon）。`@` 请求通过同一通道传递，Desktop 返回结果。

## 参考代码位置

| 文件 | 说明 |
|------|------|
| `heart/crates/consciousness/breath/src/adapters/surface.rs:696-730` | push_scene_signals — 场景感知信号 |
| `heart-portal/portal/src/tools/mod.rs` | portal_exec handler — 在这里加 `@` 分流 |
| `portal-desktop/desktop/renderer/chat/models/scenes.ts` | scene 数据模型 |
| `portal-desktop/desktop/renderer/app/components/chat-scene.tsx` | scene UI 组件 |
| `heart/docs/feat/scene-session.md` | 完整 PRD |
| `heart/docs/feat/scene-awareness-v2.md` | Heart 侧 scene 架构（已 shipped） |

## 设计决策（已定，不需要重新讨论）

1. **两个入口各管各的**：`scene_context()` = sub-agent 工作台，`portal_exec @context` = scene 对话历史
2. **scene session 和 sub-agent session 正交**：不 1:1 绑定
3. **`@` 前缀是客户端能力的通用穿透通道**：给第三方打样，未来可扩展更多 verb
4. **Heart 零改动**（感知信号一行提示已完成）

## Bug 提醒

- Desktop 的窗口和 session 还有 bug（上次测试发现的），顺手修
- portal_exec 的 `cmd_path_from_body`（Heart 侧）会记录 `@context` 为 cmd_path，可能影响 proc-tao 代谢——如果有问题，Heart 侧加个 `@` 过滤即可

---

*有问题随时问。*

## Desktop 实现说明（2026-09-21）

- `portal_exec` 在进入 shell 前识别 `@`（允许前导空白），通过公开的异步 `ClientHandler` trait 分发。未注册客户端时报错，未知命令不回落 shell；保留 `tools.exec` 开关。
- `@context [scene_id]` 默认使用调用元数据里的 `scene_id`，显式参数优先。支持 MCP `params._meta.scene_id`、`params.meta.scene_id` 和请求 envelope `meta` / `_meta`。缺少当前场景时报出用法，不猜测可见窗口的场景。
- 从当前 Being 对应的 IDB 读取最近 **50 条**严格匹配的消息，按时间顺序输出角色、时间戳和文本；单条与总输出均有限额。未标记消息不混入指定场景。
- `@scenes` 合并当前 Being 的本地会话目录与缓存中出现过的场景，返回名称、最后活跃时间和缓存消息数。新建但未发消息的本地会话也会出现（消息数为 0）；这不是服务器全量场景目录。现有存储没有持久化未读数，因此不伪造该值。
- 两者只回看本地已确认历史，不改变 `scene_context()` 或 sub-agent session。

### 实际通信链路

现有 Portal 的 stdin 被关闭，stdout/stderr 用于日志；因此使用独立的 loopback HTTP 桥接，不复用日志流：

`Heart tools/call → Rust ClientHandler → Desktop main → sandboxed beings://chat/client-context.html → IndexedDB`

Desktop 在随机 `127.0.0.1` 端口监听，把 `{port, token}` 写到 profile 的 `.portal-client.json`（0600）。客户端管理的前台/后台 Portal 通过 `HEART_PORTAL_CLIENT_FILE` 获取路径，每次调用重读，以支持 Desktop 重启。后台服务重建和 runtime 升级保留该路径。

协议：`POST /command`，`Authorization: Bearer <token>`，JSON `{endpoint, verb, args, sceneId?}`，结果 `{text}` 或 `{error}`。拒绝浏览器 Origin 请求、无效凭证、过大请求和与 Desktop 当前 Being 不一致的 endpoint；返回前再次核验连接。Rust 不使用代理或重定向，10 秒超时。Desktop 8 秒超时。

IDB reader 与 Loom 同 origin/session，独立于可见窗口；没有 preload 或 Node 权限。Desktop 退出后客户端历史命令不可用，后台 Portal 的普通命令保持原行为。第三方可以实现 trait 并用 `ToolHost::with_client_handler` 注册自己的传输。

验证：`npm run typecheck`、相关 Vitest、`npm run test:chat-history`、`npm run test:client-context`、`cargo test -p heart-portal tools::`（在 heart-portal 内）。修改 Rust 后须 `npm run build:portal` 才会更新捆绑二进制。

### 多会话 UI

左侧浮动会话面板默认展开，支持「新建会话」、单击切换和重命名。切换或输入时保持展开，仅通过顶部会话按钮展开或收起；聊天区域为面板留出空间。同一个 Being 可以有多个独立 `scene_id`，会话目录及当前选择存储在 profile 的 `chat-sessions.json` 中，并按 Being endpoint 分组。原有 `chat-scene.json` 的 ID 作为初始桌面会话保留。

切换使用 iframe 消息桥，不重载聊天页、不取消正在接收的流；运行期间为每个场景保留草稿、附件、待发送队列和 Heart session ID。新建/切换后默认只显示该场景的历史；未标记历史仍可在「全部场景」查看。发送请求携带预期 scene ID，主进程在读取请求体前固定场景并验证，避免切换或重试竞态把消息发到另一会话。新建和重命名失败不会提交内存状态。

UI 验证：`npm run test:chat-sessions`（使用独立 Electron 测试 profile，不连接真实 Being）。

### SSE 场景隔离

`scene-runtime.js` 按 `scene_id` 持有独立的流处理器：文本缓冲、工具活动、writer epoch、AbortController、stream ID、恢复轮询和发送队列不再跨会话共用。UI 选择只切换展示和输入目标；共享 transcript、历史游标和 IDB 由统一历史处理器维护。

Live SSE 和 replay 都在内容/工具/错误处理前按事件的 `scene_id` 分发；缺失标签沿用所属流场景，显式 `null` 属于未标记场景。传输进度序号计入所有非 meta 事件及 `meta { continuation: true }`，仅排除初始 transport meta，保持服务端 replay cursor 语义。不同 scene 返回独立 `200 + SSE` 时互不接管；`202` 排队回复通过历史追赶，不受另一场景流是否活跃影响。停止选中会话只使用它自己的 stream ID 和读取控制器。

这保证客户端不会因另一会话发送而丢弃原流；Heart 是否同时执行多个呼吸、何时执行跨场景 splice，仍由服务端调度决定。验证覆盖独立并发 SSE、共享 SSE 的交错场景、工具和错误隔离、单场景停止、202 追赶及真实 Electron 双会话连续输出；不向真实 Being 发送测试消息。

会话列表支持右键重命名与删除。操作绑定右键点中的 scene，不需要先选中。删除须经第二次确认，仅移除本机目录项，历史仍可在「全部历史」中查看，不调用 Heart 历史删除。删除当前项选择相邻会话；删除最后一项生成新的空会话 ID，不复用被删除的 ID。目录变更仍在写盘成功后提交，失败时保留原状态。

实机三场景检查发现当前 Heart 会把多个场景的请求合并回复到最后场景，尚未通过隔离验收。客户端已修正空 `message_stop` 的等待状态与 continuation meta 游标；详见 `SCENE-SSE-REAL-TEST-2026-09-21.md`。
