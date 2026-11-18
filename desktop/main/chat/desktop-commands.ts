import { app, type BrowserWindow } from 'electron';
import path from 'node:path';
import { permissionMode } from '../../shared/security';
import { ClientErrorLog } from '../app/error-log';
import { windowPresentation } from '../app/window-presentation';
import { SettingsStore } from '../app/settings';
import { PluginRegistry } from '../plugins/registry';
import { ApprovalDialogs } from './approval-dialogs';
import { ClientContextReader } from './client-context';
import { ClientCommandServer } from './client-server';
import { ChatSessions } from './scene';
import { ToolApproval } from './tool-approval';

export async function createDesktopCommands(options: {
  directory: string; store: SettingsStore; plugins: PluginRegistry; chatSessions?: ChatSessions;
  errorLog: ClientErrorLog; shellURL(): string; window(): BrowserWindow | null;
}) {
  const { directory, store, plugins, chatSessions, errorLog, shellURL, window: getWindow } = options;
  let startupNotice: string | undefined;
  const clientContext = new ClientContextReader(shellURL());
  const approvalDialogs = new ApprovalDialogs(request => {
    const window = getWindow();
    if (window && !window.isDestroyed()) window.webContents.send('beings:tool-approval', request);
  });
  app.once('before-quit', () => approvalDialogs.cancel());
  const toolApproval = new ToolApproval(() => permissionMode(store.settings.permissionMode), async input => {
    const window = getWindow();
    if (!window || window.isDestroyed()) throw new Error('客户端窗口不可用，无法审批；请打开客户端后重试');
    windowPresentation(window).show();
    return approvalDialogs.request(input);
  });
  const clientCommands = new ClientCommandServer(path.join(directory, '.portal-client.json'),
    () => store.connection?.endpoint, (request, signal) => request.verb === 'security-approve'
      ? toolApproval.request(request, signal)
      : request.verb === 'plugins'
        ? plugins.agentCommand(request.endpoint, request.args, request.sceneId)
        : clientContext.execute({ ...request, scenes: chatSessions?.list(request.endpoint) }));
  try { await clientCommands.start(); }
  catch (error) { startupNotice = errorLog.report('client-commands', error, '场景历史服务启动失败。'); }
  app.once('will-quit', () => { clientContext.close(); void clientCommands.close().catch(error => errorLog.report('client-commands-close', error)); });
  return { approvalDialogs, startupNotice };
}
