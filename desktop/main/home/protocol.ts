import { createPublicKey, verify } from 'node:crypto';
export const HOME_ORIGIN = 'https://home.beings.town';
export const HOME_CLIENT = 'being-desktop';
export const HOME_CALLBACK = 'http://127.0.0.1:47831/oauth/callback';
export const HOME_SCOPE = 'openid offline_access being:read being:write account:write files:read computer:read computer:write computer:connect';
export class HomeError extends Error {
  constructor(public status: number, public code: string) { super(homeErrorMessage(status, code)); }
}
export function homeErrorMessage(status: number, code = '') {
  if (code === 'invalid_path') return '文件路径无效，请返回工作区重新选择。';
  if (code === 'invalid_grant' || status === 401) return '登录已过期，请重新连接 Being Home。';
  if (status === 403) return '当前账号没有所需权限，请重新连接并授权。';
  if (status === 409) return '电脑或账号正在处理其他操作，请刷新状态后重试。';
  if (status === 429) return '请求过于频繁，请稍后重试。';
  if (status === 507) return '云端存储空间已满。';
  if (code === 'storage_not_ready') return '云端存储正在准备，请稍后刷新。';
  if (status === 503) return '云电脑服务暂不可用，请稍后重试。';
  return '无法完成 Being Home 请求，请检查网络后重试。';
}
export function homeURL(value: string) {
  const url = new URL(value, HOME_ORIGIN);
  if (url.origin !== HOME_ORIGIN || url.username || url.password || url.hash) throw new Error('Being Home 返回了无效地址。');
  return url;
}
export function ticketURL(ticket: { ticket: string; expires_at: string; connect_url: string }, now = Date.now()) {
  const url = homeURL(ticket.connect_url);
  const expires = Date.parse(ticket.expires_at);
  if (url.pathname !== '/desktop/connect' || [...url.searchParams.keys()].join(',') !== 'ticket' ||
      !ticket.ticket || url.searchParams.get('ticket') !== ticket.ticket || !Number.isFinite(expires) || expires <= now)
    throw new Error('云电脑连接已失效，请重新打开。');
  return url.href;
}
export function viewerNavigation(value: string, computerId: string) {
  try {
    const url = homeURL(value);
    return (url.pathname === '/desktop/connect' && [...url.searchParams.keys()].join(',') === 'ticket') ||
      (url.pathname === `/desktop/${computerId}/` && !url.search);
  } catch { return false; }
}
export function verifyIdentityToken(token: string, keys: { keys: JsonWebKey[] }, nonce: string, now = Date.now()) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error();
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    const key = keys.keys.find(key => (key as JsonWebKey & { kid?: string }).kid === header.kid && key.kty === 'RSA');
    if (header.alg !== 'RS256' || !key || !verify('RSA-SHA256', Buffer.from(parts.slice(0, 2).join('.')),
      createPublicKey({ key: key as import('node:crypto').JsonWebKey, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) throw new Error();
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== `${HOME_ORIGIN}/oidc/` || !audience.includes(HOME_CLIENT) ||
        (audience.length > 1 && claims.azp !== HOME_CLIENT) || claims.nonce !== nonce ||
        typeof claims.sub !== 'string' || !claims.sub || typeof claims.exp !== 'number' || claims.exp * 1000 <= now ||
        typeof claims.iat !== 'number' || claims.iat * 1000 > now + 60_000) throw new Error();
    return claims.sub as string;
  } catch { throw new Error('无法验证 Being Home 登录，请重新连接。'); }
}
