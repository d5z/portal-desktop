import type { ConnectorContext, ConnectorResources } from '../../../shared/connector-resources';

function hostRequest<T>(operation: string, args: unknown[], signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('请求已取消')); return; }
    const channel = new MessageChannel();
    const timer = setTimeout(() => finish(new Error('工作区请求超时，请重试。')), 65_000);
    const abort = () => finish(new Error('请求已取消'));
    const finish = (error?: Error, value?: T) => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      channel.port1.close();
      if (error) reject(error); else resolve(value as T);
    };
    signal?.addEventListener('abort', abort, { once: true });
    channel.port1.onmessage = event => event.data.error ? finish(new Error(event.data.error)) : finish(undefined, event.data.value);
    window.parent.postMessage({ type: 'beings:connector-resource', operation, args,
      revision: new URLSearchParams(location.search).get('revision') }, '*', [channel.port2]);
  });
}
export const chatConnectorResources: ConnectorResources = {
  context: () => hostRequest<ConnectorContext>('context', []),
  request: (context, path, method, body, signal) => hostRequest('request', [context, path, method, body], signal),
};
