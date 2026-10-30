/** Deliberately small independent rule reviewer. It cannot authorize host code or file writes. */
const DOCUMENTATION_HOSTS = new Set([
  'developer.mozilla.org', 'learn.microsoft.com', 'doc.rust-lang.org',
  'docs.python.org', 'nodejs.org', 'www.typescriptlang.org',
]);

export function reviewPortalOperation(value: { tool: string; isolation?: unknown; arguments: Record<string, unknown> }): 'allow' | 'ask' {
  if (value.tool !== 'portal_web_fetch' || value.isolation !== 'public-web-read') return 'ask';
  if (Object.keys(value.arguments).some(key => !['url', 'max_chars'].includes(key))) return 'ask';
  if (typeof value.arguments.url !== 'string' || value.arguments.url.length > 1024) return 'ask';
  try {
    const url = new URL(value.arguments.url);
    // No arbitrary hosts, credentials, query strings, fragments or custom ports.
    // Portal additionally pins public DNS addresses and disallows cross-origin redirects.
    if (url.protocol !== 'https:' || !DOCUMENTATION_HOSTS.has(url.hostname) || url.port ||
        url.username || url.password || url.search || url.hash) return 'ask';
    return 'allow';
  } catch { return 'ask'; }
}
