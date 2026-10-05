/** Minimal line icons for the sidebar (stroke = currentColor). Keyed by NavItem.icon. */
export function NavIcon({ name }: { name: string }) {
  const p = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  switch (name) {
    case 'dashboard':
      return (<svg {...p}><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></svg>)
    case 'mywork':
      return (<svg {...p}><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></svg>)
    case 'schedule':
      return (<svg {...p}><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>)
    case 'team':
      return (<svg {...p}><circle cx="9" cy="8" r="3" /><path d="M2 21a7 7 0 0114 0M17 8a3 3 0 010 6M22 21a7 7 0 00-4-6" /></svg>)
    case 'users':
      return (<svg {...p}><circle cx="12" cy="8" r="3.2" /><path d="M5 21a7 7 0 0114 0" /></svg>)
    case 'resources':
      return (<svg {...p}><path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" /></svg>)
    case 'organization':
      return (<svg {...p}><rect x="4" y="9" width="16" height="12" rx="1" /><path d="M9 21v-6h6v6M8 9V5a2 2 0 012-2h4a2 2 0 012 2v4" /></svg>)
    case 'roles':
      return (<svg {...p}><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" /><path d="M9 12l2 2 4-4" /></svg>)
    case 'audit':
      return (<svg {...p}><path d="M6 3h9l5 5v13a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z" /><path d="M14 3v6h6M9 13h6M9 17h6" /></svg>)
    case 'chat':
      return (<svg {...p}><path d="M20 13a2 2 0 01-2 2H8l-4 4V5a2 2 0 012-2h12a2 2 0 012 2z" /><path d="M8 8h8M8 11h5" /></svg>)
    case 'feedback':
      return (<svg {...p}><path d="M21 15a2 2 0 01-2 2H8l-4 4V5a2 2 0 012-2h13a2 2 0 012 2z" /></svg>)
    case 'bookings':
      return (<svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M8 13h8M8 16h5" /></svg>)
    case 'campaigns':
      return (<svg {...p}><path d="M3 11l15-6v14L3 13z" /><path d="M3 11v2a1 1 0 001 1h3l1 5" /><path d="M18 8a3 3 0 010 6" /></svg>)
    case 'deliverables':
      return (<svg {...p}><path d="M9 3h6a1 1 0 011 1v1h2a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1h2V4a1 1 0 011-1z" /><path d="M9 5h6M9 12l2 2 4-4" /></svg>)
    case 'pipeline':
      return (<svg {...p}><rect x="3" y="4" width="4" height="16" rx="1" /><rect x="10" y="4" width="4" height="11" rx="1" /><rect x="17" y="4" width="4" height="7" rx="1" /></svg>)
    case 'clients':
      return (<svg {...p}><path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2" /><circle cx="9" cy="7" r="3" /><path d="M16 3.5a3 3 0 010 5.8M20 21v-2a4 4 0 00-3-3.8" /></svg>)
    case 'library':
      return (<svg {...p}><path d="M3 5a1 1 0 011-1h4a1 1 0 011 1v15H3z" /><path d="M9 8a1 1 0 011-1h4a1 1 0 011 1v12H9z" /><path d="M15.5 7.2l3.9 1a1 1 0 01.7 1.2L17 20l-6-1.5" /></svg>)
    case 'leave':
      return (<svg {...p}><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /><path d="M9 15l2 2 4-4" /></svg>)
    case 'directory':
      return (<svg {...p}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 3v18M12 8h4M12 12h4" /><circle cx="9.2" cy="10.5" r="1.6" /><path d="M7 15c.4-1.2 1.2-1.8 2.2-1.8s1.8.6 2.2 1.8" /></svg>)
    case 'portal':
      return (<svg {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" /></svg>)
    default:
      return (<svg {...p}><circle cx="12" cy="12" r="3" /></svg>)
  }
}
