import type { ComponentProps } from 'react';

const glyphs = {
  // Official Lucide geometry used by Being Home, https://lucide.dev/license.
  'lucide-message-circle': { viewBox: '0 0 24 24', content: <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" /> },
  'lucide-sun': { viewBox: '0 0 24 24', content: (<>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" />
    <path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />
  </>) },
  'lucide-folder': { viewBox: '0 0 24 24', content: <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /> },
  'lucide-layout-grid': { viewBox: '0 0 24 24', content: (<>
    <rect width="7" height="7" x="3" y="3" rx="1" />
    <rect width="7" height="7" x="14" y="3" rx="1" />
    <rect width="7" height="7" x="14" y="14" rx="1" />
    <rect width="7" height="7" x="3" y="14" rx="1" />
  </>) },
  'lucide-list': { viewBox: '0 0 24 24', content: (<>
    <path d="M3 5h.01" />
    <path d="M3 12h.01" />
    <path d="M3 19h.01" />
    <path d="M8 5h13" />
    <path d="M8 12h13" />
    <path d="M8 19h13" />
  </>) },
  'lucide-search': { viewBox: '0 0 24 24', content: (<>
    <path d="m21 21-4.34-4.34" />
    <circle cx="11" cy="11" r="8" />
  </>) },
  'lucide-refresh-cw': { viewBox: '0 0 24 24', content: (<>
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M8 16H3v5" />
  </>) },
  'lucide-layers': { viewBox: '0 0 24 24', content: (<>
    <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" />
    <path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" />
    <path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" />
  </>) },
  'lucide-shield-check': { viewBox: '0 0 24 24', content: (<>
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    <path d="m9 12 2 2 4-4" />
  </>) },
  'lucide-sliders-horizontal': { viewBox: '0 0 24 24', content: (<>
    <path d="M10 5H3" />
    <path d="M12 19H3" />
    <path d="M14 3v4" />
    <path d="M16 17v4" />
    <path d="M21 12h-9" />
    <path d="M21 19h-5" />
    <path d="M21 5h-7" />
    <path d="M8 10v4" />
    <path d="M8 12H3" />
  </>) },
  'lucide-trash': { viewBox: '0 0 24 24', content: (<>
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M3 6h18" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </>) },
  // Chat glyph geometry from Lucide (ISC), https://lucide.dev/license.
  'chat-more': { viewBox: '0 0 24 24', content: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ) },
  'chat-copy': { viewBox: '0 0 24 24', content: (
    <>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </>
  ) },
  'chat-plus': { viewBox: '0 0 24 24', content: (<><path d="M5 12h14" /> <path d="M12 5v14" /></>) },
  // Center the inset Lucide paths and keep their rendered stroke at 1.5px.
  'chat-send': { viewBox: '0 0 24 24', content: (
    <g transform="translate(0.1 3.26) scale(0.86)" strokeWidth="1.5">
      <path vectorEffect="non-scaling-stroke" d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
      <path vectorEffect="non-scaling-stroke" d="m21.854 2.147-10.94 10.939" />
    </g>
  ) },
  'chat-stop': { viewBox: '0 0 24 24', content: (<><rect width="18" height="18" x="3" y="3" rx="2" fill="currentColor" stroke="none" /></>) },
  // Composer controls use the 20 px geometry from the Codex desktop reference.
  'chat-arrow-up': { viewBox: '0 0 20 20', content: <path d="M10 16.667V3.333m-5.833 5.834L10 3.333l5.833 5.834" strokeWidth="1.33" /> },
  'chat-composer-stop': { viewBox: '0 0 20 20', content: <rect width="11" height="11" x="4.5" y="4.5" rx="1.25" fill="currentColor" stroke="none" /> },
  'chat-composer-stop-compact': { viewBox: '0 0 18 18', content: <rect width="6" height="6" x="6" y="6" rx="1" fill="currentColor" stroke="none" /> },
  'chat-queue': { viewBox: '0 0 20 20', content: <path d="M3.33 3.33V11q0 4 4 4h9.33m-2.08-2.08L16.66 15l-2.08 2.08M7.5 5h6.67M7.5 9.58h4.17" strokeWidth="1.33" /> },
  'chat-file': { viewBox: '0 0 24 24', content: (<><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /> <path d="M14 2v5a1 1 0 0 0 1 1h5" /> <path d="M10 9H8" /> <path d="M16 13H8" /> <path d="M16 17H8" /></>) },
  'chat-image': { viewBox: '0 0 24 24', content: (<><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /> <circle cx="9" cy="9" r="2" /> <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></>) },
  'chat-audio': { viewBox: '0 0 24 24', content: <path d="M2 10v3M6 6v11M10 3v18M14 8v7M18 5v13M22 10v3" /> },
  'chat-close': { viewBox: '0 0 24 24', content: (<><path d="M18 6 6 18" /> <path d="m6 6 12 12" /></>) },
  'chat-edit': { viewBox: '0 0 24 24', content: (<><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /> <path d="m15 5 4 4" /></>) },
  'chat-grip': { viewBox: '0 0 24 24', content: (<><circle cx="9" cy="12" r="1" /> <circle cx="9" cy="5" r="1" /> <circle cx="9" cy="19" r="1" /> <circle cx="15" cy="12" r="1" /> <circle cx="15" cy="5" r="1" /> <circle cx="15" cy="19" r="1" /></>) },
  'chat-flash': { viewBox: '0 0 24 24', content: (<><path d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z" /></>) },
  'chat-upload': { viewBox: '0 0 24 24', content: (<><path d="M12 3v12" /> <path d="m17 8-5-5-5 5" /> <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /></>) },
  'chat-spark': { viewBox: '0 0 24 24', content: (<><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" /> <path d="M20 2v4" /> <path d="M22 4h-4" /> <circle cx="4" cy="20" r="2" /></>) },
  'chat-screen': { viewBox: '0 0 24 24', content: (<><rect width="20" height="14" x="2" y="3" rx="2" /> <line x1="8" x2="16" y1="21" y2="21" /> <line x1="12" x2="12" y1="17" y2="21" /></>) },
  'chat-agent': { viewBox: '0 0 24 24', content: (<><circle cx="12" cy="8" r="5" /> <path d="M20 21a8 8 0 0 0-16 0" /></>) },
  'chat-error': { viewBox: '0 0 24 24', content: (<><circle cx="12" cy="12" r="10" /> <line x1="12" x2="12" y1="8" y2="12" /> <line x1="12" x2="12.01" y1="16" y2="16" /></>) },
  'chat-play': { viewBox: '0 0 24 24', content: (<><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" fill="currentColor" stroke="none" /></>) },
  'chat-pause': { viewBox: '0 0 24 24', content: (<><rect x="14" y="3" width="5" height="18" rx="1" /> <rect x="5" y="3" width="5" height="18" rx="1" /></>) },
  'chat-busy': { viewBox: '0 0 24 24', content: (<><path d="M21 12a9 9 0 1 1-6.219-8.56" /></>) },
  'chat-check': { viewBox: '0 0 24 24', content: <path d="M20 6 9 17l-5-5" /> },
  'chat-chevron-down': { viewBox: '0 0 24 24', content: <path d="m6 9 6 6 6-6" /> },
  'chat-chevron-right': { viewBox: '0 0 24 24', content: <path d="m9 18 6-6-6-6" /> },
  'chat-retry': { viewBox: '0 0 24 24', content: <><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /></> },
  'chat-download': { viewBox: '0 0 24 24', content: <><path d="M12 15V3" /><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /></> },
  'chat-external-link': { viewBox: '0 0 24 24', content: <><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></> },
  'chat-clock': { viewBox: '0 0 24 24', content: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></> },
  'chat-info': { viewBox: '0 0 24 24', content: <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></> },
  'chat-wrench': { viewBox: '0 0 24 24', content: <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z" /> },
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
  'skill': { viewBox: '0 0 24 24', content: (<path d="m12 3 8 4.5v9L12 21 4 16.5v-9L12 3Zm0 9 8-4.5M12 12v9M4 7.5 12 12" />) },
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
  'list-view': { viewBox: '0 0 24 24', content: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /> },
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
  'rail-bonfire': { viewBox: '0 0 24 24', content: (<path className="rail-icon-line" pathLength="100" d="M12.5 3c.7 4-3.5 5.1-3.5 9-1.4-.6-2.2-1.7-2.5-3.1C4.8 11 4 13 4.5 15.5a7.6 7.6 0 0 0 15-1.5c0-3.7-2.6-5.9-4-7.5.3 2-.1 3.6-1.5 4.5.5-3.2-.2-5.8-1.5-8Z" />) },
  'rail-firesides': { viewBox: '0 0 24 24', content: (<path className="rail-icon-line" pathLength="100" d="M6 4h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H9l-5 3V7a3 3 0 0 1 2-3Zm2 5h9m-9 4h6" />) },
  'rail-mail': { viewBox: '0 0 24 24', content: (<path className="rail-icon-line" pathLength="100" d="M6 5h12a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3ZM4 7l6.6 5.3a2.2 2.2 0 0 0 2.8 0L20 7" />) },
  'rail-seeds': { viewBox: '0 0 24 24', content: (<path className="rail-icon-line" pathLength="100" d="M12 21V11m0 5C6 16 3.5 13 3.5 7.5 9 7.5 12 10.5 12 16Zm0-4c0-5.5 2.5-8.5 8.5-8.5 0 5.5-3 8.5-8.5 8.5Z" />) },
  'rail-embers': { viewBox: '0 0 24 24', content: (<path className="rail-icon-line" pathLength="100" d="M5 4h3a1 1 0 0 1 1 1v15H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm4 0h4a1 1 0 0 1 1 1v15H9m8-15 3-.5 2.5 15-4 .5L16 6a1 1 0 0 1 1-1Z" />) },
  'rail-scrolls': { viewBox: '0 0 24 24', content: (<path className="rail-icon-line" pathLength="100" d="M8 7H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a3 3 0 0 0 3-3V5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v13a3 3 0 0 1-3 3m7-13h5m-5 4h3" />) },
  'rail-kits': { viewBox: '0 0 24 24', content: (<path className="rail-icon-line" pathLength="100" d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M5 7h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Zm-2 6h18m-9-2v4" />) },
  'rail-announcements': { viewBox: '0 0 24 24', content: (<path className="rail-icon-line" pathLength="100" d="M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm2 5h8m-8 4h8m-8 4h5" />) },
  'rail-contacts': { viewBox: '0 0 24 24', content: (<path className="rail-icon-line" pathLength="100" d="M7 3h11a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3ZM2 7h3m-3 5h3m-3 5h3m5-8a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0m-2 8a4.5 4.5 0 0 1 9 0" />) },
  'rail-town': { viewBox: '0 0 24 24', content: (<path className="rail-icon-line" pathLength="100" d="m3 10 7.2-6a2.8 2.8 0 0 1 3.6 0L21 10M5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9m-10 12v-6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6" />) },
  'rail-chat': { viewBox: '0 0 24 24', content: (<path className="rail-icon-line" pathLength="100" d="M21 11.5c0 4.4-4 8-9 8-1.6 0-3.1-.4-4.4-1L3 20l1.5-4A7.3 7.3 0 0 1 3 11.5c0-4.4 4-8 9-8s9 3.6 9 8Z" />) },
  'rail-search': { viewBox: '0 0 24 24', content: (<path className="rail-icon-line" pathLength="100" d="M17.5 10.5a7 7 0 1 1-14 0 7 7 0 0 1 14 0ZM15.5 15.5 21 21" />) },
  'rail-settings': { viewBox: '0 0 24 24', content: (<path className="rail-icon-line" d="M4 8h16M4 16h16" />) },
  'rail-collapse': { viewBox: '0 0 24 24', content: (<path className="rail-icon-line" pathLength="100" d="m7 14 5-5 5 5" />) },
  'rail-more': { viewBox: '0 0 24 24', content: (<path className="rail-icon-line" pathLength="100" d="m6.5 3 4 4-4 4-4-4 4-4Zm11 0 4 8h-8l4-8ZM10 17.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0ZM15 14h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Z" />) },
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
  const lineStyle = name.startsWith('chat-') || name.startsWith('lucide-')
    ? { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
    : {};
  return <svg viewBox={glyph.viewBox} aria-hidden="true" {...lineStyle} {...props}>{glyph.content}</svg>;
}
