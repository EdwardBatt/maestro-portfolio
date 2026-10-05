import type { DeliverableRow } from '../../deliverables/api/deliverables-api'
import { isOverdue } from '../../../lib/campaigns/status'
import { iraqDay } from '../../../lib/time/iraq'
import { IRAQ_WORKING_CALENDAR, minusDays, workingDaysBetween, type WorkingCalendar } from '../../../lib/campaigns/go-live-dates'
import { boardColumnOf, type BoardColumn } from './board-columns'

/**
 * The Timeline's geometry (Figma CG-06, I57.9): which days the window shows, which of them are
 * days off, and which columns each piece's bar spans.
 *
 * *"Bars are the working days a piece has. Friday and Saturday are shaded and never counted. A bar
 * past its due date turns red; a hollow one has nobody on it yet."* One bar per PIECE — from its
 * earliest task start (today when no task has one) to its due date — never one per task (Edward,
 * 24 Sep: the drawer shows the breakdown by task).
 *
 * Days are Iraq days as `YYYY-MM-DD` and are stepped with `minusDays` (UTC components), never with
 * local `Date` arithmetic, which shifts across a DST boundary. A working day is whatever
 * `workingDaysBetween` counts, so there is no second definition of one here.
 */

/** The window: 14 days, opening 3 days before today; Previous/Next move it a week. */
export const WINDOW_DAYS = 14
export const WINDOW_LEAD = 3

export interface TimelineDay {
  day: string
  working: boolean
  today: boolean
}

export const addDays = (day: string, n: number): string => minusDays(day, -n)

/** True when the calendar works `day` — counted by the one working-day rule. */
export function isWorkingDate(day: string, calendar: WorkingCalendar = IRAQ_WORKING_CALENDAR): boolean {
  return workingDaysBetween(minusDays(day, 1), day, calendar) === 1
}

/** The window's days, `offsetWeeks` weeks from the one that opens 3 days before today. */
export function timelineWindow(todayDay: string, offsetWeeks = 0, calendar: WorkingCalendar = IRAQ_WORKING_CALENDAR): TimelineDay[] {
  const first = addDays(todayDay, -WINDOW_LEAD + 7 * offsetWeeks)
  return Array.from({ length: WINDOW_DAYS }, (_, i) => {
    const day = addDays(first, i)
    return { day, working: isWorkingDate(day, calendar), today: day === todayDay }
  })
}

/** The bar's colour: the Board's column, except that anything past its date is red. */
export type BarTone = 'delivered' | 'approved' | 'inProgress' | 'inReview' | 'notStarted' | 'waiting' | 'late'

export type BarLabel =
  | { key: 'late'; count: number }
  | { key: 'waiting' | 'nobodyYet' | 'dueToday' | 'dueTomorrow' }

export interface TimelineBar {
  id: string
  /** Null when the piece has no due date: it is listed with no bar. */
  dueDay: string | null
  startDay: string
  endDay: string
  /** Working days between start and end, both counted — days off never are. */
  workingDays: number
  column: BoardColumn | null
  tone: BarTone
  /** Nobody holds any live task on it (all unassigned, or none). */
  hollow: boolean
  label: BarLabel | null
  /** Column indices in the window (inclusive), or null when the bar lies wholly outside it. */
  span: { from: number; to: number; clippedStart: boolean; clippedEnd: boolean } | null
  /** Where the bar is when it is not in the window. */
  outside: 'before' | 'after' | null
}

type Piece = Pick<DeliverableRow, 'id' | 'state' | 'dueAt' | 'progress' | 'taskList'>

/** The day work on the piece starts: its earliest live task start, else today. */
export function startDayOf(piece: Piece, todayDay: string): string {
  const starts = (piece.taskList ?? [])
    .filter((t) => t.status !== 'cancelled' && t.startsAt)
    .map((t) => iraqDay(t.startsAt!))
    .sort()
  return starts[0] ?? todayDay
}

function labelOf(tone: BarTone, hollow: boolean, dueDay: string, todayDay: string, calendar: WorkingCalendar): BarLabel | null {
  if (tone === 'late') return { key: 'late', count: Math.max(1, workingDaysBetween(dueDay, todayDay, calendar)) }
  if (tone === 'waiting') return { key: 'waiting' }
  if (tone === 'delivered' || tone === 'approved' || tone === 'inReview') return null
  if (hollow) return { key: 'nobodyYet' }
  if (dueDay === todayDay) return { key: 'dueToday' }
  if (dueDay === addDays(todayDay, 1)) return { key: 'dueTomorrow' }
  return null
}

export function timelineBar(
  piece: Piece,
  outstandingInputs: number,
  window: readonly TimelineDay[],
  now: number,
  calendar: WorkingCalendar = IRAQ_WORKING_CALENDAR,
): TimelineBar {
  const todayDay = iraqDay(now)
  const column = boardColumnOf(piece, outstandingInputs)
  const late = isOverdue(piece, now)
  const tone: BarTone =
    late ? 'late'
    : column === 'delivered' ? 'delivered'
    : column === 'approved' ? 'approved'
    : column === 'inProgress' ? 'inProgress'
    : column === 'inReview' ? 'inReview'
    : column === 'waiting' ? 'waiting'
    : 'notStarted'
  const unfinished = column !== 'delivered' && column !== 'approved' && column !== 'inReview'
  const hollow = unfinished && (piece.progress.total === 0 || piece.progress.unassigned >= piece.progress.total)
  const dueDay = piece.dueAt ? iraqDay(piece.dueAt) : null
  if (!dueDay) {
    return { id: piece.id, dueDay: null, startDay: todayDay, endDay: todayDay, workingDays: 0, column, tone, hollow, label: null, span: null, outside: null }
  }
  // A late bar runs on to today: the days it has overrun are part of what it is.
  const endDay = late && todayDay > dueDay ? todayDay : dueDay
  // A late bar covers the days it has overrun, due date to today (I57.26: starting it today made it
  // one day wide, and its "5 days late" label was cut to "5 days l…").
  const rawStart = late && dueDay < startDayOf(piece, todayDay) ? dueDay : startDayOf(piece, todayDay)
  const startDay = rawStart > endDay ? endDay : rawStart
  const workingDays = workingDaysBetween(minusDays(startDay, 1), endDay, calendar)
  const label = labelOf(tone, hollow, dueDay, todayDay, calendar)

  const first = window[0]?.day
  const last = window[window.length - 1]?.day
  let span: TimelineBar['span'] = null
  let outside: TimelineBar['outside'] = null
  if (!first || !last) outside = null
  else if (endDay < first) outside = 'before'
  else if (startDay > last) outside = 'after'
  else {
    const from = startDay < first ? 0 : window.findIndex((d) => d.day === startDay)
    const to = endDay > last ? window.length - 1 : window.findIndex((d) => d.day === endDay)
    span = { from, to, clippedStart: startDay < first, clippedEnd: endDay > last }
  }
  return { id: piece.id, dueDay, startDay, endDay, workingDays, column, tone, hollow, label, span, outside }
}
