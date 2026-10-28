# 桌面端：模型线路自动记忆

## 实现范围

- 工作目录：`E:\Agentspace\portal-modelprofiles`
- 分支：`feat/model-profiles`
- 本次需求替代之前的“命名档案列表 + 手动切换”方案；没有新增独立档案列表 UI、命名输入、删除按钮或档案切换按钮。
- `model-profiles.json` 与 `connection.json` 同目录，格式为：

```json
{
  "version": 1,
  "profiles": {
    "provider-or-route": {
      "provider": "openrouter",
      "base_url": "https://…",
      "api": "openai-completions",
      "model": "…",
      "thinking": "medium",
      "key": "<safeStorage 加密结果的 base64>"
    }
  }
}
```

- 每个 provider/线路只保留最近一次成功提交的配置；同一 provider 再次成功提交时覆盖模型、地址、协议和思考强度，API 密钥为空时保留原加密密钥。
- 存储写入串行化，先写临时文件再 rename；写入失败不更新内存。读取兼容上一版数组格式，并按 provider 折叠为最新一份。
- 只复用主进程已有 `secretStorage`。渲染进程只能读取 `provider/base_url/api/model/thinking/hasKey`，不能读取 `key` 或 `api_key`。
- 普通 `beings:model-config` PATCH 在主进程中自动完成两件事：
  1. 如果本次没有输入 `api_key`，按 provider 查找本地加密密钥并在主进程解密后注入请求；
  2. 服务端确认成功且没有回滚后，保存本次实际配置。
- 仍然复用现有 `proxy.handle` 的 `PATCH beings://chat/api/llm/config`，没有新增 HTTP 客户端。服务端只保存当前一份配置，历史线路记忆完全落在客户端本地。
- 返回结果会递归移除 `key/api_key` 字段并遮蔽错误文本中的解密密钥，避免密钥回传渲染进程或进入 UI 错误信息。

## 改动文件

- `desktop/main/chat/model-profiles.ts`
  - 改为按 provider 索引、每 provider 一份的加密存储。
  - 增加自动注入密钥、成功后记忆配置、响应脱敏和旧数组格式迁移。
- `desktop/main/chat/model-profiles.test.ts`
  - 覆盖加密往返、同 provider 覆盖、空 key 保留、多 provider、原子写、旧格式迁移、非法输入、safeStorage 不可用、主进程自动注入和失败/回滚不记忆。
- `desktop/main/main.ts`
  - 在现有 Being 模型 PATCH 链路上接入自动注入与自动保存。
  - `beings:model-profiles` 仅保留公开线路记忆列表读取。
- `desktop/preload/preload.ts`
  - 保留公开 `modelProfiles({ action: "list" })` IPC。
- `desktop/shared/types.ts`
  - 更新线路记忆输入、公开数据和 IPC 类型，移除 id/name/delete/apply 契约。
- `desktop/renderer/chat/components/model-profiles.tsx`
  - 仅加载公开线路记忆，并向现有模型面板提供 provider 查找能力；不渲染独立列表。
- `desktop/renderer/chat/components/settings.tsx`
  - 旧版模型面板在选择 provider、官方/OpenRouter 线路时带出已记忆的模型、地址和协议。
- `desktop/renderer/chat/components/being-model-settings.tsx`
  - 新版线路面板在切换线路/自定义协议时自动带出配置。
  - 本地已有密钥只显示“已记住本机密钥”，不回填密钥文本；主进程在 PATCH 时注入。
- `desktop/renderer/shared/model-settings.css`
  - 删除旧的独立档案列表样式。
- `tests/model-profiles-ui.mjs`
  - 覆盖无列表 UI、provider 自动填充、密钥脱敏、多个线路独立记忆和 subagent 隔离。
- `scripts/being-model-switch.mjs`
  - 将旧的命名档案参数改为 provider/线路参数，继续兼容同一份本地加密记忆。
- `BEING-MODEL-SWITCH.md`
  - 更新命令行说明，明确桌面端 UI 已改为现有线路切换控件自动带出。
- `MODEL-PROFILES-NOTES.md`
  - 本说明。

## UI 行为

1. 用户按原流程进入「更换」或「自定义」。
2. 第一次成功提交某条 provider/线路后，主进程自动记录该 provider 的模型 ID、接口地址、协议、思考强度和加密密钥。
3. 下次选择同一 provider/线路：
   - 模型、接口地址、协议自动带入；
   - API 密钥输入框保持空白；
   - 若本地已有密钥，显示“已记住本机密钥，留空即可沿用”，并允许直接提交；
   - 主进程自动解密并将密钥加入 PATCH，渲染进程看不到密钥。
4. 用户重新填写 API 密钥并成功提交后，会替换该 provider 的本地密钥。
5. 服务端失败或回滚不会覆盖本地成功记忆。
6. subagent 仍使用自己的独立配置，不显示 Being 的线路记忆列表。

## 测试命令与结果

```powershell
npm run typecheck
npm run build:chat
npx vitest run desktop/main/chat/model-profiles.test.ts tests/settings.test.ts tests/connection.test.ts tests/architecture.test.ts tests/main-startup.test.ts tests/renderer-state.test.ts tests/subagent-catalog.test.ts tests/chat-runtime.test.ts --silent
node tests/model-profiles-ui.mjs
node tests/model-catalog-ui.mjs
```

- `npm run typecheck`：通过。
- `npm run build:chat`：通过。
- 相关 Vitest：8 个文件、145 项通过；其中新的 `model-profiles.test.ts` 共 22 项通过。
- `tests/model-profiles-ui.mjs`：通过。
- `tests/model-catalog-ui.mjs`：通过。
- UI 测试使用临时目录、假 `SecretStorage`、隔离 HTTP fixture，不读取真实连接或服务商密钥。

## 遗留事项

- 未使用真实服务商密钥做联网切换。
- 未做安装后 Electron safeStorage 在真实操作系统密钥库中的原生端到端验收。
- 未做手机端、Web 端、云同步或导入导出。
- 未 push、未打安装包、未发布。
