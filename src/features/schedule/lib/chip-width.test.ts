import { describe, expect, it } from 'vitest'
import { chipWidthPct } from './chip-width.ts'

// Every chip used to render full width regardless of hours, so a 30-minute holding slot looked
// identical to a full day's work and the only clue was the number printed inside it.
describe('chipWidthPct — hours are visible as size', () => {
  it('a full day fills the cell, half a day fills half', () => {
    expect(chipWidthPct(100, 'load_based')).toBe(100)
    expect(chipWidthPct(50, 'load_based')).toBe(50)
  })

  it('a quarter-day booking is visibly a quarter', () => {
    expect(chipWidthPct(25, 'load_based')).toBe(25)
  })

  // A floor, so a very short booking stays readable and clickable rather than becoming a sliver.
  it('clamps tiny bookings to a usable minimum', () => {
    expect(chipWidthPct(6.3, 'load_based')).toBe(18)
    expect(chipWidthPct(0, 'load_based')).toBe(18)
  })

  // A ceiling, so one over-long booking cannot break the column. The cell's overload badge is
  // where going over the day is reported.
  it('never overflows the cell', () => {
    expect(chipWidthPct(150, 'load_based')).toBe(100)
  })

  // A room is taken or it is not — "half booked" is not a thing for an exclusive resource, and a
  // pool's occupancy is a count, not a share of a day.
  it('leaves non-load-based resources full width', () => {
    expect(chipWidthPct(25, 'exclusive')).toBe(100)
    expect(chipWidthPct(25, 'pooled')).toBe(100)
  })

  it('falls back to full width when a booking carries no load', () => {
    expect(chipWidthPct(null, 'load_based')).toBe(100)
  })
})
