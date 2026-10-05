import { describe, expect, it } from 'vitest'
import type { CampaignTask } from '../../deliverables/api/deliverables-api'
import type { WorkPhase } from '../../../lib/deliverables/work-phase'
import type { DeliverableState } from '../../../lib/deliverables/state-machine'
import { endOfWorkingDay } from '../../../lib/time/iraq'
import { addDays, isWorkingDate, startDayOf, timelineBar, timelineWindow } from './timeline-bars'

// Thursday 24 Sep 2026, 10:00 in Baghdad. The window opens Monday 21 Sep and runs 14 days.
const NOW = Date.parse('2026-09-24T07:00:00Z')
const TODAY = '2026-09-24'
const WINDOW = timelineWindow(TODAY)

const task = (over: Partial<CampaignTask>): CampaignTask => ({
  id: 't', title: 'Artwork', hours: 4, status: 'todo', assigneeName: 'Zubaida', startsAt: null, dueAt: null, ...over,
})
const piece = (over: {
  state?: DeliverableState; phase?: WorkPhase; total?: number; unassigned?: number; due?: string | null; tasks?: CampaignTask[]
} = {}) => ({
  id: 'p',
  state: over.state ?? 'in_progress',
  dueAt: over.due === undefined ? endOfWorkingDay('2026-09-29').toISOString() : over.due ? endOfWorkingDay(over.due).toISOString() : null,
  progress: { phase: over.phase ?? 'in_progress', total: over.total ?? 2, unassigned: over.unassigned ?? 0, done: 0, everTotal: over.total ?? 2, inReview: 0, inProgress: 0, notStarted: 0 },
  taskList: over.tasks ?? [],
})

