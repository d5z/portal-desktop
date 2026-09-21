# Heart 三场景回复归属异常报告（2026-09-21）

## 结论

真实 Desktop UI → 当前部署的 Heart，三场景测试 **未通过场景隔离验收**。

三条请求的 scene_id 正确落盘，但第二轮自然完成后，Heart 将三个场景的测试标记合并到一条 assistant 消息，整条标记为最后的 C 场景。不是仅由 Desktop 渲染串场：直接 GET `/api/history` 得到同样的记录。

## 环境及方法

- 时间：北京时间 2026-09-21 15:49–16:00 左右。
- 使用正在运行的 Portal Desktop，真实 Being：`weiguo_being`。
- 通过原生 UI 切换三个已有场景并发送消息；没有用 mock Heart 替代。
- 测试时客户端显示 SBS 自主醒来为关闭，未改变此设置；需 Heart 确认这是否影响跨场景排队请求的后续调度。
- 用只读 API 查询历史和活动流交叉核对。凭据仅在进程内读取使用，不写入报告或日志。
- 不让 Being 调用工具、修改文件、向 Town 或第三方发送消息。
- 第一轮 A 输入的中文被自动化输入丢失，因此以第二轮英文短请求及服务端结果作为主要证据。

| 标记 | UI 会话 | scene_id |
| --- | --- | --- |
| A | 测试A | desktop-b306093e-297a-4dd1-b26e-351174e6c758 |
| B | 测试B | desktop-9a5be974-0667-4220-86d1-732f97dfe739 |
| C | 桌面·D5-NJ-LT-0321deMacBook-Air.local | desktop-ab7ce9b8-0aac-4980-be1b-fd722e20b040 |

## 第二轮：自然结束，未调用 stop

各请求要求只返回自己的 `MS3-R2-X-END` 与当前场景名，不调用工具。A 的自动化填入出现同义短句重复，但它仍是单条请求，只要求 A 标记。

| 本地时间 | history seq | 请求 | 服务端记录的场景 |
| --- | --- | --- | --- |
| 15:55:29.833 | 11622 | MS3-R2-A | A |
| 15:55:39.138 | 11623 | MS3-R2-B | B |
| 15:55:48.578 | 11624 | MS3-R2-C | C |
| 15:56:18.550 | 11625 | assistant 回复 | **C** |

同一个活动 stream：`7ee1e03c-791c-46a6-9408-05041fca3648`。

服务端 replay 中的边界：

```text
seq 535 message_stop  scene=A    （此前 A 只有 usage / reasoning，无 content_block_delta）
seq 536 meta          scene=B    continuation=true
seq 634 message_stop  scene=B    （B 也只有 usage / reasoning，无 content_block_delta）
seq 635 meta          scene=C    continuation=true
```

历史 seq 11625 的 role 为 assistant，scene_id 为 C，原文：

```text
MS3-R2-A-END 桌面·D5-NJ-LT-0321deMacBook-Air.local
MS3-R2-B-END 桌面·D5-NJ-LT-0321deMacBook-Air.local
MS3-R2-C-END 桌面·D5-NJ-LT-0321deMacBook-Air.local
```

随后 `/api/stream/active` 返回 204。检查时 A、B 没有对应的 assistant 正文记录。

## 第一轮补充

- 请求 history seq 11618 / 11619 / 11620 分别正确归属 A / B / C。
- stream `1a4659cd-0740-4306-af51-7a2af80aef93` 中 A、B 未输出正文便收到 message_stop，后续只有 C 产生 reasoning。
- 15:53:15 主动停止这条测试流，`POST /api/stop` 返回 200；对应 history seq 11621 `[breath interrupted by human]`。因此不能使用第一轮主动停止后的缺少回复来证明服务端最终丢消息。

## 给 Heart 侧的最小复现步骤

1. 同一个 Being 建立 A、B、C 三个不同 scene_id；本次环境 SBS 关闭。
2. A 发送 `Reply only MS3-R2-A-END and your current scene name. No tools.`。
3. A 尚未返回正文时，约 9 秒后在 B 发同结构的 B 标记请求，再约 9 秒后在 C 发 C 标记请求。
4. 不调用 stop，观察活动流的带 scene_id 事件及最终 `/api/history`。
5. 核对各请求的用户 moment 和 assistant moment 归属，不以模型自报的场景名称作为唯一判断依据。

### 期望行为

允许 Heart 串行排队，不要求三个呼吸物理并行；但 A、B、C 的输入与回复必须保持各自归属。若某场景被中断或排队，应能识别它的状态，不能把其未处理输入作为 C 的同一轮消息合并回答。

### 已确认与未确认

- **已确认**：三条用户 moment 归属正确；A、B 空 message_stop；continuation 切换至 C；三个标记在一条 C assistant moment 中共同出现；流自然结束后查询 active 为 204。
- **已确认**：该合并结果直接来自 Heart history，不是 Desktop 按文字拼接或标错显示标签。
- **未确认**：Heart 内部究竟在哪一步合并输入，是否与 SBS 关闭、splice 队列 drain、yield 或场景上下文切换有关。客户端仓库和外部接口观察不足以定位具体 Heart 代码行。
- **不应误判**：当前证据不是 SSE 网络丢包，也不证明所有场景相关推送都错误。能确认的是服务端本次处理与落盘不满足场景隔离预期。

### 验收建议

