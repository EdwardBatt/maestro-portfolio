import { useMemo, useState } from 'react'
import { iraqDay } from '../../../lib/time/iraq'
import { formatPlanDay } from '../../../lib/timing/plan-back'
import { ProgressLines } from '../../../components/DeliverableProgress'
import { useTranslation } from 'react-i18next'
import { useWriteScope } from '../hooks/use-write-scope.ts'
import { isWorkingDay, localDayOf } from '../../../lib/capacity/working-week.ts'
import { loadPctToHours } from '../../../lib/capacity/day-hours.ts'
import { chipWidthPct } from '../lib/chip-width.ts'
import { chipKind } from '../lib/chip-kind.ts'
import { PriorityMark } from '../../../components/PriorityMark'
import type { ScheduleBlackout, ScheduleBooking, ScheduleResource, TaskCommitment } from '../api/schedule-api'
import { assessDrop, hasFindings, landsOnDay, pastPieceDue, taskSpanDays, type DropCheck } from '../lib/drop-check.ts'
import { dayLoad, freeHoursOf, internalLoad, type DayLoad } from '../lib/day-load.ts'
import { blocksWholeDay, internalHoursOn, isFullBlock } from '../../../lib/capacity/blocked-time.ts'
import { askDays, askHoursPerDay, type TaskAsk } from '../../../lib/task-asks/asks.ts'
import { STANDARD_DAY_HOURS } from '../../../lib/capacity/day-hours.ts'
import { Avatar } from './Avatar'
import { roomCandidates, weekStartOf, withRoom } from '../lib/week-load.ts'
import { MoveWarningDialog } from './MoveWarningDialog'
import { requestHoursPerDay, requestSpan, type AssignmentRequest } from '../../../lib/assignment-requests/requests'

/**
 * ADR-0006 day-cell grid: rows = resources, columns = dates, one cell per
 * resource-day. Cells carry the add action; chips drag between cells (native
 * DnD) and click-to-edit is the keyboard path. 7 days always rendered; each
 * row shades its OWN office's non-working days (ADR-0005).
 */

export interface DayColumn {
  /** UTC midnight of the column's date (grid spine) */
  epoch: number
  isoDate: string
}

export function buildColumns(startEpoch: number, days: number): DayColumn[] {
  return Array.from({ length: days }, (_, i) => {
    const epoch = startEpoch + i * 86_400_000
    return { epoch, isoDate: new Date(epoch).toISOString().slice(0, 10) }
  })
}

/** A booking overlaps a column when any part of its span falls on that UTC date. */
function bookingsFor(bookings: ScheduleBooking[], col: DayColumn): ScheduleBooking[] {
  const dayStart = col.epoch
  const dayEnd = col.epoch + 86_400_000
  return bookings.filter((b) => b.start < dayEnd && b.end > dayStart)
}

/** ADR-0142 d.4: leave (and any other whole-day block) shades the day; internal work with hours does not. */
function blackoutFor(blackouts: ScheduleBlackout[], col: DayColumn): boolean {
  return blocksWholeDay(blackouts, col.epoch)
}

/** The internal work on this person-day: its hours (spread over its working days) and what it is for. */
function internalFor(blackouts: ScheduleBlackout[], col: DayColumn, isWorking: (dayStart: number) => boolean) {
  const hours = internalHoursOn(blackouts, col.epoch, isWorking)
  const what = blackouts.filter((b) => !isFullBlock(b) && b.start < col.epoch + 86_400_000 && b.end > col.epoch)
  return { hours, what }
}

/**
 * ADR-0087 d.11: a pending request lands on the days it asks for, measured exactly as a booking is
 * — so the *requested* chip sits where the booking will once the lead agrees. It is drawn from the
 * request, not from a booking, because no booking exists; and it is kept OUT of `cellBookings`, so
 * it counts toward nothing — not the overload badge, not a drop check (d.10).
 */
function requestsFor(requests: AssignmentRequest[], col: DayColumn): AssignmentRequest[] {
  const dayStart = col.epoch
  const dayEnd = col.epoch + 86_400_000
  return requests.filter((r) => {
    const span = requestSpan(r)
    return span != null && span.start < dayEnd && span.end > dayStart
  })
}

