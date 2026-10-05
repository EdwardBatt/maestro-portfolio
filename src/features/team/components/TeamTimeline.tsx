import { useMemo, useState } from 'react'
import { taskClickHref } from '../../../lib/navigation/piece-link'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { Modal, ModalFooter, ModalHeader } from '../../../components/Modal'
import { isWorkingDay, localDayOf } from '../../../lib/capacity/working-week.ts'
import { hoursToLoadPct } from '../../../lib/capacity/day-hours.ts'
import { formatCalendarDay, formatIraqDate, iraqDay } from '../../../lib/time/iraq'
import {
  useReassignTaskToResource,
  type ScheduleBlackout,
  type ScheduleBooking,
  type ScheduleResource,
} from '../../schedule/api/schedule-api'
import { assessDrop, hasFindings, landsOnDay, pastPieceDue, taskSpanDays, type DropCheck } from '../../schedule/lib/drop-check'
import { withRoom, type RoomCandidate } from '../../schedule/lib/week-load'
import { useWriteScope } from '../../schedule/hooks/use-write-scope'
import { MoveWarningDialog } from '../../schedule/components/MoveWarningDialog'
import { BookingDialog, type BookingDraft } from '../../schedule/components/BookingDialog'
import { ChangeAskDialog } from '../../campaigns/components/ChangeAskDialog'
import { teamViewKeys, type TeamTask } from '../api/team-view-api'
import type { TeamLoadPerson } from '../api/team-api'
import { assignDialogReason, hoursPerDayOf, layoutBars, taskLabel, timelineStatus, TIMELINE_STATUSES, workstreamsOnScreen, type Bar, type Section, type WeekDay } from '../lib/team-view'

/**
 * The team timeline (Figma L3, plan View 7 / 8, ADR-0105 d.4 / d.5): a row per person, one bar per
 * TASK over its booked days, coloured by its status (I67.3), and a "Nobody yet" row of work no one has.
 *
 * Dragging a bar moves the TASK — to another day, another person, or from Nobody yet onto a person
 * (which assigns it). It goes through the Schedule's own reassignment (`useReassignTaskToResource`,
 * ADR-0039 d.6 / ADR-0060: booking a campaign task is assigning it) and the Schedule's own checks
 * (`assessDrop`), so the two screens cannot disagree about what a move does or what it warns about.
 * A drop with something to say waits in the L6 / L7 dialog; nothing moves until a choice.
 *
 * A drop from Nobody yet the drag cannot finish — no reviewer, or no hours (E11) — opens the
 * Schedule's own assignment dialog instead, pre-filled with the person, the day and the task, so
 * only what is missing is asked for (settled 25 Sep). The database's refusal is never the answer.
 */
export interface TeamTimelineProps {
  sections: readonly Section[]
  days: readonly WeekDay[]
  tasks: readonly TeamTask[]
  bookings: readonly ScheduleBooking[]
  blackouts: readonly ScheduleBlackout[]
  resources: ReadonlyMap<string, ScheduleResource>
  /** userId → job title */
  titles: ReadonlyMap<string, string>
  workstream: string | null
  onWorkstream: (id: string | null) => void
  now: number
}

type Pending = { task: TeamTask; resource: ScheduleResource; isoDate: string; check: DropCheck }
type Confirm = { task: TeamTask; resource: ScheduleResource; isoDate: string }

const BAR_H = 26
const DAY_MS = 86_400_000

