type Data = Record<string, unknown>;

// Reconcile the server's complete recent window, including edits and removals.
// Stable message objects let React reuse unchanged rows after a refresh.
export function shareTownData(previous: Data | null | undefined, next: Data): Data {
  if (!previous) return next;
  const merged = { ...next };
  for (const key of Object.keys(next)) {
    const before = previous[key], after = next[key];
    if (JSON.stringify(before) === JSON.stringify(after)) merged[key] = before;
    else if (key === 'messages' && Array.isArray(before) && Array.isArray(after)) {
      const identity = (value: unknown) => {
        const entry = value && typeof value === 'object' ? value as Data : {};
        return String(entry.id ?? entry.message_id ?? entry.seq ?? '');
      };
      const entries = new Map(before.map(value => [identity(value), value]));
      merged[key] = after.map(value => {
        const old = entries.get(identity(value));
        return identity(value) && old && JSON.stringify(old) === JSON.stringify(value) ? old : value;
      });
    }
  }
  return Object.keys(previous).length === Object.keys(next).length &&
    Object.keys(next).every(key => merged[key] === previous[key]) ? previous : merged;
}

// Session-only and bounded: no private content is persisted to disk.
export function cacheTownData<T>(cache: Map<string, T>, key: string, value: T) {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > 12) cache.delete(cache.keys().next().value!);
}
