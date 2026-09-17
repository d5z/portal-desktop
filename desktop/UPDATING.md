# 客户端与 Portal 配套更新

## 用户操作

macOS 首次安装：Apple Silicon 从正式 Release 下载 `portal-desktop-<版本>-macos-arm64.dmg`，Intel 下载 `portal-desktop-<版本>-macos-x64.dmg`。打开后将 Portal Desktop 拖入 Applications，推出磁盘映像，再打开安装后的应用。同一 Release 同时提供对应架构的升级 ZIP，DMG 与 ZIP 包含同一个已签名应用和配套 Portal。已有旧版但尚无升级入口时，退出后通过 DMG 替换应用即可，保留用户配置目录。

菜单“检查更新”读取正式发布版本；客户端启动及每 6 小时检查一次。只有对应系统、架构的安装包和校验清单均已上传，才提示可安装更新。发布信息读取失败不会阻断聊天或 Portal。用户点击“下载并升级”后从固定 GitHub 正式发布地址下载平台安装包，并校验发布摘要。自动检测不会自动安装。

新版下载窗口显示读取更新信息、下载、校验和暂存步骤；已知安装包大小时显示已下载字节数、总大小与百分比，未知大小时显示已下载字节数。下载和暂存期间可以取消，清理本次临时文件且不停止 Portal。确认安装后才停止服务并交给独立安装器。

### Windows 0.1.1 的首次迁移

正式发布的 0.1.1 使用 Squirrel。其安装助手通过 Node `detached` 启动 PowerShell，在 Windows 上可能在脚本执行前退出，表现为下载完成、确认后客户端退出，但安装器不出现且 `client-updates/<id>/install.log` 为空。旧脚本还使用 `--silent` 和 Squirrel `Update.exe` 启动已安装应用，不能作为新 NSIS 安装器的升级契约。新版中的安装助手修复不会反向替换正在运行的 0.1.1 升级器。

从 0.1.1 迁移时，请先在旧客户端菜单选择“退出客户端”，再手动运行正式 Release 的 Windows Setup；已下载且校验通过的 `client-updates/<id>/portal-desktop-<版本>-windows-x64-Setup.exe` 也可使用。安装后从新的 Portal Desktop 快捷方式启动。不要删除 `%APPDATA%/Beings` 或连接配置；新版会沿用旧 profile。旧 Squirrel 的应用目录或固定快捷方式可能仍存在，启动后应检查实际客户端版本。

发布版本已接续 0.1.1 重新从 0.1.2 编号，累计改动保留。此前已安装 0.1.9 的用户需退出后手动安装当前正式版本；更新检查按版本号比较，不会自动把较低版本作为升级推送。

macOS 更新流程读取 GitHub `releases/latest`，使用 `vX.Y.Z` 正式 tag 下的 `portal-desktop-X.Y.Z-macos-<arch>.zip` 与 `SHA256SUMS.txt`；`<arch>` 按当前客户端架构选择 `arm64` 或 `x64`，不会拿另一架构的包替代。DMG 不用于运行中的应用替换。草稿、预发布、缺失升级 ZIP 或校验清单均不提供安装。正常升级不要求用户重新填写 Being 连接。

先结束本机任务并保存聊天草稿。安装包下载、摘要校验及 macOS 应用暂存完成后，用户点击“停止 Portal 并安装”。客户端先持久保存原运行记录，停用并确认客户端 Portal 及对应守护退出，然后关闭自身；独立安装助手等待旧客户端退出，macOS 同目录备份并替换应用，Windows 执行 NSIS 一键安装并显示进度，成功后自动打开新版。新版使用原配置同步最新内置 Portal 和守护并自动运行；未开启后台常驻时，由客户端持有 Portal，不会因升级启用登录守护。

从开发用临时签名首次换为 Developer ID 签名时，macOS 可能要求重新授权钥匙串访问。请在系统弹窗中完成授权，原连接配置会保留；后续版本保持签名身份和应用标识稳定。

下载或暂存失败不停止服务；停止失败不执行安装；安装失败重新打开旧客户端时使用该客户端的配套 Portal 和保留的配置。macOS 替换或 LaunchServices 拒绝启动时恢复旧应用；启动请求被接受不等于新版已完成初始化，启动后崩溃仍需从保留的旧应用恢复。下载失败或选择“稍后”会清理尚未使用的暂存文件；开始安装后保留安装日志及旧应用备份以便诊断。旧版本尚无这个入口时，仍可手动替换应用或运行 Setup，新版首次启动会补做完整的停止、同步与恢复；不要删除用户配置目录。

