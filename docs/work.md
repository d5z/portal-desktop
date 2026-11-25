# Work 与 subagent

Work 在 Town 中管理长期目标、本机项目、任务和执行会话。内置任务由 Portal subagent 执行，Codex 和 DeepSeek 任务由各自的原生执行器处理。

Work 默认打开「全部任务」看板。顶栏显示当前位置，左侧按钮开合工作侧栏。侧栏按收件箱、视图和项目组织，宽窗口可拖动调整宽度，窄窗口覆盖展开，可按 Escape 关闭。卡片可打开任务或拖到其他状态列。从任务返回会回到打开它的列表，包括工作结果。

## 长期目标

- 在 Work 的「目标」视图创建目标，填写预期结果和验收条件，再添加项目目录或关联已有项目。一个目标可包含多个项目，每个项目可关联一个所属目标。
- 在目标详情可以查看项目和任务进度，并在对应项目下新建执行会话。派发与续聊自动带入项目当前的目标和验收条件，交付记录保留当轮采用的目标版本。
- 也可以直接添加项目目录，再从项目看板新建执行会话。以后需要纳入长期目标时，可以在目标详情关联已有项目，已有执行记录保留原先的版本信息。

## 项目目录

- 点击「项目」旁的 **＋**，用本机文件夹选择器添加项目目录。默认使用文件夹名称，重复添加同一目录会打开已有项目。项目按 Being 保存于客户端数据目录的 `work-projects/`，重启后恢复。
- 项目名打开对应看板，项目左侧箭头展开或收起任务树。展开时显示前 5 条并保留当前任务，也可查看其余记录。点击任务进入详情，点击会话打开完整对话。同一会话的续聊会合并。
- 项目旁的 **＋** 打开预选该项目的新建任务表单。**让 Being 安排** 打开 Being 主对话，并准备该项目的上下文草稿。
- 任务按 ledger 中实际的 `workdir` 归属项目；嵌套项目优先匹配最具体的目录。没有匹配项目的历史任务保留在 **未分配项目**，不会迁移文件或改写历史工作目录。
- 默认 Being 工作目录之外的项目，通过已有受认证客户端通道检查是否由用户添加。检查真实路径，符号链接不能借项目目录越界。任务的文件工具、命令工具使用该项目作为工作根目录，并沿用现有权限模式；续聊保持原目录。
- **全部任务** 显示所有项目的任务。选择项目后可继续按状态、执行器或搜索词过滤。

## 使用流程

1. 在 Being 主对话输入 `/work` 并说出要做的工作。可以直接在已有项目建任务，也可以先建立长期目标再关联项目。添加项目时通过客户端文件夹选择器确认目录。用 `@work create` 创建任务，明确要求执行时再用 `@work run` 派发。
2. 在 **Work 工作** 顶栏、项目旁或看板列头点新建任务。项目和列头入口会预填项目或状态。输入标题即可创建，项目和执行器可稍后分配。
3. 打开有关联目标、规格或验收标准的任务先进入「任务总览」，可以查看要求版本、子任务和执行交付。点击「打开执行会话」可追加要求、停止执行或续聊，右上角的「任务总览」可返回。普通任务仍可从列表直接进入已有执行会话。
4. 在「全部任务」点 **让 Being 安排**，主对话会预填 `/work 帮我创建一个任务：`，补充需求后即可发送。任务里的「同步状态到对话」会把任务链接和当前看板状态加入草稿。所有看板状态都保存在同一份 Work 记录中，Being 可读取最新值。
5. 需要直接执行时，从项目看板或目标下的项目点「新建执行会话」，选择执行器并发送第一条消息。会话绑定当前对话场景和项目目录。

Work 草稿、选择及筛选在本次客户端会话中保留；切换 Being 时清空，防止串用。任务及续聊关系由 Portal ledger 持久化。沿用现有 ledger 保留策略（最多 200 个已结束任务），不承诺永久历史。

