/**
 * The Schedule and the team timeline refresh every 20 seconds and on returning to the tab
 * (ADR-0105 d.5, Q36): two screens now write the same assignments, and each must show what the
 * other just did. The app's default is no refetch on focus (`main.tsx`); a read opts in here.
 */
export const LIVE_REFRESH = { refetchInterval: 20_000, refetchOnWindowFocus: true } as const

/** Spread into a `useQuery` options object: live when asked, the app's defaults otherwise. */
export function liveOptions(live: boolean | undefined): Partial<typeof LIVE_REFRESH> {
  return live ? LIVE_REFRESH : {}
}