export function TeamTimeline(props: TeamTimelineProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'ar' ? 'ar' : 'en-GB'
  const reassign = useReassignTaskToResource()
  const { can, ready, canWriteResource, canRequestResource, refusalFor, routeFor } = useWriteScope()
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [asking, setAsking] = useState<{ task: TeamTask; landsOn: string } | null>(null)
  const [assigning, setAssigning] = useState<BookingDraft | null>(null)
  const qc = useQueryClient()
  const [banner, setBanner] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const people = useMemo(() => props.sections.flatMap((s) => s.people), [props.sections])
  const rowIds = useMemo(() => new Set(people.map((p) => p.id)), [people])
  const tasksById = useMemo(() => new Map(props.tasks.map((x) => [x.id, x])), [props.tasks])
  const bars = useMemo(
    () => layoutBars(props.tasks, props.bookings, props.days, rowIds, props.now),
    [props.tasks, props.bookings, props.days, rowIds, props.now],
  )
  const barsByRow = useMemo(() => {
    const m = new Map<string, Bar[]>()
    for (const b of bars) {
      const k = b.resourceId ?? '__nobody__'
      m.set(k, [...(m.get(k) ?? []), b])
    }
    return m
  }, [bars])
  const unassigned = barsByRow.get('__nobody__') ?? []
  // Dated work nobody has sits on its days; undated work has no day, so it wraps across the week.
  const unassignedDated = unassigned.filter((b) => !b.undated)
  const unassignedUndated = unassigned.filter((b) => b.undated)

  /** Who a move could go to instead: the people on screen, this week. */
  const candidates: RoomCandidate[] = useMemo(
    () =>
      people
        .filter((p) => props.resources.get(p.id)?.userId)
        .map((p) => ({ resourceId: p.id, name: p.name, pct: p.utilPct, warnPct: p.warnPct })),
    [people, props.resources],
  )

  const todayIso = iraqDay(props.now)
  const todayCol = props.days.findIndex((d) => d.isoDate === todayIso)
  const dayLabel = (iso: string) => formatCalendarDay(iso)
  const label = taskLabel
  const navigate = useNavigate()
  // Edward, 27 Sep: a bar says what it is on hover — the task, its client and campaign — and opens
  // its task page on a click. Fixed to the viewport, so a bar near the edge of the grid is not clipped.
  const [peek, setPeek] = useState<{ taskId: string; x: number; y: number } | null>(null)

  // ---------------------------------------------------------------- the write
  function apply(task: TeamTask, resource: ScheduleResource, isoDate: string) {
    setBanner(null)
    setNotice(null)
    if (!resource.userId) {
      setBanner(t('schedule.reassign.noUser', { name: resource.name }))
      return
    }
    reassign.mutate(
      { subTaskId: task.id, targetUserId: resource.userId, targetIsoDate: isoDate, timezone: resource.office?.timezone ?? 'UTC' },
      {
        // ADR-0087 d.12: the server may record a REQUEST instead; the bar stays until it is answered.
        onSuccess: (row) => {
          if (row?.outcome === 'requested')
            setNotice(t('schedule.request.sent', { department: resource.departmentName ?? resource.teamName ?? '' }))
        },
        onError: (err) => {
          const e = err as { code?: string; message?: string; hint?: string }
          setBanner(
            e.code === '42501'
              ? e.hint === 'unplaced_resource'
                ? t('schedule.refusal.unplaced', { name: resource.name })
                : t('schedule.outOfScope')
              : (e.message ?? t('schedule.moveFailed')),
          )
        },
      },
    )
  }

  /** Clean, or answered: onto another person asks once more, as the Schedule's reassign does. */
  function commit(task: TeamTask, resource: ScheduleResource, isoDate: string, answered: boolean) {
    const sameRow = task.assigneeId != null && task.assigneeId === resource.userId
    if (!answered && !sameRow) return setConfirm({ task, resource, isoDate })
    apply(task, resource, isoDate)
  }

  // ---------------------------------------------------------------- the drop
  function onDrop(taskId: string, resource: ScheduleResource, day: WeekDay) {
    const task = tasksById.get(taskId)
    if (!task) return
    setBanner(null)
    // The grid's own gate: you may write this row, or the move becomes a request (ADR-0087 d.12).
    const action = task.assigneeId ? 'update' : 'create'
    if (!canWriteResource(action, resource) && !canRequestResource(resource)) {
      const r = refusalFor(resource, action)
      setBanner(t(r.key, r.params))
      return
    }
    const spanDays = taskSpanDays(task.startsAt, task.dueAt)
    if (assignDialogReason(task, resource.userId)) {
      setAssigning({
        resourceId: resource.id,
        isoDate: day.isoDate,
        endIsoDate: landsOnDay(day.isoDate, spanDays),
        campaignId: task.campaignId ?? undefined,
        deliverableId: task.campaignId ? task.deliverableId : undefined,
        subTaskId: task.campaignId ? task.id : undefined,
        hoursPerDay: hoursPerDayOf(task.hours, spanDays),
      })
      return
    }
    const tz = resource.office?.timezone ?? 'UTC'
    const nonWorking = resource.office ? !isWorkingDay(localDayOf(day.epoch + 43_200_000, tz), resource.office) : false
    const dayEnd = day.epoch + DAY_MS
    const blackout = props.blackouts.some((b) => b.resourceId === resource.id && b.start < dayEnd && b.end > day.epoch)
    // The task's own bookings are what moves; they never count against the day it lands on.
    const cellBookings = props.bookings.filter(
      (b) => b.resourceId === resource.id && b.subTaskId !== task.id && b.start < dayEnd && b.end > day.epoch,
    )
    const perDay = task.hours != null ? task.hours / spanDays : 8
    const moving = {
      id: `task:${task.id}`,
      resourceId: resource.id,
      state: 'confirmed',
      loadPct: hoursToLoadPct(perDay),
      start: day.epoch,
      end: dayEnd,
      subTaskId: task.id,
    } as ScheduleBooking
    const check = assessDrop({
      targetResource: resource,
      cellBookings,
      moving,
      nonWorking,
      blackout,
      commitment: { committedDueAt: task.committedDueAt, landsOn: landsOnDay(day.isoDate, spanDays) },
    })
    if (hasFindings(check)) setPending({ task, resource, isoDate: day.isoDate, check })
    else commit(task, resource, day.isoDate, false)
  }

  // ---------------------------------------------------------------- drawing
  const renderBars = (rowBars: Bar[]) =>
    rowBars.map((bar) => {
      const task = tasksById.get(bar.taskId)!
      // Coloured by the task's status (I67.3); the workstream is a filter, not a colour.
      const status = timelineStatus(task, bar.resourceId)
      const faded = props.workstream != null && task.workstreamId !== props.workstream
      // The Schedule's rule for a chip: you move what you may write. Work nobody has yet is
      // moved by whoever may book (ADR-0098: anyone who may book books anyone within scope).
      const draggable =
        bar.resourceId == null
          ? !ready || can('bookings:create')
          : (() => { const r = props.resources.get(bar.resourceId); return r ? canWriteResource('update', r) : false })()
      return (
        <div
          key={`${bar.taskId}-${bar.resourceId ?? 'none'}`}
          className={[
            'tv-bar',
            bar.resourceId == null ? 'tv-bar-nobody' : '',
            bar.undated ? 'tv-chip' : '',
            bar.late ? 'tv-bar-late' : '',
            faded ? 'tv-bar-faded' : '',
          ].filter(Boolean).join(' ')}
          data-status={status}
          data-testid={`tv-bar-${bar.taskId}`}
          data-late={bar.late || undefined}
          // An undated chip sits in the wrapping strip, in the flow — it has no day to be placed on.
          style={
            bar.undated
              ? undefined
              : {
                  insetInlineStart: `calc(${(bar.from / props.days.length) * 100}% + 2px)`,
                  inlineSize: `calc(${((bar.to - bar.from + 1) / props.days.length) * 100}% - 4px)`,
                  insetBlockStart: `${bar.lane * (BAR_H + 4) + 4}px`,
                }
          }
          draggable={draggable}
          onDragStart={(e) => { setPeek(null); e.dataTransfer.setData('text/team-task', bar.taskId) }}
          onMouseEnter={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPeek({ taskId: bar.taskId, x: r.left, y: r.bottom }) }}
          onMouseLeave={() => setPeek(null)}
          onClick={() => navigate(taskClickHref(task, can('project_tasks:manage')))}
          role="link"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter') navigate(taskClickHref(task, can('project_tasks:manage'))) }}
          aria-label={[label(task), task.clientName, task.campaignName].filter(Boolean).join(' · ')}
        >
          <span className="tv-bar-label">{label(task)}</span>
          {bar.resourceId == null && task.hours != null && (
            <span className="tv-bar-meta">{t('teamView.timeline.hours', { hours: task.hours })}</span>
          )}
          {bar.undated && (
            <span className="tv-bar-meta">
              {t('teamView.timeline.undated')}
              {draggable && ` · ${t('teamView.timeline.dragHint')}`}
            </span>
          )}
          {bar.state && <em className="tv-bar-tag" data-testid={`tv-bar-state-${bar.taskId}`}>{t(`teamView.state.${bar.state}`)}</em>}
          {status === 'blocked' && task.waitingOn && (
            // L3: "Winner cards · blocked · Arabic copy" — what it waits on, on the bar.
            <em className="tv-bar-tag" data-testid={`tv-bar-blocked-${bar.taskId}`}>{t('teamView.state.blocked', { on: task.waitingOn })}</em>
          )}
          {bar.late && <em className="tv-bar-tag tv-bar-tag-late">{t('teamView.state.late')}</em>}
        </div>
      )
    })

  const laneHeight = (rowBars: Bar[]) => Math.max(1, ...rowBars.map((b) => b.lane + 1)) * (BAR_H + 4) + 4

  const row = (p: TeamLoadPerson) => {
    const r = props.resources.get(p.id)
    const rowBars = barsByRow.get(p.id) ?? []
    const title = r?.userId ? props.titles.get(r.userId) : undefined
    return (
      <div key={p.id} className={`tv-row${p.utilPct === 0 ? ' tv-row-idle' : ''}`} data-testid={`team-row-${p.id}`}>
        <div className="tv-who">
          <span className={`tv-avatar${p.level !== 'ok' ? ' tv-avatar-over' : ''}`} aria-hidden="true" />
          <span className="tv-name">{p.name}</span>
          {title && <span className="tv-role muted">{title}</span>}
          <span className={`tv-pct${p.level !== 'ok' ? ' tv-pct-over' : ''}`} data-testid={`team-row-pct-${p.id}`}>{p.utilPct}%</span>
        </div>
        <div className="tv-track" style={{ blockSize: `${laneHeight(rowBars)}px` }}>
          {props.days.map((d, i) => {
            const cellKey = `${p.id}|${d.isoDate}`
            const off = r?.office ? !isWorkingDay(localDayOf(d.epoch + 43_200_000, r.office.timezone), r.office) : false
            return (
              <div
                key={d.isoDate}
                className={['tv-cell', off ? 'tv-cell-off' : '', dragOver === cellKey ? 'tv-cell-over' : ''].filter(Boolean).join(' ')}
                style={{ insetInlineStart: `${(i / props.days.length) * 100}%`, inlineSize: `${100 / props.days.length}%` }}
                data-testid={`tv-cell-${p.id}-${d.isoDate}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(cellKey) }}
                onDragLeave={() => setDragOver((cur) => (cur === cellKey ? null : cur))}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOver(null)
                  const id = e.dataTransfer.getData('text/team-task')
                  if (r && id) onDrop(id, r, d)
                }}
              />
            )
          })}
          {renderBars(rowBars)}
        </div>
      </div>
    )
  }

  return (
    <div className="tv-timeline" data-testid="team-timeline">
      {banner && <p className="form-error" role="alert" data-testid="team-banner">{banner}</p>}
      {notice && <p className="notice notice-ok" role="status" data-testid="team-notice">{notice}</p>}

      <div className="tv-grid">
        <div className="tv-row tv-head">
          <div className="tv-who" />
          <div className="tv-track tv-track-head">
            {props.days.map((d, i) => (
              <span
                key={d.isoDate}
                className={`tv-day${d.isoDate === todayIso ? ' tv-day-today' : ''}`}
                style={{ insetInlineStart: `${(i / props.days.length) * 100}%`, inlineSize: `${100 / props.days.length}%` }}
              >
                {new Date(d.epoch).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', timeZone: 'UTC' })}
              </span>
            ))}
          </div>
        </div>
        <div className="tv-body">
          {todayCol >= 0 && (
            <span
              className="tv-today"
              aria-hidden="true"
              data-testid="team-today-line"
              style={{ insetInlineStart: `calc(var(--tv-who) + (100% - var(--tv-who)) * ${(todayCol + 0.5) / props.days.length})` }}
            />
          )}
          {props.sections.map((s) => (
            <div key={s.key} className="tv-section" data-testid={`team-section-${s.key}`}>
              {s.kind !== 'all' && (
                <div className="tv-group" data-testid={`team-group-${s.key}`}>
                  {s.kind === 'none' ? t('teamView.noTeam') : s.label}
                  <span className="muted"> · {t('teamView.pct', { pct: s.pct })}</span>
                </div>
              )}
              {s.people.map(row)}
            </div>
          ))}
          <div className="tv-row tv-row-nobody" data-testid="team-row-nobody">
            <div className="tv-who">
              <span className="tv-avatar tv-avatar-nobody" aria-hidden="true" />
              <span className="tv-name">{t('teamView.timeline.nobody')}</span>
              <span className="tv-pct muted">—</span>
            </div>
            <div className="tv-nobody-track">
              {unassignedDated.length > 0 && (
                <div className="tv-track" style={{ blockSize: `${laneHeight(unassignedDated)}px` }}>
                  {renderBars(unassignedDated)}
                </div>
              )}
              {unassignedUndated.length > 0 && (
                <div className="tv-chips" data-testid="team-nobody-undated">
                  {renderBars(unassignedUndated)}
                </div>
              )}
              {unassigned.length === 0 && <div className="tv-track" style={{ blockSize: `${laneHeight([])}px` }} />}
            </div>
          </div>
        </div>
      </div>
      <p className="muted tv-foot">{t('teamView.timeline.foot')}</p>

      {peek && (() => {
        const task = tasksById.get(peek.taskId)
        if (!task) return null
        return (
          <div className="tv-peek" role="tooltip" style={{ insetInlineStart: `${peek.x}px`, insetBlockStart: `${peek.y + 6}px` }} data-testid="tv-peek">
            <strong className="tv-peek-title">{label(task)}</strong>
            <dl>
              <dt>{t('teamView.peek.client')}</dt><dd data-testid="tv-peek-client">{task.clientName ?? '—'}</dd>
              <dt>{t('teamView.peek.campaign')}</dt><dd data-testid="tv-peek-campaign">{task.campaignName ?? '—'}</dd>
              {task.workstreamName && (<><dt>{t('teamView.peek.workstream')}</dt><dd>{task.workstreamName}</dd></>)}
              <dt>{t('teamView.peek.due')}</dt><dd>{task.dueAt ? formatIraqDate(task.dueAt) : '—'}</dd>
            </dl>
            <span className="tv-peek-hint">{t('teamView.peek.open')}</span>
          </div>
        )
      })()}

      {pending && (() => {
        const { task, resource, isoDate, check } = pending
        const keepDateIso = task.startsAt ? iraqDay(task.startsAt) : null
        const target = (id: string) => props.resources.get(id)
        return (
          <MoveWarningDialog
            testId="team-move-warning"
            taskLabel={label(task)}
            targetName={resource.name}
            targetIsoDate={isoDate}
            check={check}
            targetWeekPct={candidates.find((c) => c.resourceId === resource.id)?.pct ?? null}
            room={withRoom(candidates, resource.id)}
            keepDateIso={keepDateIso}
            // ADR-0141 d.2: the change form only when the work would end after the PIECE's due date.
            canAskExtension={task.assigneeId != null && pastPieceDue(check.pastCommitment?.landsOn, task.deliverableDueAt)}
            busy={reassign.isPending}
            onProceed={() => { setPending(null); commit(task, resource, isoDate, true) }}
            onInstead={(id) => { setPending(null); const r = target(id); if (r) commit(task, r, isoDate, true) }}
            onKeepDate={(id) => { setPending(null); const r = target(id); if (r) commit(task, r, keepDateIso ?? isoDate, true) }}
            onAskExtension={() => { setPending(null); setAsking({ task, landsOn: check.pastCommitment?.landsOn ?? isoDate }) }}
            onCancel={() => setPending(null)}
          />
        )
      })()}

      {confirm && (
        <Modal onClose={() => setConfirm(null)} testId="team-assign-confirm" labelledById="team-assign-title">
          <ModalHeader
            id="team-assign-title"
            eyebrow={t(confirm.task.assigneeId ? 'teamView.assign.eyebrowMove' : 'teamView.assign.eyebrow')}
            title={label(confirm.task)}
            subtitle={
              <span data-testid="team-assign-body">
                {t(
                  routeFor(confirm.resource) === 'request'
                    ? 'teamView.assign.bodyRequest'
                    : confirm.task.assigneeId
                      ? 'teamView.assign.bodyMove'
                      : 'teamView.assign.body',
                  {
                    name: confirm.resource.name,
                    day: dayLabel(confirm.isoDate),
                    department: confirm.resource.departmentName ?? confirm.resource.teamName ?? '',
                  },
                )}
              </span>
            }
          />
          <ModalFooter note={t('teamView.assign.told', { name: confirm.resource.name })}>
            <Button
              variant="primary"
              busy={reassign.isPending}
              onClick={() => { const c = confirm; setConfirm(null); apply(c.task, c.resource, c.isoDate) }}
              data-testid="team-assign-confirm-apply"
            >
              {t('teamView.assign.confirm', { name: confirm.resource.name })}
            </Button>
            <Button variant="secondary" onClick={() => setConfirm(null)} data-testid="team-assign-confirm-cancel">
              {t('teamView.move.cancel')}
            </Button>
          </ModalFooter>
        </Modal>
      )}

      {assigning && (
        <BookingDialog
          draft={assigning}
          resources={[...props.resources.values()]}
          bookings={[...props.bookings]}
          blackouts={[...props.blackouts]}
          onClose={() => {
            setAssigning(null)
            void qc.invalidateQueries({ queryKey: teamViewKeys.all })
          }}
        />
      )}

      {/* ADR-0141 d.2/d.5 (I74.14, I74.16): a move past the date asks the account manager through the one form, filled in. */}
      {asking && (
        <ChangeAskDialog
          deliverableId={asking.task.deliverableId}
          fromSubTaskId={asking.task.id}
          initialDueDay={asking.landsOn}
          onClose={() => setAsking(null)}
          testId="team-change-ask"
        />
      )}
    </div>
  )
}

/**
 * The timeline's key and workstream filter (Figma L3: the key as dots, top-right on the tabs' line).
 * The key is the status (I67.3, Edward 30 Sep, A) — every status, always, so it reads the same on every week;
 * the workstreams on screen are the filter's choices.
 */
export function TeamTimelineKey(
  props: Pick<TeamTimelineProps, 'sections' | 'days' | 'tasks' | 'bookings' | 'workstream' | 'onWorkstream' | 'now'>,
) {
  const { t } = useTranslation()
  const rowIds = useMemo(() => new Set(props.sections.flatMap((s) => s.people.map((p) => p.id))), [props.sections])
  const bars = useMemo(
    () => layoutBars(props.tasks, props.bookings, props.days, rowIds, props.now),
    [props.tasks, props.bookings, props.days, rowIds, props.now],
  )
  const key = useMemo(() => workstreamsOnScreen(props.tasks, bars), [props.tasks, bars])
  return (
    <div className="tv-toolbar">
      <div className="tv-key" data-testid="team-key" aria-label={t('teamView.timeline.key')}>
        {TIMELINE_STATUSES.map((s) => (
          <span key={s} className="tv-key-item" data-status={s} data-testid={`team-key-${s}`}>
            <i aria-hidden="true" />
            {t(`teamView.timeline.status.${s}`)}
          </span>
        ))}
      </div>
      {key.length > 0 && (
        <label className="tv-filter">
          <span>{t('teamView.timeline.workstream')}</span>
          <select
            value={props.workstream ?? ''}
            onChange={(e) => props.onWorkstream(e.target.value || null)}
            data-testid="team-workstream-filter"
          >
            <option value="">{t('teamView.timeline.allWorkstreams')}</option>
            {key.map((w) => (
              <option key={w.id} value={w.id}>{[w.campaignName, w.name].filter(Boolean).join(' · ')}</option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}