## 任务看板与工作结果

- 从「待办」拖到「进行中」可直接启动任务，也可以在任务详情点击「开始执行」。执行成功进入「待审核」，侧栏显示审核图标。确认结案后进入「已完成」，侧栏显示勾选图标。执行失败进入「已阻塞」。
- 任务详情将状态变更、备注和运行结果放在「任务动态」，执行与自动化控件在属性区。结果可打开具体执行轮次。产物支持 HTTPS 链接与项目目录内文件。
- 修改任务规格或验收标准会保存一个要求版本。每轮执行记录开始时的任务要求版本，以及项目有所属目标时的目标版本，成功后生成交付版本。回执链接到项目内文件时，客户端保留该轮文件副本，续聊覆盖源文件后仍可预览各版。结案时记下最新交付版本。
- 看板工具栏提供搜索、筛选与排序、视图切换和视图设置。视图设置中可选择看板字段、泳道分组和保存的视图。拖拽支持空列、卡片之间或列尾，手动排序会保存位置。按住看板空白区域可横向平移。
- 内置、Codex 和 DeepSeek 支持在对应运行允许时追加指令。未成功结束的运行可以重试。内置重试沿原任务历史，原生重试使用当前原生会话中的原始指令发起新一轮。原生权限仍由原执行器和客户端策略检查。
- 「工作结果」展示运行结果，可在展开后打开执行会话或「加入 Being 草稿」。草稿使用任务来源对话，带上交付版本和归档文件。用户确认发送后，Being 可用 `@work result <result_id>` 读取指定一轮。
- 「让 Being 安排执行」会准备可编辑的安排请求草稿。用户点发送后，Being 读取原任务，再按请求派发。点击安排入口时，原有状态继续保存在看板。
- 看板拖拽开工时，缺少项目或执行器会打开编辑框，补齐后点击「保存并执行」。项目默认执行器可以使用。收到启动确认后看板才进入「进行中」。
- Being 可用 `@work create` 创建待办，`@work run {"item_id":"work_…"}` 显式派发，`@work update` 修改字段，`@work note` 和 `@work artifact` 登记补充。启动较慢时先返回 `starting`，通过 `@work status <work_id>` 查询同一条派发和实际运行 ID。重复首轮派发或重发相同接管 ID 会复用原回执。通过 `@work <work_id>` 获取任务属性及关联运行，通过 `[任务标题](beings://work/<work_id>)` 打开任务。
- 任务详情的「自动化」或 Being 的 `@work automate` 可配置一次性审核交接和自动唤醒。交接在任务进入待审核时启动审核执行器，附上上一轮结果。唤醒在待办或阻塞任务的指定时间到达、同项目指定任务完成，或所有子任务完成后发起。触发记录保留执行器、状态和运行 ID。
- `@work automate` 接收 `item_id`、`scene_id` 以及 `handoff` 或 `wakeup`。两个规则都需要 `executor` 和 `instruction`。唤醒另需 `kind`（`at` 需 Unix 毫秒 `at`，`task_done` 需 `itemId`，`children_done` 无额外参数）。将某个规则设为 `null` 可移除。当前场景由 `/work` 上下文提供，Portal 已提供场景时优先使用。
- 选择已注册的项目后，可在「项目规则」设置默认执行器和审核交接。默认执行器供 Being 选择时参考，任务指定的执行器优先。默认审核在任务首次成功后触发一次，任务可覆盖或跳过该规则。

新增的任务、排序和已读操作使用 `beings://desktop/api/work/items` 及 `/api/work/results` 资源。运行中追加与重试使用 `/api/subagent/tasks/{id}/steer` 和 `/retry`。原生结果回执依赖新构建的 Portal，需重启客户端和 Portal 以启用。

## 指派给其他 Being

