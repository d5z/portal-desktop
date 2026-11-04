import type { KeyboardEvent } from "react";

/** Roving tabs share one keyboard contract across settings and Town. */
export function navigateTabs(event: KeyboardEvent<HTMLElement>) {
  if (!(event.target instanceof HTMLButtonElement) || event.target.getAttribute("role") !== "tab") return;
  const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(':scope > [role="tab"]:not(:disabled)')];
  const current = tabs.indexOf(event.target);
  if (current < 0 || !tabs.length) return;
  const vertical = event.currentTarget.getAttribute("aria-orientation") === "vertical";
  const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
    : event.key === (vertical ? "ArrowDown" : "ArrowRight") ? (current + 1) % tabs.length
    : event.key === (vertical ? "ArrowUp" : "ArrowLeft") ? (current + tabs.length - 1) % tabs.length : -1;
  if (next < 0) return;
  event.preventDefault();
  tabs[next].click();
  tabs[next].focus();
}
