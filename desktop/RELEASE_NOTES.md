# Portal Desktop 0.1.16 更新

修复历史回复变成空白气泡的问题。本机缓存与 history 按消息序号合并，接口返回空正文或暂时不可用时保留本机已有正文；只有两边都没有正文时才显示明确提示，并支持重新读取单条消息。

完善 Home 连接器与本机 Kit 的安装、授权、配置及状态刷新，改进独立 subagent 模型配置和 Portal 运行稳定性。

修复侧栏切换时已关闭面板意外重新占位的问题，完善场景列表、消息定位、附件与设置的回归验证。

修复 Windows 内置 Node 构建补丁的换行兼容问题，并统一使用内置运行时验证沙箱行为。

提供 macOS Apple Silicon、macOS Intel 和 Windows x64 安装包，均内置配套 Heart Portal。
