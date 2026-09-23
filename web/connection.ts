import { loadDeployment } from "./deployment";
import { readCredential, writeCredential } from "./credential-storage";
export interface WebConnection {
  api: string;
  token: string;
  relaySecret: string;
  name: string;
  endpoint: string;
}
export const CONNECTION_KEY = "town-web:connection";
export function saveConnection(connection: WebConnection | null): void {
  writeCredential(CONNECTION_KEY, connection);
}
export function parseWebConnection(value: string): WebConnection {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("请输入完整的 Loom 链接。");
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Loom 链接必须是 HTTP 或 HTTPS 地址。");
  if (
    url.protocol === "http:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error("远程 Being 请使用 HTTPS 链接。");
  const token = url.searchParams.get("token") || "";
  if (!token || token.length > 4096)
    throw new Error("Loom 链接需要包含有效的 token。");
  const relaySecret =
    url.searchParams.get("relay_secret") ||
    url.searchParams.get("secret") ||
    token;
  const endpoint = url.origin + url.pathname.replace(/\/+$/, "");
  const name = decodeURIComponent(
    url.pathname.split("/").filter(Boolean).at(-1) || "Being",
  );
  return { api: endpoint, endpoint, name, token, relaySecret };
}
export function readConnection(): WebConnection | null {
  try {
    const saved = readCredential(
      CONNECTION_KEY,
    ) as Partial<WebConnection> | null;
    if (!saved || typeof saved.endpoint !== "string") return null;
    const parsed = parseWebConnection(
      `${saved.endpoint}?token=${encodeURIComponent(saved.token || "")}`,
    );
    return {
      ...parsed,
      relaySecret:
        typeof saved.relaySecret === "string"
          ? saved.relaySecret
          : parsed.token,
    };
  } catch {
    return null;
  }
}
export async function deploymentConnection(connection: WebConnection) {
  const deployment = await loadDeployment();
  if (deployment.mode === "static" && !deployment.apiBase) return connection;
  try {
    const response = await fetch(deployment.apiBase + "/_web/config", {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const config = await response.json();
    if (response.ok && config.loomEndpoint === connection.endpoint)
      return {
        ...connection,
        api: (deployment.apiBase || location.origin) + "/loom-api",
      };
  } catch {
    /* Static hosts can use a CORS-enabled Loom directly. */
  }
  return connection;
}
