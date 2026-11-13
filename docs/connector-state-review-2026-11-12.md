# Connector 连接流程与整体改动 review

日期：2026-11-12。本轮保留工作区既有界面改动，以 Beings-Town `b2b82d40828eb6b431fbd80d91812a6dacab7990` 的实现为依据调整客户端。

已匿名读取[生产 OpenAPI](https://home.beings.town/openapi.json) 与 [DEV OpenAPI](https://dev.beings.town/being-home/openapi.json)，两者均包含 `KitConnectorAccount.enable_id` 和 `POST /v1/me/kit-releases/{id}/connector-accounts/{connection}/remove`。参考服务端 `application/kit_connector_activation.rs`、`infrastructure/persistence/kit_connector_activation.rs`、HTTP DTO、`static/kit-connector.js` 以及 `simplify-kit-connection-and-tool-management` 规格。没有修改服务端或执行生产写操作。

## 已修复的问题

| 优先级 | 问题 | 当前行为 |
| --- | --- | --- |
| P1 | 旧客户端把无安装账号的“断开”映射为撤销 Being 共享 grant，会影响其他应用；有安装时又只卸载安装，没有移除当前账号。 | 顶部“断开”统一处理本应用全部当前账号，包括未完成授权；账号旁“移除”只处理该账号。先提交安装 uninstall 并读取权威 `desired_state=removed`，再调用应用内 remove。删除不再使用共享 grant 接口。 |
| P1 | 旧重连先恢复 grant 或原地 reauthorize；失效且 grant 已撤销时仍可能无法恢复。未识别 OAuth 的重复点击则复用已经中断的旧授权。 | 重连按认证方式发起新的 preview/confirm。无安装账号先 remove，结束 default 代表的未识别尝试；有安装账号保留安装，由 Home 在授权成功后按真实身份合并。客户端不再自行推断旧账号可否原地 reauthorize。 |
| P1 | 客户端只依靠本地保存的 intent，无法继续在网页或其他设备发起的授权；保存键按 release 也会覆盖同应用的其他意图。 | 详情读取 `enable_id` 加入后台检查，保存键改为 intent ID。兼容读取原 release 键；网络错误保留恢复记录，目录独立加载，登录完成后重试恢复。仅保存意图 ID，不保存 OAuth URL 或凭据。 |
| P1 | 一个 intent 的轮询异常会中断整轮循环，排在后面的应用无法完成连接。 | 按 intent 分别处理失败，其他连接继续 advance/state；已观察到的终态不会因详情仍返回 enable_id 而再次加入轮询。授权与移除期间暂停发起后台轮询，并等待已发出的状态请求完成。 |
| P2 | confirm 返回 awaiting_account 时不刷新账号，无法显示新 default；安装尚未 ready 时也可能显示“已连接”。 | confirm 后刷新目录和详情，回到普通账号区；只有有效账号及 enabled/ready 安装显示“已连接”。工具偏好 `enabled` 与实际 `available` 保持分离，暂停时显示 0 个可用且保留开关。 |
| P2 | 部分断开成功、后续失败时缺少完整核对；新接口会隐藏卸载历史，响应丢失后可能失去重试入口。 | 成功或失败后都重新读取目录和账号。保留尚未确认移除的账号及原请求 ID/revision，允许继续同一次断开；已完成账号不重复卸载。202 只表示受理，移除前检查安装目标状态。 |
| P2 | 详情缺少统一状态刷新，OAuth 关闭后只能重复点击连接；切换设置标签会残留旧详情标题。 | 详情增加“刷新连接状态”；设置卸载 connector 页面时清理详情导航。授权过程仍由后台推进。 |
| P2 | 通用 HTTP 400 文案先于 `invalid_grant`、`invalid_path`，盖住可操作的错误原因。 | 具体错误码优先，并补充缺失第三方身份与认证方式不可用的提示。 |
| P2 | 设置搜索过滤掉当前标签时，全部搜索结果都是 `tabIndex=-1`。 | 第一项可见结果保留键盘入口，支持 Tab 和 Enter 选择。 |

设置导航回归还复现了浏览器关闭后漏发原生视图隐藏通知的问题：关闭时立即依据 `state.open` 发送不可见状态，避免依赖减少动画模式下不一定发生的尺寸变化；原失败用例与插件导航回归均已通过。

同时修正 Connector 图标失败状态：服务端换了图标 URL 后可加载新图标，不沿用旧 URL 的失败状态。

实现集中在 `desktop/renderer/app/components/connectors.tsx`、`desktop/main/home/connectors.ts`、`desktop/shared/home.ts` 和 preload/IPC。复用现有组件及安装接口，没有新增状态机框架或服务端兼容分支。

## 授权流程补充 review

同日按“登录 → 授权 → 取消 → 账号连接/移除 → 工具展示”的实际操作复查，补齐以下断点：

| 优先级 | 问题 | 修复 |
| --- | --- | --- |
| P1 | 等待 Home 登录与凭据确认时没有取消入口，且 Home action 返回的 error 被忽略。 | 登录等待期间可取消登录，配置读取、token 交换与 OIDC 验证请求随取消立即中止，不再等待 20 秒网络超时；切换设置页再返回仍恢复登录等待与取消入口，订阅 Home 状态更新。错误明确显示并允许重试。凭据预览与 OAuth 等待期间可取消本次授权。 |
| P1 | confirm 成功后先等待目录/详情，读取失败会挡住 OAuth 浏览器打开。 | 先打开返回的授权地址，再刷新数据；打开失败保留“继续授权”。confirm 响应丢失时保留同一个 preview ID 供明确重试。 |
| P1 | 已有可用、未安装账号仍按认证方式重新授权，无法按接口复用账号或确认接管。 | 发送 `connector-preview { connection_id }`，不重复采集凭据；requires_adoption 必须由用户勾选确认。即使 methods 为空仍可连接已有有效账号。 |
| P2 | 服务端取消接口自身不幂等，响应丢失后再次 POST 会报冲突。 | 取消前 GET 当前状态；已取消则直接核对结果，安装已开始则提示通过账号移除停止连接。完成后清除本地 intent 和凭据，保留其他已安装账号。 |
| P2 | OAuth 与 API Key 同时存在时，替代认证方式不可选。 | 按 2026-11-13 的用户要求，OAuth 2.0 存在时保持原一键连接；不存在时按 API Key、自定义凭据排序展示。 |
| P2 | 工具暂停后没有恢复入口；账号失效直接隐藏全部工具，用户看不到保留的配置。 | 读取 Being access，允许显式暂停/恢复该安装的调用权。恢复 disabled 安装先 enable，再更新 Being access；操作采用最新 revision。失效账号仍展示工具偏好与重新连接提示，不错误显示工具可用。 |
| P2 | 重新打开 preparing 安装但没有本地 intent 时，工具就绪后不会自动更新；外部撤权也不会及时显示。 | preparing/unknown 安装继续刷新，窗口回到前台重新读取账号及工具状态。 |

账号授权、安装是否启用、Being 调用权和单工具偏好保持独立：暂停工具不卸载账号，不触发第三方重新登录；失效账号仍可暂停 Being 调用权，恢复则要求账号授权有效并由用户明确点击。有效账号仍可显示“已连接”，列表分别显示“已开启 x/y 个”和“当前可用 z 个”；开关保留 `enabled` 偏好，可用数量以服务端 `available` 为准。

新增浏览器用例实际操作了登录取消/重试、OAuth 取消保留旧账号、confirm/cancel 响应丢失、OAuth 打开失败与详情失败、有效账号接管、多认证方式、取消清空凭据、工具暂停/恢复及 revision 冲突、无 intent 的安装就绪、窗口聚焦后的外部撤权。IPC 测试覆盖 Being access GET/PUT 的完整请求链路。

## 当前接口流程

1. 读取 catalog、installations 和 release connector detail。账号列表以服务端返回的当前账号为准，历史账号不在前端重新拼回。
2. 新连接或失效账号重连使用 `connector-preview { method }`；已有可用的未安装账号使用 `{ connection_id }`。凭据方式填写声明字段，需要接管时先明确确认，随后 `confirm`。OAuth 只在用户连接或继续授权时打开系统浏览器。
3. confirm 后先打开 OAuth 地址再刷新账号。`awaiting_account` 的 default 保持可重连、可移除，也可取消本次授权；`enable_id` 可恢复后台推进。未产生安装时使用 advance，有安装后使用 state，直至终态。
4. 已安装账号重连时不卸载原安装；授权后的身份去重、grant 准备及安装复用由 Home 负责。
5. 单账号移除与整应用断开采用相同顺序：安装 actions → 读取安装目标状态 → release connector-accounts remove → 重新读取目录及详情。remove 幂等，其他应用及第三方平台同意不受影响。
6. 账号已移除但网络响应丢失时，保留本次操作的重试入口。明确的 409 拒绝刷新后重新发起；不确定的 lifecycle 请求保留原请求体。
7. 工具偏好来自 connector-tools，Being 调用权来自 being-access。暂停/恢复使用最新 revision；disabled 安装恢复时先 actions enable。账号失效仍展示工具配置，实际可用数保持为 0。

## 验证与边界

- 修改后全量 Vitest：166 个文件通过，1,406 项测试通过；11 个文件、34 项原生/平台条件测试按现有条件跳过。
- 最后补充的原生登录取消修复经 58 项 Connector/Home/文件/IPC 定向测试通过，覆盖配置、token、OIDC discovery、JWKS 四阶段中止与立即重登；修改后 TypeScript 检查通过。此前 Connector/Home/错误提示/启动相关定向单元测试通过；IPC 测试穿过真实 preload、注册层和 HTTP 适配，包含 remove 的 204 与安装读取。
- Connector 浏览器回归：真实 React 组件，覆盖分页与登录、fresh OAuth、default 重连、无本地记录的 enable_id 恢复、失效且撤权账号、身份合并、多账号工具选择、单账号及全应用移除、部分失败、响应丢失的稳定重试、暂停偏好、独立轮询、过期意图停止轮询、恢复请求的临时失败、凭据和导航迟到响应。
- QQ Mail 浏览器回归：凭据表单、权限说明、账号保留、工具写操作确认、revision 冲突恢复、刷新与保存并发。
- 已检查窄窗口截图；Impeccable 对 connector 源码的机械检测无发现。
- 聊天流式显示、连接 toast、工作区布局、资料页保留行为、设置导航及插件设置的浏览器回归通过。
- `git diff --check`、样式 lint 和样式架构检查通过。
- 启动测试验证 `being-app://connector/complete` 在初始化前安全排队，初始化后复用窗口；带查询参数的链接不触发回调行为。

这些是隔离 fixture 与公开协议核对，不等同于真实第三方 OAuth 或生产账号验收。未运行 Beings-Town MySQL 集成测试，也未做安装包注册系统协议的实机验收。

服务端仍保留独立权限语义：已有 paused 安装或已撤销 Being 调用权不会因快捷连接自动恢复。客户端提供明确的“恢复工具”操作，不静默重新授予权限。状态 GET 和重复 confirm 不能恢复首次 confirm 的 OAuth URL；当前窗口保留 URL 时可继续授权，重启或首次 confirm 响应丢失后可通过重新连接结束旧尝试并获得新授权，不持久化敏感 URL。取消本次启用与撤销第三方平台同意不是同一个操作，第三方同意仍由平台管理。

## 2026-11-13：已开启但可用为 0 的排查

- 用户截图暴露计数歧义：开关依据 enabled，但标题只展示 available，无法看出已保存的启用数量。现在并列显示两项，且不会把已开启直接当作可调用。
- 实际客户端 Gmail 详情曾同时显示账号“已连接”和工具安装 degraded。账号行按 installations 顺序选取，工具区却按 account.installation_ids 顺序选取，同账号的历史重复安装会导致状态与工具不一致。现共用安装选择逻辑：优先 enabled/ready，其次 enabled，最后其他未移除安装；工具读写、Being access 与账号标记使用同一安装。
- 安装状态枚举补齐 degraded、waiting_device、unsupported_auth_channel、blocked、disabled、removed；此前这些状态被错误标为“未连接”。waiting_device 纳入自动刷新。
- OAuth 2.0 默认保留原连接形式，不额外展示替代入口；仅当 OAuth 不存在时按 API Key、自定义凭据顺序展示。
- 浏览器回归新增“历史 degraded 安装排在 ready 安装前”“全部安装 degraded 但工具偏好保留”，并调整认证方式优先级的回归。实际运行时的具体阻塞原因仍以 Home 组件状态为准，客户端不会自行把不可调用工具改为可用。

同日匿名读取生产 Grove `GET /grove/v1/kits?limit=50&q=gmail`（HTTP 200），返回两条 `production-connectors/gmail`：1.0.0 / `155a3300-fcfc-42ea-a169-47780ad7b469`，1.1.0 / `dda30fe2-136c-4e40-b784-5a52eda2f13c`。市场明确按不可变 release 分页，Home 按 kit_id 为两条记录关联当前安装；客户端按 release_id 逐条渲染且卡片仅显示名称，造成两个同名入口。此核对未改动目录分组或用户安装。

本轮验证：Connector navigation 与 credentials 浏览器回归通过（包含 OAuth 优先、无 OAuth 时的方式排序、重复安装选择、已开启与实际可用计数）；Connector API/IPC 11 项测试通过；TypeScript、样式 lint/架构检查和 diff 检查通过。
