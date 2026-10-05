import { describe, expect, it } from 'vitest'
import { computeRollup, hasExceptions, isOverdue, taskCoverage, type RollupRow } from './status'
import type { DeliverableState } from '../deliverables/state-machine'

const NOW = Date.parse('2026-08-17T12:00:00Z')
const mk = (state: DeliverableState, dueAt: string | null = null): RollupRow => ({ state, dueAt })

describe('campaign status rollup (ADR-0024 I2.5; ADR-0018 d.4 — the AM scope slice)', () => {
  it('counts done as approved + delivered, and excludes archived from the total', () => {
    const r = computeRollup(
      [mk('approved'), mk('delivered'), mk('in_progress'), mk('archived')],
      NOW,
    )
    expect(r.total).toBe(3) // archived excluded from live work
    expect(r.done).toBe(2)
    expect(r.byState.archived).toBe(1) // but still tallied per-state
  })

  it('flags blocked, and counts overdue only while the work is still owed', () => {
    const r = computeRollup(
      [
        mk('blocked'),
        mk('in_progress', '2026-08-01T00:00:00Z'), // past due, still owed → overdue
        mk('delivered', '2026-08-01T00:00:00Z'), // past due but delivered → not overdue
        mk('approved', '2026-08-01T00:00:00Z'), // past due but approved → not overdue
        mk('archived', '2026-08-01T00:00:00Z'), // past due but archived → not overdue
      ],
      NOW,
    )
    expect(r.blocked).toBe(1)
    expect(r.overdue).toBe(1)
  })

  it('treats an undated deliverable as never overdue', () => {
    expect(isOverdue(mk('in_progress', null), NOW)).toBe(false)
    expect(computeRollup([mk('in_progress')], NOW).overdue).toBe(0)
  })

  it('reports percent complete, and does not divide by zero on an empty campaign', () => {
    expect(computeRollup([mk('approved'), mk('in_progress')], NOW).percent).toBe(50)
    expect(computeRollup([], NOW)).toMatchObject({ total: 0, done: 0, percent: 0 })
    // A campaign of nothing but archived work is empty, not complete.
    expect(computeRollup([mk('archived')], NOW).percent).toBe(0)
  })

  it('hasExceptions is true for blocked or overdue, false for healthy work', () => {
    expect(hasExceptions(computeRollup([mk('blocked')], NOW))).toBe(true)
    expect(hasExceptions(computeRollup([mk('in_progress', '2026-08-01T00:00:00Z')], NOW))).toBe(true)
    expect(hasExceptions(computeRollup([mk('in_progress'), mk('approved')], NOW))).toBe(false)
  })
})

describe('task coverage — the exception that matters most (Edward, 31 Aug)', () => {
  const d = (taskCount: number, unassignedCount: number) => ({ taskCount, unassignedCount })

  it('sums live tasks and how many have nobody on them', () => {
    // Test Campaign as it actually stands (31 Aug). Its three deliverables hold 18 sub-task rows,
    // but TWO ARE CANCELLED and `taskCount`/`unassignedCount` already exclude those (ADR-0052
    // d.11) — so the honest figure is 0 of 16 assigned, not 2 of 18. Counting the cancelled pair
    // as assigned would report progress that does not exist, which is the whole reason this reads
    // the live counts rather than the raw rows.
    expect(taskCoverage([d(8, 8), d(6, 6), d(2, 2)])).toEqual({
      total: 16,
      assigned: 0,
      done: 0,
      unassigned: 16,
      held: 0,
      heldOwners: [],
    })
  })

  // ADR-0090 d.3b/d.9: a held list is unassigned — and named separately, so the number points at
  // the owner who has not approved it rather than at Traffic.
  it('names the unassigned work that is held for an owner\'s review, inside the unassigned count', () => {
    expect(
      taskCoverage([
        { ...d(3, 3), campaignKind: 'single_job', tasksApprovedAt: null, ownerName: 'Fadia' },
        { ...d(2, 2), campaignKind: 'single_job', tasksApprovedAt: '2026-09-11T09:00:00Z', ownerName: 'Fadia' },
        { ...d(4, 4), campaignKind: 'campaign', tasksApprovedAt: null, ownerName: 'Omar' },
      ]),
    ).toEqual({ total: 9, assigned: 0, unassigned: 9, done: 0, held: 3, heldOwners: ['Fadia'] })
  })

  it('counts a partly staffed campaign correctly', () => {
    expect(taskCoverage([d(10, 4), d(6, 1)])).toEqual({ total: 16, assigned: 11, unassigned: 5, done: 0, held: 0, heldOwners: [] })
  })

  it('reports a fully staffed campaign as no exception at all', () => {
    expect(taskCoverage([d(4, 0), d(3, 0)])).toEqual({ total: 7, assigned: 7, unassigned: 0, done: 0, held: 0, heldOwners: [] })
  })

  it('keeps DONE tasks in the total and counts them assigned — only cancelled work leaves (I52.10)', () => {
    // Edward, 17 Sep: "the total should always read the total, unless a task is cancelled or
    // deleted… done is a status, not whether or not it counts." A row with 5 tasks, 2 of them done
    // and 1 unassigned: 5 total, 4 assigned, 2 done.
    expect(taskCoverage([{ taskCount: 3, unassignedCount: 1, taskTotal: 5, doneCount: 2 }]))
      .toEqual({ total: 5, assigned: 4, unassigned: 1, done: 2, held: 0, heldOwners: [] })
  })

  it('is zero for a campaign whose deliverables carry no tasks yet', () => {
    expect(taskCoverage([d(0, 0)])).toEqual({ total: 0, assigned: 0, unassigned: 0, done: 0, held: 0, heldOwners: [] })
    expect(taskCoverage([])).toEqual({ total: 0, assigned: 0, unassigned: 0, done: 0, held: 0, heldOwners: [] })
  })
})
