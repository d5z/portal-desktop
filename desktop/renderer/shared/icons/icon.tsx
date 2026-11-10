import type { ComponentProps } from 'react';

const glyphs = {
  'trash': { viewBox: '0 0 24 24', content: (<><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7" /></>) },
  'panel-expand': { viewBox: '0 0 24 24', content: (<><rect x="3" y="4" width="18" height="16" rx="4"/><path d="M8 8v8" strokeWidth="3" strokeLinecap="round"/></>) },
  'close': { viewBox: '0 0 24 24', content: (<><path d="m6 6 12 12M18 6 6 18"/></>) },
  'edit': { viewBox: '0 0 24 24', content: (<><path d="m15 4 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14l-1 7Z" /></>) },
  'chevron-down-20': { viewBox: '0 0 20 20', content: (<><path d="m5 7 5 5 5-5" /></>) },
  'search-20': { viewBox: '0 0 20 20', content: (<><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></>) },
  'split-panel': { viewBox: '0 0 24 24', content: (<><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /></>) },
  'chat-history': { viewBox: '0 0 24 24', content: (<><path d="M20 11.5a8 8 0 0 1-8 8H4l1.7-3.4A8 8 0 1 1 20 11.5Z"/><path d="M8 9h8M8 13h5"/></>) },
  'search-wide': { viewBox: '0 0 24 24', content: (<><circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/></>) },
  'chat-outline': { viewBox: '0 0 24 24', content: (<><path d="M21 11.5a9 9 0 0 1-9 8.5 10 10 0 0 1-4-.8L3 21l1.7-4.5A8 8 0 0 1 3 11.5a9 9 0 0 1 18 0Z"/></>) },
  'disclosure-down': { viewBox: '0 0 20 20', content: (<><path d="m5 8 5 5 5-5" /></>) },
  'sync': { viewBox: '0 0 24 24', content: (<><path d="M20 11a8 8 0 0 0-14.9-3.9L3 9m0 0V4m0 5h5M4 13a8 8 0 0 0 14.9 3.9L21 15m0 0v5m0-5h-5" /></>) },
  'sliders': { viewBox: '0 0 24 24', content: (<><path d="M4 8h16M4 16h16M8 5v6m8 2v6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></>) },
  'chevron-right-20': { viewBox: '0 0 20 20', content: (<><path d="m8 5 5 5-5 5" /></>) },
  'update-download': { viewBox: '0 0 24 24', content: (<><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 18v2h14v-2" /></>) },
  'more-filled': { viewBox: '0 0 24 24', content: (<><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></>) },
  'volume': { viewBox: '0 0 24 24', content: (<><path d="M11 4 6 8H3v8h3l5 4zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></>) },
  'playback-speed': { viewBox: '0 0 24 24', content: (<><path d="M12 3a9 9 0 1 0 9 9M16 4l3 3m2 2v1M12 7v5l3 3"/></>) },
  'folder': { viewBox: '0 0 24 24', content: (<><path d="M3 6h7l2 3h9v11H3z"/></>) },
  'file-text-tall': { viewBox: '0 0 24 28', content: (<><rect x="4" y="2" width="16" height="24" rx="4" stroke="currentColor" strokeWidth="1.6"/><path d="M8 9h8M8 14h6M8 19h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></>) },
  'plus': { viewBox: '0 0 24 24', content: (<><path d="M12 5v14M5 12h14"/></>) },
  'arrow-up-right-16': { viewBox: '0 0 16 16', content: (<><path d="M4 12 12 4M4 4h8v8"/></>) },
  'download': { viewBox: '0 0 24 24', content: (<><path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4"/></>) },
  'image-rounded': { viewBox: '0 0 24 24', content: (<><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="9" cy="9" r="1.5"/><path d="m4 17 5-5 4 4 3-3 4 4"/></>) },
  'sparkles': { viewBox: '0 0 32 32', content: (<><path d="M16 5c1.6 7 4 9.4 11 11-7 1.6-9.4 4-11 11C14.4 20 12 17.6 5 16c7-1.6 9.4-4 11-11Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M26 3v6M23 6h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></>) },
  'chevron-down-centered-20': { viewBox: '0 0 20 20', content: (<><path d="m5 7.5 5 5 5-5" /></>) },
  'chat-loading': { viewBox: '0 0 32 32', content: (<><path d="M8 8.5h16a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H13l-6 4v-4a3 3 0 0 1-3-3v-10a3 3 0 0 1 3-3Z"/><path d="M10 15h12M10 19h7"/></>) },
  'back-wide': { viewBox: '0 0 24 24', content: (<><path d="m15 5-7 7 7 7" /></>) },
  'search': { viewBox: '0 0 24 24', content: (<><circle cx="10.5" cy="10.5" r="6.5" />
                <path d="m16 16 4.5 4.5" /></>) },
  'chevron-down': { viewBox: '0 0 24 24', content: (<><path d="m7 10 5 5 5-5" /></>) },
  'grip': { viewBox: '0 0 16 20', content: (<><circle cx="4" cy="4" r="1.3"/><circle cx="10" cy="4" r="1.3"/><circle cx="4" cy="10" r="1.3"/><circle cx="10" cy="10" r="1.3"/><circle cx="4" cy="16" r="1.3"/><circle cx="10" cy="16" r="1.3"/></>) },
  'turn-right': { viewBox: '0 0 24 24', content: (<><path d="M4 5v5a3 3 0 0 0 3 3h13m-5-5 5 5-5 5" /></>) },
  'chevron-down-16': { viewBox: '0 0 16 16', content: (<><path d="m4 6 4 4 4-4"/></>) },
  'back': { viewBox: '0 0 24 24', content: (<><path d="m14 6-6 6 6 6" /></>) },
  'info-20': { viewBox: '0 0 20 20', content: (<><circle cx="10" cy="10" r="7.25" /><path d="M10 6.5v4M10 13h.01" /></>) },
  'plugin-navigation': { viewBox: '0 0 24 24', content: (<><path className="rail-icon-line" pathLength="100" d="M8 3h8v5h5v8h-5v5H8v-5H3V8h5V3Z" /></>) },
  'monitor': { viewBox: '0 0 24 24', content: (<><path d="M4 4h16v12H4zM8 20h8m-4-4v4" /></>) },
  'folder-flat': { viewBox: '0 0 24 24', content: (<><path d="M3 6h7l2 2h9v12H3z" /></>) },
  'terminal': { viewBox: '0 0 24 24', content: (<><path d="m5 8 4 4-4 4m8 0h6" /></>) },
  'plugin': { viewBox: '0 0 24 24', content: (<><path d="M8 3h8v5h5v8h-5v5H8v-5H3V8h5z" /></>) },
  'copy': { viewBox: '0 0 24 24', content: (<><rect x="4" y="8" width="12" height="13" rx="3"/><path d="M9 8V6a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3h-2"/></>) },
  'back-20': { viewBox: '0 0 20 20', content: (<><path d="m12.5 4.5-5.5 5.5 5.5 5.5" /></>) },
  'forward-20': { viewBox: '0 0 20 20', content: (<><path d="m7.5 4.5 5.5 5.5-5.5 5.5" /></>) },
  'chevron-left-20': { viewBox: '0 0 20 20', content: (<><path d="m12 5-5 5 5 5" /></>) },
  'edit-20': { viewBox: '0 0 20 20', content: (<><path d="m12.5 3.5 4 4M4 12l9-9a1.4 1.4 0 0 1 2 0l2 2a1.4 1.4 0 0 1 0 2l-9 9-5 1 1-5Z" /></>) },
  'refresh-20': { viewBox: '0 0 20 20', content: (<><path d="M16 6a7 7 0 1 0 1 7M16 2v5h-5" /></>) },
  'people-20': { viewBox: '0 0 20 20', content: (<><circle cx="7" cy="7" r="2.5" />
          <circle cx="13.5" cy="8" r="2" />
          <path d="M2.8 15c.5-2.6 2-3.9 4.3-3.9s3.9 1.3 4.4 3.9M11.4 12c.7-.7 1.5-1 2.5-1 1.8 0 2.9 1 3.3 3" /></>) },
  'sun-20': { viewBox: '0 0 20 20', content: (<><circle cx="10" cy="10" r="3.25" /><path d="M10 1.5v2m0 13v2M1.5 10h2m13 0h2M4 4l1.4 1.4m9.2 9.2L16 16M4 16l1.4-1.4m9.2-9.2L16 4" /></>) },
  'moon-20': { viewBox: '0 0 20 20', content: (<><path d="M16.8 12.1A7 7 0 0 1 7.9 3.2a7 7 0 1 0 8.9 8.9Z" /></>) },
  'pause-20': { viewBox: '0 0 20 20', content: (<><path d="M5 4h3v12H5zm7 0h3v12h-3z"/></>) },
  'play-20': { viewBox: '0 0 20 20', content: (<><path d="m6 3 11 7-11 7z"/></>) },
  'external-link': { viewBox: '0 0 24 24', content: (<><path d="M14 3h7v7m0-7L10 14M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/></>) },
  'download-tray': { viewBox: '0 0 24 24', content: (<><path d="M12 3v12m-5-5 5 5 5-5M5 8H3v12h18V8h-2"/></>) },
  'stop': { viewBox: '0 0 24 24', content: (<><rect x="7" y="7" width="10" height="10" rx="2"/></>) },
  'send': { viewBox: '0 0 24 24', content: (<><path d="M12 20V4m-7 7 7-7 7 7"/></>) },
  'check-16': { viewBox: '0 0 16 16', content: (<><path d="m3 8 3 3 7-7" /></>) },
  'copy-16': { viewBox: '0 0 16 16', content: (<><rect x="5" y="5" width="8" height="9" rx="1.5" /><path d="M10 3V2H2v9h1" /></>) },
  'disclosure-up': { viewBox: '0 0 20 20', content: (<><path d="m5 12 5-5 5 5" /></>) },
  'menu-settings': { viewBox: '0 0 24 24', content: (<><path d="M4 7h16M4 17h16M8 4v6m8 4v6" /></>) },
  'menu-help': { viewBox: '0 0 24 24', content: (<><path d="M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z" /></>) },
  'menu-update': { viewBox: '0 0 24 24', content: (<><path d="M19 7a8 8 0 1 0 1 8M19 3v5h-5" /></>) },
  'menu-logs': { viewBox: '0 0 24 24', content: (<><path d="M6 3h9l4 4v14H6V3Zm9 0v5h4M9 12h7m-7 4h5" /></>) },
  'menu-exit': { viewBox: '0 0 24 24', content: (<><path d="M10 4H4v16h6m4-12 4 4-4 4m-6-4h12" /></>) },
  'settings-being': { viewBox: '0 0 24 24', content: (<><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0" /></>) },
  'settings-portal': { viewBox: '0 0 24 24', content: (<><path d="M5 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm3 16h8m-4-4v4" /></>) },
  'settings-town': { viewBox: '0 0 24 24', content: (<><path d="m3 10 9-7 9 7M5 9v12h14V9m-9 12v-7h4v7" /></>) },
  'settings-models': { viewBox: '0 0 24 24', content: (<><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" /></>) },
  'settings-appearance': { viewBox: '0 0 24 24', content: (<><path d="M4 4h16v13H4V4Zm4 17h8m-4-4v4M8 8h8m-8 4h5" /></>) },
  'settings-plugins': { viewBox: '0 0 24 24', content: (<><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3Z"/></>) },
  'refresh': { viewBox: '0 0 24 24', content: (<><path d="M20 11a8 8 0 1 0-2.3 6.7M20 4v7h-7" /></>) },
  'expand': { viewBox: '0 0 24 24', content: (<><path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4" /></>) },
  'more': { viewBox: '0 0 24 24', content: (<><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>) },
  'directory': { viewBox: '0 0 24 24', content: (<><path d="M3 7V5h7l2 3h9v12H3V7Z" /></>) },
  'download-wide': { viewBox: '0 0 24 24', content: (<><path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4" /></>) },
  'refresh-library': { viewBox: '0 0 24 24', content: (<><path d="M20 10a8 8 0 1 0-2 8M20 4v6h-6" /></>) },
  'file': { viewBox: '0 0 24 24', content: (<><path d="M14 3H5v18h14V8l-5-5Zm0 0v6h5M8 13h8m-8 4h5" /></>) },
  'file-slides': { viewBox: '0 0 24 24', content: (<><path d="M14 3H5v18h14V8l-5-5Zm0 0v6h5"/><rect x="8" y="12" width="8" height="5" rx=".5"/><path d="M12 17v2m-2 0h4"/></>) },
  'file-sheet': { viewBox: '0 0 24 24', content: (<><path d="M14 3H5v18h14V8l-5-5Zm0 0v6h5"/><path d="M8 12h8v6H8zM8 15h8m-4-3v6"/></>) },
  'composer-file': { viewBox: '0 0 24 24', content: (<path d="m8 13 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l10-10M6 15l9-9"/>) },
  'composer-ui': { viewBox: '0 0 24 24', content: (<><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 10h18M10 10v10"/></>) },
  'composer-image': { viewBox: '0 0 24 24', content: (<><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/></>) },
  'composer-doc': { viewBox: '0 0 24 24', content: (<><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></>) },
  'composer-subagent': { viewBox: '0 0 24 24', content: (<><rect x="8" y="3" width="8" height="6" rx="2"/><path d="M12 9v4M6 16v-3h12v3"/><rect x="3" y="16" width="6" height="5" rx="1.5"/><rect x="15" y="16" width="6" height="5" rx="1.5"/></>) },
  'composer-example': { viewBox: '0 0 24 24', content: (<><path d="m9 5-6 7 6 7m6-14 6 7-6 7"/><path d="m13 5-2 14"/></>) },
  'composer-computer': { viewBox: '0 0 24 24', content: (<><rect x="3" y="3" width="18" height="13" rx="2"/><path d="M12 16v5M8 21h8"/></>) },
  'permission-read': { viewBox: '0 0 24 24', content: (<><rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6M9 12h6M9 16h3"/></>) },
  'permission-unlock': { viewBox: '0 0 24 24', content: (<><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M9 10V7a4 4 0 0 1 7-2M12 14v3"/></>) },
  'permission-shield': { viewBox: '0 0 24 24', content: (<><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/></>) },
  'activity-check': { viewBox: '0 0 16 16', content: (<path d="m3.5 8 3 3 6-6" />) },
  'activity-think': { viewBox: '0 0 16 16', content: (<path d="M6 11h4M6.5 13h3M5.5 9.5a4.5 4.5 0 1 1 5 0L10 11H6Z" />) },
  'activity-tool': { viewBox: '0 0 16 16', content: (<path d="m3.5 5 3 3-3 3M9 11h3.5" />) },
  'activity-error': { viewBox: '0 0 16 16', content: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 4.5v4M8 11h.01" />
    </>
  ) },
  'activity-stop': { viewBox: '0 0 16 16', content: (<path d="M4 8h8" />) },
  'activity-wait': { viewBox: '0 0 16 16', content: (<><circle cx="8" cy="8" r="5.5" /><path d="M8 4.5V8l2 1.5" /></>) },
  'activity-chevron': { viewBox: '0 0 16 16', content: (<path d="m6 4 4 4-4 4" />) },
  'web-refresh': { viewBox: '0 0 24 24', content: (
    <>
      <path d="M20 7v5h-5M4 17v-5h5" />
      <path d="M6.1 6.1A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.9 5.9" />
    </>
  ) },
  'web-install': { viewBox: '0 0 24 24', content: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="4" />
      <path d="M12 7v8m-3-3 3 3 3-3M9 18h6" />
    </>
  ) },
  'web-chat': { viewBox: '0 0 24 24', content: (
    <path d="M21 11.5a8.3 8.3 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.3 8.3 0 0 1-3.8-.9L3 21l1.9-5.7a8.3 8.3 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.3 8.3 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" />
  ) },
  'web-town': { viewBox: '0 0 24 24', content: (
    <>
      <path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7" />
      <path d="M10 9h4" />
    </>
  ) },
  'web-discover': { viewBox: '0 0 24 24', content: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m16.3 7.7-2.6 6-6 2.6 2.6-6 6-2.6Z" />
    </>
  ) },
  'web-settings': { viewBox: '0 0 24 24', content: (
    <>
      <path d="m9.2 3-.6 2.1-1.5.9L5 5.5 2.8 9.3l1.5 1.6v2.2l-1.5 1.6L5 18.5l2.1-.5 1.5.9.6 2.1h5.6l.6-2.1 1.5-.9 2.1.5 2.2-3.8-1.5-1.6v-2.2l1.5-1.6L19 5.5l-2.1.5-1.5-.9-.6-2.1Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ) },
  'web-fire': { viewBox: '0 0 24 24', content: (
    <path d="M13 3c1 5-4 5-4 9 0 1 1 2 2 2 0-3 3-3 4-6 4 4 5 6 4 9a7 7 0 0 1-13-1C5 11 9 9 13 3Z" />
  ) },
  'web-people': { viewBox: '0 0 24 24', content: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v3" />
    </>
  ) },
  'web-mail': { viewBox: '0 0 24 24', content: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="m3 7 9 6 9-6" />
    </>
  ) },
  'web-leaf': { viewBox: '0 0 24 24', content: (
    <>
      <path d="M12 21V11M12 15C5 15 3 11 3 6c6 0 9 3 9 9ZM12 11c0-6 3-9 9-9 0 6-3 9-9 9Z" />
    </>
  ) },
  'web-book': { viewBox: '0 0 24 24', content: (
    <path d="M12 5v16M12 5C9 3 6 3 3 4v15c3-1 6-1 9 2 3-3 6-3 9-2V4c-3-1-6-1-9 1Z" />
  ) },
  'web-scroll': { viewBox: '0 0 24 24', content: (
    <>
      <path d="M7 3h12a2 2 0 0 1 2 2v3h-4V5a2 2 0 0 1 4 0M7 3a2 2 0 0 0-2 2v14a2 2 0 0 1-4 0v-3h12v3a2 2 0 0 0 4 0V7M3 21h12M8 8h5M8 12h5" />
    </>
  ) },
  'web-grid': { viewBox: '0 0 24 24', content: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </>
  ) },
  'web-arrow': { viewBox: '0 0 24 24', content: (<path d="M5 12h14m-6-6 6 6-6 6" />) },
  'web-chevron': { viewBox: '0 0 24 24', content: (<path d="m9 6 6 6-6 6" />) },
  'web-sun': { viewBox: '0 0 24 24', content: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5" />
    </>
  ) },
  'web-moon': { viewBox: '0 0 24 24', content: (<path d="M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z" />) },
  'web-search': { viewBox: '0 0 24 24', content: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ) },
  'web-sliders': { viewBox: '0 0 24 24', content: (
    <>
      <path d="M4 7h7m4 0h5M4 17h3m4 0h9" />
      <circle cx="13" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ) },
  'web-link': { viewBox: '0 0 24 24', content: (
    <>
      <path
        d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"
        transform="translate(1 0) scale(.9)"
      />
    </>
  ) },
  'web-type': { viewBox: '0 0 24 24', content: (<path d="m3 19 6-14 6 14M5 15h8m3-2h6m-3-3v9" />) },
  'web-info': { viewBox: '0 0 24 24', content: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10v.1" />
    </>
  ) },
  'person': { viewBox: '0 0 24 24', content: (<><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></>) },
  'rail-bonfire': { viewBox: '0 0 24 24', content: (<path className="rail-icon-line" pathLength="100" d="M12 3c2 5 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 3-7 0 3 1 4 2 4 2-2 2-5 1-8Z" />) },
  'rail-firesides': { viewBox: '0 0 24 24', content: (<path className="rail-icon-line" pathLength="100" d="M4 5h16v11H9l-5 4V5Zm4 4h8m-8 3h5" />) },
  'rail-mail': { viewBox: '0 0 24 24', content: (<path className="rail-icon-line" pathLength="100" d="M3 6h18v13H3V6Zm0 1 9 7 9-7" />) },
  'rail-seeds': { viewBox: '0 0 24 24', content: (<path className="rail-icon-line" pathLength="100" d="M12 21V10m0 6C5 16 3 12 3 7c6 0 9 3 9 9Zm0-4c0-6 3-9 9-9 0 6-3 9-9 9Z" />) },
  'rail-embers': { viewBox: '0 0 24 24', content: (<path className="rail-icon-line" pathLength="100" d="M4 4h5v16H4V4Zm5 0h5v16H9m7-15 4-1 3 15-4 1-3-15Z" />) },
  'rail-scrolls': { viewBox: '0 0 24 24', content: (<path className="rail-icon-line" pathLength="100" d="M6 3h12v18H6V3Zm3 5h6m-6 4h6m-6 4h4" />) },
  'rail-kits': { viewBox: '0 0 24 24', content: (<path className="rail-icon-line" pathLength="100" d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm13 0v6m-3-3h6" />) },
  'rail-announcements': { viewBox: '0 0 24 24', content: (<path className="rail-icon-line" pathLength="100" d="M4 4h16v16H4V4Zm4 4h8m-8 4h8m-8 4h5" />) },
  'rail-contacts': { viewBox: '0 0 24 24', content: (<path className="rail-icon-line" pathLength="100" d="M5 3h16v18H5V3ZM2 7h4m-4 5h4m-4 5h4m5-8a2 2 0 1 0 4 0 2 2 0 1 0-4 0m-2 8v-1a4 4 0 0 1 8 0v1" />) },
  'rail-town': { viewBox: '0 0 24 24', content: (<path className="rail-icon-line" pathLength="100" d="m3 10 9-7 9 7M5 9v12h14V9m-9 12v-7h4v7" />) },
  'rail-chat': { viewBox: '0 0 24 24', content: (<path className="rail-icon-line" pathLength="100" d="M21 11.5a9 9 0 0 1-9 8.5 10 10 0 0 1-4-.8L3 21l1.7-4.5A8 8 0 0 1 3 11.5a9 9 0 0 1 18 0Z" />) },
  'rail-search': { viewBox: '0 0 24 24', content: (<path className="rail-icon-line" pathLength="100" d="m16 16 5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" />) },
  'rail-collapse': { viewBox: '0 0 24 24', content: (<path className="rail-icon-line" pathLength="100" d="m7 14 5-5 5 5" />) },
  'rail-more': { viewBox: '0 0 24 24', content: (<path className="rail-icon-line" pathLength="100" d="M5 11h2v2H5zM11 11h2v2h-2zM17 11h2v2h-2z" />) },
  'rail-pin': { viewBox: '0 0 24 24', content: (<path className="rail-icon-line" pathLength="100" d="m9 3 6 0-1 6 4 4v2h-5v6l-1-2-1 2v-6H6v-2l4-4-1-6Z" />) },
  'chevron-down-12': { viewBox: '0 0 12 12', content: (
          <path d="m3 4.5 3 3 3-3" />
        ) },
} as const;

export type IconName = keyof typeof glyphs;
export type IconProps = Omit<ComponentProps<'svg'>, 'children'> & { name: IconName };

/** Authored geometry lives here; callers own size, color and CSS hooks. */
export function Icon({ name, ...props }: IconProps) {
  const glyph = glyphs[name];
  return <svg viewBox={glyph.viewBox} aria-hidden="true" {...props}>{glyph.content}</svg>;
}
