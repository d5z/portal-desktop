import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import {
  parseWebConnection,
  readConnection,
  CONNECTION_KEY,
} from "../web/connection";
import { createProxy } from "../web/proxy.mjs";

const servers: Server[] = [];
async function listen(server: Server) {
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    servers.splice(0).map((server) => {
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    }),
  );
});

it("keeps connection credentials separate from the public endpoint and validates unsafe links", () => {
  expect(
    parseWebConnection(
      "https://example.com/willow/?token=secret&relay_secret=relay",
    ),
  ).toEqual({
    api: "https://example.com/willow",
    endpoint: "https://example.com/willow",
    name: "willow",
    token: "secret",
    relaySecret: "relay",
  });
  for (const link of [
    "javascript:alert(1)",
    "https://a:b@example.com/?token=t",
    "http://example.com/?token=t",
    "https://example.com/",
  ])
    expect(() => parseWebConnection(link)).toThrow();
  expect(parseWebConnection("http://localhost:5000/?token=t").endpoint).toBe(
    "http://localhost:5000",
  );
});

it("restores session credentials without accepting an injected proxy/API destination", () => {
  const getItem = vi.fn(() =>
    JSON.stringify({
      endpoint: "https://example.com/willow",
      token: "saved",
      api: "https://other.example",
    }),
  );
  vi.stubGlobal("sessionStorage", { getItem });
  expect(readConnection()?.api).toBe("https://example.com/willow");
  expect(getItem).toHaveBeenCalledWith(CONNECTION_KEY);
});

it("proxies Town JSON, pairing payloads and SSE without forwarding browser cookies or following redirects", async () => {
  const requests: {
    path: string;
    auth?: string;
    cookie?: string;
    body: string;
  }[] = [];
  const upstream = await listen(
    createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      requests.push({
        path: req.url!,
        auth: req.headers.authorization,
        cookie: req.headers.cookie,
        body: Buffer.concat(chunks).toString(),
      });
      if (req.url === "/api/redirect") {
        res.writeHead(302, { Location: "https://untrusted.invalid" });
        res.end();
        return;
      }
      if (req.url === "/api/client/stream") {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write("event: hello\ndata: {}\n\n");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    }),
  );
  const proxy = await listen(
    createServer(createProxy({ townOrigin: upstream })),
  );
  expect(await (await fetch(proxy + "/town-api/api")).json()).toEqual({
    ok: true,
  });
  const response = await fetch(proxy + "/town-api/api/client/pair/confirm", {
    method: "POST",
    headers: {
      Authorization: "Bearer town-only",
      Cookie: "browser-secret=1",
      "Content-Type": "application/json",
    },
    body: '{"code":"ABC123"}',
  });
  expect(response.status).toBe(200);
  expect(requests[1]).toEqual({
    path: "/api/client/pair/confirm",
    auth: "Bearer town-only",
    cookie: undefined,
    body: '{"code":"ABC123"}',
  });
  expect((await fetch(proxy + "/town-api/api/redirect")).status).toBe(502);
  const controller = new AbortController();
  const stream = await fetch(proxy + "/town-api/api/client/stream", {
    signal: controller.signal,
  });
  expect(stream.headers.get("x-accel-buffering")).toBe("no");
  expect(
    new TextDecoder().decode((await stream.body!.getReader().read()).value),
  ).toContain("event: hello");
  controller.abort();
});

it("uses only deployment-configured Loom targets and rejects cross-origin writes and non-API paths", async () => {
  let received = "";
  const upstream = await listen(
    createServer((req, res) => {
      received = req.url!;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    }),
  );
  const proxy = await listen(
    createServer(createProxy({ loomEndpoint: upstream + "/willow" })),
  );
  expect(await (await fetch(proxy + "/_web/config")).json()).toEqual({
    loomEndpoint: upstream + "/willow",
  });
  expect(
    (await fetch(proxy + "/loom-api/api/status?token=loom-token")).status,
  ).toBe(200);
  expect(received).toBe("/willow/api/status?token=loom-token");
  expect(
    (
      await fetch(proxy + "/loom-api/api/chat/stream", {
        method: "POST",
        headers: { Origin: "https://untrusted.example" },
        body: "{}",
      })
    ).status,
  ).toBe(403);
  expect((await fetch(proxy + "/town-api/private")).status).toBe(400);
  const unconfigured = await listen(
    createServer(createProxy({ loomEndpoint: "" })),
  );
  expect((await fetch(unconfigured + "/loom-api/api/status")).status).toBe(503);
});

it("allows only configured OSS origins, including preflight and streaming responses", async () => {
  let calls = 0;
  const upstream = await listen(
    createServer((req, res) => {
      calls++;
      res.setHeader("Content-Type", "text/event-stream");
      res.end("event: hello\ndata: {}\n\n");
    }),
  );
  const origin = "https://town.example.com";
  const proxy = await listen(
    createServer(
      createProxy({ townOrigin: upstream, allowedOrigins: [origin] }),
    ),
  );
  const headers = { Origin: origin, "Sec-Fetch-Site": "cross-site" };
  const preflight = await fetch(proxy + "/town-api/api/client/stream", {
    method: "OPTIONS",
    headers: {
      ...headers,
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "authorization",
    },
  });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
  expect(calls).toBe(0);
  const stream = await fetch(proxy + "/town-api/api/client/stream", {
    headers,
  });
  expect(stream.headers.get("access-control-allow-origin")).toBe(origin);
  expect(await stream.text()).toContain("event: hello");
  expect(
    (await fetch(proxy + "/_web/config", { headers })).headers.get(
      "access-control-allow-origin",
    ),
  ).toBe(origin);
  const denied = await fetch(proxy + "/town-api/api", {
    headers: {
      Origin: "https://untrusted.test",
      "Sec-Fetch-Site": "cross-site",
    },
  });
  expect(denied.status).toBe(403);
  expect(denied.headers.get("access-control-allow-origin")).toBe(null);
  expect(calls).toBe(1);
});
