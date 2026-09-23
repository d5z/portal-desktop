# 客户端 Portal 调用排查

## Windows 启动与旧实例

客户端始终使用安装包内的 `heart-portal.exe`；后台模式运行的是其校验过的副本。
Windows PowerShell、cmd 和进程清理命令按系统目录解析，客户端及后台守护也会为
子进程补齐 System32、Wbem 和 Windows PowerShell 路径，不必修改用户的系统 PATH。

`Config file not found: status` 表示被探测的旧引擎把状态命令当成配置路径。
已确认的旧客户端计划任务直接通过该任务停止，随后启动客户端内置 Portal。
无法确认管理方式的独立旧实例会显示其路径；先通过原管理方式停止，再点击
「启动 Portal」。客户端不会只按进程名结束不明实例。

后台状态查询失败时，客户端仍会打开，可在 Portal 页面查看错误并重试。
界面只显示简短提示，PowerShell、CLIXML 和异常堆栈写入客户端配置目录的
`logs/client-errors.log`（凭据脱敏，轮转保留一份历史日志）。进入
「设置 → Portal 运行状态」，点击「打开日志文件夹」可查看详细原因。
打开时会生成 `portal-runtime.log` 和 `portal-status.json`，汇总当前运行日志与状态；
没有错误或运行输出时也会写入说明，日志目录不会为空。
「一起看日志」会在现有「一起看」面板中预览最近的脱敏错误、运行输出和状态，
点击「放入对话」后形成带出处的引用草稿，再由你点击发送。
输入框已有草稿或附件时，会保留原内容并提示先处理；预览和放入对话均不会自动发送。

若系统 `appData` 路径在启动时不可用，客户端会显示简短提示后退出，详细错误
写入系统临时目录的 `portal-desktop-startup/logs/client-errors.log`。
显式设置 `PORTAL_DESKTOP_USER_DATA` 时使用该目录，也不会自动导入全局 Portal 配置。

## 截图与文件路径

客户端默认提供截图能力，不增加单独的截图开关。调用顺序：

1. `portal_screenshot`，例如 `{"path":".screenshots/check.png","region":"full"}`。
2. 将返回的相对路径交给 `portal_file_read` 查看图片。

Windows 支持主屏幕或 `x,y,w,h` 矩形截图；不要传 `display` 或 `region:"window"`。
工作目录若是 `E:\heart-workspace`，返回的 `.screenshots/check.png` 位于该目录中。
工作目录外的 `C:\...` 被拒绝属于文件访问边界，不应通过扩大到磁盘根目录解决。

沿用外部配置时，截图权限由该文件的 `[tools] screenshot` 决定；修改后重启 Portal。
升级会刷新未改动的客户端默认配置，保留旧配置文件；导入或自定义的配置保持原样。

## 命令与后台会话

「允许命令执行」与「启用 Kits 与自定义工具」在新配置中默认开启。
改动后点击「保存、连接并启动」，客户端会重启自己管理的 Portal，使设置生效。
沿用已有 TOML 时，这两个开关同样可用；通过启动参数覆盖对应选项，
原文件中的工作目录、安全策略、工具配置与注释保持不变。

Windows PowerShell 使用 `portal_exec` 的 `shell:"powershell"`，直接传脚本：

```json
{"shell":"powershell","command":"Write-Output '中文命令成功'"}
```

不要在默认 `cmd` shell 中再调用 `powershell -Command "..."`。Portal 会拒绝
这种形状，并返回 `PowerShell commands require shell='powershell'; pass the
script directly`；这条错误同时给出了修复方式。Portal 负责解码
`portal_exec`/`portal_process` 自己启动的子进程管道；Kit 如果内部再启动
子进程，应在 Kit 内解码该管道，并向 Portal 输出有效 UTF-8 MCP JSON
和结构化错误。

Windows `cmd` 的默认 `output_encoding:"auto"` 逐行优先识别 UTF-8，
否则按系统 OEM 代码页解码；PowerShell 则固定为 UTF-8。只有已知
子进程输出编码时才显式指定 `utf8` 或 `oem`，不要用统一强制
UTF-8 替代 Windows OEM 兼容。

长任务设置 `background:true`，再用 `portal_process` 的 `list/poll/log/write/kill`
管理对应 `session_id`。以当前 Portal 返回的 `tools/list` 为准。
`desktop_terminal_*` 不属于本仓库内置工具；若这些扩展工具异常，排查其提供方和
完整报错。Portal 自身的命令与后台会话通路可独立验证。

## 回归验证

- `npm test`：包含缺失 PATH、旧实例发现、配置升级和客户端启动失败恢复。
- `npm run build:portal` 后运行 `npx vitest run tests/portal-tools-native.test.ts`：
  Windows 本地 relay 验证内置引擎摘要、中文 PowerShell、CP936 `cmd`（在
  OEM 936 主机上）、嵌套 PowerShell 拒绝提示、后台输入、截图与文件读取。
  默认验证 `resources/heart-portal.exe`；开发时该文件被运行中的 Portal 占用，
  可设置 `PORTAL_TOOLS_TEST_BINARY` 指向刚编译的 release 二进制。
  使用临时工作目录和 24×24 像素截图，完成后清理，不连接真实 Being。
- `npm run package`：编译并打包配套客户端和 Portal。
