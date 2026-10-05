import type { QueryClient } from '@tanstack/react-query'

/**
 * Every read that shows a task or a booking, by the root of its query key (I67.2, Edward 30 Sep: "When a task is
 * deleted my-work the schedule page need to be manually refreshed to update the view, all related views should be
 * reflected in real time").
 *
 * Each task mutation used to refresh its own short list, and they drifted: deleting a task refreshed the
 * deliverables and nothing else, and cancel / assign / re-open refreshed `['bookings']` — a key no query uses (the
 * booking lists live under `['bookings-list']`). One list here, used by every task change on this screen AND by the
 * database's live nudge (`useWorkChannel`), so a change anyone makes reaches every open view.
 *
 * `['deliverables']` covers My Work, Needs you, the task page and a campaign's risk read (their keys start with it).
 */
export const TASK_VIEW_ROOTS = [
  'deliverables',
  'requirements',
  'schedule',
  'team-view',
  'team',
  'bookings-list',
  'dashboard',
  'pending-approvals',
  'campaign-detail',
  'campaigns',
  'reopen',
  'task-resources',
  'assignment-requests',
  'review',
] as const

export function invalidateTaskViews(qc: QueryClient): void {
  for (const root of TASK_VIEW_ROOTS) void qc.invalidateQueries({ queryKey: [root] })
}
