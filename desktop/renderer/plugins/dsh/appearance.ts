import { CHAT_THEME_COLORS } from '../../shared/plugin-appearance';
/** Pass visual tokens to the isolated Being frame without exposing its DOM to plugins. */
export function observeDshAppearance() {
  let frame = 0, previous = '';
  const publish = () => {
    frame = 0;
    const body = document.body;
    if (!body.hasAttribute('data-town-dsh')) return;
    const style = getComputedStyle(body);
    // Legacy wallpaper injectors opt out of the base fill without registering a
    // palette. Preserve that independent contribution when a custom theme ends.
    const wallpaper = style.getPropertyValue('--dsw-alias-bg-base').trim() === 'transparent';
    body.toggleAttribute('data-town-dsh-wallpaper', wallpaper);
    const colors: Record<string, string> = {};
    if (body.hasAttribute('data-town-dsh-theme')) for (const [target, source] of Object.entries(CHAT_THEME_COLORS)) {
      const value = style.getPropertyValue(source).trim();
      if (value.length < 256 && CSS.supports('color', value)) colors[target] = value;
    }
    if (wallpaper) colors['--bg'] = 'transparent';
    const theme = document.documentElement.dataset.theme;
    const fonts = { '--font-sans': style.getPropertyValue('--dsh-font-family-text').trim() || style.getPropertyValue('--dsw-font-family').trim(), '--mono': style.getPropertyValue('--dsh-font-family-code').trim() || style.getPropertyValue('--ds-font-family-code').trim() };
    const data = { type: 'beings:dsh-appearance', colors, fonts, theme };
    const serialized = JSON.stringify(data);
    if (serialized === previous) return; previous = serialized;
    document.querySelector<HTMLIFrameElement>('#chat-frame')?.contentWindow?.postMessage(data, '*');
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(publish); };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-town-dsh', 'data-town-dsh-theme'] });
  observer.observe(document.head, { childList: true, subtree: true, characterData: true });
  const receive = (event: MessageEvent) => {
    const chat = document.querySelector<HTMLIFrameElement>('#chat-frame');
    if (event.source === chat?.contentWindow && event.data?.type === 'beings:appearance-request') { previous = ''; schedule(); }
  };
  window.addEventListener('message', receive); schedule();
  return () => { observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('message', receive); };
}
