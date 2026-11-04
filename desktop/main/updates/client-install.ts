import path from 'node:path';
import { readFile, rm } from 'node:fs/promises';
import { atomic, BackgroundPortal, type Service } from '../portal/background';
import type { Connection } from '../chat/connection';

export interface InstallIntent {
  schema: 1; from: string; target: string; foreground: boolean;
  services: { service: Service; enabled: boolean }[];
}
// Written before the first stop. The next client either consumes these launch
// records with its new runtime or resumes them after a cancelled/failed install.
export class ClientInstall {
  private file: string;
  constructor(directory: string, private background: BackgroundPortal) {
    this.file = path.join(directory, 'client-install.json');
  }
  async read(): Promise<InstallIntent | null> {
    let value: InstallIntent;
    try { value = JSON.parse(await readFile(this.file, 'utf8')); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
    if (value.schema !== 1 || !/^\d+\.\d+\.\d+$/.test(value.from) || !/^\d+\.\d+\.\d+$/.test(value.target) ||
      !Array.isArray(value.services) || value.services.some(s => !s.service || !path.isAbsolute(s.service.root) || s.service.label !== this.background.label)) throw new Error('客户端安装恢复记录无效。');
    return value;
  }
  async prepare(from: string, target: string, _connection: Connection | null, foreground: boolean) {
    // A cancelled installer or a paused Portal startup can leave this record
    // behind. Carry its rollback state into the next attempt before stopping
    // anything; requiring Portal to start first would prevent repair by upgrade.
    const pending = await this.read();
    const services: InstallIntent['services'] = pending?.services.filter(item => !item.service.existing && !item.service.kind) || [];
    const service = this.background.installedService;
    if (service && !service.existing && !service.kind) {
      const saved = services.find(item => item.service.label === service.label);
      // Runtime synchronization may already have committed a new directory.
      // Keep its registration, with the pre-install enabled preference.
      if (saved) saved.service = service;
      else services.push({ service, enabled: (await this.background.refresh()).enabled });
    }
    const intent: InstallIntent = { schema: 1, from, target, services, foreground: foreground || Boolean(pending?.foreground) };
    await atomic(this.file, JSON.stringify(intent));
    try { for (const item of services) await this.background.unload(item.service); }
    catch (error) {
      // A retry can inherit a foreground engine that was already stopped. Leave
      // its recovery record intact; this attempt has not run its own cleanup.
      if (!(pending?.foreground && !foreground)) await this.resume(intent);
      throw error;
    }
    return intent;
  }
  async resume(intent: InstallIntent, startForeground?: () => Promise<unknown>) {
    for (const { service, enabled } of intent.services) if (enabled && !service.existing && !service.kind) await this.background.load(service);
    if (intent.foreground && startForeground) await startForeground();
    await this.finish();
  }
  async shutdown(from: string, target: string, connection: Connection | null, foreground: boolean, steps: {
    cleanup(): Promise<void>; handoff?(): Promise<void>; quit(): void; startForeground(): Promise<unknown>;
  }) {
    const intent = await this.prepare(from, target, connection, foreground);
    try {
      // Complete fallible shutdown work while rollback is still owned by this client.
      await steps.cleanup();
      await steps.handoff?.();
      steps.quit();
    } catch (error) {
      await this.resume(intent, steps.startForeground);
      throw error;
    }
  }
  async finish() { await rm(this.file, { force: true }); }
}