- 同样三场景顺序，在 SBS 开启和关闭时分别验证，且不依赖客户端一直停留在某一会话。
- A、B、C 的回复各自带正确 scene_id 并落盘；其他场景的输入不进入该场景上下文。
- message_stop 表示呼吸边界还是请求完成必须可区分，空 stop 不应导致请求被标记已回答。
- 在切换场景后断线重连，验证服务端 replay 的 scene_id、事件顺序与历史落盘归属一致。

## Heart 侧需要排查

以下是依据实测提出的排查方向，不是已验证的内部代码根因：

1. 跨 scene 的输入是否被加入同一个 sensory splice 批次，是否在 drain 时合并为最后一个 scene 的输入。
2. `message_stop → continuation meta` 切换场景时，旧场景尚未回复的请求是否保留并会重新调度。
3. 新场景呼吸构建上下文时，是否混入其他场景尚未处理的原始用户输入。
4. 队列项是否保留 scene_id、scene_meta 和请求身份，回复 moment 是否使用队列项的身份而非最后可变的 active scene。
5. `/api/stream/active` 返回 204 时，是否仍有其他场景的未回复请求；需核对队列状态，明确无活动流与所有请求处理完成的区别。

正式回复必须由 Heart 带正确的 scene_id 输出并落盘。

## 原始观测证据

- `test-results/ms3-r1-observation.jsonl`
- `test-results/ms3-r1-final.jsonl`
- `test-results/ms3-r2-observation.jsonl`
- `test-results/ms3-r2-followup.jsonl`
- `test-results/ms3-final-observation.jsonl`

## 补充实测：16:34–16:40，顺序与交叠请求对照

### R3：Desktop UI 顺序发送

通过实际客户端向 A、B、C 发送只要求返回各自 `MS3-R3-X-END` 的短消息。同时轮询 Heart 活动流的 SSE replay 缓冲和 history；这一轮监听方式是服务端事件回放观测，不是直接拦截 Desktop 网络请求。

| 场景 | user seq | assistant seq | 结果 |
| --- | --- | --- | --- |
| A | 11659 | 11660 | MS3-R3-A-END，归属 A |
| B | 11661 | 11662 | MS3-R3-B-END，归属 B |
| C | 11663 | 11664 | MS3-R3-C-END，归属 C |

三条请求分别自然完成，约 5 秒返回，没有形成交叠。A、B 的自动化输入各重复了一遍相同短句，但每个场景仅提交了一条请求。三个流中的正文和结束事件均归属各自场景。这说明普通顺序请求没有复现此次问题，不能据此认定交叠处理通过。

### R4：直接调用真实 Heart，完整读取原始 SSE

为消除 UI 自动化速度和客户端分流的影响，用同一 Being 凭据和上述三个真实 scene_id 直接 POST `/api/chat/stream`，请求启动间隔 1 秒。未传 session_id，未调用 stop，SBS 保持关闭。所有 200 响应持续读取到 EOF；202 响应正常消费。

流 ID：`a49f6c91-3404-4955-83d2-fa21628693e4`。

| 北京时间 | 原始接口行为 |
| --- | --- |
| 16:38:25.571 | 发 A，返回 200，初始 meta.scene_id=A |
| 16:38:26.574 | 发 B，返回 202 |
| 16:38:27.101 | A 的 message_stop，无任何 A 正文 |
| 16:38:27.102 | continuation meta.scene_id=B |
| 16:38:27.576 | 发 C，返回 202 |
| 16:38:27.754 | B 的 message_stop，无任何 B 正文；continuation meta.scene_id=C |
| 16:38:34.738 | C 的 message_stop，原始 SSE 到 EOF |
| 16:38:45.124 | active 返回 204；history 仍只有 C 的回答 |

原始 SSE 中有 C 的 46 个 reasoning 事件、1 个正文事件，正文为 `MS3-R4-C-END`。A、B 没有正文事件。所有这些场景事件都有 scene_id；问题不是缺少场景标签。

历史结果：

- user seq 11665 → A，输入只要求 A 标记。
- user seq 11666 → B，输入只要求 B 标记。
- user seq 11667 → C，输入只要求 C 标记。
- assistant seq 11668 → C，正文 `MS3-R4-C-END`。
- 本轮结束及随后复查时，没有观察到 A、B 的对应回答。

**此轮新证据的含义**：绕过 Desktop 的 SSE 解析与分流后，Heart 原始接口仍出现“先来的 A、B 被空 stop 结束，仅最后的 C 得到回复”。因此这次未回复现象发生在服务端处理链路，客户端切换选择不能解释该结果。R4 没有复现 R2 的“三个答案合并为 C”，而是仅回答 C；不能把两轮现象写成完全相同。

仍需 Heart 确认：跨场景输入是否触发了与同场景打断相同的逻辑；被结束场景的请求是否保留队列项、是否有后续恢复调度。观察窗口内未回复不等同于证明请求永久丢失。

证据：

- `test-results/ms3-r3-watch.jsonl`：R3 活动流 replay / history 观测，也覆盖了 R4 事件。
- `test-results/ms3-r4-live-sse.jsonl`：R4 直接读取的原始 SSE 事件类型、scene_id、流 ID、正文与请求时间；未保存 reasoning 正文或凭据。
- `test-results/ms3-r4-final.jsonl`：结束后的 history / active 复查。