describe('the window — CG-06, Iraq days, days off shaded (I57.9)', () => {
  it('opens three days before today and runs fourteen days; a week either way on Previous / Next', () => {
    expect(WINDOW).toHaveLength(14)
    expect(WINDOW[0].day).toBe('2026-09-21')
    expect(WINDOW[13].day).toBe('2026-10-04')
    expect(WINDOW.find((d) => d.today)?.day).toBe(TODAY)
    expect(timelineWindow(TODAY, 1)[0].day).toBe('2026-09-28')
    expect(timelineWindow(TODAY, -1)[0].day).toBe('2026-09-14')
  })

  it('marks Friday and Saturday off in Iraq, and follows a calendar it is given', () => {
    expect(WINDOW.filter((d) => !d.working).map((d) => d.day)).toEqual(['2026-09-25', '2026-09-26', '2026-10-02', '2026-10-03'])
    const westernWeek = { workingDays: [1, 2, 3, 4, 5] }
    expect(timelineWindow(TODAY, 0, westernWeek).filter((d) => !d.working).map((d) => d.day)).toEqual(['2026-09-26', '2026-09-27', '2026-10-03', '2026-10-04'])
    expect(isWorkingDate('2026-09-27', { workingDays: [7, 1, 2, 3, 4], closures: ['2026-09-27'] })).toBe(false)
  })

  it('steps days on the calendar, not the clock — across the end of European summer time too', () => {
    expect(addDays('2026-10-24', 3)).toBe('2026-10-27')
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('timelineBar — one bar per piece, start to due', () => {
  it('runs from the earliest live task start to the due day, counting working days only', () => {
    const b = timelineBar(piece({ tasks: [
      task({ startsAt: '2026-09-23T06:00:00Z' }),
      task({ startsAt: '2026-09-22T05:00:00Z' }),
      task({ status: 'cancelled', startsAt: '2026-09-10T05:00:00Z' }),
    ] }), 0, WINDOW, NOW)
    expect(b.startDay).toBe('2026-09-22')
    expect(b.endDay).toBe('2026-09-29')
    // Tue 22 … Tue 29: 22, 23, 24, 27, 28, 29 — Friday and Saturday not counted.
    expect(b.workingDays).toBe(6)
    expect(b.span).toEqual({ from: 1, to: 8, clippedStart: false, clippedEnd: false })
    expect(b.tone).toBe('inProgress')
  })

  it('starts today when no task has a start, and reads a start in Iraq, not UTC', () => {
    expect(startDayOf(piece(), TODAY)).toBe(TODAY)
    // 22:30 UTC on the 22nd is 01:30 on the 23rd in Baghdad.
    expect(startDayOf(piece({ tasks: [task({ startsAt: '2026-09-22T22:30:00Z' })] }), TODAY)).toBe('2026-09-23')
  })

  it('clips to the window at both ends and says where a bar is when it is outside', () => {
    const long = timelineBar(piece({ due: '2026-10-20', tasks: [task({ startsAt: '2026-09-01T06:00:00Z' })] }), 0, WINDOW, NOW)
    expect(long.span).toEqual({ from: 0, to: 13, clippedStart: true, clippedEnd: true })
    const later = timelineBar(piece({ due: '2026-10-20', tasks: [task({ startsAt: '2026-10-11T06:00:00Z' })] }), 0, WINDOW, NOW)
    expect(later.span).toBeNull()
    expect(later.outside).toBe('after')
    const earlier = timelineBar(piece({ state: 'delivered', phase: 'delivered', due: '2026-09-10', tasks: [task({ startsAt: '2026-09-06T06:00:00Z' })] }), 0, WINDOW, NOW)
    expect(earlier.outside).toBe('before')
  })

  it('a piece with no due date has no bar', () => {
    const b = timelineBar(piece({ due: null }), 0, WINDOW, NOW)
    expect(b.dueDay).toBeNull()
    expect(b.span).toBeNull()
  })

  it('past its due date it is red, runs on to today, and says how many working days late', () => {
    // Due Sun 20 Sep; today Thu 24: 21, 22, 23, 24 → four working days late.
    const b = timelineBar(piece({ due: '2026-09-20', tasks: [task({ startsAt: '2026-09-17T06:00:00Z' })] }), 0, WINDOW, NOW)
    expect(b.tone).toBe('late')
    expect(b.endDay).toBe(TODAY)
    expect(b.label).toEqual({ key: 'late', count: 4 })
    expect(b.span).toEqual({ from: 0, to: 3, clippedStart: true, clippedEnd: false })
    // Due Thursday, looked at on the Saturday: late, and never "0 days".
    const sat = Date.parse('2026-09-26T07:00:00Z')
    expect(timelineBar(piece({ due: '2026-09-24' }), 0, timelineWindow('2026-09-26'), sat).label).toEqual({ key: 'late', count: 1 })
  })

  it('colours by the Board rule: delivered green, approved light green, in review amber, not started grey, waiting on an input', () => {
    expect(timelineBar(piece({ state: 'delivered', phase: 'delivered', due: '2026-09-20' }), 0, WINDOW, NOW).tone).toBe('delivered')
    expect(timelineBar(piece({ state: 'approved', phase: 'complete', due: '2026-09-20' }), 0, WINDOW, NOW).tone).toBe('approved')
    expect(timelineBar(piece({ phase: 'in_review' }), 0, WINDOW, NOW).tone).toBe('inReview')
    expect(timelineBar(piece({ state: 'draft', phase: 'not_started' }), 0, WINDOW, NOW).tone).toBe('notStarted')
    const w = timelineBar(piece(), 2, WINDOW, NOW)
    expect(w.tone).toBe('waiting')
    expect(w.label).toEqual({ key: 'waiting' })
  })

  it('is hollow when nobody holds a live task on it, and says "nobody yet"', () => {
    const none = timelineBar(piece({ state: 'draft', phase: 'not_started', total: 3, unassigned: 3 }), 0, WINDOW, NOW)
    expect(none.hollow).toBe(true)
    expect(none.label).toEqual({ key: 'nobodyYet' })
    expect(timelineBar(piece({ state: 'draft', phase: 'no_tasks', total: 0, unassigned: 0 }), 0, WINDOW, NOW).hollow).toBe(true)
    expect(timelineBar(piece({ state: 'draft', phase: 'not_started', total: 3, unassigned: 1 }), 0, WINDOW, NOW).hollow).toBe(false)
    // Finished work is never hollow: its tasks are done, not unheld.
    expect(timelineBar(piece({ phase: 'awaiting_signoff', total: 0 }), 0, WINDOW, NOW).hollow).toBe(false)
  })

  it('names a due date of today or tomorrow', () => {
    expect(timelineBar(piece({ due: '2026-09-24' }), 0, WINDOW, NOW).label).toEqual({ key: 'dueToday' })
    expect(timelineBar(piece({ due: '2026-09-25' }), 0, WINDOW, NOW).label).toEqual({ key: 'dueTomorrow' })
    expect(timelineBar(piece({ due: '2026-09-29' }), 0, WINDOW, NOW).label).toBeNull()
  })

  // I57.26: a late bar runs from its due date to today, so its label has room ("5 days late").
  it('a late bar starts at its due date, not today', () => {
    const b = timelineBar(piece({ phase: 'not_started', state: 'draft', due: '2026-09-20' }), 0, WINDOW, NOW)
    expect(b.tone).toBe('late')
    expect(b.startDay).toBe('2026-09-20')
  })
})