export interface DayGridProps {
  resources: ScheduleResource[]
  bookings: ScheduleBooking[]
  blackouts: ScheduleBlackout[]
  columns: DayColumn[]
  onAdd: (resourceId: string, isoDate: string) => void
  onChipClick: (booking: ScheduleBooking) => void
  onChipMove: (booking: ScheduleBooking, targetResourceId: string, targetIsoDate: string) => void
  /** Tried to write a resource the viewer cannot. The ACTION matters: adding needs
   *  bookings:create, dropping a chip needs bookings:update — and the refusal says so. */
  onBlocked: (resource: ScheduleResource, action: 'create' | 'update') => void
  /** ADR-0087 d.11: pending booking requests, drawn on the requested person's row. */
  requests?: AssignmentRequest[]
  /** The approver's door from the grid, and the requester's: open the request. */
  onRequestClick?: (request: AssignmentRequest) => void
  /** I59.13: each task chip's span and committed date, so a drop past the commitment warns (L6). */
  commitments?: ReadonlyMap<string, TaskCommitment>
  /** I59.13: L6's "Ask for the extension" — the caller opens today's request for the task. */
  onAskExtension?: (booking: ScheduleBooking, landsOn: string) => void
  /**
   * I74.22 (Figma L SC-02): a piece is picked from To book — every cell becomes a place to click, and a
   * click opens the booking window for that person and day instead of the "+".
   */
  picking?: boolean
  onCellPick?: (resourceId: string, isoDate: string) => void
  /** A To book card dropped on a day (SC-01: "Drag a piece from To book onto a day"). */
  onPieceDrop?: (deliverableId: string, resourceId: string, isoDate: string) => void
  /** The picked piece's due day — its column is marked DUE (SC-02). */
  dueIso?: string | null
  /** The viewer's own login, so their row reads "(you)" (SC-01). */
  meUserId?: string | null
  /**
   * ADR-0139 d.6 (SC-18, SC-19): the viewer's asks of other teams still waiting — drawn on an "Other
   * teams" row as the dashed ⏳ chip until answered. Counted in nobody's hours: nothing is booked yet.
   */
  asksSent?: TaskAsk[]
  onAskClick?: (ask: TaskAsk) => void
}

const STATE_KEY: Record<DayLoad['state'], string> = {
  free: 'schedule.sc.cell.free', full: 'schedule.sc.cell.full', over: 'schedule.sc.cell.over', off: 'schedule.sc.cell.off', leave: 'schedule.sc.cell.leave',
}