## 升级事务

安装、重装、升级和日常启动统一使用当前客户端附带的 Portal，不再沿用外部可执行文件或守护。已有客户端连接和本机设置优先；找到旧 TOML 时保留其原路径和内容。首次配置可从用户 Portal 配置目录读取 TOML，不需要旧引擎存在。

同一 Being 的旧实例或守护构成启动冲突时，`portal-takeover.json` 记录自动停止和启动过程，无需用户确认切换。验证管理方式、内置引擎与连接后停止旧服务，确认退出再启动客户端版本。失败或中断暂停自动重试，旧取消记录不再阻止启动。独立引擎不会进入升级回滚范围。

1. 验证安装包内 `runtime-bundle.json` 的平台、架构及引擎 SHA-256。升级使用当前客户端随包交付的引擎，即使本机另有更高版本，也以该配套清单为准。
2. 在独立运行目录暂存引擎、当前守护脚本及版本清单；原配置文件、工作目录、Kits 和配置内的路径保持原位置。复制原加密凭据或私有凭据文件，不经网页传递。
3. 在停止前写入私有恢复日志，记录此前由客户端管理的服务及配置。
4. 先停用自动重启并卸载客户端旧服务，确认引擎和守护均退出后才登记新版。macOS 等待 launchd 服务退出；Windows 停用计划任务、停止任务并按已验证的可执行路径清理子进程树。
5. 重新登记当前守护，按原配置及原工作目录启动安装包配套引擎。校验新进程、nonce、boot ID 和本地状态连续稳定；不以云端在线作为本地就绪条件。前台模式会停用临时守护，由客户端启动同一配套引擎并再次验证就绪，不因升级开启登录自启。
6. 成功后记录版本并清除事务日志，保留旧运行目录。失败先停新服务再恢复旧登记；升级中途退出，下次启动先恢复，不立即循环重试。

手动升级完成后自动启动 Portal；没有版本变化的普通启动仍尊重用户停止操作。失败回滚时恢复升级前的状态。版本清单 ID 同时覆盖客户端版本、引擎摘要和守护代码，避免同一路径下的引擎或脚本更新被忽略。已管理的服务即使未勾选自动启动，也会完成配套切换并自动启动。

配套更新仅管理客户端创建的 macOS LaunchAgent / Windows 计划任务。独立 Portal 只参与冲突停止，不迁移其运行程序或恢复其守护。旧客户端服务与独立守护并存时，先停止同一 Being 的冲突实例，再按前台或后台设置启动客户端版本。其他用户或其他 Being 的进程不受影响。

旧服务缺少配置归属标记时，仅内容完全匹配客户端默认模板的配置可以重新生成，自定义 TOML 保留原路径和内容。配置不可读取或解析失败时，在停止旧服务前中止升级，避免静默丢弃设置。已登记为当前版本但运行目录中的引擎文件丢失时，仍会从客户端配套包重新安装并验证。

这里只升级引擎与其守护；不自动升级第三方 Kits、npm/Python、系统组件或改写 Portal 配置。恢复日志用于 Portal 恢复，不替代客户端安装包回退。当前没有破坏性配置迁移；未来新增不兼容配置需单独设计迁移及回退。

## 发布维护

- `npm version X.Y.Z --no-git-tag-version` 同步客户端与 lockfile 版本。
- `npm run build:portal` 构建配套源码；`npm run make` 打包时从实际二进制读取版本、计算摘要并生成清单。不要复用未知来源或不对应源码的二进制。
- `.github/workflows/release.yml` 只由版本 tag 触发。macOS arm64、macOS x64 和 Windows x64 三组构建、各 Mac 架构的 DMG 安装及 ZIP 暂存验证和 Windows 原生升级测试通过、包内引擎摘要核对后，先创建草稿并上传全部安装包、清单及摘要，最后公开为正式 Release。每个 Mac 架构必须同时提供一个 DMG 和一个 ZIP，各自写入 `SHA256SUMS.txt`；缺包或上传失败不发布正式版本。重试发布同样检查三组原生构建结果。
- 更新 `desktop/RELEASE_NOTES.md` 后再创建版本 tag；草稿和预发布不会提示用户更新。
- 默认更新源为 `d5z/portal-desktop`。私有仓库无法匿名检测：应在构建时设置 `PORTAL_DESKTOP_UPDATE_REPOSITORY=owner/public-release-repo`（Actions 中使用同名 repository variable），只公开版本及二进制；不内置 GitHub token。保持私有时可在浏览器登录发布页下载。
- 下载和安装由用户手动触发。macOS 与 Portal 源仓使用相同的 D5 Developer ID、固定标识、Hardened Runtime 和安全时间戳；公证同样暂缓。签发和 Secrets 配置见 [BUILDING.md](BUILDING.md)。Windows Authenticode 尚未配置。SHA-256 检查不能代替签名和来源信任。

