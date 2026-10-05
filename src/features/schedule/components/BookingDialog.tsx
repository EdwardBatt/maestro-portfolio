import { useMemo, useState } from 'react'
import { formatCalendarDay, iraqDay } from '../../../lib/time/iraq'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { Modal } from '../../../components/Modal'
import { Tag } from '../../../components/Tag'
import { isWorkingDay } from '../../../lib/capacity/working-week.ts'
import { bookedHoursInWeek, weekLoadPct, weekStartOf } from '../lib/week-load.ts'
import { assessCandidate } from '../../../lib/capacity/engine.ts'
import type { CapacityResource, OfficeCalendar } from '../../../lib/capacity/types.ts'
import { hoursToLoadPct } from '../../../lib/capacity/day-hours.ts'
import { localDayOf } from '../../../lib/capacity/working-week.ts'
import { expandDaily } from '../../../lib/bookings/recurrence.ts'
import { usePermissions } from '../../../app/permissions'
import { useRescheduleTask } from '../../deliverables/api/deliverables-api'
import {
  useCampaigns,
  useCreateBooking,
  useProjectTasks,
  useAssignableSubTasks,
  useUpdateTaskAssignment,
  readTaskListGate,
  type ScheduleBlackout,
  type ScheduleBooking,
  type ScheduleResource,
} from '../api/schedule-api'
// ADR-0082 d.8: ad-hoc work is no longer created here. The `+` on a person assigns a task from an
// existing project; the ONE way new work enters is the front door. `create_adhoc_deliverable` and
// the 131 deliverables already on that model are untouched (d.9) — hidden, not deleted.
import {
  useAssignableUsers,
  useReviewers,
  useUpsertSubTask,
} from '../../deliverables/api/deliverables-api'
// ADR-0060: Project mode ASSIGNS. Reviewers and the review mode are collected here for the same
// reason ad-hoc collects them — a task cannot be assigned without a reviewer, and how it will be
// submitted is decided by the person handing it out.
import { ReviewerPicker } from '../../../components/ReviewerPicker'
import { lacksRequiredReviewer, type ReviewerAppointment } from '../../../lib/reviewers/task-reviewers'
import { REVIEW_MODES, reviewModeLabelKey, type ReviewMode } from '../../../lib/review/review-mode'
// ADR-0042 d.7: requirements are stated where the work is planned. A requirement keys on
// sub_task_id, which does not exist until the task is created — so they are staged here and
// written straight after, through the SAME editor the saved-task surfaces use.
import { useAuth } from '../../../app/auth-context'
import { StagedTaskResources, type AddArgs } from '../../deliverables/TaskResources'
import { addTaskResources, type RequirementReport } from '../../deliverables/api/task-resources-api'
import { AssessmentNotice, type DayProblem } from './AssessmentNotice'
import { daySpan } from '../lib/day-span.ts'
import { translateScheduleWarning } from '../../../lib/bookings/schedule-outcome'
import { useWriteScope } from '../hooks/use-write-scope.ts'
import { namedRefusal, refusalSentence } from '../../../lib/errors/classify'
import { DateField } from '../../../components/DateField'

export interface BookingDraft {
  resourceId?: string
  isoDate?: string
  /**
   * I59 (settled 25 Sep): a drop from the team view's "Nobody yet" that the drag cannot finish —
   * the task has no reviewer, or no hours (E11) — opens THIS dialog with the task already chosen,
   * so only what is missing is asked for. Each is an initial value; every field stays editable.
   */
  endIsoDate?: string
  campaignId?: string
  deliverableId?: string
  subTaskId?: string
  /** hours a day; '' leaves the field empty so the hours are entered, not defaulted */
  hoursPerDay?: string
}

interface Props {
  draft: BookingDraft
  resources: ScheduleResource[]
  bookings: ScheduleBooking[]
  blackouts: ScheduleBlackout[]
  onClose: () => void
}

function toCapacity(r: ScheduleResource): CapacityResource {
  if (r.capacityModel === 'exclusive') return { model: 'exclusive' }
  if (r.capacityModel === 'pooled') return { model: 'pooled', poolSize: 1 }
  return { model: 'load_based', ceilingPct: 200, warnAtPct: 100 }
}

