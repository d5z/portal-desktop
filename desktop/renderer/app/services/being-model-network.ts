export function beingModelRequest(endpoint: string | undefined, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (endpoint) headers.set('X-Portal-Being-Endpoint', endpoint);
  return fetch(`beings://chat${path}`, { ...init, headers, credentials: 'omit', cache: 'no-store' });
}
