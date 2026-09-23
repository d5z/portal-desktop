import { afterEach, expect, it, vi } from "vitest";
import {
  defaultTownConnection,
  townCredentialKey,
  townRequestURL,
  pairingPrompt,
} from "../web/town-connection";
import { createTownAPI } from "../web/town-api";
import { loadDeployment } from "../web/deployment";

vi.mock("../web/deployment", () => ({
  loadDeployment: vi.fn(async () => ({ mode: "static", apiBase: "" })),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}
function setup() {
  const local = storage(),
    session = storage();
  vi.stubGlobal("location", { origin: "https://site.test" });
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("sessionStorage", session);
  const fetcher = vi.fn(
    async () =>
      new Response('{"version":"0.3.0"}', {
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  return { local, session, fetcher };
}
it("actually sends Town requests from the default static package with an empty apiBase", async () => {
  const { fetcher } = setup();
  const town = createTownAPI();
  try {
    expect((await town.api.town({ kind: "home" })).ok).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(
      "https://beings.town/api",
      expect.objectContaining({ credentials: "omit" }),
    );
  } finally {
    town.dispose();
  }
});
it("routes custom Town requests without forwarding credentials from another destination", async () => {
  const { session, fetcher } = setup();
  const old = { townOrigin: "https://beings.town", apiBase: "" };
  const next = { townOrigin: "https://custom.test", apiBase: "" };
  session.setItem(
    townCredentialKey(old),
    JSON.stringify({
      token: "old-town-token-1234",
      beingId: "willow",
      display: "Willow",
    }),
  );
  vi.mocked(loadDeployment).mockResolvedValueOnce({ mode: "static", ...next });
  const town = createTownAPI();
  try {
    expect((await town.api.townAuth()).configured).toBe(false);
    await town.api.town({ kind: "bonfire" });
    expect(fetcher).toHaveBeenCalledWith(
      "https://custom.test/api/bonfire/hear?limit=100",
      expect.objectContaining({ headers: { Accept: "application/json" } }),
    );
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain("old-town-token");
  } finally {
    town.dispose();
  }
});
it("keeps the local gateway default and supports cross-domain gateways and pairing prompts", () => {
  const connection = defaultTownConnection(
    { mode: "server", apiBase: "" },
    "https://site.test",
  );
  expect(townRequestURL(connection, "/api")).toBe(
    "https://site.test/town-api/api",
  );
  const other = {
    townOrigin: "https://custom.test",
    apiBase: "https://api.test/gateway",
  };
  expect(townRequestURL(other, "/api/client/stream?token=x")).toBe(
    "https://api.test/gateway/town-api/api/client/stream?token=x",
  );
  expect(pairingPrompt(other)).toContain(
    "POST https://custom.test/api/client/pair",
  );
  expect(pairingPrompt(other)).not.toContain("beings.town");
});
it("sends pairing directly without domain detection or an API connectivity probe", async () => {
  const { fetcher } = setup();
  fetcher.mockImplementation(async () => new Response("{}", { status: 401 }));
  const town = createTownAPI();
  try {
    await town.api.townAuth();
    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      town.api.pairTown({ beingId: "willow", code: "AB3XY9" }),
    ).rejects.toThrow("HTTP 401");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      "https://beings.town/api/client/pair/confirm",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ being_id: "willow", code: "AB3XY9" }),
      }),
    );
  } finally {
    town.dispose();
  }
});
