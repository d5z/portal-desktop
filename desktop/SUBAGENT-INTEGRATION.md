# 2026-11-18 Review 修复与验证

当前产品契约：subagent 默认使用自部署 glm5.3flash，也可单独保存自定义配置。Being 主模型的选择、思考强度和密钥变更均不跟随到 subagent。启动时仅刷新默认自部署所需的连接身份与凭据。已删除 ChatProxy 中未接线的 Being→subagent 回调和密钥缓存；后面的“模型继承”段落是旧版本历史，不能作为当前行为说明。

本轮修复：
- 默认 Portal 配置统一为 desktop-portal.toml；显式 portalConfigPath 保留。安装、开关、公共读取、模型保存和 DSH 回退读取使用同一个默认文件。开关使用临时文件原子替换。
- TOML 消费字段在读取边界校验类型；非字符串密钥缓存条目不会作为模型凭据使用。
- 状态目录必须匹配私有配置中的 state_dir 或 Portal 按 Being 身份计算的默认目录，随后解析真实路径。支持配置文件明确指定的外部目录；状态文件不能自行指定别处。
- 排队审批取消立即结束该请求，后续审批仍等待正在展示的弹窗结束。
- Being 模型配置、目录、模型列表与密钥保存使用 fetch(beings://chat/api/llm/...)；真实鉴权留在主进程。保留原始状态、Content-Type 和正文，限定桌面壳/聊天页来源并处理预检。移除了对应业务 IPC。
- 首次切到自定义模型时初始化 provider/api；模型页两个面板保持挂载，切换不会丢失 Being 表单草稿。Being 配置提交不依赖 subagent 状态读取成功。

本机验证：
- 最终自动化：TypeScript 与 renderer 构建通过；Vitest 174 个文件、1489 通过、34 跳过；Rust 401 通过、4 忽略；git diff --check 通过。
- tests/being-model-network-electron.mjs：本机实际 Electron + 当前协议处理器、preload、React 模型页。检查真实 DevTools Network 的配置请求、默认/自定义生成路径、原始 429/401 正文，验证成功后保存、失败保持 TOML 不变，以及 Being 修改前后两种 subagent 配置逐字不变。上游响应使用隔离夹具，没有更改线上模型或使用真实凭据。
- tests/subagent-runtime-native.mjs：实际 Portal/Pi 和包内 Python/Node，连接本地模型服务；覆盖模型切换、自定义模型、文件读写、并发、401、预算、取消、超时、审批拒绝/允许。
- tests/model-catalog-ui.mjs 与 tests/subagent-inherited-model-ui.mjs：目录筛选、密钥、原始失败状态、回滚、慢响应、表单草稿、键盘操作和默认/自定义切换。
- 自动化证据：output/playwright/review-model-network.json、output/playwright/review-model-network.png；原生任务结果：test-results/subagent/native-results.json。
- 原有开发客户端的系统辅助功能读取两次超时；没有将该窗口或线上服务记为本轮实测通过。上述独立 Electron 和实际 Portal/Pi 测试已完成。

---

# subagent 默认代理接入与应用前验证

更新：2026-11-17。本节为当前实现；下方旧记录保留作历史对照。

启动默认行为补充：开发版及安装版均在启动 Portal 时初始化 subagent。未手动选择模型（包括旧配置只有关闭开关、没有模型）时加载自部署 `glm5.3flash`；已有自定义模型则保留并启用。默认模型此前验证失败而被停用时，下次启动重新验证，成功才重新启用，失败继续停用。未修改 Being 主模型。新增回归覆盖首次启动、失败后恢复、自定义保留及安装版已有运行时的启动分支。全量 Vitest 173 个文件 / 1480 项通过、34 项跳过；安装版启动专项 10 项通过，TypeScript 与 diff 检查通过。

最新 Network 路径和 Payload 修改已通过自动化回归。点击“验证并应用”时，renderer 通过 `fetch(beings://desktop/llm/weiguo_being/v1/chat/completions)` 发起模型协议请求；主进程只负责受信转接、鉴权和保存事务。DevTools 可看到该 beings 请求的实际状态和响应正文。探测请求加入 `tool_choice: "none"`，成功时返回完整 SSE、`finish_reason=stop` 与 `[DONE]`。

## 2026-11-17 真实自部署验收

- 修复后真实客户端连续完成四类任务：Python/Node 数据闭环 `sub_11f9a281-4a22-4e2f-8cde-c1978fd454d8`（done，3 轮，2 次工具）；纯文本 `sub_ebe432b3-5125-4ff4-b73c-430691acd421`（done，1 轮，无工具）；工具错误后恢复 `sub_bc6e3cc7-25a2-4707-959c-931b420ebdc2`（done，5 轮，4 次工具）；前台长任务取消 `sub_b54b1bd3-d585-4030-a19b-ac875efcd76c`（cancelled，未产生完成输出，后台进程已退出）。任务均由 `weiguo_being` 的真实 Portal 对话发起，未由主助手代做。
- 客户端重启后再次发起 `sub_7dd77b90-8362-4832-b224-787765181a09`，读取重启前生成的 JSON 并输出 `RESTART_RESUME_OK`（done，2 轮，1 次工具）；文件跨重启保留。该次回执明确 `resumed:false`、session 文件为空，因此验证的是配置可用与落盘产物保留，不是会话历史恢复。
- 配置失败保护也经 Computer Use 复核：输入带首尾空格的无效模型名后，上游返回 HTTP 401 及原始 `LOOM_AUTH_REQUIRED` JSON；界面显示“原 subagent 配置未更改”，私有 TOML SHA-256 保持不变。成功验证只在完整文本流结束后应用。
- 验证探测显式设置 `tool_choice: "none"`，避免自部署网关把探测请求误判为工具调用；真实工具能力由上述数据、错误恢复和取消任务分别覆盖。Being 主模型配置未由本次改动写入。

最新 Network 规范修正：沿用 Heart/Home 的 API 资源路径，默认请求为 `beings://desktop/llm/{being_id}/v1/chat/completions`，不再添加上游 IP 或 `api/subagent/proxy` 前缀。原先 Payload 中的 workspace、allowExec、portalBinary 等来自设置页展开的 `app.snapshot.settings`，只用于客户端保存事务，不是上游模型请求；此前将它们展示在模型接口名下的做法已修正。现在配置准备与保存结果经受信 IPC 在本地处理，Network 的 Payload 与实际发往模型的 JSON 完全一致（model/messages/tools/stream 等）；模型凭据由主进程附加。成功返回原始模型响应，HTTP 失败保留原始状态、类型与正文。保存事务仍验证完整生成后才应用，失败仍回滚。

规范已写入根目录 `AGENTS.md`。回归覆盖请求体逐字一致、客户端设置和凭据不出现在模型 Payload、不同协议的原始路径、成功 SSE、原始 401/429/500、断流拒绝应用和重复请求保护。下方带通用 `model` 路径、额外 proxy 前缀或 settings Payload 的记录均为历史状态。

- 仅修改 subagent 默认逻辑，Being 主模型的配置、界面和远端 API 保持原样。默认来源由“继承 Being”改为“自部署模型”，调用 `https://101.132.86.87/llm/{being_id}/v1/chat/completions`，模型路由 `glm5.3flash`，Bearer 使用当前 Being 的 Loom token。文档提示该路由的实测响应 model 是 DeepSeek 标识，不据路由名推断底层权重。
- 自定义服务商、模型、地址、协议、密钥、思考强度仍可单独设置；已有自定义配置不被默认同步覆盖。自定义凭据按 Being 与接口保留，Loom token 不进入自定义凭据缓存，也不返回 renderer。
- 默认模型随连接身份与 token 更新，在 Portal 启动前同步，不依赖 Being 主模型配置读取。相同且已验证的默认配置不反复发起探测；同步失败停用旧 subagent，避免使用旧 Being 身份，其他 Portal 工具仍可启动。启动时默认启用能力；已停用的默认模型重新验证成功后才启用，自定义模型保留原选择。
- 保存按钮为“验证并应用 subagent 配置”。在停止/接管旧 Portal 前，先请求候选模型，只有生成成功才写入私有 TOML 并重启。Chat Completions 探测只发送模型、短 user prompt、工具声明、`tool_choice: none`、`max_tokens: 64` 和流式参数，检查完整 SSE 文本、finish_reason=stop 和 `[DONE]`；其他协议保留各自的生成响应校验。验证不执行任何模型生成的工具调用，不自动重试。验证成功不代表之后的服务可用性或任意任务一定成功。
- HTTP 错误、流中错误、断流、空结果、连接超时均阻止应用。提示给出安全的 HTTP 状态或失败阶段，不展示服务端原始正文或密钥。新配置的验证时间用于隔离旧配置任务的失败提示；新失败仍会展示。
- Review 修复：候选验证成功但接管/重启失败时回滚整个私有模型文件；原文件不存在则删除新建文件。Anthropic、Gemini、Responses 分别要求 `end_turn`、`STOP`、`completed`，拒绝有部分文本但被截断的响应。

## 历史复测记录（2026-11-17，Asia/Singapore）

- 18:27 按追加要求保留原始接口名与上游错误：配置请求路径更新为 `beings://desktop/api/subagent/proxy/{upstream_host}{upstream_path}`，默认完整路径可见 `/101.132.86.87/llm/weiguo_being/v1/chat/completions`。探测与显示路径复用同一协议地址映射。HTTP 错误保留原状态码、statusText、Content-Type 与正文原始字节；`X-Upstream-URL` 标明实际接口，设置页通过单独响应头显示简短提示。Computer Use 在 Network 实际确认 `completions` / HTTP 500 / `text/html`，Response 为完整 OpenResty HTML（含原始 padding 注释）。相关 58 项回归、TypeScript 与 diff 检查通过，客户端已重建启动。下方 18:20 的通用 model 路径与包装 JSON 记录为改动前结果。
- 独立 subagent review 找到并修复三项：默认同步失败沿用旧身份、重启失败遗漏模型文件回滚、非 Chat Completions 协议误接受不完整生成。新增回归包含首次配置、旧文件精确恢复、接管被拒、Being 身份切换、原运行时保持以及禁用状态保持。
- 全量 Vitest：171 个文件通过、11 个跳过；1459 项通过、34 项跳过。TypeScript 和 `git diff --check` 通过。真实 Portal/Pi + 本地模型服务的 12 组运行时场景全部通过。
- Computer Use 重新点击默认来源的“验证并应用”仍显示 HTTP 500，未应用候选；保留原自定义配置，Being 主模型未变。修复后的客户端已重建并启动。此前成功的自定义模型真实对话不算自部署验收成功。
- 新增严格请求体对照：同一 JSON，仅追加合法尾部空格，不改变提示词、模型或参数。118 B、4096 B、8192 B、8193 B 均 HTTP 200；16384 B 返回 OpenResty HTML HTTP 500，仅 23 ms。时间 `2026-11-17T10:13:47.784Z`。证据：`test-results/subagent/gateway-size-review.json`（不含凭据）。此证据支持请求体处理问题，但尚无服务端 error log，不能断言具体故障点。
- 鉴权对照（18:21）：不带 Authorization 的 118 B / 16384 B 请求均返回 JSON 401；带错误 Bearer 的 118 B 请求返回 JSON 401，16384 B 请求却在 22 ms 返回 OpenResty HTML 500。这说明授权头缺失检查可正常拒绝，而携带授权头的大请求进入异常处理分支，连错误 token 都无法正常返回 401。不能据 500 声称 token 已验证通过；服务端鉴权/请求体读取链路需要检查。证据：`test-results/subagent/gateway-auth-review.json`。
- 按追加要求，手动 subagent 模型配置改走 `POST beings://desktop/api/subagent/model`。preload 通过受信 IPC 获取本次客户端会话的本地访问 key，再用页面 fetch 调用此入口；网络入口复用原保存事务与队列，Loom token 仍只在主进程。上游验证状态码原样映射到配置响应，错误正文使用安全提示；默认与自定义来源均支持。Being 主模型与普通设置仍使用原通道；Pi/Node 实际任务推理不受此配置入口改动影响。
- Network 转接后的 Computer Use：实际点击自部署“验证并应用”，DevTools 显示 `beings://desktop/api/subagent/model` / fetch / HTTP 500 / 323 ms；Payload 可见 `subagentInherit:true`，不含 Loom token；Response 可见“模型验证失败（HTTP 500）…原 subagent 配置未更改”。私有 TOML SHA-256 前后一致，仍保留自定义模型。网络入口、preload→保存事务与相关回归共 56 项通过，独立 review 通过。

## 历史代理阻塞项

依据 [飞书接口文档](https://d5.feishu.cn/wiki/BLtBwNSPKiJfLrkEAGDc7bWinuf) 与在线 `/llm/openapi.json`（1.0.0）接入。正常校验 HTTPS 证书。

同一 Being 身份、相同路由的实际结果：

| 场景 | 结果 |
| --- | --- |
| 简短普通生成 | HTTP 200，正文 OK |
| 简短 SSE + usage | HTTP 200，完整 `[DONE]` |
| 简短 SSE + 工具定义 | HTTP 200，完整 `[DONE]` |
| 4,260 字节请求 | HTTP 200 |
| 16,548 字节请求 | OpenResty HTTP 500 |
| 32,932 字节请求 | OpenResty HTTP 500 |
| 客户端真实子任务（含工具定义与上下文） | HTTP 500，无工具执行、无 token；两次真实任务均失败 |

失败任务：`sub_3655ee05-4416-44ae-9a54-8cff61960c63`、`sub_1997b227-ecd5-438a-94cf-1d7f26ce1faf`。现有 Pi 自动重试使每项记录 4 轮，不能把这些空轮次当作实际工具执行。

现象与文档允许 2 MiB 的合同不一致；怀疑网关请求体从内存转临时文件时的处理，但未访问服务端，不能确认根因。已请求维护者修复。不能将短句探测通过视作默认模型业务验收通过。

## 历史验证记录

- 全量 Vitest：1445 通过、34 跳过；TypeScript 检查通过。
- 真实 Portal/Pi + 本地模型服务：Python/Node、文件读写与修改、模型切换、自定义配置、并发、401、预算耗尽、取消、超时、权限拒绝与允许全部通过。此测试不冒充真实自部署推理成功。
- Computer Use：默认配置验证明确显示 HTTP 500，阻止应用；恢复原自定义 OpenRouter 配置后真实验证成功、自动重启、旧错误消失；再尝试切到默认代理失败后，整个私有配置文件 SHA-256 与切换前一致。
- Computer Use 真实对话（保留的自定义模型）：并行数据闭环 `sub_f3f7f2b0-9cc8-43b2-857a-1c8b2307262e`，done / 5 轮 / 10 秒；纯文本 `sub_3a9cc221-5325-4144-ad22-59256e4c5ea1`，done / 1 轮 / 1 秒。独立读取产物验证苹果=10、梨=5、total=15、中文和内置 Python/Node 路径；侧栏核验两个任务独立完成及结果。
- Computer Use 工具错误恢复：`sub_a1d8750b-8514-41b8-a756-693d7db70d21`，done / 5 轮。先收到 `portal_file_read` 的文件不存在错误，再计算 7+5 并写入/读回恢复 JSON；独立确认缺失文件未被创建。
- Computer Use 取消：`sub_40c457af-2f9d-4e0c-ab53-d3b97f486830`，cancelled。正在等待的后台 Python 子进程已退出，输出没有完成标记。现有统计缺陷：取消后的 `turns=0`，但事件记录包含一次完成的工具调用及 turn-end；不能用该字段判断取消前是否执行过操作。本次未改动此运行时统计。
- 最新修改后相关回归 72 项通过、TypeScript 检查通过。
- 本地证据：`test-results/subagent/native-results.json`、`test-results/subagent/cua-failed-save.json`、`test-results/subagent/cua-live-results.json`。

---

# 客户端 subagent 模型继承与接口验收

更新：2026-11-17。范围：Town 客户端和配套 Portal，不涉及 DSH。

## 当前实现

- 配置入口为客户端“模型”。subagent 默认启用，没有启用开关。默认使用当前 Being 对应的自部署 `glm5.3flash`；也可在 subagent 页选择自定义服务商、模型、地址、协议、密钥与思考强度。
- 客户端通过 Being 的 `GET /api/llm/config` / `PATCH /api/llm/config` 获取确认后的配置，写入本机 Portal 私有配置。回滚响应以服务端最终配置为准，不保存被拒绝的密钥。
- 模型页直接提交的 `api_key`，以及现有 `POST /api/llm/keys` 成功保存的当前线路密钥，均可用于本机继承。密钥不返回给对话流。不同 Being 或端点不会复用旧密钥。
- Portal 在新任务开始前读取继承配置，模型和思考强度以该配置为准，忽略任务级覆盖。端点/凭据改变且旧任务仍运行时，明确要求等待旧任务结束，再启动新任务，避免中断旧任务。
- 继承模式下，Pi 使用包内 Node，通过 Portal 工具桥执行任务；Python/Node、文件访问和审批策略与主代理相同，完全访问模式也不会误用系统解释器。
- 对话流显示任务摘要、状态和执行轮数。任务是否完成与 Being 最终回复是否抵达分别处理。
- 设置页异常提示简化为“subagent 配置出错”，点击“重新配置”进入 subagent 表单；正常时不显示状态提示。详细状态仍用于内部判断，不在提示中展开。
- 本机凭据按 Being + 模型接口保存在私有 TOML 中；切换接口会保留原凭据，切回来可恢复。自定义模式不会被 Being 模型刷新覆盖。两种模式都使用 Portal 工具桥和包内运行时。

## 切换到 OpenRouter 后的实际故障

2026-11-17 复查发现，本机配置已同步为 `https://openrouter.ai/api/v1` 和 `deepseek/deepseek-v4.1-flash-1017`，不再使用自部署地址。15:23 的真实子任务返回 `401 Missing Authentication header`，排查时 TOML 中没有 API Key。

旧继承实现切换接口时直接替换 `[subagent.model]`，没有保存旧接口凭据；当 Being 的 GET 配置只返回密钥提示时，切回原接口无法恢复密钥。本次已修复为按接口保留与恢复。现存的本机 Portal 配置中没有找到可恢复的 OpenRouter 密钥；已有丢失的密钥不能由提示字符串重建，需要在模型设置或自定义 subagent 中重新输入，或由服务端提供代理。

`model_source = "being" | "custom"` 表示客户端模型来源。两种模式的 `inherit_model = true` 均保留，表示执行引擎使用客户端选定的配置、每次任务前加载，且强制走内置工具桥；它不再单独表示界面里的 Being 继承选项。

### 当前客户端真实复测（15:58，Asia/Singapore）

用户在自定义 subagent 表单保存 OpenRouter 凭据后，用 Computer Use 在同一运行中的客户端发送任务。`sub_dd1f7515-4588-4664-8f8b-7cf6cf54fb82` 返回 `done`、4 轮、约 7 秒。子代理使用 `resources/portal-runtime/python/bin/python3` 写入 `outputs/cua-custom-subagent-final.json`，使用 `resources/portal-runtime/node/bin/node` 读取、验证中文并追加解释器路径；主助手只读复核，另已从本机文件独立校验内容。设置页随新任务恢复为“执行环境就绪 / 密钥已保存 / 最近任务 done · 4 轮”。

该次 Being 提交预算时第一次把对象传成了错误类型，第二次使用点号参数而未生效，任务实际使用默认预算。实际耗时、轮数没有超过请求上限，但不能将该次试验记作预算参数验收通过；原生协议回归中正确的 budget 对象、取消、超时和预算耗尽测试通过。

新增配置与状态回归后：TypeScript 检查通过；全量 Vitest 1424 通过、34 跳过；真实 Portal/Pi 的本地协议服务测试覆盖自定义保存、禁止主模型覆盖、切回继承、Python/Node、文件读写及任务生命周期并全部通过。新设置表单的保存/切回继承通过 Computer Use 测试夹具验证；当前真实客户端另验证了用户保存后的真实模型执行成功及异常状态消除。

### 历史直接调用诊断

实测当前 Being 模型为 `glm5.3flash`，provider 为 `self-hosted`，接口为 `http://115.190.110.33:7860/v1`。

1. Being 的配置读取返回模型、base_url、thinking、`has_api_key` 和 `api_key_hint`，但没有可供本机请求使用的凭据，也没有明确的 `api` 协议字段。
2. 从本机访问该端点的 `GET /models` 和 `POST /chat/completions` 返回 HTTP 401，响应为 nginx HTML。无认证请求和无真实凭据的 Bearer 请求都未通过。响应没有 `WWW-Authenticate`，因此不能仅据此断定具体需要 Bearer、Basic 或网关专用认证。
3. `has_api_key=true` 只说明 Being 服务端持有凭据；提示字符串不是可用密钥。Being 的连接 token 也不能当作模型供应商密钥发送给这个地址。
4. 因请求止于认证层，尚未验证该真实服务的工具调用、流式响应、思考参数兼容性。不能把 401 解读为模型本身不支持 subagent。

按用户要求保留原来的自部署设置，不更换主模型，不尝试绕过认证。本机完整链路通过下述本地模型服务测试；真实自部署推理仍未通过。

## 服务端需要补齐的配置契约

建议在受鉴权保护的客户端接口提供如下信息。下列是建议契约，不代表现在已存在：

```json
{
  "model": "glm5.3flash",
  "provider": "self-hosted",
  "base_url": "https://model-gateway.example/v1",
  "api": "openai-completions",
  "thinking": "medium"
}
```

| 字段/能力 | 要求 |
| --- | --- |
| model | 端点接受的完整模型 ID，与 Being 使用的模型一致 |
| base_url | 本机可达的推理地址，含准确版本前缀 |
| api | 明确协议：openai-completions / openai-responses / anthropic-messages / google-generative-ai |
| 认证 | 无认证明确声明；否则提供本机可用凭据，或提供使用 Being 现有认证的推理代理 |
| 思考强度 | 说明支持的值及对应协议参数；不能简单把所有厂商的 thinking 当成同一个原始请求字段 |
| 配置结果 | PATCH 返回最终生效配置、成功/失败、是否回滚；不能仅回显输入 |
| 目录能力（可选） | 模型列表、工具调用支持、上下文长度、最大输出长度 |

认证方案优先选择 **服务端推理代理**：客户端使用现有 Being 身份访问代理，服务端保管供应商密钥。代理必须支持独立多轮推理和工具调用，不能复用聊天接口把请求写入 Being 的正常对话历史。建议提供受限、可撤销的客户端凭据，且不在普通配置 GET 中返回长期供应商密钥。

若采用直接调用方案，客户端现有模型设置可输入密钥并供 subagent 继承。当前 Portal 自定义适配使用 Bearer API Key；Basic、自定义认证头、Cookie、签名鉴权和 mTLS 不能仅靠 api_key 字段完成，需要服务端转换或明确增加对应适配。

## subagent 所需的推理接口（以 OpenAI Chat Completions 为例）

必须支持 `POST {base_url}/chat/completions`：

- 输入：model、messages、stream=true、tools（function + JSON Schema）。messages 需支持 system/user/assistant/tool，以及 assistant.tool_calls、tool_call_id。
- 输出：SSE `data:` JSON 分块、choices[].delta.content 或 delta.tool_calls（index、id、function.name、分块 arguments）、finish_reason；结束标记 `[DONE]`。
- 工具闭环：能返回结构化 tool_calls；客户端执行后把 tool 消息继续提交，模型应读取结果并继续工作/结束。仅返回“我已执行”的文字不满足要求。
- 同一轮多个工具调用、连续多轮、多个并发任务应可独立处理。
- 错误：401/403、429、5xx 应保留正确 HTTP 状态并返回可识别 JSON 错误；不要将失败包装成 200 正常文本。
- 取消：客户端断开请求后应停止生成；有明确的上下文和输出 token 限额。usage 信息建议返回，便于预算统计。
- `GET /models` 用于目录/探测，已知模型 ID 时不是运行任务的硬性条件。

其他三种协议需遵循各自原生的流式事件和工具调用结构；不能只改 URL 就宣称兼容。

## 验收方式与边界

`node tests/subagent-runtime-native.mjs` 使用真实 Portal、真实固定版本 Pi（0.65.2）和发布包内 Python/Node。模型响应由本地 HTTP 服务按场景确定返回；它验证工具链、协议处理、生命周期和权限，不证明真实模型的规划能力或真实自部署服务可用性。

覆盖：Python CSV/SQLite/ZIP/UTF-8、Node 读取及修改结果、文件创建/编辑/读取、同进程模型切换、并行任务、401、预算耗尽、取消、超时、审批拒绝/允许、场景归属和日志。拒绝场景中的 subagent 任务可正常结束，但拒绝的文件必须不存在；任务结束不等于被拒绝操作成功。

`node tests/portal-permissions-native.mjs` 另覆盖 venv、pip 本地 wheel、npm/npx 本地依赖、后台进程、stdin、非零退出、UTF-8 截断、超时清理、并发 Node→Python、重启持久化和运行时损坏提示。

subagent 启动的 pi daemon 与 stdio 子进程现在也复用客户端用户目录中的共享 `portal-runtimes/<runtime-id>`：Python、Node 的 bin 目录会置于子进程 PATH 首位；managed 安装缺少或损坏共享 runtime 时直接报告运行时错误，不回退宿主解释器。通过 Portal 工具桥执行的命令与 subagent 自身命令因此使用同一套解释器来源。

Computer Use：检查了已安装客户端真实连接和模型；用生产组件及真实测试 ledger 验证新 UI 的唯一模型入口、思考强度修改、任务状态与轮数。新 UI 预览中的模型服务是测试夹具。

运行结果保存在 `test-results/subagent/native-results.json`。测试产物属于本机验收记录，不进入版本控制。

本次验证结果：TypeScript 检查通过；相关 Vitest 测试通过；当前 `cargo test -p heart-portal subagent:: -- --test-threads=1` 为 129 项通过。完整运行时用例可通过 `npm run test:subagent-runtime` 重跑；本机需要已安装固定版本 Pi。

本地测试包位于 `out/Portal Desktop-darwin-arm64/Portal Desktop.app`，资源校验通过（当前打包结果为 5976 个文件、70 个本地资源链接）。正式签名打包因苹果签名时间戳错误失败，本地测试签名打包成功；未替换 `/Applications` 中的客户端。

已使用该测试包内的 `heart-portal` 再次执行完整 subagent 运行时用例，全部通过；记录为 `test-results/subagent/packaged-results.json`。Computer Use 截图为 `test-results/subagent/tasks-ui.png`。

## 对话流与右侧子智能体执行详情（2026-11-17）

- 对话流的本轮思考状态保留 subagent 数量入口，并在下方显示每个子智能体的名称与独立状态。点击名称直接打开对应任务详情；点击数量打开本轮列表。
- 列表与聊天并排放在真正的右侧栏，可调整宽度；详情有返回列表按钮。任务说明、按时间排列的思考状态/工具参数/工具输出/回复、最终结果直接展开。回复与结果按 Markdown 排版。
- Portal 将每个任务的公开执行事件写入任务专属日志，覆盖 daemon 与 stdio。主进程校验当前运行实例与任务归属后读取日志，遮蔽凭据；文件变更驱动状态刷新。多个工具并行时，仍未返回的工具继续显示执行中。
- 执行记录不再按 16,000 字符、最近 200 条或 256 KiB 截断。日志中的完整文本可回看；只记录思考阶段状态，不采集模型隐藏推理。旧任务未保存的执行步骤不能补回。

本轮 Computer Use 在运行中的客户端验证：

1. 两个不同 session 的真实任务并行使用内置 Python、Node 写入 JSON 并读回断言，分别返回 `SIDEBAR_PY_OK`、`SIDEBAR_NODE_OK`。通过对话流点击各任务，确认右侧的任务说明、执行步骤和结果对应正确。
2. 第三个任务使用 Python 等待 45 秒并修改已有 JSON，Node 再次读回断言 `verified_by_subagent === true`，返回 `SIDEBAR_LIVE_OK`。实际观察到侧栏“正在运行 portal_exec”与工具“正在执行”，之后自动更新“已完成”；返回列表可看到独立耗时 51 秒。
3. 已覆盖列表进入详情、从对话流切换另一任务、详情返回列表、真实文件创建/修改/读回、中文内容、历史记录缺失提示。失败工具与并行工具状态有组件回归测试。

截图：`test-results/subagent/inline-subagent-details.png`、`test-results/subagent/sidebar-execution-result.png`。本轮全量 Vitest 1430 项通过、34 项跳过；后续界面与完整记录相关回归 15 项通过。TypeScript 检查通过；Rust subagent 测试此前 126 项通过，完整长文本记录追加 Rust 回归 1 项通过。


### 布局精简（后续调整）

对话流移除了思考标题中的 subagent 数量徽标和展开后的重复调度列表，仅保留一组子任务名称与状态，点击直达右侧详情。详情的任务说明与思考过程默认收起，当前状态、耗时、最终结果直接可见；展开思考后，同一工具调用的参数与返回输出合并显示。切换任务重置展开状态与滚动容器。Computer Use 已确认 Python/Node 历史任务的默认收起、直接查看结果及展开完整工具记录；相关组件回归 13 项与类型检查通过。

### 协作入口归入思考过程（最新交互）

子任务不再作为思考区域外的独立列表。收起时，思考标题显示“子智能体协作”；展开后，在思考过程内部以一条协作动态展示任务名称与运行/完成/异常状态，点击打开右侧本轮任务列表。关闭详细思考显示时，仍保留默认收起的协作入口，不挂载主任务诊断内容。Computer Use 已验证收起时隐藏入口内容、展开后仅一条协作动态，以及点击打开两项真实任务列表；13 项相关回归与类型检查通过。
