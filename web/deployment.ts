export interface WebDeployment {
  mode: "server" | "static";
  apiBase: string;
  townOrigin?: string;
}
export function parseDeployment(value: unknown, origin: string): WebDeployment {
  const data = value as Record<string, unknown> | null;
  if (!data || !["server", "static"].includes(String(data.mode)))
    throw new Error("网站连接配置无效。");
  if (typeof data.apiBase !== "string") throw new Error("网站 API 地址无效。");
  let apiBase = "";
  if (data.apiBase) {
    const url = new URL(data.apiBase, origin);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol === "http:" &&
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
      throw new Error("网站 API 地址须为 HTTPS 地址。");
    apiBase = url.href.replace(/\/+$/, "");
  }
  let townOrigin: string | undefined;
  if (data.townOrigin !== undefined) {
    if (typeof data.townOrigin !== "string") throw new Error("Town 地址无效。");
    const url = new URL(data.townOrigin);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error("Town 地址须为 HTTPS 域名。");
    townOrigin = url.origin;
  }
  return {
    mode: data.mode as WebDeployment["mode"],
    apiBase,
    ...(townOrigin ? { townOrigin } : {}),
  };
}
let pending: Promise<WebDeployment> | undefined;
export function loadDeployment(): Promise<WebDeployment> {
  return (pending ??= fetch("./web-config.json", {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error("网站连接配置加载失败，请刷新重试。");
      return parseDeployment(await response.json(), location.origin);
    })
    .catch((error) => {
      pending = undefined;
      throw error;
    }));
}
