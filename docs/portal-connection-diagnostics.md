# Portal 持续重连排查

## 2026-11-18 日志 review

用户环境：Portal Desktop 0.1.15，Windows x64，Portal 引擎 0.9.2。
日志中的时间为 UTC。06:24:59 至 10:37:39 共 508 次
`relay rejected handshake`，期间重启及切换前后台运行仍未恢复。

该错误出现在 TCP、TLS、WebSocket 已建立，Relay 返回业务握手 `ok: false`
之后。它能证明 Relay 拒绝接纳 Portal，不能证明 token 过期。旧日志丢弃了
拒绝原因，无法区分凭据错误、Being 身份不匹配或服务端其他拒绝条件。
同时段聊天请求成功也不能代替 Relay 握手结果。

Review 发现并修正的可观测性问题：

1. 握手拒绝被统一映射成普通断线重连。新增 `handshake_rejected` 状态，
   明确显示拒绝，仍按原退避策略重试，允许服务端恢复后自动连接。
2. 拒绝详情被整体丢弃。只提取 `code`、`message`、`error` 的文本及
   `error.code` / `error.message`，移除当前凭据、凭据赋值和 URL，再限制到
   512 字符。缺失详情记为 `reason_not_provided`。不输出原始握手或响应。
3. 客户端缺少 HTTP 验证、配置变更、进程身份和状态变化时间线。
   新增下述事件。正常轮询和单纯日志刷新不重复输出状态事件；错误态的
   最近运行日志摘要也只在状态或进程身份变化时记录，避免重复复制 60 行。
4. 已连接后的 WebSocket/MCP 桥接读写错误被忽略，最终只剩通用 bridge closed。
   现在保留失败环节及底层错误；服务端 Close 帧只保留协议关闭码。

已核查的配置链路：保存设置会重启前台 Portal；后台指纹包含连接链接，
凭据变化会重新配置后台运行。引擎启动环境中的连接链接优先于 TOML。
本次未发现足以解释该用户故障的“新凭据保存后仍沿用旧凭据”证据。

## 新日志怎么读

导出日志 ZIP 后，按时间和 PID 对照 `client/client-runtime.log` 与
`portal/runtime-*/portal.log`（含 `.previous`）。前台引擎输出也会出现在
客户端日志中，同一行可能有多个副本，统计失败次数时需要去重。

| 事件 | 用于判断 |
| --- | --- |
| `portal-settings` | staged/applied/rollback，端点及凭据是否改变；只记录变化布尔值 |
| `portal-being-check` | `/api/status` 的 HTTP 状态码、失败阶段、耗时和结果 |
| `portal-start` | 请求启动的端点、名称、前后台模式、重启意图、二进制及指定配置路径 |
| `portal-local-ready` | 本地启动检查完成时的 PID、状态，以及当时是否观察到 Relay 已连接 |
| `portal-state-change` | 状态、PID、运行目录和所属 Being 的实际变化 |
| 引擎 `relay_session` | PID 和 attempt，TCP/WebSocket 建立阶段 |
| `relay rejected handshake` | 脱敏拒绝详情；与 transport 错误区分 |
| `relay retry scheduled` | 含抖动的实际 retry_ms，是否因业务握手拒绝而重试 |

`portal-status.json` 另含配置侧端点、Portal 名称、二进制路径、配置路径及
后台开关，可与观测到的运行状态比较。HTTP 状态接口通过、本地进程就绪、
Relay 握手成功是三个独立结果；前两个成功不能用来宣称 Portal 已连接。

若仍得到 `reason_not_provided`，需用 UTC 时间、端点、Being ID、Portal 名称
查询 Relay 服务端日志。不要要求用户发送连接 token 或完整连接链接。

引擎改动位于 `heart-portal` 子模块，发布时必须同时包含对应子模块修改并
重建配套引擎；只更新客户端不能补回旧引擎已丢弃的拒绝详情。
