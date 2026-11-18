import type { SaveSettings, Snapshot } from '../../shared/types';
import type { RegisterHandler } from '../app/ipc';
import type { Exclusive } from '../app/mutations';
import type { PortalController } from './controller';
import { validateSubagentSetup } from './subagent-setup';
import type { SubagentModelNetwork } from './subagent-network';

export function registerPortalIpc(options: {
  handle: RegisterHandler; exclusive: Exclusive; controller: PortalController;
  snapshot(): Snapshot; beforeSave(): void; afterSave(): void | Promise<void>;
  network?: SubagentModelNetwork; isQuitting?(): boolean;
}) {
  const { handle, exclusive, controller } = options;
  handle('beings:connection-defaults', controller.connectionDefaults);
  const validate = (input: SaveSettings) => {
    // Validate before cancelling current grants or pairing, as in the original flow.
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('无效的设置。');
    if (input.subagentEnabled !== undefined && typeof input.subagentEnabled !== 'boolean') throw new Error('无效的 subagent 开关状态');
    if (input.subagentInherit !== undefined && typeof input.subagentInherit !== 'boolean') throw new Error('无效的 subagent 模型来源');
    if (input.subagentInherit === false && !input.subagentSetup || input.subagentInherit === true && input.subagentSetup) throw new Error('请选择默认自部署模型或保存完整自定义配置。');
    if (input.subagentSetup) {
      validateSubagentSetup(input.subagentSetup);
      input.subagentSetup = { ...input.subagentSetup, model: input.subagentSetup.model.trim(),
        ...(input.subagentSetup.base_url ? { base_url: input.subagentSetup.base_url.trim() } : {}),
      };
    }
  };
  const save = (input: SaveSettings, modelRequest?: typeof fetch) => exclusive(async () => {
    if (options.isQuitting?.()) throw new Error('客户端正在退出，请稍候。');
    if (controller.recoveryBlocked) throw new Error('Portal 升级恢复尚未完成，请点击启动 Portal 重试恢复。');
    options.beforeSave();
    await controller.save(input, modelRequest);
    await options.afterSave();
    return options.snapshot();
  });
  handle('beings:save', async (input: SaveSettings) => { validate(input); return save(input); });
  if (options.network) {
    options.network.save = save;
    handle('beings:subagent-network-prepare', (input: SaveSettings) => {
      validate(input);
      return options.network!.prepare(input, options.snapshot().settings.being);
    });
    handle('beings:subagent-network-result', (key: string) => options.network!.result(key));
  }
  handle('beings:portal-start', () => exclusive(() => controller.start()));
  handle('beings:portal-restart', () => exclusive(() => controller.start(true)));
  handle('beings:portal-force-start', () => exclusive(controller.forceStart));
  handle('beings:portal-stop', () => exclusive(controller.stop));
}
