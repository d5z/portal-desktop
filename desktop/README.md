# 桌面代码目录

Portal Desktop 包含 Electron 主进程、隔离的 preload 和 React 界面。源码按进程和功能组织如下。

```text
desktop/
├─ main/                    Electron 主进程及本机能力
│  ├─ main.ts               ready 前身份、协议声明、单实例与安装控制入口
│  ├─ app/                  bootstrap 服务组合、生命周期、可信 IPC、配置与本机窗口
│  ├─ chat/                 Being 连接解析、就绪检查、受限聊天代理
│  ├─ portal/               Rust 子进程、后台守护、旧服务发现与接管、状态读取
│  ├─ town/                 Town REST、配对凭据、SSE 和 IPC
│  ├─ plugins/              插件安装、权限、私有存储与宿主调用
│  ├─ kits/                 Kit 清单、导入安装和 IPC
│  ├─ browser/              原生 WebContentsView、会话和 URL 规则
│  └─ updates/              版本检查、引擎升级、客户端安装与签名校验
├─ preload/preload.ts       固定的 IPC 白名单，向顶层页面提供 window.beings
├─ shared/                  跨进程类型契约和纯身份规则，不含 Electron/Node 实现
├─ renderer/                React 页面，按大模块再分 components/models/hooks
├─ generated/               自动生成的聊天静态资源，不手工编辑或提交
├─ macos-signing.json        macOS 构建签名配置
└─ windows-installer.json    Windows NSIS 安装身份配置
```

`main/` 处理进程、文件系统、凭据和系统 API；`renderer/` 处理可见界面、表单及页面状态。
两者只通过 `preload/` 的固定接口与 `shared/types.ts` 契约协作，不互相导入实现。
聊天 iframe 另通过受限 `beings://chat/api/*` 代理和校验后的 `postMessage` 通信。
共享目录只保留平台无关的类型和纯函数。

根目录的 `forge.config.ts`、`vite.*.config.ts`、`tsconfig.json` 是打包、编译和类型检查配置，
按工具约定保留在根目录。构建入口由 `forge.config.ts` 明确指定；源目录的改变不改变安装包内的
`main.js`、`preload.js` 或本地资源 URL。`scripts/runtime-bundle.mjs` 从 Portal 模块
读取守护源码，保持运行时升级清单与实际构建一致。

- [主进程模块边界](main/README.md)：启动顺序、状态所有权及功能接入规则。
- [React 界面结构](renderer/README.md)：业务模块及二级目录规范。
- [界面公共模块](renderer/shared/README.md)：图标、公共组件、纯函数及通信边界。
- [桌面架构](ARCHITECTURE.md)：运行路径与信任边界。
- [构建说明](BUILDING.md)、[测试说明](TESTING.md)：构建和验证入口。

完整文档分类见[文档导航](../docs/README.md)。设计提案集中在 `docs/design/`，历史核查与验收集中在 `docs/archive/`。