export function DayGrid(props: DayGridProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'ar' ? 'ar' : 'en-GB'
  const [dragOver, setDragOver] = useState<string | null>(null)
  /**
   * I41.5 — a drop that has something to say waits for an answer. A clean one does not: the drag
   * stays as immediate as it was, and only a day off, a blackout or a day that would go over
   * capacity interrupts it. Never a refusal (ADR-0061 d.2) — the assigner is told and proceeds,
   * and `bookings` is audited either way.
   */
  const [pendingDrop, setPendingDrop] = useState<
    { booking: ScheduleBooking; resource: ScheduleResource; isoDate: string; check: DropCheck } | null
  >(null)

  // Can the viewer WRITE this resource's row? Two different questions, so two different checks:
  // the "+" button INSERTS a booking (bookings:create) while dragging a chip UPDATES one
  // (bookings:update) — the grid used to ask for create in both places. Scope comes from the
  // shared mirror of app.resource_in_write_scope; see lib/write-scope.ts for the two spots where
  // it deliberately leans ALLOW rather than risk blocking a legitimately-scoped user.
  const { canWriteResource, canRequestResource } = useWriteScope()

  const byResource = useMemo(() => {
    const m = new Map<string, ScheduleBooking[]>()
    for (const b of props.bookings) {
      const list = m.get(b.resourceId) ?? []
      list.push(b)
      m.set(b.resourceId, list)
    }
    return m
  }, [props.bookings])

  const blackoutsByResource = useMemo(() => {
    const m = new Map<string, ScheduleBlackout[]>()
    for (const b of props.blackouts) {
      const list = m.get(b.resourceId) ?? []
      list.push(b)
      m.set(b.resourceId, list)
    }
    return m
  }, [props.blackouts])

  const requestsByResource = useMemo(() => {
    const m = new Map<string, AssignmentRequest[]>()
    for (const r of props.requests ?? []) {
      const list = m.get(r.resourceId) ?? []
      list.push(r)
      m.set(r.resourceId, list)
    }
    return m
  }, [props.requests])

  // Iraq's today (ADR-0076 d.1) — this marks the current column, and between midnight and 03:00
  // Baghdad the UTC day would highlight yesterday.
  const today = iraqDay(Date.now())

  // Group resource rows by department, with a labelled header before each group.
  // Null-department rows sort last under a fallback label; departments and the
  // people within them are ordered alphabetically.
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; label: string; resources: ScheduleResource[] }>()
    for (const r of props.resources) {
      const key = r.departmentName ?? '￿'
      if (!m.has(key)) m.set(key, { key, label: r.departmentName ?? t('schedule.noDepartment'), resources: [] })
      m.get(key)!.resources.push(r)
    }
    return [...m.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((g) => ({ ...g, resources: [...g.resources].sort((x, y) => x.name.localeCompare(y.name)) }))
  }, [props.resources, t])

  // A column is COLLAPSED (narrow) when it is a non-working day for EVERY office
  // shown AND carries no bookings — weekends shrink to give working days room, but
  // any column with an actual booking stays full width. (Per-office: if any office
  // works that day, or a resource has no office, the column is never collapsed.)
  const colCollapsed = useMemo(
    () =>
      props.columns.map((col) => {
        const noon = col.epoch + 43_200_000
        const offForAll =
          props.resources.length > 0 &&
          props.resources.every((r) =>
            r.office ? !isWorkingDay(localDayOf(noon, r.office.timezone), r.office) : false,
          )
        if (!offForAll) return false
        const dayEnd = col.epoch + 86_400_000
        const hasBooking = props.bookings.some((b) => b.start < dayEnd && b.end > col.epoch)
        return !hasBooking
      }),
    [props.columns, props.resources, props.bookings],
  )

  // I74.24: each person-day in words, through the drop check's own calculation (`dayLoad` → `overloadFor`).
  const loads = useMemo(() => {
    const m = new Map<string, DayLoad>()
    for (const r of props.resources) {
      const rb = byResource.get(r.id) ?? []
      const rbo = blackoutsByResource.get(r.id) ?? []
      const working = (dayStart: number) => (r.office ? isWorkingDay(localDayOf(dayStart + 43_200_000, r.office.timezone), r.office) : true)
      for (const col of props.columns) {
        const nonWorking = !working(col.epoch)
        const internal = internalLoad(internalFor(rbo, col, working).hours, `${r.id}|${col.isoDate}`)
        m.set(`${r.id}|${col.isoDate}`, dayLoad(r, [...bookingsFor(rb, col), ...internal], { nonWorking, onLeave: blackoutFor(rbo, col) }))
      }
    }
    return m
  }, [props.resources, props.columns, byResource, blackoutsByResource])
  const weekFree = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of props.resources) {
      m.set(r.id, freeHoursOf(props.columns.map((c) => loads.get(`${r.id}|${c.isoDate}`)!).filter(Boolean)))
    }
    return m
  }, [props.resources, props.columns, loads])
  // "Sun–Thu" for the corner, from the first office shown.
  const workingWords = useMemo(() => {
    const wd = props.resources.find((r) => r.office)?.office?.workingDays ?? [7, 1, 2, 3, 4]
    const days = wd.map((d) => d % 7).sort((a, b) => a - b)
    const name = (d: number) => new Date(Date.UTC(2026, 8, 27 + d)).toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' })
    return `${name(days[0] ?? 0)}–${name(days[days.length - 1] ?? 4)}`
  }, [props.resources, locale])

  return (
    <div
      className="daygrid"
      style={{
        gridTemplateColumns: `minmax(170px, 200px) ${props.columns
          .map((_, i) => (colCollapsed[i] ? '46px' : 'minmax(84px, 1fr)'))
          .join(' ')}`,
      }}
      data-testid="schedule-grid"
    >
      {/* header row */}
      <div className="dg-corner" data-testid="dg-corner">
        {t('schedule.sc.corner', { days: workingWords, hours: STANDARD_DAY_HOURS })}
      </div>
      {props.columns.map((col, i) => (
        <div
          key={col.isoDate}
          className={`dg-head${col.isoDate === today ? ' today' : ''}${colCollapsed[i] ? ' collapsed' : ''}${col.isoDate === props.dueIso ? ' is-due' : ''}`}
        >
          {col.isoDate === props.dueIso && <span className="dg-due" data-testid={`due-${col.isoDate}`}>{t('schedule.sc.due')}</span>}
          <span className="dg-weekday">
            {new Date(col.epoch).toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' })}
          </span>
          <span className="dg-date">
            {/* I67.7: the shared compact form ("27 Sep", never "Sept" — ADR-0127), not a local Intl format. */}
            {colCollapsed[i]
              ? new Date(col.epoch).toLocaleDateString(locale, { day: 'numeric', timeZone: 'UTC' })
              : col.isoDate === today
                ? t('schedule.sc.todayDate', { date: new Date(col.epoch).toLocaleDateString(locale, { day: 'numeric', timeZone: 'UTC' }) })
                : new Date(col.epoch).getUTCDate() === 1
                  ? formatPlanDay(col.isoDate, i18n.language, false)
                  : new Date(col.epoch).toLocaleDateString(locale, { day: 'numeric', timeZone: 'UTC' })}
          </span>
        </div>
      ))}

      {/* resource rows, grouped by department */}
      {groups.map((group) => (
        <div key={group.key} style={{ display: 'contents' }}>
          {groups.length > 1 && <div className="dg-group-head" data-testid={`dept-group-${group.key}`}>{group.label}</div>}
          {group.resources.map((r) => {
        const rBookings = byResource.get(r.id) ?? []
        const rBlackouts = blackoutsByResource.get(r.id) ?? []
        const rRequests = requestsByResource.get(r.id) ?? []
        // ADR-0087 d.2/d.12: a person outside the viewer's reach is still offered — the server
        // turns the assignment into a request. Only the direct check gates a chip's OWN drag
        // (`draggable`): you move what you can write, and the target row decides what the drop is.
        const canRequest = canRequestResource(r)
        const canAdd = canWriteResource('create', r) || canRequest
        const canMoveHere = canWriteResource('update', r)
        return (
          <div key={r.id} style={{ display: 'contents' }} data-testid={`row-${r.id}`}>
            <div className="dg-sidebar">
              <Avatar id={r.id} name={r.name} size={30} />
              <span className="dg-who">
                <span className="rname">
                  {r.name}
                  {props.meUserId && r.userId === props.meUserId && <span className="rme"> {t('schedule.sc.you')}</span>}
                </span>
                <span className="rdept">{r.jobTitle ?? [r.teamName ?? r.departmentName, r.office?.name].filter(Boolean).join(' · ')}</span>
                {r.kind === 'human' && (() => {
                  const free = weekFree.get(r.id) ?? 0
                  const low = free < (STANDARD_DAY_HOURS * 5) / 2
                  return <span className={`rfree${low ? ' is-low' : ''}`} data-testid={`free-${r.id}`}>{t(props.columns.length === 7 ? 'schedule.sc.freeThisWeek' : 'schedule.sc.freeShown', { n: free })}</span>
                })()}
              </span>
            </div>
            {props.columns.map((col, ci) => {
              const cellKey = `${r.id}|${col.isoDate}`
              // ADR-0079 d.3: a closure shades exactly as a weekend does, because it is the same test.
              const nonWorking = r.office
                ? !isWorkingDay(localDayOf(col.epoch + 43_200_000, r.office.timezone), r.office)
                : false
              const hasBlackout = blackoutFor(rBlackouts, col)
              const cellBookings = bookingsFor(rBookings, col)
              const rowWorking = (dayStart: number) => (r.office ? isWorkingDay(localDayOf(dayStart + 43_200_000, r.office.timezone), r.office) : true)
              const internal = internalFor(rBlackouts, col, rowWorking)
              const cellRequests = requestsFor(rRequests, col)
              return (
                <div
                  key={col.isoDate}
                  className={[
                    'dg-cell',
                    nonWorking ? 'nonworking' : '',
                    hasBlackout ? 'hasblackout' : '',
                    colCollapsed[ci] ? 'collapsed' : '',
                    dragOver === cellKey ? 'dragover' : '',
                    col.isoDate === today ? 'is-today' : '',
                    props.picking ? 'is-picking' : '',
                  ].filter(Boolean).join(' ')}
                  data-testid={`cell-${r.id}-${col.isoDate}`}
                  onClick={(e) => {
                    if (!props.picking || !props.onCellPick) return
                    if ((e.target as HTMLElement).closest('.chip-wrap')) return
                    props.onCellPick(r.id, col.isoDate)
                  }}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(cellKey) }}
                  onDragLeave={() => setDragOver((cur) => (cur === cellKey ? null : cur))}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragOver(null)
                    const pieceId = e.dataTransfer.getData('text/piece-id')
                    if (pieceId && props.onPieceDrop) return props.onPieceDrop(pieceId, r.id, col.isoDate)
                    const id = e.dataTransfer.getData('text/booking-id')
                    const booking = props.bookings.find((b) => b.id === id)
                    if (!booking) return
                    // A TASK chip dropped on a person the viewer cannot book becomes a request
                    // (d.12); a plain reservation has no task to request and is refused as before.
                    if (!canMoveHere && !(booking.subTaskId && canRequest)) return props.onBlocked(r, 'update')
                    // I59.13: where the moved work ENDS. A drag onto another person moves the whole task
                    // (its span kept, `useReassignTaskToResource`); a drag along the row moves this one day.
                    const commitment = booking.subTaskId ? props.commitments?.get(booking.subTaskId) : undefined
                    const landsOn = commitment && r.id !== booking.resourceId
                      ? landsOnDay(col.isoDate, taskSpanDays(commitment.startsAt, commitment.dueAt))
                      : col.isoDate
                    const check = assessDrop({
                      targetResource: r,
                      cellBookings: [...cellBookings, ...internalLoad(internal.hours, cellKey)],
                      moving: booking,
                      nonWorking,
                      blackout: !!hasBlackout,
                      commitment: commitment ? { committedDueAt: commitment.committedDueAt, landsOn } : null,
                    })
                    if (hasFindings(check)) setPendingDrop({ booking, resource: r, isoDate: col.isoDate, check })
                    else props.onChipMove(booking, r.id, col.isoDate)
                  }}
                >
                  {(() => {
                    // I74.24: the day in words — "8h free", "Full", "4h over", "On leave". When over, it IS
                    // the overload mark (same test id, same level), so the cell says it once, in hours.
                    const load = loads.get(cellKey)
                    if (!load || colCollapsed[ci]) return null
                    const overload = load.overload
                    if (r.kind !== 'human' && !overload) return null
                    const words = load.state === 'over' && load.overHours === 0 && overload?.count != null
                      ? t('schedule.overloadCount', { count: overload.count })
                      : t(STATE_KEY[load.state], { n: load.state === 'over' ? load.overHours : load.freeHours })
                    return (
                      <span
                        className={`dg-state is-${load.state}${overload ? ` cell-overload cell-overload-${overload.level}` : ''}`}
                        data-testid={overload ? `overload-${r.id}-${col.isoDate}` : `state-${r.id}-${col.isoDate}`}
                        title={overload?.pct != null ? t('schedule.overloadPct', { pct: Math.round(overload.pct) }) : undefined}
                      >
                        {words}
                      </span>
                    )
                  })()}
                  {cellBookings.map((b) => {
                    const { isAdhoc, label, title } = chipKind(b)
                    return (
                      <span
                        key={b.id}
                        className="chip-wrap"
                        style={{ inlineSize: `${chipWidthPct(b.loadPct, r.capacityModel)}%` }}
                      >
                        <button
                          type="button"
                          className={`chip chip-${b.state} ${isAdhoc ? 'chip-adhoc' : 'chip-project'}`}
                          data-testid={`booking-${b.id}`}
                          draggable={canMoveHere}
                          onDragStart={(e) => e.dataTransfer.setData('text/booking-id', b.id)}
                          onClick={() => props.onChipClick(b)}
                        >
                          <span className="chip-hours">
                            {b.loadPct != null ? `${loadPctToHours(b.loadPct)}h` : ''}
                          </span>
                          <span className="chip-label">{label}</span>
                          {/* I54.15: high and medium only. The grid is the densest surface in the
                              system and "normal" is the common case — a mark on every chip would
                              say nothing while costing the width the label needs. */}
                          {b.priority && b.priority !== 'low' && (
                            <PriorityMark priority={b.priority} testId={`booking-priority-${b.id}`} />
                          )}
                        </button>
                        <span className="chip-tip" role="tooltip">
                          <strong>{title}</strong>
                          {b.campaignName && <span>{t('schedule.project')}: {b.campaignName}</span>}
                          {isAdhoc && <span>{t('schedule.adhocTask')}</span>}
                          {b.loadPct != null && <span>{t('schedule.hoursPerDay')}: {loadPctToHours(b.loadPct)}h</span>}
                          {/* The tooltip names it in words for all three, including normal — the
                              chip shows a mark only where it changes what you do. */}
                          {b.priority && <span>{t('intake.who.priority')}: {t(`intake.who.priorities.${b.priority}`)}</span>}
                          {/* I67.8 (Edward, 30 Sep, B): where the task stands, then its deliverable's breakdown. */}
                          {b.taskStatus && (
                            <span className="chip-tip-status" data-testid={`booking-status-${b.id}`}>
                              {t('schedule.taskStatus', {
                                status: b.taskRevision >= 1 && (b.taskStatus === 'todo' || b.taskStatus === 'in_progress')
                                  ? t('teamView.piece.state.changes')
                                  : t(`deliverables.subStatus.${b.taskStatus}`),
                              })}
                            </span>
                          )}
                          {b.pieceProgress && <ProgressLines progress={b.pieceProgress} className="chip-tip-line" />}
                          <span>{t(`schedule.state.${b.state}`)}</span>
                          {!isAdhoc && b.notes && <span>{b.notes}</span>}
                        </span>
                      </span>
                    )
                  })}
                  {internal.hours > 0 && !colCollapsed[ci] && (
                    <span className="chip-wrap" data-testid={`internal-${r.id}-${col.isoDate}`}>
                      <span className="chip chip-internal" title={internal.what.map((w) => w.reason).filter(Boolean).join(' · ') || undefined}>
                        <span className="chip-hours">{`${Math.round(internal.hours * 10) / 10}h`}</span>
                        <span className="chip-label">{internal.what.map((w) => w.reason).filter(Boolean)[0] ?? t('schedule.block.internalChip')}</span>
                      </span>
                    </span>
                  )}
                  {cellRequests.map((q) => {
                    const perDay = requestHoursPerDay(q)
                    return (
                      <span key={q.id} className="chip-wrap chip-wrap-requested">
                        <button
                          type="button"
                          className="chip chip-requested chip-project"
                          data-testid={`request-${q.id}`}
                          onClick={() => props.onRequestClick?.(q)}
                          aria-label={t('schedule.request.chipLabel', { task: q.taskTitle ?? q.title })}
                        >
                          <span className="chip-hours">{perDay != null ? `${perDay}h` : ''}</span>
                          <span className="chip-label">
                            {[q.taskTitle ?? q.title, q.campaignName].filter(Boolean).join(' · ')}
                          </span>
                        </button>
                        <span className="chip-tip" role="tooltip">
                          <strong>{q.taskTitle ?? q.title}</strong>
                          {q.campaignName && <span>{t('schedule.project')}: {q.campaignName}</span>}
                          <span>{t('schedule.request.awaiting', { department: q.departmentName ?? '' })}</span>
                          <span>{t('schedule.request.askedBy', { name: q.requesterName ?? '' })}</span>
                        </span>
                      </span>
                    )
                  })}
                  <button
                    type="button"
                    className="cell-add"
                    aria-label={t('schedule.newBooking')}
                    data-testid={`add-${r.id}-${col.isoDate}`}
                    onClick={(e) => {
                      if (props.picking && props.onCellPick) { e.stopPropagation(); return props.onCellPick(r.id, col.isoDate) }
                      return canAdd ? props.onAdd(r.id, col.isoDate) : props.onBlocked(r, 'create')
                    }}
                  >
                    +
                  </button>
                  {(() => {
                    const load = loads.get(cellKey)
                    if (!load || colCollapsed[ci] || r.kind !== 'human' || load.state === 'off' || load.state === 'leave') return null
                    const pct = Math.min(100, (load.bookedHours / STANDARD_DAY_HOURS) * 100)
                    return <span className="dg-bar" aria-hidden="true"><span className={`dg-bar-fill is-${load.state}`} style={{ inlineSize: `${pct}%` }} /></span>
                  })()}
                </div>
              )
            })}
          </div>
        )
          })}
        </div>
      ))}

      {/* ADR-0139 d.6 (SC-18): "Other teams — Asks you sent". Only while one sits in the days shown. */}
      {(() => {
        const open = (props.asksSent ?? []).filter((a) => a.status === 'pending' || a.status === 'offered')
        const days = new Set(props.columns.map((c) => c.isoDate))
        if (!open.some((a) => askDays(a).some((d) => days.has(d)))) return null
        return (
          <div style={{ display: 'contents' }} data-testid="row-other-teams">
            <div className="dg-sidebar dg-sidebar-asks">
              <span className="dg-who">
                <span className="rname">{t('schedule.asks.row.title')}</span>
                <span className="rdept">{t('schedule.asks.row.sub')}</span>
              </span>
            </div>
            {props.columns.map((col, ci) => (
              <div key={col.isoDate} className={`dg-cell dg-cell-asks${colCollapsed[ci] ? ' collapsed' : ''}${col.isoDate === today ? ' is-today' : ''}`}>
                {!colCollapsed[ci] && open.filter((a) => askDays(a).includes(col.isoDate)).map((a) => {
                  const h = askHoursPerDay(a)
                  return (
                    <button key={a.id} type="button" className="chip chip-ask-pending" onClick={() => props.onAskClick?.(a)}
                      data-testid={`ask-chip-${a.id}`} aria-label={t('schedule.asks.row.chipLabel', { task: a.taskTitle, team: a.teamName ?? '' })}>
                      <span className="chip-ask-line"><span aria-hidden="true">⏳</span> {h != null ? `${h}h ` : ''}{a.taskTitle}</span>
                      <span className="chip-ask-sub">
                        {a.status === 'offered'
                          ? t('schedule.asks.row.offered', { team: a.teamName ?? '' })
                          : t('schedule.asks.row.waiting', { team: a.teamName ?? '' })}
                      </span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        )
      })()}

      {/* I41.5, restyled by I59.13 into the L6 / L7 dialog both screens share. It itemises what is
          wrong rather than asking "are you sure?" — a dialog that says nothing specific gets
          dismissed unread (ADR-0068 d.2) — and offers the way round it as well as the way through. */}
      {pendingDrop && (() => {
        const { booking, resource, isoDate, check } = pendingDrop
        const cands = roomCandidates(props.resources, props.bookings, weekStartOf(isoDate))
        const commitment = booking.subTaskId ? props.commitments?.get(booking.subTaskId) : undefined
        const tz = props.resources.find((x) => x.id === booking.resourceId)?.office?.timezone ?? 'UTC'
        const keepDateIso = booking.subTaskId
          ? (commitment?.startsAt ? localDayOf(Date.parse(commitment.startsAt), tz).isoDate : localDayOf(booking.start, tz).isoDate)
          : null
        const move = (resourceId: string, iso: string) => {
          props.onChipMove(booking, resourceId, iso)
          setPendingDrop(null)
        }
        return (
          <MoveWarningDialog
            testId="drop-warning"
            taskLabel={commitment?.title ?? booking.taskName ?? booking.bookingTitle ?? ''}
            targetName={resource.name}
            targetIsoDate={isoDate}
            check={check}
            targetWeekPct={cands.find((c) => c.resourceId === resource.id)?.pct ?? null}
            room={withRoom(cands, resource.id)}
            keepDateIso={keepDateIso}
            // ADR-0141 d.2: the change form only when the work would end after the PIECE's due date.
            canAskExtension={!!booking.subTaskId && !!props.onAskExtension && pastPieceDue(check.pastCommitment?.landsOn, commitment?.deliverableDueAt)}
            onProceed={() => move(resource.id, isoDate)}
            onInstead={(id) => move(id, isoDate)}
            onKeepDate={(id) => move(id, keepDateIso ?? isoDate)}
            onAskExtension={() => {
              props.onAskExtension?.(booking, check.pastCommitment?.landsOn ?? isoDate)
              setPendingDrop(null)
            }}
            onCancel={() => setPendingDrop(null)}
          />
        )
      })()}
    </div>
  )
}
