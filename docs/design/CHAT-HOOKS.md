# 对话流事件与 Hooks 整理

2026-10-30。范围是 React 对话流及其共用右键菜单；保留已有消息窗口化、ResizeObserver 阅读补偿、流式更新和 Muse UI。

## 选型

检查 npm 发布版本、React peer 兼容范围和官方实现后，选择 **ahooks 3.11.0**，按 `ahooks/es/<hook>` 路径导入；不叠加多个 Hooks 库。

| 候选 | 本项目取舍 |
| --- | --- |
| [ahooks useEventListener](https://ahooks.js.org/hooks/use-event-listener/) | 已采用。支持 enable、动态 ref/getter 目标、最新回调和成对清理；满足菜单与拖拽仅激活期间监听的需求。另使用 useMemoizedFn、useRafState、useUnmount。 |
| [usehooks-ts](https://usehooks-ts.com/react-hook/use-event-listener) 3.1.1 | 类型清晰，但该监听接口没有直接的 enable 参数；本项目需要额外封装启停行为，未同时引入。 |
| [ReactUse](https://reactuse.com/changelog/) / @reactuses/core 6.6.1 | 同类候选，未与 ahooks 重复引入。 |
| [es-toolkit](https://es-toolkit.dev/intro.html) 1.53.0 | 通用工具候选。本轮热点是 DOM 生命周期与逐帧更新，没有需要通用数组/对象工具库解决的重复算法，因此未为简单操作增加依赖。 |
| [eslint-plugin-react-hooks](https://react.dev/reference/eslint-plugin-react-hooks) 7.1.1 | 已加入开发检查，启用 rules-of-hooks、exhaustive-deps；同时禁止当前交互层从 ahooks 根入口导入。 |

研究来源还包括 [ahooks 官方实现](https://github.com/alibaba/hooks/blob/master/packages/hooks/src/useEventListener/index.ts)。库负责 DOM 订阅，不替代组件业务边界。普通点击、粘贴、拖拽入口继续用 React 事件；异步会话由 useChatSession 管理。

## 当前事件所有权

- `useChatViewport`：窗口与 VisualViewport 合并成每帧一次状态更新，尺寸不变时复用原状态；卸载取消未执行的帧。VisualViewport 和 MediaQueryList 不在 ahooks 的 DOM target 类型范围内，保留局部、完整清理的原生 Effect。
- `useChatShortcuts`：一个 document capture 订阅处理搜索、设置、插件和选区添加；选区变化只更新回调，不重绑快捷键；忽略 IME 合成事件。
- `useMessageSelection`：限定消息正文的选区，保留纯文字追加、草稿和附件；输入框聚焦帧统一取消及卸载清理。
- `useFileDrop`：聊天根元素拥有文件拖拽入口；全局恢复监听只在拖拽中存在，场景/范围切换和取消会复位。
- `useMenuDismiss`：编辑菜单、消息菜单共用关闭监听，关闭时无监听，回调变化不重绑。滚动是否移动目标仍由各菜单判断，避免输入框滚动误关菜单。关闭回调不透传 Event，避免误作为“恢复焦点”参数。
- `useMessageScroll`：键盘订阅与尺寸观察分开；保持同步的 ResizeObserver 阅读补偿。聊天索引的监听不随每次消息变化销毁重建，当前回调读取最新索引；用户标题快照由完整 JSON 编码缓存，避免遗漏 useMemo 依赖和手工分隔符碰撞。
- 主页面补齐 Effect 依赖，切换范围使用稳定回调，避免为通过 lint 而导致会话反复启动。没有添加 lint 禁用注释。

## 验证与实测

- `npm run lint:chat-hooks`、`npm run typecheck`、`npm run build:chat` 通过。lint 范围是聊天主页面、全部聊天 hooks、导航、两个菜单和共用关闭 hook，不代表整个仓库已完成 lint。
- `npm run test:chat-hooks`：实际 Hook 在 React StrictMode 下挂载；验证连续 20 次回调变化不重绑、读取最新值、目标切换、菜单/拖拽清理、重复挂载卸载，以及等待执行的动画帧取消。50 次不变视口事件不提交新状态，50 次变化事件合并一次并保留最终尺寸。测试先记录 Playwright 自身监听，避免把测试框架监听误判为泄漏。
- `chat-message-flow`、`chat-react`、`chat-scroll`、`chat-history-window`、隔离 Electron 的 `chat-context-menu` 通过；滚动/历史/流式相关 46 项单元测试通过。
- Hooks lint 和生命周期回归加入 `test:all`。新增 ESLint 10 的 Node 要求为 `^20.19.0 || ^22.13.0 || >=24`；项目 Node 22 开发环境请使用 22.13+，现有 CI 的 Node 22 最新版本满足。

同机 Chrome 受控流式 fixture，本轮改动前后各采样一次：

| 指标 | 改前 | 改后 |
| --- | ---: | ---: |
| 帧间隔 P95 | 17.0 ms | 17.7 ms |
| 消息几何读取次数 | 1624 | 1624 |
| 最大 long task | 0 ms | 0 ms |
| 挂载消息 | 41 | 41 |
| chat.js gzip | 446402 B | 447234 B |

这次收益主要是减少无效视口更新、监听重绑和重复清理代码；上述采样没有显示流式帧率提升，也不能证明原生窗口拖动问题已全部解决。ESBuild metafile 检查确认聊天产物未引入 lodash、dayjs、js-cookie 或 screenfull；ahooks 模块贡献约 2.1 KB（压缩前的 minified JS），整个聊天包 gzip 净增加 832 B。依赖安装目录大小不等于实际前端加载体积。
