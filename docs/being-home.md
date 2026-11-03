# Being Home 云电脑

接入依据：[Being Home 客户端对接文档](https://d5.feishu.cn/docx/HXjcdWmProQqFkxlvducqR0Jn4g)，2026-11-03 通过 Lark CLI 读取 revision 51，采用第 14 节「客户端直接接入云电脑画面流（新增方案）」。同时核对当前部署的 `/browser-client.js`、`/live-view.js` 和真实浏览器状态。

固定服务为 `https://home.beings.town`，公共桌面客户端 `being-desktop`，OAuth 回调为 `http://127.0.0.1:47831/oauth/callback`。

## 使用流程

点击聊天顶部 Being 名称，进入「电脑」。首次连接通过系统浏览器登录 Home。客户端用 Heart origin 和 heart_being_id 对照当前 Loom 连接；不同账号不能打开当前 Being 的电脑。未初始化或关联时提供对应操作，关联前展示账号和 Being，由用户确认，不覆盖已有绑定。

信息栏保留「详情 / 动态 / 资料库 / 电脑」四个 Tab，场景动态仍为独立页。分栏使用 20px 拖拽热区和细线渐显反馈，原生画面旁留出实际拖拽空间。资料页的刷新按钮只更新状态；需要重建查看会话时，从更多菜单选择「重新连接浏览器」。

休眠时点击「唤醒」。浏览器就绪后，小窗口直接显示实时画面；悬停或键盘聚焦显示遮罩与居中的「放大展示」。点击后进入独立右侧面板，可调整宽度、收起或展开对话，关闭面板后回到原有资料页布局。

面板显示浏览器画面和「仅观看 / 接管浏览器」控件，接管后可点击、滚动、输入中文或粘贴文本，再交还 Being。画面等比适应可用区域，留白随客户端明暗主题变化。连接阶段使用呼吸动画，遵循减少动态效果设置。

单次输入或粘贴超过 4000 字符时提示分段输入，整段不发送，避免静默截断后执行不完整内容。

切换标签或收起面板保留同一个画面会话，同时释放人工控制权。再次显示时默认观看。明确关闭浏览器、退出 Home、切换 Being 或服务端会话失效才清理会话。停止、恢复等操作仍位于资料页更多菜单。

资料库保持空态，留给后续真实生成的 HTML 和文件。本次不接文件列表或任务列表。

2026-11-03 另核对文档 revision 52 的第 7 章：工作空间可通过 `GET /v1/me/files?path=…` 列目录、`GET /v1/me/files/content?path=…` 读取二进制内容，所需权限为 `files:read`。该服务独立于电脑运行；资料库后续应单独接入这些接口与隔离预览，不通过画面流同步文件。当前客户端未申请文件权限。

## 接口与会话

1. Native OAuth 获取身份，核对 Home / Heart 绑定及电脑状态。
2. `POST /v1/me/computer/desktop-ticket` 获取一次性查看票据。
3. 主进程在独立 Electron Session 中请求票据地址 `/desktop/connect?ticket=…`，接收 `bh_desktop` HttpOnly、Secure、SameSite=Strict Cookie，校验重定向目标后停止；不加载远端 Home HTML。
4. Cookie 与固定 Home Origin 用于以下私有桌面接口：

| 接口 | 用途 |
| --- | --- |
| `GET /desktop/{computer_id}/browser/state` | 就绪状态、画面尺寸、控制租约、`live_view` 能力 |
| `WSS /desktop/{computer_id}/browser/stream` | RFB 二进制实时画面 |
| `POST /desktop/{computer_id}/browser/control` | `claim`、`renew`、`release` |
| `POST /desktop/{computer_id}/browser/action` | 校验后的点击、滚动、按键和文本输入 |
| `GET /desktop/{computer_id}/browser/frame` | 仅当旧实例未提供 `live_view` 字段时兼容 JPEG |

画面流使用 noVNC 只读解码，输入通过 JSON action 提交。声明支持 RFB 的实例发生连接错误时重连，不偷偷退回截图轮询。断线不会重放输入或自动接管。401/403/410、Cookie 失效及流关闭码 4001 会清理查看会话。

这套接口是文档新增的桌面 Cookie 协议，不是通用 Bearer WebSocket；已有的 `/v1/me/computer/live-view-session` 属于另一套只读协议。

## 实现边界

- `desktop/main/home/client.ts`：PKCE/OIDC、固定 loopback 回调、签名/nonce/issuer/audience 校验、刷新合并、凭据加密持久化及撤销。与 Loom 凭据分离。
- `service.ts`：归属校验、电脑状态、异步操作、幂等唤醒/停止/恢复；阻止切换 Being 后的迟到响应。
- `transport.ts`：主进程持有 Cookie、HTTP 与 WSS；验证输入、控制租约与队列；串行发送且不重放；有界流缓冲和 IPC ACK 背压。
- `viewer.ts`：同一个本地 WebContentsView 在小窗口、右侧面板和隐藏宿主间移动；保持 Session 与流连接。限制导航、网络、权限和下载；IPC 只接受该本地页面的主 frame。
- `desktop/preload/home-viewer.ts` / `desktop/shared/home-viewer.ts`：专用最小桥，只传状态、帧字节与允许的操作；不暴露 Cookie、票据、URL 或应用通用 API。
- `desktop/renderer/home/`：客户端自己的本地页面、noVNC 只读 canvas、hover 遮罩、加载状态和接管按钮。CSP 禁止 renderer 联网，按真实画面边界映射坐标，拒绝留白区点击。
- `BeingComputer`：原资料布局、独立面板、操作确认、主题与视口尺寸；菜单遮挡时使用内存截图占位。

没有向远端 Home 页面注入 CSS 或 JavaScript，也没有通过裁剪隐藏远端按钮。客户端根本不加载该页面，只显示画面流；画面里的 Chrome 网页内容仍由云端浏览器决定。

`node scripts/build-home-viewer.mjs` 生成本地 viewer、专用 preload 和第三方许可证；桌面准备脚本自动执行该构建。

## 验证

```sh
npm run typecheck
npx vitest run tests/home.test.ts tests/home-stream.test.ts
node tests/home-computer-ui.mjs
node tests/home-viewer-electron.mjs
```

Electron 集成测试使用临时 profile、回环 HTTPS/WSS 和精确测试证书 pin，不改变生产证书校验。覆盖一次票据兑换、Cookie/Origin、零远端 HTML 加载、真实 RFB 多帧解码、原生鼠标坐标、中文输入协议、控制领取/续租/释放、布局切换保留、断线不重放和会话过期清理。

2026-11-03 使用 Computer Use 在真实客户端验证了云端 Chrome 画面、小窗口放大、接管、中文粘贴、Ctrl+A、交还控制和收起对话。生产停机、重建及文件持久化没有在本轮执行；旧实例 JPEG 分支未做真实服务验收。

## 2026-11-03 接入复查

复查覆盖身份与绑定、票据兑换、Cookie 隔离、RFB 展示、输入映射、接管租约、布局切换、断线及关闭清理。

本轮修正：

- 原生视图切换宿主或布局后主动重新适配画面，同时覆盖预览/放大、隐藏恢复与客户端缩放；浏览器面板采用与标题区一致的内边距。
- 布局 effect 清理不再发送一次虚假的隐藏状态。收起/展开对话不释放正在使用的接管权；实际隐藏、切换标签仍交还控制。
- 续租不清空排队输入；隐藏期间才返回的接管请求主动交还；明确关闭查看器会先尝试释放租约，再清理 Cookie（最多等待 3 秒，不阻塞界面）。
- 断线恢复后不自动接管，但本会话仍拥有的服务端租约不再被误标为「其他窗口接管中」，用户可主动重新接管。
- 删除正常预览时每 4 秒的重复截图轮询，仅保留呈现切换时的占位快照；稳定状态下账号/电脑查询降低至 15 秒，操作进行中仍为 3 秒；布局观察合并到每帧一次。

保留现有认证和安全隔离设计，也保留客户端的导航、资料页与聊天布局。未改远端页面，未加入新的全局主题或布局规则。断网或进程被强制结束时，服务端租约最终仍依赖自身超时释放。