## 验证

`npm test` 包含更新检查、配套切换、损坏包拒绝、升级后自动运行、失败回滚、中断恢复、Windows 安装助手独立存活及旧 Squirrel 事件兼容测试。`npm run make` 后运行 `npm run test:windows-upgrade`，验证真实 NSIS 首次安装及客户端内升级、自动重启、配置保留和随包 Portal 接管。

`PORTAL_DESKTOP_NATIVE_UPGRADE_TESTS=1 npx vitest run tests/runtime-update-native.test.ts` 在 macOS 上使用隔离 profile 和真实 LaunchAgent，验证离线升级及坏引擎回滚。Windows PowerShell 中先设置 `$env:PORTAL_DESKTOP_NATIVE_UPGRADE_TESTS='1'`，同一测试验证计划任务路径；需要可用的交互式用户会话。该测试不触碰日常 Portal。Windows 实机结果应单独记录，不能用 mock 通过代替。

Windows 发布构建还会运行实际 Setup，确认安装助手自动打开安装目录中的新客户端。macOS 的 `npm test` 使用真实签名、解压和文件替换，验证损坏包拒绝、取消清理、等待旧进程、替换及启动请求失败回滚；LaunchServices 用测试启动器替代，不打开额外的客户端窗口。

Windows 升级 E2E 默认以当前源码修改版本号后构建 NSIS fixture；设置 `PORTAL_DESKTOP_BASELINE_SETUP` 为已校验摘要的历史 Setup 绝对路径，可改用真正发布的上一版本安装包（版本必须为当前 patch 版本减一）。例如本地 0.1.4 验证：`$env:PORTAL_DESKTOP_BASELINE_SETUP='D:\downloads\portal-desktop-0.1.3-windows-x64-Setup.exe'` 后运行 `npm run test:windows-upgrade`。新版 Release 元数据、摘要和下载仍由本地 fixture 提供实际新包，不发布到 GitHub。测试还检查外观配置保留、通知默认关闭、开发测试按钮隐藏且测试 IPC 不可调用，结果写入 `test-results/windows-installer/upgrade-success.json`。这不代表已验证 0.1.1 Squirrel 历史迁移；`tests/installer-handoff-native.test.ts` 单独验证当前 Windows 助手在父进程退出后继续执行。

构建后运行 `npm run test:macos-package`，校验实际 `.app`、Portal 和 DMG 的 Developer ID、完整签名及时间戳，验证可执行文件的 Hardened Runtime、架构、版本和清单。实际挂载只读 DMG，检查 Applications 快捷方式，复制到临时应用目录并推出，验证安装后签名及包内容一致，再让同一 Release 的 ZIP 经过完整安装前暂存流程。版本 tag 触发的 macOS 发布构建会运行此检查。它不代表公证或干净机器上的 Gatekeeper 验收。

当前未公证包的 `spctl --assess --type execute --verbose=4` 实测返回 `rejected / Unnotarized Developer ID`。本机安装和升级成功不代表新 Mac 首次下载能够通过系统检查；完成 Apple 公证后仍需补充带下载隔离属性的安装验收。

`npm run test:macos-upgrade` 从实际 DMG 复制应用，构造较低版本的测试基线，在独立 profile 与本地模拟 Being 下实际走“下载并升级”、退出、文件替换和 LaunchServices 自动启动。GitHub Release API 与下载请求使用本地响应提供实际 ZIP，检查请求的仓库、tag 和文件名，避免依赖尚未公开的新版本。验证原配置、工作文件、工具清单及命令执行保留，运行引擎摘要等于包内清单，旧守护已停用，进程持续稳定。基线是版本化测试 fixture，不代表遍历所有历史发布版；运行前需退出日常客户端，测试拒绝并行启动另一份客户端。
