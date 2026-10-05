import { describe, expect, it } from 'vitest'
import { canSend, formatMinutes, previousVersion, stepOf, timedMinutes, timerFigures, wouldBeUntimed } from './task-page'

describe('stepOf — where it is (M2)', () => {
  it('reads the task\'s own state, and Approved once the task or its piece is signed off', () => {
    expect(stepOf({ status: 'todo', deliverableState: 'in_progress' })).toBe('todo')
    expect(stepOf({ status: 'in_progress', deliverableState: 'in_progress' })).toBe('in_progress')
    expect(stepOf({ status: 'review', deliverableState: 'in_progress' })).toBe('review')
    expect(stepOf({ status: 'done', deliverableState: 'in_progress' })).toBe('done')
    expect(stepOf({ status: 'todo', deliverableState: 'approved' })).toBe('done')
    // "Delivered" is the piece's state; the task shows Approved (the plan's note on M2).
    expect(stepOf({ status: 'review', deliverableState: 'delivered' })).toBe('done')
    expect(stepOf({ status: 'todo', deliverableState: null })).toBe('todo')
  })
})

describe('canSend — the retired Submit dialog\'s rule, unchanged', () => {
  const base = { status: 'in_progress', hasDeliverable: true, isManual: false, hasVersionThisRound: false, hasOwnNoteThisRound: false }
  it('needs the round started', () => {
    expect(canSend({ ...base, status: 'todo', hasVersionThisRound: true })).toBe(false)
    expect(canSend({ ...base, status: 'review', hasVersionThisRound: true })).toBe(false)
  })
  it('sends a standalone task (no deliverable) at once', () => {
    expect(canSend({ ...base, hasDeliverable: false })).toBe(true)
  })
  it('needs THIS round\'s version on digital work, and the maker\'s own note on manual work', () => {
    expect(canSend(base)).toBe(false)
    expect(canSend({ ...base, hasVersionThisRound: true })).toBe(true)
    expect(canSend({ ...base, isManual: true, hasVersionThisRound: true })).toBe(false)
    expect(canSend({ ...base, isManual: true, hasOwnNoteThisRound: true })).toBe(true)
  })
})

describe('the timer line', () => {
  const now = Date.parse('2026-09-24T12:20:00Z')
  it('shows the recorded minutes once sent, and the time since Start while running', () => {
    expect(timedMinutes({ startedAt: '2026-09-24T09:00:00Z', submittedAt: '2026-09-24T11:00:00Z', minutes: 115 }, now)).toBe(115)
    expect(timedMinutes({ startedAt: '2026-09-24T09:00:00Z', submittedAt: null, minutes: null }, now)).toBe(200)
    expect(timedMinutes({ startedAt: null, submittedAt: null, minutes: null }, now)).toBeNull()
    expect(timedMinutes(null, now)).toBeNull()
  })
  it('formats minutes as hours and minutes', () => {
    expect(formatMinutes(200)).toBe('3h 20m')
    expect(formatMinutes(45)).toBe('45m')
    expect(formatMinutes(120)).toBe('2h')
    expect(formatMinutes(-5)).toBe('0m')
  })
})

describe('previousVersion — what came back (M4)', () => {
  it('is the newest version from an earlier round', () => {
    const vs = [{ id: 'a', round: 1, version: 1 }, { id: 'b', round: 1, version: 2 }, { id: 'c', round: 2, version: 3 }]
    expect(previousVersion(vs, 2)?.id).toBe('b')
    expect(previousVersion(vs, 3)?.id).toBe('c')
    expect(previousVersion(vs, 1)).toBeNull()
  })
})

describe('timerFigures — the header timer, less the blocked time (ADR-0107 d.3)', () => {
  it('while it runs: the time since Start less the blocked minutes, and the blocked minutes', () => {
    const f = timerFigures({ startedAt: '2026-09-24T06:12:00Z', submittedAt: null, minutes: null }, { elapsedMinutes: 440, blockedMinutesSoFar: 240 })
    expect(f).toEqual({ timed: 200, blocked: 240, untimed: false })
  })
  it('once sent: the recorded minutes (already less the block), the recorded blocked minutes, untimed as marked', () => {
    expect(timerFigures({ startedAt: 'x', submittedAt: 'y', minutes: 200, blockedMinutes: 60, untimed: false }, null)).toEqual({ timed: 200, blocked: 60, untimed: false })
    expect(timerFigures({ startedAt: 'x', submittedAt: 'y', minutes: 1920, blockedMinutes: null, untimed: true }, null)).toEqual({ timed: 1920, blocked: 0, untimed: true })
  })
  it('without the server figures, falls back to the time since Start', () => {
    const now = Date.parse('2026-09-24T07:12:00Z')
    expect(timerFigures({ startedAt: '2026-09-24T06:12:00Z', submittedAt: null, minutes: null }, null, now)).toEqual({ timed: 60, blocked: 0, untimed: false })
    expect(timerFigures(null, null, now)).toEqual({ timed: null, blocked: 0, untimed: false })
  })
})

describe('wouldBeUntimed — the warning before Send (ADR-0106 d.1)', () => {
  const now = Date.parse('2026-09-24T10:00:00Z')
  it('is untimed when never started, or started under the threshold ago', () => {
    expect(wouldBeUntimed({ startedAt: null, thresholdMinutes: 15 }, now)).toBe(true)
    expect(wouldBeUntimed({ startedAt: '2026-09-24T09:50:00Z', thresholdMinutes: 15 }, now)).toBe(true)
  })
  it('is timed from the threshold on — read against the clock now, not when it was fetched', () => {
    expect(wouldBeUntimed({ startedAt: '2026-09-24T09:45:00Z', thresholdMinutes: 15 }, now)).toBe(false)
    expect(wouldBeUntimed({ startedAt: '2026-09-24T08:00:00Z', thresholdMinutes: 15 }, now)).toBe(false)
  })
})
