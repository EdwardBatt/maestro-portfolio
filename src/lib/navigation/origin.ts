import { useEffect } from 'react'
import { useLocation, type Location } from 'react-router'

/**
 * **Where a person came from, so Back can return them there** (ADR-0132 d.7, I68.9).
 *
 * Edward, 30 Sep: "when actions are completed they return the user to the teams page, the my-work page or
 * whichever page they were originally on." A page that is left keeps its place in its URL — the Team page
 * its week and tab, the Schedule its days and view, the Campaigns list its filters — so returning to the
 * path it was left on restores it.
 *
 * Two sources, in order:
 *  1. `location.state.from` — set by a link that wants to name the origin itself (`withOrigin`);
 *  2. the in-app history this module keeps (`useTrackOrigin`, mounted once in the shell): the last page
 *     visited whose PATHNAME differs from the current one. Changing a page's own query (a tab, a panel,
 *     a filter) is not leaving it, so it never becomes its own origin.
 * With neither — an email link, a new tab — the caller's fallback.
 */
export type BackLabelKey =
  | 'back.team'
  | 'back.myWork'
  | 'back.schedule'
  | 'back.dashboard'
  | 'back.campaigns'
  | 'back.deliverables'
  | 'back.task'
  | 'back.users'
  | 'back.campaignsBare'
  | 'back.generic'

export interface Origin {
  /** Path with its search, e.g. `/team?tab=timeline&on=2026-09-27`. */
  path: string
  labelKey: BackLabelKey
}

/** The label a path is returned to under: "Back to Team", "Back to My Work"… */
export function labelFor(path: string): BackLabelKey {
  const pathname = path.split(/[?#]/)[0] ?? ''
  if (pathname === '/team' || pathname.startsWith('/team/')) return 'back.team'
  if (pathname.startsWith('/my-work/task/')) return 'back.task'
  if (pathname === '/my-work') return 'back.myWork'
  if (pathname === '/schedule') return 'back.schedule'
  if (pathname === '/dashboard' || pathname === '/admin') return 'back.dashboard'
  if (pathname === '/campaigns') return 'back.campaigns'
  if (pathname === '/deliverables' || pathname.startsWith('/deliverables/')) return 'back.deliverables'
  if (pathname === '/admin/users') return 'back.users'   // ADR-0133: the hand-over page is reached from Users
  return 'back.generic'
}

/**
 * A form that creates something is never returned to (I68.18): once the job, campaign or client exists, the
 * empty form behind it is done with. Back skips it to the page the person opened the form from.
 */
const CREATION_PAGES = new Set(['/campaigns/new', '/campaigns/new-job', '/clients/new'])

export function isCreationPage(path: string): boolean {
  return CREATION_PAGES.has(path.split(/[?#]/)[0] ?? '')
}

/** The router state a link carries to name its origin explicitly. */
export function withOrigin(path: string, labelKey: BackLabelKey = labelFor(path)): { from: Origin } {
  return { from: { path, labelKey } }
}

const KEY = 'maestro.nav.previous'
let current: string | null = null
let previous: string | null = null

function readStored(): string | null {
  try {
    return window.sessionStorage.getItem(KEY)
  } catch {
    return null
  }
}

/** Record a visit. Exported for tests; the shell calls it through `useTrackOrigin`. */
export function recordVisit(path: string): void {
  const pathname = (p: string | null) => (p ? p.split(/[?#]/)[0] : null)
  if (current != null && pathname(current) !== pathname(path) && !isCreationPage(current)) {
    previous = current
    try {
      window.sessionStorage.setItem(KEY, previous)
    } catch {
      /* private window: the in-memory copy still serves this tab */
    }
  }
  current = path
}

/** For tests. */
export function resetOrigin(): void {
  current = null
  previous = null
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

/**
 * The page before `herePathname`. The shell records a visit in an effect, which runs after the page has
 * rendered — so on a page's first render the history still holds the page just left as `current`.
 */
export function previousPath(herePathname: string): string | null {
  const pathname = (p: string) => p.split(/[?#]/)[0]
  if (current != null && pathname(current) !== herePathname && !isCreationPage(current)) return current
  return previous ?? readStored()
}

/** Mounted once in the shell: every location change is a visit. */
export function useTrackOrigin(): void {
  const location = useLocation()
  useEffect(() => {
    recordVisit(`${location.pathname}${location.search}`)
  }, [location.pathname, location.search])
}

/** Where Back goes from here: the explicit origin, else the page before, else the fallback. */
export function backTarget(location: Pick<Location, 'pathname' | 'state'>, fallback: Origin, before: string | null): Origin {
  const from = (location.state as { from?: Origin } | null)?.from
  if (from?.path) return from
  if (before && before.split(/[?#]/)[0] !== location.pathname) return { path: before, labelKey: labelFor(before) }
  return fallback
}

export function useBackTarget(fallback: Origin = { path: '/campaigns', labelKey: 'back.campaignsBare' }): Origin {
  const location = useLocation()
  return backTarget(location, fallback, previousPath(location.pathname))
}
