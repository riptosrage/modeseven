import { svg } from '@slab/core';

export const I = {
  track: svg('<path d="M4 7h10M4 12h16M4 17h7"/>'),
  timeline: svg('<rect x="3" y="6" width="7" height="4" rx="1"/><rect x="12" y="6" width="9" height="4" rx="1"/><rect x="6" y="14" width="11" height="4" rx="1"/>'),
  mixer: svg('<path d="M7 4v16M17 4v16"/><rect x="4.5" y="13" width="5" height="3" rx="1"/><rect x="14.5" y="7" width="5" height="3" rx="1"/>'),
  fader: svg('<path d="M12 3v18"/><rect x="8" y="9" width="8" height="4" rx="1"/>'),
  record: '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.5" fill="#E2372C"/></svg>',
  browser: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  sampler: svg('<path d="M3 12h2l2-6 3 12 3-9 2 6 2-3h4"/>'),
  spark: svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>'),
  play: svg('<path d="M8 5.5v13l10.5-6.5z"/>', true),
  stop: svg('<rect x="7" y="7" width="10" height="10" rx="1.5"/>', true),
  theme: svg('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>', false, 16),
  minus: svg('<path d="M5 12h14"/>', false, 14),
  plus: svg('<path d="M12 5v14M5 12h14"/>', false, 14),
};
