# React 界面结构

桌面和完整聊天页均由 React 19 渲染。一级目录按业务大模块划分，模块内再按
`components / models / hooks / services / lib` 分类；只有实际存在对应代码时才创建目录。

```text
renderer/
├─ main.tsx                 桌面 React 入口
├─ index.html               桌面 HTML 挂载点
├─ app/                     全局布局、导航、设置及跨页面协调
│  ├─ page.tsx
│  ├─ components/           顶栏、设置、搜索、场景面板、诊断
│  ├─ models/               应用状态、跨页面工作场景
│  ├─ hooks/                桌面与聊天的通信
│  ├─ services/             文件能力与附件预览通信
│  ├─ lib/                  CSV/XLSX 解析与预览数据规则
│  ├─ styles.scss           桌面文档样式入口
│  └─ styles/               按领域拆分的全局 SCSS
├─ chat/                    独立聊天页
│  ├─ main.tsx / page.tsx
│  ├─ components/           消息、过程、导航、设置和说明面板
│  ├─ models/               消息、附件、过程状态与协议类型
│  ├─ hooks/                会话生命周期
│  ├─ services/             流式请求、重试、重放、frame 通信
│  ├─ document.scss         桌面与 Web 聊天共享样式入口
│  ├─ styles.scss           聊天领域样式编排
│  └─ styles/               消息、附件、智能 UI 等 SCSS 分区
├─ town/                    小镇、篝火、围炉、私信、阅读及 Kit
│  ├─ page.tsx
│  ├─ components/           身份、发送、内容阅读和安装面板
│  └─ models/               Town 状态、请求协调和消息筛选
├─ plugins/                插件页面、独立窗口与宿主 UI 协作
├─ preview/                隔离的 PPTX 预览运行时
├─ portal/page.tsx          本机 Portal 页面
├─ browser/                内置浏览器页面及 hooks/ 分栏交互
└─ shared/                 跨功能复用
   ├─ icons/               统一 SVG 目录与图标预设
   ├─ components/          图标按钮、弹窗、Markdown 与代码高亮
   ├─ services/            本地文件可用性与远程图片通信
   ├─ models/              状态订阅基类、共享场景数据
   ├─ hooks/               React 状态订阅
   ├─ intelligent-ui/      智能 UI 协议、组件、状态与隔离运行时
   └─ lib/                 导航、消息时间、文件大小、权限选项与文本解析
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
- 文档入口保留全局样式和既有级联顺序；新增或迁移组件使用就近的
  `*.module.scss`，由组件直接导入。主题变量、作用域及构建约定见[样式规范](STYLING.md)。

图标、公共组件、纯函数和通信模块的具体用法见 [公共模块说明](shared/README.md)。
新图标使用 `shared/icons/`；单次使用的逻辑就近保留，外部输入只在边界校验。

## React 与聊天协议

根目录 `loom.html` 只包含挂载点和本地资源引用。`chat/main.tsx` 挂载 React，
`scripts/build-chat.mjs` 编译聊天资源，桌面准备脚本将它们纳入安装包。

`chat/services/runtime.ts` 保留 Loom 流式、重试、重放、watchdog 和历史对账协议，
更新领域对象，不创建或修改界面节点。`chat/models/chat.ts` 中的 `ChatRuntime` 与
`RuntimeOptions` 定义 UI 契约；`chat/services/scene-runtime.ts` 统一管理跨场景发送队列，
`chat/services/scene-queue.ts` 负责队列持久化，`chat/hooks/use-chat-session.ts` 统一释放请求、计时器和订阅。

`app/hooks/use-chat-bridge.ts` 与 `chat/services/bridge.ts` 校验通信来源、frame 和版本。
聊天 iframe 在页面切换时保持挂载，保留草稿和流式状态；它没有 preload、Node、本机
IPC，也不通过桌面 URL 接收凭据。主进程、preload 和 Rust Portal 的 API 契约独立于 React。

Markdown 和高亮 token 直接渲染为 React 元素，不使用 HTML 注入。界面内容和可见性
由 React 状态控制；DOM 引用用于焦点、滚动、选区、输入框尺寸、原生 dialog 和浏览器
位置测量。

## 验证

`npm run typecheck`（含未使用声明检查）、`npm test` 检查类型、状态及模块依赖边界；
`npm run test:chat-react` 验证完整聊天页；`npm run test:sbs-refresh`、
`npm run test:town-names`、`npm run test:seed-garden` 验证功能之间的界面联动。
桌面检查见[测试说明](../TESTING.md)，进程划分见[桌面目录说明](../README.md)。
