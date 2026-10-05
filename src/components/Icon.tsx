/**
 * Line icons for actions (stroke = currentColor), the same drawing rules as `NavIcon`:
 * 24-unit grid, 1.7 stroke, round caps. Keyed by name so a caller never pastes SVG.
 *
 * Edward, 14 Sep (I48.32): wherever an icon carries the action — delete, remove, close,
 * reorder — prefer it to a text button. These are those icons. Add one here, not inline.
 */
export type IconName =
  | 'trash'
  | 'close'
  | 'edit'
  | 'plus'
  | 'arrow-up'
  | 'arrow-down'
  | 'check'
  | 'undo'
  | 'refresh'
  | 'external'
  | 'unlink'
  | 'archive'
  | 'dice'
  | 'chevron-down'
  | 'chevron-up'
  // Direction-bearing: a caller flips them in RTL (`[dir='rtl']`), as `.tv-arrow` does.
  | 'chevron-left'
  | 'chevron-right'
  | 'alert'
  | 'info'
  | 'download'
  | 'more'

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const p = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
  }
  switch (name) {
    case 'trash':
      return (<svg {...p}><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13" /><path d="M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" /></svg>)
    case 'more':
      return (<svg {...p}><path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth={3} /></svg>)
    case 'close':
      return (<svg {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>)
    case 'edit':
      return (<svg {...p}><path d="M4 20h4l10.5-10.5a1.5 1.5 0 000-2.1l-1.9-1.9a1.5 1.5 0 00-2.1 0L4 16z" /><path d="M13 7l4 4" /></svg>)
    case 'plus':
      return (<svg {...p}><path d="M12 5v14M5 12h14" /></svg>)
    case 'arrow-up':
      return (<svg {...p}><path d="M12 19V5M5 12l7-7 7 7" /></svg>)
    case 'arrow-down':
      return (<svg {...p}><path d="M12 5v14M5 12l7 7 7-7" /></svg>)
    case 'check':
      return (<svg {...p}><path d="M5 12l5 5L20 7" /></svg>)
    case 'undo':
      return (<svg {...p}><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 010 12h-3" /></svg>)
    case 'refresh':
      return (<svg {...p}><path d="M20 12a8 8 0 01-14.5 4.6M4 12a8 8 0 0114.5-4.6" /><path d="M20 4v4h-4M4 20v-4h4" /></svg>)
    case 'external':
      return (<svg {...p}><path d="M14 4h6v6M20 4l-9 9" /><path d="M19 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1h5" /></svg>)
    case 'unlink':
      return (<svg {...p}><path d="M10 14a4 4 0 005.7 0l2.6-2.6a4 4 0 00-5.7-5.7L11.5 6.8" /><path d="M14 10a4 4 0 00-5.7 0l-2.6 2.6a4 4 0 005.7 5.7l1.1-1.1" /><path d="M4 4l16 16" /></svg>)
    case 'archive':
      return (<svg {...p}><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10a1 1 0 001 1h12a1 1 0 001-1V9M10 13h4" /></svg>)
    case 'dice':
      return (<svg {...p}><rect x="4" y="4" width="16" height="16" rx="3" /><circle cx="9" cy="9" r="1" fill="currentColor" /><circle cx="15" cy="15" r="1" fill="currentColor" /><circle cx="15" cy="9" r="1" fill="currentColor" /><circle cx="9" cy="15" r="1" fill="currentColor" /></svg>)
    case 'chevron-down':
      return (<svg {...p}><path d="M6 9l6 6 6-6" /></svg>)
    case 'chevron-up':
      return (<svg {...p}><path d="M6 15l6-6 6 6" /></svg>)
    case 'chevron-left':
      return (<svg {...p}><path d="M15 6l-6 6 6 6" /></svg>)
    case 'chevron-right':
      return (<svg {...p}><path d="M9 6l6 6-6 6" /></svg>)
    // I54.15: priority is a symbol, not a word. The exclamation is Edward's (23 Sep); the two
    // chevrons pair with it so the three read as one family — alarm, up, down.
    case 'alert':
      return (<svg {...p}><path d="M12 4v9" /><path d="M12 18.5v.5" /></svg>)
    case 'info':
      // The alert glyph turned over: the dot above, the stem below. Drawn bare, so the button
      // that carries it decides whether it sits on a disc.
      return (<svg {...p}><path d="M12 10v8" /><path d="M12 5.5v.5" /></svg>)
    case 'download':
      return (<svg {...p}><path d="M12 4v11M7 10l5 5 5-5" /><path d="M4 19h16" /></svg>)
  }
}
