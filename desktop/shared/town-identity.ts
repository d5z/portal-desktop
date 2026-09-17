// Town IDs are opaque and case-sensitive; legacy Being names are lowercase.
export const normalizeTownIdentity = (value: string) => {
  const identity = value.trim();
  return identity.startsWith('t_') ? identity : identity.toLowerCase();
};
export const validTownIdentity = (value: unknown): value is string =>
  typeof value === 'string' && (value.startsWith('t_')
    ? /^t_[a-zA-Z0-9_-]{1,62}$/.test(value)
    : /^[a-z0-9_-]{1,64}$/.test(value));
// Display metadata is optional and never participates in authentication.
export const normalizeTownDisplay = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 400) : '';

// Town sometimes returns a convenient `name (town_id)` label. That is useful
// in connection settings, but the product header should follow the display
// name and must not expose the opaque identity as part of the name.
export const townDisplayName = (value: unknown, identity = ''): string => {
  const display = normalizeTownDisplay(value)
    .replace(/\s*\(t_[a-zA-Z0-9_-]+\)\s*$/, '')
    .trim();
  if (!display || /^@?t_[a-zA-Z0-9_-]+$/.test(display) || display === identity)
    return '';
  return display;
};
