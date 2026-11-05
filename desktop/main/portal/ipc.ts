import type { SaveSettings, Snapshot } from '../../shared/types';
import type { RegisterHandler } from '../app/ipc';
import type { Exclusive } from '../app/mutations';
import type { PortalController } from './controller';
import { validateSubagentSetup } from './subagent-setup';

export function registerPortalIpc(options: {
  handle: RegisterHandler; exclusive: Exclusive; controller: PortalController;
  snapshot(): Snapshot; beforeSave(): void; afterSave(): void | Promise<void>;
}) {
  const { handle, exclusive, controller } = options;
  handle('beings:connection-defaults', controller.connectionDefaults);
  handle('beings:save', (input: SaveSettings) => exclusive(async () => {
    // Validate before cancelling current grants or pairing, as in the original flow.
    if (input.subagentEnabled !== undefined && typeof input.subagentEnabled !== 'boolean') throw new Error('无效的 subagent 开关状态');
    if (input.subagentSetup) validateSubagentSetup(input.subagentSetup);
    options.beforeSave();
    await controller.save(input);
    await options.afterSave();
    return options.snapshot();
  }));
  handle('beings:portal-start', () => exclusive(() => controller.start()));
  handle('beings:portal-restart', () => exclusive(() => controller.start(true)));
  handle('beings:portal-force-start', () => exclusive(controller.forceStart));
  handle('beings:portal-stop', () => exclusive(controller.stop));
}
