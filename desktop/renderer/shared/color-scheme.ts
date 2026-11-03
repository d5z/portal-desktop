export type ColorScheme = 'light' | 'dark';
type ThemeController = { current(): ColorScheme; select(scheme: ColorScheme): void; active(): boolean };
let controller: ThemeController | undefined;

/** One owner for the rendered scheme. Reading size and navigation never select a theme. */
export function renderedColorScheme(fallback: ColorScheme): ColorScheme {
  return controller?.active() ? controller.current() : fallback;
}
export function presentColorScheme(scheme: ColorScheme) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = scheme;
  document.documentElement.style.colorScheme = scheme;
  document.body.toggleAttribute('data-ds-dark-theme', scheme === 'dark');
}
export function selectColorScheme(scheme: ColorScheme) {
  if (controller?.active()) controller.select(scheme);
  else presentColorScheme(scheme);
}
export function bindThemeController(next: ThemeController) {
  controller = next;
  return () => { if (controller === next) controller = undefined; };
}
