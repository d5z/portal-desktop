import { app, dialog, net, shell, type BrowserWindow } from 'electron';
import { access, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { redact } from '../chat/connection';
import { verifyBeingConnection } from '../chat/ready';
import { BackgroundPortal } from '../portal/background';
import { portalLogText } from '../portal/diagnostics';
import { PortalSupervisor } from '../portal/supervisor';
import { TownCredentials } from '../town/client';
import { TownLive } from '../town/live';
import { ClientErrorLog } from './error-log';
import type { RegisterHandler } from './ipc';
import { createLogArchive } from './log-archive';
import type { SecretStorage } from './settings';
import { SettingsStore } from './settings';
export function registerDiagnosticsIpc(options: {
  handle: RegisterHandler; directory: string; store: SettingsStore; portal: PortalSupervisor;
  background: BackgroundPortal; townLive: TownLive; townCredentials: TownCredentials;
  secretStorage: SecretStorage; errorLog: ClientErrorLog;
  startedAt: string; build: string; clientName: string;
  window(): BrowserWindow | null; lifecycleError(): string; upgrade(): unknown;
}) {
  const { handle, directory, store, portal, background, townLive, townCredentials, secretStorage,
    errorLog, startedAt, clientName, window: getWindow } = options;
  const diagnose = async (): Promise<import('../../shared/types').DiagnosticReport> => {
    const connection = store.connection;
    const checks: import('../../shared/types').DiagnosticReport['checks'] = [];
    checks.push({ name: '客户端', status: 'ok', detail: `主进程 ${process.pid} · 关闭窗口保留运行，退出客户端结束进程` });
    if (options.lifecycleError()) checks.push({ name: '上次退出', status: 'error', detail: options.lifecycleError() });
    checks.push({ name: '凭据保护', status: secretStorage.isEncryptionAvailable() ? 'ok' : 'error', detail: secretStorage.isEncryptionAvailable() ? '系统密钥库可用' : '系统密钥库不可用' });
    try { await access(store.settings.workspace); checks.push({ name: '工作目录', status: 'ok', detail: '目录可访问' }); }
    catch { checks.push({ name: '工作目录', status: 'warning', detail: '目录尚未创建或不可访问' }); }
    try { await verifyBeingConnection(connection, net.fetch.bind(net) as typeof fetch); checks.push({ name: 'Being', status: 'ok', detail: '现有状态接口可访问；未发送消息或调用工具' }); }
    catch (error) { checks.push({ name: 'Being', status: 'warning', detail: errorLog.report('being-diagnostics', error, 'Being 连接检查失败，请稍后重试。') }); }
    if (connection !== store.connection) throw new Error('连接已切换，请重新检查。');
    checks.push({ name: 'Portal', status: portal.state.phase === 'connected' ? 'ok' : portal.state.phase === 'error' ? 'error' : 'warning', detail: portal.state.message });
    checks.push({ name: 'Town', status: townLive.state.phase === 'connected' ? 'ok' : 'warning', detail: townLive.state.message });
    return {
      version: app.getVersion(), build: options.build, platform: `${process.platform}/${process.arch}`, pid: process.pid, startedAt, checkedAt: new Date().toISOString(), checks,
      logs: portal.state.logs.slice(-60).map(line => redact(line, [connection?.token || '', connection?.relaySecret || '']).replaceAll(os.homedir(), '~'))
    };
  };
  handle('beings:diagnostics', diagnose);
  const capturePortalLogs = async () => {
    const state = { ...portal.state, logs: [...portal.state.logs] };
    await errorLog.exportSnapshot(state.logs, {
      version: app.getVersion(), platform: `${process.platform}/${process.arch}`,
      capturedAt: new Date().toISOString(), workspace: store.settings.workspace,
      portal: { ...state, logs: undefined }, background: background.state,
      upgrade: options.upgrade(),
      runtimeDirectory: background.installedService?.root || directory
    });
    return { state, errors: await errorLog.recentText() };
  };
  handle('beings:portal-log-reference', async () => {
    const connection = store.connection;
    if (!connection) throw new Error('请先连接 Being。');
    const { state, errors } = await capturePortalLogs();
    if (connection !== store.connection) throw new Error('连接已切换，请重新选择 Portal 日志。');
    return {
      endpoint: connection.endpoint, text: portalLogText({
        version: app.getVersion(),
        platform: `${process.platform}/${process.arch}`, portal: state, errors, home: os.homedir(),
        secrets: [connection.token, connection.relaySecret]
      })
    };
  });
  handle('beings:logs', async () => {
    await capturePortalLogs();
    const error = await shell.openPath(errorLog.directory);
    if (error) throw new Error(error);
  });
  let collectingLogs: Promise<string> | undefined;
  handle('beings:collect-logs', () => {
    if (!collectingLogs) collectingLogs = (async () => {
      const secrets = [store.connection?.token || '', store.connection?.relaySecret || '', townCredentials.token];
      const runtimeDirectories = [background.installedService?.root || '', portal.state.runtimePath || '', directory];
      await capturePortalLogs();
      const file = await createLogArchive({
        logsDirectory: errorLog.directory, runtimeDirectories, installerDirectory: path.join(directory, 'client-updates'),
        destination: app.getPath('downloads'), secrets
      });
      shell.showItemInFolder(file);
      return file;
    })().finally(() => { collectingLogs = undefined; });
    return collectingLogs;
  });
  handle('beings:diagnostics-export', async () => {
    const report = await diagnose();
    const result = await dialog.showSaveDialog(getWindow()!, { title: '导出诊断', defaultPath: `${clientName}-diagnostics-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return false;
    // Export status only: engine output can contain user task data even when credentials are redacted.
    await writeFile(result.filePath, JSON.stringify({ ...report, logs: undefined }, null, 2), { mode: 0o600 });
    return true;
  });
}

export function startResourceMonitor(errorLog: ClientErrorLog) {
  errorLog.info('client-start', `version=${app.getVersion()} platform=${process.platform}/${process.arch} pid=${process.pid}`);
  app.on('child-process-gone', (_event, details) => errorLog.report('child-process-gone', JSON.stringify(details)));
  const sampleResources = () => {
    try {
      errorLog.info('client-resources', JSON.stringify({
        system: { totalBytes: os.totalmem(), freeBytes: os.freemem() },
        main: process.memoryUsage(),
        processes: app.getAppMetrics().map(({ pid, type, cpu, memory }) => ({ pid, type, cpu, memory })),
      }));
    } catch (error) { errorLog.report('resource-sample', error); }
  };
  sampleResources();
  const resourcePoll = setInterval(sampleResources, 60_000);
  resourcePoll.unref();
  return () => clearInterval(resourcePoll);
}
