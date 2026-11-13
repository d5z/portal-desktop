import { createPublicKey, verify } from 'node:crypto';
export const HOME_ORIGIN = 'https://home.beings.town';
export const HOME_CLIENT = 'being-desktop';
export const HOME_CALLBACK = 'http://127.0.0.1:47831/oauth/callback';
export const HOME_REQUIRED_SCOPE = 'openid offline_access being:read being:write account:write files:read computer:read computer:write computer:connect';
export class HomeError extends Error {
  constructor(public status: number, public code: string) { super(homeErrorMessage(status, code)); }
}
export function homeErrorMessage(status: number, code = '') {
  if (code === 'kit_connector_management_disabled') return '当前环境未开放 Connector Kit 快捷管理。';
  if (code === 'kit_connector_full_plan_required') return '此应用需要完整安装流程，暂不支持快捷连接。';
  if (code === 'kit_connector_enable_changed' || code === 'needs_auth') return '账号或应用范围已变化，请返回详情重新核对。';
  if (code === 'kit_connector_enable_in_progress') return '连接或安装正在处理中，请稍后刷新状态。';
  if (code === 'kit_operation_changed') return '应用状态已变化，本次操作未提交，请核对最新状态后重试。';
  if (code === 'kit_operation_in_progress') return '此应用有尚未完成的安装或变更任务，本次操作未提交，请稍后重试。';
  if (code === 'kit_installation_removed') return '此应用已断开，请重新连接后再启用。';
  if (code === 'kit_heart_binding_required') return '请先在电脑栏关联当前 Being，再恢复工具授权。';
  if (code === 'kit_being_grant_changed') return '工具授权已变化，请刷新后重试。';
  if (code === 'connector_account_identity_missing') return '尚未识别第三方账号，请重新连接并完成账号授权。';
  if (code === 'kit_connection_auth_unavailable') return '当前没有可用的账号认证方式，请检查服务端配置。';
  if (code === 'invalid_path') return '文件路径无效，请返回工作区重新选择。';
  if (code === 'invalid_grant' || status === 401) return '登录已过期，请重新连接 Being Home。';
  if (status === 0 || code === 'network') return '网络连接失败，请检查网络后重试。';
  if (status === 400 || status === 422) return '请求参数无效，请返回详情重新操作。';
  if (status === 404) return '应用或连接不存在，请刷新后重试。';
  if (code === 'insufficient_scope') return 'Home 登录缺少所需权限，请在「电脑」栏退出 Home 后重新登录，授权全部权限。';
  if (status === 403) return '当前账号没有所需权限，请重新连接并授权。';
  if (status === 409) return '当前状态与此操作冲突，请核对最新状态后重试。';
  if (status === 429) return '请求过于频繁，请稍后重试。';
  if (status === 507) return '云端存储空间已满。';
  if (code === 'storage_not_ready') return '云端存储正在准备，请稍后刷新。';
  if (status === 503) return '云电脑服务暂不可用，请稍后重试。';
  return '连接失败，请检查网络后重试。';
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
