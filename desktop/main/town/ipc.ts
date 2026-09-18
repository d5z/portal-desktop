import type { ClientBrowser } from '../browser/browser';
import type { SecretStorage, SettingsStore } from '../app/settings';
import type { TownClient, TownCredentials } from './client';
import { TOWN_ORIGIN, townRoute } from './client';
import type { TownLive } from './live';
import type { TownPost, TownQuery } from '../../shared/types';
import { requestTownPairCode } from './pairing';

type RegisterHandler = (channel: string, callback: (...args: any[]) => unknown) => void;

export interface TownIpcOptions {
  handle: RegisterHandler;
  exclusive: <T>(operation: () => Promise<T>) => Promise<T>;
  town: TownClient;
  townLive: TownLive;
  townCredentials: TownCredentials;
  store: SettingsStore;
  secretStorage: SecretStorage;
  getWarning: () => string | undefined;
  clearWarning: () => void;
  open: (url: string) => void;
  fetcher?: typeof fetch;
  pairTimeoutMs?: number;
}

export function registerTownIpc(options: TownIpcOptions) {
  const { handle, exclusive, town, townLive, townCredentials, store, secretStorage } = options;
  let pairing: { id: string; controller: AbortController; committing: boolean } | undefined;
  const cancelPairing = (id?: string) => {
    if (!pairing || id && pairing.id !== id) return true;
    if (pairing.committing) return false;
    pairing.controller.abort(); pairing = undefined;
    return true;
  };
  handle('beings:town', async (query: TownQuery) => {
    const generation = townLive.state.generation;
    const result = await town.query(query);
    if (generation !== townLive.state.generation) return { ok: false, code: 'auth', message: 'Town 身份已变更，请刷新。' };
    if (result.ok) townLive.remember(query, result.data);
    else if (result.code === 'auth' && townCredentials.token && query.kind !== 'my-scrolls' && townRoute(query).private) townLive.rejectAuth();
    return result;
  });
  handle('beings:town-live', () => townLive.state);
  handle('beings:town-reconnect', () => townLive.restart());
  handle('beings:town-send', (input: TownPost) => {
    const generation = townLive.state.generation;
    return exclusive(async () => {
      if (generation !== townLive.state.generation || townLive.state.phase !== 'connected' || !townLive.state.beingId) return { ok: false, code: 'auth', message: 'Town 身份尚未确认或已变更，请重新打开发送窗口。' };
      const result = await town.send(input);
      if (!result.ok && result.code === 'auth') townLive.rejectAuth();
      return result;
    });
  });
  handle('beings:town-auth', () => ({ configured: Boolean(townCredentials.token), beingId: townLive.state.beingId, pairedBeingId: townCredentials.beingId || undefined, display: townCredentials.display || undefined, suggestedBeingId: store.settings.being, chatBeing: store.connection?.token ? store.connection.being : undefined, warning: options.getWarning() }));
  handle('beings:town-pair-cancel', (id: string) => cancelPairing(id));
  handle('beings:town-auto-pair', async (input: { requestId: string; beingId: string }) => {
    const id = input?.requestId;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(id)) throw new Error('无效的配对请求。');
    if (pairing) throw new Error('正在配对，请等待或取消当前请求。');
    const connection = store.connection;
    if (!connection?.token) throw new Error('请先连接 Being 对话，或使用手动配对。');
    if (input.beingId !== connection.being) throw new Error('当前 Being 已改变，请重新打开 Town 连接。');
    if (!secretStorage.isEncryptionAvailable()) throw new Error('系统密钥库不可用，无法安全保存配对凭据。');
    const attempt = { id, controller: new AbortController(), committing: false };
    pairing = attempt;
    const generation = townLive.state.generation;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; attempt.controller.abort(); }, options.pairTimeoutMs ?? 90_000);
    const current = () => {
      attempt.controller.signal.throwIfAborted();
      if (pairing !== attempt || store.connection?.link !== connection.link || townLive.state.generation !== generation)
        throw new Error('连接身份已改变，请重新开始配对。');
    };
    try {
      // Waiting for a Being must not hold the application's mutation queue.
      const code = await requestTownPairCode(connection, id, attempt.controller.signal, options.fetcher);
      current();
      const paired = await town.pair({ beingId: connection.being, code }, attempt.controller.signal);
      current();
      await exclusive(async () => {
        current();
        // Once the atomic local save begins, complete it before other changes.
        attempt.committing = true; clearTimeout(timer);
        await townCredentials.save(paired.token, paired.beingId, paired.display);
        options.clearWarning(); townLive.restart();
      });
    } catch (error) {
      if (timedOut) throw new Error('90 秒内未完成自动配对，请使用手动配对。');
      if (attempt.controller.signal.aborted) throw new Error('自动配对已取消。');
      throw error;
    } finally {
      clearTimeout(timer);
      attempt.controller.abort();
      if (pairing === attempt) pairing = undefined;
    }
  });
  handle('beings:town-pair', (input: { beingId: string; code: string }) => exclusive(async () => {
    cancelPairing();
    if (!secretStorage.isEncryptionAvailable()) throw new Error('系统密钥库不可用，无法安全保存配对凭据。');
    const paired = await town.pair(input);
    await townCredentials.save(paired.token, paired.beingId, paired.display);
    options.clearWarning(); townLive.restart();
  }));
  handle('beings:town-token', (token: string) => exclusive(async () => { cancelPairing(); await townCredentials.save(token); options.clearWarning(); townLive.restart(); }));
  handle('beings:town-open', async (route: string) => {
    if (typeof route !== 'string' || !/^\/(?:grove|api\/(?:[a-z]+\/help|grove\/[a-zA-Z0-9_-]+\/download)|(?:embers|scrolls|seeds)\/[a-zA-Z0-9_-]{1,160})?$/.test(route)) throw new Error('不支持的 Town 链接。');
    options.open(TOWN_ORIGIN + route);
  });
  return () => { cancelPairing(); };
}
