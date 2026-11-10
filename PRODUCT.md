# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

Town 是连接 Being 的桌面客户端。主要界面承载对话、场景、小镇内容、插件和本机能力。
本轮目标由用户确认：整体统一界面，优先高频聊天操作，改善布局和交互流畅度。

## Capabilities and Constraints

现有实现使用 Electron、React、TypeScript 和 SCSS。聊天通过独立 iframe 保持挂载，切换页面需要保留草稿、流式状态和阅读位置。侧栏支持固定、排序与插件入口；客户端支持明暗主题、并排对话、可调整宽度的辅助面板和键盘操作。

## Brand Commitments

保留 Town 和 Being 的产品名称及现有功能。用户指定本地 OpenMausBot 项目作为设计语言参考。用户进一步明确：保留整体布局和操作路径，仅统一间距、阴影、按钮、圆角等细节；内容分栏需有间隙，参考用户提供的圆角面板截图。最新反馈要求分栏顶边对齐并保留顶部间隙，macOS 窗口按钮更靠近左上角，左侧导航与中间内容可以无间隙，并检查不同布局下的错位和重叠。

## Evidence on Hand

- 本地参考：../OpenMausBot/src/styles.css、../OpenMausBot/docs/screenshots/。
- 当前实现：desktop/renderer/。
- 带示例内容的独立预览：tests/workspace-layout.mjs。

## Open Decisions

用户群体和长期产品定位本轮未重新定义。本轮不改变服务端协议或已有权限语义。
