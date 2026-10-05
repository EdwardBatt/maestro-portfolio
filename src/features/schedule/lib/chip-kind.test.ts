import { describe, expect, it } from 'vitest'
import { chipKind } from './chip-kind.ts'

const base = { campaignId: null, campaignName: null, taskName: null, notes: null }

// The legend says ad-hoc is green and project work is purple. Everything rendered purple because
// the test was "no campaign AND no deliverable name" — true only before ADR-0035 gave every ad-hoc
// task a deliverable.
describe('chipKind — ad-hoc vs project', () => {
  it('an ad-hoc task is ad-hoc even though it HAS a deliverable (the ADR-0035 regression)', () => {
    const k = chipKind({ ...base, taskName: 'Retouch the hero' })
    expect(k.isAdhoc).toBe(true)
    expect(k.label).toBe('Retouch the hero')
  })

  it('campaign work is project work', () => {
    const k = chipKind({ ...base, campaignId: 'c1', campaignName: 'Ramadan', taskName: 'Key visual' })
    expect(k.isAdhoc).toBe(false)
    expect(k.label).toBe('Key visual · Ramadan')
    expect(k.title).toBe('Key visual')
  })

  // The trap in fixing the classification: the old ad-hoc branch labelled from `notes`, which is
  // usually empty, so flipping the test alone would have blanked every ad-hoc chip.
  it('an ad-hoc chip is never left unlabelled', () => {
    expect(chipKind({ ...base, taskName: 'Has a task' }).label).toBe('Has a task')
    expect(chipKind({ ...base, notes: 'Plain reservation' }).label).toBe('Plain reservation')
    expect(chipKind(base).label).toBe('')
  })

  it('a plain reservation with no task falls back to its notes', () => {
    const k = chipKind({ ...base, notes: 'Dentist' })
    expect(k.isAdhoc).toBe(true)
    expect(k.title).toBe('Dentist')
  })
})
