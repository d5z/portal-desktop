import { afterEach, expect, it, vi } from "vitest";
import {
  readConnection,
  parseWebConnection,
  saveConnection,
  CONNECTION_KEY,
} from "../web/connection";
import { readCredential, writeCredential } from "../web/credential-storage";
import { createTownAPI } from "../web/town-api";

vi.mock("../web/deployment", () => ({
  loadDeployment: async () => ({ mode: "static", apiBase: "" }),
}));
afterEach(() => vi.unstubAllGlobals());
function storage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => data.clear(),
  };
}
function setup() {
  const local = storage(),
    session = storage();
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("sessionStorage", session);
  vi.stubGlobal("location", { origin: "https://web.test" });
  return { local, session };
}
it("restores Being after a cold launch and clears it on explicit disconnect", () => {
  const { session, local } = setup();
  const connection = parseWebConnection(
    "https://being.test/willow?token=fixture-token&relay_secret=fixture-relay",
  );
  saveConnection(connection);
  session.clear();
  expect(readConnection()).toEqual(connection);
  saveConnection(null);
  // An older tab must not resurrect its stale session after disconnect.
  session.setItem(CONNECTION_KEY, JSON.stringify(connection));
  expect(readConnection()).toBeNull();
  expect(local.getItem(CONNECTION_KEY)).not.toContain("fixture-token");
});
it("migrates an existing session connection and retains it after session loss", () => {
  const { local, session } = setup();
  const connection = parseWebConnection(
    "https://being.test/willow?token=fixture-token",
  );
  session.setItem(CONNECTION_KEY, JSON.stringify(connection));
  expect(readConnection()).toEqual(connection);
  expect(session.getItem(CONNECTION_KEY)).toBeNull();
  session.clear();
  expect(local.getItem(CONNECTION_KEY)).toBeTruthy();
  expect(readConnection()).toEqual(connection);
});
it("does not claim to save when persistent storage is unavailable", () => {
  setup();
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceeded");
    },
  });
  expect(() => writeCredential("fixture", { token: "fixture-token" })).toThrow(
    "无法在此设备保存连接",
  );
  expect(readCredential("fixture")).toBeNull();
});
it("restores Town pairing after a cold launch and forgets it on disconnect", async () => {
  const { session } = setup();
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 }));
  let town = createTownAPI();
  try {
    await town.api.saveTownToken("town-fixture-token-1234");
    town.dispose();
    session.clear();
    town = createTownAPI();
    expect((await town.api.townAuth()).configured).toBe(true);
    await town.api.saveTownToken("");
    town.dispose();
    town = createTownAPI();
    expect((await town.api.townAuth()).configured).toBe(false);
  } finally {
    town.dispose();
  }
});
