# Being 自主切线路

脚本：`scripts/being-model-switch.mjs`。它读取桌面端同一份 `model-profiles.json`，线路密钥仍由 Electron `safeStorage` 保护。

## 规则

1. 只能切到已经被桌面端成功提交过的 provider/线路；不能新建记忆、改地址或写密钥。
2. 当前配置必须被某条线路记忆覆盖，才允许切换；否则失败后无法安全取回原密钥，脚本会拒绝操作。
3. 切前读取快照，切后重新 GET `/api/llm/config` 核对 provider、model、base_url；核对失败会自动切回原线路。
4. 每次尝试写一条不含密钥和 token 的审计记录到 `userData/being-model-audit.jsonl`。

## 用法

```powershell
$s = 'E:\Agentspace\portal-modelprofiles\scripts\being-model-switch.mjs'
.\node_modules\.bin\electron.cmd $s list
.\node_modules\.bin\electron.cmd $s activate openrouter
.\node_modules\.bin\electron.cmd $s audit 20
```

`activate` 的参数是 provider/线路，例如 `self-hosted`、`openrouter` 或 `portal-custom`。

退出码：

- `0` 成功
- `2` 参数错误
- `3` 没有对应的线路记忆
- `4` 读取当前模型配置失败
- `5` 当前配置没有线路记忆覆盖
- `6` 切换被服务端拒绝
- `7` 核对失败，已回滚或回滚失败

脚本不是桌面端 UI；桌面端正常使用时，在现有模型设置的线路切换控件中自动填充，不需要打开这个脚本。
