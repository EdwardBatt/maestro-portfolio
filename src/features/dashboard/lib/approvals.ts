import { awaitsTaskListApproval } from '../../../lib/campaigns/pulse'
import type { DashCampaign, DashPiece } from './figures'
import type { DashboardView } from './pick-view'

/**
 * The three approval exceptions (I66.2, Edward 29 Sep): unfinished briefs, briefs awaiting approval, and
 * task lists not approved — each item with the person it is waiting on.
 *
 * - An **unfinished brief** is a draft (ADR-0067), waiting on whoever started it.
 * - A **brief awaiting approval** is a campaign `pending_approval`, waiting on its account manager
 *   (ADR-0048 d.9 — the one `my_pending_approvals` gives it to).
 * - A **task list not approved** is a piece on an approved campaign whose list nobody has approved
 *   (ADR-0100's second gate, `awaitsTaskListApproval`), waiting on its owner. ADR-0119 lets the
 *   department's leads approve it too; the owner is the one it is named after.
 *
 * Pure: the Dashboard reads the rows, this decides what the viewer's reach counts (the same reach the
 * view already has — Edward: "the same reach as now").
 */

export interface BriefRow {
  id: string
  name: string
  status: 'draft' | 'pending_approval'
  clientName: string
  accountManagerId: string | null
  createdBy: string | null
}

export type ApprovalReach =
  /** The viewer's own: what waits on me (Team Member). */
  | { kind: 'me'; myId: string }
  /** The people of the viewer's team or department. */
  | { kind: 'people'; ids: ReadonlySet<string> }
  /** The account manager's own accounts. */
  | { kind: 'accounts'; myId: string }
  /** Everything (the director and the company views). */
  | { kind: 'all' }

/**
 * The reach each Dashboard view counts over — one rule for the cards and for the list they open (I66.6), so
 * the list shows exactly what the card counted. `people` is the view's team or department (`useScopeWork`).
 */
export function reachFor(view: DashboardView, myId: string, people: readonly string[]): ApprovalReach {
  switch (view) {
    case 'member': return { kind: 'me', myId }
    case 'team':
    case 'department': return { kind: 'people', ids: new Set(people) }
    case 'account': return { kind: 'accounts', myId }
    default: return { kind: 'all' }
  }
}

export interface Waiting {
  id: string
  name: string
  /** Who it waits on; null when nobody is named (no account manager, no owner). */
  on: string | null
}

export interface ApprovalFigures {
  unfinished: Waiting[]
  briefs: Waiting[]
  taskLists: Waiting[]
}

export function approvalFigures(
  briefs: readonly BriefRow[],
  campaigns: readonly DashCampaign[],
  pieces: readonly DashPiece[],
  reach: ApprovalReach,
  client: string | null,
): ApprovalFigures {
  const has = (id: string | null) =>
    reach.kind === 'all' ? true
      : id == null ? false
        : reach.kind === 'people' ? reach.ids.has(id)
          : id === reach.myId
  const clientOk = (name: string) => client == null || name === client

  const drafts = briefs.filter((b) => b.status === 'draft' && clientOk(b.clientName))
  const unfinished = drafts
    .filter((b) => (reach.kind === 'accounts' ? has(b.accountManagerId) || has(b.createdBy) : has(b.createdBy)))
    .map((b) => ({ id: b.id, name: b.name, on: b.createdBy }))

  const pending = briefs
    .filter((b) => b.status === 'pending_approval' && clientOk(b.clientName) && has(b.accountManagerId))
    .map((b) => ({ id: b.id, name: b.name, on: b.accountManagerId }))

  const approved = new Map(campaigns.filter((c) => c.status === 'approved' && clientOk(c.clientName)).map((c) => [c.id, c]))
  const taskLists = pieces
    .filter((p) => {
      const c = approved.get(p.campaignId)
      if (!c || !awaitsTaskListApproval(p)) return false
      return reach.kind === 'accounts' ? has(c.accountManagerId) : has(p.ownerId)
    })
    .map((p) => ({ id: p.id, name: p.name, on: p.ownerId }))

  return { unfinished, briefs: pending, taskLists }
}

/**
 * "Omar Hadi 2 · Reem Saleh 1" — who the items wait on, most first. The viewer is "you". Every item is
 * accounted for (Edward, 29 Sep: 42 shown, the names added to 32): up to three people by name; past that
 * the first two and "N others" with what they hold; nobody named ("no owner") likewise. `full` is every
 * name, for the card's hover. Null when nothing waits.
 */
export function waitingOnCaption(
  items: readonly Waiting[],
  nameOf: (id: string) => string | undefined,
  myId: string,
  words: { you: string; others: (people: number, count: number) => string; nobody: string },
): { short: string; full: string } | null {
  if (items.length === 0) return null
  const counts = new Map<string | null, number>()
  for (const it of items) counts.set(it.on, (counts.get(it.on) ?? 0) + 1)
  const named = (id: string | null) => (id == null ? words.nobody : id === myId ? words.you : nameOf(id) || words.nobody)
  const rows = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || named(a[0]).localeCompare(named(b[0])))
    .map(([id, n]) => `${named(id)} ${n}`)
  const full = rows.join(' · ')
  if (rows.length <= 3) return { short: full, full }
  const rest = [...counts.values()].sort((a, b) => b - a).slice(2).reduce((a, b) => a + b, 0)
  return { short: [...rows.slice(0, 2), words.others(rows.length - 2, rest)].join(' · '), full }
}
