import { describe, expect, it } from 'vitest'
import { classifyExtension, workingDaysBetween } from './extension-arithmetic'

// 2026-09-25 is a Friday. Iraq works Sunday–Thursday. 18:00 Iraq is 15:00Z.
const DUE_THU_24 = '2026-09-24T15:00:00Z'
const GO_LIVE_MON_28 = '2026-09-28T15:00:00Z'

describe('workingDaysBetween', () => {
  it('counts the days after the first up to and including the last, working days only', () => {
    // Mon 14 → Thu 17: Tue, Wed, Thu
    expect(workingDaysBetween('2026-09-14', '2026-09-17')).toBe(3)
  })
  it('steps over the Iraq weekend (Fri, Sat)', () => {
    // Thu 17 → Sun 20: Fri and Sat are off, Sun counts
    expect(workingDaysBetween('2026-09-17', '2026-09-20')).toBe(1)
  })
  it('is zero when the second day is not after the first', () => {
    expect(workingDaysBetween('2026-09-17', '2026-09-17')).toBe(0)
    expect(workingDaysBetween('2026-09-18', '2026-09-17')).toBe(0)
  })
  it('honours the office working week it is given', () => {
    // Mon–Fri office: Thu 17 → Sun 20 is Fri only
    expect(workingDaysBetween('2026-09-17', '2026-09-20', [1, 2, 3, 4, 5])).toBe(1)
  })
})

describe('classifyExtension', () => {
  it('is fine when the review buffer fits with days to spare', () => {
    // Mon 21 → due Thu 24: Tue, Wed, Thu = 3 working days, buffer 1 → slack 2
    const r = classifyExtension({ requestedDay: '2026-09-21', deliverableDueAt: DUE_THU_24, goLiveAt: GO_LIVE_MON_28 })
    expect(r).toEqual({ severity: 'fine', workingDaysLeft: 3, bufferDays: 1, slackDays: 2 })
  })
  it('is tight when the days left are exactly the buffer', () => {
    // Wed 23 → Thu 24: 1 working day, buffer 1 → slack 0
    const r = classifyExtension({ requestedDay: '2026-09-23', deliverableDueAt: DUE_THU_24, goLiveAt: GO_LIVE_MON_28 })
    expect(r.severity).toBe('tight')
    expect(r.slackDays).toBe(0)
  })
  it('is at risk when the review cannot fit — including a request ON the due day', () => {
    const r = classifyExtension({ requestedDay: '2026-09-24', deliverableDueAt: DUE_THU_24, goLiveAt: GO_LIVE_MON_28 })
    expect(r.severity).toBe('at_risk')
    expect(r.workingDaysLeft).toBe(0)
    expect(r.slackDays).toBe(-1)
  })
  it('counts a request past the due day as negative days, not zero', () => {
    // Sun 27 is two working days after Thu 24 (Sun is the only working day between; Fri/Sat off)
    const r = classifyExtension({ requestedDay: '2026-09-27', deliverableDueAt: DUE_THU_24, goLiveAt: GO_LIVE_MON_28 })
    expect(r.severity).toBe('at_risk')
    expect(r.workingDaysLeft).toBe(-1)
  })
  it('refuses only a date after go-live', () => {
    const on = classifyExtension({ requestedDay: '2026-09-28', deliverableDueAt: DUE_THU_24, goLiveAt: GO_LIVE_MON_28 })
    expect(on.severity).toBe('at_risk') // on the go-live day itself is allowed, however bad
    const after = classifyExtension({ requestedDay: '2026-09-29', deliverableDueAt: DUE_THU_24, goLiveAt: GO_LIVE_MON_28 })
    expect(after.severity).toBe('after_go_live')
    expect(after.workingDaysLeft).toBeNull()
  })
  it('reads the go-live day in Iraq, not UTC', () => {
    // 21:30Z on the 28th is already the 29th in Baghdad — so the 29th is ON go-live, not after.
    const r = classifyExtension({ requestedDay: '2026-09-29', deliverableDueAt: null, goLiveAt: '2026-09-28T21:30:00Z' })
    expect(r.severity).toBe('fine')
  })
  it('has nothing to measure against without a deliverable deadline, and says so', () => {
    const r = classifyExtension({ requestedDay: '2026-09-21', deliverableDueAt: null, goLiveAt: null })
    expect(r).toEqual({ severity: 'fine', workingDaysLeft: null, bufferDays: 1, slackDays: null })
  })
  it('measures against the department buffer it is given', () => {
    // 3 days left, buffer 3 → tight; buffer 4 → at risk
    expect(classifyExtension({ requestedDay: '2026-09-21', deliverableDueAt: DUE_THU_24, goLiveAt: null, reviewBufferWorkingDays: 3 }).severity).toBe('tight')
    expect(classifyExtension({ requestedDay: '2026-09-21', deliverableDueAt: DUE_THU_24, goLiveAt: null, reviewBufferWorkingDays: 4 }).severity).toBe('at_risk')
  })
})
