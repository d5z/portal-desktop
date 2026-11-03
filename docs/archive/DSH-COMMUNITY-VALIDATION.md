# DSH 社区插件验收记录

本页于 2026-11-03 从提交 `8edcac2` 的兼容说明迁出，保留原有版本、验证范围与限制；原记录未注明测试日期，本次整理未重新执行这些社区插件验收。当前能力和复现命令见 [DSH 插件兼容层](../../plugins/DSH-COMPATIBILITY.md)。

对照基线：DSH 0.2.1-rc.5，源码 commit `b830ec950faba0a46dda564be3e2d854afed94f1`。

社区插件源码保持原样，在临时测试用户目录安装，不发送 Being 消息。

| 插件 | 版本 / commit | 验证 |
| --- | --- | --- |
| [dsh-boot-suite](https://github.com/LeeRolling/dsh-boot-suite) | 2.15.17 / `418bb180ea4aa46855a459b7c8563bcbfc7e2a53` | 同页安装后全屏启动、授权、身份确认、自然结束；连续安装不重播、不重复注入壁纸；原生设置、模板编辑器、预览/SKIP、Town/Being 壁纸、停用与卸载。 |
| [dsh-theme-native](https://github.com/BarneyZhaoooo/dsh-theme-native) | 0.1.2 / `faaf3a8edb9b5625ac46ea11df081600ff6d036a` | 同页安装即时加载、原生主题设置页、主题 token 注册，与另外两款插件共存。未覆盖所有自定义字体。 |
| [dsh-vscode-themes2](https://github.com/zxbc/dsh-vscode-themes2) | 1.1.0 / `cd60561fffbebc5900aa04a5cdf64685c8eee679` | 同页安装后的内置主题列表、Dracula 即时应用及偏好写入；不代表市场联网搜索/下载已全测。 |
| [dsh-pomodoro](https://github.com/causebefore/dsh-pomodoro) | 0.5.5 / `33c4491059f929b19006624fa74574a459213579` | 同页安装后原生设置将 25 分钟改为 7 分钟并持久化；侧栏入口、浮层、开始/暂停；浏览器通知权限随 Town 开关。Computer Use 实际验证倒计时、暂停和迷你模式。未验证 OS 提醒最终送达。 |

原版 boot-suite 在跳过/移除播放媒体时仍观察到未处理的 `AbortError`；未修改原插件或吞掉错误，页面退出与恢复通过。其联网更新、所有媒体/音色和系统文件夹打开等功能不在本次验证范围内。
