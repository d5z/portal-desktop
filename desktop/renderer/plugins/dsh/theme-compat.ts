// VS Code Themes 1.x persists its own selection and reasserts it for six seconds
// after mounting. Keep an explicit Town selection in that same record so reload
// cannot resurrect the old theme. Its browser accepts an unregistered built-in
// id as "no custom card selected"; choosing a card writes its id before setTheme.
const vscodeSelection = 'dsh.vscodeThemes.selected';
export function rememberClientTheme(scheme: 'light' | 'dark') {
  try { if (localStorage.getItem(vscodeSelection) !== null) localStorage.setItem(vscodeSelection, scheme); } catch { /* Optional preference. */ }
}
export function isStaleThemeRestore(id: string) {
  if (!id.startsWith('vscode-')) return false;
  try { return ['light', 'dark'].includes(localStorage.getItem(vscodeSelection) || ''); } catch { return false; }
}
