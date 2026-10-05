/**
 * Who reviews a task, and who it is still waiting for (ADR-0043, ADR-0089).
 *
 * A task used to have one reviewer, so "waiting on review" had exactly one name against it and
 * everybody knew who to ask. With several — some of them mandatory — that question has no answer on
 * screen unless something puts it there, which is what these helpers and the `WaitingOn` component
 * exist for.
 *
 * ADR-0089 gives the two kinds of reviewer two different verbs. A REQUIRED reviewer approves, and
 * is outstanding until they have. An OPTIONAL reviewer answers — "done, no comment" or "done,
 * feedback left" — and is outstanding until they have. The required reviewer's completing approval
 * waits for every answer (a hard wait; the way through is removing the silent reviewer by name),
 * so every helper here has to know which kind of wait it is looking at.
 *
 * In `src/lib/` rather than in a feature because three features need the same shape: deliverables
 * (My Work, the task table, the reviewer's inbox), schedule (the booking edit modal) and bookings
 * (the exceptions strip). Pure data — no fetching, no i18n, no React.
 */

/** One appointment on a task, as read back from `sub_task_reviewers`. */
export interface TaskReviewer {
  userId: string
  /** Null only when the profile could not be joined — render a dash, never an empty gap. */
  name: string | null
  /** ADR-0043 d.5: this one cannot be skipped; the task is not done until they agree. */
  isMandatory: boolean
  /** When THIS reviewer approved. Null while their verdict is still owed. */
  approvedAt: string | null
  /**
   * ADR-0089 d.5: when THIS optional reviewer said they were done with this version. Null until
   * they have — and null for a required reviewer, whose act is to approve, not to answer.
   */
  respondedAt: string | null
  /** What kind of answer it was. Derived by the server from whether they commented this round. */
  response: ReviewerResponse | null
  /**
   * ADR-0061 d.11: is this person's account still live?
   *
   * A deactivated reviewer cannot be APPOINTED (the picker hides them, the write guard refuses
   * them), but somebody deactivated AFTER they were appointed keeps the appointment — deleting it
   * would silently drop a reviewer from work in progress. If they were MANDATORY the task can never
   * complete, because the arithmetic waits for an approval from an account that cannot sign in. So
   * it is shown, wherever the outstanding reviewers are shown, and somebody re-appoints.
   */
  isActive: boolean
}

/** ADR-0089 d.5: the two kinds of answer an optional reviewer can give. */
export type ReviewerResponse = 'no_comment' | 'feedback'

/** An appointment being written: the picker's value, and the RPC's payload before serialisation. */
export interface ReviewerAppointment {
  userId: string
  isMandatory: boolean
}

/**
 * Mandatory first, then by name. The order is not cosmetic: when a task is late, the mandatory
 * reviewers are the people who can actually unblock it, so they are the ones to read first.
 */
export function sortReviewers<T extends { isMandatory: boolean; name?: string | null }>(rs: T[]): T[] {
  return [...rs].sort((a, b) => {
    if (a.isMandatory !== b.isMandatory) return a.isMandatory ? -1 : 1
    return (a.name ?? '').localeCompare(b.name ?? '')
  })
}

/**
 * Does this task have a required reviewer at all? Under ADR-0089 d.1 every assigned task does, but
 * a lone reviewer is marked at COMMIT (d.2) and an unassigned task is outside the rule, so a list
 * with nobody marked can still be read. In that case the lone or unmarked reviewer is treated as
 * the required one — the same reading the database applies before the flag is stamped.
 */
export function hasRequiredReviewer(reviewers: { isMandatory: boolean }[]): boolean {
  return reviewers.some((r) => r.isMandatory)
}

/** ADR-0089 d.5: does this appointment approve (required) or answer (optional)? */
export function reviewerRole(reviewer: { isMandatory: boolean }, reviewers: { isMandatory: boolean }[]): 'required' | 'optional' {
  return reviewer.isMandatory || !hasRequiredReviewer(reviewers) ? 'required' : 'optional'
}

/**
 * Is this reviewer still owed? A required one until they approve; an optional one until they
 * ANSWER (ADR-0089 d.12) — an optional reviewer who has answered is finished with this version,
 * whether or not they ever pressed Approve, which they no longer can.
 */
