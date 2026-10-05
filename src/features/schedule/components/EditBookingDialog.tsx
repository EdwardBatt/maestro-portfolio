import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { Modal } from '../../../components/Modal'
import { loadPctToHours } from '../../../lib/capacity/day-hours.ts'
import {
  useBookingTaskDetail,
  useCancelBooking,
  useRescheduleBooking,
  useUpdateBookingFields,
  useUpdateTaskAssignment,
  type ScheduleBooking,
  type ScheduleResource,
} from '../api/schedule-api'
import { fetchCancelImpact, useCancelSubTask, useReviewers } from '../../deliverables/api/deliverables-api'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
// ADR-0042 d.7 (amended 26 Aug): requirements are edited HERE as well as on /deliverables —
// the modal is where work is assigned and where somebody has the camera in mind. One component,
// so the two surfaces cannot drift in what they permit or record.
import { TaskResources } from '../../deliverables/TaskResources'
import { daySpan } from '../lib/day-span.ts'
import { expandDaily } from '../../../lib/bookings/recurrence.ts'
import { localDayOf } from '../../../lib/capacity/working-week.ts'
import { ReviewerPicker } from '../../../components/ReviewerPicker'
import { WaitingOn } from '../../../components/WaitingOn'
import { appointmentsOf, lacksRequiredReviewer, type ReviewerAppointment } from '../../../lib/reviewers/task-reviewers'
import { ReviewerNames } from '../../../components/ReviewerNames'
import { REVIEW_MODES, reviewModeLabelKey, type ReviewMode } from '../../../lib/review/review-mode'
import { isPmBypassEligible } from '../lib/write-scope.ts'
import { useWriteScope } from '../hooks/use-write-scope.ts'
import { useAuth } from '../../../app/auth-context'
import { usePendingAssignmentRequest, useWithdrawAssignmentRequest } from '../../../lib/assignment-requests/api'
import { formatIraqDate, iraqDay } from '../../../lib/time/iraq'
import { useLatestExtensionByTask } from '../../deliverables/api/extensions-api'
import { ExtensionControl } from '../../deliverables/components/ExtensionControl'
import { ChangeAskDialog } from '../../campaigns/components/ChangeAskDialog'
import { DateField } from '../../../components/DateField'
import { pieceHref } from '../../../lib/navigation/piece-link'
import { dayLong, weekdayName } from '../lib/day-words.ts'
import { dayLoad } from '../lib/day-load.ts'
import { TaskPopup } from './TaskPopup'

/**
 * Click-to-edit the booking (ADR-0006 + I11.7). For a task-backed booking it shows who assigned
 * the task and when, who last modified it and when, and who is reviewing it — and lets you edit the
 * task's title, assignee (reassign), reviewers, dates and hours (authoritative RPC +
 * re-materialise). Plain reservations keep title/notes + date/hours/resource. Cancel is unchanged.
 *
 * ADR-0043: the reviewer became reviewerS, each of them required or not, so the single select became
 * the shared ReviewerPicker — the same component the Deliverables breakdown uses, over the same
 * `sub_task_reviewers` table, so the two surfaces cannot drift in what they permit or record.
 */
/**
 * ADR-0140 (I74.7, I74.11): a TASK on a piece opens its own pop-up — the one task editor, with Cancel this booking
 * and Remove this task (`TaskPopup`, SC-23/24/26/27). A plain reservation, and a standalone ad-hoc task with no piece
 * behind it, keep the booking's fields below.
 */
export function EditBookingDialog(props: {
  booking: ScheduleBooking
  resources: ScheduleResource[]
  onClose: () => void
  bookings?: ScheduleBooking[]
}) {
  const { booking } = props
  if (booking.subTaskId && booking.deliverableId) {
    return <TaskPopup {...props} booking={{ ...booking, subTaskId: booking.subTaskId, deliverableId: booking.deliverableId }} />
  }
  return <BookingFieldsDialog {...props} />
}