/**
 * ADR-0006 popup (rev 2), narrowed by ADR-0082 d.8: on a PERSON a booking is a PROJECT TASK —
 * the task belongs to a project, and the project link derives from the task. On equipment or a
 * room it is a plain reservation. There is no ad-hoc mode any more: new work has one shape and
 * one door. Provisional/confirmed · hours/day · optional end date.
 */
export function BookingDialog({ draft, resources, bookings, blackouts, onClose }: Props) {
  const { t, i18n } = useTranslation()
  const { can, departmentId: myDepartmentId, teamId: myTeamId } = usePermissions()
  const { routeFor, inWriteReach } = useWriteScope()
  const create = useCreateBooking()
  const { claims } = useAuth()
  // I66.10 (Edward, 29 Sep): ad-hoc work is switched off — a person is only ever given a task from a project.
  // The ad-hoc deliverables already made stay where they are (the Deliverables page's Ad-hoc tab).
  const [pendingResources, setPendingResources] = useState<AddArgs[]>([])
  const [requirementReport, setRequirementReport] = useState<RequirementReport | null>(null)
  const [requirementError, setRequirementError] = useState<string | null>(null)
  const reviewers = useReviewers()
  const campaigns = useCampaigns()

  // Iraq's today, not the UTC one (ADR-0076 d.1). Between midnight and 03:00 Baghdad the UTC day
  // is still yesterday, so a date field defaulted from it opens on the wrong day.
  const today = iraqDay(Date.now())
  // ADR-0133 d.1: nobody Leaving is booked. The grid still shows their row — their work stays visible until handed
  // over — but a person is offered here only if they may be given work (`useAssignableUsers`, which already leaves
  // Leaving people out); a room or equipment has no person and is always offered. A "+" on a Leaving person's own
  // row says why instead of booking. Until the people have loaded, nobody is left out.
  const assignableForBooking = useAssignableUsers()
  const bookableIds = useMemo(() => (assignableForBooking.data ? new Set(assignableForBooking.data.map((u) => u.id)) : null), [assignableForBooking.data])
  const isLeaving = (r: ScheduleResource | undefined) => !!r?.userId && r.kind === 'human' && bookableIds != null && !bookableIds.has(r.userId)
  const offered = resources.filter((r) => !isLeaving(r))
  const [resourceId, setResourceId] = useState(draft.resourceId ?? offered[0]?.id ?? resources[0]?.id ?? '')
  const [campaignId, setCampaignId] = useState(draft.campaignId ?? '')
  // ADR-0060: campaign -> deliverable -> task, and a task is always chosen. `deliverableId` used to
  // be called `taskId`, from when a deliverable WAS the unit of work; ADR-0058 made the sub-task the
  // unit and the name had been lying ever since.
  const [deliverableId, setDeliverableId] = useState(draft.deliverableId ?? '')
  const [subTaskId, setSubTaskId] = useState(draft.subTaskId ?? '')   // '' = create a new task under the deliverable
  const [newTaskName, setNewTaskName] = useState('')
  // ADR-0060 d.4/d.5: the same three the ad-hoc branch already collects.
  const [projectReviewers, setProjectReviewers] = useState<ReviewerAppointment[]>([])
  const [reviewMode, setReviewMode] = useState<ReviewMode>('digital')
  /** Notes on a plain reservation (equipment, a room). Never a task title. */
  const [adhocText, setAdhocText] = useState('')
  const [date, setDate] = useState(draft.isoDate ?? today)
  const [endDate, setEndDate] = useState(draft.endIsoDate ?? draft.isoDate ?? today)
  const [confirmed, setConfirmed] = useState(true)
  const [hours, setHours] = useState(draft.hoursPerDay ?? '4')
  const [error, setError] = useState<string | null>(null)
  const [unscheduled, setUnscheduled] = useState<{ subTaskId: string; reason: string } | null>(null)
  const rescheduleTask = useRescheduleTask()
  const [acknowledged, setAcknowledged] = useState(false)
  const [result, setResult] = useState<'created' | 'needs_approval' | 'requested' | 'awaiting_list' | null>(null)
  /** I71.2: the owner who must approve the re-opened list before the new task can be booked. */
  const [listOwner, setListOwner] = useState<string | null>(null)

  const assignableUsers = useAssignableUsers()
  const upsertSubTask = useUpsertSubTask()
  const updateTask = useUpdateTaskAssignment()
  const resource = resources.find((r) => r.id === resourceId)
  // ADR-0060 d.6: Project mode assigns work to a PERSON, so it is the only mode on one (ADR-0082
  // d.8). Derived rather than pushed into state, because the resource can change while the dialog
  // is open and a mode left over from the previous selection is exactly how a form ends up in a
  // state its own validation says is impossible.
  const canProject = resource?.kind === 'human' && !!resource.userId
  /**
   * ADR-0087 d.2: what the server will make of an assignment to THIS person. Outside the caller's
   * reach it becomes a request the person's lead answers — and the dialog says so before submit,
   * which is this mirror's one job. ADR-0082 d.8 retired ad-hoc work from this dialog, so on a
   * person the only thing that can be asked for is a project task.
   */
  const route = canProject && resource ? routeFor(resource) : 'direct'
  const isProject = canProject
  const willRequest = isProject && route === 'request'

  /**
   * ADR-0090 d.3a: a held task is not offered anywhere assignment starts. The list arrives already
   * narrowed to the deliverables whose work the gate would accept — brief approved on a campaign,
   * task list approved on a single job — absence, not a disabled entry. The rule lives in the
   * database beside the gate (`assignable_deliverables`), not here.
   */
  const tasks = useProjectTasks(isProject && campaignId ? campaignId : null)
  const subTasks = useAssignableSubTasks(isProject && deliverableId ? deliverableId : null)
  const tz = resource?.office?.timezone ?? 'UTC'
  const dayCount = useMemo(() => {
    const d = Math.round((Date.parse(endDate) - Date.parse(date)) / 86_400_000) + 1
    return Number.isFinite(d) ? d : 1
  }, [date, endDate])

  /**
   * I41.2 — the days the work will actually land on. "2 days" means two days of WORK: a repeat that
   * falls on one of the office's days off steps to the next working day, so Thursday + 2 days is
   * Thursday and Sunday, never 16 hours on Thursday. The end date the assigner picked is an INPUT to
   * the count, not the answer; everything downstream reads this instead — the per-day capacity
   * preview below, and the task's due date on submit. Those two used to disagree: the preview
   * assessed Friday's capacity (empty, nobody works it) for work that landed on Thursday.
   *
   * The FIRST day is never moved. A deliberately-picked Friday is booked on the Friday and warned
   * about (ADR-0061 d.2) — that is the drag-back Edward described, and it still works.
   */
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
  /** Where the work actually ends, which is the picked end date only when no day off intervened. */
  const placedEndDate = lastPlaced ? localDayOf(lastPlaced.start, tz).isoDate : endDate

  const problems: DayProblem[] = useMemo(() => {
    if (!resource || !date || !(Number(hours) > 0) || dayCount < 1) return []
    const office: OfficeCalendar | undefined = resource.office ?? undefined
    const spans = placedSpans
    const existing = bookings
      .filter((b) => b.resourceId === resource.id && b.state === 'confirmed')
      .map((b) => ({ id: b.id, start: b.start, end: b.end, loadPct: b.loadPct ?? undefined }))
    const blk = blackouts.filter((b) => b.resourceId === resource.id)
    return spans.map((candidate): DayProblem => ({
      isoDate: localDayOf(candidate.start, tz).isoDate,
      assessment: assessCandidate({
        resource: toCapacity(resource),
        candidate,
        candidateLoadPct: resource.capacityModel === 'load_based' ? hoursToLoadPct(Number(hours)) : undefined,
        existing,
        blackouts: blk,
        office,
      }),
    }))
  }, [resource, date, hours, dayCount, tz, placedSpans, bookings, blackouts])

  const hasFindings = problems.some((p) => p.assessment.level !== 'ok')
  const worstIsConflict = problems.some((p) => p.assessment.level === 'conflict')
  const mustAcknowledge = hasFindings && !acknowledged

  // ---- L2 (I59.14, ADR-0105 d.5) — COSMETIC ONLY. What follows is read off the form's own state and
  // props for the header, the person card and the footer line; it changes no field, no validation
  // and no write. The heading is the piece once one is chosen.
  const campaignName = (campaigns.data ?? []).find((c) => c.id === campaignId)?.name ?? null
  const pieceName = (tasks.data ?? []).find((d) => d.id === deliverableId)?.name ?? null
  const taskTitle = subTaskId ? (subTasks.data ?? []).find((x) => x.id === subTaskId)?.title ?? null : newTaskName.trim() || null
  const l2Heading = isProject && pieceName ? [pieceName, taskTitle].filter(Boolean).join(' — ') : t('schedule.newBooking')
  const l2Context = [
    isProject ? campaignName : null,
    date ? t('teamView.l2.when', { from: formatCalendarDay(date), to: formatCalendarDay(placedEndDate), count: dayCount }) : null,
    Number(hours) > 0 ? t('teamView.l2.perDay', { hours: Number(hours) }) : null,
  ].filter(Boolean).join(' · ')
  const l2Week = useMemo(() => {
    if (!resource || !date || !Number.isFinite(Date.parse(date))) return null
    const weekStart = weekStartOf(date)
    const pct = weekLoadPct(bookedHoursInWeek(resource.id, bookings, weekStart), resource.office?.workingDays?.length ?? 5)
    const free: string[] = []
    for (let i = 0; i < 7; i += 1) {
      const epoch = weekStart + i * 86_400_000
      const working = resource.office ? isWorkingDay(localDayOf(epoch + 43_200_000, resource.office.timezone), resource.office) : true
      const busy = bookings.some((b) => b.resourceId === resource.id && b.start < epoch + 86_400_000 && b.end > epoch)
      if (working && !busy) free.push(new Date(epoch).toLocaleDateString(i18n.language === 'ar' ? 'ar' : 'en-GB', { weekday: 'short', timeZone: 'UTC' }))
    }
    return { pct, free }
  }, [resource, date, bookings, i18n.language])
  const l2Told = willRequest
    ? t('teamView.l2.toldRequest', { department: resource?.departmentName ?? resource?.teamName ?? '' })
    : isProject && resource
      ? t('teamView.l2.told', { name: resource.name })
      : null

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const h = Number(hours)
    if (!resourceId) return setError(t('schedule.fieldError.resource'))
    if (!(h > 0 && h <= 24)) return setError(t('schedule.fieldError.hours'))
    if (dayCount < 1 || dayCount > 52) return setError(t('schedule.fieldError.span'))
    if (isProject) {
      if (!campaignId) return setError(t('schedule.fieldError.project'))
      // d.7: a deliverable is a container, never the thing assigned.
      if (!deliverableId) return setError(t('schedule.fieldError.deliverable'))
      if (!subTaskId && !newTaskName.trim()) return setError(t('schedule.fieldError.task'))
      // d.4: this is the field whose absence made the whole branch booking-only.
      if (projectReviewers.length === 0) return setError(t('schedule.fieldError.reviewer'))
      // ADR-0089 d.3: several reviewers with none marked required are refused at commit. The
      // picker makes this unreachable; this is the safety net in front of the database's.
      if (lacksRequiredReviewer(projectReviewers)) return setError(t('reviewers.oneRequired'))
    }
    if (mustAcknowledge) return setAcknowledged(true)

    const first = daySpan(date, h, tz)

    // ADR-0060: PROJECT work is ASSIGNED, not merely booked. This is the half ADR-0029 promised
    // ("the booking becomes the assignment record") and never built: the old branch wrote
    // `bookings.sub_task_id` and left `sub_tasks.assignee_id` alone, so the task stayed unassigned
    // everywhere and nobody was notified.
    //
    // Same shape as ad-hoc above, and deliberately so: set the assignee and the reviewers in ONE
    // transaction, then let `subtask-schedule` materialise the bookings. Nothing here talks to
    // `booking-transition`.
    if (isProject) {
      // I41.2 — the due date is the last day the work was PLACED on. Reading it off the typed
      // end date is what recorded a Thursday-Sunday task as due Friday, which the spreader then
      // collapsed back onto Thursday.
      const last = lastPlaced ?? daySpan(endDate, h, tz)
      const assignee = resource!.userId!
      const u = (assignableUsers.data ?? []).find((x) => x.id === assignee)
      try {
        let targetId = subTaskId
        let title = ''
        if (!targetId) {
          // d.8: a NEW task is a SUB-TASK of the selected deliverable — so it appears in that
          // deliverable's task table, its unassigned count and every metric, because it is an
          // ordinary task. It used to be a new DELIVERABLE in an invented `General` stream.
          //
          // ADR-0087 d.12: created UNASSIGNED, then given out through `update_task_assignment`
          // below — the one path on which an out-of-reach assignee becomes a request rather than
          // a refusal. Creating it assigned would put the assignment through ADR-0040's trigger,
          // which refuses and knows nothing of requests. The task is placed where the CALLER can
          // write it: on the assignee's own department when the caller reaches it, and on the
          // caller's own when they do not (the insert policy tests the task's placement against
          // the caller; approval restamps it from the assignee, ADR-0060 d.9).
          // I71.4: "reaches" is WRITE reach, not scheduling reach. Since ADR-0098 a lead schedules anyone, so a direct
          // assignment no longer means the caller may write a task on the assignee's department; placing it there
          // refused every new task a lead gave across departments. `update_task_assignment` moves it to the assignee's.
          const placeOnAssignee = !willRequest && resource != null && inWriteReach(resource)
          title = newTaskName.trim()
          const created = await upsertSubTask.mutateAsync({
            deliverableId,
            title,
            assigneeId: null,
            reviewers: projectReviewers,
            departmentId: placeOnAssignee ? (u?.departmentId ?? null) : (myDepartmentId ?? null),
            teamId: placeOnAssignee ? (u?.teamId ?? null) : (myTeamId ?? null),
            slaHours: h * dayCount,
            startsAt: new Date(first.start).toISOString(),
            dueAt: new Date(last.end).toISOString(),
            reviewMode,
            materialise: false,
          })
          targetId = created.id
          // I71.2 (Edward, 1 Oct, A): a task anyone but the owner adds re-opens an approved list (ADR-0132 d.4), and the
          // gate refuses work on a list waiting for approval. Stop at "added", name who approves it, book nothing.
          const gate = await readTaskListGate(deliverableId)
          if (!gate.approved) {
            setListOwner(gate.ownerName)
            setResult('awaiting_list')
            return
          }
        } else {
          // The title is not being edited here; send the one the task already has, because the RPC
          // requires a non-empty title and rewriting it from this dialog would be a silent rename.
          title = (subTasks.data ?? []).find((x) => x.id === targetId)?.title ?? ''
        }

        // The task IS written even when what follows fails — two calls, two transactions. Holding
        // the id instead of re-opening submit is what stops a retry making a second task, the
        // failure that produced six duplicates on 23 Aug.
        const outcome = await updateTask.mutateAsync({
          subTaskId: targetId,
          title,
          assigneeId: assignee,
          reviewers: projectReviewers,
          startsAt: new Date(first.start).toISOString(),
          dueAt: new Date(last.end).toISOString(),
          hours: h * dayCount,
          reviewMode,
        })
        if (outcome?.outcome === 'requested') {
          // Nothing is booked and nothing is assigned: the lead has been asked (d.4). Requirements
          // staged here are NOT written — they key on an assignment that does not exist yet.
          setResult('requested')
          setTimeout(onClose, 1600)
          return
        }
        if (outcome?.scheduleWarning) {
          setUnscheduled({ subTaskId: targetId, reason: outcome.scheduleWarning })
          return
        }

        // ADR-0042 d.7: the camera, the studio, the van. Written after the task exists, because a
        // requirement keys on sub_task_id. A failure here must never re-open submit — the
        // assignment is committed, and the requirement can be added from the task itself.
        if (pendingResources.length > 0) {
          try {
            const report = await addTaskResources(targetId, claims.tenantId!, pendingResources)
            setRequirementReport(report)
            if (report && (report.contested.length || report.overCapacity.length || report.unplaced.length)) {
              setResult('created')
              return // hold the dialog open so the clash is actually read
            }
          } catch (reqErr) {
            setRequirementError(t('taskResources.addFailed', { message: (reqErr as Error).message }))
            setResult('created')
            return
          }
        }
        setResult('created')
        setTimeout(onClose, 1100)
      } catch (err3) {
        const { code, hint } = err3 as { code?: string; hint?: string; message?: string }
        setError(
          code === '42501'
            ? (hint === 'unplaced_resource' ? t('schedule.refusal.unplaced', { name: resource?.name ?? '' }) : (namedRefusal(err3, t) ?? refusalSentence(err3 as { code?: string; message?: string }) ?? t('schedule.outOfScope')))
            : code === '22023' ? ((err3 as { message?: string }).message ?? t('schedule.createFailed'))
              : t('schedule.createFailed'),
        )
      }
      return
    }

    // What is left is a PLAIN RESERVATION on equipment or a room. No task, no assignee — a block of
    // time against a resource — equipment only.
    try {
      const res = await create.mutateAsync({
        resourceId,
        startsAt: new Date(first.start).toISOString(),
        endsAt: new Date(first.end).toISOString(),
        requested: confirmed ? 'confirmed' : 'tentative',
        hoursPerDay: h,
        notes: adhocText.trim(),
        series: dayCount > 1 ? { freq: 'daily', repeatCount: dayCount, intervalWeeks: 1 } : undefined,
      })
      setResult(res.needsApproval ? 'needs_approval' : 'created')
      setTimeout(onClose, 1100)
    } catch (err2) {
      const code = (err2 as { code?: string }).code
      setError(
        code === 'exclusive_conflict'
          ? t('schedule.assess.exclusive_conflict')
          : code === 'out_of_scope'
            ? t('schedule.outOfScope')
            : t('schedule.createFailed'),
      )
    }
  }

  return (
    // I48.6 / ADR-0092 d.4: the shared Modal owns backdrop-click, Escape and focus; the `.dialog`
    // form stays the card so its field styling is untouched (card={false}).
    <Modal onClose={onClose} card={false}>
      <form className="dialog booking-l2" role="dialog" aria-modal="true" aria-label={t('schedule.newBooking')}
        data-testid="booking-dialog" onSubmit={onSubmit}>
        <header className="booking-l2-head">
          <Tag tone="warn">{canProject ? t('teamView.l2.eyebrow') : t('teamView.l2.eyebrowBook')}</Tag>
          <h2 data-testid="booking-l2-heading">{l2Heading}</h2>
          {l2Context && <p className="booking-l2-context" data-testid="booking-l2-context">{l2Context}</p>}
        </header>
        {resource && canProject && l2Week && (
          <div className="booking-l2-person" data-testid="booking-l2-person">
            <span className="booking-l2-avatar" aria-hidden="true">{[...(resource.name.trim())][0] ?? '?'}</span>
            <span className="booking-l2-who">
              <strong>{resource.name}</strong>
              <span className="muted">
                {l2Week.free.length
                  ? t('teamView.l2.free', { days: new Intl.ListFormat(i18n.language === 'ar' ? 'ar' : 'en-GB', { style: 'long', type: 'conjunction' }).format(l2Week.free) })
                  : t('teamView.l2.noFree')}
              </span>
            </span>
            <span className="load-track booking-l2-track" aria-hidden="true">
              <span className={`load-fill ${l2Week.pct >= (resource.warnAtPct ?? 100) ? 'over' : ''}`} style={{ inlineSize: `${Math.min(l2Week.pct, 100)}%`, display: 'block' }} />
            </span>
            <span className="booking-l2-pct" data-testid="booking-l2-pct">{t('teamView.l2.booked', { pct: l2Week.pct })}</span>
          </div>
        )}

        {draft.resourceId ? (
          <label>
            {t('schedule.resource')}
            <input type="text" value={`${resource?.name ?? ''}${resource?.office ? ` — ${resource.office.name}` : ''}`} readOnly data-testid="booking-resource-fixed" />
            {isLeaving(resource) && <span className="form-error" role="alert" data-testid="booking-resource-leaving">{t('schedule.leaving', { name: resource?.name ?? '' })}</span>}
          </label>
        ) : (
          <label>
            {t('schedule.resource')}
            <select value={resourceId} onChange={(e) => { setResourceId(e.target.value); setAcknowledged(false) }} data-testid="booking-resource">
              {offered.map((r) => (
                <option key={r.id} value={r.id}>{r.name}{r.office ? ` — ${r.office.name}` : ''}</option>
              ))}
            </select>
          </label>
        )}

        {isProject ? (
          <>
            <label>
              {t('schedule.project')}
              <select value={campaignId} onChange={(e) => { setCampaignId(e.target.value); setDeliverableId(''); setSubTaskId('') }} data-testid="booking-project">
                <option value="">{t('schedule.selectProject')}</option>
                {(campaigns.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            {campaignId && (
              <label>
                {t('schedule.deliverable')}
                <select
                  value={deliverableId}
                  onChange={(e) => { setDeliverableId(e.target.value); setSubTaskId('') }}
                  data-testid="booking-deliverable-select"
                >
                  <option value="">{t('schedule.selectDeliverable')}</option>
                  {(tasks.data ?? []).map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </label>
            )}
            {/* ADR-0060 d.3: the tasks still WAITING to be given out. An assigned one is already a
                chip on the grid and is reassigned by dragging it or opening it, which moves the
                booking too — listing it here would be a worse second route to the same thing. */}
            {campaignId && deliverableId && (
              <label>
                {t('schedule.task')}
                <select value={subTaskId} onChange={(e) => setSubTaskId(e.target.value)} data-testid="booking-subtask-select">
                  <option value="">{t('schedule.newTask')}</option>
                  {(subTasks.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>{s.title}</option>
                  ))}
                </select>
                {!subTasks.isLoading && (subTasks.data ?? []).length === 0 && (
                  <span className="field-hint muted" data-testid="booking-no-assignable-tasks">
                    {t('schedule.noAssignableTasks')}
                  </span>
                )}
              </label>
            )}
            {campaignId && deliverableId && !subTaskId && (
              <label>
                {t('schedule.newTaskName')}
                <input type="text" value={newTaskName} onChange={(e) => setNewTaskName(e.target.value)} maxLength={200} data-testid="booking-new-task" />
                <span className="field-hint muted" data-testid="booking-new-task-hint">{t('schedule.newTaskHint')}</span>
              </label>
            )}
            {/* d.10: the requirements picker, in Project mode for the same reason it is in ad-hoc —
                requirements are stated where the work is planned (ADR-0042 d.7). This is also what
                keeps d.6 from being a loss: the camera goes on the task from here. */}
            {campaignId && deliverableId && (
              <StagedTaskResources rows={pendingResources} onChange={setPendingResources} compact />
            )}
            {/* d.4: the field whose absence made this whole branch booking-only. */}
            {campaignId && deliverableId && (
              <div className="field">
                <span className="field-label">{t('reviewers.label')}</span>
                <ReviewerPicker
                  options={reviewers.data ?? []}
                  value={projectReviewers}
                  onChange={setProjectReviewers}
                  excludeUserId={resource?.userId ?? null}
                  testId="booking-project-reviewer"
                />
              </div>
            )}
            {/* d.5: pre-filled from the task's own mode, which the materialiser stamped from its
                workflow step — so a Shoot or an Installation already reads Manual. */}
            {campaignId && deliverableId && (
              <label>
                {t('reviewMode.column')}
                <select
                  value={reviewMode}
                  onChange={(e) => setReviewMode(e.target.value as ReviewMode)}
                  data-testid="booking-review-mode"
                >
                  {REVIEW_MODES.map((m) => (
                    <option key={m} value={m}>{t(reviewModeLabelKey(m))}</option>
                  ))}
                </select>
                <span className="field-hint muted">{t(`reviewMode.hint.${reviewMode}`)}</span>
              </label>
            )}
          </>
        ) : (
          <>
            <label>
              {/* A plain reservation's note, on equipment or a room. */}
              {t('schedule.adhocTaskName')}
              <input type="text" value={adhocText} onChange={(e) => setAdhocText(e.target.value)} maxLength={200} data-testid="booking-adhoc-text" />
            </label>
          </>
        )}

        <div className="dialog-row">
          <label>
            {t('schedule.date')}
            <DateField value={date} onChange={(v) => { setDate(v); if (Date.parse(endDate) < Date.parse(v)) setEndDate(v); setAcknowledged(false) }} data-testid="booking-date" />
          </label>
          <label>
            {t('schedule.endDate')}
            <DateField value={endDate} min={date} onChange={(v) => { setEndDate(v); setAcknowledged(false) }} data-testid="booking-end-date" />
          </label>
          <label>
            {t('schedule.hoursPerDay')}
            <input type="number" min="0.5" max="24" step="0.5" value={hours} onChange={(e) => { setHours(e.target.value); setAcknowledged(false) }} data-testid="booking-hours" />
          </label>
        </div>

        <div className="dialog-row" role="radiogroup" aria-label={t('schedule.status')}>
          <label className="check">
            <input type="radio" name="state" checked={!confirmed} onChange={() => setConfirmed(false)} data-testid="booking-provisional" />
            {t('schedule.provisional')}
          </label>
          <label className="check">
            <input type="radio" name="state" checked={confirmed} onChange={() => setConfirmed(true)} data-testid="booking-confirmed" />
            {t('schedule.confirmed')}
          </label>
        </div>

        {!can('bookings:approve') && resource?.requiresApproval && confirmed && (
          <p className="muted">{t('schedule.willNeedApproval')}</p>
        )}
        {/* ADR-0087 d.2: said BEFORE submit. The server decides; this only words it. */}
        {willRequest && (
          <p className="notice notice-warn" data-testid="booking-will-request">
            {t('schedule.request.willAsk', { department: resource?.departmentName ?? resource?.teamName ?? '' })}
          </p>
        )}
        {dayCount > 1 && <p className="muted">{t('schedule.multiDay', { count: dayCount })}</p>}
        {/* I41.2 — when a day off pushed the work past the typed end date, SAY SO here, before the
            button. The chips appear on the grid afterwards either way; what needs to be visible at
            the point of decision is that the end moved. */}
        {placedEndDate !== endDate && (
          <p className="notice notice-warn" data-testid="booking-ends-on">
            {t('schedule.endsOn', { date: formatCalendarDay(placedEndDate) })}
          </p>
        )}

        {acknowledged && <AssessmentNotice problems={problems} resourceName={resource?.name ?? ''} />}
        {error && <p className="form-error" data-testid="booking-error">{error}</p>}

        {/* Partial success: the task exists, only its schedule is missing. Retrying targets THAT
            task, so pressing it repeatedly can never create another one. */}
        {unscheduled && (
          <div className="form-error" data-testid="booking-unscheduled">
            <p>{t('schedule.unscheduled.partial', { reason: translateScheduleWarning(t, unscheduled.reason) })}</p>
            <Button
              type="button"
              variant="link"
              busy={rescheduleTask.isPending}
              data-testid="booking-unscheduled-retry"
              onClick={() => {
                rescheduleTask.mutate(unscheduled.subTaskId, {
                  onSuccess: () => { setUnscheduled(null); setResult('created'); setTimeout(onClose, 1100) },
                  onError: (e) => setUnscheduled({ ...unscheduled, reason: (e as Error).message }),
                })
              }}
            >
              {t('schedule.unscheduled.retry')}
            </Button>
          </div>
        )}
        {requirementError && (
          <p className="form-error" data-testid="booking-requirement-error">{requirementError}</p>
        )}
        {requirementReport && (
          <div className="requirement-outcome" data-testid="booking-requirement-outcome">
            {requirementReport.contested.map((n) => (
              <p className="warning-text" key={n}>{t('taskResources.contested', { names: n })}</p>
            ))}
            {requirementReport.overCapacity.map((n) => (
              <p className="warning-text" key={n}>{t('taskResources.overCapacity', { names: n })}</p>
            ))}
            {requirementReport.unplaced.map((u) => (
              <p className="error-text" key={u.resource}>
                {t('taskResources.unplaced', { name: u.resource, reason: u.reason })}
              </p>
            ))}
          </div>
        )}
        {result && (
          <p className="notice notice-ok" data-testid="booking-result">
            {result === 'needs_approval'
              ? t('schedule.createdNeedsApproval')
              : result === 'requested'
                ? t('schedule.request.sent', { department: resource?.departmentName ?? resource?.teamName ?? '' })
                : result === 'awaiting_list'
                  ? (listOwner
                      ? t('schedule.addedAwaitingList', { task: newTaskName.trim(), owner: listOwner })
                      : t('schedule.addedAwaitingListNoName', { task: newTaskName.trim() }))
                  : t('schedule.created')}
          </p>
        )}

        <div className="dialog-actions booking-l2-foot">
          {l2Told && <span className="booking-l2-told" data-testid="booking-l2-told">{l2Told}</span>}
          <Button variant="secondary" onClick={onClose} data-testid="booking-cancel">
            {t('schedule.cancel')}
          </Button>
          {/* ADR-0061 d.3. `busy` used to be wired to `create` alone — the PLAIN BOOKING mutation —
              so during an assignment (createAdhoc, or upsertSubTask/updateTask on the project
              branch) the button neither spun nor disabled. Two round trips of silence, and the
              person pressed again: two of the five duplicate tasks on 27 Aug were 4.2 and 1.4
              seconds apart. Every mutation this form can start is covered here. */}
          <Button variant="primary"
            type="submit"
            busy={create.isPending || upsertSubTask.isPending || updateTask.isPending}
            disabled={result != null || unscheduled != null || (acknowledged && worstIsConflict && confirmed) || isLeaving(resource)}
            data-testid="booking-submit"
          >
            {acknowledged && hasFindings ? t('schedule.proceedAnyway') : willRequest ? t('schedule.request.ask') : t('schedule.book')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
