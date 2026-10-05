import type { DeliverableRow } from '../../deliverables/api/deliverables-api'

/**
 * Which Board column a piece sits in (Figma CG-05, I57.8) — and, through `timeline-bars.ts`, which
 * colour its Timeline bar takes (CG-06, I57.9). One rule for both views, so a piece cannot be "In
 * progress" on one and "Not started" on the other.
 *
 * Edward, 24 Sep: *"the card reads the deliverable and the deliverable owner, it does not display
 * tasks."* The column is read from the piece's own state and from where its tasks are
 * (`progress.phase`, I40.22), never set by hand — nothing on the Board is dragged.
 *
 * "Blocked" does not exist (3 Sep): the frame's Blocked column is WAITING — a piece with an
 * outstanding external input (`deliverable_pending_inputs`, `satisfied_at is null`).
 * APPROVED is the internal approval, and it shows as Approved (Edward, 24 Sep); the client's own
 * approval is added when that exists. Delivered is the client's, pressed by hand.
 */

export type BoardColumn = 'unassigned' | 'notStarted' | 'inProgress' | 'waiting' | 'inReview' | 'approved' | 'delivered'

/** Left to right, as the frame has them. */
export const BOARD_COLUMNS: readonly BoardColumn[] = ['unassigned', 'notStarted', 'inProgress', 'waiting', 'inReview', 'approved', 'delivered']

type Piece = Pick<DeliverableRow, 'state' | 'progress'> & { id: string }

/**
 * The column, or null for a closed (archived) piece — it is not work anybody owes.
 *
 * Order matters and is the rule written down:
 * 1. delivered → Delivered; approved (the internal approval) → Approved.
 * 2. an unfinished piece with an outstanding input → Waiting. The legacy `blocked` state, the old
 *    word for the same thing, reads as Waiting too — there is no Blocked column.
 * 3. tasks in review, or all done and not signed off → In review; any task started → In progress.
 * 4. otherwise nobody has started: Unassigned when a live task has nobody, or there are no live
 *    tasks at all (none planned, or all called off); Not started when every live task has someone.
 */
export function boardColumnOf(piece: Piece, outstandingInputs: number): BoardColumn | null {
  if (piece.state === 'archived') return null
  if (piece.state === 'delivered') return 'delivered'
  if (piece.state === 'approved') return 'approved'
  if (outstandingInputs > 0 || piece.state === 'blocked') return 'waiting'
  const { phase, unassigned, total } = piece.progress
  if (phase === 'in_review' || phase === 'awaiting_signoff') return 'inReview'
  if (phase === 'in_progress') return 'inProgress'
  if (unassigned > 0 || total === 0) return 'unassigned'
  return 'notStarted'
}

export interface BoardColumnGroup<P> {
  column: BoardColumn
  pieces: P[]
}

/** Every column, in order, each with its pieces in the order given — an empty column stays on the
 *  board with its 0, so the stages read the same on every campaign. */
export function boardColumns<P extends Piece>(
  pieces: readonly P[],
  outstandingInputs: ReadonlyMap<string, number>,
): BoardColumnGroup<P>[] {
  const by = new Map<BoardColumn, P[]>(BOARD_COLUMNS.map((c) => [c, []]))
  for (const p of pieces) {
    const c = boardColumnOf(p, outstandingInputs.get(p.id) ?? 0)
    if (c) by.get(c)!.push(p)
  }
  return BOARD_COLUMNS.map((column) => ({ column, pieces: by.get(column)! }))
}
