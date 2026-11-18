1、防过度防御：几乎不会发生的边界问题，先讲清概率，让用户确认后再加，不准为了"理论上更稳"私自膨胀代码。

2、入口单次校验：外部数据只在边界校验一次，内部靠类型系统流转，禁止层层重复判断。

3、拒绝提前抽象：单次使用的逻辑就近内联，不随意拆无意义的 helper。

4、控制复杂度：非必要不用 try/catch，能一个函数清晰搞定的别硬拆。

5、Network 接口规范：参考 Heart 的 `desktop/main/chat/proxy.ts` 和 Home 的 `desktop/main/home/network.ts`、`desktop/shared/home.ts`。页面发起的业务接口通过 `fetch(beings://...)` 转接，让 DevTools Network 能看到请求、状态和响应；IPC 可用于取得本地访问凭据，不代替可观察的业务请求。

- beings URL 沿用对应服务的 API 资源路径和接口名称，只替换服务 origin，不在路径中额外拼接上游域名、IP、`proxy` 或功能包装前缀，也不把具体接口改名为通用 `model` 等操作。例：Heart `beings://chat/api/llm/config`，Home `beings://desktop/api/v1/me/kit-catalog`，自部署模型 `beings://desktop/llm/{being_id}/v1/chat/completions`。
- 上游地址映射与真实鉴权由主进程管理，沿用现有受信入口和路由范围；真实 token 不放入页面 URL、请求参数或日志，不把转接入口做成任意地址代理。
- 保留 HTTP 方法、上游状态码、Content-Type 和原始错误正文，不把失败包装成 200 或仅返回改写后的提示。界面需要简短提示时，与 Network 原始响应分开处理。
- Network 的请求体必须与上游实际业务请求一致。模型接口只传模型协议字段，不混入客户端的 workspace、权限、进程路径或整份 settings；本地配置准备与保存结果通过内部通道处理。不能仅把保存设置的请求改成模型接口名称。
- 转接复用原有业务事务、校验和回滚；配置必须验证成功后才能应用。修改后检查 Network 中的实际接口路径、状态码与响应正文。