1. 打开任务详情或任务右键菜单，选择「指派给其他 Being」。
2. 从 Town 通讯录搜索收件人，或填写完整 Town ID。预览并编辑私信正文。
3. 点「保存并准备私信」。核对自己 Being 主对话里的收件人和正文，再点发送。Being 按实际私信回执报告结果，收件人可在私信里回复是否接手及交付结果。

看板和任务属性会显示已保存的收件人。可通过「管理 Being 指派」变更或移除。任务执行进度与私信交收分别由 Work 和 Being 对话查看。

## 对话与执行过程

新建与续聊共用主聊天的 `RichComposer`：Enter 发送，Shift+Enter 换行。用户消息使用主聊天的蓝色，子智能体回复使用中性底色。运行时的公开说明与工具调用全部放在默认折叠的 **思考中** 内，展开后可查看工具参数和结果；完成后的最终回复显示在折叠区外。执行区域复用主聊天 `ChatActivity` 和样式，正文沿用共享 `cleanContent` 清理 DSML 等协议标记。

Portal 记录并合并可见 `text_delta`，忽略模型私有 thinking；客户端订阅节流刷新。界面“思考中”是执行状态入口，其中的文字是公开输出，不代表暴露私有推理。

## Being 与任务上下文

- `/work` 使用现有斜杠指令机制：编辑器显示指令标签，仅在发送时展开客户端能力说明；底层复用 `portal_exec` 的 `@work` 命令。
- 在主对话说 `/work 请在 Project-A 生成一份可筛选的活动议程 HTML，建好任务后直接开始`。Being 安排执行器，拿到启动回执就回复派发状态和任务标题链接，Work 在后台继续执行。随后在同一主对话问「刚才的议程页做好了吗？把文件发给我」，即可查询结果。点任务标题可进入独立会话继续修改，再回到同一主对话问「把最新版发给我」。这些追问可直接用自然语言。
- 派发回合只确认启动。若执行器仍在启动，Being 报告当前状态。若启动确认超时，Being 可通过 `@work status <work_id>` 核对原派发。查询回合通过 `@work results <work_id> [<work_id> ...]` 一次读取这些任务在当前场景的最新回执和看板状态。直接调用 `@work results` 则获取当前场景的近期回执。
- 内置通道未接收派发时，Portal 将原派发键锁定后开放重试。在原执行存在时返回它的回执，证据不足时保留「未确认」。
- `@work goals` 列出当前 Being 的 Work 目标，`@work goal <goal_id>` 读取目标、关联项目和任务进度。`@work create-goal` 和 `@work update-goal` 管理目标，`@work link-project` 关联已经添加的项目。Being 可以用 `[目标标题](beings://work/<goal_id>)` 链接到目标。
- `@work add-project` 支持传入建议目录 `directory` 和所选目标 `goal_id`，以实际选择结果为准。选择期间取消请求或切换 Being 不会写入项目。
- `@work projects` 列出项目及目录；`@work project <project_id>` 读取项目和对应任务。当前 Work 项目也包含在客户端场景上下文中。
- `@work <task_id>` 读取完整会话：从首轮或任意续聊 ID 均可读取首轮及所有后续轮次，保留用户补充、公开回复、工具参数、结果和错误。原生会话附其接口公开的对话记录（不包含运行时注入的配置提示）。超过 12000 字符时返回固定快照的 JSON 文本分页，按 offset 拼接 content，并跟随 next 读取至 null；无最近六轮或单条截断。每个快照保留 10 分钟、最多保留 8 个，过期明确报错并要求重读。重启后可重新读取原生持久历史。
- `portal_subagent_control` 新增 `action: "continue"`，参数为 `task_id` 和 `message`。Being 和 Work 页面使用同一续聊实现。
- 续聊继承原任务 scene、session、工作目录和现有权限；执行器接受续聊后，关联任务回到「进行中」，本轮成功后进入「待审核」，失败进入「已阻塞」，取消进入「已取消」。保留原来的 `steer`、`follow_up` 和 `cancel` 行为。
- Work 和 Being 的续聊都会携带当前任务要求，并记录发送时采用的版本。重试一次失败的执行沿用该次指令和版本。派发或交付还未确认时，结案请求会被拒绝。
- 每轮关联 `parent_task_id` 与 `user_message`，在启动任务时与 ledger 一起写入，不根据相同 session 名称把无关任务合并。
- 对于无持久会话的运行模式，显式携带任务说明与各轮最后回复，历史预算为 44000 字节，较早内容可能截断。工具明细仍可在 Work 查看，文件继续保留在原工作目录。完成通知继续走原 Heart callback。

