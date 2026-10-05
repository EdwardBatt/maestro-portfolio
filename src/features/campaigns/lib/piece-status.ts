import type { DeliverableRow } from '../../deliverables/api/deliverables-api'

/** The four stages the frame shows, plus Closed when the piece was closed. */
export type PieceStatusStep = 'not_started' | 'in_progress' | 'in_review' | 'approved' | 'delivered' | 'closed'
export const PIECE_STATUS_STEPS: readonly PieceStatusStep[] = ['not_started', 'in_progress', 'in_review', 'approved', 'delivered']

/**
 * Where the piece is, as one of the frame's stages. APPROVED is the internal approval, and it shows as Approved (Edward, 24 Sep); the client's own
 * approval is added when that exists. Delivered is the client's, pressed by hand.
 * "Blocked" does not exist (3 Sep): a paused piece is still In progress.
 */
/**
 * The status badge a deliverable wears on the Grid and in the drawer: where its work is (I40.22), except
 * that the INTERNAL approval reads Approved (Edward, 24 Sep; I57.19) — the tasks' own phase calls it
 * "Complete", which is not what the approval means until the client has it.
 */
export function statusBadgeOf(piece: Pick<DeliverableRow, 'state' | 'progress'>): { key: string; approved: boolean } {
  if (piece.state === 'approved') return { key: 'approved', approved: true }
  return { key: piece.progress.phase, approved: false }
}

export function pieceStatusStep(piece: Pick<DeliverableRow, 'state' | 'progress'>): PieceStatusStep | null {
  if (piece.state === 'archived') return 'closed'
  if (piece.state === 'delivered') return 'delivered'
  if (piece.state === 'approved') return 'approved'
  switch (piece.progress.phase) {
    case 'no_tasks':
    case 'not_started':
      return 'not_started'
    case 'in_progress':
    case 'blocked':
      return 'in_progress'
    case 'in_review':
    case 'awaiting_signoff':
      return 'in_review'
    case 'delivered':
    case 'complete':
      return 'delivered'
    default:
      return null
  }
}
