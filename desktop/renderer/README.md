# React 界面结构

桌面和完整聊天页均由 React 19 渲染。一级目录按业务大模块划分，模块内再按
`components / models / hooks` 分类；只有实际存在对应代码时才创建目录。

```text
renderer/
├─ main.tsx                 桌面 React 入口
├─ index.html               桌面 HTML 挂载点
├─ app/                     全局布局、导航、设置及跨页面协调
│  ├─ page.tsx
│  ├─ components/           顶栏、设置、搜索、场景面板、诊断
│  ├─ models/               应用状态、跨页面工作场景
│  ├─ hooks/                桌面与聊天的通信
│  └─ styles.css            桌面文档样式入口
├─ chat/                    独立聊天页
│  ├─ main.tsx / page.tsx
│  ├─ components/           消息、过程、导航、设置和说明面板
│  ├─ models/               消息、附件、过程状态与协议类型
│  ├─ hooks/                会话生命周期
│  ├─ services/             流式请求、重试、重放、frame 通信
│  └─ styles.css            聊天文档样式入口
├─ town/                    小镇、篝火、围炉、私信、阅读及 Kit
│  ├─ page.tsx
│  ├─ components/           身份、发送、内容阅读和安装面板
│  └─ models/               Town 状态、请求协调和消息筛选
├─ portal/page.tsx          本机 Portal 页面
├─ browser/                内置浏览器页面及 hooks/ 分栏交互
└─ shared/                 跨功能复用
   ├─ components/          弹窗、Markdown 与代码高亮
   ├─ models/              状态订阅基类、共享场景数据
   ├─ hooks/               React 状态订阅
   └─ lib/                 导航解析等纯函数
```

## 依赖与文件约定

- `page.tsx` 组合当前模块的组件；`components/` 负责 JSX 与表单，`models/` 负责
  状态和业务规则，`hooks/` 负责 React 生命周期。协议实现放 `services/`，不混入 JSX。
- 在功能模块内就近修改代码，不创建全局业务 `components / models / hooks`。
  紧密相关的小组件可以放同一文件；不为单个组件继续嵌套目录。
- `app/` 组合页面并协调跨模块动作。`shared/` 不依赖具体功能页面或业务模型。
  模型不导入组件和 hooks，避免状态依赖 UI。
- 页面只通过 preload 暴露的 `window.beings` 调用本机能力；跨进程契约在
  `desktop/shared/types.ts`。禁止 renderer 导入 `main/`、`preload/`、Electron 或 Node。
- 文件名省略目录已表达的模块前缀。使用明确的相对导入，不添加转发用 `index.ts`
  或旧路径兼容层。
- 两个独立文档各有一个样式入口，保留既有级联顺序，避免零散覆盖文件相互依赖。

## React 与聊天协议

根目录 `loom.html` 只包含挂载点和本地资源引用。`chat/main.tsx` 挂载 React，
`scripts/build-chat.mjs` 编译聊天资源，桌面准备脚本将它们纳入安装包。

`chat/services/runtime.ts` 保留 Loom 流式、重试、重放、watchdog 和历史对账协议，
更新领域对象，不创建或修改界面节点。`chat/models/chat.ts` 与 `runtime.d.ts`
定义 UI 契约，`hooks/use-chat-session.ts` 统一释放请求、计时器和订阅。

`app/hooks/use-chat-bridge.ts` 与 `chat/services/bridge.ts` 校验通信来源、frame 和版本。
聊天 iframe 在页面切换时保持挂载，保留草稿和流式状态；它没有 preload、Node、本机
IPC，也不通过桌面 URL 接收凭据。主进程、preload 和 Rust Portal 的 API 契约独立于 React。

Markdown 和高亮 token 直接渲染为 React 元素，不使用 HTML 注入。界面内容和可见性
由 React 状态控制；DOM 引用用于焦点、滚动、选区、输入框尺寸、原生 dialog 和浏览器
位置测量。

## 验证

`npm run typecheck`、`npm test` 检查类型、状态及模块依赖边界；
`npm run test:chat-react` 验证完整聊天页；`npm run test:sbs-refresh`、
`npm run test:town-names`、`npm run test:seed-garden` 验证功能之间的界面联动。
桌面检查见[测试说明](../TESTING.md)，进程划分见[桌面目录说明](../README.md)。
