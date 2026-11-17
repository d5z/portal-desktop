export function positionActionMenu(trigger: HTMLElement, menu: HTMLElement) {
  const bounds = trigger.getBoundingClientRect();
  const above = bounds.bottom + menu.offsetHeight + 14 > innerHeight && bounds.top > innerHeight - bounds.bottom;
  const top = above ? bounds.top - menu.offsetHeight - 6 : bounds.bottom + 6;
  const left = Math.max(8, Math.min(bounds.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(8, Math.min(top, innerHeight - menu.offsetHeight - 8))}px`;
  menu.style.transformOrigin = `${bounds.left + bounds.width / 2 - left}px ${above ? 'bottom' : 'top'}`;
}