function BookingFieldsDialog({
  booking,
  resources,
  onClose,
  bookings,
}: {
  booking: ScheduleBooking
  resources: ScheduleResource[]
  onClose: () => void
  /** I74 (SC-23): the grid's bookings, so the pop-up can say when the day is over — the cell's own words. */
  bookings?: ScheduleBooking[]
}) {
  const { t, i18n } = useTranslation()
  const reschedule = useRescheduleBooking()
  const cancel = useCancelBooking()
  const updateTask = useUpdateTaskAssignment()
  const updateFields = useUpdateBookingFields()
  const reviewerOptions = useReviewers()
  const cancelTask = useCancelSubTask()

  const isTask = !!booking.subTaskId
  const detail = useBookingTaskDetail(isTask ? booking.subTaskId : null)
  // ADR-0087 d.11: a task with a request out shows where it stands, and its requester can take
  // it back from here. (The lead answers from the requested chip, the task, or the inbox.)
  const pending = usePendingAssignmentRequest(isTask ? booking.subTaskId : null)
  const withdraw = useWithdrawAssignmentRequest()
  const { session } = useAuth()
  const myId = session?.user.id ?? null
  const [sent, setSent] = useState<string | null>(null)
  const viewerId = myId
  // ADR-0088 d.10: the state of the ask on this task, and the offer a save makes when the plan it
  // wrote ends after the commitment.
  const extension = useLatestExtensionByTask(isTask && booking.subTaskId ? [booking.subTaskId] : [])
  const [offerDay, setOfferDay] = useState<string | null>(null)

  const humanResources = useMemo(
    () => resources.filter((r) => r.kind === 'human' && r.userId),
    [resources],
  )
  const currentUserId = resources.find((r) => r.id === booking.resourceId)?.userId ?? null

  // Fields (seeded from the booking; task fields re-seed once the detail query resolves).
  const [title, setTitle] = useState(booking.bookingTitle ?? booking.taskName ?? booking.notes ?? '')
  const [notes, setNotes] = useState(booking.notes ?? '')
  const [assigneeUserId, setAssigneeUserId] = useState(currentUserId ?? '')
  const [reviewers, setReviewers] = useState<ReviewerAppointment[]>([])
  // ADR-0059 d.4: set where the assignee and the reviewers are set, because it is the same
  // decision — who does this, who checks it, and what "checking it" will mean.
  const [reviewMode, setReviewMode] = useState<ReviewMode>('digital')
  const [resourceId, setResourceId] = useState(booking.resourceId)
  const [date, setDate] = useState(new Date(booking.start).toISOString().slice(0, 10))
  const [endDate, setEndDate] = useState(new Date(booking.end - 1).toISOString().slice(0, 10))
  const [hours, setHours] = useState(
    String(booking.loadPct != null ? loadPctToHours(booking.loadPct) : (booking.end - booking.start) / 3_600_000),
  )
  const [error, setError] = useState<string | null>(null)
  /**
   * ADR-0068 d.1: the schedule is the surface Edward reported, and cancelling here fired straight
   * from the click. What it costs is fetched before the dialog opens, because the wording depends
   * on it (d.2/d.3).
   */
  const [pendingCancel, setPendingCancel] = useState<{ bookings: number; isPlan: boolean; isAdhoc: boolean } | null>(null)
  const [seeded, setSeeded] = useState(false)

  // Seed task fields from the detail once (don't clobber the user's in-progress edits).
  useEffect(() => {
    if (!isTask || seeded || !detail.data) return
    const d = detail.data
    setTitle(d.title ?? '')
    setAssigneeUserId(d.assigneeId ?? currentUserId ?? '')
    setReviewers(appointmentsOf(d.reviewers))
    setReviewMode(d.reviewMode)
    if (d.startsAt) setDate(new Date(d.startsAt).toISOString().slice(0, 10))
    if (d.dueAt) setEndDate(new Date(d.dueAt).toISOString().slice(0, 10))
    const spanDays = d.startsAt && d.dueAt
      ? Math.max(1, Math.round((Date.parse(d.dueAt) - Date.parse(d.startsAt)) / 86_400_000) + 1)
      : 1
    if (d.slaHours != null) setHours(String(+(d.slaHours / spanDays).toFixed(2)))
    setSeeded(true)
  }, [isTask, seeded, detail.data, currentUserId])

  const resource = resources.find((r) => r.id === (isTask ? booking.resourceId : resourceId))
  const tz = resource?.office?.timezone ?? 'UTC'
  const dayCount = useMemo(() => {
    const d = Math.round((Date.parse(endDate) - Date.parse(date)) / 86_400_000) + 1
    return Number.isFinite(d) && d >= 1 ? d : 1
  }, [date, endDate])

  // I41.2 — the same working-day placement the create dialog does. Editing a task's span here read
  // the typed end date straight into `dueAt`, so re-saving a Thursday-Sunday task as Thursday-Friday
  // put both days' hours back on Thursday.
  const placedSpans = useMemo(() => {
    if (!date || !(Number(hours) > 0) || dayCount < 1) return []
    const first = daySpan(date, Number(hours), tz)
    return dayCount > 1
      ? expandDaily({
          first,
          repeatCount: Math.min(dayCount, 52),
          timezone: tz,
          workingDays: resource?.office?.workingDays,
          closures: resource?.office?.closures,
        })
      : [first]
  }, [date, hours, dayCount, tz, resource])

  const lastPlaced = placedSpans.length > 0 ? placedSpans[placedSpans.length - 1] : null
  /**
   * Whether the person has actually CHANGED a date in this dialog.
   *
   * Without it, opening a task re-derived where its days "would" land and announced a move that
   * was not happening — and worse, saving would then have written that derived end date over the
   * one the task really had. A task dragged onto a Friday ends on the Friday: that placement is
   * the answer, not a span to be re-spread. Re-placement belongs only where somebody is asking
   * for a NUMBER of days again (Edward, 7 Sep: "if the task is dragged to Friday, the correct end
   * date is Friday").
   */
  const [datesTouched, setDatesTouched] = useState(false)
  const slidEndDate =
    datesTouched && lastPlaced ? localDayOf(lastPlaced.start, tz).isoDate : endDate

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }) : '—'

  async function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const h = Number(hours)
    if (!(h > 0 && h <= 24)) return setError(t('schedule.fieldError.hours'))

    if (isTask) {
      if (!title.trim()) return setError(t('schedule.fieldError.task'))
      if (!assigneeUserId) return setError(t('schedule.fieldError.assignee'))
      if (reviewers.length === 0) return setError(t('schedule.fieldError.reviewer'))
      // ADR-0089 d.3: several reviewers with none marked required are refused at commit.
      if (lacksRequiredReviewer(reviewers)) return setError(t('reviewers.oneRequired'))
      const first = daySpan(date, h, tz)
      const last = datesTouched && lastPlaced ? lastPlaced : daySpan(endDate, h, tz)
      try {
        const outcome = await updateTask.mutateAsync({
          subTaskId: booking.subTaskId!,
          title: title.trim(),
          assigneeId: assigneeUserId,
          reviewers,
          startsAt: new Date(first.start).toISOString(),
          dueAt: new Date(last.end).toISOString(),
          hours: h * dayCount,
          reviewMode,
        })
        // ADR-0087 d.12: a reassign to somebody outside the caller's reach was recorded as a
        // request. The task, and this booking, are exactly as they were; say so rather than close
        // on a chip that did not move.
        if (outcome?.outcome === 'requested') {
          setSent(t('schedule.request.sent', { department: assigneeResource?.departmentName ?? assigneeResource?.teamName ?? '' }))
          setTimeout(onClose, 1600)
          return
        }
        // ADR-0141 d.2/d.5: a move past the PIECE's due date opens the one change form, filled in with that day
        // (the per-task extension is retired). Offers, never forces — the move itself is saved; closing the form
        // is a complete answer.
        const pieceDue = detail.data?.deliverableDueAt
        const newDueDay = iraqDay(new Date(last.end))
        if (booking.deliverableId && pieceDue && newDueDay > iraqDay(pieceDue)) {
          setOfferDay(newDueDay)
          return
        }
        onClose()
      } catch (err) {
        const { code, hint } = err as { code?: string; hint?: string }
        setError(
          code === '42501'
            ? (hint === 'unplaced_resource'
                ? t('schedule.refusal.unplaced', { name: assigneeResource?.name ?? '' })
                : t('schedule.outOfScope'))
            : code === '22023' ? ((err as { message?: string }).message ?? t('schedule.saveFailed'))
              : t('schedule.saveFailed'),
        )
      }
      return
    }

    // Plain reservation: move (date/hours/resource) + persist title/notes.
    const span = daySpan(date, h, tz)
    try {
      await reschedule.mutateAsync({
        bookingId: booking.id,
        expectedState: booking.state,
        startsAt: new Date(span.start).toISOString(),
        endsAt: new Date(span.end).toISOString(),
        resourceId: resourceId !== booking.resourceId ? resourceId : undefined,
      })
      if (title.trim() !== (booking.bookingTitle ?? '') || notes !== (booking.notes ?? '')) {
        await updateFields.mutateAsync({ bookingId: booking.id, title: title.trim(), notes })
      }
      onClose()
    } catch (err) {
      const code = (err as { code?: string }).code
      setError(code === 'exclusive_conflict' ? t('schedule.assess.exclusive_conflict') : t('schedule.moveFailed'))
    }
  }

  // Cancelling the BOOKING leaves the task alive, assigned and off every calendar — that is how
  // work went missing. For a task-backed booking the honest action is to cancel the task, which
  // releases its bookings too.
  /** Ask first, and know what the answer costs (ADR-0068 d.1–d.3). */
  async function armCancelTask() {
    setError(null)
    try {
      setPendingCancel(await fetchCancelImpact(booking.subTaskId!))
    } catch (err) {
      setError((err as { message?: string }).message ?? t('schedule.cancelFailed'))
    }
  }

  async function onCancelTask() {
    setPendingCancel(null)
    setError(null)
    try {
      await cancelTask.mutateAsync(booking.subTaskId!)
      onClose()
    } catch (err) {
      setError((err as { message?: string }).message ?? t('schedule.cancelFailed'))
    }
  }

  async function onCancelBooking() {
    setError(null)
    try {
      await cancel.mutateAsync({ bookingId: booking.id, expectedState: booking.state })
      onClose()
    } catch {
      setError(t('schedule.cancelFailed'))
    }
  }

  const busy = updateTask.isPending || reschedule.isPending || updateFields.isPending
  // Saving a task before its detail has loaded used to submit an EMPTY reviewer, which the RPC
  // wrote straight over the real one — a silent wipe on any quick edit. Hold Save until seeded.
  const notReady = isTask && !seeded

  // ---------------------------------------------------------------- write-scope mirror ----
  // The grid gates its "+" and its drags, but this modal opened for anybody who could SEE the
  // booking — so an out-of-scope user filled the whole form and only learned they were not
  // permitted when Save came back 42501. Mirror the server gates here too, and say so up front.
  //
  // Only what can be mirrored FAITHFULLY is mirrored; anything we cannot resolve client-side is
  // left to the server, which already reports it (the 42501 branches in onSave stay).
  //   * a task edit's own gate is project_tasks:manage + write scope over the TASK's placement and
  //     its deliverable's account manager — the permission is checkable here, the placement is not;
  //   * reassigning is ADR-0040's trigger, which is exactly bookings:create + scope over the new
  //     assignee's resource, and has no PM branch — so that one mirrors exactly;
  //   * a project-linked booking may be written by its PM regardless of scope (ADR-0029), which we
  //     cannot know, so those lean ALLOW.
  const { can, ready, scope, inScope, refusalFor, routeFor } = useWriteScope()
  const bookingResource = resources.find((r) => r.id === booking.resourceId) ?? null
  const targetResource = resources.find((r) => r.id === resourceId) ?? null
  const assigneeResource = humanResources.find((r) => r.userId === assigneeUserId) ?? null
  const originalAssigneeId = detail.data?.assigneeId ?? currentUserId
  const pmMayBypass = isPmBypassEligible(booking)

  const saveDenial = useMemo<string | null>(() => {
    if (!ready) return null // permissions still loading — fail-closed, but don't flash a refusal
    if (isTask) {
      if (!can('project_tasks:manage')) return t('schedule.notAuthorisedEditTask')
      // The permission is only half the gate, and on its own it is misleading: a role can hold
      // project_tasks:manage and still be out of scope (a team lead over another team's task), so
      // checking it alone left Save live for someone the server was always going to refuse.
      // (Team Member no longer holds the permission at all — `20260825110000` removed it, Edward,
      // 25 Aug — so an assignee editing their own booking is refused at the permission line; the
      // pgTAP seed still grants it to a003 deliberately, to prove scope decides. I46.4.)
      // update_task_assignment also tests
      // app.in_write_scope(task.department_id, task.team_id, <the deliverable's account manager>),
      // so mirror the placement too. The account-manager half is not resolvable here, so an
      // account-scoped caller leans ALLOW — they may well be that manager.
      if (detail.data && scope !== 'account' && !inScope({
        departmentId: detail.data.departmentId,
        teamId: detail.data.teamId,
      }))
        return t('schedule.notAuthorisedEditTask')
      // ADR-0087: reassigning to somebody outside the caller's reach is no longer a dead Save —
      // it becomes a request (d.2, d.12), worded below. Two things still stop it here: no booking
      // grant at all (d.3), and a person nobody scoped can reach (d.13).
      if (assigneeUserId !== (originalAssigneeId ?? '') && assigneeResource) {
        if (!can('bookings:create')) return t('schedule.notAuthorisedAssign', { name: assigneeResource.name })
        if (routeFor(assigneeResource) === 'unplaced') return t('schedule.refusal.unplaced', { name: assigneeResource.name })
      }
      return null
    }
    if (!can('bookings:update')) return t('schedule.notAuthorisedEditBooking')
    if (pmMayBypass) return null
    // Same accurate wording the grid uses — one refusal vocabulary, never a hardcoded guess.
    if (bookingResource && !inScope(bookingResource)) {
      const r = refusalFor(bookingResource, 'update')
      return t(r.key, r.params)
    }
    if (targetResource && targetResource.id !== booking.resourceId && !inScope(targetResource)) {
      const r = refusalFor(targetResource, 'update')
      return t(r.key, r.params)
    }
    return null
  }, [ready, isTask, can, t, assigneeUserId, originalAssigneeId, assigneeResource, routeFor,
      pmMayBypass, bookingResource, targetResource, booking.resourceId, inScope, refusalFor,
      detail.data, scope])

  /** ADR-0087 d.2: the reassign will be sent to this department for approval. Said before Save. */
  const willRequest =
    ready && isTask && assigneeUserId !== (originalAssigneeId ?? '') && assigneeResource != null &&
    can('bookings:create') && routeFor(assigneeResource) === 'request'

  // Cancelling has its own authority. bookings_scheduler_delete carries NO PM bypass, so that one
  // mirrors exactly; cancelling a TASK is sub_task_cancel's gate, whose scope half (the task's
  // placement) is again not resolvable here.
  const cancelDenial: string | null = !ready
    ? null
    : isTask
      ? can('project_tasks:manage')
        ? null
        : t('schedule.notAuthorisedCancelTask')
      : can('bookings:delete') && (!bookingResource || inScope(bookingResource))
        ? null
        : t('schedule.notAuthorisedCancelBooking')

  // The authority the DB applies to a REQUIREMENT write is app.can_manage_sub_task:
  // project_tasks:manage plus the task's own placement in write scope — the same pair as
  // saveDenial's task branch, minus the assignee/booking concerns that are irrelevant here.
  // Leans ALLOW while permissions load and for an account-scoped caller, for the reasons given
  // above: a control that is wrongly absent is worse than one the server refuses.
  const canManageTask =
    !ready ||
    (can('project_tasks:manage') &&
      (scope === 'account' ||
        !detail.data ||
        inScope({ departmentId: detail.data.departmentId, teamId: detail.data.teamId })))

  return (
    // I48.6: shared Modal behaviour (backdrop/Esc/focus); the `.dialog` form stays the card.
    <Modal onClose={onClose} card={false}>
      <form className="dialog sc-edit" role="dialog" aria-modal="true" aria-label={t('schedule.editBooking')}
        data-testid="edit-dialog" onSubmit={onSave}>
        {/* I74 (Figma L SC-23): the same fields and the same saves, dressed as the booking's own pop-up —
            where it sits, whose it is and when, then the details. Restyle only. */}
        <header className="sc-edit-head">
          {booking.campaignName && <p className="sc-book-eyebrow"><span className="sc-dot" aria-hidden="true" />{booking.campaignName}</p>}
          <h2>{booking.taskName ?? (title || t('schedule.editBooking'))}</h2>
          <p className="sc-book-sub" data-testid="edit-booked-for">
            {[
              resource ? t('schedule.sc.edit.bookedFor', { name: resource.name }) : null,
              dayLong(new Date(booking.start).toISOString().slice(0, 10), i18n.language),
              booking.loadPct != null ? t('schedule.sc.hours', { n: loadPctToHours(booking.loadPct) }) : null,
              t(`schedule.state.${booking.state}`),
            ].filter(Boolean).join(' · ')}
          </p>
        </header>
        {(() => {
          // The day this booking starts on, read as the grid reads it (`dayLoad`): over is said once, in hours.
          const res = resources.find((r) => r.id === booking.resourceId)
          if (!bookings || !res) return null
          const dayStart = Date.UTC(new Date(booking.start).getUTCFullYear(), new Date(booking.start).getUTCMonth(), new Date(booking.start).getUTCDate())
          const load = dayLoad(res, bookings.filter((b) => b.resourceId === res.id && b.start < dayStart + 86_400_000 && b.end > dayStart))
          if (load.state !== 'over') return null
          return (
            <p className="sc-edit-alert" role="status" data-testid="edit-over">
              {t('schedule.sc.edit.over', { name: res.name, over: load.overHours, day: weekdayName(new Date(dayStart).toISOString().slice(0, 10), i18n.language), hours: load.bookedHours })}
            </p>
          )
        })()}

        {isTask && detail.data && (
          <dl className="task-meta muted" data-testid="edit-task-meta">
            <div>
              <dt>{t('schedule.assignedBy')}</dt>
              <dd data-testid="edit-assigned-by">{detail.data.creatorName ?? '—'} · {fmt(detail.data.createdAt)}</dd>
            </div>
            <div>
              <dt>{t('schedule.modifiedBy')}</dt>
              <dd data-testid="edit-modified-by">{detail.data.modifierName ?? '—'} · {fmt(detail.data.updatedAt)}</dd>
            </div>
            <div>
              <dt>{t('reviewers.label')}</dt>
              {/* Everyone appointed, each marked if required, then — only while somebody has not
                  acted — who it is waiting for (ADR-0043 d.8). A dash means an unassigned task, not
                  a policy: "Any reviewer (role-based)" was retired by ADR-0038.

                  I42.3: this line used to join the names and nothing else, so the required mark
                  appeared ONLY inside `WaitingOn` — which names reviewers who have not acted. The
                  two together left a required reviewer unmarked before anyone had approved (the
                  Reviewers line said just their name) and unmarked afterwards (WaitingOn had
                  dropped them), while `/deliverables` marked them throughout. Same data on both
                  screens, read through the same `fetchTaskReviewers`; only this line was silent. */}
              <dd data-testid="edit-reviewer-name">
                <ReviewerNames reviewers={detail.data.reviewers} testId="edit-reviewer-name" />
                {' '}
                <WaitingOn reviewers={detail.data.reviewers} testId="edit-waiting-on" />
              </dd>
            </div>
          </dl>
        )}

        <label>
          {t('schedule.taskTitle')}
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} data-testid="edit-title" />
        </label>

        {isTask && booking.taskStatus && (() => {
          const steps = ['todo', 'in_progress', 'review', 'done'] as const
          const at = Math.max(0, steps.indexOf(booking.taskStatus as (typeof steps)[number]))
          return (
            <div className="sc-edit-where" data-testid="edit-where">
              <span className="sc-edit-where-label">{t('schedule.sc.edit.where')}</span>
              <ol className="sc-edit-steps">
                {steps.map((st, i) => (
                  <li key={st} className={i === at ? 'is-on' : i < at ? 'is-past' : ''}>{t(`schedule.sc.edit.step.${st}`)}</li>
                ))}
              </ol>
            </div>
          )
        })()}

        {isTask ? (
          <>
            <label>
              {t('schedule.assignee')}
              <select value={assigneeUserId} onChange={(e) => setAssigneeUserId(e.target.value)} data-testid="edit-assignee">
                {humanResources.map((r) => (
                  <option key={r.userId!} value={r.userId!}>{r.name}{r.office ? ` — ${r.office.name}` : ''}</option>
                ))}
              </select>
            </label>
            <div className="field">
              <span className="field-label">{t('reviewers.label')}</span>
              <ReviewerPicker
                options={reviewerOptions.data ?? []}
                value={reviewers}
                onChange={setReviewers}
                excludeUserId={assigneeUserId || null}
                testId="edit-reviewer"
              />
            </div>
            {/* ADR-0059 d.4. `manual` is for work that produces no file — a shoot day, a print run,
                an installation. The hint says which, because the person choosing is deciding what
                the assignee will be asked for, not a preference. */}
            <label>
              {t('reviewMode.column')}
              <select
                value={reviewMode}
                onChange={(e) => setReviewMode(e.target.value as ReviewMode)}
                data-testid="edit-review-mode"
              >
                {REVIEW_MODES.map((m) => (
                  <option key={m} value={m}>{t(reviewModeLabelKey(m))}</option>
                ))}
              </select>
              <span className="muted">{t(`reviewMode.hint.${reviewMode}`)}</span>
            </label>
          </>
        ) : (
          <>
            <label>
              {t('schedule.resource')}
              <select value={resourceId} onChange={(e) => setResourceId(e.target.value)} data-testid="edit-resource">
                {resources.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}{r.office ? ` — ${r.office.name}` : ''}</option>
                ))}
              </select>
            </label>
            <label>
              {t('schedule.notes')}
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} data-testid="edit-notes" />
            </label>
          </>
        )}

        <div className="dialog-row">
          <label>
            {t('schedule.date')}
            <DateField value={date} onChange={(v) => { setDatesTouched(true); setDate(v); if (Date.parse(endDate) < Date.parse(v)) setEndDate(v) }} data-testid="edit-date" />
          </label>
          {isTask && (
            <label>
              {t('schedule.endDate')}
              <DateField value={endDate} min={date} onChange={(v) => { setDatesTouched(true); setEndDate(v) }} data-testid="edit-end-date" />
            </label>
          )}
          {/* I41.2 — only once a date has been CHANGED here. On open there is nothing moving, and
              a task dragged onto a day off already ends on that day off, correctly. */}
          {isTask && datesTouched && slidEndDate !== endDate && (
            <p className="notice notice-warn" data-testid="edit-ends-on">
              {t('schedule.endsOn', { date: slidEndDate })}
            </p>
          )}
          <label>
            {t('schedule.hoursPerDay')}
            <input type="number" min="0.5" max="24" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} data-testid="edit-hours" />
          </label>
        </div>

        {/* ADR-0088 d.10: the ask sits beside the date. The commitment is named when the plan has
            left it (d.1), and the state of any request — pending, answered — reads here too. */}
        {isTask && booking.subTaskId && detail.data && (
          <div className="dialog-row" data-testid="edit-extension-row">
            {detail.data.committedDueAt && detail.data.dueAt
              && iraqDay(detail.data.committedDueAt) !== iraqDay(detail.data.dueAt) && (
              <span className="cell-warn" data-testid="edit-committed">
                {t('deadlineExtension.committed', { date: formatIraqDate(detail.data.committedDueAt) })}
              </span>
            )}
            <ExtensionControl
              subTaskId={booking.subTaskId}
              taskTitle={detail.data.title}
              latest={extension.data?.get(booking.subTaskId)}
              canRequest={canManageTask || detail.data.assigneeId === viewerId}
              viewerId={viewerId}
              committedDueAt={detail.data.committedDueAt}
              deliverableDueAt={detail.data.deliverableDueAt}
              goLiveAt={detail.data.goLiveAt}
              showDecision
              testId="edit-extension"
            />
          </div>
        )}

        {isTask && booking.subTaskId && (
          <TaskResources subTaskId={booking.subTaskId} canManage={canManageTask} compact />
        )}

        {/* ADR-0087 d.11: where the task stands while its request is out. */}
        {isTask && pending.data && (
          <p className="notice notice-warn" data-testid="edit-pending-request">
            {t('schedule.request.awaiting', { department: pending.data.departmentName ?? '' })}
            {' · '}
            {t('schedule.request.askedBy', { name: pending.data.requesterName ?? '' })}
            {myId != null && myId === pending.data.requestedBy && (
              <>
                {' '}
                <Button type="button" variant="link" busy={withdraw.isPending}
                  onClick={() => withdraw.mutate(pending.data!.id, { onError: (e) => setError((e as Error).message) })}
                  data-testid="edit-withdraw-request">
                  {t('schedule.request.withdraw')}
                </Button>
              </>
            )}
          </p>
        )}
        {willRequest && !sent && (
          <p className="notice notice-warn" data-testid="edit-will-request">
            {t('schedule.request.willAsk', { department: assigneeResource?.departmentName ?? assigneeResource?.teamName ?? '' })}
          </p>
        )}
        {sent && <p className="notice notice-ok" role="status" data-testid="edit-request-sent">{sent}</p>}
        {saveDenial && (
          <p className="form-error" role="alert" data-testid="edit-denied">{saveDenial}</p>
        )}
        {error && <p className="form-error" data-testid="edit-error">{error}</p>}

        {offerDay && booking.subTaskId && booking.deliverableId && (
          <ChangeAskDialog
            deliverableId={booking.deliverableId}
            fromSubTaskId={booking.subTaskId}
            initialDueDay={offerDay}
            onClose={() => { setOfferDay(null); onClose() }}
            testId="edit-change-ask"
          />
        )}

        {/* ADR-0068 d.2: what is lost, in numbers, before anything happens. A task reached from the
            SCHEDULE always has at least this booking, which is exactly why cancelling from here was
            the most expensive click in the product to make by accident.
            No Reinstate control here, deliberately: cancelling deletes the bookings, so the task
            leaves the calendar and there is nothing left on this surface to reinstate FROM. It is
            offered on the deliverable, where the task still is. */}
        {pendingCancel && (
          <ConfirmDialog
            title={t('deliverables.confirmCancelTitle')}
            message={t('deliverables.confirmCancelBody', { title: detail.data?.title ?? '' })}
            detail={[
              detail.data?.assigneeName
                ? t('deliverables.confirmCancelAssignee', { name: detail.data.assigneeName })
                : t('deliverables.confirmCancelUnassigned'),
              t('deliverables.confirmCancelBookings', { n: pendingCancel.bookings }),
              // Ad-hoc work cannot be reinstated — cancelling archives the job it IS. The schedule
              // is where most ad-hoc work gets cancelled, so this is the sentence that matters.
              t(
                pendingCancel.isAdhoc
                  ? 'deliverables.confirmCancelAdhocFinal'
                  : 'deliverables.confirmCancelUndo',
              ),
            ]}
            confirmLabel={t('schedule.cancelTask')}
            busy={cancelTask.isPending}
            onConfirm={() => void onCancelTask()}
            onCancel={() => setPendingCancel(null)}
            testId="edit-cancel-confirm"
          />
        )}

        <div className="dialog-actions sc-edit-foot">
          <Button variant="primary" type="submit" busy={busy} disabled={notReady || saveDenial != null || sent != null} data-testid="edit-save">
            {willRequest ? t('schedule.request.ask') : t('schedule.sc.edit.save')}
          </Button>
          {booking.deliverableId && (
            <Button variant="secondary" to={pieceHref(booking.campaignId, booking.deliverableId, booking.subTaskId)} data-testid="edit-open-piece">
              {t('schedule.sc.edit.openPiece')}
            </Button>
          )}
          <Button variant="link" onClick={onClose} data-testid="edit-close">
            {t('schedule.sc.close')}
          </Button>
          <span className="sc-grow" />
          {isTask ? (
            <Button type="button" variant="link" className="danger"
              busy={cancelTask.isPending}
              disabled={busy || cancelDenial != null}
              title={cancelDenial ?? undefined}
              onClick={() => void armCancelTask()} data-testid="edit-cancel-task">
              {t('schedule.cancelTask')}
            </Button>
          ) : (
            <Button type="button" variant="link" className="danger"
              busy={cancel.isPending}
              disabled={cancelDenial != null}
              title={cancelDenial ?? undefined}
              onClick={() => void onCancelBooking()} data-testid="edit-cancel-booking">
              {t('schedule.cancelBooking')}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  )
}
