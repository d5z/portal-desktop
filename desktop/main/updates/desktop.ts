import { app, net, type BrowserWindow } from 'electron';
import { ClientErrorLog } from '../app/error-log';
import type { RegisterHandler } from '../app/ipc';
import type { Exclusive } from '../app/mutations';
import { UpdateChecker } from './checker';
import { stageInstaller } from './manual-installer';
export function registerDesktopUpdates(options: {
  handle: RegisterHandler; exclusive: Exclusive; directory: string; repository: string; errorLog: ClientErrorLog;
  window(): BrowserWindow | null; isQuitting(): boolean;
  shutdown(target: string, handoff?: () => Promise<void>): Promise<void>;
}) {
  const { handle, exclusive, directory, repository, errorLog, window: getWindow, isQuitting } = options;
  const updates = new UpdateChecker(app.getVersion(), repository, net.fetch.bind(net) as typeof fetch,
    state => { if (getWindow() && !getWindow()!.isDestroyed()) getWindow()!.webContents.send('beings:update-state', state); },
    process.platform, process.arch, error => { errorLog.report('update-check', error); });
  let updateDownload: AbortController | undefined;
  let updateHandoff: Awaited<ReturnType<typeof stageInstaller>> | undefined;
  const downloadUpdate = async () => {
    if (updateDownload || updateHandoff || updates.state.activity) return;
    if (!app.isPackaged) throw new Error('开发版本不能下载安装更新。');
    // Own the attempt before awaiting metadata; concurrent IPC calls otherwise
    // share the check but each stage a different installer afterwards.
    const controller = new AbortController();
    updateDownload = controller;
    let lastProgress = 0;
    try {
      const state = updates.state.phase === 'available' ? updates.state : await updates.check();
      controller.signal.throwIfAborted();
      if (state.phase !== 'available' || !state.latestVersion) throw new Error('当前没有可下载的客户端更新。');
      updates.setActivity({ phase: 'metadata', version: state.latestVersion });
      getWindow()?.setProgressBar(2);
      updateHandoff = await stageInstaller(directory, state.latestVersion, repository, process.execPath, net.fetch.bind(net) as typeof fetch, {
        signal: controller.signal,
        onProgress: progress => {
          const now = Date.now();
          if (progress.phase === 'downloading' && progress.received && progress.received !== progress.total && now - lastProgress < 200) return;
          lastProgress = now;
          updates.setActivity({ ...progress, version: state.latestVersion! });
          getWindow()?.setProgressBar(progress.phase === 'downloading' && progress.total ? Math.min(1, (progress.received || 0) / progress.total) : 2);
        },
      });
      if (!getWindow() || getWindow()!.isDestroyed() || isQuitting() || controller.signal.aborted) {
        await updateHandoff.discard();
        updateHandoff = undefined;
        updates.setActivity();
        return;
      }
      updates.setActivity({ phase: 'ready', version: state.latestVersion });
    } catch (error) {
      if (controller.signal.aborted) {
        updates.setActivity();
        return;
      }
      updates.setActivity();
      throw error;
    } finally {
      updateDownload = undefined;
      getWindow()?.setProgressBar(-1);
    }
  };
  const installUpdate = async () => {
    const handoff = updateHandoff;
    const activity = updates.state.activity;
    if (!handoff || activity?.phase !== 'ready') throw new Error('安装包尚未准备完成。');
    updates.setActivity({ phase: 'installing', version: activity.version });
    try {
      await exclusive(async () => {
        if (isQuitting()) throw new Error('客户端正在退出，请稍候。');
        await options.shutdown(activity.version, handoff);
        updateHandoff = undefined;
      });
    } catch (error) {
      updates.setActivity({ phase: 'ready', version: activity.version });
      throw error;
    }
  };
  handle('beings:check-updates', () => updates.check());
  handle('beings:download-update', downloadUpdate);
  handle('beings:install-update', installUpdate);
  handle('beings:cancel-update', () => { updateDownload?.abort(); });
  handle('beings:update-state', () => updates.state);
  return updates;
}
