/**
 * **The one address of a deliverable, open for editing** (ADR-0132 d.6/d.8, I68.8, I68.10): the campaign
 * page with that piece's panel open, and — when a task is named — that task marked.
 *
 *   /campaigns/<campaign>?piece=<deliverable>&task=<task>
 *
 * Without the campaign (the bell knows only the deliverable), `/campaigns/piece/<deliverable>` looks the
 * campaign up and forwards, carrying `task` (`PieceRedirect`). Ad-hoc work has no campaign; that lookup
 * lands it on My Work, as it always has.
 *
 * `src/lib/notifications/door.ts` builds the same address inline — it may not import (Deno loads it as is).
 */
export function pieceHref(campaignId: string | null | undefined, deliverableId: string, taskId?: string | null): string {
  if (campaignId) {
    const q = new URLSearchParams({ piece: deliverableId })
    if (taskId) q.set('task', taskId)
    return `/campaigns/${campaignId}?${q.toString()}`
  }
  return `/campaigns/piece/${deliverableId}${taskId ? `?task=${encodeURIComponent(taskId)}` : ''}`
}

/** The task page — a maker's own task (ADR-0105 d.3). */
export const taskPageHref = (subTaskId: string) => `/my-work/task/${subTaskId}`

/**
 * Where a click on a task goes (ADR-0132 d.6): someone who may edit the piece opens the campaign page with
 * it open; anyone else — the maker — the task page. `mayEdit` is `project_tasks:manage` (the grant Edit piece
 * is offered on); the server still answers for reach.
 */
export function taskClickHref(
  task: { id: string; deliverableId: string | null; campaignId: string | null },
  mayEdit: boolean,
): string {
  return mayEdit && task.deliverableId ? pieceHref(task.campaignId, task.deliverableId, task.id) : taskPageHref(task.id)
}
