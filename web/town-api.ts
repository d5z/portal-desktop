import { TownClient, TOWN_ORIGIN } from "../desktop/shared/town-client";
import { TownLive } from "../desktop/shared/town-live";
import type { TownAPI } from "../desktop/renderer/town/models/town";
import type { TownLiveState } from "../desktop/shared/types";
import { readConnection, deploymentConnection } from "./connection";
import { WebTownPairing } from "./auto-pair";
import { readCredential, writeCredential } from "./credential-storage";
import {
  loadTownConnection,
  townRequestURL,
  townCredentialKey,
  pairingPrompt,
} from "./town-connection";

const KEY = "town-web:town";
type Credential = { token: string; beingId: string; display: string };
const empty = (): Credential => ({ token: "", beingId: "", display: "" });
export function createTownAPI(): { api: TownAPI; dispose(): void } {
  let credential = empty();
  let storageKey = KEY;
  let disposed = false;
  const connection = loadTownConnection();
  const listeners = new Set<(state: TownLiveState) => void>();
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== TOWN_ORIGIN) throw new Error("无效的 Town 地址");
    const target = await connection;
    init?.signal?.throwIfAborted();
    if (disposed) throw new Error("Town 连接已关闭。");
    return fetch(townRequestURL(target, url.pathname + url.search), {
      ...init,
      credentials: "omit",
    });
  };
  const client = new TownClient(
    () => credential.token,
    transport,
    TOWN_ORIGIN,
    () => live.state.beingId || credential.beingId,
  );
  const live = new TownLive(
    () => credential.token,
    () => credential.beingId,
    (state) => listeners.forEach((listener) => listener(state)),
    transport,
    TOWN_ORIGIN,
    () => credential.display,
  );
  const save = (next: Credential) => {
    writeCredential(storageKey, next.token ? next : null);
    credential = next;
    live.restart();
  };
  const pairing = new WebTownPairing({
    prompt: async () => pairingPrompt(await connection),
    connection: readConnection,
    resolve: deploymentConnection,
    generation: () => live.state.generation,
    pair: (input, signal) => client.pair(input, signal),
    save: (result) => save({ ...result, display: result.display || "" }),
  });
  const unavailable = async (): Promise<never> => {
    throw new Error("本机 Kit 管理请使用桌面客户端。");
  };
  const open = async (value = TOWN_ORIGIN) => {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol))
      throw new Error("不支持的链接");
    window.open(url.href, "_blank", "noopener,noreferrer");
  };
  const api: TownAPI = {
    town: async (query) => {
      await ready;
      const generation = live.state.generation;
      const result = await client.query(query);
      if (generation !== live.state.generation)
        return {
          ok: false,
          code: "auth",
          message: "Town 身份已变更，请刷新。",
        };
      if (result.ok) live.remember(query, result.data);
      else if (result.code === "auth") live.rejectAuth();
      return result;
    },
    sendTown: async (input) => {
      await ready;
      return client.send(input);
    },
    townLive: async () => {
      await ready;
      return live.state;
    },
    onTownLive: (callback) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    reconnectTown: async () => live.restart(),
    townAuth: async () => {
      await ready;
      return {
        configured: Boolean(credential.token),
        beingId: live.state.beingId || credential.beingId,
        display: live.state.display || credential.display,
        chatBeing: readConnection()?.name,
        suggestedBeingId: readConnection()?.name,
      };
    },
    pairTown: async (input) => {
      pairing.cancel();
      await ready;
      const generation = live.state.generation;
      const result = await client.pair(input);
      if (disposed || generation !== live.state.generation)
        throw new Error("Town 身份已改变，请重新配对。");
      save({ ...result, display: result.display || "" });
    },
    saveTownToken: async (token) => {
      await ready;
      if (token && !/^[a-zA-Z0-9._~-]{16,2048}$/.test(token))
        throw new Error("请输入有效的 Town 专用凭据。");
      pairing.cancel();
      save({ ...empty(), token });
    },
    autoPairTown: async (input) => {
      await ready;
      return pairing.start(input);
    },
    cancelTownPair: async (id) => pairing.cancel(id),
    copyText: (text) => navigator.clipboard.writeText(text),
    openBrowser: open,
    openTownLink: async (route) =>
      open(new URL(route, (await connection).townOrigin).href),
    localKits: async () => ({ directory: "", enabled: false, kits: [] }),
    deleteKit: unavailable,
    importKit: unavailable,
    prepareKit: unavailable,
    installKit: unavailable,
    discardKit: async () => {},
    openKits: unavailable,
  };
  const ready = connection.then((target) => {
    if (disposed) return;
    storageKey = townCredentialKey(target);
    try {
      // Only migrate legacy credentials for the original same-origin gateway.
      const legacy =
        target.townOrigin === TOWN_ORIGIN && target.apiBase === location.origin;
      const saved = readCredential(storageKey) as Credential | null;
      const previous = legacy
        ? (readCredential(KEY) as Credential | null)
        : null;
      const restored = saved || previous;
      if (
        restored &&
        ["token", "beingId", "display"].every(
          (key) => typeof restored[key as keyof Credential] === "string",
        )
      ) {
        credential = restored;
        if (previous) {
          writeCredential(storageKey, restored);
          writeCredential(KEY, null);
        }
      }
    } catch {
      /* No saved connection. */
    }
    live.restart();
  });
  // Individual API calls surface initialization errors through the existing UI.
  void ready.catch(() => {});
  return {
    api,
    dispose: () => {
      disposed = true;
      pairing.cancel();
      live.dispose();
      listeners.clear();
    },
  };
}