export function isReviewerOutstanding(reviewer: TaskReviewer, reviewers: TaskReviewer[]): boolean {
  return reviewerRole(reviewer, reviewers) === 'required'
    ? reviewer.approvedAt == null
    : reviewer.respondedAt == null
}

/** The ones a task in review is still waiting for — each by its own kind of wait. */
export function outstandingReviewers(reviewers: TaskReviewer[]): TaskReviewer[] {
  return sortReviewers(reviewers.filter((r) => isReviewerOutstanding(r, reviewers)))
}

/** ADR-0089 d.7: the optional reviewers who have not answered — the people a completing approval waits for. */
export function unansweredOptionalReviewers(reviewers: TaskReviewer[]): TaskReviewer[] {
  if (!hasRequiredReviewer(reviewers)) return []
  return sortReviewers(reviewers.filter((r) => !r.isMandatory && r.respondedAt == null))
}

/**
 * ADR-0089 d.3: a form may not submit several reviewers with none marked required. The picker makes
 * this unreachable from a screen; this is the safety net the forms check before the database's.
 */
export function lacksRequiredReviewer(appointments: { isMandatory: boolean }[]): boolean {
  return appointments.length > 1 && !hasRequiredReviewer(appointments)
}

/** The ones who have already given their verdict. */
export function approvedReviewers(reviewers: TaskReviewer[]): TaskReviewer[] {
  return sortReviewers(reviewers.filter((r) => r.approvedAt != null))
}

/**
 * Would one more approval finish the task? Presentation only — the database decides, in
 * `public.sub_task_approve`. This exists so a reviewer can be told whether pressing Approve
 * completes the work or merely records their half of it, which is the difference between the two
 * products ADR-0043 weighed.
 *
 * ADR-0089 d.6: false while any optional reviewer has not answered — the task cannot complete, and
 * the button must not promise that it will.
 */
export function approvalCompletesTask(reviewers: TaskReviewer[], me: string | null): boolean {
  if (unansweredOptionalReviewers(reviewers).length > 0) return false
  const mandatory = reviewers.filter((r) => r.isMandatory)
  if (mandatory.length === 0) return true
  return mandatory.every((r) => r.approvedAt != null || r.userId === me)
}

/**
 * ADR-0089 d.7: would MY approval be the completing one, and is somebody still unanswered? Then it
 * is refused — before anything is stamped — and the surface says who, with no "approve anyway".
 * Presentation only: the database holds the rule; this keeps the screen from offering a press the
 * database will refuse.
 */
export function approvalWaitsFor(reviewers: TaskReviewer[], me: string | null): TaskReviewer[] {
  const unanswered = unansweredOptionalReviewers(reviewers)
  if (unanswered.length === 0) return []
  const othersOwed = reviewers.some((r) => r.isMandatory && r.approvedAt == null && r.userId !== me)
  return othersOwed ? [] : unanswered
}

/**
 * ADR-0089 addendum d.14 (I48.37): a send-back waits for every optional answer too — one
 * consolidated round. Unlike the approval it is not relieved by another required reviewer being
 * owed (a send-back completes nothing, so there is no "not mine to complete"), and the caller's own
 * unanswered row never holds it: the press is their answer.
 */
export function sendBackWaitsFor(reviewers: TaskReviewer[], me: string | null): TaskReviewer[] {
  return unansweredOptionalReviewers(reviewers).filter((r) => r.userId !== me)
}

/** The picker's value for a task that already has appointments. */
export function appointmentsOf(reviewers: TaskReviewer[]): ReviewerAppointment[] {
  return sortReviewers(reviewers).map((r) => ({ userId: r.userId, isMandatory: r.isMandatory }))
}

/**
 * The `p_reviewers` payload. Snake_case on purpose: it is read by `jsonb_array_elements` in
 * `update_task_assignment` / `save_sub_task`, so it follows the database's naming, not the client's.
 */
export function reviewerPayload(appointments: ReviewerAppointment[]): { user_id: string; is_mandatory: boolean }[] {
  return appointments.map((a) => ({ user_id: a.userId, is_mandatory: a.isMandatory }))
}
