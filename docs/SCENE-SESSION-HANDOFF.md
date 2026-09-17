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
