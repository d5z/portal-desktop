import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export function createProxy({
  townOrigin = process.env.WEB_TOWN_ORIGIN || "https://beings.town",
  loomEndpoint = process.env.WEB_LOOM_ENDPOINT || "",
  allowedOrigins = (process.env.WEB_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
} = {}) {
  const origins = new Set(
    allowedOrigins.map((value) => {
      const url = new URL(value);
      if (!["https:", "http:"].includes(url.protocol) || url.origin !== value)
        throw new Error(
          "WEB_ALLOWED_ORIGINS must contain exact HTTP(S) origins.",
        );
      return url.origin;
    }),
  );
  const town = new URL(townOrigin);
  const loom = loomEndpoint ? new URL(loomEndpoint) : null;
  for (const url of [town, loom].filter(Boolean)) {
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        "Web upstream must be an HTTP(S) URL without credentials, query or fragment.",
      );
  }
  const endpoint = loom ? loom.origin + loom.pathname.replace(/\/+$/, "") : "";
  return async (
    req,
    res,
    next = () => {
      res.writeHead(404);
      res.end();
    },
  ) => {
    const requestUrl = new URL(req.url || "/", "http://localhost");
    const json = (status, value) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    const prefix = requestUrl.pathname.startsWith("/town-api/")
      ? "/town-api"
      : requestUrl.pathname.startsWith("/loom-api/")
        ? "/loom-api"
        : "";
    if (!prefix && requestUrl.pathname !== "/_web/config") return next();
    const allowed =
      typeof req.headers.origin === "string" && origins.has(req.headers.origin);
    if (allowed) {
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
      res.setHeader("Vary", "Origin");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, X-Relay-Secret",
      );
      res.setHeader("Access-Control-Max-Age", "600");
    }
    if (req.headers["sec-fetch-site"] === "cross-site" && !allowed)
      return json(403, { error: "Cross-site proxy request rejected." });
    if (req.headers.origin) {
      try {
        if (new URL(req.headers.origin).host !== req.headers.host && !allowed)
          return json(403, { error: "Origin rejected." });
      } catch {
        return json(403, { error: "Origin rejected." });
      }
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (requestUrl.pathname === "/_web/config")
      return json(200, { loomEndpoint: endpoint });
    const route = requestUrl.pathname.slice(prefix.length);
    if (
      !(
        route === "/api" ||
        route.startsWith("/api/") ||
        (prefix === "/loom-api" && route === "/health")
      ) ||
      !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(req.method || "")
    )
      return json(400, { error: "Unsupported API request." });
    if (prefix === "/loom-api" && !loom)
      return json(503, { error: "WEB_LOOM_ENDPOINT is not configured." });
    const target = new URL(
      (prefix === "/town-api" ? town.origin : endpoint) +
        route +
        requestUrl.search,
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const abort = () => controller.abort();
    req.on("aborted", abort);
    res.on("close", abort);
    const headers = new Headers();
    for (const name of [
      "accept",
      "content-type",
      "authorization",
      "x-relay-secret",
    ])
      if (typeof req.headers[name] === "string")
        headers.set(name, req.headers[name]);
    let bytes = 0;
    const limiter = new Transform({
      transform(chunk, encoding, callback) {
        bytes += chunk.length;
        if (bytes > 32 * 1024 * 1024)
          callback(new Error("Request exceeds 32 MiB."));
        else callback(null, chunk);
      },
    });
    try {
      const upstream = await fetch(target, {
        method: req.method,
        headers,
        redirect: "manual",
        signal: controller.signal,
        ...(req.method !== "GET"
          ? { body: req.pipe(limiter), duplex: "half" }
          : {}),
      });
      clearTimeout(timeout);
      if (upstream.status >= 300 && upstream.status < 400) {
        await upstream.body?.cancel();
        return json(502, { error: "Upstream redirect rejected." });
      }
      res.writeHead(upstream.status, {
        "Content-Type":
          upstream.headers.get("content-type") || "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff",
      });
      res.flushHeaders();
      if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), res);
      else res.end();
    } catch {
      if (!res.headersSent && !res.destroyed)
        json(502, { error: "上游连接未完成，请检查服务地址或网络后重试。" });
      else res.destroy();
    } finally {
      clearTimeout(timeout);
      req.unpipe(limiter);
      req.off("aborted", abort);
      res.off("close", abort);
    }
  };
}
