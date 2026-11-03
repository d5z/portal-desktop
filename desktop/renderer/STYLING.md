# React 样式规范

Desktop、聊天页、Web 和插件适配层的自有样式统一使用 **SCSS**。
组件私有样式使用 **CSS Modules**；文档主题、跨组件布局、生成内容和插件接口
使用按领域拆分的全局 SCSS。第三方包与构建产物继续由各自的构建流程管理。

## 目录与入口

| 入口或目录 | 职责 |
| --- | --- |
| `app/styles.scss` | 桌面文档入口，只编排 `@use` |
| `app/styles/` | 主题、表单、工作区、设置、Town、文件预览等领域样式 |
| `chat/document.scss` | 桌面聊天与 Web 聊天共享的完整文档入口 |
| `chat/styles.scss`、`chat/styles/` | 聊天主题、消息、活动、附件、媒体、智能 UI 等领域样式 |
| `shared/styles/` | 字体、交互、时间分组、模型设置、编辑器内容、代码阅读和输入菜单 |
| `web/styles.scss`、`web/chat.scss` | Web 容器与聊天的适配入口 |
| `web/styles/` | Web 主题、导航、页面、设置、响应式及聊天适配 |
| `plugins/dsh/styles.scss` | DSH 宿主与第三方插件的公共样式边界 |
| `plugins/dsh/tokens.scss` | 带上游来源与许可证的 DSH 语义变量 |
| `**/*.module.scss` | 由 React 组件直接导入的私有样式 |

入口按既定顺序组合 partial，避免拆文件时改变级联优先级。主题值集中在各入口的
`_tokens.scss` 中；Web 聊天单独使用 `_chat-tokens.scss`。调整样式时修改所属分区，
不在入口底部堆叠补丁。响应式和状态覆盖保留必要的优先级。

## 组件作用域

- 组件与模块就近放置，如 `copy-message.tsx` / `copy-message.module.scss`。
- 使用 `import styles from './copy-message.module.scss'` 与 `className={styles.button}`；
  模块类名用 camelCase，条件组合使用已有的 `clsx`。
- 全局领域类使用有含义的前缀与 kebab-case。已有 DOM ID、生成内容、编辑器 token
  和插件契约保持稳定，供多个 React 子组件及外部渲染器协作。
- 不引用 CSS Modules 生成的类名。跨组件尺寸、外观通过 props 或明确的 slot 表达。
- 只有动态位置、缩放、尺寸等运行时数值保留在 React `style` 中。
- `:global(...)` 必须指向明确的公共接口，并位于局部容器下；不要把整个模块包成 global。
- 组件模块只输出自身规则。共享文档样式只在入口中 `@use`，避免组件和入口各编译一份。

```tsx
import styles from './example.module.scss';

export function Example() {
  return <button className={styles.trigger}>打开</button>;
}
```

```scss
@use '../styles/mixins';

.trigger {
  color: var(--text);

  &:focus-visible {
    @include mixins.focus-ring;
  }
}
```

已模块化的共享界面包括：`SbsControl`、`RemoteImage`、`ImageViewer`、
`PermissionPicker`、`PermissionSettings`、`ToolApprovalDialog`、`EditContextMenu`、
`useMessageMenu`、`CopyMessage`、`NavigationControls`、`RichComposer`、
`PanelResizeHandle`、`PluginIcon`/`PluginIconEditor` 和 `IntelligentUIExamples`。

## 公共接口

- `EditContextMenu`、`NavigationControls` 使用 `appearance="chat"` 选择聊天配色。
- `CopyMessage` 默认紧凑尺寸，聊天气泡使用 `appearance="chat"`。消息容器添加
  `data-copy-group` 触发悬停和焦点显示；触摸设备直接显示。避免嵌套复制组。
- `data-slot="image-thumbnail"` 供生成图片和智能 UI 容器设置缩略图布局。
- `data-slot="navigation-controls"` 允许 Web 容器控制导航可见性。
- `data-slot="panel-resize-handle"` 供宿主处理窄屏隐藏和边框反馈，手柄自身外观在模块中。
- `RichComposer` 暴露 `rich-composer`、`composer-format`、`composer-editor`、
  `composer-highlight` slots；代码高亮及测试通过 slot 接口访问，不依赖模块类名。
- 示例面板、插件图标预览分别暴露 `ui-examples-panel`、`plugin-icon-preview` slots。
- `ImageViewer` 的下载动作仍接收公共 `attachment-download` 类；审批按钮复用
  `primary` 与 `form-error` 约定。这些接口在模块中通过显式 `:global(...)` 对接。

## 复用与主题

- 主题颜色使用 `var(--text)`、`var(--bg)`、`var(--accent)` 等 CSS 变量，保留运行时
  明暗模式与插件主题切换；不要改成编译期 Sass 色值。
- 共用 mixin 位于 `shared/styles/_mixins.scss`，使用 `@use` 显式导入。
  partial 不通过 JS 重复导入；避免 Sass `@import`、`@extend` 和深层嵌套。
- 嵌套最多 3 层，状态优先用 `:hover`、`:focus-visible`、`aria-*` 和 `data-*`。
- 菜单动画使用 `mixins.menu-enter`；各模块隔离动画名，并遵循减少动态效果设置。
- 相同的公共规则只有一个来源，例如焦点行为在 `interaction.scss`，消息时间行在
  `message-flow.scss`。不同主题、媒体条件或状态的覆盖可以重复选择器，不能复制整个规则块。

## 格式、检查与构建

Prettier 负责统一缩进、换行、引号与源码可读性；Stylelint 负责 SCSS、命名及嵌套规范。
检查覆盖全部自有 SCSS，不再排除旧业务样式。上游 DSH 字体变量中的 CSS 斜杠语法
有明确的局部 lint 配置，保留其来源与许可。

`scripts/check-styles.mjs` 编译所有文档入口与组件模块，拒绝新增普通 CSS 源文件、
旧式 `@import`、没有入口归属的孤立文件，以及相同条件下完全相同的规则块；新增文档入口
须登记到该脚本的 `styleEntries`。媒体查询、supports 和动画名称
属于比较条件，不会把合法的变体当成重复。检查已接入单元测试与 `test:all`。

```sh
npm run format:styles
npm run format:styles:check
npm run lint:styles
npm run check:styles
npm run typecheck
npx vitest run tests/styles-build.test.ts
npm run build:chat
npm run build:web
npx vite build --config vite.renderer.config.ts
npm run test:web-styles
```

Vite 原生识别 `.module.scss`，TypeScript 使用 `vite/client` 的模块声明。
独立聊天页与 esbuild UI fixtures 统一使用 `scripts/renderer-build.mjs`；
`esbuild-sass-plugin` 固定为与 esbuild 0.25 兼容的 3.3.1。

Fixture 必须提供 `outfile`/`outdir` 并加载同一次构建输出的 CSS；
`tests/support/shell-styles.mjs` 提供已编译的主界面样式。不能把 SCSS 源文件作为
浏览器 stylesheet 直接加载，也不能用第二次 CSS 构建覆盖带模块映射的样式产物。
测试优先使用 role、accessible name 或上述公开 slots。