## 网络与运行时

页面业务请求使用以下可在 DevTools Network 查看路径：

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET | `beings://desktop/api/work/imports` | 外部项目/会话候选清单、执行器连接状态及当前导入选择 |
| POST | `beings://desktop/api/work/imports` | 正文 `{ "projectIds": [], "taskIds": [] }`，保存当前 Being 的导入选择；不会改写或删除原生历史 |
| GET / POST | `beings://desktop/api/work/goals` | 查询或创建当前 Being 的 Work 目标 |
| GET / PATCH | `beings://desktop/api/work/goals/{goal_id}` | 读取目标及关联项目，或更新目标要求和状态 |
| GET | `beings://desktop/api/contacts` | 读取 Town 公共通讯录供指派选择 |
| PATCH | `beings://desktop/api/work/items/{item_id}/assignee` | 保存或移除收件 Being |
| GET | `beings://desktop/api/subagent/projects` | 当前 Being 的本机项目目录 |
| POST | `beings://desktop/api/subagent/projects` | 正文为 `{ "directory": "绝对目录" }`，可加 `goalId`，校验目录后注册项目 |
| PATCH | `beings://desktop/api/subagent/projects/{project_id}` | 更新所属目标，或保存默认执行器及审核指令 |
| POST | `beings://desktop/api/work/items/{item_id}/runs` | 按任务要求启动执行，使用当前 `scene_id`，可传 `executor` 和 `request_id` |
| GET / POST / PATCH | `beings://desktop/api/work/items/{item_id}/dispatch` | 查原派发、创建接管请求或记录对话接收及派发失败 |
| GET | `beings://desktop/api/subagent/tasks` | 现有 ledger 快照与可用状态 |
| POST | `beings://desktop/api/subagent/tasks` | 创建独立任务，正文包含 `brief`、`workdir`、`scene_id`，可选 `executor` 和 `modelSelection` |
| GET | `beings://desktop/api/subagent/tasks/{task_id}` | 现有脱敏执行记录 |
| POST | `beings://desktop/api/subagent/tasks/{task_id}/messages` | 正文仅 `{ "message": "..." }`，续聊 |
| POST | `beings://desktop/api/subagent/tasks/{task_id}/cancel` | 停止执行 |

写请求保留 Portal HTTP 路径、状态码、Content-Type 和错误正文。主进程检查当前 Being、可见任务、运行时 PID 与启动 nonce，只连接选定 Portal 的 loopback API；真实访问凭据只在主进程与 Portal 之间传递。Portal API 再调用原 ToolHost 与 SubagentManager，子工具权限和回调保持原有机制。

此改动包含 `heart-portal` 子模块源码。更新后需要使用新构建的 Portal，并重启客户端/Portal。旧引擎仍可读取任务，但续聊请求会返回 503，提示更新或重启。

## 验证

- `npm run typecheck`、`npm test` 和 `npm run lint:styles`。
- `node tests/work-electron.mjs` 使用真实 Electron 壳和 beings 协议，验证项目、待办、拖拽开工、超时恢复、续聊、草稿和结果。执行器和目录选择使用隔离夹具。
- `npm run test:chat-sessions` 验证主对话的场景草稿、队列和任务入口。
- `cargo test --manifest-path heart-portal/Cargo.toml --locked -p heart-portal subagent::` 覆盖上下文祖先链、重启恢复、鉴权、stdio 子进程和完成回调。模型输出使用本地夹具。
- 项目运行测试覆盖默认工作区之外的注册目录、未注册目录和符号链接拒绝、首次执行与重启后续聊的真实 cwd，以及 Being 完成回调。
- UI 截图与 Network 记录位于 `test-results/work/`。

