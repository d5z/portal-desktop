import type { CSSProperties } from "react";

export type IconName =
  | "chat"
  | "town"
  | "discover"
  | "settings"
  | "fire"
  | "people"
  | "mail"
  | "leaf"
  | "book"
  | "scroll"
  | "grid"
  | "arrow"
  | "back"
  | "chevron"
  | "sun"
  | "moon"
  | "search"
  | "sliders"
  | "link"
  | "type"
  | "info"
  | "install"
  | "refresh"
  | "more";
const paths: Record<IconName, React.ReactNode> = {
  refresh: (
    <>
      <path d="M20 7v5h-5M4 17v-5h5" />
      <path d="M6.1 6.1A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.9 5.9" />
    </>
  ),
  install: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="4" />
      <path d="M12 7v8m-3-3 3 3 3-3M9 18h6" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  chat: (
    <path d="M21 11.5a8.3 8.3 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.3 8.3 0 0 1-3.8-.9L3 21l1.9-5.7a8.3 8.3 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.3 8.3 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" />
  ),
  town: (
    <>
      <path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7" />
      <path d="M10 9h4" />
    </>
  ),
  discover: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m16.3 7.7-2.6 6-6 2.6 2.6-6 6-2.6Z" />
    </>
  ),
  settings: (
    <>
      <path d="m9.2 3-.6 2.1-1.5.9L5 5.5 2.8 9.3l1.5 1.6v2.2l-1.5 1.6L5 18.5l2.1-.5 1.5.9.6 2.1h5.6l.6-2.1 1.5-.9 2.1.5 2.2-3.8-1.5-1.6v-2.2l1.5-1.6L19 5.5l-2.1.5-1.5-.9-.6-2.1Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  fire: (
    <path d="M13 3c1 5-4 5-4 9 0 1 1 2 2 2 0-3 3-3 4-6 4 4 5 6 4 9a7 7 0 0 1-13-1C5 11 9 9 13 3Z" />
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v3" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="m3 7 9 6 9-6" />
    </>
  ),
  leaf: (
    <>
      <path d="M12 21V11M12 15C5 15 3 11 3 6c6 0 9 3 9 9ZM12 11c0-6 3-9 9-9 0 6-3 9-9 9Z" />
    </>
  ),
  book: (
    <path d="M12 5v16M12 5C9 3 6 3 3 4v15c3-1 6-1 9 2 3-3 6-3 9-2V4c-3-1-6-1-9 1Z" />
  ),
  scroll: (
    <>
      <path d="M7 3h12a2 2 0 0 1 2 2v3h-4V5a2 2 0 0 1 4 0M7 3a2 2 0 0 0-2 2v14a2 2 0 0 1-4 0v-3h12v3a2 2 0 0 0 4 0V7M3 21h12M8 8h5M8 12h5" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </>
  ),
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  back: <path d="m14 6-6 6 6 6" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5" />
    </>
  ),
  moon: <path d="M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h7m4 0h5M4 17h3m4 0h9" />
      <circle cx="13" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  link: (
    <>
      <path
        d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"
        transform="translate(1 0) scale(.9)"
      />
    </>
  ),
  type: <path d="m3 19 6-14 6 14M5 15h8m3-2h6m-3-3v9" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10v.1" />
    </>
  ),
};
export function Icon({
  name,
  size = 22,
  style,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      {paths[name]}
    </svg>
  );
}
