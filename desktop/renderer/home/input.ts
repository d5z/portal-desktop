import type { BrowserState } from '../../shared/home-viewer';
export function framePoint(x: number, y: number, bounds: { left: number; top: number; width: number; height: number }, state: BrowserState,
  pixels: { width: number; height: number }) {
  const width = state.view_mode === 'native' ? state.frame_width : 1280;
  const height = state.view_mode === 'native' ? state.frame_height : 720;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || width > 4096 || height < 1 || height > 2160 ||
    width !== pixels.width || height !== pixels.height || !bounds.width || !bounds.height) return null;
  const px = Math.floor((x - bounds.left) * width / bounds.width), py = Math.floor((y - bounds.top) * height / bounds.height);
  return px >= 0 && py >= 0 && px < width && py < height ? { x: px, y: py } : null;
}
export function keyModifiers(event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>, native: boolean) {
  return (event.altKey ? 1 : 0) | (event.ctrlKey || (native && event.metaKey) ? 2 : 0) | (event.metaKey && !native ? 4 : 0) | (event.shiftKey ? 8 : 0);
}
