/** Explicit transport contract between the shell palette and the isolated chat. */
export const CHAT_THEME_COLORS: Record<string, string> = {
  '--bg': '--bg', '--bg-soft': '--surface', '--bg-softer': '--message-surface',
  '--text': '--text', '--text-dim': '--secondary', '--text-muted': '--muted',
  '--text-ghost': '--muted', '--border': '--line', '--accent': '--theme-brand',
  '--accent-border': '--selection-edge', '--hover-overlay': '--hover',
  '--pressed-overlay': '--pressed', '--accent-tint': '--selected', '--surface-tint': '--hover',
  '--chat-reply': '--message-surface', '--chat-sent': '--selected', '--green': '--green',
};

export function applyPluginAppearance(data: { colors: Record<string, unknown>; fonts?: Record<string, unknown> }) {
  const root = document.documentElement;
  for (const name of Object.keys(CHAT_THEME_COLORS)) {
    const value = data.colors[name];
    if (typeof value === 'string' && value.length < 256 && CSS.supports('color', value)) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }
  root.toggleAttribute('data-plugin-theme', Object.keys(data.colors).length > 0);
  for (const name of ['--font-sans', '--mono']) {
    const value = data.fonts?.[name];
    if (typeof value === 'string' && value && value.length < 1024 && CSS.supports('font-family', value)) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }
}
