/** Minimal DOM builder. Dynamic text always goes through textContent. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | ((e: Event) => void)> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const k in attrs) {
    const v = attrs[k];
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, '').toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'html') el.innerHTML = String(v); // static, trusted markup only (icons)
    else if (typeof v === 'boolean') {
      if (v) el.setAttribute(k, '');
    } else el.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c == null) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

const s = (path: string, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ${extra}>${path}</svg>`;

export const ICONS = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.4-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4.2" height="16" rx="1.2"/><rect x="13.8" y="4" width="4.2" height="16" rx="1.2"/></svg>',
  step: s('<path d="M6 5v14l9-7z"/><path d="M18 5v14"/>'),
  info: s('<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5v.01"/>'),
  save: s('<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4"/><rect x="8" y="13" width="8" height="5"/>'),
  help: s('<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/>'),
  restart: s('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4h4"/>'),
  close: s('<path d="M6 6l12 12M18 6L6 18"/>'),
  target: s('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  overview: s('<path d="M3 9V5a2 2 0 0 1 2-2h4M15 3h4a2 2 0 0 1 2 2v4M21 15v4a2 2 0 0 1-2 2h-4M9 21H5a2 2 0 0 1-2-2v-4"/>'),
  cut: s('<path d="M4 20L20 4"/><path d="M12 4a8 8 0 0 1 8 8"/><path d="M4 12a8 8 0 0 0 8 8" stroke-dasharray="2 3"/>'),
  bookmark: s('<path d="M6 3h12v18l-6-4-6 4z"/>'),
  follow: s('<circle cx="12" cy="12" r="3"/><path d="M12 3a9 9 0 1 0 9 9"/><path d="M17 3h4v4"/>'),
  stats: s('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  log: s('<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>'),
  inspect: s('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>'),
  camera: s('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  upload: s('<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>'),
  download: s('<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 16v4h16v-4"/>'),
};

/** Shape glyphs so state is never colour-only (design §5.3). */
export const STATE_GLYPHS = {
  susceptible: '<svg viewBox="0 0 16 16"><rect x="1.5" y="5" width="13" height="6" rx="3" fill="currentColor"/></svg>',
  infected: '<svg viewBox="0 0 16 16"><rect x="1.5" y="5" width="13" height="6" rx="3" fill="currentColor"/><circle cx="5.5" cy="8" r="1.1" fill="#06161d"/><circle cx="8.5" cy="8" r="1.1" fill="#06161d"/><circle cx="11.2" cy="8" r="1.1" fill="#06161d"/></svg>',
  resistant: '<svg viewBox="0 0 16 16"><rect x="1.5" y="5" width="13" height="6" rx="3" fill="currentColor"/><path d="M5 5v6M8 5v6M11 5v6" stroke="#06161d" stroke-width="1.2"/></svg>',
  dormant: '<svg viewBox="0 0 16 16"><rect x="2" y="5.5" width="12" height="5" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  nonhost: '<svg viewBox="0 0 16 16"><circle cx="5.5" cy="8" r="3.2" fill="currentColor"/><circle cx="10.8" cy="8" r="3.2" fill="currentColor"/></svg>',
  phage: '<svg viewBox="0 0 16 16"><polygon points="8,1 11.5,3 11.5,7 8,9 4.5,7 4.5,3" fill="currentColor"/><rect x="7.2" y="8.5" width="1.6" height="5" fill="currentColor"/><path d="M8 13.5l-3 2M8 13.5l3 2" stroke="currentColor" stroke-width="1"/></svg>',
  intracellular: '<svg viewBox="0 0 16 16"><rect x="1.5" y="4" width="13" height="8" rx="4" fill="none" stroke="currentColor" stroke-width="1.3"/><polygon points="6,6 7.5,7 7.5,9 6,10 4.5,9 4.5,7" fill="currentColor"/><polygon points="10.5,6 12,7 12,9 10.5,10 9,9 9,7" fill="currentColor"/></svg>',
};

/** Small lifecycle icons for the state machine. */
export const LIFECYCLE_ICONS = [
  s('<polygon points="12,3 16,5.5 16,10.5 12,13 8,10.5 8,5.5"/><path d="M12 13v5M12 18l-3 3M12 18l3 3"/>'),
  s('<polygon points="12,2 15.5,4 15.5,8.5 12,10.5 8.5,8.5 8.5,4"/><path d="M12 10.5v5"/><path d="M3 19c3-3 15-3 18 0"/>'),
  s('<rect x="3" y="7" width="18" height="10" rx="5"/><path d="M8 12c1.5-2 3-2 4 0s2.5 2 4 0"/>'),
  s('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>'),
];

/** Line art of the two morphotypes for the start screen. */
export function phageArt(morphology: string): string {
  if (morphology === 'podovirus') {
    return `<svg viewBox="0 0 56 72" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round">
      <polygon points="28,8 42,16 42,32 28,40 14,32 14,16" fill="rgba(159,247,230,0.12)"/>
      <path d="M14,16 28,24 42,16 M28,24 28,40"/>
      <path d="M24,40 L26,48 L30,48 L32,40" fill="rgba(159,247,230,0.2)"/>
      <path d="M26,48 l-8,6 l-3,8 M30,48 l8,6 l3,8 M27,48 l-3,9 M29,48 l3,9"/>
    </svg>`;
  }
  return `<svg viewBox="0 0 56 72" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round">
    <polygon points="28,2 39,8 39,22 28,28 17,22 17,8" fill="rgba(159,247,230,0.12)"/>
    <path d="M17,8 28,14 39,8 M28,14 28,28"/>
    <rect x="25" y="29" width="6" height="22" rx="1" fill="rgba(159,247,230,0.2)"/>
    <path d="M25,33h6M25,37h6M25,41h6M25,45h6"/>
    <path d="M22,51h12"/>
    <path d="M23,51 l-10,-6 l-6,18 M33,51 l10,-6 l6,18 M25,51 l-6,-3 l-4,17 M31,51 l6,-3 l4,17"/>
  </svg>`;
}