## 目标到交付的验收用例

1. 在 Work 新建「社区市集志愿者工具」目标，验收条件是手机能离线查展位。添加一个空的项目目录，确认它出现在该目标下。
2. 从「全部任务」点「让 Being 安排」。在预填的 `/work` 草稿后说明要建「市集展位导航页」，使用内置 Subagent。要求交付单文件 HTML，包含展位搜索、分类组合筛选、实时计数和空态。确认这一轮只创建待办。
3. 在同一个 Being 对话说「可以开工了」。确认先收到状态和可点击的任务入口。打开入口核对所属目标和运行状态，再回主对话另问首版结果。
4. 更新目标的验收条件。在同一个 Work 执行会话里要求调整 HTML 的「清除筛选」交互。确认任务重新进入进行中，新版完成后回到待审核。
5. 在同一个 Being 对话索取最新归档并打开 HTML，实测搜索、分类和一键清除。确认任务详情保留首版、复验版及各自的目标版本，再安排结案并核对目标进度。

## 原生执行器与会话导入

`desktop/main/agent-bridge/` 提供注册表及独立适配器：Codex 使用 CLI app-server 的 project/thread/turn 协议；DeepSeek 直接连接其原生桌面宿主；内置任务仍使用 Portal 已有运行时。DeepSeek 不经过 Codex 委派。原生 session ID 不复制、不改写，Work 仅加执行器命名空间，并把同目录项目合并展示。

- `@work agents` 查看执行器的连接和可执行状态。没有关联长期目标的项目可用 `@work start` 创建独立会话。需要任务看板、目标继承和交付版本时，使用 `@work create` 和 `@work run`。
- 新会话选择执行器；已有会话保持其原生执行器。项目下展示 session，历史轮次与工具活动复用主对话的折叠执行组件。
- Renderer 的外部执行操作使用原生资源路径：`beings://codex/project/create`、`thread/start`、`thread/resume`、`turn/start`、`turn/interrupt`；`beings://deepseek/api/workspace/create`、`session/create`、`commands/execute`（仅权限同步）、`session/prompt`、`session/cancel`。请求体保留原生协议；主进程管理凭据，保留 HTTP 状态及原始错误正文。Work 聚合读取沿用本地任务 API。
- Codex 优先连接已有 app-server control socket，也可启动独立 app-server 读取原生持久历史。完成后解除订阅，续聊时恢复原会话并应用当前客户端权限。
- DeepSeek 的“连接”安装一个只有发现职责的 Cordis 插件到 `DSH_HOME/town-bridge`，在 desktop profile 的 `cordis.patch.yml` 中追加 `town-work-discovery`。重启 Harness 后，它以 0600 文件发布当前宿主的官方本机认证 URL；Town 交换为主进程内 cookie。业务仍走官方 session/workspace API，不直接改写原生会话文件。关闭原生宿主会断开连接。
- Work 展开时定时刷新。外部启动要求启用命令执行和完整访问权限，续聊前重新应用当前设置。客户端设为「每次询问」时，额外执行器只同步历史，执行交给内置 Subagent。
- 接入新 agent：实现 `AgentAdapter`，在 bootstrap 注册；有原生页面操作时添加 `work-executors.ts` 的协议传输适配器及限定路径校验。协议特殊处理仅留在对应适配器；不得通过通用任意 URL/命令代理扩展。
- 「导入 / 同步」可按执行器和项目勾选外部历史会话，选择按 Being 保存。Work 创建的原生会话自动保留，清空历史导入选择后仍可在 Work 中打开。
