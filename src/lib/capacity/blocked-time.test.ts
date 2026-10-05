import { describe, expect, it } from 'vitest'
import { blockDayStarts, blocksWholeDay, internalHoursOn, isFullBlock, type BlockedTime } from './blocked-time'

const D = (iso: string) => Date.parse(`${iso}T00:00:00Z`)
const leave: BlockedTime = { start: D('2026-09-29'), end: D('2026-09-29') + 86_399_000, kind: 'leave', hours: null }
const training: BlockedTime = { start: D('2026-09-29'), end: D('2026-09-29') + 86_399_000, kind: 'internal', hours: 3.5 }

describe('blocked time — leave blocks the day, internal work counts its hours (ADR-0142 d.4)', () => {
  it('tells a full block from internal hours', () => {
    expect(isFullBlock(leave)).toBe(true)
    expect(isFullBlock(training)).toBe(false)
    // internal work written without hours is still a whole-day block, as before
    expect(isFullBlock({ kind: 'internal', hours: null })).toBe(true)
  })

  it('blocks the whole day only for leave', () => {
    expect(blocksWholeDay([leave], D('2026-09-29'))).toBe(true)
    expect(blocksWholeDay([training], D('2026-09-29'))).toBe(false)
    expect(blocksWholeDay([leave], D('2026-09-30'))).toBe(false)
  })

  it('counts internal hours on its day, and nothing on another', () => {
    expect(internalHoursOn([training, leave], D('2026-09-29'))).toBe(3.5)
    expect(internalHoursOn([training], D('2026-09-30'))).toBe(0)
  })

  it('spreads a several-day block over its working days only', () => {
    const week: BlockedTime = { start: D('2026-09-27'), end: D('2026-10-01') + 86_399_000, kind: 'internal', hours: 8 }
    expect(blockDayStarts(week)).toHaveLength(5)
    const notTuesday = (d: number) => d !== D('2026-09-29')
    expect(internalHoursOn([week], D('2026-09-28'), notTuesday)).toBe(2)
    expect(internalHoursOn([week], D('2026-09-29'), notTuesday)).toBe(0)
  })
})
