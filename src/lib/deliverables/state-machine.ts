// ADR-0024 (Phase I): the deliverable lifecycle as a pure state machine.
//
// This MIRRORS the DB guard `app.tg_deliverable_transition_guard` (migration
// 20260817110100). The UI reads it to show which actions are legal for the caller; the
// `deliverable-transition` Edge Function validates against it before writing. Keep the two in
// lockstep — the DB is authoritative, this is the presentational/pre-check twin.

export type DeliverableState =
  | 'draft'
  | 'in_progress'
  | 'in_review'
  | 'approved'
  | 'delivered'
  | 'archived'
  | 'blocked'

// 'manage' = project_tasks:manage · 'review' = reviews:moderate · 'review_or_manage' = either.
export type TransitionAuthority = 'manage' | 'review' | 'review_or_manage'

export type TransitionEvent =
  | 'approved'
  | 'revision_requested'
  | 'blocked_flagged'
  | 'block_cleared'

export interface Transition {
  to: DeliverableState
  authority: TransitionAuthority
  /** Starts a new revision round (a rework cycle back into in_progress). Server-stamped. */
  countsRevision?: boolean
  /** The append-only sla_events event_type the DB emits for this transition, if any. */
  event?: TransitionEvent
}

// The legal graph — identical to the CASE in the DB guard trigger.
export const DELIVERABLE_TRANSITIONS: Record<DeliverableState, Transition[]> = {
  // ADR-0118 d.5 (Edward, 27 Sep): a deliverable moves because of its tasks, never by hand. There is no
  // Start — it starts when its first task does (app.sub_task_start). No Request changes — a task's own
  // send-back takes its deliverable out of review (app.sub_task_request_changes). in_progress → in_review
  // stays for one caller only: sending an ad-hoc task readies its container (TaskPage); the Deliverables
  // page never shows it as a button.
  draft: [
    { to: 'archived', authority: 'manage' },
  ],
  in_progress: [
    { to: 'in_review', authority: 'manage' },
    { to: 'blocked', authority: 'manage', event: 'blocked_flagged' },
    { to: 'archived', authority: 'manage' },
  ],
  blocked: [
    { to: 'in_progress', authority: 'manage', event: 'block_cleared' },
    { to: 'archived', authority: 'manage' },
  ],
  // ADR-0118 d.2: no Approve button on a deliverable — it becomes approved when its last task is (the
  // database's roll-up), and only then. d.5: no Request changes either (above).
  in_review: [],
  approved: [
    { to: 'delivered', authority: 'manage' },
    { to: 'in_progress', authority: 'manage', countsRevision: true },
    { to: 'archived', authority: 'manage' },
  ],
  delivered: [
    { to: 'archived', authority: 'manage' },
    { to: 'in_progress', authority: 'manage' },
  ],
  archived: [],
}

export interface DeliverableGrants {
  /** holds project_tasks:manage */
  manage: boolean
  /** holds reviews:moderate */
  review: boolean
}

export function nextStates(from: DeliverableState): Transition[] {
  return DELIVERABLE_TRANSITIONS[from] ?? []
}

export function findTransition(from: DeliverableState, to: DeliverableState): Transition | undefined {
  return nextStates(from).find((t) => t.to === to)
}

/** Is `from → to` legal AND permitted for a caller holding these grants? */
export function isAllowed(from: DeliverableState, to: DeliverableState, grants: DeliverableGrants): boolean {
  const t = findTransition(from, to)
  if (!t) return false
  switch (t.authority) {
    case 'manage':
      return grants.manage
    case 'review':
      return grants.review
    case 'review_or_manage':
      return grants.review || grants.manage
  }
}

/** The transitions a caller may actually perform from `from`, given their grants. */
export function allowedTransitions(from: DeliverableState, grants: DeliverableGrants): Transition[] {
  return nextStates(from).filter((t) => isAllowed(from, t.to, grants))
}

/** Effective revision limit: a per-deliverable override wins over the work-type default. */
export function effectiveRevisionLimit(
  deliverableLimit: number | null,
  workTypeLimit: number | null,
): number | null {
  return deliverableLimit ?? workTypeLimit
}

/** Warn-and-allow: exceeding the limit informs, it never blocks. */
export function isOverRevisionLimit(revisionRound: number, limit: number | null): boolean {
  return limit != null && revisionRound > limit
}
