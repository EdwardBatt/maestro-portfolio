/**
 * Where a person lands (I66.7, Edward 29 Sep): their role's landing (`roles.default_route`, set per role on the
 * Roles page — every role starts on My Work), except that anyone who cannot open My Work lands on the Dashboard,
 * which every signed-in person can open (ADR-0122 d.6). The same grants the /my-work route asks (router.tsx), so
 * a role or a personal grant that changes later never sends someone to a page that turns them away.
 */
export function landingRoute(roleRoute: string | null | undefined, grants: ReadonlySet<string>): string {
  const route = roleRoute || '/my-work'
  if (route === '/my-work' && !grants.has('my_tasks:view') && !grants.has('my_calendar:view')) return '/dashboard'
  return route
}
