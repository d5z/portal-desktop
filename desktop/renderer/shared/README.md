# Renderer 公共模块

公共层只依赖自身、`desktop/shared` 协议和第三方库；不反向导入 app、chat、town、portal、plugins。
功能目录中的单次使用逻辑留在原处，出现相同职责的复用时再提取。

| 目录 | 职责 | 示例 |
| --- | --- | --- |
| `icons/` | 静态图形和已有的图标样式预设 | `Icon`、`NavigationIcon`、`PermissionIcon` |
| `components/` | React UI、组件样式及上下文 | `IconButton`、`Dialog`、`ContextMenu`、`SettingsSurface`、`Markdown` |
| `hooks/` | 多处复用的 React 生命周期和交互 | `useMenuDismiss`、`useNearViewport` |
| `lib/` | 无 React 生命周期和通信副作用的函数、配置 | `formatBytes`、消息时间、权限选项、Markdown 增量解析、键盘导航 |
| `services/` | 浏览器通信及资源请求 | 本地文件可用性、远程图片桥接 |
| `models/` | 可订阅的状态和共享状态模型 | `Store`、`SceneModel` |
| `styles/` | 多页面使用的 SCSS | 编辑器、输入区、阅读排版 |
| `intelligent-ui/` | 自成体系的交互内容运行时 | 见该目录 README |

直接导入具体文件，不建立统一导出所有模块的 `index.ts`。
app 专有的文件桥接在 `app/services/`，CSV/XLSX 数据处理在 `app/lib/`，预览 UI 留在 `app/components/`。

## 图标

```tsx
import { Icon } from '../shared/icons/icon';
import { IconButton } from '../shared/components/icon-button';

<IconButton label="关闭预览" onClick={close}>
  <Icon name="close" width={18} height={18} fill="none" stroke="currentColor" />
</IconButton>
```

`icon.tsx` 集中维护几何形状与 viewBox，`IconName` 从目录推导；调用方保留原有尺寸、颜色和 CSS 钩子。
导航、Web、权限、聊天活动和输入菜单的预设只负责已存在的重复样式，不含业务状态或请求。
新增图标先查现有名称；相同图形复用，确有视觉差别的变体保留独立名称。
图标默认是装饰内容，可访问名称放在按钮或外层语义元素上。

电脑状态动画和数据图表依赖动态绘图，保留在所属组件；插件自带图片仍由插件图标加载器处理。

## 校验边界

IPC、postMessage、网络响应、持久化数据在进入系统时校验；内部使用类型传递，不逐层重复检查。
例如 Portal 设置由 `main/portal/ipc.ts` 校验后交给控制器和安装函数。
不增加推测性的兜底、重试或异常吞并；已有的实际错误处理随功能保留。
