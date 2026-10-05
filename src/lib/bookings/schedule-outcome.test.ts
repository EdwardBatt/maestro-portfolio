import { describe, expect, it } from 'vitest'
import { scheduleWarningKey, translateScheduleWarning, wasScheduled } from './schedule-outcome'

/**
 * ADR-0061 d.1 — reading the answer.
 *
 * `subtask-schedule` returns 200 with `scheduled: 0` and a reason when it places nothing. Every
 * caller checked only whether the call threw, so the body was discarded and the dialog said
 * "booked". A person booked a Sunday in an office that did not work Sundays, saw an empty calendar,
 * and pressed again — five duplicate tasks on 27 Aug.
 *
 * The hard part is not "warn on zero". It is that **zero is often correct**, and a warning shown
 * every time a workflow lays down twenty unassigned tasks is a warning people learn to click past.
 * So the two ordinary reasons stay silent and everything else is named — including a reason this
 * file has never heard of, which is the case that decides whether the next silent failure happens.
 */

describe('scheduleWarningKey', () => {
  it('says nothing when the work was actually placed', () => {
    expect(scheduleWarningKey({ scheduled: 3 })).toBeNull()
    expect(scheduleWarningKey({ scheduled: 1, reason: 'whatever' })).toBeNull()
  })

  // Somebody arranged this schedule by hand. Telling them about it on every later save is nagging
  // about a decision they made on purpose.
  it('stays quiet for a hand-overridden schedule', () => {
    expect(scheduleWarningKey({ scheduled: 0, skipped: 'overridden' })).toBeNull()
    expect(scheduleWarningKey({ scheduled: 0, reason: 'overridden' })).toBeNull()
  })

  // The ordinary state of every task the moment a workflow creates it: no assignee yet.
  it('stays quiet for a task that is not schedulable yet', () => {
    expect(scheduleWarningKey({ scheduled: 0, reason: 'not_schedulable' })).toBeNull()
  })

  it('names the faults', () => {
    expect(scheduleWarningKey({ scheduled: 0, reason: 'assignee_no_active_resource' }))
      .toBe('schedule.unscheduled.assignee_no_active_resource')
    expect(scheduleWarningKey({ scheduled: 0, reason: 'assignee_no_office' }))
      .toBe('schedule.unscheduled.assignee_no_office')
    expect(scheduleWarningKey({ scheduled: 0, reason: 'nothing_to_place' }))
      .toBe('schedule.unscheduled.nothing_to_place')
  })

  // THE assertion. A reason added to the Edge Function later must not inherit the silence this
  // whole file exists to remove — an allowlist of what to WARN about would do exactly that.
  it('names a reason it has never heard of', () => {
    expect(scheduleWarningKey({ scheduled: 0, reason: 'some_future_case' }))
      .toBe('schedule.unscheduled.some_future_case')
  })

  it('names a zero with no reason at all', () => {
    expect(scheduleWarningKey({ scheduled: 0 })).toBe('schedule.unscheduled.unknown')
    expect(scheduleWarningKey({})).toBe('schedule.unscheduled.unknown')
  })

  it('says nothing when there is no response to read', () => {
    expect(scheduleWarningKey(null)).toBeNull()
    expect(scheduleWarningKey(undefined)).toBeNull()
  })
})

describe('wasScheduled', () => {
  it('is true only when something was placed', () => {
    expect(wasScheduled({ scheduled: 1 })).toBe(true)
    expect(wasScheduled({ scheduled: 0 })).toBe(false)
    expect(wasScheduled(null)).toBe(false)
  })
})

describe('translateScheduleWarning', () => {
  const t = (k: string) => `translated:${k}`

  it('translates a key', () => {
    expect(translateScheduleWarning(t, 'schedule.unscheduled.assignee_no_office'))
      .toBe('translated:schedule.unscheduled.assignee_no_office')
  })

  // A thrown error's message lands in the same field and must be shown as it is — running it
  // through `t` would render the raw text of a server error as a missing translation key.
  it('passes a raw error message through untouched', () => {
    expect(translateScheduleWarning(t, 'Out of your booking scope'))
      .toBe('Out of your booking scope')
  })

  it('returns null for nothing', () => {
    expect(translateScheduleWarning(t, null)).toBeNull()
    expect(translateScheduleWarning(t, '')).toBeNull()
  })
})
