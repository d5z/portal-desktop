// Keep connections across standalone-app launches. A null marker prevents a
// disconnected credential from being restored by an older tab's session copy.
export function readCredential(key: string): unknown {
  try {
    const saved = localStorage.getItem(key);
    if (saved !== null) return JSON.parse(saved);
  } catch {
    /* An existing session can still be read if storage is unavailable. */
  }
  try {
    const legacy = sessionStorage.getItem(key);
    if (!legacy) return null;
    const value: unknown = JSON.parse(legacy);
    try {
      localStorage.setItem(key, legacy);
      sessionStorage.removeItem(key);
    } catch {
      /* Keep the session copy until migration succeeds. */
    }
    return value;
  } catch {
    return null;
  }
}

export function writeCredential(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error("无法在此设备保存连接，请允许网站存储后重试。");
  }
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* Durable copy is authoritative. */
  }
}
